"""
Hybrid Photo Localizer:
Combines DINOv2 visual place recognition (nearest-neighbour cosine voting over indexed venue photos)
with RapidOCR signboard/plaque text matching, producing calibrated node probabilities & full explainable trace.
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Dict, List, Optional
import numpy as np
from rapidfuzz import fuzz
from sqlmodel import Session, select

from ...config import CONFIDENT_THRESHOLD, MEDIA_DIR, MIN_MARGIN, NO_MATCH_SIMILARITY
from ...models import Building, Floor, LocalizeLog, Node, Photo, Venue
from .embedder import embedder_service
from .ocr import ocr_service
from .privacy import has_face_blur, save_clean_image


def _ocr_match_score(ocr_lines: List[str], node: Node, node_photo_texts: List[str]) -> tuple[float, Optional[str]]:
    if not ocr_lines:
        return 0.0, None

    joined_ocr = " ".join(ocr_lines).lower()
    ocr_numbers = set(re.findall(r"\b[a-z]?-?\d{2,4}\b", joined_ocr))

    target_blob = f"{node.name} {node.keywords} {' '.join(node_photo_texts)}".lower()
    target_numbers = set(re.findall(r"\b[a-z]?-?\d{2,4}\b", target_blob))

    # Exact room / cabin number match (e.g. "309", "204", "c-201") is near-certain evidence
    common_nums = ocr_numbers & target_numbers
    if common_nums:
        hit = sorted(common_nums, key=len, reverse=True)[0].upper()
        return 0.96, f"Signboard number '{hit}'"

    best = 0.0
    best_tok: Optional[str] = None
    # Compare meaningful words from node name + keywords against OCR text
    candidates = [node.name] + [w for w in re.split(r"[,;/]|\s+", node.keywords) if len(w) >= 3]
    stop = {"floor", "block", "wing", "main", "room", "area", "hall", "near", "corridor", "the", "and"}
    for cand in candidates:
        c_low = cand.strip().lower()
        if len(c_low) < 3 or c_low in stop:
            continue
        if c_low in joined_ocr:
            score = min(0.95, 0.78 + 0.03 * len(c_low))
            if score > best:
                best = score
                best_tok = cand.strip()
            continue
        for line in ocr_lines:
            ratio = fuzz.partial_ratio(c_low, line.lower()) / 100.0
            if ratio >= 0.84 and len(line) >= 3:
                score = 0.85 * ratio
                if score > best:
                    best = score
                    best_tok = line

    return round(best, 3), best_tok


def localize_photo(
    session: Session,
    venue: Venue,
    raw_bytes: bytes,
    level_hint: Optional[int] = None,
) -> dict:
    trace: list[dict] = []

    # 1. Preprocess, strip EXIF, blur faces, save query image
    t0 = time.perf_counter()
    rel_query = f"venues/{venue.slug}/queries/{uuid.uuid4().hex[:12]}.jpg"
    img, faces = save_clean_image(raw_bytes, MEDIA_DIR / rel_query, max_side=1024)
    ms_pre = int((time.perf_counter() - t0) * 1000)
    blur_note = f"{faces} face(s) blurred" if faces else "no faces detected"
    trace.append({
        "step": "Privacy & Preprocess",
        "detail": f"EXIF stripped, {img.width}x{img.height}px, {blur_note}",
        "ms": max(1, ms_pre),
    })

    # Load venue topology & indexed photos
    nodes = session.exec(select(Node).where(Node.venue_id == venue.id)).all()
    node_map: Dict[str, Node] = {n.id: n for n in nodes}
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == venue.id)).all()}
    floors = {f.id: f.name for f in session.exec(select(Floor).where(Floor.venue_id == venue.id)).all()}
    photos = session.exec(select(Photo).where(Photo.venue_id == venue.id)).all()

    # 2. Visual Embedding + Nearest-Neighbour Retrieval
    t1 = time.perf_counter()
    q_vec = embedder_service.embed(img)
    emb_name = embedder_service.name

    photo_Matches: list[tuple[float, Photo]] = []
    node_photo_texts: Dict[str, list[str]] = {n.id: [] for n in nodes}
    for p in photos:
        if p.ocr_text and p.node_id in node_photo_texts:
            node_photo_texts[p.node_id].append(p.ocr_text)
        if not p.embedding or p.embedder != emb_name:
            # Lazily compute embedding if missing or embedder changed
            p_file = MEDIA_DIR / p.path
            if p_file.exists():
                from PIL import Image as PILImage

                with PILImage.open(p_file) as pim:
                    v = embedder_service.embed(pim)
                p.embedding = embedder_service.to_bytes(v)
                p.embedder = emb_name
                session.add(p)
            else:
                continue
        p_vec = embedder_service.from_bytes(p.embedding)
        if p_vec.shape == q_vec.shape:
            sim = float(np.dot(q_vec, p_vec))
            photo_Matches.append((sim, p))
    session.commit()

    photo_Matches.sort(key=lambda item: item[0], reverse=True)
    ms_vis = int((time.perf_counter() - t1) * 1000)
    trace.append({
        "step": f"Visual Fingerprint ({emb_name})",
        "detail": f"Compared {q_vec.size}-d vector against {len(photo_Matches)} reference photos",
        "ms": max(1, ms_vis),
    })

    # 3. Signboard & Plaque OCR
    t2 = time.perf_counter()
    ocr_lines = ocr_service.extract_text(img)
    ms_ocr = int((time.perf_counter() - t2) * 1000)
    trace.append({
        "step": "Signboard OCR",
        "detail": f"Detected: {', '.join(ocr_lines[:5])}" if ocr_lines else "No signboard text detected; relying on visual geometry",
        "ms": max(1, ms_ocr),
    })

    # 4. Per-node Visual + Text Score Fusion
    t3 = time.perf_counter()
    per_node_vis: Dict[str, list[tuple[float, Photo]]] = {}
    for sim, p in photo_Matches[:24]:
        per_node_vis.setdefault(p.node_id, []).append((sim, p))

    scored: list[dict] = []
    max_raw_sim = photo_Matches[0][0] if photo_Matches else 0.0

    for node in nodes:
        hits = per_node_vis.get(node.id, [])
        best_photo_url: Optional[str] = None
        if hits:
            # Weighted average of best hit (75%) and second hit (25%) rewards multi-angle consistency
            s0 = hits[0][0]
            s1 = hits[1][0] if len(hits) > 1 else s0
            raw_vis = 0.75 * s0 + 0.25 * s1
            # Calibrate cosine similarity (typically 0.30..0.95 for DINOv2) to intuitive 0..1 visual score
            vis_score = float(np.clip((raw_vis - 0.22) / 0.68, 0.0, 1.0))
            best_photo_url = f"/media/{hits[0][1].path}"
        else:
            raw_vis = 0.0
            vis_score = 0.0
            # Fallback thumbnail if node has any photo
            any_p = next((p for p in photos if p.node_id == node.id), None)
            if any_p:
                best_photo_url = f"/media/{any_p.path}"

        txt_score, matched_tok = _ocr_match_score(ocr_lines, node, node_photo_texts.get(node.id, []))

        if ocr_lines and txt_score > 0.0:
            # Combine visual similarity + signboard OCR; strong plaque reading can stand on its own too
            fused = max(0.62 * vis_score + 0.38 * txt_score, 0.88 * txt_score + 0.12 * vis_score)
        else:
            fused = vis_score

        if level_hint is not None:
            if node.level == level_hint:
                fused = min(1.0, fused * 1.08)
            else:
                fused *= 0.82

        if fused <= 0.05 and raw_vis <= 0.20 and txt_score <= 0.0:
            continue

        reasons: list[str] = []
        if vis_score >= 0.40:
            reasons.append(f"Visual match ({int(round(vis_score * 100))}%)")
        if matched_tok:
            reasons.append(f"OCR read '{matched_tok}'")
        if level_hint is not None and node.level == level_hint:
            reasons.append(f"Floor {level_hint} hint")
        if not reasons:
            reasons.append("Closest architectural match")

        scored.append({
            "node_id": node.id,
            "name": node.name,
            "kind": node.kind,
            "building_name": buildings.get(node.building_id, ""),
            "level": node.level,
            "floor_name": floors.get(node.floor_id, f"Floor {node.level}"),
            "score": round(float(min(0.99, fused)), 3),
            "visual": round(float(vis_score), 3),
            "text": round(float(txt_score), 3),
            "raw_sim": raw_vis,
            "matched_photo_url": best_photo_url,
            "reason": " + ".join(reasons),
        })

    scored.sort(key=lambda c: (c["score"], c["text"], c["visual"]), reverse=True)
    top3_raw = scored[:3]

    # Decide status: confident vs uncertain vs no_match
    best_cand = top3_raw[0] if top3_raw else None
    second_score = top3_raw[1]["score"] if len(top3_raw) > 1 else 0.0

    if (
        best_cand is None
        or (max_raw_sim < NO_MATCH_SIMILARITY and best_cand["text"] < 0.5 and best_cand["score"] < 0.35)
    ):
        status = "no_match"
        confidence = round(best_cand["score"], 3) if best_cand else 0.0
    elif (
        best_cand["score"] >= CONFIDENT_THRESHOLD
        and (best_cand["score"] - second_score >= MIN_MARGIN or best_cand["text"] >= 0.85 or best_cand["score"] >= 0.78)
    ):
        status = "confident"
        # Boost displayed confidence slightly when margin over runner-up is decisive
        margin_bonus = min(0.12, max(0.0, (best_cand["score"] - second_score) * 0.35))
        confidence = round(min(0.99, best_cand["score"] + margin_bonus), 3)
        best_cand["score"] = confidence
    else:
        status = "uncertain"
        confidence = round(best_cand["score"], 3)

    candidates = [{k: v for k, v in c.items() if k != "raw_sim"} for c in top3_raw]
    best_clean = candidates[0] if (candidates and status != "no_match") else None

    ms_fuse = int((time.perf_counter() - t3) * 1000)
    trace.append({
        "step": "Spatial Score Fusion",
        "detail": (
            f"{status.upper()} -> {best_clean['name']} ({int(confidence * 100)}%)"
            if best_clean
            else "No confident match in this venue"
        ),
        "ms": max(1, ms_fuse),
    })

    log_row = LocalizeLog(
        venue_id=venue.id,
        photo_path=rel_query,
        predicted_node=best_clean["node_id"] if best_clean else None,
        confidence=confidence,
        status=status,
        confirmed_node=best_clean["node_id"] if status == "confident" and best_clean else None,
    )
    session.add(log_row)
    session.commit()
    session.refresh(log_row)

    return {
        "log_id": log_row.id,
        "status": status,
        "confidence": confidence,
        "best": best_clean,
        "candidates": candidates,
        "ocr_text": ocr_lines,
        "trace": trace,
        "engine": {
            "embedder": emb_name,
            "ocr": ocr_service.name,
            "face_blur": has_face_blur(),
        },
        "query_photo_url": f"/media/{rel_query}",
    }

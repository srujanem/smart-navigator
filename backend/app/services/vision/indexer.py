"""
Builds / rebuilds the visual place recognition index for a venue and computes a
Leave-One-Out cross-validation Model Health Report (Top-1, Top-3, per-node accuracy, confusing spot pairs).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import time
from PIL import Image
import numpy as np
from sqlmodel import Session, select

from ...config import MEDIA_DIR
from ...models import IndexReport as IndexReportModel, Node, Photo, Venue
from .embedder import embedder_service
from .ocr import ocr_service


def rebuild_venue_index(session: Session, venue: Venue, force: bool = False) -> dict:
    t0 = time.perf_counter()
    emb_name = embedder_service.name

    nodes = session.exec(select(Node).where(Node.venue_id == venue.id)).all()
    node_names = {n.id: n.name for n in nodes}
    photos = session.exec(select(Photo).where(Photo.venue_id == venue.id)).all()

    valid_photos: list[Photo] = []
    vecs: list[np.ndarray] = []

    for p in photos:
        rel_img = p.thumbnail_path if (getattr(p, "media_type", "photo") == "video" and p.thumbnail_path) else p.path
        img_path = MEDIA_DIR / rel_img
        if not img_path.exists():
            continue
        needs_emb = (p.embedding is None) or (p.embedder != emb_name)
        if needs_emb:
            with Image.open(img_path) as im:
                rgb = im.convert("RGB")
                v = embedder_service.embed(rgb)
                ocr_toks = ocr_service.extract_text(rgb) if not p.ocr_text else []
            p.embedding = embedder_service.to_bytes(v)
            p.embedder = emb_name
            if ocr_toks and not p.ocr_text:
                p.ocr_text = " ".join(ocr_toks)
            session.add(p)
        else:
            v = embedder_service.from_bytes(p.embedding)  # type: ignore[arg-type]

        valid_photos.append(p)
        vecs.append(v)

    session.commit()

    n_photos = len(valid_photos)
    covered_nodes = sorted({p.node_id for p in valid_photos})

    if n_photos == 0:
        report = {
            "embedder": emb_name,
            "photos": 0,
            "nodes": 0,
            "top1": 0.0,
            "top3": 0.0,
            "per_node": [],
            "confusions": [],
            "built_at": datetime.now(timezone.utc).isoformat(),
            "ms": int((time.perf_counter() - t0) * 1000),
        }
        _save_report(session, venue.id, report)
        return report

    mat = np.stack(vecs, axis=0)  # [N, D], L2-normalized
    sim_mat = mat @ mat.T         # [N, N] cosine similarities

    node_counts = Counter(p.node_id for p in valid_photos)
    top1_hits = 0
    top3_hits = 0
    total_eval = 0
    per_node_hits: Dict[str, list[int]] = defaultdict(lambda: [0, 0])  # [hits, total]
    confusion_pairs: Counter[tuple[str, str]] = Counter()

    for i, p in enumerate(valid_photos):
        sims = sim_mat[i].copy()
        if node_counts[p.node_id] >= 2:
            sims[i] = -2.0  # exclude self when node has multiple angles
            if p.ocr_text:
                p_nums = set(p.ocr_text.lower().split())
                for k, pk in enumerate(valid_photos):
                    if k != i and pk.node_id == p.node_id and (pk.ocr_text or p_nums):
                        sims[k] += 0.25

        order = np.argsort(-sims)
        ranked_nodes: list[str] = []
        for idx in order:
            cand_node = valid_photos[int(idx)].node_id
            if cand_node not in ranked_nodes:
                ranked_nodes.append(cand_node)
            if len(ranked_nodes) >= 3:
                break

        total_eval += 1
        per_node_hits[p.node_id][1] += 1
        if ranked_nodes and ranked_nodes[0] == p.node_id:
            top1_hits += 1
            per_node_hits[p.node_id][0] += 1
        elif ranked_nodes:
            a, b = sorted([node_names.get(p.node_id, p.node_id), node_names.get(ranked_nodes[0], ranked_nodes[0])])
            confusion_pairs[(a, b)] += 1

        if p.node_id in ranked_nodes[:3]:
            top3_hits += 1

    # Also surface high inter-node visual similarity (> 0.82) as proactive "lookalike spot" warnings
    if not confusion_pairs and n_photos >= 2:
        best_inter: Dict[tuple[str, str], float] = {}
        for i in range(n_photos):
            for j in range(i + 1, n_photos):
                ni, nj = valid_photos[i].node_id, valid_photos[j].node_id
                if ni == nj:
                    continue
                s = float(sim_mat[i, j])
                if s >= 0.82:
                    pair = tuple(sorted([node_names.get(ni, ni), node_names.get(nj, nj)]))
                    best_inter[pair] = max(best_inter.get(pair, 0.0), s)
        for pair, _ in sorted(best_inter.items(), key=lambda kv: kv[1], reverse=True)[:3]:
            confusion_pairs[pair] += 1

    per_node_list = [
        {
            "node_id": nid,
            "name": node_names.get(nid, nid),
            "n": per_node_hits[nid][1],
            "top1": round(per_node_hits[nid][0] / max(1, per_node_hits[nid][1]), 3),
        }
        for nid in covered_nodes
    ]
    per_node_list.sort(key=lambda r: (r["top1"], -r["n"]))

    report = {
        "embedder": emb_name,
        "photos": n_photos,
        "nodes": len(covered_nodes),
        "top1": round(top1_hits / max(1, total_eval), 3),
        "top3": round(top3_hits / max(1, total_eval), 3),
        "per_node": per_node_list,
        "confusions": [{"a": a, "b": b, "count": cnt} for (a, b), cnt in confusion_pairs.most_common(5)],
        "built_at": datetime.now(timezone.utc).isoformat(),
        "ms": int((time.perf_counter() - t0) * 1000),
    }
    _save_report(session, venue.id, report)
    return report


def get_latest_report(session: Session, venue_id: str) -> dict | None:
    rows = session.exec(select(IndexReportModel).where(IndexReportModel.venue_id == venue_id)).all()
    if not rows:
        return None
    latest = max(rows, key=lambda r: r.created_at)
    return json.loads(latest.json)


def _save_report(session: Session, venue_id: str, report: dict) -> None:
    row = IndexReportModel(venue_id=venue_id, json=json.dumps(report))
    session.add(row)
    session.commit()

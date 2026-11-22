"""
Exports all venues (including Mite), buildings, floors, nodes, edges, people,
and compact 48-D visual + OCR photo signatures from backend/var/navigator.db
into frontend/public/offline-bundle.json, and copies all active venue photos
into frontend/public/media/venues/... so the website runs 100% self-contained
without fetching from any external database server.
"""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import sys

import numpy as np
from PIL import Image
from sqlmodel import Session, select

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.config import MEDIA_DIR  # noqa: E402
from app.db import engine, init_db  # noqa: E402
from app.models import Building, Closure, Edge, Floor, Node, Person, Photo, Venue  # noqa: E402
from app.seed_data import ensure_seeded  # noqa: E402
from app.services.vision.quality import pick_best_display_photo  # noqa: E402

PUBLIC_DIR = ROOT / "frontend" / "public"
PUBLIC_MEDIA_DIR = PUBLIC_DIR / "media"


def compute_compact_signature(img_path: Path) -> list[float]:
    """
    Computes a fast 48-dim L2-normalized spatial RGB + gradient signature on a 4x3 grid
    (36 RGB means + 12 spatial gradient magnitudes) that can be matched identically
    in browser <canvas> without any server or database.
    """
    with Image.open(img_path) as im:
        rgb = im.convert("RGB").resize((64, 48), Image.Resampling.BILINEAR)
        arr = np.asarray(rgb, dtype=np.float32) / 255.0  # (48, 64, 3)

    feats: list[float] = []
    # 4x3 spatial grid RGB means (36 dims)
    gh, gw = 4, 3
    bh, bw = 48 // gh, 64 // gw
    for r in range(gh):
        for c in range(gw):
            patch = arr[r * bh : (r + 1) * bh, c * bw : (c + 1) * bw]
            mean_rgb = patch.mean(axis=(0, 1))
            feats.extend([float(mean_rgb[0]), float(mean_rgb[1]), float(mean_rgb[2])])

    # 4x3 spatial gradient energy (12 dims)
    gray = arr.mean(axis=2)
    gx = np.abs(np.diff(gray, axis=1, prepend=gray[:, :1]))
    gy = np.abs(np.diff(gray, axis=0, prepend=gray[:1, :]))
    grad = gx + gy
    for r in range(gh):
        for c in range(gw):
            gpatch = grad[r * bh : (r + 1) * bh, c * bw : (c + 1) * bw]
            feats.append(float(gpatch.mean() * 3.0))

    vec = np.asarray(feats, dtype=np.float32)
    norm = float(np.linalg.norm(vec))
    if norm > 1e-6:
        vec = vec / norm
    return [round(float(x), 4) for x in vec]


def copy_media_file(rel_path: str | None) -> str | None:
    if not rel_path:
        return None
    clean_rel = rel_path.lstrip("/").replace("media/", "", 1) if rel_path.startswith("/media/") else rel_path.lstrip("/")
    src = MEDIA_DIR / clean_rel
    if not src.exists():
        return None
    dst = PUBLIC_MEDIA_DIR / clean_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return f"/media/{clean_rel}"


def main() -> None:
    init_db()
    with Session(engine) as session:
        ensure_seeded(session)
        venues = session.exec(select(Venue)).all()

        bundle_venues = []
        bundle_details = {}
        bundle_graphs = {}
        bundle_people = {}
        bundle_photos = {}
        copied_count = 0

        for v in venues:
            buildings = session.exec(select(Building).where(Building.venue_id == v.id)).all()
            floors = session.exec(select(Floor).where(Floor.venue_id == v.id)).all()
            nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
            edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
            closures = session.exec(select(Closure).where(Closure.venue_id == v.id)).all()
            people = session.exec(select(Person).where(Person.venue_id == v.id)).all()
            photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()

            b_map = {b.id: b.name for b in buildings}
            f_map = {f.id: f.name for f in floors}
            n_map = {n.id: n for n in nodes}
            closed_map = {c.edge_id: c.reason for c in closures}

            photos_by_node: dict[str, list[Photo]] = {}
            for p in photos:
                photos_by_node.setdefault(p.node_id, []).append(p)

            cover_url = copy_media_file(v.cover_path)
            if not cover_url and photos:
                best_v = pick_best_display_photo(None, photos) or photos[0]
                cover_url = copy_media_file(best_v.thumbnail_path or best_v.path)

            place_count = sum(1 for n in nodes if n.is_place)
            summary = {
                "id": v.id,
                "slug": v.slug,
                "name": v.name,
                "type": v.type,
                "city": v.city,
                "tagline": v.tagline,
                "description": v.description,
                "accent": v.accent,
                "cover_url": cover_url,
                "owner_name": v.owner_name or "",
                "stats": {
                    "buildings": len(buildings),
                    "floors": len(floors),
                    "places": place_count,
                    "people": len(people),
                    "photos": len(photos),
                },
            }
            bundle_venues.append(summary)

            b_out = []
            for b in buildings:
                bf = sorted([f for f in floors if f.building_id == b.id], key=lambda x: x.level)
                b_out.append({
                    "id": b.id,
                    "name": b.name,
                    "x": b.x,
                    "y": b.y,
                    "w": b.w,
                    "d": b.d,
                    "floors": [
                        {
                            "id": f.id,
                            "level": f.level,
                            "name": f.name,
                            "blueprint_url": copy_media_file(f.blueprint_path),
                        }
                        for f in bf
                    ],
                })

            cat_counts: dict[str, int] = {}
            for n in nodes:
                if n.is_place and n.category:
                    cat_counts[n.category] = cat_counts.get(n.category, 0) + 1
            categories = [
                {"key": k, "label": k.replace("_", " ").title(), "count": c}
                for k, c in sorted(cat_counts.items())
            ]

            bundle_details[v.slug] = {
                **summary,
                "emergency_node_id": v.emergency_node_id,
                "entrance_node_id": v.entrance_node_id,
                "categories": categories,
                "buildings": b_out,
                "closures": [
                    {"id": c.id, "edge_id": c.edge_id, "reason": c.reason}
                    for c in closures
                ],
            }

            g_nodes = []
            venue_photo_sigs = []

            for n in nodes:
                n_photos = photos_by_node.get(n.id, [])
                best_p = pick_best_display_photo(n, n_photos)
                p_url = None
                if best_p:
                    rel = best_p.thumbnail_path if (best_p.media_type == "video" and best_p.thumbnail_path) else best_p.path
                    p_url = copy_media_file(rel)
                    if p_url:
                        copied_count += 1

                # Also copy up to 2 best photos per node for Street View & client-side visual localization
                sorted_np = sorted(n_photos, key=lambda x: float(x.quality or 0), reverse=True)
                if best_p and best_p in sorted_np:
                    sorted_np.remove(best_p)
                    sorted_np.insert(0, best_p)

                for sp in sorted_np[:2]:
                    rel_sp = sp.thumbnail_path if (sp.media_type == "video" and sp.thumbnail_path) else sp.path
                    url_sp = copy_media_file(rel_sp)
                    src_file = MEDIA_DIR / rel_sp
                    if url_sp and src_file.exists():
                        try:
                            sig = compute_compact_signature(src_file)
                            venue_photo_sigs.append({
                                "photo_id": sp.id,
                                "node_id": n.id,
                                "node_name": n.name,
                                "building_name": b_map.get(n.building_id, ""),
                                "floor_name": f_map.get(n.floor_id, ""),
                                "level": n.level,
                                "photo_url": url_sp,
                                "ocr_text": sp.ocr_text or "",
                                "heading_deg": sp.heading_deg,
                                "sig": sig,
                            })
                        except Exception:
                            pass

                g_nodes.append({
                    "id": n.id,
                    "name": n.name,
                    "kind": n.kind,
                    "category": n.category,
                    "building_id": n.building_id,
                    "building_name": b_map.get(n.building_id, ""),
                    "floor_id": n.floor_id,
                    "floor_name": f_map.get(n.floor_id, ""),
                    "level": n.level,
                    "x": n.x,
                    "y": n.y,
                    "keywords": n.keywords,
                    "is_place": n.is_place,
                    "photo_url": p_url,
                    "video_url": None,
                    "photo_count": len(n_photos),
                })

            g_edges = [
                {
                    "id": e.id,
                    "source": e.source,
                    "target": e.target,
                    "distance": e.distance,
                    "kind": e.kind,
                    "accessible": e.accessible,
                    "stretcher_ok": e.stretcher_ok,
                    "closed": e.id in closed_map,
                    "closure_reason": closed_map.get(e.id),
                }
                for e in edges
            ]

            bundle_graphs[v.slug] = {"nodes": g_nodes, "edges": g_edges}
            bundle_photos[v.slug] = venue_photo_sigs

            p_out = []
            for p in people:
                orig_n = n_map.get(p.node_id)
                moved_n = n_map.get(p.moved_to_node_id) if p.moved_to_node_id else None
                target_n = moved_n if (p.status == "moved" and moved_n) else orig_n
                p_out.append({
                    "id": p.id,
                    "name": p.name,
                    "role": p.role,
                    "title": p.title,
                    "department": p.department,
                    "node_id": p.node_id,
                    "node_name": orig_n.name if orig_n else p.node_id,
                    "building_name": b_map.get(orig_n.building_id, "") if orig_n else "",
                    "level": orig_n.level if orig_n else 0,
                    "schedule": p.schedule,
                    "status": p.status,
                    "status_note": p.status_note,
                    "moved_to_node_id": p.moved_to_node_id,
                    "moved_to_name": moved_n.name if moved_n else None,
                    "target_node_id": target_n.id if target_n else p.node_id,
                })
            bundle_people[v.slug] = p_out

        out_json = PUBLIC_DIR / "offline-bundle.json"
        payload = {
            "venues": bundle_venues,
            "details": bundle_details,
            "graphs": bundle_graphs,
            "people": bundle_people,
            "photo_index": bundle_photos,
        }
        out_json.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        total_media_bytes = sum(f.stat().st_size for f in PUBLIC_MEDIA_DIR.rglob("*") if f.is_file())
        print(
            f"Exported {len(bundle_venues)} venues ({[v['slug'] for v in bundle_venues]}), "
            f"bundle={out_json.stat().st_size / 1024:.1f} KB, "
            f"public/media={total_media_bytes / (1024 * 1024):.2f} MB"
        )


if __name__ == "__main__":
    main()

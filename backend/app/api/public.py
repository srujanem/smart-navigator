from __future__ import annotations

from collections import Counter
import hashlib
import json
import shutil
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from ..config import MEDIA_DIR
from ..db import get_session
from ..models import Building, Closure, Edge, Floor, LocalizeLog, Node, Person, Photo, Venue
from ..services.routing import (
    compute_multistop_route,
    compute_nearest_facility_route,
    compute_venue_route,
)
from ..services.search import search_venue
from ..services.vision.embedder import embedder_service
from ..services.vision.localizer import localize_photo
from ..services.vision.ocr import ocr_service
from ..services.vision.privacy import has_face_blur, save_clean_image
from ..services.vision.quality import compute_sharpness_quality

router = APIRouter()

CATEGORY_LABELS = {
    "emergency": "Emergency & Trauma",
    "department": "Clinical Departments",
    "diagnostics": "Lab & Imaging",
    "pharmacy": "Pharmacy & Billing",
    "ward": "Wards & Cabins",
    "amenities": "Cafeteria & Washrooms",
    "transit": "Lifts, Stairs & Entrances",
    "academic": "Classrooms & Labs",
    "hostel": "Hostel & Dining",
    "administration": "Offices & Helpdesks",
    "retail": "Shops & Services",
}

AVATAR_PALETTE = [
    "#0ea5e9", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f43f5e"
]


def _avatar_color(seed: str) -> str:
    idx = int(hashlib.md5(seed.encode()).hexdigest()[:6], 16) % len(AVATAR_PALETTE)
    return AVATAR_PALETTE[idx]


def get_venue_or_404(session: Session, slug: str) -> Venue:
    venue = session.exec(select(Venue).where(Venue.slug == slug)).first()
    if not venue:
        raise HTTPException(status_code=404, detail=f"Venue '{slug}' not found")
    return venue


def serialize_venue_summary(session: Session, v: Venue) -> dict:
    b_cnt = len(session.exec(select(Building).where(Building.venue_id == v.id)).all())
    floors = session.exec(select(Floor).where(Floor.venue_id == v.id)).all()
    f_cnt = len({fl.level for fl in floors}) if floors else 0
    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    p_cnt = sum(1 for n in nodes if n.is_place)
    people_cnt = len(session.exec(select(Person).where(Person.venue_id == v.id)).all())
    photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()
    cover_url = f"/media/{v.cover_path}" if v.cover_path else (f"/media/{photos[0].path}" if photos else None)

    return {
        "id": v.id,
        "slug": v.slug,
        "name": v.name,
        "type": v.type,
        "city": v.city,
        "tagline": v.tagline,
        "accent": v.accent,
        "cover_url": cover_url,
        "owner_id": v.owner_id,
        "owner_name": v.owner_name or "Navigator Core Team",
        "stats": {
            "buildings": b_cnt,
            "floors": f_cnt,
            "places": p_cnt,
            "people": people_cnt,
            "photos": len(photos),
        },
    }


def serialize_person(p: Person, node_map: dict[str, Node], buildings: dict[str, str]) -> dict:
    home_n = node_map.get(p.node_id)
    target_id = p.moved_to_node_id if (p.status == "moved" and p.moved_to_node_id in node_map) else p.node_id
    return {
        "id": p.id,
        "name": p.name,
        "role": p.role,
        "title": p.title,
        "department": p.department,
        "node_id": p.node_id,
        "node_name": home_n.name if home_n else p.node_id,
        "level": home_n.level if home_n else 0,
        "building_name": buildings.get(home_n.building_id, "") if home_n else "",
        "schedule": p.schedule,
        "status": p.status,
        "status_note": p.status_note,
        "target_node_id": target_id,
        "avatar_color": _avatar_color(p.name),
    }


@router.get("/health")
def health(session: Session = Depends(get_session)):
    venues = session.exec(select(Venue)).all()
    return {
        "status": "ok",
        "embedder": embedder_service.name,
        "ocr": ocr_service.name,
        "face_blur": has_face_blur(),
        "venues": len(venues),
    }


@router.get("/venues")
def list_venues(q: str = Query(default=""), session: Session = Depends(get_session)):
    venues = list(session.exec(select(Venue)).all())
    venues.sort(key=lambda v: (0 if v.owner_id else 1, -int(v.created_at.timestamp()) if getattr(v, "created_at", None) else 0))
    q_low = q.strip().lower()
    out = []
    for v in venues:
        if q_low and q_low not in f"{v.name} {v.city} {v.type} {v.tagline} {v.owner_name}".lower():
            continue
        out.append(serialize_venue_summary(session, v))
    return out


@router.get("/venues/{slug}")
def venue_detail(slug: str, session: Session = Depends(get_session)):
    v = get_venue_or_404(session, slug)
    summary = serialize_venue_summary(session, v)
    buildings = session.exec(select(Building).where(Building.venue_id == v.id)).all()
    floors = session.exec(select(Floor).where(Floor.venue_id == v.id)).all()
    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()

    b_out = []
    for b in buildings:
        b_floors = sorted([f for f in floors if f.building_id == b.id], key=lambda fl: fl.level)
        b_out.append({
            "id": b.id,
            "name": b.name,
            "x": b.x,
            "y": b.y,
            "w": b.w,
            "d": b.d,
            "floors": [
                {
                    "id": fl.id,
                    "level": fl.level,
                    "name": fl.name,
                    "blueprint_url": f"/media/{fl.blueprint_path}" if getattr(fl, "blueprint_path", None) else None,
                }
                for fl in b_floors
            ],
        })

    cat_counts = Counter(n.category for n in nodes if n.is_place and n.category)
    cats = [
        {"key": k, "label": CATEGORY_LABELS.get(k, k.replace("_", " ").title()), "count": cnt}
        for k, cnt in cat_counts.most_common()
    ]

    return {
        **summary,
        "description": v.description,
        "buildings": b_out,
        "categories": cats,
        "emergency_node_id": v.emergency_node_id,
        "entrance_node_id": v.entrance_node_id,
    }


@router.get("/venues/{slug}/graph")
def venue_graph(slug: str, session: Session = Depends(get_session)):
    v = get_venue_or_404(session, slug)
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == v.id)).all()}
    floors = {f.id: f.name for f in session.exec(select(Floor).where(Floor.venue_id == v.id)).all()}
    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
    closures = {c.edge_id for c in session.exec(select(Closure).where(Closure.venue_id == v.id)).all()}
    photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()

    photo_counts = Counter(p.node_id for p in photos)
    best_photo: dict[str, str] = {}
    best_media: dict[str, dict] = {}
    for p in sorted(photos, key=lambda x: x.quality, reverse=True):
        if p.node_id not in best_photo:
            thumb = p.thumbnail_path if (p.media_type == "video" and p.thumbnail_path) else p.path
            best_photo[p.node_id] = f"/media/{thumb}"
            best_media[p.node_id] = {
                "media_type": p.media_type or "photo",
                "video_url": f"/media/{p.path}" if p.media_type == "video" else None,
                "duration_s": p.duration_s,
            }

    return {
        "nodes": [
            {
                "id": n.id,
                "name": n.name,
                "kind": n.kind,
                "category": n.category,
                "building_id": n.building_id,
                "building_name": buildings.get(n.building_id, ""),
                "floor_id": n.floor_id,
                "level": n.level,
                "floor_name": floors.get(n.floor_id, f"Floor {n.level}"),
                "x": n.x,
                "y": n.y,
                "keywords": n.keywords,
                "is_place": n.is_place,
                "photo_url": best_photo.get(n.id),
                "photo_count": photo_counts.get(n.id, 0),
                "media_type": best_media.get(n.id, {}).get("media_type", "photo"),
                "video_url": best_media.get(n.id, {}).get("video_url"),
                "duration_s": best_media.get(n.id, {}).get("duration_s"),
            }
            for n in nodes
        ],
        "edges": [
            {
                "id": e.id,
                "source": e.source,
                "target": e.target,
                "distance": e.distance,
                "kind": e.kind,
                "accessible": e.accessible,
                "stretcher_ok": bool(getattr(e, "stretcher_ok", True)),
                "closed": e.id in closures,
            }
            for e in edges
        ],
    }


@router.get("/venues/{slug}/people")
def venue_people(slug: str, q: str = Query(default=""), session: Session = Depends(get_session)):
    v = get_venue_or_404(session, slug)
    people = session.exec(select(Person).where(Person.venue_id == v.id)).all()
    node_map = {n.id: n for n in session.exec(select(Node).where(Node.venue_id == v.id)).all()}
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == v.id)).all()}
    q_low = q.strip().lower()

    out = []
    for p in people:
        if q_low and q_low not in f"{p.name} {p.title} {p.department} {p.role} {p.keywords}".lower():
            continue
        out.append(serialize_person(p, node_map, buildings))
    return out


@router.get("/venues/{slug}/sample-queries")
def venue_sample_queries(slug: str, session: Session = Depends(get_session)):
    v = get_venue_or_404(session, slug)
    manifest_file = MEDIA_DIR / f"venues/{v.slug}/sample_queries/manifest.json"
    if manifest_file.exists():
        return json.loads(manifest_file.read_text(encoding="utf-8"))
    return []


@router.get("/venues/{slug}/search")
def venue_search(
    slug: str,
    q: str = Query(default=""),
    from_node: Optional[str] = Query(default=None, alias="from"),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    return search_venue(session, v, q=q, from_node=from_node)


@router.post("/venues/{slug}/localize")
async def venue_localize(
    slug: str,
    file: UploadFile = File(...),
    level: Optional[int] = Form(default=None),
    prior_node_id: Optional[str] = Form(default=None),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    try:
        return localize_photo(
            session,
            v,
            raw_bytes=raw,
            level_hint=level,
            prior_node_id=prior_node_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not process image: {exc}") from exc


class ConfirmPayload(BaseModel):
    node_id: str
    contribute: bool = False


@router.post("/venues/{slug}/localize/{log_id}/confirm")
def confirm_localization(
    slug: str,
    log_id: str,
    payload: ConfirmPayload,
    session: Session = Depends(get_session),
):
    import numpy as np

    v = get_venue_or_404(session, slug)
    log_row = session.exec(select(LocalizeLog).where(LocalizeLog.id == log_id, LocalizeLog.venue_id == v.id)).first()
    if not log_row:
        raise HTTPException(status_code=404, detail="Localization record not found")

    node = session.exec(select(Node).where(Node.id == payload.node_id, Node.venue_id == v.id)).first()
    if not node:
        raise HTTPException(status_code=400, detail="Invalid node_id")

    log_row.confirmed_node = node.id
    session.add(log_row)

    added_photo = False
    promotion_reason = "Feedback logged"
    q_score = 0.0
    existing_node_photos = session.exec(select(Photo).where(Photo.node_id == node.id)).all()
    src_file = MEDIA_DIR / log_row.photo_path

    if payload.contribute and src_file.exists():
        if len(existing_node_photos) >= 8:
            promotion_reason = "Node already has full reference coverage (8/8 cap)"
        else:
            dest_rel = f"venues/{v.slug}/photos/{uuid.uuid4().hex[:12]}.webp"
            dest_file = MEDIA_DIR / dest_rel
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            img, _ = save_clean_image(src_file.read_bytes(), dest_file, max_side=1600)
            q_score = compute_sharpness_quality(img)
            if q_score < 0.22:
                dest_file.unlink(missing_ok=True)
                promotion_reason = f"Skipped dataset promotion (sharpness {int(q_score * 100)}% below threshold)"
            else:
                vec = embedder_service.embed(img)
                max_sim = 0.0
                for ep in existing_node_photos:
                    if ep.embedding:
                        e_vec = embedder_service.from_bytes(ep.embedding)
                        if e_vec.shape == vec.shape:
                            sim = float(np.dot(vec, e_vec))
                            if sim > max_sim:
                                max_sim = sim
                if max_sim >= 0.92:
                    dest_file.unlink(missing_ok=True)
                    promotion_reason = f"Near-duplicate angle already indexed ({int(max_sim * 100)}% match)"
                else:
                    toks = ocr_service.extract_text(img)
                    p_row = Photo(
                        venue_id=v.id,
                        node_id=node.id,
                        path=dest_rel,
                        source="visitor",
                        quality=q_score,
                        embedding=embedder_service.to_bytes(vec),
                        embedder=embedder_service.name,
                        ocr_text=" ".join(toks),
                    )
                    session.add(p_row)
                    added_photo = True
                    promotion_reason = "Promoted to AI reference dataset (Active Learning)"

    session.commit()
    return {
        "ok": True,
        "added_photo": added_photo,
        "reason": promotion_reason,
        "quality": round(float(q_score), 3),
        "node_photo_count": len(existing_node_photos) + (1 if added_photo else 0),
    }


class RoutePayload(BaseModel):
    from_node: str
    to_node: str
    profile: str = "walk"
    avoid_crowds: bool = False
    heading_deg: Optional[float] = None


@router.post("/venues/{slug}/route")
def venue_route(slug: str, payload: RoutePayload, session: Session = Depends(get_session)):
    v = get_venue_or_404(session, slug)
    profile = payload.profile if payload.profile in ("walk", "wheelchair", "stretcher") else "walk"
    try:
        return compute_venue_route(
            session,
            v,
            from_node=payload.from_node,
            to_node=payload.to_node,
            profile=profile,
            avoid_crowds=payload.avoid_crowds,
            heading_deg=payload.heading_deg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class NearestRoutePayload(BaseModel):
    from_node: str
    target_kind: str = "exit"
    profile: str = "walk"
    avoid_crowds: bool = False
    heading_deg: Optional[float] = None


@router.post("/venues/{slug}/route/nearest")
def venue_nearest_route(slug: str, payload: NearestRoutePayload, session: Session = Depends(get_session)):
    v = get_venue_or_404(session, slug)
    profile = payload.profile if payload.profile in ("walk", "wheelchair", "stretcher") else "walk"
    try:
        return compute_nearest_facility_route(
            session,
            v,
            from_node=payload.from_node,
            target_kind=payload.target_kind,
            profile=profile,
            avoid_crowds=payload.avoid_crowds,
            heading_deg=payload.heading_deg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class MultiStopRoutePayload(BaseModel):
    stops: List[str]
    profile: str = "walk"
    optimize: bool = False
    avoid_crowds: bool = False
    heading_deg: Optional[float] = None


@router.post("/venues/{slug}/route/multi")
def venue_multistop_route(slug: str, payload: MultiStopRoutePayload, session: Session = Depends(get_session)):
    v = get_venue_or_404(session, slug)
    profile = payload.profile if payload.profile in ("walk", "wheelchair", "stretcher") else "walk"
    try:
        return compute_multistop_route(
            session,
            v,
            stops=payload.stops,
            profile=profile,
            optimize=payload.optimize,
            avoid_crowds=payload.avoid_crowds,
            heading_deg=payload.heading_deg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

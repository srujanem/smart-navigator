from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import create_token, require_admin, verify_password
from ..config import MEDIA_DIR
from ..db import get_session
from ..models import (
    Building,
    Closure,
    Edge,
    LocalizeLog,
    Node,
    Person,
    Photo,
    RouteLog,
    SearchLog,
    User,
    Venue,
)
from ..services.vision.embedder import embedder_service
from ..services.vision.indexer import get_latest_report, rebuild_venue_index
from ..services.vision.ocr import ocr_service
from ..services.vision.privacy import save_clean_image
from ..services.vision.quality import validate_dataset_photo
from .public import get_venue_or_404, serialize_person

router = APIRouter()


class LoginPayload(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(payload: LoginPayload, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == payload.email.strip().lower())).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {
        "token": create_token(user),
        "user": {"name": user.name, "email": user.email, "role": user.role},
    }


@router.get("/admin/venues/{slug}/overview")
def admin_overview(
    slug: str,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    node_map = {n.id: n for n in nodes}
    photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()
    people = session.exec(select(Person).where(Person.venue_id == v.id)).all()
    routes = session.exec(select(RouteLog).where(RouteLog.venue_id == v.id)).all()
    loc_logs = session.exec(select(LocalizeLog).where(LocalizeLog.venue_id == v.id)).all()
    searches = session.exec(select(SearchLog).where(SearchLog.venue_id == v.id)).all()

    today = datetime.now(timezone.utc).date()
    routes_today = sum(1 for r in routes if r.created_at.date() == today)

    confirmed = [l for l in loc_logs if l.confirmed_node]
    acc = (
        round(sum(1 for l in confirmed if l.predicted_node == l.confirmed_node) / len(confirmed), 3)
        if confirmed
        else 1.0
    )

    nodes_with_photos = len({p.node_id for p in photos})

    dest_counts = Counter(r.to_node for r in routes)
    top_destinations = [
        {"node_id": nid, "name": node_map[nid].name if nid in node_map else nid, "count": cnt}
        for nid, cnt in dest_counts.most_common(6)
    ]

    failed_counts = Counter(s.query.lower() for s in searches if s.results == 0)
    failed_searches = [{"query": q, "count": cnt} for q, cnt in failed_counts.most_common(6)]

    # Anonymous crowd activity from route traversal + recent localizations
    traversal = Counter()
    for r in routes[-80:]:
        for nid in r.path.split():
            traversal[nid] += 1
    for l in loc_logs[-40:]:
        if l.predicted_node:
            traversal[l.predicted_node] += 2

    crowd = []
    for nid, cnt in traversal.most_common(8):
        if nid not in node_map:
            continue
        nd = node_map[nid]
        crowd.append({
            "node_id": nid,
            "name": nd.name,
            "level": nd.level,
            "count": cnt,
        })

    hourly = [0] * 24
    for r in routes:
        hourly[r.created_at.hour % 24] += 1

    recent_locs = sorted(loc_logs, key=lambda l: l.created_at, reverse=True)[:8]
    recent_out = [
        {
            "id": l.id,
            "predicted_name": node_map[l.predicted_node].name if (l.predicted_node and l.predicted_node in node_map) else "No match",
            "confirmed_name": node_map[l.confirmed_node].name if (l.confirmed_node and l.confirmed_node in node_map) else None,
            "confidence": l.confidence,
            "created_at": l.created_at.isoformat(),
            "photo_url": f"/media/{l.photo_path}",
        }
        for l in recent_locs
    ]

    return {
        "stats": {
            "routes_total": len(routes),
            "routes_today": routes_today,
            "localizations": len(loc_logs),
            "localization_accuracy": acc,
            "photos": len(photos),
            "nodes_with_photos": nodes_with_photos,
            "nodes_total": len(nodes),
            "people": len(people),
        },
        "top_destinations": top_destinations,
        "failed_searches": failed_searches,
        "crowd": crowd,
        "hourly": hourly,
        "recent_localizations": recent_out,
    }


@router.get("/admin/venues/{slug}/dataset")
def admin_dataset(
    slug: str,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == v.id)).all()}
    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()

    by_node: dict[str, list[Photo]] = {n.id: [] for n in nodes}
    for p in photos:
        by_node.setdefault(p.node_id, []).append(p)

    nodes_out = []
    covered = 0
    for n in nodes:
        p_list = by_node.get(n.id, [])
        cnt = len(p_list)
        if cnt >= 3:
            cov = "good"
            covered += 1
        elif cnt >= 1:
            cov = "low"
            covered += 1
        else:
            cov = "none"
        nodes_out.append({
            "node_id": n.id,
            "name": n.name,
            "kind": n.kind,
            "level": n.level,
            "building_name": buildings.get(n.building_id, ""),
            "x": n.x,
            "y": n.y,
            "photo_count": cnt,
            "coverage": cov,
            "photos": [
                {"id": p.id, "url": f"/media/{p.path}", "source": p.source, "quality": p.quality}
                for p in p_list
            ],
        })

    return {
        "embedder": embedder_service.name,
        "totals": {"photos": len(photos), "nodes": len(nodes), "covered": covered},
        "nodes": nodes_out,
    }


@router.post("/admin/venues/{slug}/photos")
async def admin_upload_photos(
    slug: str,
    node_id: str = Form(...),
    files: List[UploadFile] = File(...),
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    node = session.exec(select(Node).where(Node.id == node_id, Node.venue_id == v.id)).first()
    if not node:
        raise HTTPException(status_code=400, detail="Invalid node_id")

    existing_photos = session.exec(select(Photo).where(Photo.node_id == node.id)).all()
    existing_vecs = [
        embedder_service.from_bytes(p.embedding)
        for p in existing_photos
        if p.embedding is not None
    ]

    accepted = []
    rejected = []

    for f in files:
        fname = f.filename or "photo.jpg"
        raw = await f.read()
        if not raw:
            rejected.append({"filename": fname, "reason": "Empty file"})
            continue

        rel_path = f"venues/{v.slug}/photos/{uuid.uuid4().hex[:12]}.jpg"
        dest_path = MEDIA_DIR / rel_path
        try:
            img, _ = save_clean_image(raw, dest_path, max_side=1024)
            vec = embedder_service.embed(img)
            ok, q_score, reason = validate_dataset_photo(img, vec, existing_vecs)
            if not ok:
                dest_path.unlink(missing_ok=True)
                rejected.append({"filename": fname, "reason": reason or "Quality check failed"})
                continue

            ocr_toks = ocr_service.extract_text(img)
            p_row = Photo(
                venue_id=v.id,
                node_id=node.id,
                path=rel_path,
                source="admin",
                quality=q_score,
                embedding=embedder_service.to_bytes(vec),
                embedder=embedder_service.name,
                ocr_text=" ".join(ocr_toks),
            )
            session.add(p_row)
            session.flush()
            existing_vecs.append(vec)
            accepted.append({"id": p_row.id, "url": f"/media/{rel_path}", "quality": q_score})
        except Exception as exc:  # noqa: BLE001
            dest_path.unlink(missing_ok=True)
            rejected.append({"filename": fname, "reason": f"Invalid image ({exc})"})

    session.commit()
    return {"accepted": accepted, "rejected": rejected}


@router.delete("/admin/photos/{photo_id}")
def admin_delete_photo(
    photo_id: str,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    p = session.exec(select(Photo).where(Photo.id == photo_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Photo not found")
    (MEDIA_DIR / p.path).unlink(missing_ok=True)
    session.delete(p)
    session.commit()
    return {"ok": True}


@router.post("/admin/venues/{slug}/index/rebuild")
def admin_rebuild_index(
    slug: str,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    return rebuild_venue_index(session, v, force=True)


@router.get("/admin/venues/{slug}/index/report")
def admin_get_index_report(
    slug: str,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    return get_latest_report(session, v.id)


class CreatePersonPayload(BaseModel):
    name: str
    role: str = "Doctor"
    title: str = ""
    department: str = ""
    node_id: str
    schedule: str = "Mon–Sat · 09:00 – 17:00"


@router.post("/admin/venues/{slug}/people")
def admin_create_person(
    slug: str,
    payload: CreatePersonPayload,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    node_map = {n.id: n for n in session.exec(select(Node).where(Node.venue_id == v.id)).all()}
    if payload.node_id not in node_map:
        raise HTTPException(status_code=400, detail="Invalid node_id")
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == v.id)).all()}

    person = Person(
        venue_id=v.id,
        name=payload.name.strip(),
        role=payload.role.strip(),
        title=payload.title.strip(),
        department=payload.department.strip(),
        node_id=payload.node_id,
        schedule=payload.schedule.strip(),
        status="available",
    )
    session.add(person)
    session.commit()
    session.refresh(person)
    return serialize_person(person, node_map, buildings)


class UpdatePersonPayload(BaseModel):
    status: Optional[str] = None
    status_note: Optional[str] = None
    target_node_id: Optional[str] = None


@router.patch("/admin/people/{person_id}")
def admin_update_person(
    person_id: str,
    payload: UpdatePersonPayload,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    person = session.exec(select(Person).where(Person.id == person_id)).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    if payload.status in ("available", "busy", "leave", "moved"):
        person.status = payload.status
    if payload.status_note is not None:
        person.status_note = payload.status_note
    if payload.target_node_id is not None:
        person.moved_to_node_id = payload.target_node_id if person.status == "moved" else None
    elif person.status != "moved":
        person.moved_to_node_id = None

    session.add(person)
    session.commit()
    session.refresh(person)

    node_map = {n.id: n for n in session.exec(select(Node).where(Node.venue_id == person.venue_id)).all()}
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == person.venue_id)).all()}
    return serialize_person(person, node_map, buildings)


@router.get("/admin/venues/{slug}/closures")
def admin_list_closures(
    slug: str,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    closures = session.exec(select(Closure).where(Closure.venue_id == v.id)).all()
    edges = {e.id: e for e in session.exec(select(Edge).where(Edge.venue_id == v.id)).all()}
    nodes = {n.id: n.name for n in session.exec(select(Node).where(Node.venue_id == v.id)).all()}

    out = []
    for c in closures:
        e = edges.get(c.edge_id)
        if not e:
            continue
        out.append({
            "id": c.id,
            "edge_id": c.edge_id,
            "source": e.source,
            "target": e.target,
            "source_name": nodes.get(e.source, e.source),
            "target_name": nodes.get(e.target, e.target),
            "reason": c.reason,
        })
    return out


class CreateClosurePayload(BaseModel):
    edge_id: str
    reason: str = "Closed for maintenance"


@router.post("/admin/venues/{slug}/closures")
def admin_create_closure(
    slug: str,
    payload: CreateClosurePayload,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    edge = session.exec(select(Edge).where(Edge.id == payload.edge_id, Edge.venue_id == v.id)).first()
    if not edge:
        raise HTTPException(status_code=400, detail="Invalid edge_id")

    existing = session.exec(select(Closure).where(Closure.edge_id == edge.id, Closure.venue_id == v.id)).first()
    if existing:
        existing.reason = payload.reason
        session.add(existing)
        session.commit()
        session.refresh(existing)
        c = existing
    else:
        c = Closure(venue_id=v.id, edge_id=edge.id, reason=payload.reason)
        session.add(c)
        session.commit()
        session.refresh(c)

    nodes = {n.id: n.name for n in session.exec(select(Node).where(Node.venue_id == v.id)).all()}
    return {
        "id": c.id,
        "edge_id": c.edge_id,
        "source": edge.source,
        "target": edge.target,
        "source_name": nodes.get(edge.source, edge.source),
        "target_name": nodes.get(edge.target, edge.target),
        "reason": c.reason,
    }


@router.delete("/admin/closures/{closure_id}")
def admin_delete_closure(
    closure_id: str,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    c = session.exec(select(Closure).where(Closure.id == closure_id)).first()
    if not c:
        raise HTTPException(status_code=404, detail="Closure not found")
    session.delete(c)
    session.commit()
    return {"ok": True}

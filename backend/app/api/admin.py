from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import io
import math
import re
import shutil
import time
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import (
    LOCKOUT_SECONDS,
    MAX_FAILED_LOGINS,
    assert_venue_write_access,
    create_token,
    hash_password,
    require_admin,
    validate_password_strength,
    verify_password,
)
from ..config import MEDIA_DIR
from ..db import get_session
from ..models import (
    Building,
    Closure,
    Edge,
    Floor,
    IndexReport,
    LocalizeLog,
    Node,
    Person,
    Photo,
    RouteLog,
    SearchLog,
    User,
    Venue,
)
from ..services.routing import compute_venue_route
from ..services.vision.embedder import embedder_service
from ..services.vision.indexer import get_latest_report, rebuild_venue_index
from ..services.vision.localizer import _ocr_match_score
from ..services.vision.ocr import ocr_service
from ..services.vision.privacy import save_clean_image
from ..services.vision.quality import compute_sharpness_quality, validate_dataset_photo
from .public import get_venue_or_404, serialize_person, serialize_venue_summary

router = APIRouter()


def _serialize_user(user: User) -> dict:
    created_iso = (
        user.created_at.isoformat()
        if isinstance(user.created_at, datetime)
        else str(user.created_at or "")
    )
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "organization": user.organization or "",
        "bio": user.bio or "",
        "avatar_color": user.avatar_color or "#0ea5e9",
        "token_version": int(user.token_version or 1),
        "created_at": created_iso,
    }


def _slugify(raw: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", raw.strip().lower()).strip("-")
    return s[:48] or f"venue-{uuid.uuid4().hex[:6]}"


# ============================================================================
# 1. AUTHENTICATION, SECURE UPLOADER REGISTRATION & PROFILE VAULT
# ============================================================================

class LoginPayload(BaseModel):
    email: str
    password: str


class RegisterPayload(BaseModel):
    name: str
    email: str
    password: str
    organization: str = ""
    bio: str = ""
    account_type: str = "uploader"  # "uploader" | "staff"


@router.post("/auth/register")
def register_uploader(payload: RegisterPayload, session: Session = Depends(get_session)):
    email = payload.email.strip().lower()
    name = payload.name.strip()
    if not name or len(name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name (at least 2 characters).")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    pw_err = validate_password_strength(payload.password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists. Please sign in.")

    role = "staff" if payload.account_type == "staff" else "uploader"
    palette = ["#0ea5e9", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"]
    color = palette[len(email) % len(palette)]

    user = User(
        email=email,
        name=name,
        role=role,
        password_hash=hash_password(payload.password),
        organization=payload.organization.strip()[:120],
        bio=payload.bio.strip()[:280],
        avatar_color=color,
        token_version=1,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return {
        "token": create_token(user),
        "user": _serialize_user(user),
    }


@router.post("/auth/login")
def login(payload: LoginPayload, session: Session = Depends(get_session)):
    email = payload.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    now = time.time()
    if user.locked_until and user.locked_until > now:
        wait_s = int(math.ceil(user.locked_until - now))
        raise HTTPException(
            status_code=429,
            detail=f"Account temporarily locked after repeated failed attempts. Try again in {wait_s}s.",
        )

    if not verify_password(payload.password, user.password_hash):
        user.failed_attempts = int(user.failed_attempts or 0) + 1
        if user.failed_attempts >= MAX_FAILED_LOGINS:
            user.locked_until = now + LOCKOUT_SECONDS
            user.failed_attempts = 0
            session.add(user)
            session.commit()
            raise HTTPException(
                status_code=429,
                detail="Too many failed password attempts. Account locked for 5 minutes for your security.",
            )
        session.add(user)
        session.commit()
        remaining = MAX_FAILED_LOGINS - user.failed_attempts
        raise HTTPException(
            status_code=401,
            detail=f"Invalid email or password ({remaining} attempt{'s' if remaining != 1 else ''} remaining before cooldown).",
        )

    if user.failed_attempts or user.locked_until:
        user.failed_attempts = 0
        user.locked_until = None
        session.add(user)
        session.commit()

    return {
        "token": create_token(user),
        "user": _serialize_user(user),
    }


@router.get("/auth/me")
def get_my_profile(
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if user.role == "admin":
        owned_venues = session.exec(select(Venue)).all()
    else:
        owned_venues = session.exec(select(Venue).where(Venue.owner_id == user.id)).all()

    owned_ids = {v.id for v in owned_venues}
    my_photos = session.exec(select(Photo).where(Photo.uploaded_by_id == user.id)).all()
    if not my_photos and owned_ids:
        my_photos = [
            p for p in session.exec(select(Photo)).all()
            if p.venue_id in owned_ids and p.source in ("admin", "uploader")
        ]

    nodes_mapped = 0
    if owned_ids:
        nodes_mapped = sum(
            1 for n in session.exec(select(Node)).all() if n.venue_id in owned_ids
        )

    avg_q = (
        round(sum(p.quality for p in my_photos) / len(my_photos), 3)
        if my_photos
        else 1.0
    )

    return {
        "user": _serialize_user(user),
        "stats": {
            "venues_created": len(owned_venues),
            "nodes_mapped": nodes_mapped,
            "photos_uploaded": len(my_photos),
            "avg_photo_quality": avg_q,
        },
        "venues": [serialize_venue_summary(session, v) for v in owned_venues],
    }


class UpdateProfilePayload(BaseModel):
    name: Optional[str] = None
    organization: Optional[str] = None
    bio: Optional[str] = None
    avatar_color: Optional[str] = None


@router.patch("/auth/profile")
def update_my_profile(
    payload: UpdateProfilePayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if payload.name is not None:
        nm = payload.name.strip()
        if len(nm) < 2:
            raise HTTPException(status_code=400, detail="Name must be at least 2 characters.")
        user.name = nm[:80]
        # Sync creator attribution across owned venues
        for v in session.exec(select(Venue).where(Venue.owner_id == user.id)).all():
            v.owner_name = user.name
            session.add(v)
    if payload.organization is not None:
        user.organization = payload.organization.strip()[:120]
    if payload.bio is not None:
        user.bio = payload.bio.strip()[:280]
    if payload.avatar_color is not None and re.match(r"^#[0-9a-fA-F]{6}$", payload.avatar_color.strip()):
        user.avatar_color = payload.avatar_color.strip()

    session.add(user)
    session.commit()
    session.refresh(user)
    return {"user": _serialize_user(user)}


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


@router.post("/auth/change-password")
def change_password(
    payload: ChangePasswordPayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    pw_err = validate_password_strength(payload.new_password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)

    user.password_hash = hash_password(payload.new_password)
    user.token_version = int(user.token_version or 1) + 1
    session.add(user)
    session.commit()
    session.refresh(user)

    return {
        "token": create_token(user),
        "user": _serialize_user(user),
    }


@router.post("/auth/revoke-sessions")
def revoke_other_sessions(
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    user.token_version = int(user.token_version or 1) + 1
    session.add(user)
    session.commit()
    session.refresh(user)
    return {
        "token": create_token(user),
        "user": _serialize_user(user),
    }


# ============================================================================
# 2. TENANT-ISOLATED STUDIO VENUES & NO-CODE MAP BUILDER
# ============================================================================

@router.get("/admin/venues")
def admin_list_accessible_venues(
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if user.role in ("admin", "staff"):
        venues = session.exec(select(Venue)).all()
    else:
        venues = session.exec(select(Venue).where(Venue.owner_id == user.id)).all()
    return [serialize_venue_summary(session, v) for v in venues]


class CreateVenuePayload(BaseModel):
    name: str
    slug: Optional[str] = None
    type: str = "campus"
    city: str = ""
    tagline: str = ""
    description: str = ""
    accent: str = "#0ea5e9"
    initial_building_name: str = "Main Building"
    initial_floor_name: str = "Ground Floor"


@router.post("/admin/venues")
def admin_create_venue(
    payload: CreateVenuePayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if user.role == "staff":
        raise HTTPException(status_code=403, detail="Staff accounts cannot create new venues. Register an Uploader account.")

    name = payload.name.strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Venue name must be at least 3 characters.")

    base_slug = _slugify(payload.slug or name)
    slug = base_slug
    suffix = 2
    while session.exec(select(Venue).where(Venue.slug == slug)).first() is not None:
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    vtype = payload.type if payload.type in ("hospital", "campus", "mall", "office") else "campus"
    accent = payload.accent if re.match(r"^#[0-9a-fA-F]{6}$", payload.accent) else "#0ea5e9"

    v = Venue(
        slug=slug,
        name=name,
        type=vtype,
        city=payload.city.strip(),
        tagline=payload.tagline.strip() or f"Zero-hardware indoor photo navigation for {name}",
        description=payload.description.strip(),
        accent=accent,
        owner_id=user.id,
        owner_name=user.name,
    )
    session.add(v)
    session.flush()

    b_id = f"{v.id[:6]}:b1"
    b = Building(
        id=b_id,
        venue_id=v.id,
        name=payload.initial_building_name.strip() or "Main Building",
        x=10,
        y=10,
        w=80,
        d=52,
    )
    session.add(b)

    f_id = f"{b_id}:f0"
    fl = Floor(
        id=f_id,
        venue_id=v.id,
        building_id=b_id,
        level=0,
        name=payload.initial_floor_name.strip() or "Ground Floor",
    )
    session.add(fl)

    # Create a single clean Entrance anchor node (NO demo or fake photos!)
    ent_id = f"{v.id[:6]}:entrance"
    ent = Node(
        id=ent_id,
        venue_id=v.id,
        building_id=b_id,
        floor_id=f_id,
        level=0,
        name="Main Entrance",
        kind="entrance",
        category="transit",
        x=50.0,
        y=56.0,
        keywords="main gate entrance lobby entry exit",
        is_place=True,
    )
    session.add(ent)
    v.entrance_node_id = ent_id
    v.emergency_node_id = ent_id
    session.add(v)
    session.commit()
    session.refresh(v)

    return serialize_venue_summary(session, v)


class UpdateVenuePayload(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    city: Optional[str] = None
    tagline: Optional[str] = None
    description: Optional[str] = None
    accent: Optional[str] = None
    entrance_node_id: Optional[str] = None
    emergency_node_id: Optional[str] = None


@router.patch("/admin/venues/{slug}")
def admin_update_venue(
    slug: str,
    payload: UpdateVenuePayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    if payload.name is not None and len(payload.name.strip()) >= 2:
        v.name = payload.name.strip()
    if payload.type in ("hospital", "campus", "mall", "office"):
        v.type = payload.type  # type: ignore[assignment]
    if payload.city is not None:
        v.city = payload.city.strip()
    if payload.tagline is not None:
        v.tagline = payload.tagline.strip()
    if payload.description is not None:
        v.description = payload.description.strip()
    if payload.accent is not None and re.match(r"^#[0-9a-fA-F]{6}$", payload.accent):
        v.accent = payload.accent
    if payload.entrance_node_id is not None:
        v.entrance_node_id = payload.entrance_node_id or None
    if payload.emergency_node_id is not None:
        v.emergency_node_id = payload.emergency_node_id or None

    session.add(v)
    session.commit()
    session.refresh(v)
    return serialize_venue_summary(session, v)


@router.post("/admin/venues/{slug}/cover")
async def admin_upload_venue_cover(
    slug: str,
    file: UploadFile = File(...),
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded cover image is empty")

    rel_path = f"venues/{v.slug}/cover_{uuid.uuid4().hex[:8]}.jpg"
    dest_path = MEDIA_DIR / rel_path
    save_clean_image(raw, dest_path, max_side=1280)

    if v.cover_path:
        (MEDIA_DIR / v.cover_path).unlink(missing_ok=True)
    v.cover_path = rel_path
    session.add(v)
    session.commit()
    session.refresh(v)
    return serialize_venue_summary(session, v)


@router.delete("/admin/venues/{slug}")
def admin_delete_venue(
    slug: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    for model in (Photo, Closure, Edge, Person, Node, Floor, Building, LocalizeLog, RouteLog, SearchLog, IndexReport):
        for row in session.exec(select(model).where(model.venue_id == v.id)).all():  # type: ignore[attr-defined]
            session.delete(row)

    venue_media = MEDIA_DIR / "venues" / v.slug
    if venue_media.exists():
        shutil.rmtree(venue_media, ignore_errors=True)

    session.delete(v)
    session.commit()
    return {"ok": True}


class CreateBuildingPayload(BaseModel):
    name: str
    x: float = 10.0
    y: float = 10.0
    w: float = 70.0
    d: float = 45.0
    initial_level: int = 0
    initial_floor_name: str = "Ground Floor"


@router.post("/admin/venues/{slug}/buildings")
def admin_create_building(
    slug: str,
    payload: CreateBuildingPayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    b_id = f"{v.id[:6]}:b_{uuid.uuid4().hex[:6]}"
    b = Building(
        id=b_id,
        venue_id=v.id,
        name=payload.name.strip() or "New Building",
        x=payload.x,
        y=payload.y,
        w=max(10.0, payload.w),
        d=max(10.0, payload.d),
    )
    session.add(b)

    f_id = f"{b_id}:f_{payload.initial_level}"
    fl = Floor(
        id=f_id,
        venue_id=v.id,
        building_id=b_id,
        level=payload.initial_level,
        name=payload.initial_floor_name.strip() or f"Floor {payload.initial_level}",
    )
    session.add(fl)
    session.commit()

    return {
        "id": b.id,
        "name": b.name,
        "x": b.x,
        "y": b.y,
        "w": b.w,
        "d": b.d,
        "floors": [{"id": fl.id, "level": fl.level, "name": fl.name, "blueprint_url": None}],
    }


class UpdateBuildingPayload(BaseModel):
    name: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    d: Optional[float] = None


@router.patch("/admin/buildings/{building_id}")
def admin_update_building(
    building_id: str,
    payload: UpdateBuildingPayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    b = session.exec(select(Building).where(Building.id == building_id)).first()
    if not b:
        raise HTTPException(status_code=404, detail="Building not found")
    v = session.exec(select(Venue).where(Venue.id == b.venue_id)).first()
    if not v:
        raise HTTPException(status_code=404, detail="Venue not found")
    assert_venue_write_access(user, v)

    if payload.name is not None and payload.name.strip():
        b.name = payload.name.strip()
    if payload.x is not None:
        b.x = payload.x
    if payload.y is not None:
        b.y = payload.y
    if payload.w is not None:
        b.w = max(8.0, payload.w)
    if payload.d is not None:
        b.d = max(8.0, payload.d)

    session.add(b)
    session.commit()
    return {"ok": True}


class CreateFloorPayload(BaseModel):
    building_id: str
    level: int
    name: str = ""


@router.post("/admin/venues/{slug}/floors")
def admin_create_floor(
    slug: str,
    payload: CreateFloorPayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    b = session.exec(select(Building).where(Building.id == payload.building_id, Building.venue_id == v.id)).first()
    if not b:
        raise HTTPException(status_code=400, detail="Invalid building_id")

    existing = session.exec(
        select(Floor).where(Floor.building_id == b.id, Floor.level == payload.level)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Level {payload.level} already exists in {b.name}")

    default_name = (
        "Ground Floor"
        if payload.level == 0
        else (f"Basement {abs(payload.level)}" if payload.level < 0 else f"Floor {payload.level}")
    )
    f_id = f"{b.id}:f_{uuid.uuid4().hex[:5]}"
    fl = Floor(
        id=f_id,
        venue_id=v.id,
        building_id=b.id,
        level=payload.level,
        name=payload.name.strip() or default_name,
    )
    session.add(fl)
    session.commit()
    return {"id": fl.id, "level": fl.level, "name": fl.name, "blueprint_url": None}


@router.post("/admin/floors/{floor_id}/blueprint")
async def admin_upload_floor_blueprint(
    floor_id: str,
    file: UploadFile = File(...),
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    fl = session.exec(select(Floor).where(Floor.id == floor_id)).first()
    if not fl:
        raise HTTPException(status_code=404, detail="Floor not found")
    v = session.exec(select(Venue).where(Venue.id == fl.venue_id)).first()
    if not v:
        raise HTTPException(status_code=404, detail="Venue not found")
    assert_venue_write_access(user, v)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded blueprint file is empty")

    rel_path = f"venues/{v.slug}/blueprints/{uuid.uuid4().hex[:10]}.jpg"
    dest_path = MEDIA_DIR / rel_path
    save_clean_image(raw, dest_path, max_side=1600)

    if fl.blueprint_path:
        (MEDIA_DIR / fl.blueprint_path).unlink(missing_ok=True)
    fl.blueprint_path = rel_path
    session.add(fl)
    session.commit()
    return {"ok": True, "blueprint_url": f"/media/{rel_path}"}


class CreateNodePayload(BaseModel):
    building_id: str
    floor_id: str
    name: str
    kind: str = "room"
    category: Optional[str] = "department"
    x: float
    y: float
    keywords: str = ""
    is_place: bool = True


@router.post("/admin/venues/{slug}/nodes")
def admin_create_node(
    slug: str,
    payload: CreateNodePayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    fl = session.exec(select(Floor).where(Floor.id == payload.floor_id, Floor.venue_id == v.id)).first()
    if not fl:
        raise HTTPException(status_code=400, detail="Invalid floor_id")
    b = session.exec(select(Building).where(Building.id == fl.building_id, Building.venue_id == v.id)).first()
    if not b:
        raise HTTPException(status_code=400, detail="Invalid building_id")

    n_id = f"{v.id[:6]}:n_{uuid.uuid4().hex[:8]}"
    n = Node(
        id=n_id,
        venue_id=v.id,
        building_id=b.id,
        floor_id=fl.id,
        level=fl.level,
        name=payload.name.strip() or "Unnamed Spot",
        kind=payload.kind.strip().lower() or "room",
        category=(payload.category.strip().lower() if payload.category else None),
        x=round(float(payload.x), 2),
        y=round(float(payload.y), 2),
        keywords=payload.keywords.strip(),
        is_place=payload.is_place,
    )
    session.add(n)

    if not v.entrance_node_id and n.kind in ("entrance", "exit"):
        v.entrance_node_id = n.id
        session.add(v)
    if not v.emergency_node_id and n.kind in ("emergency", "exit"):
        v.emergency_node_id = n.id
        session.add(v)

    session.commit()
    session.refresh(n)
    return {
        "id": n.id,
        "name": n.name,
        "kind": n.kind,
        "category": n.category,
        "building_id": n.building_id,
        "building_name": b.name,
        "floor_id": n.floor_id,
        "level": n.level,
        "floor_name": fl.name,
        "x": n.x,
        "y": n.y,
        "keywords": n.keywords,
        "is_place": n.is_place,
        "photo_url": None,
        "photo_count": 0,
    }


class UpdateNodePayload(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    category: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    keywords: Optional[str] = None
    is_place: Optional[bool] = None


@router.patch("/admin/nodes/{node_id}")
def admin_update_node(
    node_id: str,
    payload: UpdateNodePayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    n = session.exec(select(Node).where(Node.id == node_id)).first()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")
    v = session.exec(select(Venue).where(Venue.id == n.venue_id)).first()
    if not v:
        raise HTTPException(status_code=404, detail="Venue not found")
    assert_venue_write_access(user, v)

    moved = False
    if payload.name is not None and payload.name.strip():
        n.name = payload.name.strip()
    if payload.kind is not None and payload.kind.strip():
        n.kind = payload.kind.strip().lower()
    if payload.category is not None:
        n.category = payload.category.strip().lower() or None
    if payload.x is not None:
        n.x = round(float(payload.x), 2)
        moved = True
    if payload.y is not None:
        n.y = round(float(payload.y), 2)
        moved = True
    if payload.keywords is not None:
        n.keywords = payload.keywords.strip()
    if payload.is_place is not None:
        n.is_place = payload.is_place

    session.add(n)

    if moved:
        node_map = {nd.id: nd for nd in session.exec(select(Node).where(Node.venue_id == v.id)).all()}
        node_map[n.id] = n
        edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
        for e in edges:
            if e.source == n.id or e.target == n.id:
                s = node_map.get(e.source)
                t = node_map.get(e.target)
                if s and t and s.level == t.level and e.kind in ("walk", "door", "outdoor"):
                    e.distance = round(max(1.5, math.hypot(s.x - t.x, s.y - t.y)), 1)
                    session.add(e)

    session.commit()
    return {"ok": True, "x": n.x, "y": n.y}


@router.delete("/admin/nodes/{node_id}")
def admin_delete_node(
    node_id: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    n = session.exec(select(Node).where(Node.id == node_id)).first()
    if not n:
        raise HTTPException(status_code=404, detail="Node not found")
    v = session.exec(select(Venue).where(Venue.id == n.venue_id)).first()
    if not v:
        raise HTTPException(status_code=404, detail="Venue not found")
    assert_venue_write_access(user, v)

    for p in session.exec(select(Photo).where(Photo.node_id == n.id)).all():
        (MEDIA_DIR / p.path).unlink(missing_ok=True)
        session.delete(p)

    edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
    del_edge_ids = set()
    for e in edges:
        if e.source == n.id or e.target == n.id:
            del_edge_ids.add(e.id)
            session.delete(e)

    if del_edge_ids:
        for c in session.exec(select(Closure).where(Closure.venue_id == v.id)).all():
            if c.edge_id in del_edge_ids:
                session.delete(c)

    if v.entrance_node_id == n.id:
        v.entrance_node_id = None
        session.add(v)
    if v.emergency_node_id == n.id:
        v.emergency_node_id = None
        session.add(v)

    session.delete(n)
    session.commit()
    return {"ok": True}


class CreateEdgePayload(BaseModel):
    source: str
    target: str
    kind: str = "walk"
    distance: Optional[float] = None
    accessible: bool = True
    stretcher_ok: bool = True


@router.post("/admin/venues/{slug}/edges")
def admin_create_edge(
    slug: str,
    payload: CreateEdgePayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    if payload.source == payload.target:
        raise HTTPException(status_code=400, detail="Cannot connect a node to itself")

    s = session.exec(select(Node).where(Node.id == payload.source, Node.venue_id == v.id)).first()
    t = session.exec(select(Node).where(Node.id == payload.target, Node.venue_id == v.id)).first()
    if not s or not t:
        raise HTTPException(status_code=400, detail="Source or target node not found in this venue")

    existing_edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
    for ex in existing_edges:
        if {ex.source, ex.target} == {s.id, t.id}:
            raise HTTPException(status_code=409, detail="A connection already exists between these two nodes")

    kind = payload.kind if payload.kind in ("walk", "door", "stairs", "lift", "outdoor") else "walk"
    if s.level != t.level and kind not in ("lift", "stairs"):
        kind = "lift" if payload.accessible else "stairs"

    if payload.distance is not None and payload.distance > 0:
        dist = round(float(payload.distance), 1)
    elif s.level != t.level:
        dist = round(6.0 * abs(s.level - t.level), 1)
    else:
        dist = round(max(2.0, math.hypot(s.x - t.x, s.y - t.y)), 1)

    accessible = False if kind == "stairs" else payload.accessible
    stretcher_ok = False if (kind == "stairs" or not accessible) else payload.stretcher_ok

    e = Edge(
        venue_id=v.id,
        source=s.id,
        target=t.id,
        distance=dist,
        kind=kind,
        accessible=accessible,
        stretcher_ok=stretcher_ok,
    )
    session.add(e)
    session.commit()
    session.refresh(e)

    return {
        "id": e.id,
        "source": e.source,
        "target": e.target,
        "distance": e.distance,
        "kind": e.kind,
        "accessible": e.accessible,
        "stretcher_ok": e.stretcher_ok,
        "closed": False,
    }


@router.delete("/admin/edges/{edge_id}")
def admin_delete_edge(
    edge_id: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    e = session.exec(select(Edge).where(Edge.id == edge_id)).first()
    if not e:
        raise HTTPException(status_code=404, detail="Edge not found")
    v = session.exec(select(Venue).where(Venue.id == e.venue_id)).first()
    if not v:
        raise HTTPException(status_code=404, detail="Venue not found")
    assert_venue_write_access(user, v)

    for c in session.exec(select(Closure).where(Closure.edge_id == e.id)).all():
        session.delete(c)
    session.delete(e)
    session.commit()
    return {"ok": True}


# ============================================================================
# 3. ANALYTICS, PHOTO DATASET, HEADING, PEOPLE & CLOSURES
# ============================================================================

def _classify_node_decision_point(n: Node, degree: int) -> tuple[bool, str]:
    kind_low = (n.kind or "").lower()
    if kind_low in ("entrance", "exit", "emergency"):
        return True, "Entry / Emergency Exit"
    if kind_low in ("lift", "stairs", "escalator", "elevator"):
        return True, "Floor Transition (Lift / Stairs)"
    if degree >= 3 or kind_low == "junction":
        return True, f"{max(3, degree)}-Way Corridor Junction"
    if n.is_place and kind_low not in ("corridor", "hallway", "passage"):
        return True, "Destination Room / Department"
    return False, "Interpolated Straight Corridor (Photo Optional)"


@router.get("/admin/venues/{slug}/overview")
def admin_overview(
    slug: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v, allow_staff=True)

    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == v.id)).all()}
    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    node_map = {n.id: n for n in nodes}
    edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
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
    visitor_photos_count = sum(1 for p in photos if p.source == "visitor")

    dest_counts = Counter(r.to_node for r in routes)
    top_destinations = [
        {"node_id": nid, "name": node_map[nid].name if nid in node_map else nid, "count": cnt}
        for nid, cnt in dest_counts.most_common(6)
    ]

    failed_counts = Counter(s.query.lower() for s in searches if s.results == 0)
    failed_searches = [{"query": q, "count": cnt} for q, cnt in failed_counts.most_common(6)]

    traversal: Counter[str] = Counter()
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

    # Compute "Where Visitors Get Lost" — Confusion & Signage Hotspots
    deg_by_node: Counter[str] = Counter()
    for e in edges:
        deg_by_node[e.source] += 1
        deg_by_node[e.target] += 1
    photos_by_node: Counter[str] = Counter(p.node_id for p in photos)

    loc_confs: dict[str, list[float]] = {}
    mismatch_counts: Counter[str] = Counter()
    for l in loc_logs:
        target_nid = l.confirmed_node or l.predicted_node
        if target_nid:
            loc_confs.setdefault(target_nid, []).append(float(l.confidence))
        if l.confirmed_node and l.predicted_node and l.confirmed_node != l.predicted_node:
            mismatch_counts[l.confirmed_node] += 1

    hotspot_candidates = []
    for n in nodes:
        is_dp, dp_reason = _classify_node_decision_point(n, deg_by_node[n.id])
        p_cnt = photos_by_node[n.id]
        confs = loc_confs.get(n.id, [])
        low_conf_hits = sum(1 for c in confs if c < 0.68)
        mismatches = mismatch_counts[n.id]
        avg_conf = round(sum(confs) / len(confs), 2) if confs else (0.45 if p_cnt == 0 else 0.78)
        traffic = traversal[n.id]

        risk_score = (mismatches * 4) + (low_conf_hits * 3) + (3 if (is_dp and p_cnt == 0) else 0) + (2 if (is_dp and p_cnt == 1 and traffic >= 2) else 0) + min(3, traffic // 4)
        if risk_score <= 0 and not is_dp:
            continue

        if mismatches > 0:
            issue = f"{mismatches}× visitor corrected visual match"
            rec = "Place QR Checkpoint sticker & capture distinct signboard angle"
        elif low_conf_hits > 0:
            issue = f"{low_conf_hits}× low-confidence match ({int(avg_conf * 100)}% avg)"
            rec = "Identical walls — print QR Checkpoint or add opposite heading photo"
        elif is_dp and p_cnt == 0:
            issue = f"Unmapped {dp_reason}"
            rec = "Record 10s corridor walk-through or place QR Checkpoint sticker"
        elif is_dp and p_cnt < 2:
            issue = f"Single-angle coverage at {dp_reason}"
            rec = "Add 1 reverse-facing photo for bidirectional recognition"
        else:
            issue = f"High-traffic {dp_reason} ({traffic} traversals)"
            rec = "Monitor signage clarity & keep 3+ reference angles"

        hotspot_candidates.append({
            "risk": risk_score,
            "node_id": n.id,
            "name": n.name,
            "building_name": buildings.get(n.building_id, ""),
            "level": n.level,
            "photo_count": p_cnt,
            "low_conf_count": low_conf_hits + mismatches,
            "avg_confidence": avg_conf,
            "traffic": traffic,
            "issue": issue,
            "recommendation": rec,
        })

    hotspot_candidates.sort(key=lambda item: (item["risk"], item["traffic"], -item["photo_count"]), reverse=True)
    confusion_hotspots = [
        {k: v for k, v in h.items() if k != "risk"}
        for h in hotspot_candidates[:6]
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
            "active_learning_photos": visitor_photos_count,
        },
        "top_destinations": top_destinations,
        "failed_searches": failed_searches,
        "crowd": crowd,
        "hourly": hourly,
        "recent_localizations": recent_out,
        "confusion_hotspots": confusion_hotspots,
    }


@router.get("/admin/venues/{slug}/dataset")
def admin_dataset(
    slug: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v, allow_staff=True)

    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == v.id)).all()}
    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
    photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()

    deg_by_node: Counter[str] = Counter()
    for e in edges:
        deg_by_node[e.source] += 1
        deg_by_node[e.target] += 1

    by_node: dict[str, list[Photo]] = {n.id: [] for n in nodes}
    for p in photos:
        by_node.setdefault(p.node_id, []).append(p)

    nodes_out = []
    covered = 0
    decision_nodes = 0
    decision_covered = 0
    interpolated_nodes = 0
    visitor_contributed = sum(1 for p in photos if p.source == "visitor")

    for n in nodes:
        p_list = by_node.get(n.id, [])
        cnt = len(p_list)
        deg = deg_by_node[n.id]
        is_dp, dp_reason = _classify_node_decision_point(n, deg)
        if is_dp:
            decision_nodes += 1
            if cnt >= 1:
                decision_covered += 1
        else:
            interpolated_nodes += 1

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
            "is_decision_point": is_dp,
            "decision_reason": dp_reason,
            "degree": deg,
            "photos": [
                {
                    "id": p.id,
                    "url": f"/media/{p.path}",
                    "thumbnail_url": f"/media/{p.thumbnail_path}" if getattr(p, "thumbnail_path", None) else f"/media/{p.path}",
                    "media_type": getattr(p, "media_type", "photo") or "photo",
                    "duration_s": getattr(p, "duration_s", None),
                    "ocr_text": getattr(p, "ocr_text", "") or "",
                    "source": p.source,
                    "quality": p.quality,
                    "heading_deg": p.heading_deg,
                }
                for p in p_list
            ],
        })

    return {
        "embedder": embedder_service.name,
        "totals": {
            "photos": len(photos),
            "nodes": len(nodes),
            "covered": covered,
            "decision_nodes": decision_nodes,
            "decision_covered": decision_covered,
            "interpolated_nodes": interpolated_nodes,
            "visitor_contributed": visitor_contributed,
        },
        "nodes": nodes_out,
    }


@router.post("/admin/venues/{slug}/photos")
async def admin_upload_photos(
    slug: str,
    node_id: str = Form(...),
    heading_deg: Optional[float] = Form(default=None),
    files: List[UploadFile] = File(...),
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

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
    clean_heading = (float(heading_deg) % 360.0) if heading_deg is not None else None
    max_video_bytes = 25 * 1024 * 1024  # 25 MB max video limit

    for f in files:
        fname = f.filename or "photo.webp"
        raw = await f.read()
        if not raw:
            rejected.append({"filename": fname, "reason": "Empty file"})
            continue

        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        is_video = ext in ("mp4", "webm", "mov", "mkv", "avi") or (f.content_type or "").startswith("video/")

        if is_video:
            if len(raw) > max_video_bytes:
                rejected.append({
                    "filename": fname,
                    "reason": f"Video exceeds 25 MB limit ({round(len(raw) / (1024*1024), 1)} MB). Trim to 3-15 seconds.",
                })
                continue

            uid = uuid.uuid4().hex[:12]
            v_ext = "webm" if ext == "webm" else "mp4"
            rel_video_path = f"venues/{v.slug}/videos/{uid}.{v_ext}"
            rel_thumb_path = f"venues/{v.slug}/videos/{uid}_thumb.webp"
            dest_video = MEDIA_DIR / rel_video_path
            dest_thumb = MEDIA_DIR / rel_thumb_path
            dest_video.parent.mkdir(parents=True, exist_ok=True)

            try:
                dest_video.write_bytes(raw)
                duration_s = 0.0
                thumb_img = None

                # Extract keyframe thumbnail using OpenCV
                try:
                    import cv2
                    cap = cv2.VideoCapture(str(dest_video))
                    if cap.isOpened():
                        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
                        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
                        duration_s = round(total_frames / fps, 1) if fps > 0 else 0.0

                        # Seek to ~1 second or 25% of video for a representative keyframe
                        target_frame = int(min(fps, max(0, total_frames * 0.25)))
                        cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
                        ret, frame = cap.read()
                        if not ret:
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            ret, frame = cap.read()

                        if ret and frame is not None:
                            # Encode frame to JPEG buffer for save_clean_image pipeline
                            _, buf = cv2.imencode(".jpg", frame)
                            thumb_img, _ = save_clean_image(buf.tobytes(), dest_thumb, max_side=1600)
                        cap.release()
                except Exception:  # noqa: BLE001
                    pass

                # If OpenCV couldn't extract keyframe, create a fallback placeholder thumbnail
                if thumb_img is None:
                    from PIL import Image, ImageDraw
                    fallback = Image.new("RGB", (640, 360), color=(15, 23, 42))
                    d = ImageDraw.Draw(fallback)
                    d.text((40, 160), f"Walkthrough Video · {node.name}", fill=(56, 189, 248))
                    buf = io.BytesIO()
                    fallback.save(buf, format="WEBP", quality=85)
                    dest_thumb.write_bytes(buf.getvalue())
                    thumb_img = fallback

                vec = embedder_service.embed(thumb_img)
                ocr_toks = ocr_service.extract_text(thumb_img)

                p_row = Photo(
                    venue_id=v.id,
                    node_id=node.id,
                    path=rel_video_path,
                    source="uploader" if user.role == "uploader" else "admin",
                    quality=1.0,
                    embedding=embedder_service.to_bytes(vec),
                    embedder=embedder_service.name,
                    ocr_text=" ".join(ocr_toks),
                    heading_deg=clean_heading,
                    uploaded_by_id=user.id,
                    media_type="video",
                    thumbnail_path=rel_thumb_path,
                    duration_s=duration_s,
                )
                session.add(p_row)
                session.flush()
                accepted.append({
                    "id": p_row.id,
                    "url": f"/media/{rel_video_path}",
                    "thumbnail_url": f"/media/{rel_thumb_path}",
                    "media_type": "video",
                    "duration_s": duration_s,
                    "quality": 1.0,
                    "heading_deg": clean_heading,
                })
            except Exception as exc:  # noqa: BLE001
                dest_video.unlink(missing_ok=True)
                dest_thumb.unlink(missing_ok=True)
                rejected.append({"filename": fname, "reason": f"Video processing error ({exc})"})
            continue

        # Standard photo processing (WebP 1600px, high-DPI quality 90)
        rel_path = f"venues/{v.slug}/photos/{uuid.uuid4().hex[:12]}.webp"
        dest_path = MEDIA_DIR / rel_path
        try:
            img, _ = save_clean_image(raw, dest_path, max_side=1600)
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
                source="uploader" if user.role == "uploader" else "admin",
                quality=q_score,
                embedding=embedder_service.to_bytes(vec),
                embedder=embedder_service.name,
                ocr_text=" ".join(ocr_toks),
                heading_deg=clean_heading,
                uploaded_by_id=user.id,
                media_type="photo",
                thumbnail_path=None,
                duration_s=None,
            )
            session.add(p_row)
            session.flush()
            existing_vecs.append(vec)
            accepted.append({
                "id": p_row.id,
                "url": f"/media/{rel_path}",
                "media_type": "photo",
                "quality": q_score,
                "heading_deg": clean_heading,
            })
        except Exception as exc:  # noqa: BLE001
            dest_path.unlink(missing_ok=True)
            rejected.append({"filename": fname, "reason": f"Invalid image ({exc})"})

    session.commit()
    return {"accepted": accepted, "rejected": rejected}


class UpdatePhotoPayload(BaseModel):
    heading_deg: Optional[float] = None


@router.patch("/admin/photos/{photo_id}")
def admin_update_photo(
    photo_id: str,
    payload: UpdatePhotoPayload,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    p = session.exec(select(Photo).where(Photo.id == photo_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Photo not found")
    v = session.exec(select(Venue).where(Venue.id == p.venue_id)).first()
    if v:
        assert_venue_write_access(user, v)

    p.heading_deg = (float(payload.heading_deg) % 360.0) if payload.heading_deg is not None else None
    session.add(p)
    session.commit()
    return {"ok": True, "heading_deg": p.heading_deg}


@router.delete("/admin/photos/{photo_id}")
def admin_delete_photo(
    photo_id: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    p = session.exec(select(Photo).where(Photo.id == photo_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Photo not found")
    v = session.exec(select(Venue).where(Venue.id == p.venue_id)).first()
    if v:
        assert_venue_write_access(user, v)
    (MEDIA_DIR / p.path).unlink(missing_ok=True)
    if getattr(p, "thumbnail_path", None):
        (MEDIA_DIR / p.thumbnail_path).unlink(missing_ok=True)
    session.delete(p)
    session.commit()
    return {"ok": True}


@router.post("/admin/venues/{slug}/dataset/auto-map")
async def admin_auto_map_dataset(
    slug: str,
    mode: str = Form("route"),  # "route" | "ocr"
    from_node_id: Optional[str] = Form(default=None),
    to_node_id: Optional[str] = Form(default=None),
    level_filter: Optional[int] = Form(default=None),
    fallback_node_id: Optional[str] = Form(default=None),
    files: List[UploadFile] = File(...),
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    """
    Enterprise Hospital / Multi-Route Smart Auto-Mapper:
    1. Accepts a continuous corridor walk-through video (.mp4/.webm/.mov) OR a batch of photos/keyframes.
    2. Extracts sharp keyframes, strips EXIF, blurs faces, and compresses to lightweight 1600px WebP (~60 KB/frame),
       discarding bulky raw 4K video files to save 95%+ server disk space.
    3. Deduplicates stationary frames and rejects motion-blurred frames automatically.
    4. Auto-assigns each frame to the right node along a selected route path (interpolating distance + corridor compass heading)
       OR auto-tags across any floor/building by reading room signboards via RapidOCR + visual embedding similarity.
    """
    import numpy as np

    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

    all_nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    if not all_nodes:
        raise HTTPException(status_code=400, detail="Venue has no nodes to map to")
    node_map = {n.id: n for n in all_nodes}
    edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
    existing_photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()

    node_photo_texts: dict[str, list[str]] = {n.id: [] for n in all_nodes}
    node_vecs: dict[str, list[np.ndarray]] = {n.id: [] for n in all_nodes}
    for ep in existing_photos:
        if ep.ocr_text and ep.node_id in node_photo_texts:
            node_photo_texts[ep.node_id].append(ep.ocr_text)
        if ep.embedding and ep.node_id in node_vecs:
            node_vecs[ep.node_id].append(embedder_service.from_bytes(ep.embedding))

    # Build route path if mode == "route"
    route_path_ids: list[str] = []
    route_cum_dist: list[float] = []
    route_headings: list[Optional[float]] = []
    route_candidate_pool: list[Node] = []

    if mode == "route" and from_node_id and to_node_id:
        if from_node_id not in node_map or to_node_id not in node_map:
            raise HTTPException(status_code=400, detail="Invalid start or end node for route walk-through")
        try:
            r_data = compute_venue_route(session, v, from_node_id, to_node_id, record_log=False)
            route_path_ids = r_data.get("path", [from_node_id, to_node_id])
        except Exception:
            route_path_ids = [from_node_id, to_node_id]

        # Compute cumulative distance and compass heading at each node along the path
        cum = 0.0
        route_cum_dist.append(0.0)
        for idx in range(len(route_path_ids) - 1):
            na = node_map[route_path_ids[idx]]
            nb = node_map[route_path_ids[idx + 1]]
            seg_d = max(1.0, math.hypot(nb.x - na.x, nb.y - na.y))
            cum += seg_d
            route_cum_dist.append(cum)
            dx, dy = nb.x - na.x, nb.y - na.y
            hdg = round((math.degrees(math.atan2(dx, -dy)) + 360.0) % 360.0, 1) if math.hypot(dx, dy) > 1e-2 else None
            route_headings.append(hdg)
        route_headings.append(route_headings[-1] if route_headings else None)

        # Include route nodes + 1-hop adjacent rooms/doors along the corridor for OCR signboard matching
        adj_ids = set(route_path_ids)
        for e in edges:
            if e.source in adj_ids:
                adj_ids.add(e.target)
            elif e.target in adj_ids:
                adj_ids.add(e.source)
        route_candidate_pool = [node_map[nid] for nid in adj_ids if nid in node_map]
    else:
        route_candidate_pool = [
            n for n in all_nodes
            if level_filter is None or n.level == level_filter
        ] or all_nodes

    # Step 1: Unpack uploaded files (slice videos into sharp keyframes & collect raw bytes)
    raw_frames: list[tuple[str, bytes]] = []
    raw_bytes_total = 0
    saved_bytes_total = 0

    for f in files:
        fname = f.filename or "capture.webp"
        raw = await f.read()
        if not raw:
            continue
        raw_bytes_total += len(raw)
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        is_video = ext in ("mp4", "webm", "mov", "mkv", "avi") or (f.content_type or "").startswith("video/")

        if is_video:
            tmp_video = MEDIA_DIR / f"venues/{v.slug}/videos/tmp_{uuid.uuid4().hex[:10]}.{ext or 'mp4'}"
            tmp_video.parent.mkdir(parents=True, exist_ok=True)
            try:
                tmp_video.write_bytes(raw)
                import cv2
                cap = cv2.VideoCapture(str(tmp_video))
                if cap.isOpened():
                    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
                    total_f = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                    # Extract a frame every ~1.2 seconds (up to 28 keyframes per video)
                    step_f = max(int(fps * 1.2), max(1, total_f // 28)) if total_f > 0 else int(fps * 1.2)
                    frame_idx = 0
                    extracted = 0
                    while extracted < 28:
                        if total_f > 0 and frame_idx >= total_f:
                            break
                        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
                        ret, frame = cap.read()
                        if not ret or frame is None:
                            break
                        ok_enc, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                        if ok_enc:
                            t_sec = round(frame_idx / max(1.0, fps), 1)
                            raw_frames.append((f"{fname} @ {t_sec}s", buf.tobytes()))
                            extracted += 1
                        frame_idx += max(1, step_f)
                    cap.release()
            finally:
                tmp_video.unlink(missing_ok=True)
        else:
            raw_frames.append((fname, raw))

    accepted = []
    rejected = []
    touched_nodes: set[str] = set()
    last_accepted_vec: Optional[np.ndarray] = None

    total_frames_count = len(raw_frames)
    for idx, (label, frame_bytes) in enumerate(raw_frames):
        rel_path = f"venues/{v.slug}/photos/{uuid.uuid4().hex[:12]}.webp"
        dest_path = MEDIA_DIR / rel_path
        try:
            img, _ = save_clean_image(frame_bytes, dest_path, max_side=1600)
            q_score = compute_sharpness_quality(img)
            if q_score < 0.13:
                dest_path.unlink(missing_ok=True)
                rejected.append({"filename": label, "reason": f"Motion blur detected (sharpness {int(q_score*100)}%)"})
                continue

            vec = embedder_service.embed(img)
            # Deduplicate consecutive near-identical corridor frames
            if last_accepted_vec is not None and float(np.dot(vec, last_accepted_vec)) > 0.965:
                dest_path.unlink(missing_ok=True)
                rejected.append({"filename": label, "reason": "Duplicate stationary frame skipped"})
                continue

            ocr_toks = ocr_service.extract_text(img)

            # Match node via OCR signboard first
            best_ocr_node: Optional[Node] = None
            best_ocr_score = 0.0
            best_ocr_reason: Optional[str] = None
            for cand_n in route_candidate_pool:
                sc, mt = _ocr_match_score(ocr_toks, cand_n, node_photo_texts.get(cand_n.id, []))
                if sc > best_ocr_score:
                    best_ocr_score = sc
                    best_ocr_node = cand_n
                    best_ocr_reason = mt

            assigned_node: Optional[Node] = None
            assigned_heading: Optional[float] = None
            match_method = "Route Path Interpolation"

            if best_ocr_node is not None and best_ocr_score >= 0.72:
                assigned_node = best_ocr_node
                match_method = f"OCR Signboard ({best_ocr_reason or 'Text Match'})"
                if route_path_ids and assigned_node.id in route_path_ids:
                    r_idx = route_path_ids.index(assigned_node.id)
                    assigned_heading = route_headings[r_idx]
            elif mode == "route" and route_path_ids:
                # Interpolate along the route path by chronological frame progress
                u = idx / float(max(1, total_frames_count - 1))
                total_d = route_cum_dist[-1] if route_cum_dist else 0.0
                target_d = u * total_d
                chosen_i = 0
                best_d_diff = float("inf")
                for r_i, cd in enumerate(route_cum_dist):
                    if abs(cd - target_d) < best_d_diff:
                        best_d_diff = abs(cd - target_d)
                        chosen_i = r_i
                assigned_node = node_map[route_path_ids[chosen_i]]
                assigned_heading = route_headings[chosen_i]
                match_method = f"Walk Path Slot #{chosen_i + 1}/{len(route_path_ids)}"
            else:
                # Visual similarity against existing photos on candidate floor/venue
                best_vis_node: Optional[Node] = None
                best_vis_sim = -1.0
                for cand_n in route_candidate_pool:
                    for ref_v in node_vecs.get(cand_n.id, []):
                        if ref_v.shape == vec.shape:
                            sim = float(np.dot(vec, ref_v))
                            if sim > best_vis_sim:
                                best_vis_sim = sim
                                best_vis_node = cand_n
                if best_vis_node is not None and best_vis_sim >= 0.55:
                    assigned_node = best_vis_node
                    match_method = f"Visual Similarity ({int(best_vis_sim * 100)}%)"
                elif fallback_node_id and fallback_node_id in node_map:
                    assigned_node = node_map[fallback_node_id]
                    match_method = "Selected Node Fallback"
                else:
                    assigned_node = route_candidate_pool[idx % len(route_candidate_pool)]
                    match_method = "Floor Slot Distribution"

            p_row = Photo(
                venue_id=v.id,
                node_id=assigned_node.id,
                path=rel_path,
                source="uploader" if user.role == "uploader" else "admin",
                quality=round(float(q_score), 3),
                embedding=embedder_service.to_bytes(vec),
                embedder=embedder_service.name,
                ocr_text=" ".join(ocr_toks),
                heading_deg=assigned_heading,
                uploaded_by_id=user.id,
                media_type="photo",
                thumbnail_path=None,
                duration_s=None,
            )
            session.add(p_row)
            session.flush()

            last_accepted_vec = vec
            node_vecs.setdefault(assigned_node.id, []).append(vec)
            touched_nodes.add(assigned_node.id)
            if dest_path.exists():
                saved_bytes_total += dest_path.stat().st_size

            accepted.append({
                "id": p_row.id,
                "filename": label,
                "url": f"/media/{rel_path}",
                "node_id": assigned_node.id,
                "node_name": assigned_node.name,
                "level": assigned_node.level,
                "quality": round(float(q_score), 3),
                "heading_deg": assigned_heading,
                "ocr_text": " ".join(ocr_toks[:6]),
                "method": match_method,
            })
        except Exception as exc:  # noqa: BLE001
            dest_path.unlink(missing_ok=True)
            rejected.append({"filename": label, "reason": f"Frame error ({exc})"})

    session.commit()
    saved_mb = round(max(0.0, (raw_bytes_total - saved_bytes_total) / (1024.0 * 1024.0)), 2)
    return {
        "accepted": accepted,
        "rejected": rejected,
        "nodes_updated": len(touched_nodes),
        "raw_mb": round(raw_bytes_total / (1024.0 * 1024.0), 2),
        "stored_mb": round(saved_bytes_total / (1024.0 * 1024.0), 2),
        "space_saved_mb": saved_mb,
    }


@router.post("/admin/venues/{slug}/index/rebuild")
def admin_rebuild_index(
    slug: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)
    return rebuild_venue_index(session, v, force=True)


@router.get("/admin/venues/{slug}/index/report")
def admin_get_index_report(
    slug: str,
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v, allow_staff=True)
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
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v, allow_staff=True)

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
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    person = session.exec(select(Person).where(Person.id == person_id)).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    v = session.exec(select(Venue).where(Venue.id == person.venue_id)).first()
    if v:
        assert_venue_write_access(user, v, allow_staff=True)

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
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v, allow_staff=True)

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
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    v = get_venue_or_404(session, slug)
    assert_venue_write_access(user, v)

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
    user: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    c = session.exec(select(Closure).where(Closure.id == closure_id)).first()
    if not c:
        raise HTTPException(status_code=404, detail="Closure not found")
    v = session.exec(select(Venue).where(Venue.id == c.venue_id)).first()
    if v:
        assert_venue_write_access(user, v)
    session.delete(c)
    session.commit()
    return {"ok": True}

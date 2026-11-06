"""Database tables (SQLModel / SQLite). One schema serves every venue type."""
from datetime import datetime, timezone
from typing import Optional
import uuid

from sqlmodel import Field, SQLModel


def _id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Venue(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    slug: str = Field(index=True, unique=True)
    name: str
    type: str                      # hospital | campus | mall | office
    city: str = ""
    tagline: str = ""
    description: str = ""
    accent: str = "#6366f1"
    cover_path: Optional[str] = None
    emergency_node_id: Optional[str] = None
    entrance_node_id: Optional[str] = None
    owner_id: Optional[str] = Field(default=None, index=True)
    owner_name: str = ""


class Building(SQLModel, table=True):
    id: str = Field(primary_key=True)
    venue_id: str = Field(index=True)
    name: str
    x: float = 0
    y: float = 0
    w: float = 40
    d: float = 20


class Floor(SQLModel, table=True):
    id: str = Field(primary_key=True)
    venue_id: str = Field(index=True)
    building_id: str = Field(index=True)
    level: int
    name: str
    blueprint_path: Optional[str] = None


class Node(SQLModel, table=True):
    id: str = Field(primary_key=True)          # globally unique, e.g. "cc:reception"
    venue_id: str = Field(index=True)
    building_id: str
    floor_id: str
    level: int
    name: str
    kind: str
    category: Optional[str] = None
    x: float
    y: float
    keywords: str = ""                         # space separated extra words / sign text
    is_place: bool = True


class Edge(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    source: str
    target: str
    distance: float
    kind: str = "walk"                         # walk | door | stairs | lift | outdoor
    accessible: bool = True
    stretcher_ok: bool = True


class Closure(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    edge_id: str
    reason: str = ""
    created_at: datetime = Field(default_factory=_now)


class Person(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    name: str
    role: str = "Staff"                        # Doctor | Faculty | Officer | Staff ...
    title: str = ""                            # e.g. "Cardiologist"
    department: str = ""
    node_id: str
    schedule: str = ""
    status: str = "available"                  # available | busy | leave | moved
    status_note: str = ""
    moved_to_node_id: Optional[str] = None
    keywords: str = ""


class Photo(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    node_id: str = Field(index=True)
    path: str                                  # relative to MEDIA_DIR
    source: str = "admin"                      # seed | admin | visitor | uploader
    quality: float = 1.0
    embedding: Optional[bytes] = None          # float32 vector
    embedder: Optional[str] = None
    ocr_text: str = ""
    heading_deg: Optional[float] = None        # optional 0..360 camera orientation on floorplan
    uploaded_by_id: Optional[str] = None
    media_type: str = "photo"                  # photo | video
    thumbnail_path: Optional[str] = None       # preview image for videos (WebP)
    duration_s: Optional[float] = None
    created_at: datetime = Field(default_factory=_now)


class LocalizeLog(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    photo_path: str
    predicted_node: Optional[str] = None
    confidence: float = 0
    status: str = "no_match"
    confirmed_node: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)


class RouteLog(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    from_node: str
    to_node: str
    path: str = ""                             # space separated node ids
    created_at: datetime = Field(default_factory=_now)


class SearchLog(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    query: str
    results: int = 0
    created_at: datetime = Field(default_factory=_now)


class IndexReport(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    venue_id: str = Field(index=True)
    json: str
    created_at: datetime = Field(default_factory=_now)


class User(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str
    role: str = "uploader"                     # admin (superadmin) | uploader (map creator) | staff
    password_hash: str
    organization: str = ""
    bio: str = ""
    avatar_color: str = "#0ea5e9"
    token_version: int = 1
    failed_attempts: int = 0
    locked_until: Optional[float] = None
    created_at: Optional[datetime] = Field(default_factory=_now)

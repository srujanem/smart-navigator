from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine

from .config import DB_PATH

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})

_MIGRATIONS: dict[str, list[tuple[str, str]]] = {
    "venue": [
        ("owner_id", "TEXT DEFAULT NULL"),
        ("owner_name", "TEXT DEFAULT ''"),
    ],
    "floor": [
        ("blueprint_path", "TEXT DEFAULT NULL"),
    ],
    "edge": [
        ("stretcher_ok", "INTEGER DEFAULT 1"),
    ],
    "photo": [
        ("heading_deg", "REAL DEFAULT NULL"),
        ("uploaded_by_id", "TEXT DEFAULT NULL"),
    ],
    "user": [
        ("organization", "TEXT DEFAULT ''"),
        ("bio", "TEXT DEFAULT ''"),
        ("avatar_color", "TEXT DEFAULT '#0ea5e9'"),
        ("token_version", "INTEGER DEFAULT 1"),
        ("failed_attempts", "INTEGER DEFAULT 0"),
        ("locked_until", "REAL DEFAULT NULL"),
        ("created_at", "TEXT DEFAULT NULL"),
    ],
}


def _ensure_columns() -> None:
    with engine.begin() as conn:
        for table, cols in _MIGRATIONS.items():
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            if not rows:
                continue
            existing = {str(r[1]) for r in rows}
            for col_name, col_def in cols:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)

    SQLModel.metadata.create_all(engine)
    _ensure_columns()


def get_session():
    with Session(engine) as session:
        yield session

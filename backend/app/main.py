from contextlib import asynccontextmanager
import logging
import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from .api.admin import router as admin_router
from .api.public import router as public_router
from .config import CORS_ORIGINS, DB_PATH, MEDIA_DIR
from .db import engine, init_db
from .seed_data import ensure_seeded

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_BOOT_LOCK = threading.Lock()
_BOOTSTRAPPED = False


def ensure_bootstrapped() -> None:
    global _BOOTSTRAPPED  # noqa: PLW0603
    if _BOOTSTRAPPED and DB_PATH.exists():
        return
    with _BOOT_LOCK:
        if _BOOTSTRAPPED and DB_PATH.exists():
            return
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        init_db()
        with Session(engine) as session:
            ensure_seeded(session)
        _BOOTSTRAPPED = True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_bootstrapped()
    yield


app = FastAPI(
    title="Navigator — Universal Photo-Based Indoor Navigation API",
    version="2.0.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def _serverless_bootstrap_middleware(request: Request, call_next):
    ensure_bootstrapped()
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")

app.include_router(public_router, prefix="/api")
app.include_router(admin_router, prefix="/api")

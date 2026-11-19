from collections import defaultdict, deque
from contextlib import asynccontextmanager
import logging
import re
import threading
import time
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from .api.admin import router as admin_router
from .api.public import router as public_router
from .auth import decode_token, verify_media_signature
from .config import CORS_ORIGINS, DB_PATH, DEBUG_DOCS, MEDIA_DIR
from .db import engine, init_db
from .seed_data import ensure_seeded

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_BOOT_LOCK = threading.Lock()
_BOOTSTRAPPED = False
_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_QUERY_MEDIA_RE = re.compile(r"^/media/(venues/[^/]+/queries/.+)$")


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if peer in ("127.0.0.1", "::1"):
        cf_ip = request.headers.get("cf-connecting-ip", "").strip()
        if cf_ip:
            return cf_ip[:64]
    return peer


def _is_rate_limited(bucket_key: tuple[str, str], limit: int, window_s: int = 60) -> bool:
    now = time.monotonic()
    cutoff = now - window_s
    with _RATE_LOCK:
        dq = _RATE_BUCKETS[bucket_key]
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= limit:
            return True
        dq.append(now)
        if len(_RATE_BUCKETS) > 5000:
            stale = [k for k, v in _RATE_BUCKETS.items() if not v or v[-1] < cutoff]
            for k in stale:
                _RATE_BUCKETS.pop(k, None)
    return False


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
    version="2.1.0",
    lifespan=lifespan,
    docs_url="/docs" if DEBUG_DOCS else None,
    redoc_url="/redoc" if DEBUG_DOCS else None,
    openapi_url="/openapi.json" if DEBUG_DOCS else None,
)


@app.middleware("http")
async def _security_and_bootstrap_middleware(request: Request, call_next):
    ensure_bootstrapped()

    raw_path = unquote(request.url.path)
    if ".." in raw_path or "\x00" in raw_path:
        return JSONResponse({"detail": "Invalid request path."}, status_code=400)

    path = request.url.path
    if request.method != "OPTIONS":
        ip = _client_ip(request)
        if path in ("/api/auth/login", "/api/auth/register"):
            if _is_rate_limited((ip, "auth"), limit=15, window_s=60):
                return JSONResponse(
                    {"detail": "Too many authentication requests. Please wait a minute."},
                    status_code=429,
                )
        elif request.method == "POST" and path.startswith("/api/venues/") and path.endswith("/localize"):
            if _is_rate_limited((ip, "localize"), limit=25, window_s=60):
                return JSONResponse(
                    {"detail": "Too many localization requests. Please wait a moment."},
                    status_code=429,
                )
        elif path.startswith("/api/"):
            if _is_rate_limited((ip, "api"), limit=240, window_s=60):
                return JSONResponse(
                    {"detail": "API rate limit exceeded. Please slow down."},
                    status_code=429,
                )

    m_query = _QUERY_MEDIA_RE.match(path)
    if m_query:
        rel_path = m_query.group(1)
        sig_ok = verify_media_signature(
            rel_path,
            request.query_params.get("exp", ""),
            request.query_params.get("sig", ""),
        )
        auth_ok = False
        if not sig_ok:
            auth_hdr = request.headers.get("authorization", "")
            if auth_hdr.lower().startswith("bearer "):
                try:
                    decode_token(auth_hdr.split(" ", 1)[1].strip())
                    auth_ok = True
                except HTTPException:
                    auth_ok = False
        if not sig_ok and not auth_ok:
            return JSONResponse(
                {"detail": "Signed access required for private visitor captures."},
                status_code=403,
            )

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=()")
    if path.startswith("/api/admin/") or path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"^https://smart-navigator(?:-[a-z0-9-]+)?\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")

app.include_router(public_router, prefix="/api")
app.include_router(admin_router, prefix="/api")

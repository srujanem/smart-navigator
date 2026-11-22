"""Central configuration. Values can be overridden with environment variables."""
import os
from pathlib import Path
import secrets

IS_VERCEL = os.getenv("VERCEL") == "1"
IS_RENDER = bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))
LOW_MEMORY_MODE = os.getenv("NAV_LOW_MEM", "1" if (IS_VERCEL or IS_RENDER) else "0") == "1"
BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
_DEFAULT_VAR = Path("/tmp/navigator_var") if IS_VERCEL else (BASE_DIR / "var")
DATA_DIR = Path(os.getenv("NAV_DATA_DIR", _DEFAULT_VAR))
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "navigator.db"
SEED_DIR = BASE_DIR / "seed"


def _load_or_create_secret(filename: str, env_var: str, nbytes: int = 32) -> str:
    env_val = os.getenv(env_var, "").strip()
    if env_val:
        return env_val
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    secret_file = DATA_DIR / filename
    if secret_file.exists():
        stored = secret_file.read_text(encoding="utf-8").strip()
        if stored:
            return stored
    generated = secrets.token_hex(nbytes)
    secret_file.write_text(generated, encoding="utf-8")
    try:
        os.chmod(secret_file, 0o600)
    except OSError:
        pass
    return generated


# "auto" -> try DINOv2 (torch + transformers), fall back to classic CV descriptor.
# "dinov2" / "classic" force a specific embedder.
EMBEDDER = os.getenv("NAV_EMBEDDER", "auto")
DINO_MODEL = os.getenv("NAV_DINO_MODEL", "facebook/dinov2-small")
ENABLE_OCR = os.getenv("NAV_OCR", "1") == "1"

SECRET_KEY = _load_or_create_secret(".secret_key", "NAV_SECRET", nbytes=32)
TOKEN_TTL_HOURS = 24 * 7

ADMIN_EMAIL = os.getenv("NAV_ADMIN_EMAIL", "admin@navigator.dev")
ADMIN_PASSWORD = _load_or_create_secret(".admin_password", "NAV_ADMIN_PASSWORD", nbytes=16)
DEBUG_DOCS = os.getenv("NAV_DEBUG_DOCS", "0") == "1"

_DEFAULT_ORIGINS = "https://smart-navigator-vert.vercel.app,http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [o.strip() for o in os.getenv("NAV_CORS", _DEFAULT_ORIGINS).split(",") if o.strip()]
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Localisation decision thresholds
CONFIDENT_THRESHOLD = 0.55     # fused probability of best node
MIN_MARGIN = 0.15              # best - second best probability
NO_MATCH_SIMILARITY = 0.35     # below this visual similarity (and no OCR hit) -> no_match

WALK_SPEED = 1.3               # m/s
WHEELCHAIR_SPEED = 0.9

MEDIA_DIR.mkdir(parents=True, exist_ok=True)

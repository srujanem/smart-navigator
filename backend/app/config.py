"""Central configuration. Values can be overridden with environment variables."""
import os
from pathlib import Path

IS_VERCEL = os.getenv("VERCEL") == "1"
BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
_DEFAULT_VAR = Path("/tmp/navigator_var") if IS_VERCEL else (BASE_DIR / "var")
DATA_DIR = Path(os.getenv("NAV_DATA_DIR", _DEFAULT_VAR))
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "navigator.db"
SEED_DIR = BASE_DIR / "seed"

# "auto" -> try DINOv2 (torch + transformers), fall back to classic CV descriptor.
# "dinov2" / "classic" force a specific embedder.
EMBEDDER = os.getenv("NAV_EMBEDDER", "auto")
DINO_MODEL = os.getenv("NAV_DINO_MODEL", "facebook/dinov2-small")
ENABLE_OCR = os.getenv("NAV_OCR", "1") == "1"

SECRET_KEY = os.getenv("NAV_SECRET", "dev-secret-change-me")
TOKEN_TTL_HOURS = 24 * 7

ADMIN_EMAIL = os.getenv("NAV_ADMIN_EMAIL", "admin@navigator.dev")
ADMIN_PASSWORD = os.getenv("NAV_ADMIN_PASSWORD", "admin123")

_DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [o.strip() for o in os.getenv("NAV_CORS", _DEFAULT_ORIGINS).split(",") if o.strip()]

# Localisation decision thresholds
CONFIDENT_THRESHOLD = 0.55     # fused probability of best node
MIN_MARGIN = 0.15              # best - second best probability
NO_MATCH_SIMILARITY = 0.35     # below this visual similarity (and no OCR hit) -> no_match

WALK_SPEED = 1.3               # m/s
WHEELCHAIR_SPEED = 0.9

MEDIA_DIR.mkdir(parents=True, exist_ok=True)

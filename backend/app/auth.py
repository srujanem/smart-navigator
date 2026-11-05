"""Hardened, dependency-free auth: PBKDF2-HMAC-SHA256 (210k rounds), token versioning, lockout & tenant isolation."""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from .config import SECRET_KEY, TOKEN_TTL_HOURS
from .db import get_session
from .models import User, Venue

PBKDF2_ITERATIONS = 210_000
MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 300  # 5-minute cooldown after 5 consecutive bad passwords


def validate_password_strength(password: str) -> Optional[str]:
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    if not re.search(r"[A-Za-z]", password):
        return "Password must include at least one letter."
    if not re.search(r"[\d\W_]", password):
        return "Password must include at least one number or special character."
    return None


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) == 4 and parts[0] == "pbkdf2":
            iters = int(parts[1])
            salt_hex, digest_hex = parts[2], parts[3]
        elif len(parts) == 2:
            # Backward compatibility with initial 120k seeded hashes
            iters = 120_000
            salt_hex, digest_hex = parts[0], parts[1]
        else:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), iters)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:  # noqa: BLE001
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_token(user: User) -> str:
    now = int(time.time())
    payload = {
        "sub": user.id,
        "role": user.role,
        "tv": int(user.token_version or 1),
        "iat": now,
        "exp": now + TOKEN_TTL_HOURS * 3600,
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64(hmac.new(SECRET_KEY.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str) -> dict:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(SECRET_KEY.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad signature")
        payload = json.loads(_unb64(body))
        if payload["exp"] < time.time():
            raise ValueError("expired")
        return payload
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Invalid or expired session token") from exc


def require_admin(authorization: str = Header(default=""), session: Session = Depends(get_session)) -> User:
    """Authenticate any Studio user (Super Admin, Verified Map Uploader, or Staff) with live token-version check."""
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required. Please sign in.")
    payload = decode_token(authorization.split(" ", 1)[1].strip())
    user = session.exec(select(User).where(User.id == payload["sub"])).first()
    if not user or user.role not in ("admin", "uploader", "staff"):
        raise HTTPException(status_code=403, detail="Studio access required")
    if int(payload.get("tv", 1)) != int(user.token_version or 1):
        raise HTTPException(status_code=401, detail="Session was revoked for security. Please sign in again.")
    return user


def assert_venue_write_access(user: User, venue: Venue, allow_staff: bool = False) -> None:
    """Enforce strict account isolation: Uploaders can only edit venues they created."""
    if user.role == "admin":
        return
    if allow_staff and user.role == "staff":
        return
    if user.role == "uploader" and venue.owner_id and venue.owner_id == user.id:
        return
    raise HTTPException(
        status_code=403,
        detail="Access denied: You can only modify maps and datasets created under your uploader account.",
    )

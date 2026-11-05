"""Minimal, dependency-free auth: PBKDF2 password hashes + HMAC-signed tokens."""
import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from .config import SECRET_KEY, TOKEN_TTL_HOURS
from .db import get_session
from .models import User


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 120_000)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_token(user: User) -> str:
    payload = {"sub": user.id, "role": user.role, "exp": int(time.time()) + TOKEN_TTL_HOURS * 3600}
    body = _b64(json.dumps(payload).encode())
    sig = _b64(hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str) -> dict:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad signature")
        payload = json.loads(_unb64(body))
        if payload["exp"] < time.time():
            raise ValueError("expired")
        return payload
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc


def require_admin(authorization: str = Header(default=""), session: Session = Depends(get_session)) -> User:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login required")
    payload = decode_token(authorization.split(" ", 1)[1])
    user = session.exec(select(User).where(User.id == payload["sub"])).first()
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

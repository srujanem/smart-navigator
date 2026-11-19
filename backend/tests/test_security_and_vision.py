import base64
import hashlib
import hmac
from io import BytesIO
import json
from types import SimpleNamespace
import time

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import ADMIN_EMAIL, ADMIN_PASSWORD, MEDIA_DIR
from app.db import engine
from app.main import app
from app.models import LocalizeLog, User
from app.services.vision.quality import check_navigation_applicability, pick_best_display_photo
from sqlmodel import Session, select


def _jpeg_bytes(color: tuple[int, int, int], with_pattern: bool = False) -> bytes:
    im = Image.new("RGB", (360, 360), color)
    if with_pattern:
        draw = ImageDraw.Draw(im)
        for i in range(0, 360, 30):
            draw.line([(i, 0), (i, 360)], fill=(20, 20, 20), width=3)
            draw.line([(0, i), (360, i)], fill=(230, 230, 230), width=2)
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_security_backholes_closed_and_vision_filters():
    uniq_email = f"sec_test_{int(time.time() * 1000)}@example.com"
    created_log_id = None
    try:
        with TestClient(app) as client:
            # 1. Public Swagger / OpenAPI docs are disabled by default
            assert client.get("/docs").status_code == 404
            assert client.get("/redoc").status_code == 404
            assert client.get("/openapi.json").status_code == 404

            # 2. Forged JWT signed with old hardcoded dev-secret fails cleanly with 401
            payload = {"sub": "a2754a09235c", "role": "admin", "tv": 1, "exp": int(time.time()) + 3600}
            body_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
            bad_sig = base64.urlsafe_b64encode(
                hmac.new(b"dev-secret-change-me", body_b64.encode(), hashlib.sha256).digest()
            ).decode().rstrip("=")
            forged_res = client.get(
                "/api/admin/venues",
                headers={"Authorization": f"Bearer {body_b64}.{bad_sig}"},
            )
            assert forged_res.status_code == 401

            # 3. Registration forces role="uploader" even when account_type="staff" is sent,
            #    and enforces strict tenant isolation against another venue's overview/dataset.
            reg = client.post(
                "/api/auth/register",
                json={
                    "name": "Security Tester",
                    "email": uniq_email,
                    "password": "TestPassword!2026",
                    "organization": "Test Campus",
                    "account_type": "staff",
                },
            )
            assert reg.status_code == 200
            reg_data = reg.json()
            assert reg_data["user"]["role"] == "uploader"
            assert reg.headers.get("cache-control") == "no-store"
            user_headers = {"Authorization": f"Bearer {reg_data['token']}"}

            assert client.get("/api/admin/venues/city-care/overview", headers=user_headers).status_code == 403
            assert client.get("/api/admin/venues/city-care/dataset", headers=user_headers).status_code == 403
            assert client.get("/api/admin/venues", headers=user_headers).json() == []

            # 4. Security headers & owner_id scrubbed from public venue summary
            v_res = client.get("/api/venues/city-care")
            assert v_res.status_code == 200
            assert v_res.headers.get("x-content-type-options") == "nosniff"
            assert v_res.headers.get("x-frame-options") == "DENY"
            assert "owner_id" not in v_res.json()

            # 5. Unsigned /media/venues/*/queries/* is blocked with 403, while signed URL returns 200
            sample_img = _jpeg_bytes((125, 130, 140), with_pattern=True)
            loc = client.post(
                "/api/venues/city-care/localize",
                files={"file": ("corridor.jpg", sample_img, "image/jpeg")},
            )
            assert loc.status_code == 200
            created_log_id = loc.json().get("log_id")
            signed_url = loc.json()["query_photo_url"]
            assert "?exp=" in signed_url and "&sig=" in signed_url
            unsigned_url = signed_url.split("?", 1)[0]
            assert client.get(unsigned_url).status_code == 403
            assert client.get(signed_url).status_code == 200

            # 6. Non-navigation images (dark, blank white wall, low-entropy grey, fake HTML magic bytes) rejected
            dark_img = Image.new("RGB", (320, 320), (8, 8, 8))
            ok_dark, _, _ = check_navigation_applicability(dark_img)
            assert not ok_dark

            white_img = Image.new("RGB", (320, 320), (250, 250, 250))
            ok_white, _, _ = check_navigation_applicability(white_img)
            assert not ok_white

            flat_grey = Image.new("RGB", (320, 320), (140, 140, 140))
            ok_flat, _, _ = check_navigation_applicability(flat_grey)
            assert not ok_flat

            admin_tok = client.post(
                "/api/auth/login",
                json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            )
            assert admin_tok.status_code == 200
            admin_headers = {"Authorization": f"Bearer {admin_tok.json()['token']}"}

            fake_res = client.post(
                "/api/admin/venues/city-care/photos",
                headers=admin_headers,
                data={"node_id": "cc:reception"},
                files=[("files", ("payload.jpg", b"<html><script>alert(1)</script></html>", "image/jpeg"))],
            )
            assert fake_res.status_code == 200
            assert len(fake_res.json()["rejected"]) == 1
            assert len(fake_res.json()["accepted"]) == 0

            # 7. pick_best_display_photo prioritizes OCR-verified room door photo over higher-quality unverified shot
            node_304 = SimpleNamespace(name="Room 304")
            p_wrong_high_q = SimpleNamespace(path="wrong.webp", thumbnail_path=None, media_type="photo", ocr_text="", source="uploader", quality=0.92)
            p_conflict = SimpleNamespace(path="other.webp", thumbnail_path=None, media_type="photo", ocr_text="308", source="uploader", quality=0.95)
            p_verified = SimpleNamespace(path="door304.webp", thumbnail_path=None, media_type="photo", ocr_text="304", source="uploader", quality=0.68)
            best = pick_best_display_photo(node_304, [p_wrong_high_q, p_conflict, p_verified])
            assert best is p_verified

            # 8. Human-readable directions include short_action, steps_count, passing_landmarks, and door_side
            r_res = client.post(
                "/api/venues/city-care/route",
                json={"from_node": "cc:reception", "to_node": "cc:pharmacy"},
            )
            assert r_res.status_code == 200
            steps = r_res.json()["steps"]
            assert len(steps) >= 2
            assert all("short_action" in st and "steps_count" in st and "passing_landmarks" in st for st in steps)
            assert any(st["steps_count"] > 0 for st in steps)

            # 9. Exact-node pinning keeps uploaded photo on chosen node and PATCH supports 1-tap reassignment
            pin_img = _jpeg_bytes((125, 130, 140), with_pattern=True)
            up = client.post(
                "/api/admin/venues/city-care/photos",
                headers=admin_headers,
                data={"node_id": "cc:reception", "exact_node": "true"},
                files=[("files", ("pinned_door.jpg", pin_img, "image/jpeg"))],
            )
            assert up.status_code == 200
            accepted = up.json()["accepted"]
            assert len(accepted) == 1
            pid = accepted[0]["id"]
            try:
                assert accepted[0]["node_id"] == "cc:reception"
                mv = client.patch(
                    f"/api/admin/photos/{pid}",
                    headers=admin_headers,
                    json={"node_id": "cc:pharmacy", "heading_deg": 90},
                )
                assert mv.status_code == 200
                assert mv.json()["node_id"] == "cc:pharmacy"
                assert mv.json()["heading_deg"] == 90
            finally:
                client.delete(f"/api/admin/photos/{pid}", headers=admin_headers)
    finally:
        with Session(engine) as s:
            test_u = s.exec(select(User).where(User.email == uniq_email)).first()
            if test_u:
                s.delete(test_u)
            if created_log_id:
                test_l = s.exec(select(LocalizeLog).where(LocalizeLog.id == created_log_id)).first()
                if test_l:
                    (MEDIA_DIR / test_l.photo_path).unlink(missing_ok=True)
                    s.delete(test_l)
            s.commit()

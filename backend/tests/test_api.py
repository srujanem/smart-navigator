from io import BytesIO
from pathlib import Path
from PIL import Image
from fastapi.testclient import TestClient

from app.config import ADMIN_EMAIL, ADMIN_PASSWORD, SEED_DIR
from app.main import app


def test_full_navigator_pipeline():
    with TestClient(app) as client:
        # 1. Health & Venues
        h = client.get("/api/health")
        assert h.status_code == 200
        h_data = h.json()
        assert h_data["status"] == "ok"
        assert h_data["venues"] >= 3

        venues = client.get("/api/venues").json()
        slugs = {v["slug"] for v in venues}
        assert {"city-care", "horizon-campus", "metro-civic"}.issubset(slugs)

        detail = client.get("/api/venues/city-care").json()
        assert detail["emergency_node_id"] == "cc:emergency"
        assert detail["entrance_node_id"] == "cc:reception"
        assert len(detail["buildings"]) == 2

        # 2. Held-out Visitor Photo Localization Benchmark on City Care Hospital
        expected_nodes = {
            "reception_q.jpg": "cc:reception",
            "opd_waiting_q.jpg": "cc:opd_waiting",
            "pharmacy_q.jpg": "cc:pharmacy",
            "lift_lobby_q.jpg": "cc:lift_0",
            "radiology_q.jpg": "cc:radiology",
            "cardiology_q.jpg": "cc:cardiology",
            "emergency_q.jpg": "cc:emergency",
            "cafeteria_q.jpg": "cc:cafeteria",
        }
        q_dir = SEED_DIR / "hospital_queries"
        top1_correct = 0
        first_log_id = None
        for fname, target_nid in expected_nodes.items():
            raw = (q_dir / fname).read_bytes()
            res = client.post(
                "/api/venues/city-care/localize",
                files={"file": (fname, raw, "image/jpeg")},
            )
            assert res.status_code == 200
            body = res.json()
            assert len(body["trace"]) == 4
            if first_log_id is None:
                first_log_id = body["log_id"]
            if body["candidates"] and body["candidates"][0]["node_id"] == target_nid:
                top1_correct += 1

        assert top1_correct >= 7, f"Expected >=7/8 held-out accuracy, got {top1_correct}/8"

        # Confirm localization
        conf = client.post(
            f"/api/venues/city-care/localize/{first_log_id}/confirm",
            json={"node_id": "cc:reception", "contribute": False},
        )
        assert conf.status_code == 200 and conf.json()["ok"] is True

        # 3. Symptom, Nearest & Doctor Relocation Search
        s_heart = client.get("/api/venues/city-care/search", params={"q": "heart doctor"}).json()
        assert s_heart["interpreted"] is not None
        top_ids = [r["node_id"] for r in s_heart["results"][:3]]
        assert "cc:cardiology" in top_ids

        # Dr. Rajesh Menon is marked 'moved' to cc:ot_2
        s_menon = client.get("/api/venues/city-care/search", params={"q": "Menon"}).json()
        assert s_menon["results"][0]["node_id"] == "cc:ot_2"

        s_wash = client.get(
            "/api/venues/city-care/search",
            params={"q": "nearest washroom", "from": "cc:pharmacy"},
        ).json()
        assert s_wash["results"][0]["node_id"] == "cc:washroom_0"

        # 4. Routing: Walk vs Wheelchair & Live Closure Bypassing
        r_walk = client.post(
            "/api/venues/city-care/route",
            json={"from_node": "cc:pharmacy", "to_node": "cc:ortho", "profile": "walk"},
        )
        assert r_walk.status_code == 200
        r_wheel = client.post(
            "/api/venues/city-care/route",
            json={"from_node": "cc:pharmacy", "to_node": "cc:ortho", "profile": "wheelchair"},
        )
        assert r_wheel.status_code == 200
        # Wheelchair route must go via lift, never stairs
        assert all("stairs" not in nid for nid in r_wheel.json()["path"])

        # 5. Admin Auth, Closures, Quality Gate & Index Report
        tok_res = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert tok_res.status_code == 200
        headers = {"Authorization": f"Bearer {tok_res.json()['token']}"}

        # Reject solid-grey blurry image
        blurry_buf = BytesIO()
        Image.new("RGB", (300, 300), (120, 120, 120)).save(blurry_buf, format="JPEG")
        up_res = client.post(
            "/api/admin/venues/city-care/photos",
            headers=headers,
            data={"node_id": "cc:reception"},
            files=[("files", ("blurry.jpg", blurry_buf.getvalue(), "image/jpeg"))],
        )
        assert up_res.status_code == 200
        assert len(up_res.json()["rejected"]) == 1

        # Block cc:stairs_0 -> cc:stairs_1 and verify route notices bypassed closure
        graph = client.get("/api/venues/city-care/graph").json()
        stairs_edge = next(e for e in graph["edges"] if e["kind"] == "stairs" and "cc:stairs_0" in (e["source"], e["target"]))
        cl = client.post(
            "/api/admin/venues/city-care/closures",
            headers=headers,
            json={"edge_id": stairs_edge["id"], "reason": "Wet floor cleaning"},
        )
        assert cl.status_code == 200
        r_after = client.post(
            "/api/venues/city-care/route",
            json={"from_node": "cc:pharmacy", "to_node": "cc:paediatrics", "profile": "walk"},
        ).json()
        assert r_after["closures_avoided"] >= 1
        client.delete(f"/api/admin/closures/{cl.json()['id']}", headers=headers)

        rep = client.get("/api/admin/venues/city-care/index/report", headers=headers).json()
        assert rep["top1"] >= 0.85

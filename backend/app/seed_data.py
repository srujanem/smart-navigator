"""
Populates the SQLite database on first startup with:
1. Demo admin account (admin@navigator.dev / admin123)
2. City Care Multi-Speciality Hospital (multi-building, 3 floors, 9 doctors/officers, 24 reference photos + 8 held-out visitor query photos)
3. Horizon Institute of Technology (4 buildings, 4 floors, 55 nodes migrated from graph.json, faculty directory + real smartphone hostel photos)
4. Metro Civic & Galleria Center (public offices & retail counters, 2 floors)
5. Initial route/search/localization history and pre-built AI vision index reports.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import logging
from pathlib import Path
import random
from PIL import Image, ImageEnhance
from sqlmodel import Session, select

from .auth import hash_password
from .config import ADMIN_EMAIL, ADMIN_PASSWORD, BASE_DIR, MEDIA_DIR, SEED_DIR
from .models import (
    Building,
    Closure,
    Edge,
    Floor,
    LocalizeLog,
    Node,
    Person,
    Photo,
    RouteLog,
    SearchLog,
    User,
    Venue,
)
from .services.vision.indexer import rebuild_venue_index
from .services.vision.privacy import save_clean_image
from .services.vision.quality import compute_sharpness_quality

log = logging.getLogger(__name__)


def ensure_seeded(session: Session) -> None:
    if not session.exec(select(User).where(User.email == ADMIN_EMAIL)).first():
        session.add(User(
            email=ADMIN_EMAIL.lower(),
            name="Facilities & AI Operations Admin",
            role="admin",
            password_hash=hash_password(ADMIN_PASSWORD),
        ))
        session.commit()

    if session.exec(select(Venue)).first():
        return

    log.info("Seeding Navigator multi-venue database and AI indexes...")
    _seed_hospital(session)
    _seed_campus(session)
    _seed_civic_center(session)
    log.info("Database seed complete.")


def _ingest_reference_with_perspectives(
    session: Session,
    venue: Venue,
    node_id: str,
    src_file: Path,
    stem: str,
    create_crops: bool = True,
) -> str | None:
    if not src_file.exists():
        return None
    raw = src_file.read_bytes()
    rel_main = f"venues/{venue.slug}/photos/{stem}_0.jpg"
    img, _ = save_clean_image(raw, MEDIA_DIR / rel_main, max_side=960)
    q0 = compute_sharpness_quality(img)
    session.add(Photo(venue_id=venue.id, node_id=node_id, path=rel_main, source="seed", quality=q0))

    if create_crops:
        w, h = img.size
        # Perspective view A: slight zoom upper-left + warm indoor lighting shift
        crop_a = img.crop((int(w * 0.06), int(h * 0.04), int(w * 0.92), int(h * 0.92)))
        crop_a = ImageEnhance.Brightness(crop_a).enhance(1.06)
        rel_a = f"venues/{venue.slug}/photos/{stem}_1.jpg"
        (MEDIA_DIR / rel_a).parent.mkdir(parents=True, exist_ok=True)
        crop_a.save(MEDIA_DIR / rel_a, format="JPEG", quality=86)
        session.add(Photo(
            venue_id=venue.id,
            node_id=node_id,
            path=rel_a,
            source="seed",
            quality=compute_sharpness_quality(crop_a),
        ))

        # Perspective view B: slight zoom lower-right + cooler fluorescent lighting shift
        crop_b = img.crop((int(w * 0.08), int(h * 0.08), int(w * 0.95), int(h * 0.96)))
        crop_b = ImageEnhance.Contrast(crop_b).enhance(1.07)
        rel_b = f"venues/{venue.slug}/photos/{stem}_2.jpg"
        crop_b.save(MEDIA_DIR / rel_b, format="JPEG", quality=86)
        session.add(Photo(
            venue_id=venue.id,
            node_id=node_id,
            path=rel_b,
            source="seed",
            quality=compute_sharpness_quality(crop_b),
        ))

    return rel_main


def _find_seed_image(folder: Path, stem: str) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = folder / f"{stem}{ext}"
        if cand.exists():
            return cand
    return None


def _seed_hospital(session: Session) -> None:
    venue = Venue(
        slug="city-care",
        name="City Care Multi-Speciality Hospital",
        type="hospital",
        city="Bengaluru",
        tagline="Zero-hardware photo navigation across OPD, Diagnostics, Specialist Cabins & 24x7 Emergency",
        description=(
            "A 3-floor clinical & diagnostics complex with covered trauma wing access. "
            "Patients and visitors can snap any corridor, counter, or department signboard to locate themselves "
            "and get step-free wheelchair/stretcher or walking directions to any doctor or unit."
        ),
        accent="#0ea5e9",
        entrance_node_id="cc:reception",
        emergency_node_id="cc:emergency",
    )
    session.add(venue)
    session.flush()

    buildings = [
        Building(id="cc_main", venue_id=venue.id, name="Main Clinical Tower", x=10, y=10, w=86, d=48),
        Building(id="cc_emerg", venue_id=venue.id, name="Emergency & Trauma Wing", x=110, y=14, w=46, d=38),
    ]
    floors = [
        Floor(id="cc_main_0", venue_id=venue.id, building_id="cc_main", level=0, name="Ground — Reception, OPD & Pharmacy"),
        Floor(id="cc_main_1", venue_id=venue.id, building_id="cc_main", level=1, name="Floor 1 — Diagnostics, Ortho & Paediatrics"),
        Floor(id="cc_main_2", venue_id=venue.id, building_id="cc_main", level=2, name="Floor 2 — Cardiology, Neuro, ICU & OT"),
        Floor(id="cc_emerg_0", venue_id=venue.id, building_id="cc_emerg", level=0, name="Ground — 24x7 Emergency & Triage"),
    ]
    session.add_all(buildings + floors)

    nodes_spec = [
        # Main Tower Floor 0
        ("cc:reception", "cc_main", "cc_main_0", 0, "Main Reception & Enquiry", "entrance", "administration", 30, 50, "reception enquiry registration lobby front desk", True),
        ("cc:opd_waiting", "cc_main", "cc_main_0", 0, "OPD Waiting Hall", "department", "department", 52, 44, "opd waiting area token display chairs consultation", True),
        ("cc:pharmacy", "cc_main", "cc_main_0", 0, "Pharmacy 24x7", "counter", "pharmacy", 74, 50, "pharmacy 24x7 chemist medicine medical store prescription", True),
        ("cc:billing", "cc_main", "cc_main_0", 0, "Billing & Insurance Desk", "counter", "pharmacy", 22, 34, "billing cash insurance tpa mediclaim discharge", True),
        ("cc:cafeteria", "cc_main", "cc_main_0", 0, "Hospital Cafeteria", "cafeteria", "amenities", 20, 16, "cafeteria food coffee tea canteen dining", True),
        ("cc:lift_0", "cc_main", "cc_main_0", 0, "Central Lifts 1 & 2 (G)", "lift", "transit", 52, 22, "lifts 1 2 elevator lobby ground", True),
        ("cc:stairs_0", "cc_main", "cc_main_0", 0, "Main Staircase (G)", "stairs", "transit", 80, 22, "stairs staircase ground", False),
        ("cc:washroom_0", "cc_main", "cc_main_0", 0, "Accessible Restroom (G)", "washroom", "amenities", 84, 40, "washroom toilet restroom accessible wc", True),
        ("cc:cor_0_w", "cc_main", "cc_main_0", 0, "West Lobby Corridor (G)", "corridor", None, 32, 32, "", False),
        ("cc:cor_0_mid", "cc_main", "cc_main_0", 0, "Central Atrium (G)", "corridor", None, 52, 32, "", False),
        ("cc:cor_0_e", "cc_main", "cc_main_0", 0, "East Lobby Corridor (G)", "corridor", None, 76, 32, "", False),
        # Emergency Wing Floor 0
        ("cc:cor_em_0", "cc_emerg", "cc_emerg_0", 0, "Trauma Walkway", "corridor", None, 118, 32, "", False),
        ("cc:emergency", "cc_emerg", "cc_emerg_0", 0, "Emergency & Trauma (24 Hrs)", "emergency", "emergency", 136, 44, "emergency 24 hrs trauma casualty urgent ambulance red", True),
        ("cc:triage", "cc_emerg", "cc_emerg_0", 0, "Triage & Plaster Room", "room", "emergency", 124, 20, "triage dressing plaster minor procedure", True),
        ("cc:ambulance_exit", "cc_emerg", "cc_emerg_0", 0, "Ambulance Bay & Exit", "exit", "emergency", 148, 22, "exit ambulance gate emergency", True),
        # Main Tower Floor 1
        ("cc:lift_1", "cc_main", "cc_main_1", 1, "Central Lifts 1 & 2 (F1)", "lift", "transit", 52, 22, "lifts 1 2 elevator floor 1", True),
        ("cc:stairs_1", "cc_main", "cc_main_1", 1, "Main Staircase (F1)", "stairs", "transit", 80, 22, "stairs staircase floor 1", False),
        ("cc:cor_1_w", "cc_main", "cc_main_1", 1, "Diagnostics Corridor (F1)", "corridor", None, 32, 32, "", False),
        ("cc:cor_1_mid", "cc_main", "cc_main_1", 1, "Central Landing (F1)", "corridor", None, 52, 32, "", False),
        ("cc:cor_1_e", "cc_main", "cc_main_1", 1, "Specialist Corridor (F1)", "corridor", None, 76, 32, "", False),
        ("cc:radiology", "cc_main", "cc_main_1", 1, "Radiology — X-Ray, CT & MRI", "department", "diagnostics", 26, 18, "radiology x-ray xray ct mri ultrasound imaging radiation", True),
        ("cc:pathology", "cc_main", "cc_main_1", 1, "Pathology & Blood Lab", "lab", "diagnostics", 26, 46, "pathology blood test sample urine lab diagnostic", True),
        ("cc:ortho", "cc_main", "cc_main_1", 1, "Orthopaedics Clinic (D-104)", "cabin", "department", 68, 46, "orthopaedics bone fracture joint knee spine d-104", True),
        ("cc:paediatrics", "cc_main", "cc_main_1", 1, "Paediatrics & Vaccine Wing (D-108)", "cabin", "department", 72, 16, "paediatrics child kids baby vaccination d-108", True),
        ("cc:washroom_1", "cc_main", "cc_main_1", 1, "Restroom (F1)", "washroom", "amenities", 84, 40, "washroom toilet restroom floor 1", True),
        # Main Tower Floor 2
        ("cc:lift_2", "cc_main", "cc_main_2", 2, "Central Lifts 1 & 2 (F2)", "lift", "transit", 52, 22, "lifts 1 2 elevator floor 2", True),
        ("cc:stairs_2", "cc_main", "cc_main_2", 2, "Main Staircase (F2)", "stairs", "transit", 80, 22, "stairs staircase floor 2", False),
        ("cc:cor_2_w", "cc_main", "cc_main_2", 2, "Cardiac Wing Corridor (F2)", "corridor", None, 32, 32, "", False),
        ("cc:cor_2_mid", "cc_main", "cc_main_2", 2, "Central Landing (F2)", "corridor", None, 52, 32, "", False),
        ("cc:cor_2_e", "cc_main", "cc_main_2", 2, "Surgical Wing Corridor (F2)", "corridor", None, 76, 32, "", False),
        ("cc:cardiology", "cc_main", "cc_main_2", 2, "Cardiology Dept (C-201 / C-202)", "department", "department", 28, 18, "cardiology department heart cardiac ecg echo c-201 c-202", True),
        ("cc:neurology", "cc_main", "cc_main_2", 2, "Neurology Clinic (C-205)", "cabin", "department", 28, 46, "neurology brain nerve stroke migraine eeg c-205", True),
        ("cc:icu", "cc_main", "cc_main_2", 2, "Intensive Care Unit (ICU)", "ward", "ward", 70, 16, "icu intensive care critical ventilator", True),
        ("cc:ot_2", "cc_main", "cc_main_2", 2, "Operation Theatre OT-2", "ward", "ward", 76, 46, "ot-2 operation theatre surgery surgical suite", True),
        ("cc:ward_2a", "cc_main", "cc_main_2", 2, "Inpatient Ward 2A", "ward", "ward", 52, 46, "ward 2a inpatient rooms beds recovery", True),
    ]
    for nid, bid, fid, lvl, name, kind, cat, x, y, kw, is_pl in nodes_spec:
        session.add(Node(
            id=nid, venue_id=venue.id, building_id=bid, floor_id=fid, level=lvl,
            name=name, kind=kind, category=cat, x=x, y=y, keywords=kw, is_place=is_pl,
        ))

    edges_spec = [
        # Floor 0 horizontal
        ("cc:reception", "cc:cor_0_w", 16, "walk", True),
        ("cc:billing", "cc:cor_0_w", 10, "door", True),
        ("cc:cafeteria", "cc:cor_0_w", 16, "door", True),
        ("cc:cor_0_w", "cc:cor_0_mid", 20, "walk", True),
        ("cc:cor_0_mid", "cc:opd_waiting", 12, "walk", True),
        ("cc:cor_0_mid", "cc:lift_0", 10, "walk", True),
        ("cc:cor_0_mid", "cc:cor_0_e", 22, "walk", True),
        ("cc:cor_0_e", "cc:pharmacy", 16, "door", True),
        ("cc:cor_0_e", "cc:stairs_0", 10, "walk", True),
        ("cc:cor_0_e", "cc:washroom_0", 10, "door", True),
        # Covered link to Emergency Wing
        ("cc:cor_0_e", "cc:cor_em_0", 32, "outdoor", True),
        ("cc:cor_em_0", "cc:emergency", 18, "walk", True),
        ("cc:cor_em_0", "cc:triage", 14, "door", True),
        ("cc:emergency", "cc:ambulance_exit", 18, "walk", True),
        # Vertical shafts
        ("cc:lift_0", "cc:lift_1", 8, "lift", True),
        ("cc:lift_1", "cc:lift_2", 8, "lift", True),
        ("cc:stairs_0", "cc:stairs_1", 18, "stairs", False),
        ("cc:stairs_1", "cc:stairs_2", 18, "stairs", False),
        # Floor 1 horizontal
        ("cc:lift_1", "cc:cor_1_mid", 10, "walk", True),
        ("cc:stairs_1", "cc:cor_1_e", 10, "walk", True),
        ("cc:cor_1_w", "cc:cor_1_mid", 20, "walk", True),
        ("cc:cor_1_mid", "cc:cor_1_e", 22, "walk", True),
        ("cc:cor_1_w", "cc:radiology", 14, "door", True),
        ("cc:cor_1_w", "cc:pathology", 14, "door", True),
        ("cc:cor_1_e", "cc:ortho", 14, "door", True),
        ("cc:cor_1_e", "cc:paediatrics", 15, "door", True),
        ("cc:cor_1_e", "cc:washroom_1", 10, "door", True),
        # Floor 2 horizontal
        ("cc:lift_2", "cc:cor_2_mid", 10, "walk", True),
        ("cc:stairs_2", "cc:cor_2_e", 10, "walk", True),
        ("cc:cor_2_w", "cc:cor_2_mid", 20, "walk", True),
        ("cc:cor_2_mid", "cc:cor_2_e", 22, "walk", True),
        ("cc:cor_2_w", "cc:cardiology", 14, "door", True),
        ("cc:cor_2_w", "cc:neurology", 14, "door", True),
        ("cc:cor_2_mid", "cc:ward_2a", 14, "door", True),
        ("cc:cor_2_e", "cc:icu", 15, "door", True),
        ("cc:cor_2_e", "cc:ot_2", 14, "door", True),
    ]
    for src, dst, dist, kind, acc in edges_spec:
        session.add(Edge(venue_id=venue.id, source=src, target=dst, distance=dist, kind=kind, accessible=acc))

    people = [
        Person(
            venue_id=venue.id, name="Dr. Ananya Sharma", role="Doctor",
            title="Sr. Interventional Cardiologist (MD, DM)", department="Cardiology",
            node_id="cc:cardiology", schedule="Mon–Sat · 09:30 – 14:30",
            status="available", status_note="Consulting in Cabin C-201",
            keywords="heart chest pain ecg angioplasty bp",
        ),
        Person(
            venue_id=venue.id, name="Dr. Rajesh Menon", role="Doctor",
            title="Chief Orthopaedic Surgeon (MS)", department="Orthopaedics",
            node_id="cc:ortho", schedule="Mon–Fri · 10:00 – 16:00",
            status="moved", moved_to_node_id="cc:ot_2",
            status_note="In Operation Theatre OT-2 until 4:30 PM — routing updated",
            keywords="bone fracture joint knee spine ortho",
        ),
        Person(
            venue_id=venue.id, name="Dr. Priya Nair", role="Doctor",
            title="Lead Diagnostic Radiologist (MD)", department="Radiology",
            node_id="cc:radiology", schedule="Mon–Sat · 08:30 – 17:00",
            status="available", status_note="CT & MRI Console Room",
            keywords="xray x-ray mri ct scan ultrasound imaging",
        ),
        Person(
            venue_id=venue.id, name="Dr. Vikram Kulkarni", role="Doctor",
            title="Consultant Neurologist (DM)", department="Neurology",
            node_id="cc:neurology", schedule="Tue, Thu, Sat · 11:00 – 15:30",
            status="busy", status_note="In EEG procedure (~15 min wait)",
            keywords="brain migraine stroke nerve headache",
        ),
        Person(
            venue_id=venue.id, name="Dr. Meera Krishnan", role="Doctor",
            title="Senior Paediatrician (MD)", department="Paediatrics",
            node_id="cc:paediatrics", schedule="Mon–Sat · 09:00 – 13:30",
            status="available", status_note="Cabin D-108 · Child Wellness",
            keywords="child kids baby vaccination fever pediatric",
        ),
        Person(
            venue_id=venue.id, name="Dr. Farhan Siddiqui", role="Doctor",
            title="Head of Trauma & Emergency (MD)", department="Emergency & Trauma",
            node_id="cc:emergency", schedule="24x7 Duty Roster",
            status="available", status_note="On duty at Trauma Bay 1",
            keywords="emergency trauma casualty accident urgent",
        ),
        Person(
            venue_id=venue.id, name="Dr. Kavitha Rao", role="Doctor",
            title="Chief Pathologist (MD)", department="Pathology",
            node_id="cc:pathology", schedule="Mon–Sat · 08:00 – 16:00",
            status="available", status_note="Blood & Biopsy Diagnostics",
            keywords="blood test lab pathology biopsy",
        ),
        Person(
            venue_id=venue.id, name="Dr. Arvind Deshmukh", role="Doctor",
            title="Critical Care Specialist (MD)", department="ICU",
            node_id="cc:icu", schedule="Mon–Sat · 10:00 – 18:00",
            status="leave", status_note="At national critical-care symposium; Dr. Siddiqui covering",
            keywords="icu critical care ventilator",
        ),
        Person(
            venue_id=venue.id, name="Suresh Babu", role="Officer",
            title="TPA & Cashless Insurance Coordinator", department="Billing & Insurance",
            node_id="cc:billing", schedule="Mon–Sat · 09:00 – 18:00",
            status="available", status_note="Counter 2 — Mediclaim & Discharge",
            keywords="insurance tpa billing cashless discharge",
        ),
    ]
    session.add_all(people)
    session.flush()

    # Ingest Hospital Reference Photos + Held-out Visitor Sample Query Photos
    photo_map = [
        ("cc:reception", "reception", "Main Reception Desk", "Ground Floor Lobby"),
        ("cc:opd_waiting", "opd_waiting", "OPD Waiting Chairs", "Ground Floor Atrium"),
        ("cc:pharmacy", "pharmacy", "24x7 Pharmacy Counter", "Ground Floor East"),
        ("cc:lift_0", "lift_lobby", "Central Elevator Lobby", "Ground Floor Lifts 1 & 2"),
        ("cc:radiology", "radiology", "Radiology & MRI Corridor", "Floor 1 Diagnostics"),
        ("cc:cardiology", "cardiology", "Cardiology Cabins C-201", "Floor 2 Cardiac Wing"),
        ("cc:emergency", "emergency", "24x7 Emergency Entrance", "Trauma Wing Ground"),
        ("cc:cafeteria", "cafeteria", "Hospital Cafeteria", "Ground Floor West"),
    ]
    hosp_ref_dir = SEED_DIR / "hospital_photos"
    hosp_q_dir = SEED_DIR / "hospital_queries"

    sample_queries = []
    cover_rel: str | None = None

    for nid, stem, label, hint in photo_map:
        ref_file = _find_seed_image(hosp_ref_dir, stem)
        if ref_file:
            rel = _ingest_reference_with_perspectives(session, venue, nid, ref_file, stem, create_crops=True)
            if cover_rel is None and rel:
                cover_rel = rel

        q_file = _find_seed_image(hosp_q_dir, f"{stem}_q")
        if q_file:
            rel_q = f"venues/{venue.slug}/sample_queries/{stem}_q.jpg"
            save_clean_image(q_file.read_bytes(), MEDIA_DIR / rel_q, max_side=960)
            sample_queries.append({
                "id": stem,
                "label": label,
                "hint": hint,
                "photo_url": f"/media/{rel_q}",
            })

    if cover_rel:
        venue.cover_path = cover_rel
        session.add(venue)

    if sample_queries:
        q_manifest = MEDIA_DIR / f"venues/{venue.slug}/sample_queries/manifest.json"
        q_manifest.parent.mkdir(parents=True, exist_ok=True)
        q_manifest.write_text(json.dumps(sample_queries, indent=2), encoding="utf-8")

    # Seed realistic initial analytics logs
    rng = random.Random(42)
    popular_routes = [
        ("cc:reception", "cc:cardiology", "cc:reception cc:cor_0_w cc:cor_0_mid cc:lift_0 cc:lift_2 cc:cor_2_mid cc:cor_2_w cc:cardiology"),
        ("cc:reception", "cc:radiology", "cc:reception cc:cor_0_w cc:cor_0_mid cc:lift_0 cc:lift_1 cc:cor_1_mid cc:cor_1_w cc:radiology"),
        ("cc:opd_waiting", "cc:pharmacy", "cc:opd_waiting cc:cor_0_mid cc:cor_0_e cc:pharmacy"),
        ("cc:reception", "cc:emergency", "cc:reception cc:cor_0_w cc:cor_0_mid cc:cor_0_e cc:cor_em_0 cc:emergency"),
        ("cc:radiology", "cc:ortho", "cc:radiology cc:cor_1_w cc:cor_1_mid cc:cor_1_e cc:ortho"),
        ("cc:opd_waiting", "cc:pathology", "cc:opd_waiting cc:cor_0_mid cc:lift_0 cc:lift_1 cc:cor_1_mid cc:cor_1_w cc:pathology"),
    ]
    now = datetime.now(timezone.utc)
    for _ in range(38):
        fr, to, p_str = rng.choice(popular_routes)
        dt = now - timedelta(hours=rng.randint(0, 22), minutes=rng.randint(0, 59))
        session.add(RouteLog(venue_id=venue.id, from_node=fr, to_node=to, path=p_str, created_at=dt))

    for bad_q in ["dental clinic", "atm machine", "dental clinic", "eye opticals", "parking b2"]:
        session.add(SearchLog(venue_id=venue.id, query=bad_q, results=0))

    session.commit()
    rebuild_venue_index(session, venue, force=True)


def _seed_campus(session: Session) -> None:
    venue = Venue(
        slug="horizon-campus",
        name="Horizon Institute of Technology",
        type="campus",
        city="Hyderabad",
        tagline="Multi-building academic, laboratory, library & hostel navigation",
        description=(
            "Four interconnected campus blocks (Academic Block A, Hostel Block, Central Library & Campus Canteen) "
            "digitized with classroom, lab, faculty cabin and hostel room photo localization."
        ),
        accent="#6366f1",
        entrance_node_id="hc:entrance_main",
        emergency_node_id="hc:entrance_main",
    )
    session.add(venue)
    session.flush()

    b_defs = {
        "Academic Block A": ("hc_block_a", 40, 80, 540, 230),
        "Central Library": ("hc_library", 40, 320, 140, 90),
        "Campus Canteen": ("hc_canteen", 460, 320, 140, 90),
        "Hostel Block": ("hc_hostel", 520, 80, 160, 280),
    }
    for b_name, (bid, bx, by, bw, bd) in b_defs.items():
        session.add(Building(id=bid, venue_id=venue.id, name=b_name, x=bx, y=by, w=bw, d=bd))

    raw_graph = json.loads((BASE_DIR / "data" / "graph.json").read_text(encoding="utf-8"))

    seen_floors: set[tuple[str, int]] = set()
    for n in raw_graph["nodes"]:
        bid = b_defs[n["building"]][0]
        lvl = int(n["floor"])
        if (bid, lvl) not in seen_floors:
            seen_floors.add((bid, lvl))
            fl_label = "Ground Floor" if lvl == 0 else f"Floor {lvl}"
            session.add(Floor(
                id=f"{bid}_{lvl}",
                venue_id=venue.id,
                building_id=bid,
                level=lvl,
                name=f"{n['building']} — {fl_label}",
            ))

    cat_by_type = {
        "classroom": "academic",
        "lab": "academic",
        "room": "administration",
        "hostel_room": "hostel",
        "washroom": "amenities",
        "lift": "transit",
        "stairs": "transit",
        "entrance": "transit",
        "fire_extinguisher": "emergency",
    }
    for n in raw_graph["nodes"]:
        bid = b_defs[n["building"]][0]
        lvl = int(n["floor"])
        raw_t = n["type"]
        is_pl = raw_t not in ("corridor",)
        nid = f"hc:{n['id']}"
        kw = n["id"].replace("_", " ")
        if "library" in n["id"]:
            cat = "academic"
        elif "canteen" in n["id"] or "mess" in n["id"]:
            cat = "amenities"
        else:
            cat = cat_by_type.get(raw_t)
        session.add(Node(
            id=nid,
            venue_id=venue.id,
            building_id=bid,
            floor_id=f"{bid}_{lvl}",
            level=lvl,
            name=n["name"],
            kind=raw_t,
            category=cat,
            x=round(float(n["x"]) * 0.22, 1),
            y=round(float(n["y"]) * 0.22, 1),
            keywords=kw,
            is_place=is_pl,
        ))

    for e in raw_graph["edges"]:
        ekind = "walk" if e["type"] == "walkable" else e["type"]
        session.add(Edge(
            venue_id=venue.id,
            source=f"hc:{e['source']}",
            target=f"hc:{e['target']}",
            distance=float(e["distance"]),
            kind=ekind,
            accessible=(ekind != "stairs"),
        ))

    faculty = [
        Person(
            venue_id=venue.id, name="Prof. Raghavendra Rao", role="Faculty",
            title="Head of Artificial Intelligence Lab", department="Computer Science",
            node_id="hc:ai_lab", schedule="Mon–Fri · 10:00 – 17:00",
            status="available", status_note="Open Lab Hours — Floor 2",
            keywords="ai ml machine learning deep learning project hod",
        ),
        Person(
            venue_id=venue.id, name="Dr. Shalini Verma", role="Faculty",
            title="Academic Dean & Exam Controller", department="Administration",
            node_id="hc:room_101", schedule="Mon–Sat · 09:30 – 16:30",
            status="busy", status_note="In Academic Senate Review",
            keywords="dean exam academic Transcripts",
        ),
        Person(
            venue_id=venue.id, name="Col.Prakash Nair (Retd.)", role="Officer",
            title="Chief Hostel Warden", department="Student Residence",
            node_id="hc:warden_office", schedule="Daily · 08:00 – 20:00",
            status="available", status_note="Hostel Ground Office",
            keywords="warden hostel room allocation mess",
        ),
        Person(
            venue_id=venue.id, name="Meenakshi Iyer", role="Officer",
            title="Chief University Librarian", department="Central Library",
            node_id="hc:central_library", schedule="Mon–Sat · 08:30 – 19:00",
            status="available", status_note="Reference & Digital Journals Desk",
            keywords="library books journal thesis",
        ),
    ]
    session.add_all(faculty)
    session.flush()

    # Ingest real smartphone photos from frontend/public/photos
    real_photos_dir = BASE_DIR.parent / "frontend" / "public" / "photos"
    all_jpegs = sorted(real_photos_dir.glob("*.jpeg"))
    campus_queries = []
    if len(all_jpegs) >= 10:
        # Index clean doorway & corridor photos onto hostel nodes
        ref_assignments = [
            ("hc:room_309", all_jpegs[0], "room309_a"),
            ("hc:room_309", all_jpegs[5], "room309_b"),
            ("hc:room_309", all_jpegs[6], "room309_c"),
            ("hc:room_310", all_jpegs[7], "room310_a"),
            ("hc:room_310", all_jpegs[9], "room310_b"),
            ("hc:warden_office", all_jpegs[8], "hostel_cor_a"),
            ("hc:warden_office", all_jpegs[10], "hostel_cor_b"),
        ]
        cover_set = False
        for nid, p_file, stem in ref_assignments:
            rel = _ingest_reference_with_perspectives(session, venue, nid, p_file, stem, create_crops=False)
            if not cover_set and rel:
                venue.cover_path = rel
                session.add(venue)
                cover_set = True

        # Keep distinct smartphone shots out of the index as sample visitor test queries
        for idx_q, label, hint in [
            (1, "Hostel 3rd Floor Corridor", "Near Room 309 / 310"),
            (12, "Hostel Room Doorway", "Hostel Block Floor 3"),
            (14, "East Wing Hallway", "Hostel Corridor View"),
        ]:
            if idx_q < len(all_jpegs):
                rel_q = f"venues/{venue.slug}/sample_queries/campus_q_{idx_q}.jpg"
                save_clean_image(all_jpegs[idx_q].read_bytes(), MEDIA_DIR / rel_q, max_side=960)
                campus_queries.append({
                    "id": f"campus_{idx_q}",
                    "label": label,
                    "hint": hint,
                    "photo_url": f"/media/{rel_q}",
                })

    if campus_queries:
        q_manifest = MEDIA_DIR / f"venues/{venue.slug}/sample_queries/manifest.json"
        q_manifest.parent.mkdir(parents=True, exist_ok=True)
        q_manifest.write_text(json.dumps(campus_queries, indent=2), encoding="utf-8")

    for fr, to in [("hc:room_309", "hc:ai_lab"), ("hc:entrance_main", "hc:room_204"), ("hc:room_309", "hc:canteen")]:
        session.add(RouteLog(venue_id=venue.id, from_node=fr, to_node=to, path=f"{fr} {to}"))

    session.commit()
    rebuild_venue_index(session, venue, force=True)


def _seed_civic_center(session: Session) -> None:
    venue = Venue(
        slug="metro-civic",
        name="Metro Civic & Galleria Plaza",
        type="office",
        city="Mumbai",
        tagline="Public citizen counters, passport desk, retail concourse & auditorium",
        description="A two-level public service hub combining citizen facilitation counters, municipal offices, and retail amenities.",
        accent="#10b981",
        entrance_node_id="mc:atrium",
        emergency_node_id="mc:atrium",
    )
    session.add(venue)
    session.flush()

    session.add(Building(id="mc_plaza", venue_id=venue.id, name="Galleria Atrium", x=10, y=10, w=72, d=42))
    session.add_all([
        Floor(id="mc_0", venue_id=venue.id, building_id="mc_plaza", level=0, name="Ground — Concourse & Citizen Counters"),
        Floor(id="mc_1", venue_id=venue.id, building_id="mc_plaza", level=1, name="Floor 1 — Passport Seva & Municipal Offices"),
    ])
    nodes = [
        ("mc:atrium", "mc_0", 0, "Main Grand Atrium", "entrance", "transit", 44, 44, "entrance main gate atrium security", True),
        ("mc:helpdesk", "mc_0", 0, "Citizen Helpdesk & Token Counter", "counter", "administration", 28, 30, "helpdesk token enquiry citizen", True),
        ("mc:foodcourt", "mc_0", 0, "Concourse Cafe & Bakery", "cafeteria", "amenities", 64, 30, "cafe coffee food court snacks", True),
        ("mc:lift_0", "mc_0", 0, "Glass Panorama Lift (G)", "lift", "transit", 44, 20, "lift elevator", True),
        ("mc:stairs_0", "mc_0", 0, "Escalator & Stairs (G)", "stairs", "transit", 64, 18, "stairs escalator", False),
        ("mc:lift_1", "mc_1", 1, "Glass Panorama Lift (F1)", "lift", "transit", 44, 20, "lift elevator", True),
        ("mc:stairs_1", "mc_1", 1, "Escalator & Stairs (F1)", "stairs", "transit", 64, 18, "stairs escalator", False),
        ("mc:passport", "mc_1", 1, "Passport & Visa Facilitation Hall", "department", "administration", 26, 32, "passport visa document verification", True),
        ("mc:municipal", "mc_1", 1, "Property & Civic Records Office", "cabin", "administration", 62, 36, "municipal tax certificate records", True),
    ]
    for nid, fid, lvl, name, kind, cat, x, y, kw, is_pl in nodes:
        session.add(Node(
            id=nid, venue_id=venue.id, building_id="mc_plaza", floor_id=fid, level=lvl,
            name=name, kind=kind, category=cat, x=x, y=y, keywords=kw, is_place=is_pl,
        ))
    for src, dst, dist, kind, acc in [
        ("mc:atrium", "mc:helpdesk", 18, "walk", True),
        ("mc:atrium", "mc:foodcourt", 22, "walk", True),
        ("mc:atrium", "mc:lift_0", 24, "walk", True),
        ("mc:foodcourt", "mc:stairs_0", 14, "walk", True),
        ("mc:lift_0", "mc:lift_1", 8, "lift", True),
        ("mc:stairs_0", "mc:stairs_1", 16, "stairs", False),
        ("mc:lift_1", "mc:passport", 20, "walk", True),
        ("mc:lift_1", "mc:municipal", 22, "walk", True),
        ("mc:stairs_1", "mc:municipal", 18, "walk", True),
    ]:
        session.add(Edge(venue_id=venue.id, source=src, target=dst, distance=dist, kind=kind, accessible=acc))

    session.add(Person(
        venue_id=venue.id, name="Nandini Deshpande", role="Officer",
        title="Regional Passport Verification Officer", department="Citizen Services",
        node_id="mc:passport", schedule="Mon–Fri · 09:30 – 17:00",
        status="available", status_note="Counter B-4",
        keywords="passport verification apostille",
    ))
    session.commit()

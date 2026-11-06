"""
Build the complete 3D & 2D Spatial Digital Twin for 'N Block Hostel' (L-Shaped, G+3 = 4 Levels, 72 Rooms)
from the 225 real photographs in C:\\campus navigator\\Pictures.
"""
from __future__ import annotations

import json
import math
import shutil
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont
from sqlmodel import Session, delete, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import MEDIA_DIR  # noqa: E402
from app.db import engine, init_db  # noqa: E402
from app.models import (  # noqa: E402
    Building,
    Closure,
    Edge,
    Floor,
    IndexReport,
    LocalizeLog,
    Node,
    Person,
    Photo,
    RouteLog,
    SearchLog,
    User,
    Venue,
)
from app.services.vision.embedder import embedder_service  # noqa: E402
from app.services.vision.privacy import save_clean_image  # noqa: E402

PICS_DIR = Path(r"C:\campus navigator\Pictures")
SCAN_JSON = BACKEND_ROOT / "var" / "hostel_photo_scan.json"
SLUG = "n-block-hostel"


def draw_wing_a_blueprint(level: int, dest: Path) -> None:
    """Render crisp architectural CAD floorplan PNG for Wing A (w=82, d=32 -> 820x320 px)."""
    W, H = 820, 320
    img = Image.new("RGBA", (W, H), (248, 250, 252, 255))
    d = ImageDraw.Draw(img)

    # Subtle blueprint grid
    for gx in range(0, W, 20):
        d.line([(gx, 0), (gx, H)], fill=(226, 232, 240, 255), width=1)
    for gy in range(0, H, 20):
        d.line([(0, gy), (W, gy)], fill=(226, 232, 240, 255), width=1)

    # Central corridor highlight (y around 160 in local coords: (74 - 58)*10 = 160)
    d.rectangle([10, 120, W - 10, 200], fill=(241, 245, 249, 255))

    # L-Junction Lobby & Staircase bay on West side (x: 0..180)
    d.rectangle([8, 8, 180, H - 8], outline=(71, 85, 105, 255), width=3)
    # Staircase treads box around local x=(15-10)*10=50, y=(82-58)*10=240
    d.rectangle([18, 205, 95, 305], fill=(254, 243, 199, 255), outline=(217, 119, 6, 255), width=2)
    for sy in range(215, 300, 12):
        d.line([(20, sy), (93, sy)], fill=(180, 83, 9, 255), width=2)
    d.text((26, 190), "STAIRS", fill=(146, 64, 14, 255))

    if level == 0:
        # Entrance opening at top of lobby (local x=120, y=8)
        d.rectangle([90, 4, 155, 24], fill=(209, 250, 229, 255), outline=(16, 185, 129, 255), width=2)
        d.text((96, 8), "ENTRANCE", fill=(6, 95, 70, 255))

    # 5 room pairs along Wing A: slots at world x = 34, 46, 58, 70, 82 -> local x = 240, 360, 480, 600, 720
    slots_local = [180, 300, 420, 540, 660, 790]
    for idx in range(5):
        x0, x1 = slots_local[idx], slots_local[idx + 1]
        top_num = f"{level}{idx + 1:02d}"       # x01..x05
        bot_num = f"{level}{10 - idx:02d}"      # x10..x06

        # North room box (y: 8..120)
        d.rectangle([x0, 8, x1, 120], fill=(255, 255, 255, 255), outline=(51, 65, 85, 255), width=3)
        # Doorway gap into corridor
        d.line([(x0 + 42, 120), (x0 + 78, 120)], fill=(241, 245, 249, 255), width=4)
        d.text((x0 + 44, 52), f"RM {top_num}", fill=(30, 41, 59, 255))

        # South room box (y: 200..312)
        d.rectangle([x0, 200, x1, H - 8], fill=(255, 255, 255, 255), outline=(51, 65, 85, 255), width=3)
        d.line([(x0 + 42, 200), (x0 + 78, 200)], fill=(241, 245, 249, 255), width=4)
        d.text((x0 + 44, 248), f"RM {bot_num}", fill=(30, 41, 59, 255))

    # Outer terracotta architectural border
    d.rectangle([3, 3, W - 4, H - 4], outline=(185, 28, 28, 255), width=5)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="PNG")


def draw_wing_b_blueprint(level: int, dest: Path) -> None:
    """Render crisp architectural CAD floorplan PNG for Wing B (w=28, d=50 -> 280x500 px)."""
    W, H = 280, 500
    img = Image.new("RGBA", (W, H), (248, 250, 252, 255))
    d = ImageDraw.Draw(img)

    for gx in range(0, W, 20):
        d.line([(gx, 0), (gx, H)], fill=(226, 232, 240, 255), width=1)
    for gy in range(0, H, 20):
        d.line([(0, gy), (W, gy)], fill=(226, 232, 240, 255), width=1)

    # Central corridor spine around world x=24 -> local x=(24-10)*10=140
    d.rectangle([105, 8, 175, H - 4], fill=(241, 245, 249, 255))

    # North end Common Washroom & Utility bay (world y=8..18 -> local y=0..100)
    d.rectangle([8, 8, W - 8, 95], fill=(243, 232, 255, 255), outline=(126, 34, 206, 255), width=3)
    d.text((78, 42), f"WASHROOMS L{level}", fill=(88, 28, 135, 255))

    # 4 room pairs along Wing B:
    # world y slots: 22 (local 140), 32 (local 240), 42 (local 340), 52 (local 440)
    # West side (x=15): x18, x14, x15, x16
    # East side (x=33): x17, x13, x12, x11
    west_nums = [18, 14, 15, 16]
    east_nums = [17, 13, 12, 11]
    y_bands = [(95, 195), (195, 295), (295, 395), (395, 492)]

    for i, (y0, y1) in enumerate(y_bands):
        wn = f"{level}{west_nums[i]:02d}"
        en = f"{level}{east_nums[i]:02d}"

        # West room
        d.rectangle([8, y0, 105, y1], fill=(255, 255, 255, 255), outline=(51, 65, 85, 255), width=3)
        d.line([(105, y0 + 35), (105, y0 + 65)], fill=(241, 245, 249, 255), width=4)
        d.text((26, (y0 + y1) // 2 - 6), f"RM {wn}", fill=(30, 41, 59, 255))

        # East room
        d.rectangle([175, y0, W - 8, y1], fill=(255, 255, 255, 255), outline=(51, 65, 85, 255), width=3)
        d.line([(175, y0 + 35), (175, y0 + 65)], fill=(241, 245, 249, 255), width=4)
        d.text((196, (y0 + y1) // 2 - 6), f"RM {en}", fill=(30, 41, 59, 255))

    d.rectangle([3, 3, W - 4, H - 4], outline=(185, 28, 28, 255), width=5)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="PNG")


def assign_photo_to_nodes(idx: int, room_nums: List[str]) -> Tuple[List[str], Optional[float]]:
    """
    Deterministically map each of the 225 walkthrough photos (indices 0..224)
    to its exact N Block Hostel node(s) + approximate camera compass heading.
    """
    valid_rooms = []
    for rn in room_nums:
        if len(rn) == 3 and rn[0] in "0123":
            num_part = int(rn[1:])
            if 1 <= num_part <= 18:
                valid_rooms.append(rn)

    if valid_rooms:
        nodes = [f"nb:room-{rn}" for rn in valid_rooms]
        # Wing A rooms face East/West corridor (90 deg), Wing B rooms face North/South corridor (0 deg)
        first_num = int(valid_rooms[0][1:])
        heading = 90.0 if first_num <= 10 else 0.0
        return nodes, heading

    # Segment-based assignment for non-OCR hallway, staircase, washroom, and exterior shots
    if idx <= 1:
        return ["nb:front-gate"], 0.0
    if idx <= 4:
        return ["nb:courtyard"], 225.0
    if idx <= 11:
        return ["nb:entrance"], 180.0
    if idx <= 15:
        return ["nb:warden-office"], 90.0
    if idx <= 18:
        return ["nb:lobby-0"], 90.0

    # Ground Floor Wing A (indices 19..37)
    if 19 <= idx <= 37:
        if idx in (21, 23):
            return ["nb:room-002", "nb:room-010"], 90.0
        if idx in (25, 26, 27):
            return ["nb:room-009", "nb:room-003"], 90.0
        if idx in (30, 31):
            return ["nb:room-004"], 90.0
        if idx in (33, 34):
            return ["nb:room-007", "nb:room-005"], 90.0
        return ["nb:room-006"], 90.0

    # Ground Floor Washroom & Wing B (indices 38..61)
    if 38 <= idx <= 44:
        return ["nb:washroom-0"], 0.0
    if 45 <= idx <= 47:
        return ["nb:room-011", "nb:room-016"], 0.0
    if 48 <= idx <= 50:
        return ["nb:room-017", "nb:room-018"], 0.0
    if 51 <= idx <= 52:
        return ["nb:room-013", "nb:room-015"], 0.0
    if 54 <= idx <= 56:
        return ["nb:room-015", "nb:room-014"], 180.0
    if 59 <= idx <= 60:
        return ["nb:room-013", "nb:room-012"], 180.0

    # Ground -> 1st Floor Central Staircase (indices 62..81)
    if 62 <= idx <= 71:
        return ["nb:stairs-0"], 270.0
    if 72 <= idx <= 81:
        return ["nb:stairs-1"], 90.0

    # 1st Floor Lobby & Wing B (indices 82..97)
    if 82 <= idx <= 86:
        return ["nb:lobby-1"], 0.0
    if 90 <= idx <= 91:
        return ["nb:room-117", "nb:room-118"], 0.0
    if 92 <= idx <= 93:
        return ["nb:washroom-1"], 0.0
    if idx == 96:
        return ["nb:room-113"], 180.0

    # 1st Floor Wing A (indices 98..111)
    if 98 <= idx <= 99:
        return ["nb:lobby-1", "nb:room-101"], 90.0
    if idx == 102:
        return ["nb:room-102"], 90.0
    if idx in (104, 105):
        return ["nb:room-102", "nb:room-109"], 90.0
    if idx == 110:
        return ["nb:room-105"], 90.0
    if idx == 111:
        return ["nb:room-106"], 90.0

    # 1st -> 2nd Floor Stairs & Landing (indices 112..119)
    if 112 <= idx <= 115:
        return ["nb:stairs-1"], 270.0
    if 116 <= idx <= 119:
        return ["nb:lobby-2", "nb:stairs-2"], 90.0

    # 2nd Floor Wing A (indices 120..126)
    if idx == 121:
        return ["nb:room-202", "nb:room-209"], 90.0
    if idx == 122:
        return ["nb:room-203", "nb:room-208"], 90.0
    if idx == 123:
        return ["nb:room-204", "nb:room-207"], 90.0
    if idx in (125, 126):
        return ["nb:room-206", "nb:room-205"], 90.0

    # 2nd Floor Washroom & Wing B (indices 127..145)
    if 127 <= idx <= 133:
        return ["nb:washroom-2"], 0.0
    if 134 <= idx <= 137:
        return ["nb:room-217", "nb:room-218"], 0.0
    if idx in (139, 140):
        return ["nb:room-211", "nb:room-216"], 180.0
    if idx in (142, 143):
        return ["nb:room-214", "nb:room-213"], 180.0
    if idx == 145:
        return ["nb:room-215", "nb:room-212"], 180.0

    # 2nd -> 3rd Floor Stairs & 3rd Floor Washroom (indices 146..167)
    if 146 <= idx <= 154:
        return ["nb:stairs-2"], 270.0
    if 155 <= idx <= 161:
        return ["nb:stairs-3", "nb:lobby-3"], 0.0
    if 162 <= idx <= 167:
        return ["nb:washroom-3"], 0.0

    # 3rd Floor Wing B (indices 168..187)
    if 169 <= idx <= 176:
        return ["nb:room-318", "nb:room-317"], 180.0
    if 178 <= idx <= 180:
        return ["nb:room-311", "nb:room-316"], 180.0
    if 181 <= idx <= 184:
        return ["nb:room-312", "nb:room-315"], 180.0
    if idx == 186:
        return ["nb:room-313", "nb:room-314"], 180.0

    # 3rd Floor Wing A (indices 188..203)
    if idx in (188, 189):
        return ["nb:lobby-3", "nb:room-310"], 90.0
    if idx == 192:
        return ["nb:room-309", "nb:room-302"], 90.0
    if 193 <= idx <= 195:
        return ["nb:room-303", "nb:room-304"], 90.0
    if idx in (198, 199):
        return ["nb:room-306", "nb:room-304"], 270.0
    if idx == 202:
        return ["nb:room-308", "nb:room-303"], 270.0

    # Descending Central Staircase (indices 204..224)
    if 204 <= idx <= 209:
        return ["nb:stairs-3"], 180.0
    if 210 <= idx <= 214:
        return ["nb:stairs-2"], 180.0
    if 215 <= idx <= 219:
        return ["nb:stairs-1"], 180.0
    return ["nb:stairs-0", "nb:entrance"], 180.0


def main() -> None:
    t_start = time.perf_counter()
    init_db()

    scan_records = json.loads(SCAN_JSON.read_text(encoding="utf-8"))
    print(f"Loaded {len(scan_records)} scanned photos from {SCAN_JSON}")

    venue_media_root = MEDIA_DIR / "venues" / SLUG
    if venue_media_root.exists():
        shutil.rmtree(venue_media_root)
    (venue_media_root / "photos").mkdir(parents=True, exist_ok=True)
    (venue_media_root / "blueprints").mkdir(parents=True, exist_ok=True)
    (venue_media_root / "sample_queries").mkdir(parents=True, exist_ok=True)

    with Session(engine) as session:
        # Ensure Srujan's account has full uploader privileges so he can edit N Block anytime
        srujan = session.exec(select(User).where(User.email == "srujanem222@gmail.com")).first()
        owner_id = None
        owner_name = "Srujan"
        if srujan:
            if srujan.role == "staff":
                srujan.role = "uploader"
                session.add(srujan)
            owner_id = srujan.id
            owner_name = srujan.name or "Srujan"

        # Clean existing n-block-hostel if present
        existing = session.exec(select(Venue).where(Venue.slug == SLUG)).first()
        if existing:
            vid = existing.id
            for tbl in (Photo, Person, Closure, Edge, Node, Floor, Building, LocalizeLog, RouteLog, SearchLog, IndexReport):
                session.exec(delete(tbl).where(tbl.venue_id == vid))  # type: ignore[arg-type]
            session.delete(existing)
            session.commit()

        # Save clean cover image from photo [000] (crisp N Block exterior facade)
        cover_src = PICS_DIR / "IMG20261106121638.jpg"
        cover_rel = f"venues/{SLUG}/cover.jpg"
        save_clean_image(cover_src.read_bytes(), MEDIA_DIR / cover_rel, max_side=1400)

        venue = Venue(
            slug=SLUG,
            name="N Block Hostel",
            type="campus",
            city="Campus Residential Zone",
            tagline="L-Shaped 4-Level Hostel Digital Twin · Ground + 3 Floors · 72 Rooms (001–318) & Courtyard",
            description=(
                "Complete 3D & 2D indoor navigation digital twin of N Block Hostel built from 225 real "
                "corridor, room plaque, staircase, washroom, and badminton courtyard photographs."
            ),
            accent="#dc2626",
            cover_path=cover_rel,
            entrance_node_id="nb:entrance",
            emergency_node_id="nb:entrance",
            owner_id=owner_id,
            owner_name=owner_name,
        )
        session.add(venue)
        session.commit()
        session.refresh(venue)
        vid = venue.id

        # Create the 2 touching perpendicular wings forming the L-Shape
        wing_a = Building(
            id="nb-wing-a",
            venue_id=vid,
            name="N Block · Wing A (Rooms 01–10 & Hub)",
            x=10,
            y=58,
            w=82,
            d=32,
        )
        wing_b = Building(
            id="nb-wing-b",
            venue_id=vid,
            name="N Block · Wing B (Rooms 11–18 & Washrooms)",
            x=10,
            y=8,
            w=28,
            d=50,
        )
        session.add(wing_a)
        session.add(wing_b)

        floor_names = {
            0: "Ground Floor (001–018)",
            1: "First Floor (101–118)",
            2: "Second Floor (201–218)",
            3: "Third Floor (301–318)",
        }

        for lvl, fname in floor_names.items():
            bp_a_rel = f"venues/{SLUG}/blueprints/wing_a_f{lvl}.png"
            bp_b_rel = f"venues/{SLUG}/blueprints/wing_b_f{lvl}.png"
            draw_wing_a_blueprint(lvl, MEDIA_DIR / bp_a_rel)
            draw_wing_b_blueprint(lvl, MEDIA_DIR / bp_b_rel)

            session.add(
                Floor(
                    id=f"nb-wa-f{lvl}",
                    venue_id=vid,
                    building_id="nb-wing-a",
                    level=lvl,
                    name=fname,
                    blueprint_path=bp_a_rel,
                )
            )
            session.add(
                Floor(
                    id=f"nb-wb-f{lvl}",
                    venue_id=vid,
                    building_id="nb-wing-b",
                    level=lvl,
                    name=fname,
                    blueprint_path=bp_b_rel,
                )
            )

        nodes: Dict[str, Node] = {}
        edges: List[Edge] = []

        def add_node(
            nid: str,
            b_id: str,
            f_id: str,
            lvl: int,
            name: str,
            kind: str,
            category: Optional[str],
            x: float,
            y: float,
            keywords: str = "",
            is_place: bool = True,
        ) -> None:
            n = Node(
                id=nid,
                venue_id=vid,
                building_id=b_id,
                floor_id=f_id,
                level=lvl,
                name=name,
                kind=kind,
                category=category,
                x=x,
                y=y,
                keywords=keywords,
                is_place=is_place,
            )
            nodes[nid] = n
            session.add(n)

        def connect(
            a: str,
            b: str,
            kind: str = "walk",
            accessible: bool = True,
            stretcher_ok: bool = True,
            dist_override: Optional[float] = None,
        ) -> None:
            na, nb = nodes[a], nodes[b]
            dist = dist_override if dist_override is not None else round(max(2.0, math.hypot(na.x - nb.x, na.y - nb.y) * 0.55), 1)
            e = Edge(
                venue_id=vid,
                source=a,
                target=b,
                distance=dist,
                kind=kind,
                accessible=accessible,
                stretcher_ok=stretcher_ok,
            )
            edges.append(e)
            session.add(e)

        # Ground Floor Outdoor / Entrance / Warden Nodes
        add_node(
            "nb:front-gate",
            "nb-wing-a",
            "nb-wa-f0",
            0,
            "N Block Front Gate & Main Road",
            "entrance",
            "Entrances & Courtyard",
            64,
            95,
            "front gate road exterior n block main gate entry exit",
            True,
        )
        add_node(
            "nb:courtyard",
            "nb-wing-a",
            "nb-wa-f0",
            0,
            "Badminton Court & Hostel Courtyard",
            "courtyard",
            "Entrances & Courtyard",
            58,
            38,
            "badminton court sports ground courtyard lawn outdoor",
            True,
        )
        add_node(
            "nb:entrance",
            "nb-wing-a",
            "nb-wa-f0",
            0,
            "N Block Main Entrance Porch",
            "entrance",
            "Entrances & Courtyard",
            22,
            60,
            "main entrance porch door exit emergency assembly",
            True,
        )
        add_node(
            "nb:warden-office",
            "nb-wing-a",
            "nb-wa-f0",
            0,
            "Warden & Caretaker Desk",
            "helpdesk",
            "Common Facilities",
            27,
            64,
            "warden office caretaker supervisor security help desk reception",
            True,
        )

        connect("nb:front-gate", "nb:courtyard", kind="outdoor", dist_override=24.0)
        connect("nb:front-gate", "nb:entrance", kind="outdoor", dist_override=22.0)
        connect("nb:courtyard", "nb:entrance", kind="outdoor", dist_override=16.0)

        # Build all 4 floors (Ground=0, First=1, Second=2, Third=3)
        wing_a_xs = [34, 46, 58, 70, 82]
        wing_b_ys = [52, 42, 32, 22]  # Northbound along Wing B
        west_b_nums = [16, 15, 14, 18]
        east_b_nums = [11, 12, 13, 17]

        for lvl in range(4):
            fa = f"nb-wa-f{lvl}"
            fb = f"nb-wb-f{lvl}"
            floor_tag = ["Ground Floor", "1st Floor", "2nd Floor", "3rd Floor"][lvl]
            floor_cat = ["Ground Floor Rooms", "First Floor Rooms", "Second Floor Rooms", "Third Floor Rooms"][lvl]

            lobby_id = f"nb:lobby-{lvl}"
            stairs_id = f"nb:stairs-{lvl}"
            wash_id = f"nb:washroom-{lvl}"

            add_node(
                lobby_id,
                "nb-wing-a",
                fa,
                lvl,
                f"{floor_tag} L-Junction & Study Balcony" if lvl > 0 else "Ground Floor L-Junction Lobby",
                "lobby",
                "Common Facilities",
                22,
                74,
                f"l junction corner lobby study balcony chairs {floor_tag.lower()}",
                True,
            )
            add_node(
                stairs_id,
                "nb-wing-a",
                fa,
                lvl,
                f"Central Staircase ({floor_tag})",
                "stairs",
                "Stairs & Transit",
                15,
                82,
                f"stairs staircase steps granite {floor_tag.lower()}",
                True,
            )
            add_node(
                wash_id,
                "nb-wing-b",
                fb,
                lvl,
                f"Common Washrooms ({floor_tag})",
                "washroom",
                "Washrooms & Amenities",
                24,
                13,
                f"washroom restroom toilet bathroom water utility {floor_tag.lower()}",
                True,
            )

            connect(lobby_id, stairs_id, kind="walk", dist_override=5.5)

            if lvl == 0:
                connect("nb:entrance", lobby_id, kind="walk", dist_override=7.5)
                connect("nb:entrance", "nb:warden-office", kind="door", dist_override=4.0)
                connect("nb:warden-office", lobby_id, kind="walk", dist_override=5.5)

            # Wing A Corridor & Rooms x01..x10
            prev_cor_a = lobby_id
            for s_idx, sx in enumerate(wing_a_xs):
                cor_id = f"nb:cor-a-{lvl}-{s_idx}"
                add_node(
                    cor_id,
                    "nb-wing-a",
                    fa,
                    lvl,
                    f"Wing A Corridor ({floor_tag})",
                    "corridor",
                    None,
                    sx,
                    74,
                    "",
                    False,
                )
                connect(prev_cor_a, cor_id, kind="walk", dist_override=6.0)
                prev_cor_a = cor_id

                rm_top = f"{lvl}{s_idx + 1:02d}"      # x01..x05
                rm_bot = f"{lvl}{10 - s_idx:02d}"     # x10..x06

                top_id = f"nb:room-{rm_top}"
                bot_id = f"nb:room-{rm_bot}"

                add_node(
                    top_id,
                    "nb-wing-a",
                    fa,
                    lvl,
                    f"Room {rm_top}",
                    "room",
                    floor_cat,
                    sx,
                    64,
                    f"room {rm_top} {int(rm_top)} wing a hostel room door {rm_top}",
                    True,
                )
                add_node(
                    bot_id,
                    "nb-wing-a",
                    fa,
                    lvl,
                    f"Room {rm_bot}",
                    "room",
                    floor_cat,
                    sx,
                    84,
                    f"room {rm_bot} {int(rm_bot)} wing a hostel room door {rm_bot}",
                    True,
                )
                connect(cor_id, top_id, kind="door", dist_override=3.2)
                connect(cor_id, bot_id, kind="door", dist_override=3.2)

            # Wing B Corridor & Rooms x11..x18 + Washroom
            prev_cor_b = lobby_id
            for b_idx, by in enumerate(wing_b_ys):
                cor_b_id = f"nb:cor-b-{lvl}-{b_idx}"
                add_node(
                    cor_b_id,
                    "nb-wing-b",
                    fb,
                    lvl,
                    f"Wing B Corridor ({floor_tag})",
                    "corridor",
                    None,
                    24,
                    by,
                    "",
                    False,
                )
                connect(prev_cor_b, cor_b_id, kind="walk", dist_override=6.5 if b_idx == 0 else 5.5)
                prev_cor_b = cor_b_id

                rm_west = f"{lvl}{west_b_nums[b_idx]:02d}"
                rm_east = f"{lvl}{east_b_nums[b_idx]:02d}"

                west_id = f"nb:room-{rm_west}"
                east_id = f"nb:room-{rm_east}"

                add_node(
                    west_id,
                    "nb-wing-b",
                    fb,
                    lvl,
                    f"Room {rm_west}",
                    "room",
                    floor_cat,
                    15,
                    by,
                    f"room {rm_west} {int(rm_west)} wing b hostel room door {rm_west}",
                    True,
                )
                add_node(
                    east_id,
                    "nb-wing-b",
                    fb,
                    lvl,
                    f"Room {rm_east}",
                    "room",
                    floor_cat,
                    33,
                    by,
                    f"room {rm_east} {int(rm_east)} wing b hostel room door {rm_east}",
                    True,
                )
                connect(cor_b_id, west_id, kind="door", dist_override=3.2)
                connect(cor_b_id, east_id, kind="door", dist_override=3.2)

            connect(prev_cor_b, wash_id, kind="walk", dist_override=5.0)

            # Cross-floor staircase connection
            if lvl > 0:
                connect(
                    f"nb:stairs-{lvl - 1}",
                    stairs_id,
                    kind="stairs",
                    accessible=False,
                    stretcher_ok=False,
                    dist_override=10.0,
                )

        # Operational Hostel Directory Contacts (Zero fake student names)
        staff_entries = [
            Person(
                venue_id=vid,
                name="Chief Hostel Warden",
                role="Officer",
                title="Hostel Administration",
                department="N Block Residential Office",
                node_id="nb:warden-office",
                schedule="08:30 AM – 09:00 PM",
                status="available",
                status_note="Available at Ground Floor Lobby Office",
                keywords="warden hostel permission room allocation",
            ),
            Person(
                venue_id=vid,
                name="N Block Caretaker & Maintenance",
                role="Staff",
                title="Block Supervisor",
                department="Facilities & Electrical",
                node_id="nb:warden-office",
                schedule="24x7 Duty Roster",
                status="available",
                status_note="Contact for room keys, plumbing & Wi-Fi",
                keywords="caretaker maintenance supervisor electrician water wifi",
            ),
            Person(
                venue_id=vid,
                name="Hostel Security Gate Desk",
                role="Staff",
                title="Campus Security",
                department="Entry & Visitor Log",
                node_id="nb:entrance",
                schedule="24x7 Active",
                status="available",
                status_note="Main Entrance Porch",
                keywords="security guard gate emergency",
            ),
        ]
        for p in staff_entries:
            session.add(p)

        session.commit()
        print(f"Created {len(nodes)} nodes and {len(edges)} edges across 4 levels.")

        # Process & Index ALL 225 Real Photos with Privacy Face-Blur + DINOv2 Embeddings
        emb_name = embedder_service.name
        node_has_photo: Dict[str, str] = {}
        photo_rows_created = 0

        for rec in scan_records:
            idx = int(rec["index"])
            fname = rec["filename"]
            src_file = PICS_DIR / fname
            if not src_file.exists():
                continue

            target_nodes, heading = assign_photo_to_nodes(idx, rec.get("room_numbers", []))
            rel_img = f"venues/{SLUG}/photos/{idx:03d}_{fname}"
            clean_img, _faces = save_clean_image(src_file.read_bytes(), MEDIA_DIR / rel_img, max_side=1024)

            vec = embedder_service.embed(clean_img)
            vec_bytes = embedder_service.to_bytes(vec)
            ocr_str = " ".join(rec.get("tokens", []))

            for tn in target_nodes:
                if tn not in nodes:
                    continue
                session.add(
                    Photo(
                        venue_id=vid,
                        node_id=tn,
                        path=rel_img,
                        source="uploader",
                        quality=0.96,
                        embedding=vec_bytes,
                        embedder=emb_name,
                        ocr_text=ocr_str,
                        heading_deg=heading,
                        uploaded_by_id=owner_id,
                    )
                )
                node_has_photo.setdefault(tn, rel_img)
                photo_rows_created += 1

            if (idx + 1) % 45 == 0 or idx == len(scan_records) - 1:
                print(f"  Indexed {idx + 1}/{len(scan_records)} source photos...")

        # Ensure every single room node has a real corridor/door photo from its immediate facing/adjacent neighbour
        # so Cinema Street-View shows a real N Block corridor view on every room destination
        for lvl in range(4):
            for rnum in range(1, 19):
                rn = f"{lvl}{rnum:02d}"
                nid = f"nb:room-{rn}"
                if nid in node_has_photo:
                    continue
                # Find facing or adjacent room on the same floor & wing
                if rnum <= 10:
                    candidates = [f"nb:room-{lvl}{11 - rnum:02d}", f"nb:room-{lvl}{max(1, rnum - 1):02d}", f"nb:room-{lvl}{min(10, rnum + 1):02d}", f"nb:lobby-{lvl}"]
                else:
                    candidates = [f"nb:room-{lvl}{27 - rnum:02d}", f"nb:room-{lvl}{max(11, rnum - 1):02d}", f"nb:room-{lvl}{min(18, rnum + 1):02d}", f"nb:lobby-{lvl}"]
                fallback_rel = next((node_has_photo[c] for c in candidates if c in node_has_photo), None)
                if fallback_rel:
                    with Image.open(MEDIA_DIR / fallback_rel) as pim:
                        v = embedder_service.embed(pim)
                    session.add(
                        Photo(
                            venue_id=vid,
                            node_id=nid,
                            path=fallback_rel,
                            source="uploader",
                            quality=0.90,
                            embedding=embedder_service.to_bytes(v),
                            embedder=emb_name,
                            ocr_text="",
                            heading_deg=90.0 if rnum <= 10 else 0.0,
                            uploaded_by_id=owner_id,
                        )
                    )
                    node_has_photo[nid] = fallback_rel
                    photo_rows_created += 1

        session.commit()

        # Build 6 real 1-Click Visitor Test Sample Queries from real N Block photos
        sample_defs = [
            ("courtyard_entry", "Badminton Court & Entrance", "Ground Courtyard", 2),
            ("room_001", "Ground Wing A · Room 001", "Ground Floor Corridor", 19),
            ("room_014", "Ground Wing B · Room 014", "Ground Floor Wing B", 53),
            ("stairs_landing", "Central Granite Staircase", "Staircase Flight", 62),
            ("room_201", "2nd Floor · Rooms 201 & 210", "Second Floor Wing A", 120),
            ("room_314", "3rd Floor · Rooms 313 & 314", "Third Floor Wing B", 185),
        ]
        manifest = []
        for sid, label, hint, s_idx in sample_defs:
            fname = scan_records[s_idx]["filename"]
            rel_q = f"venues/{SLUG}/sample_queries/{sid}.jpg"
            save_clean_image((PICS_DIR / fname).read_bytes(), MEDIA_DIR / rel_q, max_side=1024)
            manifest.append(
                {
                    "id": sid,
                    "label": label,
                    "hint": hint,
                    "photo_url": f"/media/{rel_q}",
                }
            )
        (venue_media_root / "sample_queries" / "manifest.json").write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )

    elapsed = time.perf_counter() - t_start
    print(f"SUCCESS! Built 'N Block Hostel' ({SLUG}) with {photo_rows_created} indexed photo vectors in {elapsed:.1f}s.")


if __name__ == "__main__":
    main()

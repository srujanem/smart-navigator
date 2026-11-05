"""
Smart Destination & People Search:
- Resolves natural-language medical symptoms & everyday terms ("heart doctor" -> Cardiology, "x-ray" -> Radiology,
  "nearest washroom" -> closest washroom from current node, "medicine" -> Pharmacy, "bone fracture" -> Orthopaedics)
- Fuzzy-matches both Places (Nodes with is_place=True) and Staff/Doctors (Person directory, routing to moved_to_node_id when relocated).
"""
from __future__ import annotations

from typing import List, Optional
import re
from rapidfuzz import fuzz
from sqlmodel import Session, select

from ..models import Building, Closure, Edge, Node, Person, SearchLog, Venue
from .routing import find_nearest_matching_nodes

SYMPTOM_SYNONYMS: list[tuple[tuple[str, ...], str, str]] = [
    (("heart", "cardiac", "chest pain", "ecg", "echo", "bp", "blood pressure", "cardiologist"), "cardiology", "Heart / Chest -> Cardiology"),
    (("bone", "fracture", "joint", "knee", "spine", "ortho", "orthopaedic", "orthopedic"), "orthopaedics", "Bone & Joint -> Orthopaedics"),
    (("xray", "x-ray", "mri", "ct scan", "ultrasound", "sonography", "scan", "imaging"), "radiology", "Imaging / Scan -> Radiology"),
    (("child", "baby", "kids", "pediatric", "paediatric", "vaccination", "vaccine"), "paediatrics", "Child Care -> Paediatrics"),
    (("brain", "neuro", "headache", "migraine", "stroke", "nerve"), "neurology", "Brain & Nerve -> Neurology"),
    (("medicine", "chemist", "drug", "tablet", "prescription", "medical store"), "pharmacy", "Medicines -> Pharmacy 24x7"),
    (("blood test", "sample", "lab test", "urine", "pathology", "diagnostic"), "pathology", "Lab Tests -> Pathology Lab"),
    (("bill", "cash", "payment", "insurance", "tpa", "discharge", "receipt"), "billing", "Payments & TPA -> Billing Counter"),
    (("accident", "trauma", "casualty", "urgent", "bleeding", "ambulance"), "emergency", "Urgent Care -> Emergency 24x7"),
    (("food", "eat", "coffee", "tea", "snack", "lunch", "dinner", "mess", "hungry"), "cafeteria canteen dining", "Food & Refreshments -> Cafeteria / Canteen"),
    (("toilet", "restroom", "loo", "wc", "bathroom", "washroom"), "washroom", "Restroom -> Washroom"),
    (("elevator", "lift"), "lift", "Elevator -> Lift"),
    (("book", "study", "reading"), "library", "Study -> Library"),
    (("dean", "hod", "principal", "warden", "admin"), "office warden", "Administration -> Office"),
]

NEAREST_SYNONYMS = {
    "washroom": ("washroom",),
    "toilet": ("washroom",),
    "restroom": ("washroom",),
    "lift": ("lift",),
    "elevator": ("lift",),
    "stairs": ("stairs",),
    "staircase": ("stairs",),
    "exit": ("exit", "entrance", "emergency"),
    "emergency": ("emergency",),
    "pharmacy": ("pharmacy",),
}


def search_venue(
    session: Session,
    venue: Venue,
    q: str,
    from_node: Optional[str] = None,
) -> dict:
    query = q.strip()
    nodes = session.exec(select(Node).where(Node.venue_id == venue.id)).all()
    people = session.exec(select(Person).where(Person.venue_id == venue.id)).all()
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == venue.id)).all()}
    node_map = {n.id: n for n in nodes}

    if not query:
        # Return curated featured places + available doctors
        results: list[dict] = []
        for p in people[:5]:
            dest_id = p.moved_to_node_id if (p.status == "moved" and p.moved_to_node_id) else p.node_id
            loc_n = node_map.get(dest_id) or node_map.get(p.node_id)
            loc_label = f"{loc_n.name} · Floor {loc_n.level}" if loc_n else p.department
            results.append({
                "type": "person",
                "id": p.id,
                "name": p.name,
                "subtitle": f"{p.title} ({p.department}) · {loc_label}",
                "node_id": dest_id,
                "score": 0.95,
                "status": p.status,
            })
        for n in [nd for nd in nodes if nd.is_place and nd.kind not in ("corridor", "stairs")][:8]:
            results.append({
                "type": "place",
                "id": n.id,
                "name": n.name,
                "subtitle": f"{buildings.get(n.building_id, '')} · Floor {n.level}",
                "node_id": n.id,
                "score": 0.9,
            })
        return {"query": query, "interpreted": None, "results": results}

    q_low = query.lower()
    interpreted: Optional[str] = None

    # 1. Handle "nearest <kind>" intent using real shortest-path distance
    near_m = re.search(r"\b(?:nearest|closest|nearby)\s+([a-z]+)", q_low)
    if near_m:
        kw = near_m.group(1)
        kinds = NEAREST_SYNONYMS.get(kw)
        if kinds:
            edges = session.exec(select(Edge).where(Edge.venue_id == venue.id)).all()
            closed = {c.edge_id for c in session.exec(select(Closure).where(Closure.venue_id == venue.id)).all()}
            origin = from_node or venue.entrance_node_id or (nodes[0].id if nodes else "")
            nearest = find_nearest_matching_nodes(
                nodes,
                edges,
                closed,
                origin,
                lambda nd: nd.kind in kinds or (nd.category in kinds) or any(k in nd.name.lower() for k in kinds),
            )
            if nearest:
                interpreted = f"Nearest {kw} sorted by walking distance"
                res = [
                    {
                        "type": "place",
                        "id": nd.id,
                        "name": nd.name,
                        "subtitle": f"{int(round(dist))}m away · {buildings.get(nd.building_id, '')} · Floor {nd.level}",
                        "node_id": nd.id,
                        "score": round(max(0.6, 1.0 - idx * 0.08), 3),
                    }
                    for idx, (dist, nd) in enumerate(nearest[:5])
                ]
                return {"query": query, "interpreted": interpreted, "results": res}

    # 2. Expand medical / campus synonyms
    expanded_terms: list[str] = [q_low]
    for triggers, target_kw, label in SYMPTOM_SYNONYMS:
        if any(t in q_low for t in triggers):
            expanded_terms.append(target_kw)
            if interpreted is None:
                interpreted = label

    results_scored: list[dict] = []

    # Score People (Doctors, Faculty, Officers)
    for p in people:
        hay = f"{p.name} {p.title} {p.department} {p.role} {p.keywords}".lower()
        score = _best_fuzzy(expanded_terms, hay, p.name.lower())
        if score >= 0.56:
            dest_id = p.moved_to_node_id if (p.status == "moved" and p.moved_to_node_id) else p.node_id
            loc_n = node_map.get(dest_id) or node_map.get(p.node_id)
            loc_txt = f"{loc_n.name} (Floor {loc_n.level})" if loc_n else p.node_id
            note = f" · {p.status_note}" if p.status_note else ""
            results_scored.append({
                "type": "person",
                "id": p.id,
                "name": p.name,
                "subtitle": f"{p.title}, {p.department} · {loc_txt}{note}",
                "node_id": dest_id,
                "score": round(score, 3),
                "status": p.status,
            })

    # Score Places
    for n in nodes:
        if not n.is_place and n.kind == "corridor":
            continue
        hay = f"{n.name} {n.kind} {n.category or ''} {n.keywords}".lower()
        score = _best_fuzzy(expanded_terms, hay, n.name.lower())
        if score >= 0.54:
            results_scored.append({
                "type": "place",
                "id": n.id,
                "name": n.name,
                "subtitle": f"{buildings.get(n.building_id, '')} · Floor {n.level}",
                "node_id": n.id,
                "score": round(score, 3),
            })

    results_scored.sort(key=lambda r: (r["score"], 1 if r["type"] == "person" else 0), reverse=True)
    top = results_scored[:12]

    if len(query) >= 3:
        session.add(SearchLog(venue_id=venue.id, query=query[:80], results=len(top)))
        session.commit()

    return {"query": query, "interpreted": interpreted, "results": top}


def _best_fuzzy(terms: List[str], haystack: str, primary_name: str) -> float:
    best = 0.0
    for t in terms:
        if t in primary_name:
            best = max(best, 0.98)
        elif t in haystack:
            best = max(best, 0.91)
        else:
            r1 = fuzz.WRatio(t, primary_name) / 100.0
            r2 = fuzz.partial_ratio(t, haystack) / 100.0 if len(t) >= 4 else 0.0
            best = max(best, 0.92 * r1, 0.85 * r2)
    return min(0.99, best)

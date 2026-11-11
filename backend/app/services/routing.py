"""
Multi-floor, multi-building A* spatial router with:
- Admissible 3D Euclidean + floor-transition heuristic (real A*, not Dijkstra)
- Accessibility profiles: 'walk' | 'wheelchair' (step-free) | 'stretcher' (wide corridors & bed lifts)
- Crowd-aware routing ('avoid_crowds') using live corridor traversal density
- Camera heading ('heading_deg') relative orientation hint on Step 1 ("From your photo view, turn right...")
- Real-time corridor/lift closures + bypassed-hazard detection
- Multi-target 1-Tap Nearest Facility / Emergency SOS routing
- Multi-stop Itinerary Trip Planner with optional waypoint order optimization
"""
from __future__ import annotations

from collections import Counter
import math
from typing import Dict, List, Optional
import networkx as nx
from sqlmodel import Session, select

from ..config import WALK_SPEED, WHEELCHAIR_SPEED
from ..models import Building, Closure, Edge, Floor, LocalizeLog, Node, Photo, RouteLog, Venue

STRETCHER_SPEED = 0.82


def ensure_venue_graph_connected(session: Session, venue: Venue) -> dict:
    """
    Guarantees that all nodes on every floor of `venue` form a connected walkable graph
    (auto-creating corridor spine links and room-to-corridor doors when an uploader adds rooms
    or uploads walkthrough videos without manually drawing every edge), and links multi-floor
    stairs/lifts vertically across levels.
    """
    nodes = list(session.exec(select(Node).where(Node.venue_id == venue.id)).all())
    edges = list(session.exec(select(Edge).where(Edge.venue_id == venue.id)).all())
    if len(nodes) <= 1:
        return {"edges_created": 0, "total_nodes": len(nodes), "total_edges": len(edges)}

    existing_pairs: set[tuple[str, str]] = set()
    for e in edges:
        existing_pairs.add((e.source, e.target))
        existing_pairs.add((e.target, e.source))

    created_edges = 0

    def _add_edge(na: Node, nb: Node, kind: str = "walk") -> None:
        nonlocal created_edges
        if na.id == nb.id or (na.id, nb.id) in existing_pairs:
            return
        if na.level != nb.level:
            dist = round(6.0 * abs(na.level - nb.level), 1)
            e_kind = kind if kind in ("stairs", "lift") else "stairs"
            acc = e_kind == "lift"
        else:
            dist = round(max(2.0, math.hypot(na.x - nb.x, na.y - nb.y)), 1)
            e_kind = kind
            acc = True
        new_e = Edge(
            venue_id=venue.id,
            source=na.id,
            target=nb.id,
            distance=dist,
            kind=e_kind,
            accessible=acc,
            stretcher_ok=acc,
        )
        session.add(new_e)
        edges.append(new_e)
        existing_pairs.add((na.id, nb.id))
        existing_pairs.add((nb.id, na.id))
        created_edges += 1

    # 1. Per-floor connectivity (connect backbone transit nodes, then attach each room/place to nearest backbone)
    by_floor: Dict[str, list[Node]] = {}
    for n in nodes:
        by_floor.setdefault(n.floor_id, []).append(n)

    backbone_kinds = {"corridor", "junction", "lobby", "entrance", "stairs", "lift", "exit"}
    for fl_id, fl_nodes in by_floor.items():
        if len(fl_nodes) <= 1:
            continue
        fl_ids = {n.id for n in fl_nodes}
        G_fl = nx.Graph()
        for n in fl_nodes:
            G_fl.add_node(n.id)
        for e in edges:
            if e.source in fl_ids and e.target in fl_ids:
                G_fl.add_edge(e.source, e.target)

        if nx.is_connected(G_fl):
            continue

        backbone = [n for n in fl_nodes if n.kind in backbone_kinds]
        rooms = [n for n in fl_nodes if n.kind not in backbone_kinds]

        # Step 1a: Connect all backbone nodes on this floor via minimum spanning tree (Prim's)
        if len(backbone) >= 2:
            bb_ids = {n.id for n in backbone}
            G_bb = G_fl.subgraph(bb_ids).copy()
            comps = [set(c) for c in nx.connected_components(G_bb)]
            node_by_id = {n.id: n for n in fl_nodes}
            while len(comps) > 1:
                best_pair = None
                best_d = float("inf")
                c0 = comps[0]
                for other_c in comps[1:]:
                    for id_a in c0:
                        na = node_by_id[id_a]
                        for id_b in other_c:
                            nb = node_by_id[id_b]
                            d = math.hypot(na.x - nb.x, na.y - nb.y)
                            if d < best_d:
                                best_d = d
                                best_pair = (na, nb, other_c)
                if not best_pair:
                    break
                na, nb, merged_c = best_pair
                _add_edge(na, nb, "walk")
                G_fl.add_edge(na.id, nb.id)
                c0 |= merged_c
                comps.remove(merged_c)

        # Step 1b: Connect every isolated room/place to its nearest backbone node (or nearest room if no backbone)
        for rm in rooms:
            if G_fl.degree(rm.id) == 0:
                targets = backbone if backbone else [n for n in fl_nodes if n.id != rm.id]
                if targets:
                    nearest = min(targets, key=lambda t: math.hypot(rm.x - t.x, rm.y - t.y))
                    _add_edge(rm, nearest, "walk")
                    G_fl.add_edge(rm.id, nearest.id)

        # Step 1c: If multiple connected components still remain on this floor, bridge them
        node_by_id = {n.id: n for n in fl_nodes}
        comps_all = [set(c) for c in nx.connected_components(G_fl)]
        while len(comps_all) > 1:
            best_pair = None
            best_d = float("inf")
            c0 = comps_all[0]
            for other_c in comps_all[1:]:
                for id_a in c0:
                    na = node_by_id[id_a]
                    for id_b in other_c:
                        nb = node_by_id[id_b]
                        d = math.hypot(na.x - nb.x, na.y - nb.y)
                        if d < best_d:
                            best_d = d
                            best_pair = (na, nb, other_c)
            if not best_pair:
                break
            na, nb, merged_c = best_pair
            _add_edge(na, nb, "walk")
            G_fl.add_edge(na.id, nb.id)
            c0 |= merged_c
            comps_all.remove(merged_c)

    # 2. Multi-floor vertical connectivity (link stairs/lifts/lobbies across adjacent levels)
    by_level: Dict[int, list[Node]] = {}
    for n in nodes:
        by_level.setdefault(n.level, []).append(n)
    sorted_levels = sorted(by_level.keys())
    for i in range(len(sorted_levels) - 1):
        lv_a, lv_b = sorted_levels[i], sorted_levels[i + 1]
        nodes_a, nodes_b = by_level[lv_a], by_level[lv_b]
        ids_a = {n.id for n in nodes_a}
        ids_b = {n.id for n in nodes_b}
        has_inter = any(
            (e.source in ids_a and e.target in ids_b) or (e.source in ids_b and e.target in ids_a)
            for e in edges
        )
        if not has_inter:
            for v_kind in ("stairs", "lift", "lobby", "entrance"):
                cand_a = [n for n in nodes_a if n.kind == v_kind]
                cand_b = [n for n in nodes_b if n.kind == v_kind]
                if cand_a and cand_b:
                    na = cand_a[0]
                    nb = min(cand_b, key=lambda t: math.hypot(na.x - t.x, na.y - t.y))
                    _add_edge(na, nb, "lift" if v_kind == "lift" else "stairs")
                    has_inter = True
            if not has_inter and nodes_a and nodes_b:
                _add_edge(nodes_a[0], nodes_b[0], "stairs")

    if created_edges > 0:
        session.commit()

    return {
        "edges_created": created_edges,
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }


def _build_nx_graph(
    nodes: List[Node],
    edges: List[Edge],
    closed_edge_ids: set[str],
    profile: str = "walk",
    ignore_closures: bool = False,
    crowd_by_node: Optional[Dict[str, int]] = None,
) -> nx.Graph:
    G = nx.Graph()
    for n in nodes:
        G.add_node(n.id, node=n)
    for e in edges:
        if not ignore_closures and e.id in closed_edge_ids:
            continue
        if profile == "wheelchair" and (not e.accessible or e.kind == "stairs"):
            continue
        if profile == "stretcher":
            stretcher_ok = getattr(e, "stretcher_ok", True)
            if not e.accessible or not stretcher_ok or e.kind == "stairs":
                continue
        w = float(e.distance)
        if crowd_by_node:
            c_load = crowd_by_node.get(e.source, 0) + crowd_by_node.get(e.target, 0)
            if c_load > 0:
                # Penalize congested corridors/lifts smoothly while keeping shortest-path heuristic admissible
                w *= 1.0 + min(1.5, 0.14 * c_load)
        G.add_edge(e.source, e.target, weight=w, distance=float(e.distance), edge=e)
    return G


def _compute_crowd_counts(session: Session, venue_id: str) -> Dict[str, int]:
    traversal: Counter[str] = Counter()
    routes = session.exec(select(RouteLog).where(RouteLog.venue_id == venue_id)).all()
    loc_logs = session.exec(select(LocalizeLog).where(LocalizeLog.venue_id == venue_id)).all()
    for r in routes[-80:]:
        for nid in r.path.split():
            traversal[nid] += 1
    for l in loc_logs[-40:]:
        if l.predicted_node:
            traversal[l.predicted_node] += 2
    return dict(traversal)


def _turn_icon(prev_n: Node, curr_n: Node, next_n: Node) -> tuple[str, str]:
    v1x, v1y = curr_n.x - prev_n.x, curr_n.y - prev_n.y
    v2x, v2y = next_n.x - curr_n.x, next_n.y - curr_n.y
    m1, m2 = math.hypot(v1x, v1y), math.hypot(v2x, v2y)
    if m1 < 1e-3 or m2 < 1e-3:
        return "straight", "Go straight"
    # Screen/plan coords have +y downwards; cross > 0 => clockwise (right turn)
    cross = (v1x * v2y - v1y * v2x) / (m1 * m2)
    dot = (v1x * v2x + v1y * v2y) / (m1 * m2)
    if dot > 0.78 or abs(cross) < 0.35:
        return "straight", "Go straight"
    if cross > 0:
        return "right", "Turn right"
    return "left", "Turn left"


def _relative_heading_hint(heading_deg: float, start_n: Node, next_n: Node) -> Optional[str]:
    dx = next_n.x - start_n.x
    dy = next_n.y - start_n.y
    if math.hypot(dx, dy) < 1e-3:
        return None
    # Floorplan azimuth: 0° = North (-y), 90° = East (+x), 180° = South (+y), 270° = West (-x)
    move_deg = (math.degrees(math.atan2(dx, -dy)) + 360.0) % 360.0
    rel = (move_deg - (heading_deg % 360.0) + 540.0) % 360.0 - 180.0
    if -35 <= rel <= 35:
        return f"From the view in your photo, walk straight ahead (12 o'clock) towards {next_n.name}."
    if 35 < rel <= 135:
        return f"From the view in your photo, turn right (3 o'clock) towards {next_n.name}."
    if -135 <= rel < -35:
        return f"From the view in your photo, turn left (9 o'clock) towards {next_n.name}."
    return f"From the view in your photo, turn around (6 o'clock) behind you towards {next_n.name}."


def _speed_for_profile(profile: str) -> float:
    if profile == "stretcher":
        return STRETCHER_SPEED
    if profile == "wheelchair":
        return WHEELCHAIR_SPEED
    return WALK_SPEED


def compute_venue_route(
    session: Session,
    venue: Venue,
    from_node: str,
    to_node: str,
    profile: str = "walk",
    record_log: bool = True,
    avoid_crowds: bool = False,
    heading_deg: Optional[float] = None,
) -> dict:
    if profile not in ("walk", "wheelchair", "stretcher"):
        profile = "walk"

    nodes = session.exec(select(Node).where(Node.venue_id == venue.id)).all()
    edges = session.exec(select(Edge).where(Edge.venue_id == venue.id)).all()
    closures = session.exec(select(Closure).where(Closure.venue_id == venue.id)).all()
    photos = session.exec(select(Photo).where(Photo.venue_id == venue.id)).all()
    buildings = {b.id: b.name for b in session.exec(select(Building).where(Building.venue_id == venue.id)).all()}

    node_map: Dict[str, Node] = {n.id: n for n in nodes}
    if from_node not in node_map:
        raise ValueError(f"Unknown start location '{from_node}'")
    if to_node not in node_map:
        raise ValueError(f"Unknown destination '{to_node}'")

    node_photo: Dict[str, str] = {}
    for p in sorted(photos, key=lambda x: x.quality, reverse=True):
        if p.node_id not in node_photo:
            thumb = p.thumbnail_path if (getattr(p, "media_type", "photo") == "video" and p.thumbnail_path) else p.path
            node_photo[p.node_id] = f"/media/{thumb}"

    closed_ids = {c.edge_id for c in closures}
    closure_by_edge = {c.edge_id: c for c in closures}
    crowd_map = _compute_crowd_counts(session, venue.id) if avoid_crowds else None

    G = _build_nx_graph(
        nodes,
        edges,
        closed_ids,
        profile=profile,
        ignore_closures=False,
        crowd_by_node=crowd_map,
    )

    def heuristic(u: str, v: str) -> float:
        nu, nv = node_map[u], node_map[v]
        planar = 0.2 * math.hypot(nu.x - nv.x, nu.y - nv.y)
        vertical = 3.5 * abs(nu.level - nv.level)
        return planar + vertical

    if from_node == to_node:
        n0 = node_map[from_node]
        return {
            "from_node": from_node,
            "to_node": to_node,
            "profile": profile,
            "distance_m": 0.0,
            "eta_s": 0,
            "path": [from_node],
            "levels": [n0.level],
            "steps": [{
                "index": 0,
                "node_id": n0.id,
                "name": n0.name,
                "instruction": f"You are already at {n0.name}.",
                "icon": "arrive",
                "distance_m": 0.0,
                "level": n0.level,
                "photo_url": node_photo.get(n0.id),
            }],
            "alternatives": [],
            "closures_avoided": 0,
            "notice": None,
            "orientation_hint": None,
        }

    try:
        path = nx.astar_path(G, from_node, to_node, heuristic=heuristic, weight="weight")
    except nx.NetworkXNoPath as exc:
        # Self-heal unlinked nodes if no closures exist or if nodes are disconnected even without closures
        G_check = _build_nx_graph(nodes, edges, set(), profile="walk", ignore_closures=True)
        if not nx.has_path(G_check, from_node, to_node):
            heal = ensure_venue_graph_connected(session, venue)
            if heal.get("edges_created", 0) > 0:
                edges = session.exec(select(Edge).where(Edge.venue_id == venue.id)).all()
                G = _build_nx_graph(
                    nodes,
                    edges,
                    closed_ids,
                    profile=profile,
                    ignore_closures=False,
                    crowd_by_node=crowd_map,
                )
        try:
            path = nx.astar_path(G, from_node, to_node, heuristic=heuristic, weight="weight")
        except nx.NetworkXNoPath:
            if profile == "stretcher":
                raise ValueError("No stretcher-accessible wide corridor & bed-lift route available.") from exc
            if profile == "wheelchair":
                raise ValueError("No step-free (lift/ramp) route available — a lift on this path may be closed for maintenance.") from exc
            raise ValueError("No walkable route available between these locations due to active closures.") from exc

    closures_avoided = 0
    notices: list[str] = []
    if closed_ids:
        G_open = _build_nx_graph(nodes, edges, closed_ids, profile=profile, ignore_closures=True)
        try:
            open_path = nx.astar_path(G_open, from_node, to_node, heuristic=heuristic, weight="weight")
            avoided_reasons: list[str] = []
            for i in range(len(open_path) - 1):
                ed = G_open.get_edge_data(open_path[i], open_path[i + 1])
                e_obj: Edge = ed["edge"]
                if e_obj.id in closure_by_edge:
                    closures_avoided += 1
                    r = closure_by_edge[e_obj.id].reason
                    if r and r not in avoided_reasons:
                        avoided_reasons.append(r)
            if closures_avoided > 0:
                reason_txt = f" ({'; '.join(avoided_reasons)})" if avoided_reasons else ""
                notices.append(f"Automatically rerouted around {closures_avoided} closed passage(s){reason_txt}.")
        except nx.NetworkXNoPath:
            pass

    if avoid_crowds and crowd_map:
        G_direct = _build_nx_graph(nodes, edges, closed_ids, profile=profile, ignore_closures=False, crowd_by_node=None)
        try:
            direct_path = nx.astar_path(G_direct, from_node, to_node, heuristic=heuristic, weight="weight")
            if direct_path != path:
                notices.append("Quiet route selected — bypassing high-traffic corridors.")
        except nx.NetworkXNoPath:
            pass

    speed = _speed_for_profile(profile)
    total_dist = round(float(sum(G[path[i]][path[i + 1]]["distance"] for i in range(len(path) - 1))), 1)
    eta_s = max(5, int(round(total_dist / speed)))

    orientation_hint: Optional[str] = None
    if heading_deg is not None and len(path) >= 2:
        orientation_hint = _relative_heading_hint(heading_deg, node_map[path[0]], node_map[path[1]])

    steps = _build_steps(path, G, node_map, node_photo, buildings, orientation_hint=orientation_hint)
    levels = sorted({node_map[nid].level for nid in path})

    alternatives: list[dict] = []
    try:
        for cand_path in nx.shortest_simple_paths(G, from_node, to_node, weight="weight"):
            if cand_path == path:
                continue
            shared_ratio = len(set(cand_path) & set(path)) / float(max(len(cand_path), len(path)))
            cand_dist = round(float(sum(G[cand_path[i]][cand_path[i + 1]]["distance"] for i in range(len(cand_path) - 1))), 1)
            if cand_dist > total_dist * 2.4:
                break
            if shared_ratio < 0.92:
                edge_kinds = {G[cand_path[i]][cand_path[i + 1]]["edge"].kind for i in range(len(cand_path) - 1)}
                if "lift" in edge_kinds and "stairs" not in edge_kinds:
                    label = "Via Elevator"
                elif "stairs" in edge_kinds:
                    label = "Via Staircase"
                else:
                    label = f"Alternative Route {len(alternatives) + 1}"
                alternatives.append({
                    "path": cand_path,
                    "distance_m": cand_dist,
                    "eta_s": max(5, int(round(cand_dist / speed))),
                    "label": label,
                })
            if len(alternatives) >= 2:
                break
    except nx.NetworkXNoPath:
        pass

    if record_log:
        session.add(RouteLog(
            venue_id=venue.id,
            from_node=from_node,
            to_node=to_node,
            path=" ".join(path),
        ))
        session.commit()

    return {
        "from_node": from_node,
        "to_node": to_node,
        "profile": profile,
        "distance_m": total_dist,
        "eta_s": eta_s,
        "path": path,
        "levels": levels,
        "steps": steps,
        "alternatives": alternatives,
        "closures_avoided": closures_avoided,
        "notice": " ".join(notices) if notices else None,
        "orientation_hint": orientation_hint,
    }


def _build_steps(
    path: List[str],
    G: nx.Graph,
    node_map: Dict[str, Node],
    node_photo: Dict[str, str],
    buildings: Dict[str, str],
    orientation_hint: Optional[str] = None,
) -> list[dict]:
    steps: list[dict] = []
    start = node_map[path[0]]
    start_instr = f"Start at {start.name} ({buildings.get(start.building_id, '')}, Floor {start.level})."
    if orientation_hint:
        start_instr = f"{start_instr} {orientation_hint}"
    steps.append({
        "index": 0,
        "node_id": start.id,
        "name": start.name,
        "instruction": start_instr,
        "icon": "start",
        "distance_m": 0.0,
        "level": start.level,
        "photo_url": node_photo.get(start.id),
    })

    for i in range(len(path) - 1):
        curr_n = node_map[path[i]]
        next_n = node_map[path[i + 1]]
        ed = G[path[i]][path[i + 1]]
        dist = round(float(ed["distance"]), 1)
        e_obj: Edge = ed["edge"]
        is_last = i == len(path) - 2

        if curr_n.level != next_n.level:
            if e_obj.kind == "lift":
                icon = "lift"
                instr = f"Take elevator to Floor {next_n.level} ({next_n.name})."
            else:
                icon = "up" if next_n.level > curr_n.level else "down"
                direction_word = "up" if next_n.level > curr_n.level else "down"
                instr = f"Take stairs {direction_word} to Floor {next_n.level} ({next_n.name})."
        elif curr_n.building_id != next_n.building_id or e_obj.kind == "outdoor":
            icon = "straight"
            instr = f"Walk {dist}m via covered walkway into {buildings.get(next_n.building_id, next_n.name)} ({next_n.name})."
        elif is_last:
            if i >= 1:
                turn_ic, turn_phrase = _turn_icon(node_map[path[i - 1]], curr_n, next_n)
                icon = "arrive" if turn_ic == "straight" else turn_ic
                instr = f"{turn_phrase} {dist}m to arrive at {next_n.name} (Destination)."
            else:
                icon = "arrive"
                instr = f"Walk {dist}m straight to arrive at {next_n.name} (Destination)."
        else:
            if i >= 1:
                icon, phrase = _turn_icon(node_map[path[i - 1]], curr_n, next_n)
                instr = f"{phrase} and walk {dist}m towards {next_n.name}."
            else:
                icon = "straight"
                instr = f"Go straight {dist}m towards {next_n.name}."

        # Find photo for node, or fall back to neighboring place photo if node is an un-photographed corridor junction
        step_photo = node_photo.get(next_n.id)
        if not step_photo and next_n.id in G:
            for nb in G.neighbors(next_n.id):
                if nb in node_photo:
                    step_photo = node_photo[nb]
                    break

        steps.append({
            "index": i + 1,
            "node_id": next_n.id,
            "name": next_n.name,
            "instruction": instr,
            "icon": icon,
            "distance_m": dist,
            "level": next_n.level,
            "photo_url": step_photo,
        })

    return steps


def find_nearest_matching_nodes(
    nodes: List[Node],
    edges: List[Edge],
    closed_ids: set[str],
    from_node: str,
    predicate,
    profile: str = "walk",
) -> list[tuple[float, Node]]:
    G = _build_nx_graph(nodes, edges, closed_ids, profile=profile)
    if from_node not in G:
        return [(0.0, n) for n in nodes if predicate(n)]
    lengths = nx.single_source_dijkstra_path_length(G, from_node, weight="weight")
    hits = [(float(lengths[n.id]), n) for n in nodes if predicate(n) and n.id in lengths]
    hits.sort(key=lambda t: t[0])
    return hits


FACILITY_MATCHERS = {
    "exit": ("exit", "entrance", "gate", "emergency"),
    "emergency": ("emergency", "trauma", "casualty", "first aid"),
    "washroom": ("washroom", "restroom", "toilet", "wc"),
    "restroom": ("washroom", "restroom", "toilet", "wc"),
    "lift": ("lift", "elevator"),
    "pharmacy": ("pharmacy", "chemist", "medicine"),
    "helpdesk": ("reception", "help", "desk", "enquiry", "billing", "office"),
}


def compute_nearest_facility_route(
    session: Session,
    venue: Venue,
    from_node: str,
    target_kind: str,
    profile: str = "walk",
    avoid_crowds: bool = False,
    heading_deg: Optional[float] = None,
) -> dict:
    nodes = session.exec(select(Node).where(Node.venue_id == venue.id)).all()
    edges = session.exec(select(Edge).where(Edge.venue_id == venue.id)).all()
    closed_ids = {c.edge_id for c in session.exec(select(Closure).where(Closure.venue_id == venue.id)).all()}

    terms = FACILITY_MATCHERS.get(target_kind.lower().strip(), (target_kind.lower().strip(),))

    def _matches(n: Node) -> bool:
        if n.id == from_node and len(nodes) > 1:
            return False
        blob = f"{n.kind} {n.category or ''} {n.name} {n.keywords}".lower()
        return any(t in blob for t in terms)

    hits = find_nearest_matching_nodes(nodes, edges, closed_ids, from_node, _matches, profile=profile)
    if not hits:
        # Fallback if emergency_node_id or entrance_node_id matches intent
        if target_kind in ("emergency", "exit") and venue.emergency_node_id:
            target_id = venue.emergency_node_id
        elif target_kind == "exit" and venue.entrance_node_id:
            target_id = venue.entrance_node_id
        else:
            raise ValueError(f"No reachable '{target_kind}' facility found on this venue map.")
    else:
        target_id = hits[0][1].id

    return compute_venue_route(
        session,
        venue,
        from_node=from_node,
        to_node=target_id,
        profile=profile,
        record_log=True,
        avoid_crowds=avoid_crowds,
        heading_deg=heading_deg,
    )


def compute_multistop_route(
    session: Session,
    venue: Venue,
    stops: List[str],
    profile: str = "walk",
    optimize: bool = False,
    avoid_crowds: bool = False,
    heading_deg: Optional[float] = None,
) -> dict:
    # Deduplicate consecutive identical stops while preserving start
    cleaned: list[str] = []
    for s in stops:
        if s and (not cleaned or cleaned[-1] != s):
            cleaned.append(s)
    if len(cleaned) < 2:
        raise ValueError("At least 2 distinct stops (start + 1 destination) are required.")

    nodes = session.exec(select(Node).where(Node.venue_id == venue.id)).all()
    edges = session.exec(select(Edge).where(Edge.venue_id == venue.id)).all()
    closed_ids = {c.edge_id for c in session.exec(select(Closure).where(Closure.venue_id == venue.id)).all()}
    node_map = {n.id: n for n in nodes}

    for s in cleaned:
        if s not in node_map:
            raise ValueError(f"Unknown stop '{s}'")

    ordered = list(cleaned)
    if optimize and len(ordered) >= 3:
        # Nearest-neighbour ordering starting from ordered[0]
        G = _build_nx_graph(nodes, edges, closed_ids, profile=profile)
        start = ordered[0]
        remaining = list(dict.fromkeys(ordered[1:]))
        ordered = [start]
        curr = start
        while remaining:
            lengths = nx.single_source_dijkstra_path_length(G, curr, weight="weight") if curr in G else {}
            remaining.sort(key=lambda cand: lengths.get(cand, 1e9))
            nxt = remaining.pop(0)
            ordered.append(nxt)
            curr = nxt

    combined_path: list[str] = []
    combined_steps: list[dict] = []
    legs: list[dict] = []
    total_dist = 0.0
    total_eta = 0
    closures_avoided = 0
    notices: list[str] = []

    for idx in range(len(ordered) - 1):
        a, b = ordered[idx], ordered[idx + 1]
        leg = compute_venue_route(
            session,
            venue,
            from_node=a,
            to_node=b,
            profile=profile,
            record_log=(idx == 0),
            avoid_crowds=avoid_crowds,
            heading_deg=heading_deg if idx == 0 else None,
        )
        total_dist += float(leg["distance_m"])
        total_eta += int(leg["eta_s"])
        closures_avoided += int(leg["closures_avoided"])
        if leg.get("notice") and leg["notice"] not in notices:
            notices.append(leg["notice"])

        if idx == 0:
            combined_path.extend(leg["path"])
        else:
            combined_path.extend(leg["path"][1:])

        for st_i, st in enumerate(leg["steps"]):
            if idx > 0 and st_i == 0:
                continue
            step_copy = dict(st)
            step_copy["index"] = len(combined_steps)
            if st_i == len(leg["steps"]) - 1 and idx < len(ordered) - 2:
                step_copy["instruction"] = f"Stop {idx + 1} reached: {node_map[b].name}. When ready, continue to Stop {idx + 2} ({node_map[ordered[idx + 2]].name})."
            combined_steps.append(step_copy)

        legs.append({
            "leg_index": idx,
            "from_node": a,
            "from_name": node_map[a].name,
            "to_node": b,
            "to_name": node_map[b].name,
            "distance_m": leg["distance_m"],
            "eta_s": leg["eta_s"],
            "path": leg["path"],
        })

    levels = sorted({node_map[nid].level for nid in combined_path if nid in node_map})
    return {
        "from_node": ordered[0],
        "to_node": ordered[-1],
        "stops": ordered,
        "legs": legs,
        "profile": profile,
        "distance_m": round(total_dist, 1),
        "eta_s": total_eta,
        "path": combined_path,
        "levels": levels,
        "steps": combined_steps,
        "alternatives": [],
        "closures_avoided": closures_avoided,
        "notice": " ".join(notices) if notices else None,
    }

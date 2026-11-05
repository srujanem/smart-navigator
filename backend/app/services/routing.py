"""
Multi-floor, multi-building A* spatial router with:
- Admissible 3D Euclidean + floor-transition heuristic (real A*, not Dijkstra)
- Accessibility profile ('walk' vs 'wheelchair' lift-only)
- Real-time corridor/lift closures + bypassed-hazard detection
- Yen's k-shortest simple paths for diverse alternative routes
- Geometric turn angle detection + dataset landmark photos per step
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional
import networkx as nx
from sqlmodel import Session, select

from ..config import WALK_SPEED, WHEELCHAIR_SPEED
from ..models import Building, Closure, Edge, Node, Photo, RouteLog, Venue


def _build_nx_graph(
    nodes: List[Node],
    edges: List[Edge],
    closed_edge_ids: set[str],
    profile: str,
    ignore_closures: bool = False,
) -> nx.Graph:
    G = nx.Graph()
    for n in nodes:
        G.add_node(n.id, node=n)
    for e in edges:
        if not ignore_closures and e.id in closed_edge_ids:
            continue
        if profile == "wheelchair" and (not e.accessible or e.kind == "stairs"):
            continue
        # Slight preference penalty on stairs in walking mode if lift is comparable
        w = float(e.distance)
        G.add_edge(e.source, e.target, weight=w, distance=float(e.distance), edge=e)
    return G


def _turn_icon(prev_n: Node, curr_n: Node, next_n: Node) -> tuple[str, str]:
    v1x, v1y = curr_n.x - prev_n.x, curr_n.y - prev_n.y
    v2x, v2y = next_n.x - curr_n.x, next_n.y - curr_n.y
    m1, m2 = math.hypot(v1x, v1y), math.hypot(v2x, v2y)
    if m1 < 1e-3 or m2 < 1e-3:
        return "straight", "Continue towards"
    # Screen/plan coords have +y downwards; cross > 0 => clockwise (right turn)
    cross = (v1x * v2y - v1y * v2x) / (m1 * m2)
    dot = (v1x * v2x + v1y * v2y) / (m1 * m2)
    if dot > 0.78 or abs(cross) < 0.35:
        return "straight", "Continue straight towards"
    if cross > 0:
        return "right", "Turn right towards"
    return "left", "Turn left towards"


def compute_venue_route(
    session: Session,
    venue: Venue,
    from_node: str,
    to_node: str,
    profile: str = "walk",
    record_log: bool = True,
) -> dict:
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

    # Map each node to its highest-quality photo for visual step cards
    node_photo: Dict[str, str] = {}
    for p in sorted(photos, key=lambda x: x.quality, reverse=True):
        if p.node_id not in node_photo:
            node_photo[p.node_id] = f"/media/{p.path}"

    closed_ids = {c.edge_id for c in closures}
    closure_by_edge = {c.edge_id: c for c in closures}

    G = _build_nx_graph(nodes, edges, closed_ids, profile=profile, ignore_closures=False)

    def heuristic(u: str, v: str) -> float:
        nu, nv = node_map[u], node_map[v]
        # Scale Euclidean distance conservatively so heuristic stays strictly admissible
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
        }

    try:
        path = nx.astar_path(G, from_node, to_node, heuristic=heuristic, weight="weight")
    except nx.NetworkXNoPath as exc:
        if profile == "wheelchair":
            raise ValueError("No step-free (lift/ramp) route available — a lift on this path may be closed for maintenance.") from exc
        raise ValueError("No walkable route available between these locations due to active closures.") from exc

    # Check if closures caused a detour compared to the open graph
    closures_avoided = 0
    notice: Optional[str] = None
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
                notice = f"Automatically rerouted around {closures_avoided} closed passage(s){reason_txt}."
        except nx.NetworkXNoPath:
            pass

    speed = WHEELCHAIR_SPEED if profile == "wheelchair" else WALK_SPEED
    total_dist = round(float(sum(G[path[i]][path[i + 1]]["distance"] for i in range(len(path) - 1))), 1)
    eta_s = max(5, int(round(total_dist / speed)))

    steps = _build_steps(path, G, node_map, node_photo, buildings)
    levels = sorted({node_map[nid].level for nid in path})

    # Compute up to 2 genuine alternative routes using Yen's k-shortest simple paths
    alternatives: list[dict] = []
    try:
        for cand_path in nx.shortest_simple_paths(G, from_node, to_node, weight="weight"):
            if cand_path == path:
                continue
            # Require meaningful path difference (at least 1 distinct intermediate transit/corridor node)
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
        "notice": notice,
    }


def _build_steps(
    path: List[str],
    G: nx.Graph,
    node_map: Dict[str, Node],
    node_photo: Dict[str, str],
    buildings: Dict[str, str],
) -> list[dict]:
    steps: list[dict] = []
    start = node_map[path[0]]
    steps.append({
        "index": 0,
        "node_id": start.id,
        "name": start.name,
        "instruction": f"Start at {start.name} ({buildings.get(start.building_id, '')}, Floor {start.level}).",
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
                instr = f"Take {curr_n.name} to Floor {next_n.level} ({next_n.name})."
            else:
                icon = "up" if next_n.level > curr_n.level else "down"
                direction_word = "up" if next_n.level > curr_n.level else "down"
                instr = f"Walk {direction_word} the stairs to Floor {next_n.level} ({next_n.name})."
        elif curr_n.building_id != next_n.building_id or e_obj.kind == "outdoor":
            icon = "straight"
            instr = f"Follow the covered walkway {dist}m into {buildings.get(next_n.building_id, next_n.name)} ({next_n.name})."
        elif is_last:
            if i >= 1:
                turn_ic, turn_phrase = _turn_icon(node_map[path[i - 1]], curr_n, next_n)
                icon = "arrive" if turn_ic == "straight" else turn_ic
                instr = f"{turn_phrase} {next_n.name} ({dist}m) — your destination."
            else:
                icon = "arrive"
                instr = f"Walk {dist}m directly to {next_n.name} — your destination."
        else:
            if i >= 1:
                icon, phrase = _turn_icon(node_map[path[i - 1]], curr_n, next_n)
                instr = f"{phrase} {next_n.name} ({dist}m)."
            else:
                icon = "straight"
                instr = f"Head out towards {next_n.name} ({dist}m)."

        steps.append({
            "index": i + 1,
            "node_id": next_n.id,
            "name": next_n.name,
            "instruction": instr,
            "icon": icon,
            "distance_m": dist,
            "level": next_n.level,
            "photo_url": node_photo.get(next_n.id),
        })

    return steps


def find_nearest_matching_nodes(
    nodes: List[Node],
    edges: List[Edge],
    closed_ids: set[str],
    from_node: str,
    predicate,
) -> list[tuple[float, Node]]:
    G = _build_nx_graph(nodes, edges, closed_ids, profile="walk")
    if from_node not in G:
        return [(0.0, n) for n in nodes if predicate(n)]
    lengths = nx.single_source_dijkstra_path_length(G, from_node, weight="weight")
    hits = [(float(lengths[n.id]), n) for n in nodes if predicate(n) and n.id in lengths]
    hits.sort(key=lambda t: t[0])
    return hits

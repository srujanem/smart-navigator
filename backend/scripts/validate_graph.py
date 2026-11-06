"""
Routing dataset validator for every venue (or one: --venue <slug>).

Checks
  E-REF      edge references a node that does not exist
  E-SELF     self-loop edge
  E-DUP      duplicate / parallel edge between the same pair (incl. reversed = redundant two-way copy)
  E-WEIGHT   missing, zero, negative or NaN edge distance
  E-SCALE    edge distance wildly inconsistent with plan geometry (venue median metres/unit ratio)
  E-VKIND    cross-floor edge not typed stairs/lift, or same-floor edge typed stairs/lift
  E-VGAP     stairs/lift edge skips levels (e.g. 0 -> 2)
  E-FLOORLINK floor (level) with no stairs/lift connection to the rest of the building
  E-ISOLATED node with no edges
  E-COMPONENT graph split into disconnected components (walk profile)
  E-UNREACH  place not reachable from the venue entrance
  E-COORD    NaN/inf coordinate or node outside its building footprint
  E-FLOORREF node.floor_id missing / level or building mismatch with its Floor row
  E-ADMISS   A* heuristic not admissible for this edge (would make A* return a non-shortest path)
  W-NAME     duplicate place name on the same floor (ambiguous search / photo labels)
  W-PHOTO    place with no reference photo, or one image file shared by several nodes
  W-LIFT     no lift on a multi-floor building (wheelchair users cannot reach upper floors)
  W-ONEWAY   n/a in this schema: every edge is traversed both ways by the router (reported for info)

Then verifies the router: for sampled pairs the API route distance must equal the true
Dijkstra optimum, and every route must start/end at the requested nodes and only use real edges.

Usage:
  python scripts/validate_graph.py                 # all venues
  python scripts/validate_graph.py --venue n-block-hostel --pairs 400
Exit code 1 if any E-* error is found.
"""
from __future__ import annotations

import argparse
import math
import random
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx
from sqlmodel import Session, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import engine  # noqa: E402
from app.models import Building, Edge, Floor, Node, Photo, Venue  # noqa: E402
from app.services.routing import compute_venue_route  # noqa: E402

# Must mirror app/services/routing.py heuristic constants
H_PLANAR = 0.2
H_VERTICAL = 3.5
VERTICAL_KINDS = {"stairs", "lift", "escalator", "ramp"}


def validate_venue(session: Session, v: Venue, pairs: int) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warns: list[str] = []
    E = errors.append
    W = warns.append

    nodes = session.exec(select(Node).where(Node.venue_id == v.id)).all()
    edges = session.exec(select(Edge).where(Edge.venue_id == v.id)).all()
    floors = session.exec(select(Floor).where(Floor.venue_id == v.id)).all()
    blds = {b.id: b for b in session.exec(select(Building).where(Building.venue_id == v.id)).all()}
    photos = session.exec(select(Photo).where(Photo.venue_id == v.id)).all()
    nm = {n.id: n for n in nodes}
    fm = {f.id: f for f in floors}

    # ---------- nodes ----------
    for n in nodes:
        if not all(math.isfinite(c) for c in (n.x, n.y)):
            E(f"E-COORD   {n.id}: non-finite coordinate ({n.x}, {n.y})")
            continue
        f = fm.get(n.floor_id)
        if f is None:
            E(f"E-FLOORREF {n.id}: floor_id '{n.floor_id}' does not exist")
        else:
            if f.level != n.level:
                E(f"E-FLOORREF {n.id}: node.level={n.level} but floor {f.id} is level {f.level}")
            if f.building_id != n.building_id:
                E(f"E-FLOORREF {n.id}: node.building_id={n.building_id} but floor belongs to {f.building_id}")
        b = blds.get(n.building_id)
        if b is None:
            E(f"E-FLOORREF {n.id}: building '{n.building_id}' does not exist")
        elif n.kind not in ("entrance", "courtyard", "outdoor", "gate", "parking") and n.is_place:
            tol = 1.0
            if not (b.x - tol <= n.x <= b.x + b.w + tol and b.y - tol <= n.y <= b.y + b.d + tol):
                E(f"E-COORD   {n.id} '{n.name}' at ({n.x},{n.y}) lies outside its building {b.id} "
                  f"[{b.x}..{b.x + b.w}, {b.y}..{b.y + b.d}]")

    names = Counter((n.floor_id, n.name.strip().lower()) for n in nodes if n.is_place)
    for (fid, name), c in names.items():
        if c > 1:
            W(f"W-NAME    '{name}' appears {c}x on floor {fid}")

    # ---------- edges ----------
    pair_seen: dict[frozenset, list[Edge]] = defaultdict(list)
    ratios: list[float] = []
    good_edges: list[Edge] = []
    for e in edges:
        if e.source not in nm or e.target not in nm:
            E(f"E-REF     edge {e.id}: {e.source} -> {e.target} references a missing node")
            continue
        if e.source == e.target:
            E(f"E-SELF    edge {e.id}: self-loop on {e.source}")
            continue
        if e.distance is None or not math.isfinite(e.distance) or e.distance <= 0:
            E(f"E-WEIGHT  edge {e.source} <-> {e.target}: distance={e.distance}")
            continue
        pair_seen[frozenset((e.source, e.target))].append(e)
        a, b = nm[e.source], nm[e.target]
        same_floor = a.level == b.level
        if not same_floor and e.kind not in VERTICAL_KINDS:
            E(f"E-VKIND   {a.id}(L{a.level}) <-> {b.id}(L{b.level}) crosses floors but kind='{e.kind}'")
        if same_floor and e.kind in VERTICAL_KINDS and e.kind != "ramp":
            E(f"E-VKIND   {a.id} <-> {b.id} is kind='{e.kind}' but both nodes are on level {a.level}")
        if not same_floor and abs(a.level - b.level) > 1:
            E(f"E-VGAP    {a.id}(L{a.level}) <-> {b.id}(L{b.level}) skips {abs(a.level - b.level) - 1} level(s)")
        planar = math.hypot(a.x - b.x, a.y - b.y)
        if same_floor and planar > 1.0:
            ratios.append(e.distance / planar)
        h = H_PLANAR * planar + H_VERTICAL * abs(a.level - b.level)
        if h > e.distance + 1e-6:
            E(f"E-ADMISS  {a.id} <-> {b.id}: distance {e.distance} m < heuristic estimate {h:.1f} m "
              f"(A* may skip the true shortest path)")
        good_edges.append(e)

    for pair, lst in pair_seen.items():
        if len(lst) > 1:
            a, b = tuple(pair)
            ds = ", ".join(f"{x.distance}m/{x.kind}" for x in lst)
            E(f"E-DUP     {len(lst)} edges between {a} and {b} ({ds}) — keep exactly one (router treats every edge as two-way)")

    if ratios:
        med = statistics.median(ratios)
        for e in good_edges:
            a, b = nm[e.source], nm[e.target]
            planar = math.hypot(a.x - b.x, a.y - b.y)
            if a.level == b.level and planar > 1.0 and e.kind != "door":
                r = e.distance / planar
                if r > med * 2.5 or r < med / 2.5:
                    E(f"E-SCALE   {a.id} <-> {b.id}: {e.distance} m for {planar:.1f} plan units "
                      f"(ratio {r:.2f} vs venue median {med:.2f} m/unit) — weight or coordinates wrong")

    # ---------- topology ----------
    G = nx.Graph()
    G.add_nodes_from(nm)
    for e in good_edges:
        G.add_edge(e.source, e.target, weight=e.distance)

    for nid in nm:
        if G.degree(nid) == 0:
            E(f"E-ISOLATED {nid} '{nm[nid].name}' has no edges")
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    if len(comps) > 1:
        for c in comps[1:]:
            sample = ", ".join(sorted(c)[:6])
            E(f"E-COMPONENT {len(c)} node(s) disconnected from main graph: {sample}{' …' if len(c) > 6 else ''}")

    entrance = v.entrance_node_id if v.entrance_node_id in nm else None
    if entrance:
        reach = nx.node_connected_component(G, entrance)
        for n in nodes:
            if n.is_place and n.id not in reach:
                E(f"E-UNREACH {n.id} '{n.name}' is not reachable from entrance {entrance}")
    else:
        E(f"E-UNREACH venue.entrance_node_id '{v.entrance_node_id}' is missing/invalid")

    # floors linked vertically
    for bid in blds:
        lvls = sorted({f.level for f in floors if f.building_id == bid})
        if len(lvls) <= 1:
            continue
        vert = [e for e in good_edges if e.kind in VERTICAL_KINDS and nm[e.source].building_id == bid]
        linked = defaultdict(set)
        for e in vert:
            la, lb = nm[e.source].level, nm[e.target].level
            linked[la].add(lb)
            linked[lb].add(la)
        for lv in lvls:
            if lv not in linked:
                # may still be reachable through a sibling building (e.g. L-shaped wings sharing stairs)
                sib = [e for e in good_edges if e.kind in VERTICAL_KINDS and lv in (nm[e.source].level, nm[e.target].level)]
                if not sib:
                    E(f"E-FLOORLINK building {bid} level {lv} has no stairs/lift edge to any other level")
        if not any(e.kind == "lift" for e in good_edges):
            W(f"W-LIFT    {bid}: {len(lvls)} levels but no lift edges — wheelchair routes cannot reach upper floors")

    # photos
    by_node = Counter(p.node_id for p in photos)
    for n in nodes:
        if n.is_place and by_node.get(n.id, 0) == 0:
            W(f"W-PHOTO   {n.id} '{n.name}' has no reference photo")
    path_nodes = defaultdict(set)
    for p in photos:
        path_nodes[p.path].add(p.node_id)
    shared = {k: s for k, s in path_nodes.items() if len(s) > 1}
    if shared:
        W(f"W-PHOTO   {len(shared)} image file(s) are indexed under 2+ different nodes "
          f"(identical vectors -> photo-match can only guess between them), e.g. "
          + "; ".join(f"{Path(k).name}->{sorted(s)}" for k, s in list(shared.items())[:3]))

    W("W-ONEWAY  info: edges are undirected in this schema; one-way passages need an explicit 'oneway' flag (not modelled)")

    # ---------- router verification ----------
    places = [n.id for n in nodes if n.is_place and n.id in G]
    rnd = random.Random(7)
    checked = bad = 0
    test_pairs = [(rnd.choice(places), rnd.choice(places)) for _ in range(pairs)] if len(places) > 1 else []
    for s, t in test_pairs:
        if s == t or not nx.has_path(G, s, t):
            continue
        opt = nx.dijkstra_path_length(G, s, t, weight="weight")
        try:
            r = compute_venue_route(session, v, s, t, profile="walk", record_log=False)
        except ValueError as exc:
            E(f"E-ROUTER  {s} -> {t}: router failed ({exc}) although a path exists")
            bad += 1
            continue
        checked += 1
        p = r["path"]
        if p[0] != s or p[-1] != t:
            E(f"E-ROUTER  {s} -> {t}: route ends at {p[-1]} / starts at {p[0]}")
            bad += 1
        elif any(not G.has_edge(p[i], p[i + 1]) for i in range(len(p) - 1)):
            E(f"E-ROUTER  {s} -> {t}: route uses a non-existent edge")
            bad += 1
        elif abs(r["distance_m"] - opt) > 0.15:
            E(f"E-ROUTER  {s} -> {t}: router {r['distance_m']} m but optimum is {opt:.1f} m")
            bad += 1
    print(f"  router check: {checked} random place pairs compared with Dijkstra, {bad} mismatches")
    return errors, warns


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--venue")
    ap.add_argument("--pairs", type=int, default=250)
    ap.add_argument("--max-lines", type=int, default=60)
    args = ap.parse_args()
    total_err = 0
    with Session(engine) as s:
        q = select(Venue)
        if args.venue:
            q = q.where(Venue.slug == args.venue)
        for v in s.exec(q).all():
            print(f"\n=== {v.slug} ===")
            errs, warns = validate_venue(s, v, args.pairs)
            total_err += len(errs)
            by_code = Counter(x.split()[0] for x in errs)
            print(f"  {len(errs)} error(s) {dict(by_code)}  |  {len(warns)} warning(s)")
            for line in (errs + warns)[: args.max_lines]:
                print("   ", line)
            if len(errs) + len(warns) > args.max_lines:
                print(f"    ... {len(errs) + len(warns) - args.max_lines} more")
    return 1 if total_err else 0


if __name__ == "__main__":
    raise SystemExit(main())

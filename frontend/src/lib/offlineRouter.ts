import type {
  GEdge,
  GNode,
  Graph,
  Route,
  RouteProfile,
  Step,
  StepIcon,
  VenueDetail,
  VenueSummary,
} from './types';

const VENUE_CACHE_PREFIX = 'navigator_offline_venue_';
const GRAPH_CACHE_PREFIX = 'navigator_offline_graph_';
const VENUES_LIST_KEY = 'navigator_offline_venues_list';

export function cacheVenuesList(list: VenueSummary[]): void {
  try {
    localStorage.setItem(VENUES_LIST_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota
  }
}

export function getCachedVenuesList(): VenueSummary[] | null {
  try {
    const raw = localStorage.getItem(VENUES_LIST_KEY);
    return raw ? (JSON.parse(raw) as VenueSummary[]) : null;
  } catch {
    return null;
  }
}

export function cacheVenueDetail(slug: string, venue: VenueDetail): void {
  try {
    localStorage.setItem(`${VENUE_CACHE_PREFIX}${slug}`, JSON.stringify(venue));
  } catch {
    // Ignore
  }
}

export function getCachedVenueDetail(slug: string): VenueDetail | null {
  try {
    const raw = localStorage.getItem(`${VENUE_CACHE_PREFIX}${slug}`);
    return raw ? (JSON.parse(raw) as VenueDetail) : null;
  } catch {
    return null;
  }
}

export function cacheVenueGraph(slug: string, graph: Graph): void {
  try {
    localStorage.setItem(`${GRAPH_CACHE_PREFIX}${slug}`, JSON.stringify(graph));
  } catch {
    // Ignore
  }
}

export function getCachedVenueGraph(slug: string): Graph | null {
  try {
    const raw = localStorage.getItem(`${GRAPH_CACHE_PREFIX}${slug}`);
    return raw ? (JSON.parse(raw) as Graph) : null;
  } catch {
    return null;
  }
}

function speedForProfile(profile: RouteProfile): number {
  if (profile === 'stretcher') return 0.82;
  if (profile === 'wheelchair') return 0.9;
  return 1.3;
}

function turnDirection(prev: GNode, curr: GNode, next: GNode): { icon: StepIcon; phrase: string } {
  const v1x = curr.x - prev.x;
  const v1y = curr.y - prev.y;
  const v2x = next.x - curr.x;
  const v2y = next.y - curr.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-3 || m2 < 1e-3) {
    return { icon: 'straight', phrase: 'Continue towards' };
  }
  const cross = (v1x * v2y - v1y * v2x) / (m1 * m2);
  const dot = (v1x * v2x + v1y * v2y) / (m1 * m2);
  if (dot > 0.78 || Math.abs(cross) < 0.35) {
    return { icon: 'straight', phrase: 'Continue straight towards' };
  }
  if (cross > 0) {
    return { icon: 'right', phrase: 'Turn right towards' };
  }
  return { icon: 'left', phrase: 'Turn left towards' };
}

export function computeOfflineRoute(
  graph: Graph,
  fromNode: string,
  toNode: string,
  profile: RouteProfile = 'walk',
): Route {
  const nodeMap = new Map<string, GNode>();
  graph.nodes.forEach((n) => nodeMap.set(n.id, n));

  const startN = nodeMap.get(fromNode);
  const destN = nodeMap.get(toNode);
  if (!startN || !destN) {
    throw new Error('Offline map cache does not contain these locations.');
  }

  if (fromNode === toNode) {
    return {
      from_node: fromNode,
      to_node: toNode,
      profile,
      distance_m: 0,
      eta_s: 0,
      path: [fromNode],
      levels: [startN.level],
      steps: [
        {
          index: 0,
          node_id: startN.id,
          name: startN.name,
          instruction: `You are already at ${startN.name}.`,
          icon: 'arrive',
          distance_m: 0,
          level: startN.level,
          photo_url: startN.photo_url,
        },
      ],
      alternatives: [],
      closures_avoided: 0,
      notice: 'Offline Basement Mode — computed locally from cached venue blueprint.',
      offline_fallback: true,
    };
  }

  const adj = new Map<string, { to: string; edge: GEdge }[]>();
  for (const e of graph.edges) {
    if (e.closed) continue;
    if (profile === 'wheelchair' && (!e.accessible || e.kind === 'stairs')) continue;
    if (
      profile === 'stretcher' &&
      (!e.accessible || e.stretcher_ok === false || e.kind === 'stairs')
    ) {
      continue;
    }
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push({ to: e.target, edge: e });
    adj.get(e.target)!.push({ to: e.source, edge: e });
  }

  const heuristic = (id: string): number => {
    const n = nodeMap.get(id);
    if (!n) return 0;
    return 0.2 * Math.hypot(n.x - destN.x, n.y - destN.y) + 3.5 * Math.abs(n.level - destN.level);
  };

  const gScore = new Map<string, number>([[fromNode, 0]]);
  const fScore = new Map<string, number>([[fromNode, heuristic(fromNode)]]);
  const cameFrom = new Map<string, { prev: string; edge: GEdge }>();
  const openSet = new Set<string>([fromNode]);

  while (openSet.size > 0) {
    let current = '';
    let bestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        current = id;
      }
    }

    if (current === toNode) break;
    openSet.delete(current);

    for (const { to, edge } of adj.get(current) ?? []) {
      const tentative = (gScore.get(current) ?? Infinity) + edge.distance;
      if (tentative < (gScore.get(to) ?? Infinity)) {
        cameFrom.set(to, { prev: current, edge });
        gScore.set(to, tentative);
        fScore.set(to, tentative + heuristic(to));
        openSet.add(to);
      }
    }
  }

  if (!cameFrom.has(toNode)) {
    throw new Error('No accessible route found in cached offline blueprint.');
  }

  const path: string[] = [toNode];
  const edgesUsed: GEdge[] = [];
  let cur = toNode;
  while (cur !== fromNode) {
    const step = cameFrom.get(cur)!;
    edgesUsed.unshift(step.edge);
    path.unshift(step.prev);
    cur = step.prev;
  }

  const totalDist = Math.round(edgesUsed.reduce((acc, e) => acc + e.distance, 0) * 10) / 10;
  const etaS = Math.max(5, Math.round(totalDist / speedForProfile(profile)));

  const steps: Step[] = [
    {
      index: 0,
      node_id: startN.id,
      name: startN.name,
      instruction: `Start at ${startN.name} (${startN.building_name}, Floor ${startN.level}).`,
      icon: 'start',
      distance_m: 0,
      level: startN.level,
      photo_url: startN.photo_url,
    },
  ];

  for (let i = 0; i < path.length - 1; i++) {
    const currN = nodeMap.get(path[i])!;
    const nextN = nodeMap.get(path[i + 1])!;
    const edge = edgesUsed[i];
    const dist = Math.round(edge.distance * 10) / 10;
    const isLast = i === path.length - 2;

    let icon: StepIcon = 'straight';
    let instr = '';

    if (currN.level !== nextN.level) {
      if (edge.kind === 'lift') {
        icon = 'lift';
        instr = `Take ${currN.name} to Floor ${nextN.level} (${nextN.name}).`;
      } else {
        icon = nextN.level > currN.level ? 'up' : 'down';
        instr = `Walk ${nextN.level > currN.level ? 'up' : 'down'} the stairs to Floor ${nextN.level} (${nextN.name}).`;
      }
    } else if (isLast) {
      if (i >= 1) {
        const t = turnDirection(nodeMap.get(path[i - 1])!, currN, nextN);
        icon = t.icon === 'straight' ? 'arrive' : t.icon;
        instr = `${t.phrase} ${nextN.name} (${dist}m) — your destination.`;
      } else {
        icon = 'arrive';
        instr = `Walk ${dist}m directly to ${nextN.name} — your destination.`;
      }
    } else if (i >= 1) {
      const t = turnDirection(nodeMap.get(path[i - 1])!, currN, nextN);
      icon = t.icon;
      instr = `${t.phrase} ${nextN.name} (${dist}m).`;
    } else {
      icon = 'straight';
      instr = `Head out towards ${nextN.name} (${dist}m).`;
    }

    steps.push({
      index: i + 1,
      node_id: nextN.id,
      name: nextN.name,
      instruction: instr,
      icon,
      distance_m: dist,
      level: nextN.level,
      photo_url: nextN.photo_url,
    });
  }

  const levels = Array.from(new Set(path.map((id) => nodeMap.get(id)?.level ?? 0))).sort(
    (a, b) => a - b,
  );

  return {
    from_node: fromNode,
    to_node: toNode,
    profile,
    distance_m: totalDist,
    eta_s: etaS,
    path,
    levels,
    steps,
    alternatives: [],
    closures_avoided: 0,
    notice: 'Offline Basement Mode — computed locally from cached venue blueprint.',
    offline_fallback: true,
  };
}

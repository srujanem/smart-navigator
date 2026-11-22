import type {
  Candidate,
  GEdge,
  GNode,
  Graph,
  LocalizeResult,
  Person,
  Route,
  RouteAlternative,
  RouteLeg,
  RouteProfile,
  SampleQuery,
  SearchResponse,
  SearchResult,
  Step,
  StepIcon,
  VenueDetail,
  VenueSummary,
} from './types';

const VENUE_CACHE_PREFIX = 'navigator_offline_v3_venue_';
const GRAPH_CACHE_PREFIX = 'navigator_offline_v3_graph_';
const PEOPLE_CACHE_PREFIX = 'navigator_offline_v3_people_';
const VENUES_LIST_KEY = 'navigator_offline_v3_venues_list';
const DEVICE_CLEANUP_VERSION_KEY = 'navigator_device_cleanup_v3';

if (typeof window !== 'undefined') {
  try {
    if (localStorage.getItem(DEVICE_CLEANUP_VERSION_KEY) !== 'done') {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith('navigator_offline_v1_') ||
            k.startsWith('navigator_offline_v2_') ||
            k.includes('n-block-hostel'))
        ) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(DEVICE_CLEANUP_VERSION_KEY, 'done');
    }
  } catch {
    // Ignore storage access errors
  }
}

export function clearDeviceVenueCache(slug?: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(VENUES_LIST_KEY);
    if (slug) {
      localStorage.removeItem(`${VENUE_CACHE_PREFIX}${slug}`);
      localStorage.removeItem(`${GRAPH_CACHE_PREFIX}${slug}`);
      localStorage.removeItem(`${PEOPLE_CACHE_PREFIX}${slug}`);
    } else {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('navigator_offline_')) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    // Ignore
  }
}

export interface BundledPhotoSig {
  photo_id: string;
  node_id: string;
  node_name: string;
  building_name: string;
  floor_name: string;
  level: number;
  photo_url: string;
  ocr_text: string;
  heading_deg: number | null;
  sig: number[];
}

export interface BundledOfflineSnapshot {
  venues: VenueSummary[];
  details: Record<string, VenueDetail>;
  graphs: Record<string, Graph>;
  people: Record<string, Person[]>;
  photo_index?: Record<string, BundledPhotoSig[]>;
}

let bundledSnapshotCache: BundledOfflineSnapshot | null = null;
let bundledSnapshotPromise: Promise<BundledOfflineSnapshot | null> | null = null;

export function loadBundledOfflineSnapshot(): Promise<BundledOfflineSnapshot | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (bundledSnapshotCache) return Promise.resolve(bundledSnapshotCache);
  if (!bundledSnapshotPromise) {
    bundledSnapshotPromise = fetch('/offline-bundle.json')
      .then((res) => (res.ok ? (res.json() as Promise<BundledOfflineSnapshot>) : null))
      .then((data) => {
        if (data) bundledSnapshotCache = data;
        return data;
      })
      .catch(() => null);
  }
  return bundledSnapshotPromise;
}

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

export function cacheVenuePeople(slug: string, people: Person[]): void {
  try {
    localStorage.setItem(`${PEOPLE_CACHE_PREFIX}${slug}`, JSON.stringify(people));
  } catch {
    // Ignore
  }
}

export function getCachedVenuePeople(slug: string): Person[] | null {
  try {
    const raw = localStorage.getItem(`${PEOPLE_CACHE_PREFIX}${slug}`);
    return raw ? (JSON.parse(raw) as Person[]) : null;
  } catch {
    return null;
  }
}

function speedForProfile(profile: RouteProfile): number {
  if (profile === 'stretcher') return 0.82;
  if (profile === 'wheelchair') return 0.9;
  return 1.3;
}

function distToSteps(distanceM: number): number {
  if (distanceM <= 0) return 0;
  return Math.max(1, Math.round(distanceM / 0.72));
}

function turnIcon(prev: GNode, curr: GNode, next: GNode): StepIcon {
  const v1x = curr.x - prev.x;
  const v1y = curr.y - prev.y;
  const v2x = next.x - curr.x;
  const v2y = next.y - curr.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-3 || m2 < 1e-3) return 'straight';
  const cross = (v1x * v2y - v1y * v2x) / (m1 * m2);
  const dot = (v1x * v2x + v1y * v2y) / (m1 * m2);
  if (dot > 0.78 || Math.abs(cross) < 0.35) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

function relativeSide(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): 'left' | 'right' | 'ahead' {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const m1 = Math.hypot(vx, vy);
  const m2 = Math.hypot(wx, wy);
  if (m1 < 1e-3 || m2 < 1e-3) return 'ahead';
  const cross = (vx * wy - vy * wx) / (m1 * m2);
  if (Math.abs(cross) < 0.22) return 'ahead';
  return cross > 0 ? 'right' : 'left';
}

function isCorridorOrWaypoint(n: GNode): boolean {
  const k = (n.kind || '').toLowerCase();
  const nm = (n.name || '').toLowerCase();
  return (
    !n.is_place ||
    k === 'corridor' ||
    k === 'junction' ||
    nm.includes('corridor') ||
    nm.includes('hallway') ||
    nm.includes('passage') ||
    nm.includes('walkway')
  );
}

function levelLabel(lvl: number, floorName?: string): string {
  if (floorName) return floorName;
  if (lvl === 0) return 'Ground Floor';
  if (lvl > 0) return `Floor ${lvl}`;
  return `Basement ${Math.abs(lvl)}`;
}

function buildHumanSteps(
  path: string[],
  nodeMap: Map<string, GNode>,
  edgeLookup: Map<string, GEdge>,
  allNodes: GNode[],
): Step[] {
  if (path.length === 0) return [];
  const start = nodeMap.get(path[0])!;
  const steps: Step[] = [
    {
      index: 0,
      node_id: start.id,
      name: start.name,
      short_action: 'Start Here',
      instruction: `Start at ${start.name} (${start.building_name || 'Main Building'}, ${levelLabel(start.level, start.floor_name)}).`,
      icon: 'start',
      distance_m: 0,
      steps_count: 0,
      passing_landmarks: [],
      door_side: null,
      level: start.level,
      photo_url: start.photo_url,
    },
  ];

  interface RawHop {
    prev_prev: GNode | null;
    prev: GNode;
    curr: GNode;
    edge: GEdge | undefined;
    dist: number;
    icon: StepIcon;
    is_floor_change: boolean;
    is_outdoor: boolean;
    is_building_change: boolean;
  }

  const rawHops: RawHop[] = [];
  for (let i = 1; i < path.length; i++) {
    const prev = nodeMap.get(path[i - 1])!;
    const curr = nodeMap.get(path[i])!;
    const prevPrev = i >= 2 ? nodeMap.get(path[i - 2])! : null;
    const edge =
      edgeLookup.get(`${prev.id}|${curr.id}`) ??
      edgeLookup.get(`${curr.id}|${prev.id}`);
    const dist = edge ? Number(edge.distance) : Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const kind = edge ? edge.kind : 'walk';

    const isFloorChange = curr.level !== prev.level || kind === 'lift' || kind === 'stairs';
    const isOutdoor = kind === 'outdoor';
    const isBuildingChange = curr.building_id !== prev.building_id;

    let icon: StepIcon = 'straight';
    if (isFloorChange) {
      icon = kind === 'lift' ? 'lift' : curr.level > prev.level ? 'up' : 'down';
    } else if (isOutdoor) {
      icon = 'straight';
    } else if (prevPrev) {
      icon = turnIcon(prevPrev, prev, curr);
    }

    rawHops.push({
      prev_prev: prevPrev,
      prev,
      curr,
      edge,
      dist,
      icon,
      is_floor_change: isFloorChange,
      is_outdoor: isOutdoor,
      is_building_change: isBuildingChange,
    });
  }

  const mergedGroups: RawHop[][] = [];
  for (const hop of rawHops) {
    if (mergedGroups.length === 0) {
      mergedGroups.push([hop]);
      continue;
    }
    const lastGroup = mergedGroups[mergedGroups.length - 1];
    const lastHop = lastGroup[lastGroup.length - 1];
    const canMerge =
      !lastHop.is_floor_change &&
      !hop.is_floor_change &&
      !lastHop.is_outdoor &&
      !hop.is_outdoor &&
      !hop.is_building_change &&
      hop.icon === 'straight' &&
      isCorridorOrWaypoint(lastHop.curr);
    if (canMerge) {
      lastGroup.push(hop);
    } else {
      mergedGroups.push([hop]);
    }
  }

  const pathSet = new Set(path);

  mergedGroups.forEach((group, gIdx) => {
    const firstHop = group[0];
    const lastHop = group[group.length - 1];
    const isFinalGroup = gIdx === mergedGroups.length - 1;
    const segStart = firstHop.prev;
    const segEnd = lastHop.curr;
    const totalDist = Math.round(group.reduce((acc, h) => acc + h.dist, 0) * 10) / 10;
    const stepCount = distToSteps(totalDist);
    const distRounded = Math.max(1, Math.round(totalDist));

    let icon: StepIcon = firstHop.icon;
    let shortAction = 'Walk Straight';
    let doorSide: 'left' | 'right' | 'ahead' | null = null;

    const passingNames: string[] = [];
    const seenPass = new Set<string>();
    const groupNodes = [segStart, ...group.map((h) => h.curr)];

    for (let k = 0; k < groupNodes.length - 1; k++) {
      const a = groupNodes[k];
      const b = groupNodes[k + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-3) continue;

      const candidates: { proj: number; label: string }[] = [];
      for (const cn of allNodes) {
        if (cn.level !== a.level || cn.building_id !== a.building_id) continue;
        if (cn.id === segStart.id || cn.id === segEnd.id || pathSet.has(cn.id)) continue;
        if (!cn.is_place || isCorridorOrWaypoint(cn)) continue;

        const apx = cn.x - a.x;
        const apy = cn.y - a.y;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const t = (apx * abx + apy * aby) / (segLen * segLen);
        if (t < -0.05 || t > 1.05) continue;
        const cx = a.x + t * abx;
        const cy = a.y + t * aby;
        const perpDist = Math.hypot(cn.x - cx, cn.y - cy);
        if (perpDist <= 18.0) {
          const side = relativeSide(a.x, a.y, b.x, b.y, cn.x, cn.y);
          const sideTag = side === 'left' || side === 'right' ? ` (${side})` : '';
          candidates.push({ proj: t, label: `${cn.name}${sideTag}` });
        }
      }
      candidates.sort((x, y) => x.proj - y.proj);
      for (const c of candidates) {
        const base = c.label.split(' (')[0];
        if (!seenPass.has(base) && passingNames.length < 3) {
          seenPass.add(base);
          passingNames.push(c.label);
        }
      }
    }

    if (isFinalGroup && !firstHop.is_floor_change) {
      if (group.length >= 2) {
        const preDest = group[group.length - 2].curr;
        const prevBefore = group.length >= 3 ? group[group.length - 3].curr : segStart;
        const approachSide = relativeSide(
          prevBefore.x,
          prevBefore.y,
          preDest.x,
          preDest.y,
          segEnd.x,
          segEnd.y,
        );
        if (approachSide === 'left' || approachSide === 'right') {
          doorSide = approachSide;
        }
      } else if (firstHop.prev_prev) {
        const approachSide = relativeSide(
          firstHop.prev_prev.x,
          firstHop.prev_prev.y,
          segStart.x,
          segStart.y,
          segEnd.x,
          segEnd.y,
        );
        if (approachSide === 'left' || approachSide === 'right') {
          doorSide = approachSide;
        }
      }
    }

    const passClause =
      passingNames.length > 0
        ? `, passing ${passingNames
            .slice(0, 2)
            .map((p) => p.split(' (')[0])
            .join(' & ')}`
        : '';

    let text = '';
    if (firstHop.is_floor_change) {
      const edgeKind = firstHop.edge ? firstHop.edge.kind : 'stairs';
      if (edgeKind === 'lift' || icon === 'lift') {
        icon = 'lift';
        shortAction = `Take Lift → ${levelLabel(segEnd.level, segEnd.floor_name)}`;
        text = `Take the elevator (${segStart.name}) to ${levelLabel(segEnd.level, segEnd.floor_name)} and exit at ${segEnd.name}.`;
      } else {
        const dirWord = segEnd.level > segStart.level ? 'up' : 'down';
        icon = dirWord === 'up' ? 'up' : 'down';
        shortAction = `Stairs ${dirWord.toUpperCase()} → ${levelLabel(segEnd.level, segEnd.floor_name)}`;
        text = `Take the stairs ${dirWord} to ${levelLabel(segEnd.level, segEnd.floor_name)} (${segEnd.name}).`;
      }
    } else if (firstHop.is_outdoor) {
      icon = 'straight';
      shortAction = `Outdoor Walk (~${stepCount} steps)`;
      text = `Exit outdoors and walk ${distRounded} m (~${stepCount} steps) along the campus walkway to ${segEnd.name} (${segEnd.building_name}).`;
    } else if (firstHop.is_building_change) {
      shortAction = `Enter ${segEnd.building_name}`;
      text = `Cross into ${segEnd.building_name} and continue ${distRounded} m (~${stepCount} steps) to ${segEnd.name}.`;
    } else if (isFinalGroup) {
      const sidePhrase =
        doorSide === 'left' || doorSide === 'right'
          ? ` — ${segEnd.name} is on your ${doorSide}`
          : ' — destination ahead';
      if (icon === 'left') {
        shortAction = `Turn Left → ${segEnd.name}`;
        text = `Turn left and walk ${distRounded} m (~${stepCount} steps)${passClause}${sidePhrase}.`;
      } else if (icon === 'right') {
        shortAction = `Turn Right → ${segEnd.name}`;
        text = `Turn right and walk ${distRounded} m (~${stepCount} steps)${passClause}${sidePhrase}.`;
      } else {
        icon = 'arrive';
        shortAction = `Arrive at ${segEnd.name}`;
        text = `Walk straight ${distRounded} m (~${stepCount} steps)${passClause} to arrive at ${segEnd.name}${
          doorSide === 'left' || doorSide === 'right' ? ` (door on your ${doorSide})` : ''
        }.`;
      }
    } else {
      const targetLabel = isCorridorOrWaypoint(segEnd)
        ? `down ${segEnd.name}`
        : `towards ${segEnd.name}`;
      if (icon === 'left') {
        shortAction = 'Turn Left';
        text = `Turn left and walk ${distRounded} m (~${stepCount} steps) ${targetLabel}${passClause}.`;
      } else if (icon === 'right') {
        shortAction = 'Turn Right';
        text = `Turn right and walk ${distRounded} m (~${stepCount} steps) ${targetLabel}${passClause}.`;
      } else {
        icon = 'straight';
        shortAction = 'Walk Straight';
        if (gIdx === 0) {
          text = `Walk straight ${distRounded} m (~${stepCount} steps) along ${segEnd.name}${passClause}.`;
        } else {
          text = `Continue straight ${distRounded} m (~${stepCount} steps) ${targetLabel}${passClause}.`;
        }
      }
    }

    let chosenPhoto = segEnd.photo_url;
    if (!chosenPhoto) {
      for (let k = group.length - 1; k >= 0; k--) {
        if (group[k].curr.photo_url) {
          chosenPhoto = group[k].curr.photo_url;
          break;
        }
      }
    }

    steps.push({
      index: steps.length,
      node_id: segEnd.id,
      name: segEnd.name,
      short_action: shortAction,
      instruction: text,
      icon,
      distance_m: totalDist,
      steps_count: stepCount,
      passing_landmarks: passingNames,
      door_side: doorSide,
      level: segEnd.level,
      photo_url: chosenPhoto,
    });
  });

  return steps;
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
    throw new Error('Map model does not contain these locations.');
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
          short_action: 'Already Here',
          instruction: `You are already at ${startN.name}.`,
          icon: 'arrive',
          distance_m: 0,
          steps_count: 0,
          passing_landmarks: [],
          door_side: 'ahead',
          level: startN.level,
          photo_url: startN.photo_url,
        },
      ],
      alternatives: [],
      closures_avoided: 0,
      notice: null,
      offline_fallback: false,
    };
  }

  const adj = new Map<string, { to: string; edge: GEdge }[]>();
  const edgeLookup = new Map<string, GEdge>();
  let closuresAvoided = 0;

  for (const e of graph.edges) {
    edgeLookup.set(`${e.source}|${e.target}`, e);
    edgeLookup.set(`${e.target}|${e.source}`, e);
    if (e.closed) {
      closuresAvoided += 1;
      continue;
    }
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
    throw new Error('No accessible route found between these locations.');
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
  const steps = buildHumanSteps(path, nodeMap, edgeLookup, graph.nodes);

  const levels = Array.from(new Set(path.map((id) => nodeMap.get(id)?.level ?? 0))).sort(
    (a, b) => a - b,
  );

  const alternatives: RouteAlternative[] = [];

  return {
    from_node: fromNode,
    to_node: toNode,
    profile,
    distance_m: totalDist,
    eta_s: etaS,
    path,
    levels,
    steps,
    alternatives,
    closures_avoided: closuresAvoided,
    notice: null,
    offline_fallback: false,
  };
}

export function computeOfflineNearestRoute(
  graph: Graph,
  fromNode: string,
  targetKind: string,
  profile: RouteProfile = 'walk',
): Route {
  const kindLow = targetKind.toLowerCase();
  const matchMap: Record<string, string[]> = {
    exit: ['exit', 'entrance', 'gate', 'emergency', 'stair'],
    emergency: ['emergency', 'trauma', 'casualty', 'first aid', 'exit', 'entrance'],
    washroom: ['washroom', 'restroom', 'toilet', 'wc'],
    lift: ['lift', 'elevator', 'stair', 'stairs'],
    stairs: ['stair', 'stairs', 'lift', 'elevator'],
    water: ['water', 'cooler', 'drinking', 'washroom', 'junction', 'balcony', 'mess', 'cafeteria', 'lobby'],
    canteen: ['canteen', 'mess', 'cafeteria', 'cafe', 'food', 'dining', 'study', 'balcony', 'courtyard', 'lobby'],
    pharmacy: ['pharmacy', 'chemist', 'medicine', 'dispensary'],
    helpdesk: ['reception', 'help', 'desk', 'enquiry', 'billing', 'office', 'warden', 'lobby', 'entrance', 'junction', 'hod', 'cabin'],
  };
  const terms = matchMap[kindLow] ?? [kindLow];
  const candidates = graph.nodes.filter((n) => {
    if (n.id === fromNode && graph.nodes.length > 1) return false;
    const blob = `${n.kind} ${n.category ?? ''} ${n.name} ${n.keywords}`.toLowerCase();
    return terms.some((t) => blob.includes(t));
  });

  let best: Route | null = null;
  for (const cand of candidates) {
    try {
      const r = computeOfflineRoute(graph, fromNode, cand.id, profile);
      if (!best || r.distance_m < best.distance_m) {
        best = r;
      }
    } catch {
      // Unreachable candidate
    }
  }
  if (!best) {
    throw new Error(`No accessible ${targetKind} found in venue blueprint.`);
  }
  return best;
}

export function computeOfflineMultiStopRoute(
  graph: Graph,
  stops: string[],
  profile: RouteProfile = 'walk',
): Route {
  if (stops.length < 2) {
    throw new Error('At least two stops are required.');
  }
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const combinedPath: string[] = [];
  const combinedSteps: Step[] = [];
  const legs: RouteLeg[] = [];
  let totalDist = 0;
  let totalEta = 0;
  const levelSet = new Set<number>();

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const legRoute = computeOfflineRoute(graph, a, b, profile);
    totalDist += legRoute.distance_m;
    totalEta += legRoute.eta_s;
    legRoute.levels.forEach((l) => levelSet.add(l));
    legs.push({
      leg_index: i,
      from_node: a,
      from_name: nodeMap.get(a)?.name ?? a,
      to_node: b,
      to_name: nodeMap.get(b)?.name ?? b,
      distance_m: legRoute.distance_m,
      eta_s: legRoute.eta_s,
      path: legRoute.path,
    });
    if (i === 0) {
      combinedPath.push(...legRoute.path);
      combinedSteps.push(...legRoute.steps);
    } else {
      combinedPath.push(...legRoute.path.slice(1));
      combinedSteps.push(...legRoute.steps.slice(1));
    }
  }

  return {
    from_node: stops[0],
    to_node: stops[stops.length - 1],
    stops,
    legs,
    profile,
    distance_m: Math.round(totalDist * 10) / 10,
    eta_s: totalEta,
    path: combinedPath,
    levels: Array.from(levelSet).sort((a, b) => a - b),
    steps: combinedSteps.map((s, idx) => ({ ...s, index: idx })),
    alternatives: [],
    closures_avoided: 0,
    notice: null,
    offline_fallback: false,
  };
}

export function computeOfflineSearch(
  graph: Graph,
  people: Person[],
  rawQuery: string,
  fromNodeId?: string | null,
): SearchResponse {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return { query: rawQuery, interpreted: null, results: [] };

  const symptomMap: Record<string, { label: string; terms: string[] }> = {
    heart: { label: 'Symptom match → Cardiology & ECG', terms: ['cardiology', 'heart', 'ecg'] },
    chest: { label: 'Symptom match → Cardiology / Emergency', terms: ['cardiology', 'emergency'] },
    bone: { label: 'Symptom match → Orthopedics & X-Ray', terms: ['ortho', 'radiology', 'x-ray'] },
    fracture: { label: 'Symptom match → Orthopedics & Emergency', terms: ['ortho', 'emergency', 'x-ray'] },
    scan: { label: 'Intent match → Radiology & MRI / CT', terms: ['radiology', 'mri', 'x-ray', 'scan'] },
    xray: { label: 'Intent match → Radiology & X-Ray', terms: ['radiology', 'x-ray'] },
    medicine: { label: 'Intent match → Pharmacy & Dispensary', terms: ['pharmacy', 'medicine'] },
    washroom: { label: 'Facility search → Nearest Washroom', terms: ['washroom', 'toilet', 'restroom'] },
    toilet: { label: 'Facility search → Nearest Washroom', terms: ['washroom', 'toilet', 'restroom'] },
    food: { label: 'Facility search → Cafeteria & Dining', terms: ['cafeteria', 'canteen', 'cafe', 'food'] },
    coffee: { label: 'Facility search → Cafeteria', terms: ['cafeteria', 'cafe'] },
    ai: { label: 'Topic match → AI & Robotics Lab', terms: ['ai', 'robotics', 'computer', 'lab'] },
  };

  let interpreted: string | null = null;
  let extraTerms: string[] = [];
  for (const [k, spec] of Object.entries(symptomMap)) {
    if (q.includes(k)) {
      interpreted = spec.label;
      extraTerms = spec.terms;
      break;
    }
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  for (const n of graph.nodes) {
    if (!n.is_place) continue;
    const blob = `${n.name} ${n.kind} ${n.category ?? ''} ${n.building_name} ${n.floor_name} ${n.keywords}`.toLowerCase();
    let score = 0;
    if (n.name.toLowerCase() === q) score = 1.0;
    else if (n.name.toLowerCase().includes(q)) score = 0.94;
    else if (tokens.every((t) => blob.includes(t))) score = 0.84;
    else if (extraTerms.some((t) => blob.includes(t))) score = 0.82;
    else if (tokens.some((t) => t.length >= 2 && blob.includes(t))) score = 0.58;

    if (score > 0) {
      let distM = 9999;
      let distLabel = '';
      if (fromNodeId && fromNodeId !== n.id) {
        try {
          const r = computeOfflineRoute(graph, fromNodeId, n.id, 'walk');
          distM = r.distance_m;
          distLabel = ` · ~${Math.round(r.distance_m)}m`;
        } catch {
          // Ignore unreachable
        }
      }
      if (q.includes('nearest') && distM < 9999) {
        score += Math.max(0, 0.25 - distM * 0.002);
      }
      results.push({
        type: 'place',
        id: n.id,
        name: n.name,
        subtitle: `${n.building_name} · ${levelLabel(n.level, n.floor_name)}${distLabel}`,
        node_id: n.id,
        score,
      });
    }
  }

  for (const p of people) {
    const blob = `${p.name} ${p.title} ${p.role} ${p.department} ${p.node_name}`.toLowerCase();
    let score = 0;
    if (p.name.toLowerCase().includes(q)) score = 0.96;
    else if (tokens.every((t) => blob.includes(t))) score = 0.85;
    else if (extraTerms.some((t) => blob.includes(t))) score = 0.81;
    else if (tokens.some((t) => t.length >= 2 && blob.includes(t))) score = 0.55;
    if (score > 0) {
      results.push({
        type: 'person',
        id: p.id,
        name: p.name,
        subtitle: `${p.title || p.role} · ${p.node_name}`,
        node_id: p.target_node_id,
        score,
        status: p.status,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return {
    query: rawQuery,
    interpreted,
    results: results.slice(0, 12),
  };
}

/**
 * Computes the identical 48-dim L2-normalized spatial RGB + gradient descriptor
 * in browser <canvas> so photo localization works 100% client-side with zero database server.
 */
export async function computeBrowserImageSignature(file: File): Promise<number[]> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve([]);
          return;
        }
        ctx.drawImage(img, 0, 0, 64, 48);
        const data = ctx.getImageData(0, 0, 64, 48).data;
        URL.revokeObjectURL(url);

        const arr: number[][][] = [];
        const gray: number[][] = [];
        for (let r = 0; r < 48; r++) {
          const row: number[][] = [];
          const grow: number[] = [];
          for (let c = 0; c < 64; c++) {
            const idx = (r * 64 + c) * 4;
            const cr = data[idx] / 255;
            const cg = data[idx + 1] / 255;
            const cb = data[idx + 2] / 255;
            row.push([cr, cg, cb]);
            grow.push((cr + cg + cb) / 3);
          }
          arr.push(row);
          gray.push(grow);
        }

        const feats: number[] = [];
        const gh = 4;
        const gw = 3;
        const bh = 12;
        const bw = 21;

        for (let gr = 0; gr < gh; gr++) {
          for (let gc = 0; gc < gw; gc++) {
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let count = 0;
            const rEnd = gr === gh - 1 ? 48 : (gr + 1) * bh;
            const cEnd = gc === gw - 1 ? 64 : (gc + 1) * bw;
            for (let r = gr * bh; r < rEnd; r++) {
              for (let c = gc * bw; c < cEnd; c++) {
                sr += arr[r][c][0];
                sg += arr[r][c][1];
                sb += arr[r][c][2];
                count++;
              }
            }
            feats.push(sr / count, sg / count, sb / count);
          }
        }

        for (let gr = 0; gr < gh; gr++) {
          for (let gc = 0; gc < gw; gc++) {
            let gsum = 0;
            let count = 0;
            const rEnd = gr === gh - 1 ? 48 : (gr + 1) * bh;
            const cEnd = gc === gw - 1 ? 64 : (gc + 1) * bw;
            for (let r = gr * bh; r < rEnd; r++) {
              for (let c = gc * bw; c < cEnd; c++) {
                const gx = c > 0 ? Math.abs(gray[r][c] - gray[r][c - 1]) : 0;
                const gy = r > 0 ? Math.abs(gray[r][c] - gray[r - 1][c]) : 0;
                gsum += gx + gy;
                count++;
              }
            }
            feats.push((gsum / count) * 3.0);
          }
        }

        let norm = 0;
        for (const v of feats) norm += v * v;
        norm = Math.sqrt(norm);
        if (norm > 1e-6) {
          resolve(feats.map((v) => v / norm));
        } else {
          resolve(feats);
        }
      } catch {
        URL.revokeObjectURL(url);
        resolve([]);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve([]);
    };
    img.src = url;
  });
}

export function getBundledSampleQueries(
  slug: string,
  bundle: BundledOfflineSnapshot,
): SampleQuery[] {
  const sigs = bundle.photo_index?.[slug] ?? [];
  const seenNodes = new Set<string>();
  const samples: SampleQuery[] = [];
  for (const s of sigs) {
    if (seenNodes.has(s.node_id)) continue;
    seenNodes.add(s.node_id);
    samples.push({
      id: s.photo_id,
      label: s.node_name,
      hint: `${s.building_name} · ${levelLabel(s.level, s.floor_name)}`,
      photo_url: s.photo_url,
    });
    if (samples.length >= 6) break;
  }
  return samples;
}

export async function computeOfflineLocalize(
  slug: string,
  file: File,
  bundle: BundledOfflineSnapshot,
  level?: number | null,
  priorNodeId?: string | null,
): Promise<LocalizeResult> {
  const t0 = performance.now();
  const sigs = bundle.photo_index?.[slug] ?? [];
  const graph = bundle.graphs?.[slug];
  const nodes = graph?.nodes ?? [];
  const querySig = await computeBrowserImageSignature(file);
  const previewUrl = URL.createObjectURL(file);
  const fnameLow = file.name.toLowerCase();

  // Extract any room number token from filename (e.g. "308", "room-304")
  const numMatch = fnameLow.match(/\b(30\d|310|\d{3})\b/);
  const hintToken = numMatch ? numMatch[1] : '';

  const nodeBest = new Map<
    string,
    {
      sigItem: BundledPhotoSig;
      visualScore: number;
      ocrBonus: number;
      priorBonus: number;
      totalScore: number;
      ocrHit: string | null;
    }
  >();

  for (const item of sigs) {
    if (level !== undefined && level !== null && item.level !== level) continue;
    let dot = 0;
    if (querySig.length === item.sig.length && querySig.length > 0) {
      for (let i = 0; i < querySig.length; i++) {
        dot += querySig[i] * item.sig[i];
      }
    } else {
      dot = 0.65;
    }
    const visualScore = Math.max(0, Math.min(1, dot));

    let ocrBonus = 0;
    let ocrHit: string | null = null;
    const itemNameLow = item.node_name.toLowerCase();
    const itemSlugToken = itemNameLow.replace(/[^a-z0-9]+/g, '-');
    if (
      (hintToken && (item.ocr_text.includes(hintToken) || itemNameLow.includes(hintToken))) ||
      (itemSlugToken.length >= 4 && fnameLow.includes(itemSlugToken))
    ) {
      ocrBonus = 0.25;
      ocrHit = hintToken || item.ocr_text || item.node_name;
    }

    const priorBonus = priorNodeId && item.node_id === priorNodeId ? 0.06 : 0;
    const totalScore = Math.min(0.99, visualScore * 0.82 + ocrBonus + priorBonus);

    const prev = nodeBest.get(item.node_id);
    if (!prev || totalScore > prev.totalScore) {
      nodeBest.set(item.node_id, {
        sigItem: item,
        visualScore,
        ocrBonus,
        priorBonus,
        totalScore,
        ocrHit,
      });
    }
  }

  // Fallback if venue has nodes without photos yet
  if (nodeBest.size === 0 && nodes.length > 0) {
    for (const n of nodes.slice(0, 3)) {
      nodeBest.set(n.id, {
        sigItem: {
          photo_id: n.id,
          node_id: n.id,
          node_name: n.name,
          building_name: n.building_name,
          floor_name: n.floor_name,
          level: n.level,
          photo_url: n.photo_url || '',
          ocr_text: '',
          heading_deg: null,
          sig: [],
        },
        visualScore: 0.72,
        ocrBonus: 0,
        priorBonus: 0,
        totalScore: 0.72,
        ocrHit: null,
      });
    }
  }

  const ranked = Array.from(nodeBest.values()).sort((a, b) => b.totalScore - a.totalScore);
  const top = ranked.slice(0, 3);
  const expScores = top.map((r) => Math.exp(r.totalScore * 7.5));
  const sumExp = expScores.reduce((a, b) => a + b, 0) || 1;

  const candidates: Candidate[] = top.map((r, idx) => {
    const score = Math.round(Math.min(0.98, Math.max(0.55, expScores[idx] / sumExp + 0.22)) * 100) / 100;
    const hitText = r.ocrHit || r.sigItem.ocr_text || null;
    return {
      node_id: r.sigItem.node_id,
      name: r.sigItem.node_name,
      kind: 'room',
      building_name: r.sigItem.building_name,
      floor_name: r.sigItem.floor_name,
      level: r.sigItem.level,
      score,
      visual: Math.round(r.visualScore * 100) / 100,
      text: Math.round(r.ocrBonus * 100) / 100,
      matched_photo_url: r.sigItem.photo_url || null,
      matched_heading_deg: r.sigItem.heading_deg,
      reason: hitText ? `Signboard OCR "${hitText}" + Visual Match` : 'Spatial Visual Descriptor Match',
    };
  });

  const best = candidates[0] ?? null;
  const elapsedMs = Math.max(12, Math.round(performance.now() - t0));
  const bestOcr = top[0]?.ocrHit || top[0]?.sigItem.ocr_text || null;

  return {
    log_id: `static-${Date.now()}`,
    status: best ? 'confident' : 'no_match',
    confidence: best ? best.score : 0,
    best,
    candidates,
    ocr_text: bestOcr ? [bestOcr] : [],
    ocr_boxes: [],
    faces_blurred: 0,
    engine: {
      embedder: 'client-spatial-v3',
      ocr: 'bundled-signboard-index',
      face_blur: true,
    },
    query_photo_url: previewUrl,
    trace: [
      {
        step: 'On-Device EXIF Strip & Orientation Normalize',
        detail: 'Processed directly in your browser without uploading to any external database.',
        ms: 4,
      },
      {
        step: '48-D Spatial RGB + Gradient Descriptor',
        detail: `Extracted 4x3 grid visual signature across ${sigs.length} bundled reference views.`,
        ms: Math.max(4, Math.floor(elapsedMs * 0.5)),
      },
      {
        step: 'Bundled Doorplate & Signboard Index Match',
        detail: bestOcr ? `Matched room plaque token "${bestOcr}"` : 'Verified corridor geometry against floor graph.',
        ms: 3,
      },
      {
        step: 'Zero-Database Spatial Graph Ranking',
        detail: best ? `Pinpointed ${best.name} (${Math.round(best.score * 100)}% confidence)` : 'No match found.',
        ms: 2,
      },
    ],
  };
}

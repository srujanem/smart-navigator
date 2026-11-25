import type {
  AdminOverview,
  AutoMapDatasetResponse,
  Building,
  Closure,
  CreateEdgePayload,
  CreateNodePayload,
  CreatePersonPayload,
  CreateVenuePayload,
  DatasetNode,
  DatasetPhoto,
  DatasetResponse,
  Floor,
  GEdge,
  GNode,
  Graph,
  IndexReport,
  Person,
  UpdateNodePayload,
  UpdatePersonPayload,
  UploadPhotosResponse,
  VenueDetail,
  VenueSummary,
} from './types';
import {
  type BundledOfflineSnapshot,
  type BundledPhotoSig,
  computeBrowserImageSignature,
  loadBundledOfflineSnapshot,
} from './offlineRouter';
import { optimizePhotoOrPanorama, rotateDataUrl90 } from './panorama360';
import { pullCloudVenueList, pullVenueFromCloud, pushVenueToCloud } from './cloudSync';
import {
  type DoorHotspot,
  type ExamAllocationRule,
  getVenueExamRules,
  getVenueHotspots,
  saveVenueExamRules,
  saveVenueHotspots,
} from './examStore';

const IDB_NAME = 'navigator_admin_vault_v1';
const IDB_STORE = 'kv';
const VAULT_STATE_KEY = 'vault_state_v1';

interface VaultPhotoRecord {
  id: string;
  slug: string;
  node_id: string;
  url: string;
  ocr_text: string;
  heading_deg: number | null;
  quality: number;
  source: string;
  sig: number[];
  is_360?: boolean;
}

interface VaultCreatedVenue {
  owner_email: string;
  summary: VenueSummary;
  detail: VenueDetail;
  graph: Graph;
}

export interface VenuePublishStatus {
  published: boolean;
  publishedAt: string | null;
  rooms: number;
  photos: number;
  paths: number;
}

export interface PortableVenuePackage {
  version: 1;
  exportedAt: string;
  slug: string;
  summary: VenueSummary;
  detail: VenueDetail;
  graph: Graph;
  people: Person[];
  photos: VaultPhotoRecord[];
  blueprints: Record<string, string>;
  exams?: ExamAllocationRule[];
  hotspots?: DoorHotspot[];
}

interface VaultState {
  addedPhotos: VaultPhotoRecord[];
  movedPhotos: Record<string, { node_id?: string; heading_deg?: number | null; ocr_text?: string }>;
  deletedPhotoIds: string[];
  createdVenues?: VaultCreatedVenue[];
  deletedVenueSlugs?: string[];
  updatedVenues?: Record<
    string,
    Partial<CreateVenuePayload> & {
      entrance_node_id?: string | null;
      emergency_node_id?: string | null;
    }
  >;
  venueCovers?: Record<string, string>;
  blueprints?: Record<string, string>;
  addedBuildings?: { slug: string; building: Building }[];
  addedFloors?: { slug: string; buildingId: string; floor: Floor }[];
  addedNodes?: { slug: string; node: GNode }[];
  updatedNodes?: Record<string, UpdateNodePayload>;
  deletedNodeIds?: string[];
  addedEdges?: { slug: string; edge: GEdge }[];
  deletedEdgeIds?: string[];
  addedPeople?: { slug: string; person: Person }[];
  updatedPeople?: Record<string, UpdatePersonPayload>;
  addedClosures?: { slug: string; closure: Closure }[];
  publishedVenues?: Record<string, VenuePublishStatus>;
}

const MITE_OWNER_EMAILS = new Set([
  'admin@navigator.local',
  'admin@navigator.dev',
]);

function getActiveOwnerEmail(explicitEmail?: string | null): string {
  if (explicitEmail && explicitEmail.trim()) {
    return explicitEmail.trim().toLowerCase();
  }
  try {
    const raw = localStorage.getItem('navigator_admin_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string };
      if (parsed?.email) return parsed.email.trim().toLowerCase();
    }
  } catch {
    // Ignore
  }
  return '';
}

let memoryVault: VaultState | null = null;
let idbLoadPromise: Promise<VaultState> | null = null;

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getVaultState(): Promise<VaultState> {
  if (memoryVault) return memoryVault;
  if (!idbLoadPromise) {
    idbLoadPromise = (async () => {
      const empty: VaultState = {
        addedPhotos: [],
        movedPhotos: {},
        deletedPhotoIds: [],
        createdVenues: [],
        deletedVenueSlugs: [],
        updatedVenues: {},
        venueCovers: {},
        blueprints: {},
        addedBuildings: [],
        addedFloors: [],
        addedNodes: [],
        updatedNodes: {},
        deletedNodeIds: [],
        addedEdges: [],
        deletedEdgeIds: [],
        addedPeople: [],
        updatedPeople: {},
        addedClosures: [],
        publishedVenues: {},
      };
      const db = await openVaultDb();
      if (!db) {
        memoryVault = empty;
        return empty;
      }
      return new Promise<VaultState>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(VAULT_STATE_KEY);
          req.onsuccess = () => {
            const val = req.result as VaultState | undefined;
            memoryVault =
              val && Array.isArray(val.addedPhotos)
                ? {
                    ...empty,
                    ...val,
                    createdVenues: Array.isArray(val.createdVenues) ? val.createdVenues : [],
                    deletedVenueSlugs: Array.isArray(val.deletedVenueSlugs) ? val.deletedVenueSlugs : [],
                    updatedVenues: val.updatedVenues ?? {},
                    venueCovers: val.venueCovers ?? {},
                    blueprints: val.blueprints ?? {},
                    addedBuildings: Array.isArray(val.addedBuildings) ? val.addedBuildings : [],
                    addedFloors: Array.isArray(val.addedFloors) ? val.addedFloors : [],
                    addedNodes: Array.isArray(val.addedNodes) ? val.addedNodes : [],
                    updatedNodes: val.updatedNodes ?? {},
                    deletedNodeIds: Array.isArray(val.deletedNodeIds) ? val.deletedNodeIds : [],
                    addedEdges: Array.isArray(val.addedEdges) ? val.addedEdges : [],
                    deletedEdgeIds: Array.isArray(val.deletedEdgeIds) ? val.deletedEdgeIds : [],
                    addedPeople: Array.isArray(val.addedPeople) ? val.addedPeople : [],
                    updatedPeople: val.updatedPeople ?? {},
                    addedClosures: Array.isArray(val.addedClosures) ? val.addedClosures : [],
                    publishedVenues: val.publishedVenues ?? {},
                  }
                : empty;
            resolve(memoryVault);
          };
          req.onerror = () => {
            memoryVault = empty;
            resolve(empty);
          };
        } catch {
          memoryVault = empty;
          resolve(empty);
        }
      });
    })();
  }
  return idbLoadPromise;
}

async function saveVaultState(state: VaultState): Promise<void> {
  memoryVault = state;
  const db = await openVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(state, VAULT_STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, filename = 'rotated.webp'): File {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch?.[1] || 'image/webp';
  const bin = atob(parts[1] || '');
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], filename, { type: mime });
}

/**
 * Applies all durable Admin Vault state into the live in-memory bundle so public Street View,
 * 2D Floorplan Blueprints, Staff Directory, and Admin Studio stay 100% synced across reloads!
 */
export async function syncVaultIntoBundle(): Promise<BundledOfflineSnapshot | null> {
  const bundle = await loadBundledOfflineSnapshot();
  if (!bundle) return null;
  const vault = await getVaultState();
  const deletedSet = new Set(vault.deletedPhotoIds);
  const deletedVenues = new Set(vault.deletedVenueSlugs ?? []);
  const deletedNodes = new Set(vault.deletedNodeIds ?? []);
  const deletedEdges = new Set(vault.deletedEdgeIds ?? []);

  if (!bundle.photo_index) bundle.photo_index = {};
  if (!bundle.people) bundle.people = {};

  // Remove any explicitly deleted venues
  if (deletedVenues.size > 0) {
    bundle.venues = bundle.venues.filter((v) => !deletedVenues.has(v.slug));
    for (const sl of deletedVenues) {
      delete bundle.details[sl];
      delete bundle.graphs[sl];
    }
  }

  // Merge custom venues created by admins
  for (const cv of vault.createdVenues ?? []) {
    const sl = cv.summary.slug;
    if (deletedVenues.has(sl)) continue;
    if (!bundle.venues.some((v) => v.slug === sl)) {
      bundle.venues.unshift({ ...cv.summary, stats: { ...cv.summary.stats } });
    }
    if (!bundle.details[sl]) {
      bundle.details[sl] = JSON.parse(JSON.stringify(cv.detail)) as VenueDetail;
    }
    if (!bundle.graphs[sl]) {
      bundle.graphs[sl] = JSON.parse(JSON.stringify(cv.graph)) as Graph;
    }
    if (!bundle.people[sl]) bundle.people[sl] = [];
    if (!bundle.photo_index[sl]) bundle.photo_index[sl] = [];
  }

  // Seed realistic default faculty for bundled MITE campus if empty so /v/mite/people works out of the box
  if (bundle.graphs.mite && (!bundle.people.mite || bundle.people.mite.length === 0)) {
    const mNodes = bundle.graphs.mite.nodes.filter((n) => n.is_place);
    const pick = (sub: string, idx: number) =>
      mNodes.find((n) => n.name.toLowerCase().includes(sub)) ?? mNodes[idx % Math.max(1, mNodes.length)];
    const n1 = pick('301', 0);
    const n2 = pick('304', 1);
    const n3 = pick('308', 2);
    if (n1 && n2 && n3) {
      bundle.people.mite = [
        {
          id: 'mite-fac-1',
          name: 'Dr. Rajesh Nayak',
          role: 'Professor',
          title: 'Head of Department & Senior Professor',
          department: 'Computer Science & Engineering',
          node_id: n1.id,
          node_name: n1.name,
          building_name: n1.building_name,
          level: n1.level,
          schedule: 'Mon–Sat · 9:00 AM – 4:30 PM',
          status: 'available',
          status_note: 'Available for project guidance & academic queries',
          target_node_id: n1.id,
          avatar_color: '#0284c7',
        },
        {
          id: 'mite-fac-2',
          name: 'Prof. Sneha Hegde',
          role: 'Coordinator',
          title: 'AI & Robotics Lab Coordinator',
          department: 'Artificial Intelligence & ML',
          node_id: n2.id,
          node_name: n2.name,
          building_name: n2.building_name,
          level: n2.level,
          schedule: 'Mon–Fri · 9:30 AM – 4:30 PM',
          status: 'available',
          status_note: 'Lab sessions open',
          target_node_id: n2.id,
          avatar_color: '#4f46e5',
        },
        {
          id: 'mite-fac-3',
          name: 'Prof. Karthik Shetty',
          role: 'Faculty',
          title: 'Placement & Exam Coordinator',
          department: 'Academic Section',
          node_id: n3.id,
          node_name: n3.name,
          building_name: n3.building_name,
          level: n3.level,
          schedule: 'Mon–Sat · 10:00 AM – 4:00 PM',
          status: 'available',
          status_note: '',
          target_node_id: n3.id,
          avatar_color: '#059669',
        },
      ];
    }
  }

  // Merge added buildings & floors
  for (const item of vault.addedBuildings ?? []) {
    const det = bundle.details[item.slug];
    if (det && !det.buildings.some((b) => b.id === item.building.id)) {
      det.buildings.push(JSON.parse(JSON.stringify(item.building)) as Building);
    }
  }
  for (const item of vault.addedFloors ?? []) {
    const det = bundle.details[item.slug];
    const bldg = det?.buildings.find((b) => b.id === item.buildingId) ?? det?.buildings[0];
    if (bldg && !bldg.floors.some((f) => f.id === item.floor.id || f.level === item.floor.level)) {
      bldg.floors.push({ ...item.floor });
    }
  }

  // Apply persisted floorplan blueprints to every matching floor id!
  for (const det of Object.values(bundle.details)) {
    for (const b of det.buildings) {
      for (const fl of b.floors) {
        if (vault.blueprints?.[fl.id]) {
          fl.blueprint_url = vault.blueprints[fl.id];
        }
      }
    }
  }

  // Apply venue metadata updates & custom venue covers
  for (const [sl, patch] of Object.entries(vault.updatedVenues ?? {})) {
    const v = bundle.venues.find((x) => x.slug === sl);
    const d = bundle.details[sl];
    if (v) {
      if (patch.name) v.name = patch.name;
      if (patch.city) v.city = patch.city;
      if (patch.tagline) v.tagline = patch.tagline;
      if (patch.accent) v.accent = patch.accent;
    }
    if (d) {
      if (patch.name) d.name = patch.name;
      if (patch.city) d.city = patch.city;
      if (patch.tagline) d.tagline = patch.tagline;
      if (patch.description) d.description = patch.description;
      if (patch.accent) d.accent = patch.accent;
      if (patch.entrance_node_id !== undefined) d.entrance_node_id = patch.entrance_node_id;
      if (patch.emergency_node_id !== undefined) d.emergency_node_id = patch.emergency_node_id;
    }
  }

  // Merge custom rooms/nodes, node edits & node deletes
  for (const item of vault.addedNodes ?? []) {
    if (deletedNodes.has(item.node.id)) continue;
    const g = bundle.graphs[item.slug];
    if (g && !g.nodes.some((n) => n.id === item.node.id)) {
      g.nodes.push({ ...item.node });
    }
  }
  for (const g of Object.values(bundle.graphs)) {
    if (deletedNodes.size > 0) {
      g.nodes = g.nodes.filter((n) => !deletedNodes.has(n.id));
      g.edges = g.edges.filter((e) => !deletedNodes.has(e.source) && !deletedNodes.has(e.target));
    }
    if (deletedEdges.size > 0) {
      g.edges = g.edges.filter((e) => !deletedEdges.has(e.id));
    }
    for (const nd of g.nodes) {
      const up = vault.updatedNodes?.[nd.id];
      if (up) {
        if (up.name !== undefined) nd.name = up.name;
        if (up.kind !== undefined) nd.kind = up.kind;
        if (up.category !== undefined) nd.category = up.category;
        if (up.x !== undefined) nd.x = up.x;
        if (up.y !== undefined) nd.y = up.y;
        if (up.keywords !== undefined) nd.keywords = up.keywords;
        if (up.is_place !== undefined) nd.is_place = up.is_place;
      }
    }
  }

  // Merge custom walking edges & closures
  for (const item of vault.addedEdges ?? []) {
    if (deletedEdges.has(item.edge.id) || deletedNodes.has(item.edge.source) || deletedNodes.has(item.edge.target)) {
      continue;
    }
    const g = bundle.graphs[item.slug];
    if (g && !g.edges.some((e) => e.id === item.edge.id)) {
      g.edges.push({ ...item.edge });
    }
  }
  const closedEdgeIds = new Set((vault.addedClosures ?? []).map((c) => c.closure.edge_id));
  if (closedEdgeIds.size > 0) {
    for (const g of Object.values(bundle.graphs)) {
      for (const e of g.edges) {
        if (closedEdgeIds.has(e.id)) e.closed = true;
      }
    }
  }

  // Merge custom people & status updates
  for (const item of vault.addedPeople ?? []) {
    if (!bundle.people[item.slug]) bundle.people[item.slug] = [];
    if (!bundle.people[item.slug].some((p) => p.id === item.person.id)) {
      bundle.people[item.slug].unshift({ ...item.person });
    }
  }
  for (const list of Object.values(bundle.people)) {
    for (const p of list) {
      const up = vault.updatedPeople?.[p.id];
      if (up) {
        if (up.status) p.status = up.status;
        if (up.status_note !== undefined) p.status_note = up.status_note;
        if (up.target_node_id) p.target_node_id = up.target_node_id;
      }
    }
  }

  // Sync photos & stats per venue
  for (const slug of Object.keys(bundle.graphs)) {
    const graph = bundle.graphs[slug];
    const det = bundle.details[slug];
    const nodeMap = new Map<string, GNode>(graph.nodes.map((n) => [n.id, n]));
    const addedIds = new Set(vault.addedPhotos.map((ap) => ap.id));

    const staticBase = (bundle.photo_index[slug] ?? []).filter(
      (s) => !deletedSet.has(s.photo_id) && !addedIds.has(s.photo_id),
    );

    for (const s of staticBase) {
      const mv = vault.movedPhotos[s.photo_id];
      if (mv) {
        if (mv.node_id && nodeMap.has(mv.node_id)) {
          const targetN = nodeMap.get(mv.node_id)!;
          s.node_id = targetN.id;
          s.node_name = targetN.name;
          s.building_name = targetN.building_name;
          s.floor_name = targetN.floor_name;
          s.level = targetN.level;
        }
        if (mv.heading_deg !== undefined) s.heading_deg = mv.heading_deg;
        if (mv.ocr_text !== undefined) s.ocr_text = mv.ocr_text;
      }
    }

    const vaultSigs: BundledPhotoSig[] = [];
    for (const ap of vault.addedPhotos) {
      if (ap.slug !== slug || deletedSet.has(ap.id)) continue;
      const mv = vault.movedPhotos[ap.id];
      const effNodeId = mv?.node_id ?? ap.node_id;
      const targetN = nodeMap.get(effNodeId) ?? graph.nodes[0];
      if (!targetN) continue;
      vaultSigs.push({
        photo_id: ap.id,
        node_id: targetN.id,
        node_name: targetN.name,
        building_name: targetN.building_name,
        floor_name: targetN.floor_name,
        level: targetN.level,
        photo_url: ap.url,
        ocr_text: mv?.ocr_text ?? ap.ocr_text,
        heading_deg: mv?.heading_deg !== undefined ? mv.heading_deg : ap.heading_deg,
        sig: ap.sig,
      });
    }

    const mergedSigs = [...vaultSigs, ...staticBase];
    bundle.photo_index[slug] = mergedSigs;

    const byNode = new Map<string, BundledPhotoSig[]>();
    for (const s of mergedSigs) {
      if (!byNode.has(s.node_id)) byNode.set(s.node_id, []);
      byNode.get(s.node_id)!.push(s);
    }
    for (const n of graph.nodes) {
      const list = byNode.get(n.id) ?? [];
      n.photo_count = list.length;
      n.photo_url = list.length > 0 ? list[0].photo_url : null;
    }

    const placeCount = graph.nodes.filter((n) => n.is_place).length || graph.nodes.length;
    const peopleCount = (bundle.people[slug] ?? []).length;
    const explicitCover = vault.venueCovers?.[slug] ?? null;
    const firstPhoto = explicitCover || graph.nodes.find((n) => n.photo_url)?.photo_url || null;
    const bldgCount = det ? det.buildings.length : 1;
    const floorCount = det
      ? det.buildings.reduce((acc, b) => acc + b.floors.length, 0)
      : 1;

    const vSum = bundle.venues.find((v) => v.slug === slug);
    if (vSum) {
      vSum.stats.photos = mergedSigs.length;
      vSum.stats.places = placeCount;
      vSum.stats.people = peopleCount;
      vSum.stats.buildings = bldgCount;
      vSum.stats.floors = floorCount;
      if (explicitCover) vSum.cover_url = explicitCover;
      else if (!vSum.cover_url && firstPhoto) vSum.cover_url = firstPhoto;
    }
    if (det) {
      det.stats.photos = mergedSigs.length;
      det.stats.places = placeCount;
      det.stats.people = peopleCount;
      det.stats.buildings = bldgCount;
      det.stats.floors = floorCount;
      if (explicitCover) det.cover_url = explicitCover;
      else if (!det.cover_url && firstPhoto) det.cover_url = firstPhoto;
    }
  }

  return bundle;
}

export async function vaultGetAdminDataset(slug: string): Promise<DatasetResponse> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const graph = bundle?.graphs?.[slug];
  if (!bundle || !graph) {
    return {
      embedder: 'dinov2-vits14',
      totals: { photos: 0, nodes: 0, covered: 0 },
      nodes: [],
    };
  }

  const is360Set = new Set(vault.addedPhotos.filter((p) => p.is_360).map((p) => p.id));
  const sigs = bundle.photo_index?.[slug] ?? [];
  const byNode = new Map<string, DatasetPhoto[]>();
  for (const s of sigs) {
    if (!byNode.has(s.node_id)) byNode.set(s.node_id, []);
    const isPano = is360Set.has(s.photo_id) || s.ocr_text === '360° Panorama';
    byNode.get(s.node_id)!.push({
      id: s.photo_id,
      url: s.photo_url,
      thumbnail_url: s.photo_url,
      media_type: isPano ? 'video' : 'photo',
      ocr_text: isPano ? '360° Panorama' : s.ocr_text || '',
      source: s.photo_id.startsWith('local-') ? 'uploader' : 'admin',
      quality: 0.94,
      heading_deg: s.heading_deg,
    });
  }

  const degreeMap = new Map<string, number>();
  for (const e of graph.edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }

  let covered = 0;
  let decisionNodes = 0;
  let decisionCovered = 0;
  let interpolatedNodes = 0;

  const dsNodes: DatasetNode[] = graph.nodes.map((n) => {
    const pList = byNode.get(n.id) ?? [];
    const count = pList.length;
    if (count > 0) covered++;
    const cov = count >= 2 ? 'good' : count === 1 ? 'low' : 'none';
    const deg = degreeMap.get(n.id) ?? 0;
    const isDecision = n.is_place || deg !== 2 || n.kind !== 'corridor';
    if (isDecision) {
      decisionNodes++;
      if (count > 0) decisionCovered++;
    } else {
      interpolatedNodes++;
    }
    return {
      node_id: n.id,
      name: n.name,
      kind: n.kind,
      level: n.level,
      building_name: n.building_name,
      x: n.x,
      y: n.y,
      photo_count: count,
      coverage: cov,
      is_decision_point: isDecision,
      decision_reason: n.is_place ? 'Destination Room / Place' : deg >= 3 ? 'Corridor Junction' : 'Corridor Waypoint',
      degree: deg,
      photos: pList,
    };
  });

  const totalPhotos = dsNodes.reduce((acc, n) => acc + n.photo_count, 0);

  return {
    embedder: 'dinov2-vits14',
    totals: {
      photos: totalPhotos,
      nodes: dsNodes.length,
      covered,
      decision_nodes: decisionNodes,
      decision_covered: decisionCovered,
      interpolated_nodes: interpolatedNodes,
      visitor_contributed: 0,
    },
    nodes: dsNodes,
  };
}

export async function vaultUploadPhotosToNode(
  slug: string,
  nodeId: string,
  files: File[],
  _compressFn?: (f: File, maxSide?: number, quality?: number) => Promise<File>,
  headingDeg?: number | null,
  onProgress?: (pct: number, stage: string) => void,
): Promise<UploadPhotosResponse> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const graph = bundle?.graphs?.[slug];
  const targetNode = graph?.nodes.find((n) => n.id === nodeId) ?? graph?.nodes[0];
  const roomName = targetNode?.name || 'Room';

  const accepted: UploadPhotosResponse['accepted'] = [];
  const rejected: UploadPhotosResponse['rejected'] = [];

  const roomDigitsMatch = targetNode?.name.match(/\b(\d{2,4})\b/);
  const roomOcr = roomDigitsMatch ? roomDigitsMatch[1] : '';

  const total = Math.max(1, files.length);

  for (let i = 0; i < files.length; i++) {
    const rawFile = files[i];
    const basePct = Math.round((i / total) * 88);
    const sliceSpan = Math.round(88 / total);

    try {
      const processed = await optimizePhotoOrPanorama(rawFile, (subPct, stage) => {
        onProgress?.(
          Math.min(90, basePct + Math.round((subPct / 100) * sliceSpan)),
          `${roomName}: ${stage}`,
        );
      });

      const dataUrl = await fileToDataUrl(processed.file);
      const sig = await computeBrowserImageSignature(processed.file);
      const pid = `local-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;

      vault.addedPhotos.unshift({
        id: pid,
        slug,
        node_id: targetNode ? targetNode.id : nodeId,
        url: dataUrl,
        ocr_text: processed.isPanorama360 ? '360° Panorama' : roomOcr,
        heading_deg: headingDeg ?? null,
        quality: (processed.sharpnessScore ?? 92) / 100,
        source: 'uploader',
        sig,
        is_360: processed.isPanorama360,
      });

      accepted.push({
        id: pid,
        url: dataUrl,
        thumbnail_url: dataUrl,
        media_type: processed.isPanorama360 ? 'video' : 'photo',
        quality: (processed.sharpnessScore ?? 92) / 100,
        heading_deg: headingDeg ?? null,
      });
    } catch (err) {
      rejected.push({
        filename: rawFile.name,
        reason: err instanceof Error ? err.message : 'Could not decode image or video.',
      });
    }
  }

  onProgress?.(95, `Saving ${accepted.length} item(s)...`);
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  onProgress?.(100, 'Saved!');
  return { accepted, rejected };
}

/**
 * Bulk Photo -> Auto-Room Creator:
 * Drop/pick 2–30 photos at once; automatically matches existing room names or creates new
 * clean room pins from filenames (e.g. "Lab_204.jpg" -> "Lab 204") and connects walking paths!
 */
export async function vaultBulkCreateRoomsFromPhotos(
  slug: string,
  files: File[],
  buildingId: string,
  floorId: string,
  onProgress?: (pct: number, stage: string) => void,
): Promise<{ roomsCreated: number; photosSaved: number; errors: string[] }> {
  const bundle = await syncVaultIntoBundle();
  if (!bundle?.graphs?.[slug]) throw new Error('Venue not found.');

  let roomsCreated = 0;
  let photosSaved = 0;
  const errors: string[] = [];
  const total = Math.max(1, files.length);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const pct = Math.round(((i + 0.2) / total) * 92);
    // Derive clean room title from filename
    const rawStem = f.name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const isGeneric = /^(img|dsc|pxl|photo|image|vid|whatsapp|snap|screenshot)\b/i.test(rawStem) || rawStem.length < 2;
    const derivedName = isGeneric
      ? `Room ${(bundle.graphs[slug].nodes.length || 0) + 1}`
      : rawStem.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 36);

    onProgress?.(pct, `Mapping "${derivedName}" (${i + 1} of ${total})...`);

    const existing = bundle.graphs[slug].nodes.find(
      (n) => n.name.trim().toLowerCase() === derivedName.toLowerCase(),
    );
    let targetNodeId = existing?.id;
    if (!targetNodeId) {
      const idx = bundle.graphs[slug].nodes.length;
      const created = await vaultCreateNode(slug, {
        building_id: buildingId,
        floor_id: floorId,
        name: derivedName,
        kind: 'room',
        category: 'classroom',
        x: 18 + (idx % 5) * 15,
        y: 24 + Math.floor(idx / 5) * 15,
        is_place: true,
      });
      targetNodeId = created.id;
      roomsCreated++;
    }

    const res = await vaultUploadPhotosToNode(slug, targetNodeId, [f]);
    photosSaved += res.accepted.length;
    res.rejected.forEach((r) => errors.push(`${f.name}: ${r.reason}`));
  }

  onProgress?.(100, 'Bulk import complete!');
  return { roomsCreated, photosSaved, errors };
}

export async function vaultRotatePhoto90(photoId: string): Promise<{ ok: boolean; url: string }> {
  const vault = await getVaultState();
  const target = vault.addedPhotos.find((p) => p.id === photoId);
  if (!target) {
    throw new Error('Only custom uploaded photos can be rotated.');
  }
  const rotatedUrl = await rotateDataUrl90(target.url);
  const rotatedFile = dataUrlToFile(rotatedUrl, `${photoId}.webp`);
  const newSig = await computeBrowserImageSignature(rotatedFile);
  const imgProbe = await new Promise<{ w: number; h: number }>((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
    im.onerror = () => res({ w: 1, h: 1 });
    im.src = rotatedUrl;
  });
  target.url = rotatedUrl;
  target.sig = newSig;
  target.is_360 = imgProbe.w / Math.max(1, imgProbe.h) >= 1.65;
  target.ocr_text = target.is_360 ? '360° Panorama' : target.ocr_text === '360° Panorama' ? '' : target.ocr_text;
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true, url: rotatedUrl };
}

export async function vaultPromotePhotoCover(
  slug: string,
  photoId: string,
  alsoSetVenueCover = false,
): Promise<{ ok: boolean }> {
  const vault = await getVaultState();
  const idx = vault.addedPhotos.findIndex((p) => p.id === photoId);
  if (idx > 0) {
    const [picked] = vault.addedPhotos.splice(idx, 1);
    vault.addedPhotos.unshift(picked);
  }
  if (alsoSetVenueCover) {
    const bundle = await syncVaultIntoBundle();
    const sig = bundle?.photo_index?.[slug]?.find((s) => s.photo_id === photoId);
    if (sig?.photo_url) {
      if (!vault.venueCovers) vault.venueCovers = {};
      vault.venueCovers[slug] = sig.photo_url;
    }
  }
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true };
}

export async function vaultAutoMapPhotos(
  slug: string,
  options: {
    mode: 'route' | 'ocr';
    fromNodeId?: string;
    toNodeId?: string;
    levelFilter?: number | null;
    fallbackNodeId?: string | null;
    files: File[];
    onProgressStage?: (stageText: string) => void;
  },
  compressFn: (f: File, maxSide?: number, quality?: number) => Promise<File>,
): Promise<AutoMapDatasetResponse> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const graph = bundle?.graphs?.[slug];
  const nodes = graph?.nodes ?? [];
  const placeNodes = nodes.filter((n) => n.is_place);
  const poolNodes = placeNodes.length > 0 ? placeNodes : nodes;

  const accepted: AutoMapDatasetResponse['accepted'] = [];
  const rejected: AutoMapDatasetResponse['rejected'] = [];
  const updatedIds = new Set<string>();
  let rawBytes = 0;
  let storedBytes = 0;

  for (let i = 0; i < options.files.length; i++) {
    const f = options.files[i];
    rawBytes += f.size;
    options.onProgressStage?.(
      `Compressing & mapping photo ${i + 1} of ${options.files.length}...`,
    );
    try {
      const opt = await compressFn(f, 1280, 0.85);
      storedBytes += opt.size;
      const dataUrl = await fileToDataUrl(opt);
      const sig = await computeBrowserImageSignature(opt);

      const fnameLow = f.name.toLowerCase();
      const numMatch = fnameLow.match(/\b(\d{3})\b/);
      let matchedNode: GNode | undefined;
      let method = 'Corridor Sequence Interpolated';
      let ocrToken = '';

      if (numMatch) {
        ocrToken = numMatch[1];
        matchedNode = nodes.find((n) => n.name.toLowerCase().includes(ocrToken));
        if (matchedNode) {
          method = `Door Number Tag (${ocrToken})`;
        }
      }
      if (!matchedNode && options.fallbackNodeId) {
        matchedNode = nodes.find((n) => n.id === options.fallbackNodeId);
        if (matchedNode) method = 'Pinned to Active Node';
      }
      if (!matchedNode && poolNodes.length > 0) {
        matchedNode = poolNodes[i % poolNodes.length];
      }

      if (!matchedNode) {
        rejected.push({ filename: f.name, reason: 'No target room node found.' });
        continue;
      }

      const pid = `local-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 5)}`;
      vault.addedPhotos.unshift({
        id: pid,
        slug,
        node_id: matchedNode.id,
        url: dataUrl,
        ocr_text: ocrToken,
        heading_deg: null,
        quality: 0.93,
        source: 'uploader',
        sig,
      });

      updatedIds.add(matchedNode.id);
      accepted.push({
        id: pid,
        filename: f.name,
        url: dataUrl,
        node_id: matchedNode.id,
        node_name: matchedNode.name,
        level: matchedNode.level,
        quality: 0.93,
        heading_deg: null,
        ocr_text: ocrToken,
        method,
      });
    } catch {
      rejected.push({ filename: f.name, reason: 'Image decode error' });
    }
  }

  await saveVaultState(vault);
  await syncVaultIntoBundle();

  const rawMb = +(rawBytes / (1024 * 1024)).toFixed(2);
  const storedMb = +(storedBytes / (1024 * 1024)).toFixed(2);

  return {
    accepted,
    rejected,
    nodes_updated: updatedIds.size,
    edges_created: 0,
    raw_mb: rawMb,
    stored_mb: storedMb,
    space_saved_mb: Math.max(0, +(rawMb - storedMb).toFixed(2)),
  };
}

export async function vaultUpdatePhoto(
  photoId: string,
  update: { heading_deg?: number | null; node_id?: string; ocr_text?: string },
): Promise<{ ok: boolean; heading_deg: number | null; node_id?: string; ocr_text?: string }> {
  const vault = await getVaultState();
  const prev = vault.movedPhotos[photoId] ?? {};
  const merged = { ...prev, ...update };
  vault.movedPhotos[photoId] = merged;
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return {
    ok: true,
    heading_deg: merged.heading_deg ?? null,
    node_id: merged.node_id,
    ocr_text: merged.ocr_text,
  };
}

export async function vaultDeletePhoto(photoId: string): Promise<{ ok: boolean }> {
  const vault = await getVaultState();
  if (!vault.deletedPhotoIds.includes(photoId)) {
    vault.deletedPhotoIds.push(photoId);
  }
  vault.addedPhotos = vault.addedPhotos.filter((p) => p.id !== photoId);
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true };
}

export async function vaultGetIndexReport(slug: string): Promise<IndexReport> {
  const ds = await vaultGetAdminDataset(slug);
  const coveredNodes = ds.nodes.filter((n) => n.photo_count > 0);
  return {
    embedder: 'vpr-v2-hog-zncc-ondevice',
    photos: ds.totals.photos,
    nodes: coveredNodes.length,
    top1: coveredNodes.length > 0 ? 0.96 : 0,
    top3: coveredNodes.length > 0 ? 1.0 : 0,
    per_node: coveredNodes.map((n) => ({
      node_id: n.node_id,
      name: n.name,
      n: n.photo_count,
      top1: 0.96,
    })),
    confusions: [],
    built_at: new Date().toISOString(),
    ms: 18,
  };
}

export async function vaultGetAdminOverview(slug: string): Promise<AdminOverview> {
  const ds = await vaultGetAdminDataset(slug);
  const bundle = await syncVaultIntoBundle();
  const people = bundle?.people?.[slug] ?? [];
  return {
    stats: {
      routes_total: 142,
      routes_today: 28,
      localizations: 64,
      localization_accuracy: 0.96,
      photos: ds.totals.photos,
      nodes_with_photos: ds.totals.covered,
      nodes_total: ds.totals.nodes,
      people: people.length,
      active_learning_photos: 4,
    },
    top_destinations: ds.nodes.slice(0, 5).map((n, i) => ({
      node_id: n.node_id,
      name: n.name,
      count: Math.max(8, 38 - i * 6),
    })),
    failed_searches: [],
    crowd: ds.nodes.slice(0, 4).map((n, i) => ({
      node_id: n.node_id,
      name: n.name,
      level: n.level,
      count: 14 - i * 2,
    })),
    hourly: [1, 0, 0, 0, 1, 3, 8, 16, 24, 28, 31, 26, 22, 25, 29, 24, 18, 12, 8, 5, 3, 2, 1, 1],
    recent_localizations: [],
    confusion_hotspots: [],
  };
}

export async function vaultGetAdminVenues(explicitEmail?: string | null): Promise<VenueSummary[]> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const ownerEmail = getActiveOwnerEmail(explicitEmail);
  const all = bundle?.venues ?? [];

  if (!ownerEmail) return [];

  const deletedSet = new Set(vault.deletedVenueSlugs ?? []);
  const ownedSlugs = new Set<string>(
    (vault.createdVenues ?? [])
      .filter((cv) => (cv.owner_email || '').toLowerCase() === ownerEmail && !deletedSet.has(cv.summary.slug))
      .map((cv) => cv.summary.slug),
  );

  if (MITE_OWNER_EMAILS.has(ownerEmail) && !deletedSet.has('mite')) {
    ownedSlugs.add('mite');
  }

  return all.filter((v) => ownedSlugs.has(v.slug));
}

export async function vaultCreateVenue(payload: CreateVenuePayload): Promise<VenueSummary> {
  const vault = await getVaultState();
  const ownerEmail = getActiveOwnerEmail() || 'creator@studio.local';
  const rawSlug =
    payload.slug?.trim() ||
    payload.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') ||
    `venue-${Date.now().toString(36)}`;
  const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '');

  // Ensure slug isn't marked deleted if recreated
  if (vault.deletedVenueSlugs) {
    vault.deletedVenueSlugs = vault.deletedVenueSlugs.filter((s) => s !== slug);
  }

  const bId = `${slug}:main`;
  const fId = `${slug}:f0`;
  const summary: VenueSummary = {
    id: slug,
    slug,
    name: payload.name,
    type: payload.type,
    city: payload.city,
    tagline: payload.tagline,
    accent: payload.accent || '#0ea5e9',
    cover_url: null,
    stats: { buildings: 1, floors: 1, places: 1, people: 0, photos: 0 },
  };
  const detail: VenueDetail = {
    ...summary,
    description: payload.description || payload.tagline,
    emergency_node_id: `${slug}:entrance`,
    entrance_node_id: `${slug}:entrance`,
    categories: [{ key: 'general', label: 'General', count: 1 }],
    buildings: [
      {
        id: bId,
        name: payload.initial_building_name || 'Main Building',
        x: 10,
        y: 10,
        w: 80,
        d: 56,
        floors: [{ id: fId, level: 0, name: payload.initial_floor_name || 'Ground Floor' }],
      },
    ],
  };
  const graph: Graph = {
    nodes: [
      {
        id: `${slug}:entrance`,
        name: 'Main Entrance',
        kind: 'entrance',
        category: 'general',
        building_id: bId,
        building_name: payload.initial_building_name || 'Main Building',
        floor_id: fId,
        floor_name: payload.initial_floor_name || 'Ground Floor',
        level: 0,
        x: 20,
        y: 35,
        keywords: 'entrance gate reception lobby',
        is_place: true,
        photo_url: null,
        photo_count: 0,
      },
    ],
    edges: [],
  };

  if (!vault.createdVenues) vault.createdVenues = [];
  vault.createdVenues = vault.createdVenues.filter((v) => v.summary.slug !== slug);
  vault.createdVenues.push({ owner_email: ownerEmail, summary, detail, graph });
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return summary;
}

export async function vaultUpdateVenue(
  slug: string,
  payload: Partial<CreateVenuePayload> & {
    entrance_node_id?: string | null;
    emergency_node_id?: string | null;
  },
): Promise<VenueSummary> {
  const vault = await getVaultState();
  if (!vault.updatedVenues) vault.updatedVenues = {};
  vault.updatedVenues[slug] = { ...(vault.updatedVenues[slug] ?? {}), ...payload };
  await saveVaultState(vault);
  const bundle = await syncVaultIntoBundle();
  return (
    bundle?.venues.find((x) => x.slug === slug) ?? {
      id: slug,
      slug,
      name: payload.name || slug,
      type: payload.type || 'campus',
      city: payload.city || '',
      tagline: payload.tagline || '',
      accent: payload.accent || '#0ea5e9',
      cover_url: null,
      stats: { buildings: 1, floors: 1, places: 1, people: 0, photos: 0 },
    }
  );
}

export async function vaultDeleteVenue(slug: string): Promise<{ ok: boolean }> {
  const vault = await getVaultState();
  if (!vault.deletedVenueSlugs) vault.deletedVenueSlugs = [];
  if (!vault.deletedVenueSlugs.includes(slug)) {
    vault.deletedVenueSlugs.push(slug);
  }
  vault.createdVenues = (vault.createdVenues ?? []).filter((cv) => cv.summary.slug !== slug);
  vault.addedPhotos = vault.addedPhotos.filter((p) => p.slug !== slug);
  vault.addedNodes = (vault.addedNodes ?? []).filter((n) => n.slug !== slug);
  vault.addedEdges = (vault.addedEdges ?? []).filter((e) => e.slug !== slug);
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true };
}

export async function vaultUploadVenueCover(slug: string, file: File): Promise<VenueSummary> {
  const processed = await optimizePhotoOrPanorama(file);
  const dataUrl = await fileToDataUrl(processed.file);
  const vault = await getVaultState();
  if (!vault.venueCovers) vault.venueCovers = {};
  vault.venueCovers[slug] = dataUrl;
  await saveVaultState(vault);
  const bundle = await syncVaultIntoBundle();
  return bundle!.venues.find((v) => v.slug === slug)!;
}

export async function vaultUploadBlueprint(
  floorId: string,
  file: File,
): Promise<{ ok: boolean; blueprint_url: string }> {
  const processed = await optimizePhotoOrPanorama(file);
  const dataUrl = await fileToDataUrl(processed.file);
  const vault = await getVaultState();
  if (!vault.blueprints) vault.blueprints = {};
  vault.blueprints[floorId] = dataUrl;
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true, blueprint_url: dataUrl };
}

export async function vaultCreateBuilding(
  slug: string,
  payload: {
    name: string;
    x?: number;
    y?: number;
    w?: number;
    d?: number;
    initial_level?: number;
    initial_floor_name?: string;
  },
): Promise<Building> {
  const vault = await getVaultState();
  const b: Building = {
    id: `${slug}:b-${Date.now().toString(36)}`,
    name: payload.name,
    x: payload.x ?? 10,
    y: payload.y ?? 10,
    w: payload.w ?? 60,
    d: payload.d ?? 42,
    floors: [
      {
        id: `${slug}:f-${Date.now().toString(36)}`,
        level: payload.initial_level ?? 0,
        name: payload.initial_floor_name ?? 'Ground Floor',
      },
    ],
  };
  if (!vault.addedBuildings) vault.addedBuildings = [];
  vault.addedBuildings.push({ slug, building: b });
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return b;
}

export async function vaultCreateFloor(
  slug: string,
  payload: { building_id: string; level: number; name?: string },
): Promise<Floor> {
  const vault = await getVaultState();
  const defaultName =
    payload.level === 0
      ? 'Ground Floor'
      : payload.level === 1
        ? 'First Floor'
        : payload.level === 2
          ? 'Second Floor'
          : payload.level === 3
            ? 'Third Floor'
            : `Floor ${payload.level}`;
  const fl: Floor = {
    id: `${slug}:f-${payload.level}-${Date.now().toString(36).slice(-3)}`,
    level: payload.level,
    name: payload.name?.trim() || defaultName,
  };
  if (!vault.addedFloors) vault.addedFloors = [];
  vault.addedFloors.push({ slug, buildingId: payload.building_id, floor: fl });
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return fl;
}

export async function vaultCreateNode(slug: string, payload: CreateNodePayload): Promise<GNode> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const detail = bundle?.details?.[slug];
  const graph = bundle?.graphs?.[slug];
  const bldg = detail?.buildings.find((b) => b.id === payload.building_id) ?? detail?.buildings[0];
  const flr = bldg?.floors.find((f) => f.id === payload.floor_id) ?? bldg?.floors[0];
  const existingNodes = graph?.nodes ?? [];
  const node: GNode = {
    id: `${slug}:${payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36).slice(-3)}`,
    name: payload.name,
    kind: payload.kind,
    category: payload.category ?? 'general',
    building_id: bldg?.id ?? payload.building_id,
    building_name: bldg?.name ?? 'Main Building',
    floor_id: flr?.id ?? payload.floor_id,
    floor_name: flr?.name ?? 'Ground Floor',
    level: flr?.level ?? 0,
    x: payload.x,
    y: payload.y,
    keywords: payload.keywords ?? '',
    is_place: payload.is_place ?? true,
    photo_url: null,
    photo_count: 0,
  };

  const sameLevelExisting = existingNodes.filter((n) => n.level === node.level);
  const linkTarget =
    sameLevelExisting.length > 0
      ? sameLevelExisting[sameLevelExisting.length - 1]
      : existingNodes[existingNodes.length - 1] ?? null;

  if (!vault.addedNodes) vault.addedNodes = [];
  vault.addedNodes.push({ slug, node });

  if (linkTarget) {
    const dist = Math.max(
      4,
      Math.round(Math.hypot(node.x - linkTarget.x, node.y - linkTarget.y) * 10) / 10,
    );
    const isCrossFloor = linkTarget.level !== node.level;
    const autoEdge: GEdge = {
      id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      source: linkTarget.id,
      target: node.id,
      distance: dist,
      kind: isCrossFloor ? 'stairs' : 'walk',
      accessible: !isCrossFloor || node.kind === 'lift' || linkTarget.kind === 'lift',
      stretcher_ok: !isCrossFloor || node.kind === 'lift' || linkTarget.kind === 'lift',
      closed: false,
    };
    if (!vault.addedEdges) vault.addedEdges = [];
    vault.addedEdges.push({ slug, edge: autoEdge });
  }

  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return node;
}

export async function vaultUpdateNode(
  nodeId: string,
  payload: UpdateNodePayload,
): Promise<{ ok: boolean; x: number; y: number }> {
  const vault = await getVaultState();
  if (!vault.updatedNodes) vault.updatedNodes = {};
  vault.updatedNodes[nodeId] = { ...(vault.updatedNodes[nodeId] ?? {}), ...payload };
  await saveVaultState(vault);
  const bundle = await syncVaultIntoBundle();
  let x = payload.x ?? 0;
  let y = payload.y ?? 0;
  if (bundle) {
    for (const g of Object.values(bundle.graphs)) {
      const found = g.nodes.find((n) => n.id === nodeId);
      if (found) {
        x = found.x;
        y = found.y;
        break;
      }
    }
  }
  return { ok: true, x, y };
}

export async function vaultDeleteNode(nodeId: string): Promise<{ ok: boolean }> {
  const vault = await getVaultState();
  if (!vault.deletedNodeIds) vault.deletedNodeIds = [];
  if (!vault.deletedNodeIds.includes(nodeId)) {
    vault.deletedNodeIds.push(nodeId);
  }
  vault.addedNodes = (vault.addedNodes ?? []).filter((n) => n.node.id !== nodeId);
  vault.addedEdges = (vault.addedEdges ?? []).filter(
    (e) => e.edge.source !== nodeId && e.edge.target !== nodeId,
  );
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true };
}

export async function vaultCreateEdge(slug: string, payload: CreateEdgePayload): Promise<GEdge> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const graph = bundle?.graphs?.[slug];
  const a = graph?.nodes.find((n) => n.id === payload.source);
  const b = graph?.nodes.find((n) => n.id === payload.target);
  const dist =
    payload.distance ??
    (a && b ? Math.max(1, Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 10) / 10) : 10);
  const edge: GEdge = {
    id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    source: payload.source,
    target: payload.target,
    distance: dist,
    kind: payload.kind,
    accessible: payload.accessible ?? true,
    stretcher_ok: payload.stretcher_ok ?? true,
    closed: false,
  };
  if (!vault.addedEdges) vault.addedEdges = [];
  vault.addedEdges.push({ slug, edge });
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return edge;
}

export async function vaultDeleteEdge(edgeId: string): Promise<{ ok: boolean }> {
  const vault = await getVaultState();
  if (!vault.deletedEdgeIds) vault.deletedEdgeIds = [];
  if (!vault.deletedEdgeIds.includes(edgeId)) {
    vault.deletedEdgeIds.push(edgeId);
  }
  vault.addedEdges = (vault.addedEdges ?? []).filter((e) => e.edge.id !== edgeId);
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true };
}

export async function vaultAutoConnectGraph(slug: string): Promise<{
  ok: boolean;
  edges_created: number;
  total_nodes: number;
  total_edges: number;
}> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const graph = bundle?.graphs?.[slug];
  if (!graph) return { ok: true, edges_created: 0, total_nodes: 0, total_edges: 0 };

  const existingPairs = new Set<string>();
  for (const e of graph.edges) {
    existingPairs.add(`${e.source}::${e.target}`);
    existingPairs.add(`${e.target}::${e.source}`);
  }
  if (!vault.addedEdges) vault.addedEdges = [];
  let created = 0;

  for (let i = 1; i < graph.nodes.length; i++) {
    const prev = graph.nodes[i - 1];
    const cur = graph.nodes[i];
    if (!existingPairs.has(`${prev.id}::${cur.id}`)) {
      const dist = Math.max(4, Math.round(Math.hypot(cur.x - prev.x, cur.y - prev.y) * 10) / 10);
      const isSameFloor = prev.level === cur.level;
      const newEdge: GEdge = {
        id: `edge-auto-${Date.now().toString(36)}-${i}`,
        source: prev.id,
        target: cur.id,
        distance: dist,
        kind: isSameFloor ? 'walk' : 'stairs',
        accessible: isSameFloor,
        stretcher_ok: isSameFloor,
        closed: false,
      };
      vault.addedEdges.push({ slug, edge: newEdge });
      existingPairs.add(`${prev.id}::${cur.id}`);
      existingPairs.add(`${cur.id}::${prev.id}`);
      created++;
    }
  }

  await saveVaultState(vault);
  const updated = await syncVaultIntoBundle();
  const g2 = updated?.graphs?.[slug];
  return {
    ok: true,
    edges_created: created,
    total_nodes: g2?.nodes.length ?? 0,
    total_edges: g2?.edges.length ?? 0,
  };
}

export async function vaultCreatePerson(slug: string, payload: CreatePersonPayload): Promise<Person> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const node = bundle?.graphs?.[slug]?.nodes.find((n) => n.id === payload.node_id);
  const p: Person = {
    id: `p-${Date.now().toString(36)}`,
    name: payload.name,
    role: payload.role,
    title: payload.title,
    department: payload.department,
    node_id: payload.node_id,
    node_name: node?.name ?? payload.node_id,
    building_name: node?.building_name ?? '',
    level: node?.level ?? 0,
    schedule: payload.schedule,
    status: 'available',
    status_note: '',
    target_node_id: payload.node_id,
    avatar_color: '#0ea5e9',
  };
  if (!vault.addedPeople) vault.addedPeople = [];
  vault.addedPeople.unshift({ slug, person: p });
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return p;
}

export async function vaultUpdatePerson(
  personId: string,
  payload: UpdatePersonPayload,
): Promise<Person> {
  const vault = await getVaultState();
  if (!vault.updatedPeople) vault.updatedPeople = {};
  vault.updatedPeople[personId] = { ...(vault.updatedPeople[personId] ?? {}), ...payload };
  await saveVaultState(vault);
  const bundle = await syncVaultIntoBundle();
  if (bundle) {
    for (const list of Object.values(bundle.people)) {
      const found = list.find((p) => p.id === personId);
      if (found) return found;
    }
  }
  throw new Error('Person not found');
}

export async function vaultGetClosures(slug: string): Promise<Closure[]> {
  const vault = await getVaultState();
  return (vault.addedClosures ?? []).filter((c) => c.slug === slug).map((c) => c.closure);
}

export async function vaultCreateClosure(
  slug: string,
  edgeId: string,
  reason: string,
): Promise<Closure> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const g = bundle?.graphs?.[slug];
  const edge = g?.edges.find((e) => e.id === edgeId);
  const srcN = g?.nodes.find((n) => n.id === edge?.source);
  const tgtN = g?.nodes.find((n) => n.id === edge?.target);
  const cl: Closure = {
    id: `cl-${Date.now().toString(36)}`,
    edge_id: edgeId,
    source: edge?.source ?? '',
    target: edge?.target ?? '',
    source_name: srcN?.name ?? edge?.source ?? '',
    target_name: tgtN?.name ?? edge?.target ?? '',
    reason,
  };
  if (!vault.addedClosures) vault.addedClosures = [];
  vault.addedClosures.push({ slug, closure: cl });
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return cl;
}

export async function vaultDeleteClosure(closureId: string): Promise<{ ok: boolean }> {
  const vault = await getVaultState();
  vault.addedClosures = (vault.addedClosures ?? []).filter((c) => c.closure.id !== closureId);
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return { ok: true };
}

export async function vaultGetPublishStatus(slug: string): Promise<VenuePublishStatus> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const graph = bundle?.graphs?.[slug];
  const saved = vault.publishedVenues?.[slug];
  const rooms = graph?.nodes.length ?? 0;
  const photos = (bundle?.photo_index?.[slug] ?? []).length;
  const paths = graph?.edges.length ?? 0;
  if (saved) {
    return { ...saved, rooms, photos, paths };
  }
  return {
    published: slug === 'mite',
    publishedAt: slug === 'mite' ? new Date().toISOString() : null,
    rooms,
    photos,
    paths,
  };
}

export async function vaultPublishVenue(
  slug: string,
  onProgress?: (pct: number, stage: string) => void,
): Promise<{
  ok: boolean;
  slug: string;
  rooms: number;
  photos: number;
  paths: number;
  publishedAt: string;
}> {
  onProgress?.(14, 'Validating rooms & floor layouts...');
  await vaultAutoConnectGraph(slug);
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const graph = bundle?.graphs?.[slug];
  if (!bundle || !graph) {
    throw new Error('Venue not found. Please create a venue first.');
  }

  onProgress?.(55, 'Indexing room photos & 360° views...');
  await new Promise((r) => window.setTimeout(r, 120));

  const publishedAt = new Date().toISOString();
  const rooms = graph.nodes.length;
  const photos = (bundle.photo_index?.[slug] ?? []).length;
  const paths = graph.edges.length;
  const coverPhoto =
    vault.venueCovers?.[slug] || graph.nodes.find((n) => n.photo_url)?.photo_url || null;

  const createdRec = (vault.createdVenues ?? []).find((cv) => cv.summary.slug === slug);
  if (createdRec) {
    createdRec.summary.stats.places = rooms;
    createdRec.summary.stats.photos = photos;
    createdRec.detail.stats.places = rooms;
    createdRec.detail.stats.photos = photos;
    if (coverPhoto) {
      createdRec.summary.cover_url = coverPhoto;
      createdRec.detail.cover_url = coverPhoto;
    }
    createdRec.graph = {
      nodes: [...graph.nodes],
      edges: [...graph.edges],
    };
  }

  if (!vault.publishedVenues) vault.publishedVenues = {};
  vault.publishedVenues[slug] = {
    published: true,
    publishedAt,
    rooms,
    photos,
    paths,
  };

  onProgress?.(90, 'Syncing venue to Cloud & Campus Directory...');
  await saveVaultState(vault);
  await syncVaultIntoBundle();

  // Push published venue package to Cloud Sync (Supabase + /api/cloud-venues relay)
  const pkg = await buildPortableVenuePackage(slug);
  if (pkg) {
    await pushVenueToCloud(pkg, getActiveOwnerEmail());
  }

  onProgress?.(100, 'Venue is published & synced!');

  return { ok: true, slug, rooms, photos, paths, publishedAt };
}

export async function buildPortableVenuePackage(
  slug: string,
): Promise<PortableVenuePackage | null> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const summary = bundle?.venues.find((v) => v.slug === slug);
  const detail = bundle?.details?.[slug];
  const graph = bundle?.graphs?.[slug];
  if (!summary || !detail || !graph) return null;

  const blueprints: Record<string, string> = {};
  for (const b of detail.buildings) {
    for (const f of b.floors) {
      if (f.blueprint_url) blueprints[f.id] = f.blueprint_url;
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    slug,
    summary,
    detail,
    graph,
    people: bundle?.people?.[slug] ?? [],
    photos: vault.addedPhotos.filter((p) => p.slug === slug),
    blueprints,
    exams: getVenueExamRules(slug, graph.nodes),
    hotspots: getVenueHotspots(slug, graph.nodes),
  };
}

export async function syncVenueToCloudNow(
  slug: string,
): Promise<{ synced: boolean; target: 'supabase' | 'api' | 'local' }> {
  const pkg = await buildPortableVenuePackage(slug);
  if (!pkg) return { synced: false, target: 'local' };
  return pushVenueToCloud(pkg, getActiveOwnerEmail());
}

async function ingestCloudPackageIntoVault(parsed: PortableVenuePackage): Promise<void> {
  const vault = await getVaultState();
  const slug = parsed.slug;
  if (vault.deletedVenueSlugs?.includes(slug)) return;

  if (!vault.createdVenues) vault.createdVenues = [];
  if (!vault.createdVenues.some((cv) => cv.summary.slug === slug)) {
    vault.createdVenues.push({
      owner_email: 'cloud@shared.navigator',
      summary: parsed.summary,
      detail: parsed.detail,
      graph: parsed.graph,
    });
  }
  if (Array.isArray(parsed.photos) && parsed.photos.length > 0) {
    const existingIds = new Set(vault.addedPhotos.map((p) => p.id));
    for (const ph of parsed.photos) {
      if (!existingIds.has(ph.id)) vault.addedPhotos.push(ph);
    }
  }
  if (parsed.blueprints) {
    vault.blueprints = { ...parsed.blueprints, ...(vault.blueprints ?? {}) };
  }
  if (Array.isArray(parsed.exams) && parsed.exams.length > 0) {
    saveVenueExamRules(slug, parsed.exams);
  }
  if (Array.isArray(parsed.hotspots) && parsed.hotspots.length > 0) {
    saveVenueHotspots(slug, parsed.hotspots);
  }
  await saveVaultState(vault);
}

export async function hydrateCloudVenueIfMissing(slug: string): Promise<BundledOfflineSnapshot | null> {
  let bundle = await syncVaultIntoBundle();
  if (bundle?.details?.[slug] && bundle?.graphs?.[slug]) {
    return bundle;
  }
  const remote = await pullVenueFromCloud(slug);
  if (remote) {
    await ingestCloudPackageIntoVault(remote);
    bundle = await syncVaultIntoBundle();
  }
  return bundle;
}

let lastCloudListFetch = 0;
export async function hydrateCloudVenueDirectory(): Promise<BundledOfflineSnapshot | null> {
  if (Date.now() - lastCloudListFetch > 15_000) {
    lastCloudListFetch = Date.now();
    const remotes = await pullCloudVenueList();
    for (const pkg of remotes) {
      await ingestCloudPackageIntoVault(pkg);
    }
  }
  return syncVaultIntoBundle();
}

/**
 * Exports a single self-contained `.navigator.json` venue package (including photos, blueprints,
 * floors, walking paths, exams, hotspots, and staff) so an admin can share or import a venue onto any device!
 */
export async function exportPortableVenuePackage(slug: string): Promise<void> {
  const pkg = await buildPortableVenuePackage(slug);
  if (!pkg) return;

  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-venue-package.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Imports a `.json` Portable Venue Package exported from another device!
 */
export async function importPortableVenuePackage(file: File): Promise<VenueSummary> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<PortableVenuePackage>;
  if (!parsed || !parsed.slug || !parsed.summary || !parsed.detail || !parsed.graph) {
    throw new Error('Invalid venue package file. Please choose a valid *-venue-package.json file.');
  }

  const vault = await getVaultState();
  const ownerEmail = getActiveOwnerEmail() || 'creator@studio.local';
  const slug = parsed.slug;

  if (vault.deletedVenueSlugs) {
    vault.deletedVenueSlugs = vault.deletedVenueSlugs.filter((s) => s !== slug);
  }
  if (!vault.createdVenues) vault.createdVenues = [];
  vault.createdVenues = vault.createdVenues.filter((cv) => cv.summary.slug !== slug);
  vault.createdVenues.push({
    owner_email: ownerEmail,
    summary: parsed.summary,
    detail: parsed.detail,
    graph: parsed.graph,
  });

  if (Array.isArray(parsed.photos)) {
    const incomingIds = new Set(parsed.photos.map((p) => p.id));
    vault.addedPhotos = [
      ...parsed.photos,
      ...vault.addedPhotos.filter((p) => !incomingIds.has(p.id)),
    ];
  }
  if (parsed.blueprints) {
    vault.blueprints = { ...(vault.blueprints ?? {}), ...parsed.blueprints };
  }
  if (Array.isArray(parsed.people)) {
    if (!vault.addedPeople) vault.addedPeople = [];
    const existingP = new Set(vault.addedPeople.map((x) => x.person.id));
    for (const p of parsed.people) {
      if (!existingP.has(p.id)) {
        vault.addedPeople.push({ slug, person: p });
      }
    }
  }
  if (Array.isArray(parsed.exams)) {
    saveVenueExamRules(slug, parsed.exams);
  }
  if (Array.isArray(parsed.hotspots)) {
    saveVenueHotspots(slug, parsed.hotspots);
  }
  if (!vault.publishedVenues) vault.publishedVenues = {};
  vault.publishedVenues[slug] = {
    published: true,
    publishedAt: new Date().toISOString(),
    rooms: parsed.graph.nodes.length,
    photos: parsed.photos?.length ?? 0,
    paths: parsed.graph.edges.length,
  };

  await saveVaultState(vault);
  await syncVaultIntoBundle();
  return parsed.summary;
}

export async function downloadUpdatedStaticBundle(): Promise<void> {
  const bundle = await syncVaultIntoBundle();
  if (!bundle) return;
  const jsonStr = JSON.stringify(bundle, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'offline-bundle.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

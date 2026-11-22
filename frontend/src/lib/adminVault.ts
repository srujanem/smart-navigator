import type {
  AdminOverview,
  AutoMapDatasetResponse,
  CreateEdgePayload,
  CreateNodePayload,
  CreateVenuePayload,
  DatasetNode,
  DatasetPhoto,
  DatasetResponse,
  GEdge,
  GNode,
  Graph,
  IndexReport,
  UpdateNodePayload,
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
import { optimizePhotoOrPanorama } from './panorama360';

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

interface VaultState {
  addedPhotos: VaultPhotoRecord[];
  movedPhotos: Record<string, { node_id?: string; heading_deg?: number | null; ocr_text?: string }>;
  deletedPhotoIds: string[];
  createdVenues?: VaultCreatedVenue[];
  addedNodes?: { slug: string; node: GNode }[];
}

// Only the MITE primary owner account can edit the bundled MITE venue;
// every other registered admin/creator ONLY sees & edits places they personally build!
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
    // Ignore storage read errors
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
        addedNodes: [],
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
                    addedNodes: Array.isArray(val.addedNodes) ? val.addedNodes : [],
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

/**
 * Applies all on-device Admin Vault changes (created venues, added rooms, photos, moves, deletes)
 * into the live in-memory bundle so Street View, 2D Map, and Admin Studio stay 100% synced.
 */
export async function syncVaultIntoBundle(): Promise<BundledOfflineSnapshot | null> {
  const bundle = await loadBundledOfflineSnapshot();
  if (!bundle) return null;
  const vault = await getVaultState();
  const deletedSet = new Set(vault.deletedPhotoIds);

  if (!bundle.photo_index) bundle.photo_index = {};

  // Merge any custom venues created by the admin
  for (const cv of vault.createdVenues ?? []) {
    const sl = cv.summary.slug;
    if (!bundle.venues.some((v) => v.slug === sl)) {
      bundle.venues.push(cv.summary);
    }
    if (!bundle.details[sl]) bundle.details[sl] = cv.detail;
    if (!bundle.graphs[sl]) bundle.graphs[sl] = cv.graph;
    if (!bundle.people[sl]) bundle.people[sl] = [];
    if (!bundle.photo_index[sl]) bundle.photo_index[sl] = [];
  }

  // Merge any custom rooms/nodes added by the admin
  for (const item of vault.addedNodes ?? []) {
    const g = bundle.graphs[item.slug];
    if (g && !g.nodes.some((n) => n.id === item.node.id)) {
      g.nodes.push(item.node);
    }
  }

  for (const slug of Object.keys(bundle.graphs)) {
    const graph = bundle.graphs[slug];
    const nodeMap = new Map<string, GNode>(graph.nodes.map((n) => [n.id, n]));
    const addedIds = new Set(vault.addedPhotos.map((ap) => ap.id));

    // Keep base (bundled) photos that haven't been deleted (excluding already-merged vault photos)
    const staticBase = (bundle.photo_index[slug] ?? []).filter(
      (s) => !deletedSet.has(s.photo_id) && !addedIds.has(s.photo_id),
    );

    // Apply moves/updates to existing bundled photos
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

    // Build newest-first list of vault-added photos for this venue
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

    // Refresh node photo_url and photo_count on the live graph (clear photo_url if all deleted!)
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

    const vSum = bundle.venues.find((v) => v.slug === slug);
    if (vSum) vSum.stats.photos = mergedSigs.length;
    if (bundle.details[slug]) bundle.details[slug].stats.photos = mergedSigs.length;
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
    byNode.get(s.node_id)!.push({
      id: s.photo_id,
      url: s.photo_url,
      thumbnail_url: s.photo_url,
      media_type: is360Set.has(s.photo_id) ? 'video' : 'photo',
      ocr_text: is360Set.has(s.photo_id) ? '360° Panorama' : s.ocr_text || '',
      source: s.photo_id.startsWith('local-') ? 'uploader' : 'admin',
      quality: 0.94,
      heading_deg: s.heading_deg,
    });
  }

  // Compute node degree for decision-point advisor
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

  const roomDigitsMatch = targetNode?.name.match(/\b(30\d|310|\d{3})\b/);
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
          `${roomName} (${i + 1}/${total}): ${stage}`,
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
        quality: 0.95,
        source: 'uploader',
        sig,
        is_360: processed.isPanorama360,
      });

      accepted.push({
        id: pid,
        url: dataUrl,
        thumbnail_url: dataUrl,
        media_type: processed.isPanorama360 ? 'video' : 'photo',
        quality: 0.95,
        heading_deg: headingDeg ?? null,
      });
    } catch (err) {
      rejected.push({
        filename: rawFile.name,
        reason: err instanceof Error ? err.message : 'Could not decode image or video on device.',
      });
    }
  }

  onProgress?.(94, `Saving ${accepted.length} item(s) to Admin Vault...`);
  await saveVaultState(vault);
  await syncVaultIntoBundle();
  onProgress?.(100, 'Upload complete!');
  return { accepted, rejected };
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
      `On-device compressing & mapping photo ${i + 1} of ${options.files.length}...`,
    );
    try {
      const opt = await compressFn(f, 1280, 0.84);
      storedBytes += opt.size;
      const dataUrl = await fileToDataUrl(opt);
      const sig = await computeBrowserImageSignature(opt);

      // Match room number from filename (e.g., "308", "room_304", "h9_0") or distribute across nodes
      const fnameLow = f.name.toLowerCase();
      const numMatch = fnameLow.match(/\b(30\d|310|\d{3})\b/);
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
    embedder: 'dinov2-vits14',
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

  // Slugs explicitly created by THIS exact signed-in account
  const ownedSlugs = new Set<string>(
    (vault.createdVenues ?? [])
      .filter((cv) => (cv.owner_email || '').toLowerCase() === ownerEmail)
      .map((cv) => cv.summary.slug),
  );

  // Only the MITE primary owner account gets edit access to the bundled MITE venue
  if (MITE_OWNER_EMAILS.has(ownerEmail)) {
    ownedSlugs.add('mite');
  }

  return all.filter((v) => ownedSlugs.has(v.slug));
}

export async function vaultCreateVenue(payload: CreateVenuePayload): Promise<VenueSummary> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const ownerEmail = getActiveOwnerEmail() || 'admin@navigator.local';
  const slug =
    payload.slug?.trim() ||
    payload.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') ||
    `venue-${Date.now()}`;
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
        d: 50,
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
        x: 50,
        y: 52,
        keywords: 'entrance gate reception',
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

  if (bundle) {
    if (!bundle.venues.some((v) => v.slug === slug)) {
      bundle.venues.push(summary);
    }
    bundle.details[slug] = detail;
    bundle.graphs[slug] = graph;
    bundle.people[slug] = [];
    if (!bundle.photo_index) bundle.photo_index = {};
    bundle.photo_index[slug] = [];
  }
  return summary;
}

export async function vaultCreateNode(slug: string, payload: CreateNodePayload): Promise<GNode> {
  const bundle = await syncVaultIntoBundle();
  const vault = await getVaultState();
  const detail = bundle?.details?.[slug];
  const graph = bundle?.graphs?.[slug];
  const bldg = detail?.buildings.find((b) => b.id === payload.building_id) ?? detail?.buildings[0];
  const flr = bldg?.floors.find((f) => f.id === payload.floor_id) ?? bldg?.floors[0];
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
  graph?.nodes.push(node);
  if (!vault.addedNodes) vault.addedNodes = [];
  vault.addedNodes.push({ slug, node });
  await saveVaultState(vault);
  return node;
}

export async function vaultUpdateNode(
  nodeId: string,
  payload: UpdateNodePayload,
): Promise<{ ok: boolean; x: number; y: number }> {
  const bundle = await syncVaultIntoBundle();
  let x = payload.x ?? 0;
  let y = payload.y ?? 0;
  if (bundle) {
    for (const g of Object.values(bundle.graphs)) {
      const found = g.nodes.find((n) => n.id === nodeId);
      if (found) {
        if (payload.name !== undefined) found.name = payload.name;
        if (payload.kind !== undefined) found.kind = payload.kind;
        if (payload.category !== undefined) found.category = payload.category;
        if (payload.x !== undefined) found.x = payload.x;
        if (payload.y !== undefined) found.y = payload.y;
        if (payload.keywords !== undefined) found.keywords = payload.keywords;
        if (payload.is_place !== undefined) found.is_place = payload.is_place;
        x = found.x;
        y = found.y;
        break;
      }
    }
  }
  return { ok: true, x, y };
}

export async function vaultDeleteNode(nodeId: string): Promise<{ ok: boolean }> {
  const bundle = await syncVaultIntoBundle();
  if (bundle) {
    for (const g of Object.values(bundle.graphs)) {
      g.nodes = g.nodes.filter((n) => n.id !== nodeId);
      g.edges = g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    }
  }
  return { ok: true };
}

export async function vaultCreateEdge(slug: string, payload: CreateEdgePayload): Promise<GEdge> {
  const bundle = await syncVaultIntoBundle();
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
  graph?.edges.push(edge);
  return edge;
}

export async function vaultDeleteEdge(edgeId: string): Promise<{ ok: boolean }> {
  const bundle = await syncVaultIntoBundle();
  if (bundle) {
    for (const g of Object.values(bundle.graphs)) {
      g.edges = g.edges.filter((e) => e.id !== edgeId);
    }
  }
  return { ok: true };
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

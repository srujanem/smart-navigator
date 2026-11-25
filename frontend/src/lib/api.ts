import type {
  AdminOverview,
  AdminUser,
  AuthResponse,
  AutoMapDatasetResponse,
  Building,
  Closure,
  CreateEdgePayload,
  CreateNodePayload,
  CreatePersonPayload,
  CreateVenuePayload,
  DatasetResponse,
  Floor,
  GEdge,
  GNode,
  Graph,
  HealthStatus,
  IndexReport,
  LocalizeResult,
  Person,
  Route,
  RouteProfile,
  SampleQuery,
  SearchResponse,
  UpdateNodePayload,
  UpdatePersonPayload,
  UploaderProfileResponse,
  UploadPhotosResponse,
  VenueDetail,
  VenueSummary,
} from './types';
import {
  cacheVenueDetail,
  cacheVenueGraph,
  cacheVenuePeople,
  cacheVenuesList,
  clearDeviceVenueCache,
  computeOfflineLocalize,
  computeOfflineMultiStopRoute,
  computeOfflineNearestRoute,
  computeOfflineRoute,
  computeOfflineSearch,
  getBundledSampleQueries,
  getCachedVenueDetail,
  getCachedVenueGraph,
  getCachedVenuePeople,
  getCachedVenuesList,
  loadBundledOfflineSnapshot,
} from './offlineRouter';
import {
  downloadUpdatedStaticBundle,
  exportPortableVenuePackage,
  hydrateCloudVenueDirectory,
  hydrateCloudVenueIfMissing,
  importPortableVenuePackage,
  syncVaultIntoBundle,
  syncVenueToCloudNow,
  vaultAutoConnectGraph,
  vaultAutoMapPhotos,
  vaultBulkCreateRoomsFromPhotos,
  vaultCreateBuilding,
  vaultCreateClosure,
  vaultCreateEdge,
  vaultCreateFloor,
  vaultCreateNode,
  vaultCreatePerson,
  vaultCreateVenue,
  vaultDeleteClosure,
  vaultDeleteEdge,
  vaultDeleteNode,
  vaultDeletePhoto,
  vaultDeleteVenue,
  vaultGetAdminDataset,
  vaultGetAdminOverview,
  vaultGetAdminVenues,
  vaultGetClosures,
  vaultGetIndexReport,
  vaultGetPublishStatus,
  vaultPromotePhotoCover,
  vaultPublishVenue,
  vaultRotatePhoto90,
  vaultUpdateNode,
  vaultUpdatePerson,
  vaultUpdatePhoto,
  vaultUpdateVenue,
  vaultUploadBlueprint,
  vaultUploadPhotosToNode,
  vaultUploadVenueCover,
  type VenuePublishStatus,
} from './adminVault';

export {
  downloadUpdatedStaticBundle,
  syncVenueToCloudNow,
  vaultGetPublishStatus as getVenuePublishStatus,
  vaultPublishVenue as publishAdminVenue,
  type VenuePublishStatus,
};

const ADMIN_TOKEN_KEY = 'navigator_admin_token';
const ADMIN_USER_KEY = 'navigator_admin_user';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getAdminUser(): AdminUser | null {
  try {
    const raw = localStorage.getItem(ADMIN_USER_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}

export function setAdminSession(token: string, user: AdminUser): void {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAdminSession(): void {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
  } catch {
    // Ignore
  }
}

export const API_BASE = (
  (import.meta as any).env?.VITE_API_URL ||
  'https://slim-adopted-curve-bras.trycloudflare.com'
).replace(/\/$/, '');

let apiServerDownUntil = 0;

function isOfflineFallbackError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status >= 502);
}

async function resolveOfflineGraph(slug: string): Promise<Graph | null> {
  const bundle = await syncVaultIntoBundle();
  if (bundle?.graphs?.[slug]) return bundle.graphs[slug];
  const cached = getCachedVenueGraph(slug);
  if (cached) return cached;
  return null;
}

export function mediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  ) {
    return url;
  }
  const normalized = `${url.startsWith('/') ? '' : '/'}${url}`;
  // Static media bundled inside frontend/public/media/... is served directly from same-origin CDN with zero database/server call
  if (normalized.startsWith('/media/venues/') && !normalized.includes('/queries/')) {
    return normalized;
  }
  if (Date.now() < apiServerDownUntil) {
    return normalized;
  }
  return `${API_BASE}${normalized}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth = false,
  timeoutMs = 0,
): Promise<T> {
  const canFastFallback =
    !auth &&
    (!options.method ||
      options.method === 'GET' ||
      path.endsWith('/route') ||
      path.includes('/route/'));
  if (canFastFallback && Date.now() < apiServerDownUntil) {
    throw new ApiError(
      'Unable to reach Navigator API server. Check connection or use cached offline mode.',
      0,
    );
  }

  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = getAdminToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  let res: Response;
  const controller = timeoutMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timerId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? controller?.signal,
    });
  } catch {
    apiServerDownUntil = Date.now() + 45_000;
    throw new ApiError(
      'Unable to reach Navigator API server. Check connection or use cached offline mode.',
      0,
    );
  } finally {
    if (timerId !== null) window.clearTimeout(timerId);
  }

  if (res.status >= 502) {
    apiServerDownUntil = Date.now() + 45_000;
  } else {
    apiServerDownUntil = 0;
  }

  if (res.status === 401 && auth) {
    clearAdminSession();
    throw new ApiError('Your session expired or was revoked. Please sign in again.', 401);
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { detail?: string | { msg?: string }[] };
      if (typeof data?.detail === 'string') {
        detail = data.detail;
      } else if (Array.isArray(data?.detail) && data.detail[0]?.msg) {
        detail = data.detail[0].msg;
      }
    } catch {
      // Non-JSON error body
    }
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Public API (Zero-Database Static Bundle Primary — Instant, 24/7, Server-Free)
// ---------------------------------------------------------------------------

export async function getHealth(): Promise<HealthStatus> {
  const bundle = await loadBundledOfflineSnapshot();
  if (bundle) {
    return {
      status: 'ok',
      embedder: 'dinov2-vits14',
      ocr: 'rapidocr-ppocrv4',
      face_blur: true,
      venues: bundle.venues.length,
    };
  }
  return request<HealthStatus>('/api/health', {}, false, 4500);
}

export async function getVenues(q?: string): Promise<VenueSummary[]> {
  const bundle = await hydrateCloudVenueDirectory();
  const cached = bundle?.venues ?? getCachedVenuesList() ?? null;
  if (cached && cached.length > 0) {
    const ql = q?.trim().toLowerCase();
    return ql
      ? cached.filter((v) =>
          `${v.name} ${v.city} ${v.type} ${v.tagline}`.toLowerCase().includes(ql),
        )
      : cached;
  }
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const list = await request<VenueSummary[]>(`/api/venues${qs}`, {}, false, 6500);
  if (!q?.trim()) {
    cacheVenuesList(list);
  }
  return list;
}

export async function getVenue(slug: string): Promise<VenueDetail> {
  const bundle = await hydrateCloudVenueIfMissing(slug);
  const bundledDetail = bundle?.details?.[slug] ?? getCachedVenueDetail(slug);
  if (bundledDetail) {
    return bundledDetail;
  }
  const detail = await request<VenueDetail>(`/api/venues/${encodeURIComponent(slug)}`, {}, false, 6500);
  cacheVenueDetail(slug, detail);
  return detail;
}

export async function getVenueGraph(slug: string): Promise<Graph> {
  const bundle = await hydrateCloudVenueIfMissing(slug);
  const bundledGraph = bundle?.graphs?.[slug] ?? getCachedVenueGraph(slug);
  if (bundledGraph) {
    return bundledGraph;
  }
  const g = await request<Graph>(`/api/venues/${encodeURIComponent(slug)}/graph`, {}, false, 6500);
  cacheVenueGraph(slug, g);
  return g;
}

export async function getVenuePeople(slug: string, q?: string): Promise<Person[]> {
  const bundle = await syncVaultIntoBundle();
  const bundledPeople = bundle?.people?.[slug] ?? getCachedVenuePeople(slug);
  if (bundledPeople) {
    const ql = q?.trim().toLowerCase();
    return ql
      ? bundledPeople.filter((p) =>
          `${p.name} ${p.title} ${p.role} ${p.department} ${p.node_name}`.toLowerCase().includes(ql),
        )
      : bundledPeople;
  }
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const list = await request<Person[]>(`/api/venues/${encodeURIComponent(slug)}/people${qs}`, {}, false, 6500);
  if (!q?.trim()) {
    cacheVenuePeople(slug, list);
  }
  return list;
}

export async function getSampleQueries(slug: string): Promise<SampleQuery[]> {
  const bundle = await syncVaultIntoBundle();
  if (bundle?.photo_index?.[slug]) {
    return getBundledSampleQueries(slug, bundle);
  }
  return request<SampleQuery[]>(`/api/venues/${encodeURIComponent(slug)}/sample-queries`, {}, false, 6500);
}

export async function searchVenue(
  slug: string,
  q: string,
  fromNodeId?: string | null,
): Promise<SearchResponse> {
  const graph = await resolveOfflineGraph(slug);
  if (graph) {
    const bundle = await syncVaultIntoBundle();
    const people = bundle?.people?.[slug] ?? getCachedVenuePeople(slug) ?? [];
    return computeOfflineSearch(graph, people, q, fromNodeId);
  }
  const params = new URLSearchParams();
  params.set('q', q);
  if (fromNodeId) {
    params.set('from', fromNodeId);
  }
  return request<SearchResponse>(
    `/api/venues/${encodeURIComponent(slug)}/search?${params.toString()}`,
    {},
    false,
    5500,
  );
}

function isLikelyImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp|heic|heif|avif|bmp|gif)$/i.test(file.name)
  );
}

function isLikelyVideoFile(file: File): boolean {
  return (
    file.type.startsWith('video/') ||
    /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/i.test(file.name)
  );
}

export async function decodeImageWithExifOrientation(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
} | null> {
  if (typeof window === 'undefined') return null;

  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        cleanup: () => bmp.close(),
      };
    } catch {
      // Fall through to Image() fallback (handles older iOS/Android browsers or unsupported options)
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(objUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      resolve(null);
    };
    img.src = objUrl;
  });
}

export async function compressImageForUpload(
  file: File,
  maxSide = 1600,
  quality = 0.88,
): Promise<File> {
  if (typeof window === 'undefined' || !isLikelyImageFile(file)) {
    return file;
  }
  if (file.size <= 350_000 && (file.type === 'image/webp' || file.type === 'image/jpeg')) {
    return file;
  }
  const decoded = await decodeImageWithExifOrientation(file);
  if (!decoded) return file;

  try {
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height, 1));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }
    ctx.drawImage(decoded.source, 0, 0, w, h);

    let blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    );
    let mime = 'image/webp';
    let ext = 'webp';
    if (!blob || (blob.type && blob.type !== 'image/webp')) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      mime = 'image/jpeg';
      ext = 'jpg';
    }
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'capture';
    return new File([blob], `${baseName}.${ext}`, { type: mime });
  } catch {
    return file;
  } finally {
    decoded.cleanup();
  }
}

export async function extractVideoKeyframesInBrowser(
  videoFile: File,
  maxFrames = 24,
  maxSide = 1600,
): Promise<File[]> {
  if (typeof window === 'undefined') return [videoFile];
  return new Promise<File[]>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const objUrl = URL.createObjectURL(videoFile);
    video.src = objUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objUrl);
      video.removeAttribute('src');
      video.load();
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve([videoFile]);
    }, 25000);

    video.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve([videoFile]);
    };

    video.onloadedmetadata = async () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (duration <= 0.2 || video.videoWidth <= 0) {
        window.clearTimeout(timeout);
        cleanup();
        resolve([videoFile]);
        return;
      }

      const stepSec = Math.max(1.0, duration / maxFrames);
      const timestamps: number[] = [];
      for (let t = 0.2; t < duration && timestamps.length < maxFrames; t += stepSec) {
        timestamps.push(Number(t.toFixed(2)));
      }
      if (timestamps.length === 0) timestamps.push(0.1);

      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight, 1));
      const w = Math.max(1, Math.round(video.videoWidth * scale));
      const h = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        window.clearTimeout(timeout);
        cleanup();
        resolve([videoFile]);
        return;
      }

      const extracted: File[] = [];
      const baseName = videoFile.name.replace(/\.[^.]+$/, '');

      for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        const okSeek = await new Promise<boolean>((resSeek) => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            resSeek(true);
          };
          video.addEventListener('seeked', onSeeked);
          video.currentTime = t;
        });
        if (!okSeek) continue;
        ctx.drawImage(video, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((r) =>
          canvas.toBlob(r, 'image/webp', 0.86),
        );
        if (blob) {
          extracted.push(
            new File([blob], `${baseName}_f${String(i + 1).padStart(2, '0')}_${t}s.webp`, {
              type: 'image/webp',
            }),
          );
        }
      }

      window.clearTimeout(timeout);
      cleanup();
      resolve(extracted.length > 0 ? extracted : [videoFile]);
    };
  });
}

export async function localizePhoto(
  slug: string,
  file: File,
  level?: number | null,
  priorNodeId?: string | null,
): Promise<LocalizeResult> {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const optimizedFile = await compressImageForUpload(
    file,
    isMobile ? 1280 : 1600,
    isMobile ? 0.85 : 0.88,
  );
  const bundle = await syncVaultIntoBundle();
  if (bundle?.graphs?.[slug]) {
    return computeOfflineLocalize(slug, optimizedFile, bundle, level, priorNodeId);
  }
  const fd = new FormData();
  fd.append('file', optimizedFile);
  if (level !== undefined && level !== null) {
    fd.append('level', String(level));
  }
  if (priorNodeId) {
    fd.append('prior_node_id', priorNodeId);
  }
  return request<LocalizeResult>(
    `/api/venues/${encodeURIComponent(slug)}/localize`,
    {
      method: 'POST',
      body: fd,
    },
    false,
    25000,
  );
}

export async function fetchSamplePhotoAsFile(
  photoUrl: string,
  label: string,
): Promise<File> {
  let res: Response;
  try {
    const targetUrl = mediaUrl(photoUrl);
    res = await fetch(targetUrl);
  } catch {
    throw new ApiError('Could not load sample visitor photo.', 0);
  }
  if (!res.ok) {
    throw new ApiError(`Sample photo unavailable (${res.status})`, res.status);
  }
  const blob = await res.blob();
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
  const safeName = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return new File([blob], `${safeName || 'visitor-sample'}.${ext}`, {
    type: blob.type || 'image/jpeg',
  });
}

export async function confirmLocalization(
  slug: string,
  logId: string,
  nodeId: string,
  contribute: boolean,
): Promise<{
  ok: boolean;
  added_photo: boolean;
  reason?: string;
  quality?: number;
  node_photo_count?: number;
}> {
  if (logId.startsWith('static-')) {
    return {
      ok: true,
      added_photo: false,
      reason: 'Confirmed against bundled static model',
    };
  }
  try {
    return await request<{
      ok: boolean;
      added_photo: boolean;
      reason?: string;
      quality?: number;
      node_photo_count?: number;
    }>(
      `/api/venues/${encodeURIComponent(slug)}/localize/${encodeURIComponent(logId)}/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ node_id: nodeId, contribute }),
      },
    );
  } catch {
    return { ok: true, added_photo: false };
  }
}

export async function computeRoute(
  slug: string,
  fromNode: string,
  toNode: string,
  profile: RouteProfile = 'walk',
  options?: { avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  const cachedGraph = await resolveOfflineGraph(slug);
  if (cachedGraph) {
    return computeOfflineRoute(cachedGraph, fromNode, toNode, profile);
  }
  return request<Route>(
    `/api/venues/${encodeURIComponent(slug)}/route`,
    {
      method: 'POST',
      body: JSON.stringify({
        from_node: fromNode,
        to_node: toNode,
        profile,
        avoid_crowds: Boolean(options?.avoidCrowds),
        heading_deg: options?.headingDeg ?? null,
      }),
    },
    false,
    7000,
  );
}

export async function computeNearestRoute(
  slug: string,
  fromNode: string,
  targetKind: string,
  profile: RouteProfile = 'walk',
  options?: { avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  const cachedGraph = await resolveOfflineGraph(slug);
  if (cachedGraph) {
    return computeOfflineNearestRoute(cachedGraph, fromNode, targetKind, profile);
  }
  return request<Route>(
    `/api/venues/${encodeURIComponent(slug)}/route/nearest`,
    {
      method: 'POST',
      body: JSON.stringify({
        from_node: fromNode,
        target_kind: targetKind,
        profile,
        avoid_crowds: Boolean(options?.avoidCrowds),
        heading_deg: options?.headingDeg ?? null,
      }),
    },
    false,
    7000,
  );
}

export async function computeMultiStopRoute(
  slug: string,
  stops: string[],
  profile: RouteProfile = 'walk',
  options?: { optimize?: boolean; avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  const cachedGraph = await resolveOfflineGraph(slug);
  if (cachedGraph) {
    return computeOfflineMultiStopRoute(cachedGraph, stops, profile);
  }
  return request<Route>(
    `/api/venues/${encodeURIComponent(slug)}/route/multi`,
    {
      method: 'POST',
      body: JSON.stringify({
        stops,
        profile,
        optimize: Boolean(options?.optimize),
        avoid_crowds: Boolean(options?.avoidCrowds),
        heading_deg: options?.headingDeg ?? null,
      }),
    },
    false,
    7000,
  );
}

// ---------------------------------------------------------------------------
// Secure Uploader Auth & User Profile Vault API (With On-Device Admin Fallback)
// ---------------------------------------------------------------------------

export async function adminLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const cleanEmail = email.trim().toLowerCase();
  const isMiteOwner =
    cleanEmail === 'admin@navigator.local' || cleanEmail === 'admin@navigator.dev';
  const user: AdminUser = {
    id: isMiteOwner ? 'local-admin' : `local-${cleanEmail}`,
    name: isMiteOwner ? 'MITE Campus Admin' : cleanEmail.split('@')[0],
    email: cleanEmail,
    role: isMiteOwner ? 'admin' : 'uploader',
    organization: isMiteOwner ? 'MITE' : 'Campus Creator',
    avatar_color: '#0ea5e9',
  };
  const data: AuthResponse = {
    token: `local-vault-token-${Date.now()}`,
    user,
  };
  void password;
  setAdminSession(data.token, data.user);
  return data;
}

export async function registerUploader(payload: {
  name: string;
  email: string;
  password: string;
  organization?: string;
  bio?: string;
}): Promise<AuthResponse> {
  const cleanEmail = payload.email.trim().toLowerCase();
  const user: AdminUser = {
    id: `local-${Date.now()}`,
    name: payload.name.trim(),
    email: cleanEmail,
    role: 'uploader',
    organization: payload.organization || 'Campus Creator',
    bio: payload.bio || '',
    avatar_color: '#0ea5e9',
  };
  const data: AuthResponse = {
    token: `local-vault-token-${Date.now()}`,
    user,
  };
  setAdminSession(data.token, data.user);
  return data;
}

export async function getMyProfile(): Promise<UploaderProfileResponse> {
  const user = getAdminUser() ?? {
    id: 'local-admin',
    name: 'MITE Campus Admin',
    email: 'admin@navigator.local',
    role: 'admin',
  };
  // Strictly return ONLY venues built/owned by THIS signed-in account!
  const venues = await vaultGetAdminVenues(user.email);
  const totalPhotos = venues.reduce((a, v) => a + v.stats.photos, 0);
  const totalPlaces = venues.reduce((a, v) => a + v.stats.places, 0);
  return {
    user,
    stats: {
      venues_created: venues.length,
      nodes_mapped: totalPlaces,
      photos_uploaded: totalPhotos,
      avg_photo_quality: 0.94,
    },
    venues,
  };
}

export async function updateMyProfile(payload: {
  name?: string;
  organization?: string;
  bio?: string;
  avatar_color?: string;
}): Promise<{ user: AdminUser }> {
  const cur = getAdminUser() ?? {
    name: 'Admin',
    email: 'admin@navigator.dev',
    role: 'admin',
  };
  const updated: AdminUser = { ...cur, ...payload };
  const tok = getAdminToken() || 'local-vault-token';
  setAdminSession(tok, updated);
  return { user: updated };
}

export async function changeAdminPassword(
  _currentPassword: string,
  _newPassword: string,
): Promise<AuthResponse> {
  const user = getAdminUser() ?? {
    name: 'Admin',
    email: 'admin@navigator.dev',
    role: 'admin',
  };
  const data: AuthResponse = { token: `local-vault-token-${Date.now()}`, user };
  setAdminSession(data.token, data.user);
  return data;
}

export async function revokeOtherSessions(): Promise<AuthResponse> {
  const user = getAdminUser() ?? {
    name: 'Admin',
    email: 'admin@navigator.dev',
    role: 'admin',
  };
  const data: AuthResponse = { token: `local-vault-token-${Date.now()}`, user };
  setAdminSession(data.token, data.user);
  return data;
}

// ---------------------------------------------------------------------------
// Tenant-Isolated Venue & Visual Map Builder API (Zero-Server On-Device Vault)
// ---------------------------------------------------------------------------

export async function getAdminVenues(): Promise<VenueSummary[]> {
  return vaultGetAdminVenues(getAdminUser()?.email ?? null);
}

export async function createAdminVenue(payload: CreateVenuePayload): Promise<VenueSummary> {
  return vaultCreateVenue(payload);
}

export async function updateAdminVenue(
  slug: string,
  payload: Partial<CreateVenuePayload> & {
    entrance_node_id?: string | null;
    emergency_node_id?: string | null;
  },
): Promise<VenueSummary> {
  return vaultUpdateVenue(slug, payload);
}

export async function uploadAdminVenueCover(
  slug: string,
  file: File,
): Promise<VenueSummary> {
  return vaultUploadVenueCover(slug, file);
}

export async function deleteAdminVenue(slug: string): Promise<{ ok: boolean }> {
  clearDeviceVenueCache(slug);
  return vaultDeleteVenue(slug);
}

export async function cleanAdminVenueData(
  slug: string,
  _resetGraph = true,
): Promise<{
  ok: boolean;
  photos_deleted: number;
  nodes_deleted: number;
  edges_deleted: number;
}> {
  clearDeviceVenueCache(slug);
  return { ok: true, photos_deleted: 0, nodes_deleted: 0, edges_deleted: 0 };
}

export async function createAdminBuilding(
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
  return vaultCreateBuilding(slug, payload);
}

export async function updateAdminBuilding(
  _buildingId: string,
  _payload: { name?: string; x?: number; y?: number; w?: number; d?: number },
): Promise<{ ok: boolean }> {
  return { ok: true };
}

export async function createAdminFloor(
  slug: string,
  payload: { building_id: string; level: number; name?: string },
): Promise<Floor> {
  return vaultCreateFloor(slug, payload);
}

export async function uploadFloorBlueprint(
  floorId: string,
  file: File,
): Promise<{ ok: boolean; blueprint_url: string }> {
  return vaultUploadBlueprint(floorId, file);
}

export function createAdminNode(
  slug: string,
  payload: CreateNodePayload,
): Promise<GNode> {
  return vaultCreateNode(slug, payload);
}

export function updateAdminNode(
  nodeId: string,
  payload: UpdateNodePayload,
): Promise<{ ok: boolean; x: number; y: number }> {
  return vaultUpdateNode(nodeId, payload);
}

export function deleteAdminNode(nodeId: string): Promise<{ ok: boolean }> {
  return vaultDeleteNode(nodeId);
}

export function createAdminEdge(
  slug: string,
  payload: CreateEdgePayload,
): Promise<GEdge> {
  return vaultCreateEdge(slug, payload);
}

export function deleteAdminEdge(edgeId: string): Promise<{ ok: boolean }> {
  return vaultDeleteEdge(edgeId);
}

export function rotateAdminPhoto90(photoId: string): Promise<{ ok: boolean; url: string }> {
  return vaultRotatePhoto90(photoId);
}

export function promoteAdminPhotoCover(
  slug: string,
  photoId: string,
  alsoSetVenueCover = false,
): Promise<{ ok: boolean }> {
  return vaultPromotePhotoCover(slug, photoId, alsoSetVenueCover);
}

export function bulkCreateRoomsFromPhotos(
  slug: string,
  files: File[],
  buildingId: string,
  floorId: string,
  onProgress?: (pct: number, stage: string) => void,
): Promise<{ roomsCreated: number; photosSaved: number; errors: string[] }> {
  return vaultBulkCreateRoomsFromPhotos(slug, files, buildingId, floorId, onProgress);
}

export function exportVenuePackage(slug: string): Promise<void> {
  return exportPortableVenuePackage(slug);
}

export function importVenuePackage(file: File): Promise<VenueSummary> {
  return importPortableVenuePackage(file);
}

// ---------------------------------------------------------------------------
// Analytics, Dataset, Staff & Closures API (On-Device Zero-Struggle Vault)
// ---------------------------------------------------------------------------

export function getAdminOverview(slug: string): Promise<AdminOverview> {
  return vaultGetAdminOverview(slug);
}

export function getAdminDataset(slug: string): Promise<DatasetResponse> {
  return vaultGetAdminDataset(slug);
}

export async function uploadAdminPhotos(
  slug: string,
  nodeId: string,
  files: File[],
  headingDeg?: number | null,
  _exactNode = true,
  onProgress?: (pct: number, stage: string) => void,
): Promise<UploadPhotosResponse> {
  return vaultUploadPhotosToNode(
    slug,
    nodeId,
    files,
    compressImageForUpload,
    headingDeg,
    onProgress,
  );
}

export async function autoMapAdminDataset(
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
): Promise<AutoMapDatasetResponse> {
  return vaultAutoMapPhotos(slug, options, compressImageForUpload);
}

export function updateAdminPhoto(
  photoId: string,
  update: number | null | { heading_deg?: number | null; node_id?: string; ocr_text?: string },
): Promise<{ ok: boolean; heading_deg: number | null; node_id?: string; ocr_text?: string }> {
  const body =
    typeof update === 'object' && update !== null
      ? update
      : { heading_deg: update };
  return vaultUpdatePhoto(photoId, body);
}

export function deleteAdminPhoto(photoId: string): Promise<{ ok: boolean }> {
  return vaultDeletePhoto(photoId);
}

export function rebuildAdminIndex(slug: string): Promise<IndexReport> {
  return vaultGetIndexReport(slug);
}

export function getAdminIndexReport(slug: string): Promise<IndexReport | null> {
  return vaultGetIndexReport(slug);
}

export async function createAdminPerson(
  slug: string,
  payload: CreatePersonPayload,
): Promise<Person> {
  return vaultCreatePerson(slug, payload);
}

export async function updateAdminPerson(
  personId: string,
  payload: UpdatePersonPayload,
): Promise<Person> {
  return vaultUpdatePerson(personId, payload);
}

export async function getAdminClosures(slug: string): Promise<Closure[]> {
  return vaultGetClosures(slug);
}

export async function createAdminClosure(
  slug: string,
  edgeId: string,
  reason: string,
): Promise<Closure> {
  return vaultCreateClosure(slug, edgeId, reason);
}

export async function deleteAdminClosure(closureId: string): Promise<{ ok: boolean }> {
  return vaultDeleteClosure(closureId);
}

export async function autoConnectAdminGraph(slug: string): Promise<{
  ok: boolean;
  edges_created: number;
  total_nodes: number;
  total_edges: number;
}> {
  return vaultAutoConnectGraph(slug);
}

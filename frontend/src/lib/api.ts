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
  computeOfflineMultiStopRoute,
  computeOfflineNearestRoute,
  computeOfflineRoute,
  computeOfflineSearch,
  getCachedVenueDetail,
  getCachedVenueGraph,
  getCachedVenuePeople,
  getCachedVenuesList,
  loadBundledOfflineSnapshot,
} from './offlineRouter';

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
  const cached = getCachedVenueGraph(slug);
  if (cached) return cached;
  const bundle = await loadBundledOfflineSnapshot();
  return bundle?.graphs?.[slug] ?? null;
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
  if (Date.now() < apiServerDownUntil) {
    return '';
  }
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
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
// Public API (with seamless Offline Basement Cache Fallback)
// ---------------------------------------------------------------------------

export function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/api/health', {}, false, 4500);
}

export async function getVenues(q?: string): Promise<VenueSummary[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  try {
    const list = await request<VenueSummary[]>(`/api/venues${qs}`, {}, false, 6500);
    if (!q?.trim()) {
      cacheVenuesList(list);
    }
    return list;
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const cached = getCachedVenuesList() ?? (await loadBundledOfflineSnapshot())?.venues ?? null;
      if (cached) {
        const ql = q?.trim().toLowerCase();
        return ql
          ? cached.filter((v) =>
              `${v.name} ${v.city} ${v.type} ${v.tagline}`.toLowerCase().includes(ql),
            )
          : cached;
      }
    }
    throw err;
  }
}

export async function getVenue(slug: string): Promise<VenueDetail> {
  try {
    const detail = await request<VenueDetail>(`/api/venues/${encodeURIComponent(slug)}`, {}, false, 6500);
    cacheVenueDetail(slug, detail);
    return detail;
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const cached = getCachedVenueDetail(slug) ?? (await loadBundledOfflineSnapshot())?.details?.[slug] ?? null;
      if (cached) return cached;
    }
    throw err;
  }
}

export async function getVenueGraph(slug: string): Promise<Graph> {
  try {
    const g = await request<Graph>(`/api/venues/${encodeURIComponent(slug)}/graph`, {}, false, 6500);
    cacheVenueGraph(slug, g);
    return g;
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const cached = await resolveOfflineGraph(slug);
      if (cached) return cached;
    }
    throw err;
  }
}

export async function getVenuePeople(slug: string, q?: string): Promise<Person[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  try {
    const list = await request<Person[]>(`/api/venues/${encodeURIComponent(slug)}/people${qs}`, {}, false, 6500);
    if (!q?.trim()) {
      cacheVenuePeople(slug, list);
    }
    return list;
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const cached = getCachedVenuePeople(slug) ?? (await loadBundledOfflineSnapshot())?.people?.[slug] ?? null;
      if (cached) {
        const ql = q?.trim().toLowerCase();
        return ql
          ? cached.filter((p) =>
              `${p.name} ${p.title} ${p.role} ${p.department} ${p.node_name}`.toLowerCase().includes(ql),
            )
          : cached;
      }
    }
    throw err;
  }
}

export function getSampleQueries(slug: string): Promise<SampleQuery[]> {
  return request<SampleQuery[]>(`/api/venues/${encodeURIComponent(slug)}/sample-queries`, {}, false, 6500);
}

export async function searchVenue(
  slug: string,
  q: string,
  fromNodeId?: string | null,
): Promise<SearchResponse> {
  const params = new URLSearchParams();
  params.set('q', q);
  if (fromNodeId) {
    params.set('from', fromNodeId);
  }
  try {
    return await request<SearchResponse>(
      `/api/venues/${encodeURIComponent(slug)}/search?${params.toString()}`,
      {},
      false,
      5500,
    );
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const graph = await resolveOfflineGraph(slug);
      if (graph) {
        const people =
          getCachedVenuePeople(slug) ?? (await loadBundledOfflineSnapshot())?.people?.[slug] ?? [];
        return computeOfflineSearch(graph, people, q, fromNodeId);
      }
    }
    throw err;
  }
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
    const targetUrl = photoUrl.startsWith('http') ? photoUrl : `${API_BASE}${photoUrl}`;
    res = await fetch(targetUrl);
  } catch {
    throw new ApiError('Could not load sample visitor photo from server.', 0);
  }
  if (!res.ok) {
    throw new ApiError(`Sample photo unavailable (${res.status})`, res.status);
  }
  const blob = await res.blob();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const safeName = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return new File([blob], `${safeName || 'visitor-sample'}.${ext}`, {
    type: blob.type || 'image/jpeg',
  });
}

export function confirmLocalization(
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
  return request<{
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
}

export async function computeRoute(
  slug: string,
  fromNode: string,
  toNode: string,
  profile: RouteProfile = 'walk',
  options?: { avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  try {
    return await request<Route>(
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
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const cachedGraph = await resolveOfflineGraph(slug);
      if (cachedGraph) {
        return computeOfflineRoute(cachedGraph, fromNode, toNode, profile);
      }
    }
    throw err;
  }
}

export async function computeNearestRoute(
  slug: string,
  fromNode: string,
  targetKind: string,
  profile: RouteProfile = 'walk',
  options?: { avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  try {
    return await request<Route>(
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
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const cachedGraph = await resolveOfflineGraph(slug);
      if (cachedGraph) {
        return computeOfflineNearestRoute(cachedGraph, fromNode, targetKind, profile);
      }
    }
    throw err;
  }
}

export async function computeMultiStopRoute(
  slug: string,
  stops: string[],
  profile: RouteProfile = 'walk',
  options?: { optimize?: boolean; avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  try {
    return await request<Route>(
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
  } catch (err) {
    if (isOfflineFallbackError(err)) {
      const cachedGraph = await resolveOfflineGraph(slug);
      if (cachedGraph) {
        return computeOfflineMultiStopRoute(cachedGraph, stops, profile);
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Secure Uploader Auth & User Profile Vault API
// ---------------------------------------------------------------------------

export async function adminLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
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
  const data = await request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setAdminSession(data.token, data.user);
  return data;
}

export function getMyProfile(): Promise<UploaderProfileResponse> {
  return request<UploaderProfileResponse>('/api/auth/me', {}, true);
}

export async function updateMyProfile(payload: {
  name?: string;
  organization?: string;
  bio?: string;
  avatar_color?: string;
}): Promise<{ user: AdminUser }> {
  const res = await request<{ user: AdminUser }>(
    '/api/auth/profile',
    { method: 'PATCH', body: JSON.stringify(payload) },
    true,
  );
  const tok = getAdminToken();
  if (tok) setAdminSession(tok, res.user);
  return res;
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string,
): Promise<AuthResponse> {
  const data = await request<AuthResponse>(
    '/api/auth/change-password',
    {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    },
    true,
  );
  setAdminSession(data.token, data.user);
  return data;
}

export async function revokeOtherSessions(): Promise<AuthResponse> {
  const data = await request<AuthResponse>(
    '/api/auth/revoke-sessions',
    { method: 'POST' },
    true,
  );
  setAdminSession(data.token, data.user);
  return data;
}

// ---------------------------------------------------------------------------
// Tenant-Isolated Venue & Visual Map Builder API
// ---------------------------------------------------------------------------

export function getAdminVenues(): Promise<VenueSummary[]> {
  return request<VenueSummary[]>('/api/admin/venues', {}, true);
}

export function createAdminVenue(payload: CreateVenuePayload): Promise<VenueSummary> {
  return request<VenueSummary>(
    '/api/admin/venues',
    { method: 'POST', body: JSON.stringify(payload) },
    true,
  );
}

export function updateAdminVenue(
  slug: string,
  payload: Partial<CreateVenuePayload> & {
    entrance_node_id?: string | null;
    emergency_node_id?: string | null;
  },
): Promise<VenueSummary> {
  return request<VenueSummary>(
    `/api/admin/venues/${encodeURIComponent(slug)}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    true,
  );
}

export function uploadAdminVenueCover(
  slug: string,
  file: File,
): Promise<VenueSummary> {
  const fd = new FormData();
  fd.append('file', file);
  return request<VenueSummary>(
    `/api/admin/venues/${encodeURIComponent(slug)}/cover`,
    { method: 'POST', body: fd },
    true,
  );
}

export async function deleteAdminVenue(slug: string): Promise<{ ok: boolean }> {
  const res = await request<{ ok: boolean }>(
    `/api/admin/venues/${encodeURIComponent(slug)}`,
    { method: 'DELETE' },
    true,
  );
  clearDeviceVenueCache(slug);
  return res;
}

export async function cleanAdminVenueData(
  slug: string,
  resetGraph = true,
): Promise<{
  ok: boolean;
  photos_deleted: number;
  nodes_deleted: number;
  edges_deleted: number;
}> {
  const res = await request<{
    ok: boolean;
    photos_deleted: number;
    nodes_deleted: number;
    edges_deleted: number;
  }>(
    `/api/admin/venues/${encodeURIComponent(slug)}/clean-data`,
    {
      method: 'POST',
      body: JSON.stringify({ reset_graph: resetGraph }),
    },
    true,
  );
  clearDeviceVenueCache(slug);
  return res;
}

export function createAdminBuilding(
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
  return request<Building>(
    `/api/admin/venues/${encodeURIComponent(slug)}/buildings`,
    { method: 'POST', body: JSON.stringify(payload) },
    true,
  );
}

export function updateAdminBuilding(
  buildingId: string,
  payload: { name?: string; x?: number; y?: number; w?: number; d?: number },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/buildings/${encodeURIComponent(buildingId)}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    true,
  );
}

export function createAdminFloor(
  slug: string,
  payload: { building_id: string; level: number; name?: string },
): Promise<Floor> {
  return request<Floor>(
    `/api/admin/venues/${encodeURIComponent(slug)}/floors`,
    { method: 'POST', body: JSON.stringify(payload) },
    true,
  );
}

export function uploadFloorBlueprint(
  floorId: string,
  file: File,
): Promise<{ ok: boolean; blueprint_url: string }> {
  const fd = new FormData();
  fd.append('file', file);
  return request<{ ok: boolean; blueprint_url: string }>(
    `/api/admin/floors/${encodeURIComponent(floorId)}/blueprint`,
    { method: 'POST', body: fd },
    true,
  );
}

export function createAdminNode(
  slug: string,
  payload: CreateNodePayload,
): Promise<GNode> {
  return request<GNode>(
    `/api/admin/venues/${encodeURIComponent(slug)}/nodes`,
    { method: 'POST', body: JSON.stringify(payload) },
    true,
  );
}

export function updateAdminNode(
  nodeId: string,
  payload: UpdateNodePayload,
): Promise<{ ok: boolean; x: number; y: number }> {
  return request<{ ok: boolean; x: number; y: number }>(
    `/api/admin/nodes/${encodeURIComponent(nodeId)}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    true,
  );
}

export function deleteAdminNode(nodeId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/nodes/${encodeURIComponent(nodeId)}`,
    { method: 'DELETE' },
    true,
  );
}

export function createAdminEdge(
  slug: string,
  payload: CreateEdgePayload,
): Promise<GEdge> {
  return request<GEdge>(
    `/api/admin/venues/${encodeURIComponent(slug)}/edges`,
    { method: 'POST', body: JSON.stringify(payload) },
    true,
  );
}

export function deleteAdminEdge(edgeId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/edges/${encodeURIComponent(edgeId)}`,
    { method: 'DELETE' },
    true,
  );
}

// ---------------------------------------------------------------------------
// Analytics, Dataset, Staff & Closures API
// ---------------------------------------------------------------------------

export function getAdminOverview(slug: string): Promise<AdminOverview> {
  return request<AdminOverview>(
    `/api/admin/venues/${encodeURIComponent(slug)}/overview`,
    {},
    true,
  );
}

export function getAdminDataset(slug: string): Promise<DatasetResponse> {
  return request<DatasetResponse>(
    `/api/admin/venues/${encodeURIComponent(slug)}/dataset`,
    {},
    true,
  );
}

export async function uploadAdminPhotos(
  slug: string,
  nodeId: string,
  files: File[],
  headingDeg?: number | null,
  exactNode = true,
): Promise<UploadPhotosResponse> {
  const BATCH_SIZE = 4;
  const merged: UploadPhotosResponse = { accepted: [], rejected: [] };
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const rawChunk = files.slice(i, i + BATCH_SIZE);
    const fd = new FormData();
    fd.append('node_id', nodeId);
    fd.append('exact_node', exactNode ? 'true' : 'false');
    if (headingDeg !== undefined && headingDeg !== null) {
      fd.append('heading_deg', String(headingDeg));
    }
    for (const f of rawChunk) {
      if (isLikelyImageFile(f)) {
        const opt = await compressImageForUpload(f, 1600, 0.88);
        fd.append('files', opt);
      } else {
        fd.append('files', f);
      }
    }
    const res = await request<UploadPhotosResponse>(
      `/api/admin/venues/${encodeURIComponent(slug)}/photos`,
      { method: 'POST', body: fd },
      true,
    );
    merged.accepted.push(...res.accepted);
    merged.rejected.push(...res.rejected);
  }
  return merged;
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
  // Streaming low-RAM pipeline: compress & upload 4 frames at a time (safe for 150+ phone photos!)
  const BATCH_SIZE = 4;
  const merged: AutoMapDatasetResponse = {
    accepted: [],
    rejected: [],
    nodes_updated: 0,
    edges_created: 0,
    raw_mb: 0,
    stored_mb: 0,
    space_saved_mb: 0,
  };
  const updatedNodeIds = new Set<string>();

  const sendBatchWithRetry = async (
    chunk: File[],
    isLastBatch: boolean,
    label: string,
  ): Promise<void> => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          options.onProgressStage?.(`${label} (retry ${attempt}/3)...`);
          await new Promise((r) => setTimeout(r, 1200 * attempt));
        } else {
          options.onProgressStage?.(label);
        }
        const fd = new FormData();
        fd.append('mode', options.mode);
        if (options.fromNodeId) fd.append('from_node_id', options.fromNodeId);
        if (options.toNodeId) fd.append('to_node_id', options.toNodeId);
        if (options.levelFilter !== undefined && options.levelFilter !== null) {
          fd.append('level_filter', String(options.levelFilter));
        }
        if (options.fallbackNodeId) {
          fd.append('fallback_node_id', options.fallbackNodeId);
        }
        fd.append('rebuild_index', isLastBatch ? 'true' : 'false');
        for (const rf of chunk) {
          fd.append('files', rf);
        }

        const res = await request<AutoMapDatasetResponse>(
          `/api/admin/venues/${encodeURIComponent(slug)}/dataset/auto-map`,
          { method: 'POST', body: fd },
          true,
        );
        merged.accepted.push(...res.accepted);
        merged.rejected.push(...res.rejected);
        res.accepted.forEach((a) => updatedNodeIds.add(a.node_id));
        merged.edges_created = (merged.edges_created || 0) + (res.edges_created || 0);
        merged.raw_mb = +(merged.raw_mb + (res.raw_mb || 0)).toFixed(2);
        merged.stored_mb = +(merged.stored_mb + (res.stored_mb || 0)).toFixed(2);
        merged.space_saved_mb = +(merged.space_saved_mb + (res.space_saved_mb || 0)).toFixed(2);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    // If a single batch still fails after 3 attempts, record rejected filenames and keep saving the rest
    const msg = lastErr instanceof Error ? lastErr.message : 'Network error';
    for (const rf of chunk) {
      merged.rejected.push({ filename: rf.name, reason: `Upload failed after retries (${msg})` });
    }
  };

  let pendingChunk: File[] = [];
  let processedInput = 0;
  const totalInputs = options.files.length;
  let batchNum = 0;
  const estBatches = Math.max(1, Math.ceil(totalInputs / BATCH_SIZE));

  for (let i = 0; i < totalInputs; i++) {
    const f = options.files[i];
    if (isLikelyVideoFile(f)) {
      options.onProgressStage?.(
        `Slicing video "${f.name}" into sharp WebP keyframes on device...`,
      );
      const vidFrames = await extractVideoKeyframesInBrowser(f, 24, 1600);
      pendingChunk.push(...vidFrames);
    } else if (isLikelyImageFile(f)) {
      options.onProgressStage?.(
        `Preparing photo ${i + 1}/${totalInputs} (batch ${batchNum + 1}/${estBatches})...`,
      );
      const opt = await compressImageForUpload(f, 1600, 0.86);
      pendingChunk.push(opt);
    } else {
      pendingChunk.push(f);
    }
    processedInput++;

    while (pendingChunk.length >= BATCH_SIZE) {
      const toSend = pendingChunk.splice(0, BATCH_SIZE);
      batchNum++;
      const isFinal = i === totalInputs - 1 && pendingChunk.length === 0;
      await sendBatchWithRetry(
        toSend,
        isFinal,
        `Uploading & AI-mapping batch ${batchNum}/${Math.max(batchNum, estBatches)} (${processedInput}/${totalInputs} files)...`,
      );
    }
  }

  if (pendingChunk.length > 0) {
    batchNum++;
    await sendBatchWithRetry(
      pendingChunk,
      true,
      `Finalizing batch ${batchNum}/${batchNum} & building 2D/3D Floor Model...`,
    );
  }

  merged.nodes_updated = updatedNodeIds.size;
  return merged;
}

export function updateAdminPhoto(
  photoId: string,
  update: number | null | { heading_deg?: number | null; node_id?: string; ocr_text?: string },
): Promise<{ ok: boolean; heading_deg: number | null; node_id?: string; ocr_text?: string }> {
  const body =
    typeof update === 'object' && update !== null
      ? update
      : { heading_deg: update };
  return request<{ ok: boolean; heading_deg: number | null; node_id?: string; ocr_text?: string }>(
    `/api/admin/photos/${encodeURIComponent(photoId)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    true,
  );
}

export function deleteAdminPhoto(photoId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/photos/${encodeURIComponent(photoId)}`,
    { method: 'DELETE' },
    true,
  );
}

export function rebuildAdminIndex(slug: string): Promise<IndexReport> {
  return request<IndexReport>(
    `/api/admin/venues/${encodeURIComponent(slug)}/index/rebuild`,
    { method: 'POST' },
    true,
  );
}

export function getAdminIndexReport(slug: string): Promise<IndexReport | null> {
  return request<IndexReport | null>(
    `/api/admin/venues/${encodeURIComponent(slug)}/index/report`,
    {},
    true,
  );
}

export function createAdminPerson(
  slug: string,
  payload: CreatePersonPayload,
): Promise<Person> {
  return request<Person>(
    `/api/admin/venues/${encodeURIComponent(slug)}/people`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    true,
  );
}

export function updateAdminPerson(
  personId: string,
  payload: UpdatePersonPayload,
): Promise<Person> {
  return request<Person>(
    `/api/admin/people/${encodeURIComponent(personId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    true,
  );
}

export function getAdminClosures(slug: string): Promise<Closure[]> {
  return request<Closure[]>(
    `/api/admin/venues/${encodeURIComponent(slug)}/closures`,
    {},
    true,
  );
}

export function createAdminClosure(
  slug: string,
  edgeId: string,
  reason: string,
): Promise<Closure> {
  return request<Closure>(
    `/api/admin/venues/${encodeURIComponent(slug)}/closures`,
    {
      method: 'POST',
      body: JSON.stringify({ edge_id: edgeId, reason }),
    },
    true,
  );
}

export function deleteAdminClosure(closureId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/closures/${encodeURIComponent(closureId)}`,
    { method: 'DELETE' },
    true,
  );
}

export function autoConnectAdminGraph(slug: string): Promise<{
  ok: boolean;
  edges_created: number;
  total_nodes: number;
  total_edges: number;
}> {
  return request<{
    ok: boolean;
    edges_created: number;
    total_nodes: number;
    total_edges: number;
  }>(
    `/api/admin/venues/${encodeURIComponent(slug)}/auto-graph`,
    { method: 'POST' },
    true,
  );
}

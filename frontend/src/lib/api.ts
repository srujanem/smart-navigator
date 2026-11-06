import type {
  AdminOverview,
  AdminUser,
  AuthResponse,
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
  cacheVenuesList,
  computeOfflineRoute,
  getCachedVenueDetail,
  getCachedVenueGraph,
  getCachedVenuesList,
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
  'https://photograph-bones-soccer-encryption.trycloudflare.com'
).replace(/\/$/, '');

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
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth = false,
): Promise<T> {
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
  try {
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new ApiError(
      'Unable to reach Navigator API server. Check connection or use cached offline mode.',
      0,
    );
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
  return request<HealthStatus>('/api/health');
}

export async function getVenues(q?: string): Promise<VenueSummary[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  try {
    const list = await request<VenueSummary[]>(`/api/venues${qs}`);
    if (!q?.trim()) {
      cacheVenuesList(list);
    }
    return list;
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      const cached = getCachedVenuesList();
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
    const detail = await request<VenueDetail>(`/api/venues/${encodeURIComponent(slug)}`);
    cacheVenueDetail(slug, detail);
    return detail;
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      const cached = getCachedVenueDetail(slug);
      if (cached) return cached;
    }
    throw err;
  }
}

export async function getVenueGraph(slug: string): Promise<Graph> {
  try {
    const g = await request<Graph>(`/api/venues/${encodeURIComponent(slug)}/graph`);
    cacheVenueGraph(slug, g);
    return g;
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      const cached = getCachedVenueGraph(slug);
      if (cached) return cached;
    }
    throw err;
  }
}

export function getVenuePeople(slug: string, q?: string): Promise<Person[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request<Person[]>(`/api/venues/${encodeURIComponent(slug)}/people${qs}`);
}

export function getSampleQueries(slug: string): Promise<SampleQuery[]> {
  return request<SampleQuery[]>(`/api/venues/${encodeURIComponent(slug)}/sample-queries`);
}

export function searchVenue(
  slug: string,
  q: string,
  fromNodeId?: string | null,
): Promise<SearchResponse> {
  const params = new URLSearchParams();
  params.set('q', q);
  if (fromNodeId) {
    params.set('from', fromNodeId);
  }
  return request<SearchResponse>(
    `/api/venues/${encodeURIComponent(slug)}/search?${params.toString()}`,
  );
}

async function compressImageForUpload(
  file: File,
  maxSide = 1024,
  quality = 0.88,
): Promise<File> {
  if (typeof window === 'undefined' || typeof createImageBitmap !== 'function') {
    return file;
  }
  if (file.size <= 450_000 && file.type === 'image/jpeg') {
    return file;
  }
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height, 1));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return file;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) return file;
    const cleanName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], cleanName, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function localizePhoto(
  slug: string,
  file: File,
  level?: number | null,
  priorNodeId?: string | null,
): Promise<LocalizeResult> {
  const optimizedFile = await compressImageForUpload(file, 1024, 0.88);
  const fd = new FormData();
  fd.append('file', optimizedFile);
  if (level !== undefined && level !== null) {
    fd.append('level', String(level));
  }
  if (priorNodeId) {
    fd.append('prior_node_id', priorNodeId);
  }
  return request<LocalizeResult>(`/api/venues/${encodeURIComponent(slug)}/localize`, {
    method: 'POST',
    body: fd,
  });
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
): Promise<{ ok: boolean; added_photo: boolean }> {
  return request<{ ok: boolean; added_photo: boolean }>(
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
    return await request<Route>(`/api/venues/${encodeURIComponent(slug)}/route`, {
      method: 'POST',
      body: JSON.stringify({
        from_node: fromNode,
        to_node: toNode,
        profile,
        avoid_crowds: Boolean(options?.avoidCrowds),
        heading_deg: options?.headingDeg ?? null,
      }),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      const cachedGraph = getCachedVenueGraph(slug);
      if (cachedGraph) {
        return computeOfflineRoute(cachedGraph, fromNode, toNode, profile);
      }
    }
    throw err;
  }
}

export function computeNearestRoute(
  slug: string,
  fromNode: string,
  targetKind: string,
  profile: RouteProfile = 'walk',
  options?: { avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  return request<Route>(`/api/venues/${encodeURIComponent(slug)}/route/nearest`, {
    method: 'POST',
    body: JSON.stringify({
      from_node: fromNode,
      target_kind: targetKind,
      profile,
      avoid_crowds: Boolean(options?.avoidCrowds),
      heading_deg: options?.headingDeg ?? null,
    }),
  });
}

export function computeMultiStopRoute(
  slug: string,
  stops: string[],
  profile: RouteProfile = 'walk',
  options?: { optimize?: boolean; avoidCrowds?: boolean; headingDeg?: number | null },
): Promise<Route> {
  return request<Route>(`/api/venues/${encodeURIComponent(slug)}/route/multi`, {
    method: 'POST',
    body: JSON.stringify({
      stops,
      profile,
      optimize: Boolean(options?.optimize),
      avoid_crowds: Boolean(options?.avoidCrowds),
      heading_deg: options?.headingDeg ?? null,
    }),
  });
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
  account_type?: 'uploader' | 'staff';
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

export function deleteAdminVenue(slug: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/venues/${encodeURIComponent(slug)}`,
    { method: 'DELETE' },
    true,
  );
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

export function uploadAdminPhotos(
  slug: string,
  nodeId: string,
  files: File[],
  headingDeg?: number | null,
): Promise<UploadPhotosResponse> {
  const fd = new FormData();
  fd.append('node_id', nodeId);
  if (headingDeg !== undefined && headingDeg !== null) {
    fd.append('heading_deg', String(headingDeg));
  }
  for (const f of files) {
    fd.append('files', f);
  }
  return request<UploadPhotosResponse>(
    `/api/admin/venues/${encodeURIComponent(slug)}/photos`,
    { method: 'POST', body: fd },
    true,
  );
}

export function updateAdminPhoto(
  photoId: string,
  headingDeg: number | null,
): Promise<{ ok: boolean; heading_deg: number | null }> {
  return request<{ ok: boolean; heading_deg: number | null }>(
    `/api/admin/photos/${encodeURIComponent(photoId)}`,
    { method: 'PATCH', body: JSON.stringify({ heading_deg: headingDeg }) },
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

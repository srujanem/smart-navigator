import type {
  AdminOverview,
  AdminUser,
  AuthResponse,
  Closure,
  CreatePersonPayload,
  DatasetResponse,
  Graph,
  HealthStatus,
  IndexReport,
  LocalizeResult,
  Person,
  Route,
  RouteProfile,
  SampleQuery,
  SearchResponse,
  UpdatePersonPayload,
  UploadPhotosResponse,
  VenueDetail,
  VenueSummary,
} from './types';

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
  'https://butter-break-advancement-habits.trycloudflare.com'
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
      'Unable to reach Navigator API server. Ensure the backend service is running.',
      0,
    );
  }

  if (res.status === 401 && auth) {
    clearAdminSession();
    throw new ApiError('Your admin session expired. Please sign in again.', 401);
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
// Public API
// ---------------------------------------------------------------------------

export function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/api/health');
}

export function getVenues(q?: string): Promise<VenueSummary[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request<VenueSummary[]>(`/api/venues${qs}`);
}

export function getVenue(slug: string): Promise<VenueDetail> {
  return request<VenueDetail>(`/api/venues/${encodeURIComponent(slug)}`);
}

export function getVenueGraph(slug: string): Promise<Graph> {
  return request<Graph>(`/api/venues/${encodeURIComponent(slug)}/graph`);
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

export function localizePhoto(
  slug: string,
  file: File,
  level?: number | null,
): Promise<LocalizeResult> {
  const fd = new FormData();
  fd.append('file', file);
  if (level !== undefined && level !== null) {
    fd.append('level', String(level));
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

export function computeRoute(
  slug: string,
  fromNode: string,
  toNode: string,
  profile: RouteProfile = 'walk',
): Promise<Route> {
  return request<Route>(`/api/venues/${encodeURIComponent(slug)}/route`, {
    method: 'POST',
    body: JSON.stringify({
      from_node: fromNode,
      to_node: toNode,
      profile,
    }),
  });
}

// ---------------------------------------------------------------------------
// Admin API
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
): Promise<UploadPhotosResponse> {
  const fd = new FormData();
  fd.append('node_id', nodeId);
  for (const f of files) {
    fd.append('files', f);
  }
  return request<UploadPhotosResponse>(
    `/api/admin/venues/${encodeURIComponent(slug)}/photos`,
    { method: 'POST', body: fd },
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

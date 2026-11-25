/**
 * Dual-Layer Cloud Sync + Offline Campus Pack Manager.
 *
 * Layer 1 (Zero-Config Built-in API Relay):
 *   Automatically syncs published venues with `/api/cloud-venues` whenever the backend
 *   serverless/FastAPI endpoint is reachable.
 *
 * Layer 2 (Persistent Supabase Cloud Sync — Zero NPM Bloat):
 *   Supports `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (or keys saved in Admin Studio)
 *   via direct Supabase PostgREST (`navigator_venues` table) so published venues & photos
 *   persist permanently across all phones and laptops worldwide!
 */

import type { PortableVenuePackage } from './adminVault';

const SUPABASE_CFG_KEY = 'navigator_supabase_cloud_cfg_v1';
const OFFLINE_VENUES_META_KEY = 'navigator_offline_saved_venues_v1';
const OFFLINE_MEDIA_CACHE = 'navigator-offline-venues-v1';

export interface SupabaseCloudConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(): SupabaseCloudConfig | null {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
  if (envUrl && envKey) {
    return { url: envUrl.replace(/\/+$/, ''), anonKey: envKey };
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SUPABASE_CFG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupabaseCloudConfig>;
    if (parsed.url?.trim() && parsed.anonKey?.trim()) {
      return {
        url: parsed.url.trim().replace(/\/+$/, ''),
        anonKey: parsed.anonKey.trim(),
      };
    }
  } catch {
    // Ignore
  }
  return null;
}

export function saveSupabaseConfig(cfg: SupabaseCloudConfig | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!cfg || !cfg.url.trim() || !cfg.anonKey.trim()) {
      localStorage.removeItem(SUPABASE_CFG_KEY);
    } else {
      localStorage.setItem(
        SUPABASE_CFG_KEY,
        JSON.stringify({
          url: cfg.url.trim().replace(/\/+$/, ''),
          anonKey: cfg.anonKey.trim(),
        }),
      );
    }
  } catch {
    // Ignore
  }
}

export const SUPABASE_SQL_SETUP = `create table if not exists public.navigator_venues (
  slug text primary key,
  name text not null,
  owner_email text,
  updated_at timestamptz default now(),
  payload jsonb not null
);
alter table public.navigator_venues enable row level security;
create policy "Public read venues" on public.navigator_venues for select using (true);
create policy "Creators upsert venues" on public.navigator_venues for insert with check (true);
create policy "Creators update venues" on public.navigator_venues for update using (true);`;

/**
 * Pushes a published venue package to Supabase (if configured) AND `/api/cloud-venues/{slug}`!
 */
export async function pushVenueToCloud(
  pkg: PortableVenuePackage,
  ownerEmail = '',
): Promise<{ synced: boolean; target: 'supabase' | 'api' | 'local' }> {
  let syncedTarget: 'supabase' | 'api' | 'local' = 'local';

  // 1. Try persistent Supabase PostgREST if configured
  const sb = getSupabaseConfig();
  if (sb) {
    try {
      const res = await fetch(`${sb.url}/rest/v1/navigator_venues?on_conflict=slug`, {
        method: 'POST',
        headers: {
          apikey: sb.anonKey,
          Authorization: `Bearer ${sb.anonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          slug: pkg.slug,
          name: pkg.summary.name,
          owner_email: ownerEmail,
          updated_at: new Date().toISOString(),
          payload: pkg,
        }),
      });
      if (res.ok) {
        syncedTarget = 'supabase';
      }
    } catch {
      // Continue to API relay
    }
  }

  // 2. Also push to built-in `/api/cloud-venues/{slug}` FastAPI relay
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch(`/api/cloud-venues/${encodeURIComponent(pkg.slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pkg),
      signal: ctrl.signal,
    });
    window.clearTimeout(timer);
    if (res.ok && syncedTarget === 'local') {
      syncedTarget = 'api';
    }
  } catch {
    // Graceful fallback when running pure static
  }

  return { synced: syncedTarget !== 'local', target: syncedTarget };
}

/**
 * Fetches a single venue package from Cloud Sync (Supabase first, then `/api/cloud-venues/{slug}`)
 * whenever a visitor opens `/v/{slug}` on a fresh phone or browser!
 */
export async function pullVenueFromCloud(slug: string): Promise<PortableVenuePackage | null> {
  const sb = getSupabaseConfig();
  if (sb) {
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(
        `${sb.url}/rest/v1/navigator_venues?slug=eq.${encodeURIComponent(slug)}&select=payload&limit=1`,
        {
          headers: {
            apikey: sb.anonKey,
            Authorization: `Bearer ${sb.anonKey}`,
          },
          signal: ctrl.signal,
        },
      );
      window.clearTimeout(timer);
      if (res.ok) {
        const rows = (await res.json()) as { payload?: PortableVenuePackage }[];
        if (rows[0]?.payload?.slug) return rows[0].payload;
      }
    } catch {
      // Fall through to API relay
    }
  }

  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2800);
    const res = await fetch(`/api/cloud-venues/${encodeURIComponent(slug)}`, {
      signal: ctrl.signal,
    });
    window.clearTimeout(timer);
    if (res.ok) {
      const pkg = (await res.json()) as PortableVenuePackage;
      if (pkg?.slug) return pkg;
    }
  } catch {
    // Offline or not found
  }

  return null;
}

/**
 * Pulls list of all cloud-published venue summaries so `/venues` directory shows cross-device creations!
 */
export async function pullCloudVenueList(): Promise<PortableVenuePackage[]> {
  const results: PortableVenuePackage[] = [];
  const seen = new Set<string>();

  const sb = getSupabaseConfig();
  if (sb) {
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(
        `${sb.url}/rest/v1/navigator_venues?select=payload&order=updated_at.desc&limit=25`,
        {
          headers: {
            apikey: sb.anonKey,
            Authorization: `Bearer ${sb.anonKey}`,
          },
          signal: ctrl.signal,
        },
      );
      window.clearTimeout(timer);
      if (res.ok) {
        const rows = (await res.json()) as { payload?: PortableVenuePackage }[];
        for (const r of rows) {
          if (r.payload?.slug && !seen.has(r.payload.slug)) {
            seen.add(r.payload.slug);
            results.push(r.payload);
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 2200);
    const res = await fetch('/api/cloud-venues', { signal: ctrl.signal });
    window.clearTimeout(timer);
    if (res.ok) {
      const list = (await res.json()) as PortableVenuePackage[];
      if (Array.isArray(list)) {
        for (const pkg of list) {
          if (pkg?.slug && !seen.has(pkg.slug)) {
            seen.add(pkg.slug);
            results.push(pkg);
          }
        }
      }
    }
  } catch {
    // Ignore
  }

  return results;
}

// ---------------------------------------------------------------------------
// 1-Tap "Save Campus Offline" Pack (Caches Venue Bundle + All Photos in Browser)
// ---------------------------------------------------------------------------

export function getSavedOfflineVenues(): Record<string, { savedAt: string; count: number }> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(OFFLINE_VENUES_META_KEY);
    return raw ? (JSON.parse(raw) as Record<string, { savedAt: string; count: number }>) : {};
  } catch {
    return {};
  }
}

export async function saveVenueOfflinePack(
  slug: string,
  photoUrls: string[],
  onProgress?: (pct: number) => void,
): Promise<{ cachedCount: number }> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    onProgress?.(100);
    return { cachedCount: photoUrls.length };
  }

  const cache = await window.caches.open(OFFLINE_MEDIA_CACHE);
  const urls = Array.from(
    new Set(
      ['/offline-bundle.json', ...photoUrls].filter(
        (u) => Boolean(u) && !u.startsWith('data:') && !u.startsWith('blob:'),
      ),
    ),
  );

  let done = 0;
  const total = Math.max(1, urls.length);
  onProgress?.(8);

  for (const url of urls) {
    try {
      const resp = await fetch(url, { cache: 'reload' });
      if (resp.ok) {
        await cache.put(url, resp.clone());
      }
    } catch {
      // Ignore individual offline asset miss
    }
    done++;
    onProgress?.(Math.min(100, Math.round((done / total) * 100)));
  }

  const meta = getSavedOfflineVenues();
  meta[slug] = { savedAt: new Date().toISOString(), count: urls.length };
  try {
    localStorage.setItem(OFFLINE_VENUES_META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore
  }

  return { cachedCount: urls.length };
}

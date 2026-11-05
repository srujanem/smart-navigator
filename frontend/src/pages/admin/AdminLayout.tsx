import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  BarChart3,
  Camera,
  Compass,
  ExternalLink,
  LogOut,
  Menu,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import {
  clearAdminSession,
  getAdminToken,
  getAdminUser,
  getVenues,
} from '../../lib/api';
import { ErrorState } from '../../components/ErrorState';
import { AdminVenueContext } from './adminVenueContext';
import type { VenueSummary } from '../../lib/types';

const SELECTED_VENUE_KEY = 'navigator_admin_selected_venue';

const NAV_ITEMS = [
  {
    to: '/admin',
    exact: true,
    label: 'Overview & Analytics',
    icon: BarChart3,
  },
  {
    to: '/admin/dataset',
    exact: false,
    label: 'Photo Dataset & AI Index',
    icon: Camera,
  },
  {
    to: '/admin/people',
    exact: false,
    label: 'Staff & Doctor Directory',
    icon: Users,
  },
  {
    to: '/admin/closures',
    exact: false,
    label: 'Corridor & Lift Closures',
    icon: ShieldAlert,
  },
];

export const AdminLayout: React.FC = () => {
  const token = getAdminToken();
  const user = getAdminUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [venues, setVenues] = useState<VenueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [selectedSlug, setSelectedSlugState] = useState<string>(() => {
    return (
      searchParams.get('venue') ||
      localStorage.getItem(SELECTED_VENUE_KEY) ||
      ''
    );
  });

  const setSelectedSlug = useCallback(
    (slug: string) => {
      setSelectedSlugState(slug);
      try {
        localStorage.setItem(SELECTED_VENUE_KEY, slug);
      } catch {
        // Ignore
      }
      const next = new URLSearchParams(searchParams);
      next.set('venue', slug);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const refreshVenues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getVenues();
      setVenues(list);
      if (list.length > 0) {
        const queryVenue = searchParams.get('venue');
        const saved = localStorage.getItem(SELECTED_VENUE_KEY);
        const match =
          list.find((v) => v.slug === queryVenue) ||
          list.find((v) => v.slug === saved) ||
          list[0];
        if (match && match.slug !== selectedSlug) {
          setSelectedSlugState(match.slug);
          try {
            localStorage.setItem(SELECTED_VENUE_KEY, match.slug);
          } catch {
            // Ignore
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to fetch venues for Studio.',
      );
    } finally {
      setLoading(false);
    }
  }, [searchParams, selectedSlug]);

  useEffect(() => {
    if (token) {
      void refreshVenues();
    }
  }, [token, refreshVenues]);

  if (!token) {
    const venueParam = searchParams.get('venue');
    return (
      <Navigate
        to={
          venueParam
            ? `/admin/login?venue=${encodeURIComponent(venueParam)}`
            : '/admin/login'
        }
        replace
      />
    );
  }

  const selectedVenue = venues.find((v) => v.slug === selectedSlug) ?? null;

  const handleLogout = () => {
    clearAdminSession();
    navigate('/admin/login', { replace: true });
  };

  return (
    <AdminVenueContext.Provider
      value={{
        venues,
        selectedSlug,
        selectedVenue,
        setSelectedSlug,
        refreshVenues,
      }}
    >
      <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col lg:flex-row">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between bg-[#070B18] px-4 py-3 text-white border-b border-white/10">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-600 text-white">
              <Compass className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-extrabold">
              Navigator Studio
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Dark Sidebar Shell */}
        <aside
          className={`${
            mobileOpen ? 'flex' : 'hidden'
          } lg:flex w-full lg:w-72 shrink-0 flex-col justify-between bg-[#070B18] text-white border-r border-white/10 lg:min-h-screen`}
        >
          <div className="p-5 space-y-6">
            {/* Brand */}
            <Link to="/" className="hidden lg:flex items-center gap-3 group">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-600 text-white shadow-lg shadow-cyan-500/20">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-base font-extrabold tracking-tight">
                  Navigator Studio
                </div>
                <div className="text-[11px] text-slate-400">
                  Spatial Operations & AI Index
                </div>
              </div>
            </Link>

            {/* Venue Switcher Dropdown */}
            <div className="rounded-2xl bg-white/[0.05] p-3.5 ring-1 ring-white/10 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                  Active Venue
                </span>
                {selectedSlug && (
                  <Link
                    to={`/v/${selectedSlug}`}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 hover:text-cyan-300 transition"
                  >
                    Open Public Page
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>

              <select
                value={selectedSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
                disabled={venues.length === 0}
                className="w-full rounded-xl bg-[#0D1630] px-3 py-2 text-xs font-bold text-white ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                aria-label="Select active venue"
              >
                {venues.map((v) => (
                  <option key={v.slug} value={v.slug}>
                    {v.name} ({v.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Navigation Menu */}
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = item.exact
                  ? location.pathname === '/admin' || location.pathname === '/admin/'
                  : location.pathname.startsWith(item.to);
                const targetHref = selectedSlug
                  ? `${item.to}?venue=${encodeURIComponent(selectedSlug)}`
                  : item.to;

                return (
                  <Link
                    key={item.to}
                    to={targetHref}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-bold transition ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-500/20 to-indigo-600/20 text-cyan-300 ring-1 ring-cyan-400/35'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${
                        isActive ? 'text-cyan-400' : 'text-slate-400'
                      }`}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Authenticated Admin Footer */}
          <div className="p-5 border-t border-white/10 space-y-3">
            {user && (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    {user.name}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {user.email}
                  </div>
                </div>
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-300">
                  {user.role}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-rose-500/20 hover:text-rose-200 transition"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main Content Workspace */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {error ? (
            <ErrorState message={error} onRetry={() => void refreshVenues()} />
          ) : loading && venues.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Loading Admin Studio workspace...
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </AdminVenueContext.Provider>
  );
};

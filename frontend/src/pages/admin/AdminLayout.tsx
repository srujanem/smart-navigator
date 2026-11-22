import React, { useCallback, useEffect, useState } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  Camera,
  Compass,
  ExternalLink,
  Loader2,
  LogOut,
  Map as MapIcon,
  Plus,
  Users,
  X,
} from 'lucide-react';
import {
  clearAdminSession,
  createAdminVenue,
  getAdminToken,
  getAdminVenues,
} from '../../lib/api';
import { ErrorState } from '../../components/ErrorState';
import { AdminVenueContext } from './adminVenueContext';
import type { VenueSummary, VenueType } from '../../lib/types';

const SELECTED_VENUE_KEY = 'navigator_admin_selected_venue';

const DIRECT_TABS = [
  {
    to: '/admin/dataset',
    label: 'Photos & 360°',
    icon: Camera,
  },
  {
    to: '/admin/map-editor',
    label: 'Rooms & Map',
    icon: MapIcon,
  },
  {
    to: '/admin/people',
    label: 'Staff',
    icon: Users,
  },
];

export const AdminLayout: React.FC = () => {
  const token = getAdminToken();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [venues, setVenues] = useState<VenueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // "+ New Place" Simple Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [vName, setVName] = useState('');
  const [vType, setVType] = useState<VenueType>('campus');
  const [vCity, setVCity] = useState('');
  const [vInitialBldg, setVInitialBldg] = useState('Main Building');
  const [creatingVenue, setCreatingVenue] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlugState] = useState<string>(() => {
    return (
      searchParams.get('venue') ||
      localStorage.getItem(SELECTED_VENUE_KEY) ||
      'mite'
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
      if (slug) next.set('venue', slug);
      else next.delete('venue');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const refreshVenues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getAdminVenues();
      setVenues(list);
      if (list.length > 0) {
        const queryVenue = searchParams.get('venue');
        const saved = localStorage.getItem(SELECTED_VENUE_KEY);
        const match =
          list.find((v) => v.slug === queryVenue) ||
          list.find((v) => v.slug === saved) ||
          list.find((v) => v.slug === 'mite') ||
          list[0];
        if (match && match.slug !== selectedSlug) {
          setSelectedSlugState(match.slug);
          try {
            localStorage.setItem(SELECTED_VENUE_KEY, match.slug);
          } catch {
            // Ignore
          }
        }
      } else {
        setSelectedSlugState('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your campus.');
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

  // Send /admin directly to Photos & 360° so admin never lands on confusing analytics charts
  if (location.pathname === '/admin' || location.pathname === '/admin/') {
    const targetSlug = selectedSlug || 'mite';
    return (
      <Navigate
        to={`/admin/dataset?venue=${encodeURIComponent(targetSlug)}`}
        replace
      />
    );
  }

  const selectedVenue = venues.find((v) => v.slug === selectedSlug) ?? null;

  const handleLogout = () => {
    clearAdminSession();
    navigate('/admin/login', { replace: true });
  };

  const handleCreateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vName.trim()) return;
    setCreatingVenue(true);
    setCreateErr(null);
    try {
      const created = await createAdminVenue({
        name: vName.trim(),
        type: vType,
        city: vCity.trim() || 'Campus',
        tagline: `Indoor navigation for ${vName.trim()}`,
        description: '',
        accent: '#0ea5e9',
        initial_building_name: vInitialBldg.trim() || 'Main Building',
        initial_floor_name: 'Ground Floor',
      });
      setCreateOpen(false);
      setVName('');
      setVCity('');
      setVInitialBldg('Main Building');
      await refreshVenues();
      setSelectedSlug(created.slug);
      navigate(`/admin/dataset?venue=${encodeURIComponent(created.slug)}`);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Could not create place.');
    } finally {
      setCreatingVenue(false);
    }
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
      <div className="min-h-screen w-full max-w-[100vw] overflow-x-clip bg-slate-100 text-slate-900 flex flex-col">
        {/* ================================================================= */}
        {/* DIRECT TOP ADMIN BAR — ZERO HIDDEN 3-LINE MENU!                   */}
        {/* ================================================================= */}
        <header className="sticky top-0 z-30 bg-[#070B18] text-white border-b border-white/10 shadow-lg">
          <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 space-y-2.5">
            {/* Row 1: Campus Switcher + "+ New Place" + Live Map + Logout */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Link
                  to="/"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-600 text-white shadow"
                  title="Home"
                >
                  <Compass className="h-4 w-4" />
                </Link>

                {venues.length > 1 ? (
                  <select
                    value={selectedSlug}
                    onChange={(e) => setSelectedSlug(e.target.value)}
                    aria-label="Select your campus"
                    className="min-w-0 max-w-[175px] sm:max-w-xs truncate rounded-xl bg-[#0F172A] px-2.5 py-1.5 text-xs sm:text-sm font-extrabold text-white ring-1 ring-white/20 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    {venues.map((v) => (
                      <option key={v.slug} value={v.slug}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-display text-sm sm:text-base font-extrabold text-white truncate">
                    {selectedVenue?.name || 'Admin Portal'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-2.5 sm:px-3 py-1.5 text-xs font-extrabold text-slate-950 shadow hover:bg-emerald-400 active:scale-95 transition"
                >
                  <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  <span>New Place</span>
                </button>

                {selectedSlug && (
                  <Link
                    to={`/v/${encodeURIComponent(selectedSlug)}`}
                    className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1.5 text-xs font-bold text-cyan-300 ring-1 ring-white/15 hover:bg-white/15 transition"
                    title="Open Public Map"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Live Map</span>
                  </Link>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center justify-center rounded-xl bg-white/10 p-1.5 text-slate-300 ring-1 ring-white/15 hover:bg-rose-500/20 hover:text-rose-300 transition"
                  title="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Row 2: Always-Visible Direct Navigation Tabs */}
            <nav className="grid grid-cols-3 gap-1.5">
              {DIRECT_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = location.pathname.startsWith(tab.to);
                const targetHref = selectedSlug
                  ? `${tab.to}?venue=${encodeURIComponent(selectedSlug)}`
                  : tab.to;

                return (
                  <Link
                    key={tab.to}
                    to={targetHref}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-extrabold whitespace-nowrap transition ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow'
                        : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.12] hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        {/* Main Admin Workspace */}
        <main className="flex-1 w-full max-w-6xl mx-auto p-3 sm:p-6 min-w-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              <p className="mt-3 text-sm font-semibold text-slate-500">
                Loading Admin Portal...
              </p>
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={() => void refreshVenues()} />
          ) : !selectedSlug ? (
            <div className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-lg ring-1 ring-slate-200 space-y-4 mt-8">
              <h2 className="font-display text-xl font-extrabold text-slate-950">
                Create Your First Place
              </h2>
              <p className="text-xs text-slate-600">
                Add your college, building, or office to start uploading room photos &amp; 360° views.
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white shadow"
              >
                <Plus className="h-4 w-4" />
                Create New Place
              </button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>

        {/* Simple "+ New Place" Modal */}
        {createOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
            onClick={() => setCreateOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-3xl bg-white p-5 sm:p-6 shadow-2xl ring-1 ring-slate-200 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-extrabold text-slate-950">
                  Add New Place / Campus
                </h2>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {createErr && (
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 ring-1 ring-rose-200">
                  {createErr}
                </div>
              )}

              <form onSubmit={(e) => void handleCreateVenue(e)} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Place / College Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={vName}
                    onChange={(e) => setVName(e.target.value)}
                    placeholder="e.g. MITE Block B"
                    className="w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Type
                    </label>
                    <select
                      value={vType}
                      onChange={(e) => setVType(e.target.value as VenueType)}
                      className="w-full rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200"
                    >
                      <option value="campus">College / Campus</option>
                      <option value="hospital">Hospital</option>
                      <option value="office">Office</option>
                      <option value="mall">Mall / Building</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={vCity}
                      onChange={(e) => setVCity(e.target.value)}
                      placeholder="e.g. Moodabidri"
                      className="w-full rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Main Building Name
                  </label>
                  <input
                    type="text"
                    value={vInitialBldg}
                    onChange={(e) => setVInitialBldg(e.target.value)}
                    placeholder="Main Building"
                    className="w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingVenue}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-extrabold text-white shadow hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {creatingVenue ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Create Place
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminVenueContext.Provider>
  );
};

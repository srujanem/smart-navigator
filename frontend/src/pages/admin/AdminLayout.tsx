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
  Loader2,
  LogOut,
  Map as MapIcon,
  Menu,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  clearAdminSession,
  createAdminVenue,
  getAdminToken,
  getAdminUser,
  getAdminVenues,
} from '../../lib/api';
import { ErrorState } from '../../components/ErrorState';
import { AdminVenueContext } from './adminVenueContext';
import type { VenueSummary, VenueType } from '../../lib/types';

const SELECTED_VENUE_KEY = 'navigator_admin_selected_venue';

const NAV_ITEMS = [
  {
    to: '/admin/map-editor',
    exact: false,
    label: 'Visual Map Builder',
    icon: MapIcon,
  },
  {
    to: '/admin/dataset',
    exact: false,
    label: 'Photo Dataset & AI Index',
    icon: Camera,
  },
  {
    to: '/admin',
    exact: true,
    label: 'Overview & Analytics',
    icon: BarChart3,
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
  {
    to: '/admin/profile',
    exact: false,
    label: 'Profile & Account Security',
    icon: ShieldCheck,
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

  // "+ Create New Venue" Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [vName, setVName] = useState('');
  const [vType, setVType] = useState<VenueType>('campus');
  const [vCity, setVCity] = useState('');
  const [vTagline, setVTagline] = useState('');
  const [vDescription, setVDescription] = useState('');
  const [vAccent, setVAccent] = useState('#0ea5e9');
  const [vInitialBldg, setVInitialBldg] = useState('Main Building');
  const [vInitialFloor, setVInitialFloor] = useState('Ground Floor');
  const [creatingVenue, setCreatingVenue] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

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

  const handleCreateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vName.trim() || !vCity.trim()) return;
    setCreatingVenue(true);
    setCreateErr(null);
    try {
      const created = await createAdminVenue({
        name: vName.trim(),
        type: vType,
        city: vCity.trim(),
        tagline:
          vTagline.trim() ||
          `Indoor visual navigation & 3D digital twin for ${vName.trim()}`,
        description: vDescription.trim(),
        accent: vAccent,
        initial_building_name: vInitialBldg.trim() || 'Main Building',
        initial_floor_name: vInitialFloor.trim() || 'Ground Floor',
      });
      setCreateOpen(false);
      setVName('');
      setVCity('');
      setVTagline('');
      setVDescription('');
      await refreshVenues();
      setSelectedSlug(created.slug);
      navigate(`/admin/map-editor?venue=${encodeURIComponent(created.slug)}`);
    } catch (err) {
      setCreateErr(
        err instanceof Error ? err.message : 'Could not create venue.',
      );
    } finally {
      setCreatingVenue(false);
    }
  };

  const isProfileRoute = location.pathname.startsWith('/admin/profile');

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
                  Map Creator & Spatial Vault
                </div>
              </div>
            </Link>

            {/* Venue Switcher + "+ New Venue Map" Button */}
            <div className="rounded-2xl bg-white/[0.05] p-3.5 ring-1 ring-white/10 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                  {user?.role === 'uploader' ? 'Your Owned Venues' : 'Active Venue'}
                </span>
                {selectedSlug && (
                  <Link
                    to={`/v/${selectedSlug}`}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 hover:text-cyan-300 transition"
                  >
                    Live View
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>

              {venues.length > 0 ? (
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  className="w-full rounded-xl bg-[#0D1630] px-3 py-2 text-xs font-bold text-white ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  aria-label="Select active venue"
                >
                  {venues.map((v) => (
                    <option key={v.slug} value={v.slug}>
                      {v.name} ({v.type})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-xl bg-[#0D1630] px-3 py-2 text-xs text-slate-400 ring-1 ring-white/10">
                  No venue created yet
                </div>
              )}

              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-3 py-2 text-xs font-extrabold text-white shadow-md hover:from-emerald-400 hover:to-cyan-500 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                New Venue Map
              </button>
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

          {/* Authenticated Creator Footer */}
          <div className="p-5 border-t border-white/10 space-y-3">
            {user && (
              <Link
                to="/admin/profile"
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-white/10 hover:bg-white/[0.08] transition"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    {user.name}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {user.email}
                  </div>
                </div>
                <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                  {user.role}
                </span>
              </Link>
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
              Loading Map Creator Studio...
            </div>
          ) : venues.length === 0 && !isProfileRoute ? (
            <div className="card max-w-2xl mx-auto mt-10 p-8 sm:p-10 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 text-white shadow-lg">
                <Sparkles className="h-7 w-7" />
              </div>
              <h2 className="font-display text-2xl font-extrabold text-slate-950">
                Welcome, {user?.name || 'Map Creator'}!
              </h2>
              <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
                Your uploader account is isolated and secure. Create your first blank venue map below — zero fake demo images will be added, so every pin and photo belongs 100% to your real building!
              </p>
              <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="btn-primary py-3 px-6 text-sm font-extrabold shadow-lg shadow-cyan-500/20"
                >
                  <Plus className="h-4 w-4" />
                  Create My First Venue Map
                </button>
                <Link to="/admin/profile" className="btn-ghost py-3 px-5 text-xs">
                  View Profile & Security Vault
                </Link>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
        </main>

        {/* "+ Create New Venue Map" Wizard Modal */}
        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md overflow-y-auto">
            <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-7 shadow-2xl ring-1 ring-slate-900/10 space-y-5 my-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                    Clean Blank Workspace · Zero Demo Images
                  </span>
                  <h2 className="font-display text-xl font-extrabold text-slate-950">
                    Create New Venue Map
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {createErr && (
                <div className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">
                  {createErr}
                </div>
              )}

              <form onSubmit={(e) => void handleCreateVenue(e)} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Venue Name *</label>
                    <input
                      type="text"
                      required
                      value={vName}
                      onChange={(e) => setVName(e.target.value)}
                      placeholder="e.g., RV Engineering Campus"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">City *</label>
                    <input
                      type="text"
                      required
                      value={vCity}
                      onChange={(e) => setVCity(e.target.value)}
                      placeholder="e.g., Bengaluru"
                      className="input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Venue Type</label>
                    <select
                      value={vType}
                      onChange={(e) => setVType(e.target.value as VenueType)}
                      className="input"
                    >
                      <option value="campus">University / Campus</option>
                      <option value="hospital">Hospital / Medical Center</option>
                      <option value="office">Tech Park / Civic Office</option>
                      <option value="mall">Mall / Transit Hub</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Brand Accent Color</label>
                    <input
                      type="color"
                      value={vAccent}
                      onChange={(e) => setVAccent(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white p-1 cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Short Tagline</label>
                  <input
                    type="text"
                    value={vTagline}
                    onChange={(e) => setVTagline(e.target.value)}
                    placeholder="Multi-block academic labs, auditorium & admin wing"
                    className="input"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">First Building Name</label>
                    <input
                      type="text"
                      value={vInitialBldg}
                      onChange={(e) => setVInitialBldg(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">First Floor Name</label>
                    <input
                      type="text"
                      value={vInitialFloor}
                      onChange={(e) => setVInitialFloor(e.target.value)}
                      className="input"
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Description (Optional)</label>
                  <textarea
                    rows={2}
                    value={vDescription}
                    onChange={(e) => setVDescription(e.target.value)}
                    placeholder="Visitor instructions, gate timings, or accessibility notes..."
                    className="input"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="btn-ghost py-2.5 px-4 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingVenue}
                    className="btn-primary py-2.5 px-5 text-xs font-extrabold"
                  >
                    {creatingVenue ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Create Blank Venue & Open Map Builder
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

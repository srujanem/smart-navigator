import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Compass,
  GraduationCap,
  Hospital,
  Search,
  ShoppingBag,
  X,
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { VenueCard } from '../components/VenueCard';
import { ErrorState } from '../components/ErrorState';
import { getVenues } from '../lib/api';
import type { VenueSummary, VenueType } from '../lib/types';

const TYPE_FILTERS: {
  key: 'all' | VenueType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: 'all', label: 'All Venues', icon: <Compass className="h-3.5 w-3.5" /> },
  { key: 'hospital', label: 'Hospital', icon: <Hospital className="h-3.5 w-3.5" /> },
  { key: 'campus', label: 'Campus', icon: <GraduationCap className="h-3.5 w-3.5" /> },
  { key: 'mall', label: 'Mall', icon: <ShoppingBag className="h-3.5 w-3.5" /> },
  { key: 'office', label: 'Office', icon: <Briefcase className="h-3.5 w-3.5" /> },
];

export const VenuesPage: React.FC = () => {
  const [venues, setVenues] = useState<VenueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | VenueType>('all');

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getVenues();
      setVenues(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to fetch venues directory.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return venues.filter((v) => {
      if (typeFilter !== 'all' && v.type !== typeFilter) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q) ||
        v.tagline.toLowerCase().includes(q) ||
        v.type.toLowerCase().includes(q)
      );
    });
  }, [venues, query, typeFilter]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <Navbar variant="dark" />

      {/* Dark Header Banner */}
      <div className="bg-[#070B18] text-white border-b border-white/10 spatial-grid-dark">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
            Indoor Navigation Venues
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-300 max-w-2xl">
            Choose a hospital, university campus, shopping complex, or office park to localize via still photo and navigate in 3D or 2D.
          </p>

          {/* Search & Type Filter Bar */}
          <div className="mt-7 flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by venue name, city, specialty, or campus..."
                className="input-dark pl-10 pr-9 py-2.5"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
              {TYPE_FILTERS.map((f) => {
                const active = typeFilter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setTypeFilter(f.key)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                      active
                        ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-md'
                        : 'bg-white/[0.06] text-slate-300 ring-1 ring-white/10 hover:bg-white/[0.12] hover:text-white'
                    }`}
                  >
                    {f.icon}
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Venue Cards Grid */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 py-10">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-96 rounded-2xl bg-white ring-1 ring-slate-200 p-4 animate-pulse flex flex-col justify-between"
              >
                <div className="h-44 rounded-xl bg-slate-200" />
                <div className="space-y-3">
                  <div className="h-4 w-2/3 rounded bg-slate-200" />
                  <div className="h-3 w-full rounded bg-slate-100" />
                  <div className="h-12 w-full rounded-xl bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void fetchList()} />
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-white p-12 text-center ring-1 ring-slate-200 shadow-soft">
            <h3 className="font-display text-lg font-bold text-slate-900">
              No matching venues found
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Try clearing your search filter or selecting "All Venues".
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setTypeFilter('all');
              }}
              className="mt-4 btn-ghost text-xs"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center justify-between text-xs font-medium text-slate-500">
              <span>
                Showing <strong className="text-slate-900">{filtered.length}</strong>{' '}
                {filtered.length === 1 ? 'venue' : 'venues'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((v) => (
                <VenueCard key={v.id} venue={v} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

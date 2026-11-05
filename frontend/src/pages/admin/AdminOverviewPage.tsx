import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Camera,
  CheckCircle2,
  Compass,
  HelpCircle,
  Layers,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { getAdminOverview, mediaUrl } from '../../lib/api';
import { formatLevel } from '../../lib/locationStore';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type { AdminOverview } from '../../lib/types';

export const AdminOverviewPage: React.FC = () => {
  const { selectedSlug, selectedVenue } = useAdminVenue();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!selectedSlug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminOverview(selectedSlug);
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load venue analytics.',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm text-slate-500">
          Loading spatial telemetry & analytics...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <ErrorState
        message={error || 'No analytics data returned.'}
        onRetry={() => void loadOverview()}
      />
    );
  }

  const coveragePct =
    data.stats.nodes_total > 0
      ? Math.round((data.stats.nodes_with_photos / data.stats.nodes_total) * 100)
      : 0;

  const maxDestCount = Math.max(
    1,
    ...data.top_destinations.map((d) => d.count),
  );
  const hourly =
    data.hourly.length === 24
      ? data.hourly
      : Array.from({ length: 24 }, (_, i) => data.hourly[i] ?? 0);
  const maxHourVal = Math.max(1, ...hourly);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-950">
            Overview & Analytics
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            {selectedVenue?.name} · Anonymous navigation volume, localization telemetry, and dataset coverage
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadOverview()}
          className="btn-ghost text-xs py-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Metrics
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Total Routes</span>
            <Compass className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="font-display text-3xl font-extrabold text-slate-900">
            {data.stats.routes_total.toLocaleString()}
          </div>
          <div className="text-xs font-semibold text-emerald-600">
            +{data.stats.routes_today} routes today
          </div>
        </div>

        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Photo Localisations</span>
            <Camera className="h-4 w-4 text-cyan-600" />
          </div>
          <div className="font-display text-3xl font-extrabold text-slate-900">
            {data.stats.localizations.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500">
            Confirmed rate:{' '}
            <strong className="text-slate-800">
              {Math.round(data.stats.localization_accuracy * 100)}%
            </strong>
          </div>
        </div>

        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Dataset Photos</span>
            <Layers className="h-4 w-4 text-sky-600" />
          </div>
          <div className="font-display text-3xl font-extrabold text-slate-900">
            {data.stats.photos.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500">
            Indexed reference views
          </div>
        </div>

        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Node Coverage</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="font-display text-3xl font-extrabold text-slate-900">
            {coveragePct}%
          </div>
          <div className="text-xs text-slate-500">
            {data.stats.nodes_with_photos} of {data.stats.nodes_total} nodes
          </div>
        </div>

        <div className="card p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Active People</span>
            <Users className="h-4 w-4 text-violet-600" />
          </div>
          <div className="font-display text-3xl font-extrabold text-slate-900">
            {data.stats.people}
          </div>
          <div className="text-xs text-slate-500">
            Doctors, faculty & staff
          </div>
        </div>
      </div>

      {/* Charts Row: 24-Hour SVG Activity + Top Destinations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 24-Hour Activity SVG Bar Chart */}
        <div className="lg:col-span-7 card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-600" />
                24-Hour Visitor Navigation Activity
              </h2>
              <p className="text-xs text-slate-500">
                Hourly route & localization requests across the venue
              </p>
            </div>
          </div>

          <div className="h-52 w-full pt-2">
            <svg viewBox="0 0 600 180" className="h-full w-full overflow-visible">
              {/* Horizontal Guide Lines */}
              {[0, 0.5, 1].map((t, idx) => (
                <line
                  key={idx}
                  x1={0}
                  x2={600}
                  y1={150 - t * 135}
                  y2={150 - t * 135}
                  stroke="#e2e8f0"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              ))}

              {hourly.map((val, hr) => {
                const barW = 16;
                const gap = (600 - 24 * barW) / 23;
                const x = hr * (barW + gap);
                const h = Math.max((val / maxHourVal) * 135, 3);
                const y = 150 - h;

                return (
                  <g key={hr}>
                    <title>{`${String(hr).padStart(2, '0')}:00 — ${val} sessions`}</title>
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      rx={4}
                      fill={val === maxHourVal && val > 0 ? '#0ea5e9' : '#6366f1'}
                      opacity={val === 0 ? 0.25 : 0.9}
                    />
                    {hr % 3 === 0 && (
                      <text
                        x={x + barW / 2}
                        y={168}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#64748b"
                        fontWeight={600}
                      >
                        {String(hr).padStart(2, '0')}h
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Top Destinations Horizontal Bar Chart */}
        <div className="lg:col-span-5 card p-6 space-y-4">
          <div>
            <h2 className="font-display text-base font-extrabold text-slate-900 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Top Routed Destinations
            </h2>
            <p className="text-xs text-slate-500">
              Most requested rooms, clinics, and landmarks
            </p>
          </div>

          {data.top_destinations.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              No route telemetry recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {data.top_destinations.slice(0, 6).map((dest) => {
                const pct = Math.round((dest.count / maxDestCount) * 100);
                return (
                  <div key={dest.node_id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 truncate pr-2">
                        {dest.name}
                      </span>
                      <span className="font-mono font-semibold text-indigo-600">
                        {dest.count}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Anonymous Crowd Density + Failed Searches + Recent Localisations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Crowd Density + Failed Searches */}
        <div className="lg:col-span-5 space-y-6">
          {/* Anonymous Crowd Density */}
          <div className="card p-6 space-y-3.5">
            <div>
              <h2 className="font-display text-base font-extrabold text-slate-900">
                Anonymous Zone Activity
              </h2>
              <p className="text-xs text-slate-500">
                Aggregated recent route/localization counts per zone (zero personal tracking)
              </p>
            </div>

            {data.crowd.length === 0 ? (
              <p className="text-xs text-slate-400">No active crowd hotspots right now.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.crowd.map((c) => {
                  const high = c.count >= 10;
                  const med = c.count >= 4 && c.count < 10;
                  return (
                    <div
                      key={c.node_id}
                      className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold ring-1 ${
                        high
                          ? 'bg-amber-50 text-amber-900 ring-amber-200'
                          : med
                            ? 'bg-cyan-50 text-cyan-900 ring-cyan-200'
                            : 'bg-slate-50 text-slate-700 ring-slate-200'
                      }`}
                    >
                      <span>{c.name}</span>
                      <span className="text-[10px] opacity-70">
                        ({formatLevel(c.level)})
                      </span>
                      <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold shadow-sm">
                        {c.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Failed / Unmatched Searches */}
          <div className="card p-6 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-rose-500" />
                  Unmatched Visitor Searches
                </h2>
                <p className="text-xs text-slate-500">
                  Terms visitors searched with zero results — add aliases or places
                </p>
              </div>
            </div>

            {data.failed_searches.length === 0 ? (
              <p className="text-xs text-emerald-600 font-medium">
                All recent visitor searches matched successfully!
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.failed_searches.map((fs, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 text-xs"
                  >
                    <span className="font-mono font-medium text-slate-800">
                      "{fs.query}"
                    </span>
                    <span className="rounded-full bg-rose-50 px-2.5 py-0.5 font-bold text-rose-700 ring-1 ring-rose-200">
                      {fs.count}×
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Photo Localisations Feed */}
        <div className="lg:col-span-7 card p-6 space-y-4">
          <div>
            <h2 className="font-display text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Camera className="h-4 w-4 text-indigo-600" />
              Recent Photo Localisations
            </h2>
            <p className="text-xs text-slate-500">
              Face-blurred visitor queries, predicted nodes, and user confirmations
            </p>
          </div>

          {data.recent_localizations.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              No visitor photo localisations logged yet. Test one on the public venue page!
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recent_localizations.map((loc) => (
                <div
                  key={loc.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-200">
                      {loc.photo_url ? (
                        <img
                          src={mediaUrl(loc.photo_url)}
                          alt={loc.predicted_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-slate-400">
                          No img
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        Predicted: {loc.predicted_name || 'No Match'}
                      </div>
                      {loc.confirmed_name && (
                        <div className="text-[11px] font-semibold text-emerald-700 truncate">
                          ✓ Confirmed: {loc.confirmed_name}
                        </div>
                      )}
                      <div className="text-[11px] text-slate-400">
                        {new Date(loc.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                      loc.confidence >= 0.7
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : loc.confidence >= 0.45
                          ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {Math.round(loc.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

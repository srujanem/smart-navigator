import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Search,
  ShieldAlert,
  Unlock,
} from 'lucide-react';
import {
  createAdminClosure,
  deleteAdminClosure,
  getAdminClosures,
  getVenue,
  getVenueGraph,
} from '../../lib/api';
import { FloorPlan2D } from '../../components/FloorPlan2D';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type { Closure, EdgeKind, GEdge, GNode, Graph, VenueDetail } from '../../lib/types';

const PRESET_REASONS = [
  'Lift Preventive Maintenance',
  'Wet Floor / Sanitization in Progress',
  'Corridor Renovation Work',
  'Emergency Clinical Isolation',
];

export const AdminClosuresPage: React.FC = () => {
  const { selectedSlug, selectedVenue } = useAdminVenue();

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedLevel, setSelectedLevel] = useState<number>(0);
  const [edgeSearch, setEdgeSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | EdgeKind>('all');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>('');
  const [reason, setReason] = useState('Lift Preventive Maintenance');
  const [submitting, setSubmitting] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedSlug) return;
    setLoading(true);
    setError(null);
    try {
      const [v, g, cList] = await Promise.all([
        getVenue(selectedSlug),
        getVenueGraph(selectedSlug),
        getAdminClosures(selectedSlug),
      ]);
      setVenue(v);
      setGraph(g);
      setClosures(cList);
      if (g.nodes.length > 0) {
        setSelectedLevel(g.nodes[0].level);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load corridor closures.',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, GNode>();
    graph?.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [graph]);

  const closedEdgeIds = useMemo(
    () => new Set(closures.map((c) => c.edge_id)),
    [closures],
  );

  const enrichedEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.map((e) => {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      return {
        ...e,
        closed: e.closed || closedEdgeIds.has(e.id),
        sourceName: s?.name ?? e.source,
        targetName: t?.name ?? e.target,
        level: s?.level ?? 0,
      };
    });
  }, [graph, nodeMap, closedEdgeIds]);

  const availableEdges = useMemo(() => {
    const q = edgeSearch.trim().toLowerCase();
    return enrichedEdges.filter((e) => {
      if (e.closed) return false;
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        e.sourceName.toLowerCase().includes(q) ||
        e.targetName.toLowerCase().includes(q) ||
        e.kind.toLowerCase().includes(q)
      );
    });
  }, [enrichedEdges, edgeSearch, kindFilter]);

  const handleBlockEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !selectedEdgeId || !reason.trim()) return;
    setSubmitting(true);
    try {
      await createAdminClosure(selectedSlug, selectedEdgeId, reason.trim());
      setSelectedEdgeId('');
      const [g, cList] = await Promise.all([
        getVenueGraph(selectedSlug),
        getAdminClosures(selectedSlug),
      ]);
      setGraph(g);
      setClosures(cList);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to block corridor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async (closureId: string) => {
    if (!selectedSlug) return;
    setReopeningId(closureId);
    try {
      await deleteAdminClosure(closureId);
      const [g, cList] = await Promise.all([
        getVenueGraph(selectedSlug),
        getAdminClosures(selectedSlug),
      ]);
      setGraph(g);
      setClosures(cList);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not reopen path.');
    } finally {
      setReopeningId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm text-slate-500">
          Loading venue corridors, lifts, and active closures...
        </p>
      </div>
    );
  }

  if (error || !venue || !graph) {
    return (
      <ErrorState
        message={error || 'Graph unavailable.'}
        onRetry={() => void loadData()}
      />
    );
  }

  const selectedEdgeObj = enrichedEdges.find((e) => e.id === selectedEdgeId);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-950">
          Real-Time Corridor & Lift Closures
        </h1>
        <p className="text-xs sm:text-sm text-slate-500">
          {selectedVenue?.name} · Block any hallway, staircase, or elevator in 1 click — visitor A* routing immediately detours around closed links
        </p>
      </div>

      {/* Active Closures List */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-600" />
            Active Path Closures ({closures.length})
          </h2>
        </div>

        {closures.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            All corridors, staircases, and elevators are currently open!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {closures.map((c) => {
              const edgeMeta = graph.edges.find((e) => e.id === c.edge_id);
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50/70 p-4 ring-1 ring-rose-200"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                        {edgeMeta?.kind || 'Blocked'}
                      </span>
                      <span className="text-sm font-extrabold text-slate-900 truncate">
                        {c.source_name} ↔ {c.target_name}
                      </span>
                    </div>
                    <p className="text-xs text-rose-900">
                      <strong>Reason:</strong> {c.reason}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={reopeningId === c.id}
                    onClick={() => void handleReopen(c.id)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-600 hover:text-white transition shadow-sm"
                  >
                    {reopeningId === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5" />
                    )}
                    Reopen
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Interactive Blueprint + Searchable Edge Blocker */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Visual Blueprint Edge Selector */}
        <div className="lg:col-span-7 card p-4 space-y-3">
          <div>
            <h2 className="font-display text-base font-extrabold text-slate-900">
              Visual Corridor & Lift Map
            </h2>
            <p className="text-xs text-slate-500">
              Click any corridor line on the blueprint (or pick from the list on the right) to select it for closure
            </p>
          </div>

          <div className="h-[420px] w-full">
            <FloorPlan2D
              venue={venue}
              graph={graph}
              selectedLevel={selectedLevel}
              onChangeLevel={(lvl) => setSelectedLevel(lvl)}
              selectedEdgeId={selectedEdgeId}
              onSelectEdge={(edge: GEdge) => {
                if (!edge.closed) setSelectedEdgeId(edge.id);
              }}
            />
          </div>
        </div>

        {/* Searchable Edge Picker + Reason Form */}
        <div className="lg:col-span-5 card p-5 space-y-4">
          <h2 className="font-display text-base font-extrabold text-slate-900">
            Block a Corridor, Staircase, or Lift
          </h2>

          {/* Search + Kind Filter */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={edgeSearch}
                onChange={(e) => setEdgeSearch(e.target.value)}
                placeholder="Search connection (e.g. Lift, Atrium, Ward)..."
                className="input pl-9 py-2 text-xs"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(['all', 'lift', 'stairs', 'walk', 'door', 'outdoor'] as const).map(
                (k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKindFilter(k)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase transition ${
                      kindFilter === k
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {k}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Edge List */}
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200 thin-scrollbar">
            {availableEdges.slice(0, 60).map((e) => {
              const active = e.id === selectedEdgeId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setSelectedEdgeId(e.id);
                    setSelectedLevel(e.level);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs transition ${
                    active
                      ? 'bg-amber-50 text-amber-950 font-bold'
                      : 'bg-white hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="truncate pr-2">
                    <span>
                      {e.sourceName} ↔ {e.targetName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                      {e.kind}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {Math.round(e.distance)}m
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Closure Submission Form */}
          <form onSubmit={(e) => void handleBlockEdge(e)} className="space-y-3 pt-2 border-t border-slate-100">
            {selectedEdgeObj ? (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950 ring-1 ring-amber-200">
                Selected: <strong>{selectedEdgeObj.sourceName}</strong> ↔{' '}
                <strong>{selectedEdgeObj.targetName}</strong> ({selectedEdgeObj.kind})
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">
                Select a connection above or on the blueprint to block it.
              </div>
            )}

            <div>
              <label className="label">Closure Reason</label>
              <input
                type="text"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason displayed to rerouted visitors..."
                className="input text-xs py-2"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESET_REASONS.map((pr) => (
                  <button
                    key={pr}
                    type="button"
                    onClick={() => setReason(pr)}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200"
                  >
                    {pr}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={!selectedEdgeId || submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50 transition"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              Block Path & Reroute Visitors
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

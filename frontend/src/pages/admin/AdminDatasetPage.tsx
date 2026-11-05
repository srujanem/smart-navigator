import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Cpu,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  deleteAdminPhoto,
  getAdminDataset,
  getAdminIndexReport,
  getVenue,
  getVenueGraph,
  mediaUrl,
  rebuildAdminIndex,
  uploadAdminPhotos,
} from '../../lib/api';
import { formatLevel } from '../../lib/locationStore';
import { FloorPlan2D } from '../../components/FloorPlan2D';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type {
  CoverageLevel,
  DatasetNode,
  DatasetResponse,
  Graph,
  IndexReport,
  UploadPhotosResponse,
  VenueDetail,
} from '../../lib/types';

const RadialGauge: React.FC<{
  label: string;
  value: number; // 0..1
  color: string;
}> = ({ label, value, color }) => {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="flex items-center gap-3.5 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80">
      <div className="relative h-20 w-20 shrink-0">
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
          <circle
            cx={42}
            cy={42}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={8}
          />
          <circle
            cx={42}
            cy={42}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-display text-base font-extrabold text-slate-900">
          {pct}%
        </div>
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <div className="text-xs text-slate-600 mt-0.5">
          Leave-one-out cross-validation
        </div>
      </div>
    </div>
  );
};

export const AdminDatasetPage: React.FC = () => {
  const { selectedSlug } = useAdminVenue();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [dataset, setDataset] = useState<DatasetResponse | null>(null);
  const [report, setReport] = useState<IndexReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedLevel, setSelectedLevel] = useState<number>(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [covFilter, setCovFilter] = useState<'all' | CoverageLevel>('all');
  const [nodeQuery, setNodeQuery] = useState('');

  // Upload & Rebuild States
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadPhotosResponse | null>(
    null,
  );
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const loadAll = useCallback(async () => {
    if (!selectedSlug) return;
    setLoading(true);
    setError(null);
    setUploadResult(null);
    try {
      const [v, g, ds, rep] = await Promise.all([
        getVenue(selectedSlug),
        getVenueGraph(selectedSlug),
        getAdminDataset(selectedSlug),
        getAdminIndexReport(selectedSlug).catch(() => null),
      ]);
      setVenue(v);
      setGraph(g);
      setDataset(ds);
      setReport(rep);
      if (ds.nodes.length > 0) {
        setSelectedNodeId((prev) =>
          prev && ds.nodes.some((n) => n.node_id === prev)
            ? prev
            : ds.nodes[0].node_id,
        );
        setSelectedLevel(ds.nodes[0].level);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load photo dataset.',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const coverageMap = useMemo(() => {
    const m: Record<string, CoverageLevel> = {};
    dataset?.nodes.forEach((n) => {
      m[n.node_id] = n.coverage;
    });
    return m;
  }, [dataset]);

  const filteredNodes = useMemo(() => {
    if (!dataset) return [];
    const q = nodeQuery.trim().toLowerCase();
    return dataset.nodes.filter((n) => {
      if (covFilter !== 'all' && n.coverage !== covFilter) return false;
      if (!q) return true;
      return (
        n.name.toLowerCase().includes(q) ||
        n.building_name.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q)
      );
    });
  }, [dataset, covFilter, nodeQuery]);

  const selectedNode: DatasetNode | null = useMemo(() => {
    if (!dataset || !selectedNodeId) return null;
    return dataset.nodes.find((n) => n.node_id === selectedNodeId) ?? null;
  }, [dataset, selectedNodeId]);

  const refreshDatasetOnly = async () => {
    if (!selectedSlug) return;
    const ds = await getAdminDataset(selectedSlug);
    setDataset(ds);
  };

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    if (!selectedSlug || !selectedNode) return;
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) return;

    setUploading(true);
    setUploadResult(null);
    try {
      const res = await uploadAdminPhotos(
        selectedSlug,
        selectedNode.node_id,
        files,
      );
      setUploadResult(res);
      await refreshDatasetOnly();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    setDeletingPhotoId(photoId);
    try {
      await deleteAdminPhoto(photoId);
      await refreshDatasetOnly();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete photo.');
    } finally {
      setDeletingPhotoId(null);
    }
  };

  const handleRebuildIndex = async () => {
    if (!selectedSlug) return;
    setRebuilding(true);
    try {
      const newReport = await rebuildAdminIndex(selectedSlug);
      setReport(newReport);
      await refreshDatasetOnly();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Index rebuild failed.');
    } finally {
      setRebuilding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm text-slate-500">
          Loading venue photo dataset & AI vision index...
        </p>
      </div>
    );
  }

  if (error || !dataset || !venue || !graph) {
    return (
      <ErrorState
        message={error || 'Dataset unavailable.'}
        onRetry={() => void loadAll()}
      />
    );
  }

  const coveredPct =
    dataset.totals.nodes > 0
      ? Math.round((dataset.totals.covered / dataset.totals.nodes) * 100)
      : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header + Rebuild AI Vision Index CTA */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-950">
              Photo Dataset & AI Vision Index
            </h1>
            <span className="chip bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
              <Cpu className="h-3.5 w-3.5" />
              {dataset.embedder}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {dataset.totals.photos} indexed photos across {dataset.totals.covered}/
            {dataset.totals.nodes} nodes ({coveredPct}% covered)
          </p>
        </div>

        <button
          type="button"
          disabled={rebuilding}
          onClick={() => void handleRebuildIndex()}
          className="btn-primary py-2.5 px-5 text-xs font-extrabold shadow-lg shadow-cyan-500/20"
        >
          {rebuilding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {rebuilding ? 'Rebuilding Vision Index...' : 'Rebuild AI Vision Index'}
        </button>
      </div>

      {/* Top Grid: 2D Coverage Heatmap + Filterable Node List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive 2D Floor Coverage Heatmap */}
        <div className="lg:col-span-7 card p-4 flex flex-col space-y-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="font-display text-base font-extrabold text-slate-900">
                2D Floor Coverage Heatmap
              </h2>
              <p className="text-xs text-slate-500">
                Click any emerald, amber, or rose node to inspect or upload reference angles
              </p>
            </div>
          </div>

          <div className="h-[380px] w-full">
            <FloorPlan2D
              venue={venue}
              graph={graph}
              selectedLevel={selectedLevel}
              onChangeLevel={(lvl) => setSelectedLevel(lvl)}
              selectedNodeId={selectedNodeId}
              coverageByNode={coverageMap}
              onSelectNode={(n) => {
                setSelectedNodeId(n.id);
                setUploadResult(null);
              }}
            />
          </div>
        </div>

        {/* Filterable Node Coverage List */}
        <div className="lg:col-span-5 card p-4 flex flex-col h-[452px]">
          <div className="space-y-2.5 pb-3 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={nodeQuery}
                onChange={(e) => setNodeQuery(e.target.value)}
                placeholder="Filter nodes by name or building..."
                className="input pl-9 py-2 text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'none', label: 'Missing (0)' },
                  { key: 'low', label: 'Low (1–2)' },
                  { key: 'good', label: 'Good (3+)' },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setCovFilter(f.key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    covFilter === f.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 pt-1 thin-scrollbar">
            {filteredNodes.map((n) => {
              const isSelected = n.node_id === selectedNodeId;
              const badgeCls =
                n.coverage === 'good'
                  ? 'bg-emerald-100 text-emerald-800'
                  : n.coverage === 'low'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-rose-100 text-rose-800';

              return (
                <button
                  key={n.node_id}
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(n.node_id);
                    setSelectedLevel(n.level);
                    setUploadResult(null);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition rounded-xl ${
                    isSelected ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {n.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {n.building_name} · {formatLevel(n.level)} · {n.kind}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeCls}`}
                  >
                    {n.photo_count} {n.photo_count === 1 ? 'photo' : 'photos'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected Node Inspector & Multi-File Photo Uploader */}
      {selectedNode && (
        <div className="card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                Selected Node Inspector · {selectedNode.building_name} ·{' '}
                {formatLevel(selectedNode.level)}
              </span>
              <h2 className="font-display text-xl font-extrabold text-slate-950 mt-0.5">
                {selectedNode.name}
              </h2>
            </div>

            <span
              className={`chip ${
                selectedNode.coverage === 'good'
                  ? 'bg-emerald-100 text-emerald-800'
                  : selectedNode.coverage === 'low'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-rose-100 text-rose-800'
              }`}
            >
              Coverage: {selectedNode.coverage.toUpperCase()} (
              {selectedNode.photo_count} photos)
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Multi-file Drag-and-Drop Photo Uploader */}
            <div className="lg:col-span-5 space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) {
                    void handleUploadFiles(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
                  dragOver
                    ? 'border-cyan-500 bg-cyan-50/60'
                    : 'border-slate-300 bg-slate-50/70 hover:border-indigo-500 hover:bg-indigo-50/30'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      void handleUploadFiles(e.target.files);
                    }
                    e.target.value = '';
                  }}
                />
                {uploading ? (
                  <div className="py-3 space-y-2">
                    <Loader2 className="h-7 w-7 animate-spin text-indigo-600 mx-auto" />
                    <p className="text-xs font-bold text-slate-700">
                      Checking blur quality, blurring faces & indexing...
                    </p>
                  </div>
                ) : (
                  <>
                    <Upload className="h-7 w-7 text-indigo-600 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-900">
                      Drop Multiple Reference Photos Here
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Capture 3–5 angles per spot (approaching corridor, room signboard, doorway). Blurry or duplicate shots are filtered automatically.
                    </p>
                  </>
                )}
              </div>

              {/* Upload Accepted / Rejected Feedback */}
              {uploadResult && (
                <div className="space-y-2 text-xs">
                  {uploadResult.accepted.length > 0 && (
                    <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Accepted {uploadResult.accepted.length} photo
                        {uploadResult.accepted.length > 1 ? 's' : ''}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {uploadResult.accepted.map((a) => (
                          <span
                            key={a.id}
                            className="rounded bg-white px-2 py-0.5 text-[11px] font-semibold ring-1 ring-emerald-200"
                          >
                            Quality: {Math.round(a.quality * 100)}%
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {uploadResult.rejected.length > 0 && (
                    <div className="rounded-xl bg-rose-50 p-3 text-rose-900 ring-1 ring-rose-200 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <XCircle className="h-4 w-4 text-rose-600" />
                        Rejected {uploadResult.rejected.length} file
                        {uploadResult.rejected.length > 1 ? 's' : ''}
                      </div>
                      {uploadResult.rejected.map((rej, idx) => (
                        <div key={idx} className="text-[11px]">
                          <strong>{rej.filename}:</strong> {rej.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Existing Dataset Photos Grid */}
            <div className="lg:col-span-7">
              {selectedNode.photos.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 p-10 text-center ring-1 ring-slate-200/70">
                  <Camera className="h-7 w-7 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">
                    No reference photos for {selectedNode.name} yet
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Upload photos on the left so visitors can localize here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                  {selectedNode.photos.map((ph) => (
                    <div
                      key={ph.id}
                      className="group relative overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-200 shadow-sm"
                    >
                      <img
                        src={mediaUrl(ph.url)}
                        alt={selectedNode.name}
                        className="h-32 w-full object-cover"
                      />
                      <div className="flex items-center justify-between bg-white px-2.5 py-2 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700 capitalize">
                            {ph.source}
                          </span>
                          <span className="font-mono text-emerald-700 font-bold">
                            Q:{Math.round(ph.quality * 100)}%
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={deletingPhotoId === ph.id}
                          onClick={() => void handleDeletePhoto(ph.id)}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          title="Delete photo"
                        >
                          {deletingPhotoId === ph.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Vision Index Model Health Report Panel */}
      <div className="card p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="font-display text-lg font-extrabold text-slate-950 flex items-center gap-2">
              <Cpu className="h-5 w-5 text-indigo-600" />
              AI Vision Index Health Report
            </h2>
            <p className="text-xs text-slate-500">
              Leave-one-out cross-validation diagnostics across all indexed venue photos
            </p>
          </div>

          {report && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="chip bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
                Engine: {report.embedder}
              </span>
              <span className="chip bg-slate-100 text-slate-700">
                Built in {Math.round(report.ms)} ms
              </span>
              <span className="text-slate-400">
                {new Date(report.built_at).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {!report ? (
          <div className="rounded-2xl bg-slate-50 p-8 text-center">
            <p className="text-sm font-medium text-slate-600">
              No index evaluation report built yet. Click{' '}
              <strong>"Rebuild AI Vision Index"</strong> above to run cross-validation!
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top-1 & Top-3 Gauges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <RadialGauge
                label="Top-1 Leave-One-Out Accuracy"
                value={report.top1}
                color="#0ea5e9"
              />
              <RadialGauge
                label="Top-3 Candidate Recall"
                value={report.top3}
                color="#10b981"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Per-Node Accuracy Bars */}
              <div className="lg:col-span-7 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Per-Node Top-1 Validation ({report.per_node.length} evaluated nodes)
                </h3>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-2 thin-scrollbar">
                  {[...report.per_node]
                    .sort((a, b) => a.top1 - b.top1)
                    .map((pn) => {
                      const pct = Math.round(pn.top1 * 100);
                      return (
                        <div key={pn.node_id} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-semibold text-slate-800">
                              {pn.name}{' '}
                              <span className="text-slate-400 font-normal">
                                ({pn.n} photos)
                              </span>
                            </span>
                            <span className="font-mono font-bold text-slate-700">
                              {pct}%
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                pct >= 80
                                  ? 'bg-emerald-500'
                                  : pct >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.max(pct, 4)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Confusing Spot Pairs Warnings */}
              <div className="lg:col-span-5 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Visually Confusing Spot Pairs
                </h3>
                {report.confusions.length === 0 ? (
                  <div className="rounded-2xl bg-emerald-50 p-4 text-xs text-emerald-800 ring-1 ring-emerald-200">
                    Zero visual confusions detected between nodes! Every indexed spot is clearly distinguishable.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {report.confusions.map((c, idx) => (
                      <div
                        key={idx}
                        className="flex items-start justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-950 ring-1 ring-amber-200"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold">
                              {c.a} ↔ {c.b}
                            </div>
                            <div className="text-[11px] text-amber-800">
                              Tip: Add a closer photo of the room signboard to disambiguate via OCR.
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-amber-200/70 px-2 py-0.5 font-bold">
                          {c.count}×
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

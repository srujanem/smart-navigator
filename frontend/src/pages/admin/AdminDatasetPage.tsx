import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Compass,
  Cpu,
  Film,
  HardDrive,
  Loader2,
  Route as RouteIcon,
  ScanText,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  autoMapAdminDataset,
  deleteAdminPhoto,
  getAdminDataset,
  getAdminIndexReport,
  getVenue,
  getVenueGraph,
  mediaUrl,
  rebuildAdminIndex,
  updateAdminPhoto,
  uploadAdminPhotos,
} from '../../lib/api';
import { formatLevel } from '../../lib/locationStore';
import { FloorPlan2D } from '../../components/FloorPlan2D';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type {
  AutoMapDatasetResponse,
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
  const autoMapInputRef = useRef<HTMLInputElement>(null);

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
  const [uploadHeading, setUploadHeading] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadPhotosResponse | null>(
    null,
  );
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  // Enterprise Multi-Route Walk-Through & Bulk Auto-OCR States
  const [autoMode, setAutoMode] = useState<'route' | 'ocr'>('route');
  const [routeFromId, setRouteFromId] = useState<string>('');
  const [routeToId, setRouteToId] = useState<string>('');
  const [ocrLevelFilter, setOcrLevelFilter] = useState<string>('all');
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMapStage, setAutoMapStage] = useState<string>('');
  const [autoMapResult, setAutoMapResult] =
    useState<AutoMapDatasetResponse | null>(null);

  const loadAll = useCallback(async () => {
    if (!selectedSlug) return;
    setLoading(true);
    setError(null);
    setUploadResult(null);
    setAutoMapResult(null);
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
        setRouteFromId(ds.nodes[0].node_id);
        setRouteToId(
          ds.nodes[Math.min(ds.nodes.length - 1, 4)].node_id,
        );
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
    const files = Array.from(fileList).filter(
      (f) =>
        f.type.startsWith('image/') ||
        f.type.startsWith('video/') ||
        /\.(jpg|jpeg|png|webp|heic|mp4|webm|mov|mkv)$/i.test(f.name),
    );
    if (files.length === 0) return;

    setUploading(true);
    setUploadResult(null);
    try {
      const parsedHeading = uploadHeading !== '' ? Number(uploadHeading) : null;
      const res = await uploadAdminPhotos(
        selectedSlug,
        selectedNode.node_id,
        files,
        parsedHeading,
      );
      setUploadResult(res);
      await refreshDatasetOnly();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Media upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleAutoMapFiles = async (fileList: FileList | File[]) => {
    if (!selectedSlug) return;
    const files = Array.from(fileList).filter(
      (f) =>
        f.type.startsWith('image/') ||
        f.type.startsWith('video/') ||
        /\.(jpg|jpeg|png|webp|heic|mp4|webm|mov|mkv)$/i.test(f.name),
    );
    if (files.length === 0) return;

    setAutoMapping(true);
    setAutoMapResult(null);
    setAutoMapStage('Preparing high-end device compression & frame slicer...');
    try {
      const res = await autoMapAdminDataset(selectedSlug, {
        mode: autoMode,
        fromNodeId: autoMode === 'route' ? routeFromId : undefined,
        toNodeId: autoMode === 'route' ? routeToId : undefined,
        levelFilter:
          autoMode === 'ocr' && ocrLevelFilter !== 'all'
            ? Number(ocrLevelFilter)
            : null,
        fallbackNodeId: selectedNodeId,
        files,
        onProgressStage: (msg) => setAutoMapStage(msg),
      });
      setAutoMapResult(res);
      await refreshDatasetOnly();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : 'Smart Auto-Mapping failed. Check file format and try again.',
      );
    } finally {
      setAutoMapping(false);
      setAutoMapStage('');
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

      {/* ENTERPRISE HOSPITAL / MULTI-ROUTE WALK-THROUGH & BULK AUTO-OCR MAPPER */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-5 sm:p-6 text-white ring-1 ring-white/15 shadow-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-400/30">
              <Film className="h-3.5 w-3.5" />
              Enterprise Hospital & Multi-Route Auto-Mapper
            </div>
            <h2 className="font-display text-lg sm:text-xl font-extrabold mt-1.5">
              Walk & Record Once — Auto-Slice, Compress & Tag Multiple Rooms
            </h2>
            <p className="text-xs text-slate-300 mt-0.5 max-w-3xl">
              Built for large hospitals (like Manipal) & multi-floor campuses: shoot a single walk-through video or drop 50+ high-res phone photos. On-device WebP compression shrinks 48MP/4K captures by <strong>95%</strong>, filters motion blur, reads room signboards via OCR, and distributes frames across every slot along the corridor automatically.
            </p>
          </div>

          <div className="inline-flex rounded-xl bg-white/10 p-1 ring-1 ring-white/15 text-xs font-bold">
            <button
              type="button"
              onClick={() => setAutoMode('route')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                autoMode === 'route'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <RouteIcon className="h-3.5 w-3.5" />
              Corridor Walk-Through (Start → End)
            </button>
            <button
              type="button"
              onClick={() => setAutoMode('ocr')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                autoMode === 'ocr'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <ScanText className="h-3.5 w-3.5" />
              Bulk Auto-OCR Door Sorter
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-7 space-y-3">
            {autoMode === 'route' ? (
              <div className="grid grid-cols-1 sm:grid-cols-11 gap-2.5 items-center rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-cyan-300 mb-1">
                    Walk Start Spot
                  </label>
                  <select
                    value={routeFromId}
                    onChange={(e) => setRouteFromId(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20"
                  >
                    {dataset.nodes.map((n) => (
                      <option key={n.node_id} value={n.node_id}>
                        {n.name} ({formatLevel(n.level)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hidden sm:flex sm:col-span-1 items-center justify-center pt-4">
                  <ArrowRight className="h-4 w-4 text-cyan-400" />
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-300 mb-1">
                    Walk End Spot
                  </label>
                  <select
                    value={routeToId}
                    onChange={(e) => setRouteToId(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20"
                  >
                    {dataset.nodes.map((n) => (
                      <option key={n.node_id} value={n.node_id}>
                        {n.name} ({formatLevel(n.level)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-cyan-300">
                    Bulk Signboard OCR + Visual Matching
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Drop unsorted room/corridor photos from any floor — AI reads door plaques ("204", "ICU", "Pharmacy") and assigns each photo to its node.
                  </div>
                </div>
                <select
                  value={ocrLevelFilter}
                  onChange={(e) => setOcrLevelFilter(e.target.value)}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20"
                >
                  <option value="all">All Floors</option>
                  {Array.from(new Set(dataset.nodes.map((n) => n.level)))
                    .sort((a, b) => a - b)
                    .map((lvl) => (
                      <option key={lvl} value={String(lvl)}>
                        {formatLevel(lvl)} Only
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          <div className="lg:col-span-5">
            <input
              ref={autoMapInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  void handleAutoMapFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={autoMapping}
              onClick={() => autoMapInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-4 text-xs sm:text-sm font-extrabold text-slate-950 shadow-xl hover:brightness-105 disabled:opacity-50 transition"
            >
              {autoMapping ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{autoMapStage || 'Auto-Mapping Route & OCR...'}</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span>
                    {autoMode === 'route'
                      ? 'Upload Walk Video or Photo Burst for Route'
                      : 'Upload Bulk Photos / Video for Auto-OCR Tagging'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {autoMapResult && (
          <div className="rounded-2xl bg-slate-950/80 p-4 ring-1 ring-emerald-400/40 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Auto-Mapped {autoMapResult.accepted.length} sharp keyframes across{' '}
                {autoMapResult.nodes_updated} nodes!
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                <HardDrive className="h-3.5 w-3.5" />
                Raw {autoMapResult.raw_mb} MB → Stored {autoMapResult.stored_mb} MB WebP
                {autoMapResult.space_saved_mb > 0
                  ? ` (${autoMapResult.space_saved_mb} MB saved)`
                  : ''}
              </div>
            </div>

            {autoMapResult.accepted.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto thin-scrollbar pt-1">
                {autoMapResult.accepted.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-slate-200 ring-1 ring-white/15"
                  >
                    <strong className="text-cyan-300">{item.node_name}</strong>
                    <span className="text-slate-400">· {item.method}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
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
              <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200/80">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Compass className="h-3.5 w-3.5 text-indigo-600" />
                  Camera Heading:
                </span>
                <select
                  value={uploadHeading}
                  onChange={(e) => setUploadHeading(e.target.value)}
                  className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200"
                >
                  <option value="">Unspecified</option>
                  <option value="0">0° North</option>
                  <option value="45">45° NE</option>
                  <option value="90">90° East</option>
                  <option value="135">135° SE</option>
                  <option value="180">180° South</option>
                  <option value="225">225° SW</option>
                  <option value="270">270° West</option>
                  <option value="315">315° NW</option>
                </select>
              </div>
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
                  accept="image/*,video/mp4,video/webm,video/quicktime"
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
                      Compressing to WebP, blurring faces & indexing...
                    </p>
                  </div>
                ) : (
                  <>
                    <Upload className="h-7 w-7 text-indigo-600 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-900">
                      Drop Reference Photos or Short Room Videos
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Capture 3–5 angles per spot (or a short 3–15s clip). High-res phone captures are auto-compressed on device to 1600px WebP.
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
                      <div className="relative h-32 w-full bg-slate-950">
                        <img
                          src={mediaUrl(ph.thumbnail_url || ph.url)}
                          alt={selectedNode.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        {ph.media_type === 'video' && (
                          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-slate-950/85 px-2 py-0.5 text-[10px] font-bold text-cyan-300 ring-1 ring-cyan-400/40">
                            <Film className="h-3 w-3" />
                            Video {ph.duration_s ? `${ph.duration_s}s` : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between bg-white px-2.5 py-2 text-[11px] gap-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-mono text-emerald-700 font-bold">
                            Q:{Math.round(ph.quality * 100)}%
                          </span>
                          <select
                            value={
                              ph.heading_deg !== null && ph.heading_deg !== undefined
                                ? String(Math.round(ph.heading_deg))
                                : ''
                            }
                            onChange={async (e) => {
                              const val =
                                e.target.value === '' ? null : Number(e.target.value);
                              try {
                                await updateAdminPhoto(ph.id, val);
                                await refreshDatasetOnly();
                              } catch {
                                // Ignore
                              }
                            }}
                            className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-700"
                            title="Camera compass heading"
                          >
                            <option value="">Dir: —</option>
                            <option value="0">0° N</option>
                            <option value="45">45° NE</option>
                            <option value="90">90° E</option>
                            <option value="135">135° SE</option>
                            <option value="180">180° S</option>
                            <option value="225">225° SW</option>
                            <option value="270">270° W</option>
                            <option value="315">315° NW</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          disabled={deletingPhotoId === ph.id}
                          onClick={() => void handleDeletePhoto(ph.id)}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition shrink-0"
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

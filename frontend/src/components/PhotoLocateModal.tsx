import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Compass,
  Cpu,
  Eye,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  ScanText,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  confirmLocalization,
  fetchSamplePhotoAsFile,
  getSampleQueries,
  localizePhoto,
  mediaUrl,
} from '../lib/api';
import { formatLevel } from '../lib/locationStore';
import type {
  Candidate,
  GNode,
  LocalizeResult,
  SampleQuery,
  VenueDetail,
} from '../lib/types';

export interface ConfirmedSpot {
  nodeId: string;
  name: string;
  buildingName: string;
  level: number;
  floorName?: string;
  headingDeg?: number | null;
  source: 'photo' | 'manual';
  activeLearningPromoted?: boolean;
  activeLearningNote?: string;
}

interface PhotoLocateModalProps {
  open: boolean;
  onClose: () => void;
  venue: VenueDetail;
  nodes: GNode[];
  initialFile?: File | null;
  priorNodeId?: string | null;
  queuedDestination?: { nodeId: string; name: string } | null;
  onConfirmedLocation: (spot: ConfirmedSpot) => void;
}

type ModalStage = 'idle' | 'analyzing' | 'result';

function formatHeadingLabel(deg: number | null | undefined): string | null {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return null;
  const norm = ((Math.round(deg) % 360) + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(norm / 45) % 8;
  return `${norm}° ${dirs[idx]}`;
}

export const PhotoLocateModal: React.FC<PhotoLocateModalProps> = ({
  open,
  onClose,
  venue,
  nodes,
  initialFile = null,
  priorNodeId = null,
  queuedDestination = null,
  onConfirmedLocation,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<ModalStage>('idle');
  const [levelHint, setLevelHint] = useState<string>('all');
  const [samples, setSamples] = useState<SampleQuery[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<LocalizeResult | null>(null);
  const [visibleTraceCount, setVisibleTraceCount] = useState(0);
  const [showCandidatesOverride, setShowCandidatesOverride] = useState(false);
  const [showAiOverlay, setShowAiOverlay] = useState(true);
  const [compareMode, setCompareMode] = useState<'side' | 'wipe'>('side');
  const [wipePercent, setWipePercent] = useState<number>(52);
  const [copiedMeetLink, setCopiedMeetLink] = useState(false);
  const [contribute, setContribute] = useState(true);
  const [confirmingNodeId, setConfirmingNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showManualPicker, setShowManualPicker] = useState(false);
  const [manualSearch, setManualSearch] = useState('');

  const floors = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of venue.buildings) {
      for (const f of b.floors) {
        if (!map.has(f.level)) map.set(f.level, f.name);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, name]) => ({ level, name }));
  }, [venue.buildings]);

  const entranceNode = useMemo(() => {
    if (venue.entrance_node_id) {
      const found = nodes.find((n) => n.id === venue.entrance_node_id);
      if (found) return found;
    }
    return (
      nodes.find((n) => n.kind.toLowerCase().includes('entrance')) ??
      nodes.find((n) => n.is_place) ??
      null
    );
  }, [venue.entrance_node_id, nodes]);

  const priorNode = useMemo(
    () => (priorNodeId ? nodes.find((n) => n.id === priorNodeId) ?? null : null),
    [nodes, priorNodeId],
  );

  const filteredManualNodes = useMemo(() => {
    const q = manualSearch.trim().toLowerCase();
    const places = nodes.filter((n) => n.is_place);
    if (!q) return places.slice(0, 24);
    return places
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.building_name.toLowerCase().includes(q) ||
          n.floor_name.toLowerCase().includes(q),
      )
      .slice(0, 24);
  }, [nodes, manualSearch]);

  // Load sample visitor test photos when modal opens (only venues that have real samples)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingSamples(true);
    getSampleQueries(venue.slug)
      .then((list) => {
        if (!cancelled) setSamples(list);
      })
      .catch(() => {
        if (!cancelled) setSamples([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSamples(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, venue.slug]);

  // Cleanup object URL
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const resetToUpload = useCallback(() => {
    setStage('idle');
    setResult(null);
    setVisibleTraceCount(0);
    setShowCandidatesOverride(false);
    setCopiedMeetLink(false);
    setError(null);
  }, []);

  const runLocalization = useCallback(
    async (file: File) => {
      setError(null);
      setShowCandidatesOverride(false);
      setCopiedMeetLink(false);
      setResult(null);
      setVisibleTraceCount(0);

      const blobUrl = URL.createObjectURL(file);
      setPreviewUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return blobUrl;
      });
      setStage('analyzing');

      const parsedLevel = levelHint === 'all' ? null : Number(levelHint);
      const startedAt = performance.now();

      try {
        const res = await localizePhoto(venue.slug, file, parsedLevel, priorNodeId);
        setResult(res);

        // Sequence the AI trace steps over ~900ms so visitors see the real pipeline clearly
        const totalSteps = Math.max(res.trace.length, 1);
        const elapsed = performance.now() - startedAt;
        const minTotalMs = 920;
        const remainingMs = Math.max(minTotalMs - elapsed, 320);
        const stepDelay = Math.max(Math.floor(remainingMs / totalSteps), 140);

        for (let i = 1; i <= totalSteps; i++) {
          await new Promise((r) => setTimeout(r, stepDelay));
          setVisibleTraceCount(i);
        }
        await new Promise((r) => setTimeout(r, 180));
        setStage('result');
      } catch (err) {
        setStage('idle');
        setError(
          err instanceof Error
            ? err.message
            : 'Photo localization failed. Please try another image.',
        );
      }
    },
    [levelHint, priorNodeId, venue.slug],
  );

  // Run initialFile if dropped on parent hero card
  useEffect(() => {
    if (open && initialFile) {
      void runLocalization(initialFile);
    } else if (!open) {
      resetToUpload();
      setShowManualPicker(false);
      setManualSearch('');
    }
  }, [open, initialFile, runLocalization, resetToUpload]);

  const handleSampleClick = async (sample: SampleQuery) => {
    setError(null);
    setStage('analyzing');
    setPreviewUrl(sample.photo_url);
    try {
      const file = await fetchSamplePhotoAsFile(sample.photo_url, sample.label);
      await runLocalization(file);
    } catch (err) {
      setStage('idle');
      setError(
        err instanceof Error ? err.message : 'Unable to fetch sample photo.',
      );
    }
  };

  const handleConfirmCandidate = async (cand: Candidate) => {
    if (!result) return;
    setConfirmingNodeId(cand.node_id);
    let promoted = false;
    let promoNote = '';
    try {
      const res = await confirmLocalization(
        venue.slug,
        result.log_id,
        cand.node_id,
        contribute,
      );
      promoted = Boolean(res.added_photo);
      promoNote = res.reason || '';
    } catch {
      // Even if telemetry confirm fails transiently, allow visitor to proceed
    } finally {
      setConfirmingNodeId(null);
    }

    onConfirmedLocation({
      nodeId: cand.node_id,
      name: cand.name,
      buildingName: cand.building_name,
      level: cand.level,
      floorName: cand.floor_name,
      headingDeg: cand.matched_heading_deg ?? null,
      source: 'photo',
      activeLearningPromoted: promoted,
      activeLearningNote: promoNote,
    });
    onClose();
  };

  const handleManualSelect = (node: GNode) => {
    onConfirmedLocation({
      nodeId: node.id,
      name: node.name,
      buildingName: node.building_name,
      level: node.level,
      floorName: node.floor_name,
      headingDeg: null,
      source: 'manual',
    });
    onClose();
  };

  const handleShareSpot = async (cand: Candidate, viaWhatsApp = false) => {
    const meetUrl = `${window.location.origin}/v/${encodeURIComponent(venue.slug)}?meet=${encodeURIComponent(cand.node_id)}`;
    const text = `Meet me at ${cand.name} (${cand.building_name}, ${formatLevel(cand.level, cand.floor_name)}) inside ${venue.name}: ${meetUrl}`;
    if (viaWhatsApp) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await navigator.clipboard.writeText(meetUrl);
      setCopiedMeetLink(true);
      setTimeout(() => setCopiedMeetLink(false), 2500);
    } catch {
      // Fallback
    }
  };

  if (!open) return null;

  const showConfidentView =
    stage === 'result' &&
    result?.status === 'confident' &&
    result.best &&
    !showCandidatesOverride;

  const showCandidatesView =
    stage === 'result' &&
    result &&
    ((result.status === 'uncertain' && result.candidates.length > 0) ||
      (showCandidatesOverride && result.candidates.length > 0));

  const showNoMatchView =
    stage === 'result' &&
    result &&
    (result.status === 'no_match' ||
      (result.status === 'uncertain' && result.candidates.length === 0));

  const ocrBoxes = result?.ocr_boxes ?? [];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-5 overflow-y-auto bg-slate-950/75 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-3xl overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl ring-1 ring-slate-900/10 h-[96dvh] sm:h-auto sm:max-h-[92vh] flex flex-col mt-auto sm:my-auto"
        >
          {/* Modal Top Header */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-[#070B18] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-600 text-white shadow-md">
                <Camera className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-base sm:text-lg font-bold leading-tight">
                  Visual Indoor Positioning
                </h2>
                <p className="text-xs text-slate-400">
                  {venue.name} · Upload a still photo to pinpoint where you stand
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Queued Destination Banner */}
          {queuedDestination && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50 px-5 py-2.5 border-b border-indigo-100 text-xs">
              <div className="flex items-center gap-2 font-medium text-indigo-950">
                <MapPin className="h-4 w-4 text-indigo-600 shrink-0" />
                <span>
                  Destination ready:{' '}
                  <strong className="font-bold">{queuedDestination.name}</strong>.
                  Confirm where you stand to launch routing!
                </span>
              </div>
              {entranceNode && (
                <button
                  type="button"
                  onClick={() => handleManualSelect(entranceNode)}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 transition"
                >
                  Start from {entranceNode.name}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Continuity Prior Indicator */}
          {priorNode && stage === 'idle' && (
            <div className="flex items-center gap-2 bg-cyan-50/80 px-5 py-2 border-b border-cyan-100 text-[11px] text-cyan-900">
              <Compass className="h-3.5 w-3.5 text-cyan-600 shrink-0" />
              <span>
                Spatial Continuity Prior active near <strong>{priorNode.name}</strong> ({formatLevel(priorNode.level, priorNode.floor_name)}) — breaks lookalike corridor ties automatically.
              </span>
            </div>
          )}

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 thin-scrollbar">
            {error && (
              <div className="flex items-start gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
                <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">{error}</div>
              </div>
            )}

            {/* STAGE 1: IDLE / UPLOAD + SAMPLE GALLERY */}
            {stage === 'idle' && (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Step 1 · Capture Surroundings
                    </span>
                    <p className="text-sm text-slate-600">
                      Snap a corridor, room signboard, reception desk, or landmark.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-slate-400 shrink-0" />
                    <select
                      value={levelHint}
                      onChange={(e) => setLevelHint(e.target.value)}
                      className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      aria-label="Optional floor hint"
                    >
                      <option value="all">All Floors (Auto-Detect)</option>
                      {floors.map((fl) => (
                        <option key={fl.level} value={String(fl.level)}>
                          Hint: {formatLevel(fl.level, fl.name)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Hidden File Inputs: Camera & Gallery */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void runLocalization(file);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void runLocalization(file);
                    e.target.value = '';
                  }}
                />

                {/* Primary Mobile Action Buttons: Camera Snap vs Gallery */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-600 px-5 py-4 text-sm font-extrabold text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-400 hover:to-indigo-500 active:scale-[0.98] transition"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
                      <Camera className="h-5 w-5 text-white" />
                    </div>
                    <div className="text-left">
                      <div className="leading-tight">Snap Live Photo</div>
                      <div className="text-[11px] font-normal text-cyan-100">Opens phone camera directly</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex items-center justify-center gap-3 rounded-2xl bg-slate-100 hover:bg-slate-200/80 px-5 py-4 text-sm font-extrabold text-slate-800 ring-1 ring-slate-200 active:scale-[0.98] transition"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                      <Upload className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <div className="leading-tight">Choose from Gallery</div>
                      <div className="text-[11px] font-normal text-slate-500">Pick saved photos or files</div>
                    </div>
                  </button>
                </div>

                {/* Drag-and-drop / Desktop Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith('image/')) {
                      void runLocalization(file);
                    }
                  }}
                  onClick={() => galleryInputRef.current?.click()}
                  className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                    dragActive
                      ? 'border-cyan-500 bg-cyan-50/70 scale-[1.01]'
                      : 'border-slate-300 bg-slate-50/70 hover:border-cyan-500 hover:bg-cyan-50/30'
                  }`}
                >
                  <p className="font-display text-sm font-bold text-slate-900">
                    Or Drop an Image Here
                  </p>
                  <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                    Faces are blurred automatically via YuNet and EXIF GPS metadata is stripped on upload. No live video feed required.
                  </p>
                </div>

                {/* One-Click Visitor Sample Queries (Only displayed if venue has real sample queries) */}
                {(loadingSamples || samples.length > 0) && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                        <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                        Try a Real Visitor Test Photo (1-Click Demo)
                      </div>
                      {loadingSamples && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                        </span>
                      )}
                    </div>

                    {samples.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {samples.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => void handleSampleClick(s)}
                            className="group relative flex flex-col overflow-hidden rounded-xl bg-white text-left ring-1 ring-slate-200 hover:ring-2 hover:ring-cyan-500 transition shadow-sm"
                          >
                            <div className="relative h-24 w-full overflow-hidden bg-slate-900">
                              <img
                                src={mediaUrl(s.photo_url)}
                                alt={s.label}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent" />
                              <span className="absolute bottom-1.5 right-1.5 rounded-md bg-cyan-500 px-1.5 py-0.5 text-[10px] font-bold text-slate-950 opacity-0 group-hover:opacity-100 transition">
                                Test AI →
                              </span>
                            </div>
                            <div className="p-2.5">
                              <div className="text-xs font-bold text-slate-900 truncate">
                                {s.label}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {s.hint}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Manual Starting Spot Fallback */}
                <div className="border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowManualPicker((v) => !v)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 flex items-center gap-1"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {showManualPicker
                      ? 'Hide manual spot selector'
                      : 'Prefer to pick your starting spot manually?'}
                  </button>

                  {showManualPicker && (
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80 space-y-2.5">
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          value={manualSearch}
                          onChange={(e) => setManualSearch(e.target.value)}
                          placeholder="Search entrance, ward, department, room..."
                          className="input pl-9 py-2 text-xs"
                        />
                      </div>
                      <div className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 thin-scrollbar">
                        {filteredManualNodes.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => handleManualSelect(n)}
                            className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-left text-xs ring-1 ring-slate-200/70 hover:ring-cyan-500 hover:bg-cyan-50/40 transition"
                          >
                            <div className="truncate pr-2">
                              <div className="font-semibold text-slate-900 truncate">
                                {n.name}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">
                                {n.building_name} · {formatLevel(n.level, n.floor_name)}
                              </div>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* STAGE 2: AI VISION PIPELINE TRACE WITH LASER SCANNER */}
            {stage === 'analyzing' && (
              <div className="rounded-2xl bg-[#070B18] p-5 sm:p-6 text-white ring-1 ring-white/10 space-y-5 shadow-2xl">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {previewUrl && (
                    <div className="relative h-36 w-full sm:w-48 shrink-0 overflow-hidden rounded-2xl ring-2 ring-cyan-400/60 shadow-[0_0_28px_rgba(34,211,238,0.28)]">
                      <img
                        src={mediaUrl(previewUrl)}
                        alt="Uploaded query"
                        className="h-full w-full object-cover hdr-photo"
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-cyan-400/15 via-transparent to-indigo-500/20" />
                      {/* Sweeping AI Laser Scan Beam */}
                      <div className="ai-scan-beam" />
                      {/* Corner Viewfinder Brackets */}
                      <span className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 border-l-2 border-t-2 border-cyan-300" />
                      <span className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 border-r-2 border-t-2 border-cyan-300" />
                      <span className="pointer-events-none absolute left-2 bottom-2 h-3.5 w-3.5 border-l-2 border-b-2 border-cyan-300" />
                      <span className="pointer-events-none absolute right-2 bottom-2 h-3.5 w-3.5 border-r-2 border-b-2 border-cyan-300" />
                      <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-slate-950/80 px-2 py-0.5 text-[9px] font-mono font-bold tracking-wider text-cyan-300">
                        SCANNING KEYPOINTS
                      </span>
                    </div>
                  )}
                  <div className="flex-1 text-center sm:text-left">
                    <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-400/30">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Spatial Vision Pipeline Active
                    </div>
                    <h3 className="mt-2 font-display text-lg font-bold">
                      Matching visual geometry & signboard text...
                    </h3>
                    {result?.engine && (
                      <div className="mt-2 flex flex-wrap justify-center sm:justify-start gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                          <Cpu className="h-3 w-3 text-cyan-400" />
                          Embedder: {result.engine.embedder}
                        </span>
                        {result.engine.ocr && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                            <FileText className="h-3 w-3 text-indigo-400" />
                            OCR: {result.engine.ocr}
                          </span>
                        )}
                        {result.engine.face_blur && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                            <ShieldCheck className="h-3 w-3" />
                            Face Blur Active
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Trace Steps */}
                <div className="space-y-2 border-t border-white/10 pt-4">
                  {result ? (
                    result.trace.map((tr, idx) => {
                      const done = idx < visibleTraceCount;
                      const active = idx === visibleTraceCount;
                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs transition-all ${
                            done
                              ? 'bg-white/[0.07] text-white ring-1 ring-cyan-500/30'
                              : active
                                ? 'bg-white/[0.04] text-slate-300 animate-pulse'
                                : 'bg-white/[0.02] text-slate-500'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {done ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : (
                              <Loader2 className="h-4 w-4 text-cyan-400 animate-spin shrink-0" />
                            )}
                            <div>
                              <span className="font-bold">{tr.step}</span>
                              <span className="ml-2 text-slate-400">{tr.detail}</span>
                            </div>
                          </div>
                          {done && (
                            <span className="font-mono text-[11px] text-cyan-300">
                              {tr.ms.toFixed(0)} ms
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl bg-white/[0.05] px-4 py-3 text-xs text-slate-300">
                      <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                      Uploading image, stripping EXIF metadata, and extracting spatial features...
                    </div>
                  )}
                </div>

                {result && result.ocr_text.length > 0 && visibleTraceCount >= 2 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-slate-400 mr-1">
                      Detected Signboard Text:
                    </span>
                    {result.ocr_text.map((t, i) => (
                      <span
                        key={i}
                        className="rounded-md bg-indigo-500/20 px-2 py-0.5 text-[11px] font-mono text-indigo-200 ring-1 ring-indigo-400/30"
                      >
                        "{t}"
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* STAGE 3A: CONFIDENT RESULT */}
            {showConfidentView && result?.best && (
              <div className="space-y-5">
                {/* Engine & OCR Header Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-emerald-50/90 px-4 py-3 ring-1 ring-emerald-200">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-emerald-950">
                        Location Pinpointed
                      </div>
                      <div className="text-xs text-emerald-700">
                        {result.best.reason}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.best.matched_photo_url && (
                      <div className="inline-flex items-center rounded-xl bg-white p-0.5 ring-1 ring-emerald-200 text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => setCompareMode('side')}
                          className={`rounded-lg px-2 py-1 transition ${
                            compareMode === 'side'
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Side-by-Side
                        </button>
                        <button
                          type="button"
                          onClick={() => setCompareMode('wipe')}
                          className={`rounded-lg px-2 py-1 transition ${
                            compareMode === 'wipe'
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Split-Wipe
                        </button>
                      </div>
                    )}
                    <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm">
                      {Math.round(result.confidence * 100)}% Match
                    </span>
                  </div>
                </div>

                {/* Cinema HDR Comparison Stage: Side-by-Side OR Interactive Split-Wipe */}
                {compareMode === 'wipe' && result.best.matched_photo_url ? (
                  <div className="space-y-2">
                    <div
                      onTouchMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const touch = e.touches[0];
                        if (touch && rect.width > 0) {
                          const pct = Math.max(5, Math.min(95, Math.round(((touch.clientX - rect.left) / rect.width) * 100)));
                          setWipePercent(pct);
                        }
                      }}
                      className="relative h-60 w-full overflow-hidden rounded-2xl bg-slate-950 ring-2 ring-emerald-500/60 shadow-xl select-none"
                    >
                      {/* Base Layer: Matched Venue Reference Photo */}
                      <img
                        src={mediaUrl(result.best.matched_photo_url)}
                        alt={result.best.name}
                        className="h-full w-full object-cover hdr-photo"
                      />

                      {/* Clipped Top Layer: Visitor Uploaded Photo + OCR Boxes */}
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{
                          clipPath: `inset(0 ${100 - wipePercent}% 0 0)`,
                        }}
                      >
                        <img
                          src={
                            result.query_photo_url
                              ? mediaUrl(result.query_photo_url)
                              : previewUrl || ''
                          }
                          alt="Your uploaded photo"
                          className="h-full w-full object-cover hdr-photo"
                        />
                        {showAiOverlay &&
                          ocrBoxes.map((b, i) => (
                            <div
                              key={i}
                              style={{
                                left: `${Math.max(0, Math.min(95, b.x * 100))}%`,
                                top: `${Math.max(0, Math.min(92, b.y * 100))}%`,
                                width: `${Math.max(4, Math.min(100 - b.x * 100, b.w * 100))}%`,
                                height: `${Math.max(6, Math.min(100 - b.y * 100, b.h * 100))}%`,
                              }}
                              className="pointer-events-none absolute rounded border-2 border-cyan-400 bg-cyan-400/15 shadow-[0_0_12px_rgba(34,211,238,0.65)]"
                            >
                              <span
                                className={`absolute left-0 whitespace-nowrap max-w-[140px] truncate rounded bg-cyan-400 px-1 py-0.2 text-[9px] font-extrabold text-slate-950 z-10 ${
                                  b.y < 0.08 ? 'top-1' : '-top-4'
                                }`}
                              >
                                {b.text}
                              </span>
                            </div>
                          ))}
                      </div>

                      {/* Glowing Vertical Wipe Divider */}
                      <div
                        className="pointer-events-none absolute inset-y-0 w-0.5 bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.95)]"
                        style={{ left: `${wipePercent}%` }}
                      >
                        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-[10px] font-extrabold text-cyan-300 ring-2 ring-cyan-400 shadow-lg">
                          ↔
                        </div>
                      </div>

                      <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 ring-1 ring-cyan-400/35 backdrop-blur-md">
                        Your Photo
                      </span>
                      <span className="pointer-events-none absolute right-3 top-3 rounded-lg bg-emerald-600/95 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                        Venue Reference
                      </span>

                      <input
                        type="range"
                        min={5}
                        max={95}
                        value={wipePercent}
                        onChange={(e) => setWipePercent(Number(e.target.value))}
                        aria-label="Slide to compare your photo with matched venue reference"
                        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
                      />
                    </div>
                    <p className="text-center text-[11px] font-medium text-slate-500">
                      Drag left or right across the photo to inspect visual alignment
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-200 shadow-md">
                      <div className="relative h-52 w-full">
                        <img
                          src={
                            result.query_photo_url
                              ? mediaUrl(result.query_photo_url)
                              : previewUrl || ''
                          }
                          alt="Your uploaded photo"
                          className="h-full w-full object-cover hdr-photo"
                        />
                        {/* Glowing OCR Bounding Boxes */}
                        {showAiOverlay &&
                          ocrBoxes.map((b, i) => (
                            <div
                              key={i}
                              style={{
                                left: `${Math.max(0, Math.min(95, b.x * 100))}%`,
                                top: `${Math.max(0, Math.min(92, b.y * 100))}%`,
                                width: `${Math.max(4, Math.min(100 - b.x * 100, b.w * 100))}%`,
                                height: `${Math.max(6, Math.min(100 - b.y * 100, b.h * 100))}%`,
                              }}
                              className="pointer-events-none absolute rounded border-2 border-cyan-400 bg-cyan-400/15 shadow-[0_0_12px_rgba(34,211,238,0.65)]"
                            >
                              <span
                                className={`absolute left-0 whitespace-nowrap max-w-[140px] truncate rounded bg-cyan-400 px-1 py-0.2 text-[9px] font-extrabold text-slate-950 z-10 ${
                                  b.y < 0.08 ? 'top-1' : '-top-4'
                                }`}
                              >
                                {b.text}
                              </span>
                            </div>
                          ))}

                        <span className="absolute left-2.5 top-2.5 rounded-lg bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                          Your Uploaded Photo
                        </span>

                        {ocrBoxes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowAiOverlay((v) => !v)}
                            className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-lg bg-slate-950/80 px-2 py-1 text-[10px] font-bold text-cyan-300 ring-1 ring-cyan-400/40 backdrop-blur-md hover:bg-slate-900"
                          >
                            <ScanText className="h-3 w-3" />
                            {showAiOverlay ? 'Hide AI Boxes' : `Show ${ocrBoxes.length} OCR Boxes`}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl bg-slate-900 ring-2 ring-emerald-500/65 shadow-[0_10px_28px_-8px_rgba(16,185,129,0.28)]">
                      <div className="relative h-52 w-full flex items-center justify-center">
                        {result.best.matched_photo_url ? (
                          <img
                            src={mediaUrl(result.best.matched_photo_url)}
                            alt={result.best.name}
                            className="h-full w-full object-cover hdr-photo"
                          />
                        ) : (
                          <div className="text-center text-slate-400 p-4">
                            <ImageIcon className="h-8 w-8 mx-auto mb-1 opacity-50" />
                            <span className="text-xs">Matched via Signboard OCR</span>
                          </div>
                        )}
                        <span className="absolute left-2.5 top-2.5 rounded-lg bg-emerald-600/95 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                          Matched Venue Reference
                        </span>
                        {formatHeadingLabel(result.best.matched_heading_deg) && (
                          <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-lg bg-slate-950/80 px-2 py-1 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30 backdrop-blur-md">
                            <Compass className="h-3 w-3" />
                            Facing {formatHeadingLabel(result.best.matched_heading_deg)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Matched Spot Details + Visual vs OCR Breakdown */}
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/80 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                        {result.best.building_name} ·{' '}
                        {formatLevel(result.best.level, result.best.floor_name)}
                      </div>
                      <h3 className="font-display text-xl font-extrabold text-slate-900 mt-0.5">
                        {result.best.name}
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="chip bg-slate-200/80 text-slate-700">
                        {result.engine.embedder}
                      </span>
                      {result.engine.face_blur && (
                        <span className="chip bg-emerald-100 text-emerald-800">
                          <ShieldCheck className="h-3 w-3" />
                          {result.faces_blurred && result.faces_blurred > 0
                            ? `${result.faces_blurred} Face${result.faces_blurred > 1 ? 's' : ''} Blurred`
                            : 'Privacy Protected'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3.5 w-3.5 text-cyan-600" /> Visual Embedding Similarity
                        </span>
                        <span className="font-bold text-slate-900">
                          {Math.round(result.best.visual * 100)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-600"
                          style={{ width: `${Math.round(result.best.visual * 100)}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5 text-indigo-600" /> Signboard OCR Boost
                        </span>
                        <span className="font-bold text-slate-900">
                          {Math.round(result.best.text * 100)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600"
                          style={{ width: `${Math.round(result.best.text * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {result.ocr_text.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs text-slate-500">Signboards read:</span>
                      {result.ocr_text.map((txt, idx) => (
                        <span
                          key={idx}
                          className="rounded-md bg-white px-2 py-0.5 text-xs font-mono text-slate-700 ring-1 ring-slate-200"
                        >
                          {txt}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Share My Spot ("Meet Me Here" Handoff) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-3">
                    <span className="text-xs font-semibold text-slate-600">
                      Meeting family or colleagues? Share your pinpointed spot:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => result.best && void handleShareSpot(result.best, false)}
                        className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 transition"
                      >
                        {copiedMeetLink ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            Link Copied!
                          </>
                        ) : (
                          <>
                            <Share2 className="h-3.5 w-3.5 text-indigo-600" />
                            Copy Meet Link
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => result.best && void handleShareSpot(result.best, true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition"
                      >
                        WhatsApp
                      </button>
                    </div>
                  </div>
                </div>

                {/* Active Learning Self-Growing Dataset Toggle */}
                <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-xl bg-indigo-50/70 px-3.5 py-2.5 ring-1 ring-indigo-200/80">
                  <input
                    type="checkbox"
                    checked={contribute}
                    onChange={(e) => setContribute(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="text-xs text-slate-700">
                    <span className="font-bold text-indigo-950">
                      🧠 Active Learning Self-Growing Dataset:
                    </span>{' '}
                    Auto-promote this face-blurred photo if it adds a new sharp angle (auto-deduplicated at 92% similarity & capped at 8 photos/node).
                  </div>
                </label>

                {/* Primary & Secondary Actions */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCandidatesOverride(true)}
                      className="btn-ghost text-xs py-2.5"
                    >
                      Show other possibilities
                    </button>
                    <button
                      type="button"
                      onClick={resetToUpload}
                      className="btn-ghost text-xs py-2.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      New Photo
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={confirmingNodeId !== null}
                    onClick={() => result.best && void handleConfirmCandidate(result.best)}
                    className="btn-primary py-3 px-6 text-sm shadow-lg shadow-cyan-500/20"
                  >
                    {confirmingNodeId === result.best.node_id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Yes, I'm standing here
                  </button>
                </div>
              </div>
            )}

            {/* STAGE 3B: UNCERTAIN / TOP-3 CANDIDATES */}
            {showCandidatesView && result && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold text-slate-900">
                      Are you standing at one of these spots?
                    </h3>
                    <p className="text-xs text-slate-500">
                      Tap the matching reference view below to lock your starting point.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetToUpload}
                    className="btn-ghost text-xs py-2"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retake Photo
                  </button>
                </div>

                <div className="flex sm:grid overflow-x-auto sm:overflow-x-visible no-scrollbar sm:grid-cols-3 gap-3.5 snap-x snap-mandatory pb-1">
                  {result.candidates.map((cand, i) => (
                    <div
                      key={cand.node_id}
                      className="min-w-[82%] sm:min-w-0 snap-center shrink-0 sm:shrink flex flex-col justify-between overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 hover:ring-2 hover:ring-cyan-500 transition shadow-sm"
                    >
                      <div>
                        <div className="relative h-36 w-full bg-slate-900">
                          {cand.matched_photo_url ? (
                            <img
                              src={mediaUrl(cand.matched_photo_url)}
                              alt={cand.name}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-500 text-xs">
                              No preview photo
                            </div>
                          )}
                          <span className="absolute left-2 top-2 z-10 rounded-md bg-slate-950/85 px-2 py-0.5 text-[11px] font-bold text-cyan-300 ring-1 ring-white/10">
                            #{i + 1} · {Math.round(cand.score * 100)}% Match
                          </span>
                        </div>
                        <div className="p-3.5 space-y-1.5">
                          <div className="text-[11px] font-semibold text-indigo-600 truncate">
                            {cand.building_name} ·{' '}
                            {formatLevel(cand.level, cand.floor_name)}
                          </div>
                          <div className="font-display text-sm font-bold text-slate-900 truncate">
                            {cand.name}
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-2">
                            {cand.reason}
                          </p>
                        </div>
                      </div>

                      <div className="p-3 pt-0">
                        <button
                          type="button"
                          disabled={confirmingNodeId !== null}
                          onClick={() => void handleConfirmCandidate(cand)}
                          className="w-full btn-indigo py-2.5 text-xs font-bold"
                        >
                          {confirmingNodeId === cand.node_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          I'm Here
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STAGE 3C: NO MATCH */}
            {showNoMatchView && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200 text-center space-y-2">
                  <AlertTriangle className="h-8 w-8 text-amber-600 mx-auto" />
                  <h3 className="font-display text-base font-bold text-amber-950">
                    We couldn't confidently match that angle
                  </h3>
                  <p className="text-xs text-amber-800 max-w-md mx-auto">
                    Try capturing a nearby room signboard, corridor intersection, or reception desk — or pick your starting spot below.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={resetToUpload}
                      className="btn-primary text-xs py-2.5"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Try Another Photo
                    </button>
                  </div>
                </div>

                {/* Manual Selector right inline */}
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 space-y-2.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Or Select Starting Spot Manually
                  </div>
                  <input
                    type="text"
                    value={manualSearch}
                    onChange={(e) => setManualSearch(e.target.value)}
                    placeholder="Filter rooms, gates, clinics, labs..."
                    className="input text-xs py-2"
                  />
                  <div className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 thin-scrollbar">
                    {filteredManualNodes.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => handleManualSelect(n)}
                        className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-left text-xs ring-1 ring-slate-200 hover:ring-cyan-500"
                      >
                        <div className="truncate pr-2">
                          <div className="font-semibold text-slate-900 truncate">
                            {n.name}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {n.building_name} · {formatLevel(n.level, n.floor_name)}
                          </div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

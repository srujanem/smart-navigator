import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Search,
  Trash2,
  Upload,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import {
  deleteAdminPhoto,
  downloadUpdatedStaticBundle,
  getAdminDataset,
  getVenue,
  mediaUrl,
  updateAdminPhoto,
  uploadAdminPhotos,
} from '../../lib/api';
import { isVideoFile } from '../../lib/panorama360';
import { formatLevel } from '../../lib/locationStore';
import { Camera360CaptureModal } from '../../components/Camera360CaptureModal';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type { DatasetNode, DatasetResponse, VenueDetail } from '../../lib/types';

interface StagedUploadItem {
  id: string;
  nodeId: string;
  roomName: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
}

interface UploadProgressState {
  active: boolean;
  done: boolean;
  percent: number;
  stageText: string;
  currentIndex: number;
  totalItems: number;
  succeeded: number;
  errors: string[];
  lastRoomId: string | null;
}

export const AdminDatasetPage: React.FC = () => {
  const { selectedSlug } = useAdminVenue();

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [dataset, setDataset] = useState<DatasetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Simple Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'missing' | 'mapped'>('all');
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const [show360Tip, setShow360Tip] = useState(false);

  // Full-Screen Camera Modal Target Room
  const [cameraRoom, setCameraRoom] = useState<DatasetNode | null>(null);

  // =========================================================================
  // STAGED DRAFT QUEUE (Make all changes first -> Tap "Upload & Save Changes")
  // =========================================================================
  const [stagedUploads, setStagedUploads] = useState<StagedUploadItem[]>([]);
  const [stagedMoves, setStagedMoves] = useState<Record<string, string>>({});
  const [stagedDeletes, setStagedDeletes] = useState<string[]>([]);

  // Live 0% -> 100% Upload Progress Modal State
  const [progressState, setProgressState] = useState<UploadProgressState | null>(null);

  const loadData = useCallback(
    async (silent = false) => {
      if (!selectedSlug) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [v, ds] = await Promise.all([
          getVenue(selectedSlug),
          getAdminDataset(selectedSlug),
        ]);
        setVenue(v);
        setDataset(ds);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load venue rooms.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedSlug],
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  // Cleanup staged object URLs when unmounting
  useEffect(() => {
    return () => {
      stagedUploads.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFilesToQueue = (room: DatasetNode, fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const newItems: StagedUploadItem[] = incoming.map((file) => {
      const vid = isVideoFile(file);
      return {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        nodeId: room.node_id,
        roomName: room.name,
        file,
        previewUrl: vid ? '' : URL.createObjectURL(file),
        isVideo: vid,
      };
    });

    setStagedUploads((prev) => [...prev, ...newItems]);
  };

  const removeStagedUpload = (id: string) => {
    setStagedUploads((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const toggleStagedDelete = (photoId: string) => {
    setStagedDeletes((prev) =>
      prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId],
    );
  };

  const stageMovePhoto = (photoId: string, originalNodeId: string, nextNodeId: string) => {
    setStagedMoves((prev) => {
      const copy = { ...prev };
      if (nextNodeId === originalNodeId) {
        delete copy[photoId];
      } else {
        copy[photoId] = nextNodeId;
      }
      return copy;
    });
  };

  const discardAllChanges = () => {
    stagedUploads.forEach((it) => {
      if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    });
    setStagedUploads([]);
    setStagedMoves({});
    setStagedDeletes([]);
  };

  const pendingMoveCount = Object.keys(stagedMoves).length;
  const totalPendingChanges =
    stagedUploads.length + pendingMoveCount + stagedDeletes.length;

  // =========================================================================
  // EXECUTE ALL STAGED CHANGES WITH LIVE 0% -> 100% PROGRESS BAR
  // =========================================================================
  const handleUploadAndSaveAll = async () => {
    if (!selectedSlug || totalPendingChanges === 0) return;

    const uploadsSnapshot = [...stagedUploads];
    const movesEntries = Object.entries(stagedMoves);
    const deletesSnapshot = [...stagedDeletes];
    const totalOps = uploadsSnapshot.length + movesEntries.length + deletesSnapshot.length;

    let completedOps = 0;
    let succeeded = 0;
    const errors: string[] = [];
    let lastRoomId: string | null = uploadsSnapshot[0]?.nodeId ?? null;

    setProgressState({
      active: true,
      done: false,
      percent: 2,
      stageText: 'Starting upload...',
      currentIndex: 1,
      totalItems: totalOps,
      succeeded: 0,
      errors: [],
      lastRoomId,
    });

    // 1. Upload all staged photos & 360° spin videos with live sub-file % progress
    for (let i = 0; i < uploadsSnapshot.length; i++) {
      const item = uploadsSnapshot[i];
      lastRoomId = item.nodeId;
      const basePct = Math.round((completedOps / totalOps) * 95);
      const spanPct = Math.max(1, Math.round(95 / totalOps));

      setProgressState((prev) =>
        prev
          ? {
              ...prev,
              currentIndex: completedOps + 1,
              percent: Math.max(prev.percent, basePct + 2),
              stageText: item.isVideo
                ? `Stitching 360° video for ${item.roomName}...`
                : `Uploading photo for ${item.roomName}...`,
              lastRoomId,
            }
          : prev,
      );

      try {
        const res = await uploadAdminPhotos(
          selectedSlug,
          item.nodeId,
          [item.file],
          null,
          true,
          (subPct, subStage) => {
            const overall = Math.min(96, basePct + Math.round((subPct / 100) * spanPct));
            setProgressState((prev) =>
              prev
                ? {
                    ...prev,
                    percent: Math.max(prev.percent, overall),
                    stageText: subStage,
                  }
                : prev,
            );
          },
        );

        if (res.accepted.length > 0) {
          succeeded += res.accepted.length;
        }
        if (res.rejected.length > 0) {
          res.rejected.forEach((r) => errors.push(`${item.roomName}: ${r.reason}`));
        }
      } catch (err) {
        errors.push(
          `${item.roomName}: ${err instanceof Error ? err.message : 'Upload failed.'}`,
        );
      }

      completedOps++;
    }

    // 2. Apply any photo room reassignments
    for (const [photoId, targetNodeId] of movesEntries) {
      const pct = Math.min(97, Math.round((completedOps / totalOps) * 95) + 2);
      setProgressState((prev) =>
        prev
          ? {
              ...prev,
              currentIndex: completedOps + 1,
              percent: Math.max(prev.percent, pct),
              stageText: 'Moving photo to new room...',
            }
          : prev,
      );
      try {
        await updateAdminPhoto(photoId, { node_id: targetNodeId });
        succeeded++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Could not move photo.');
      }
      completedOps++;
    }

    // 3. Apply any photo deletions
    for (const photoId of deletesSnapshot) {
      const pct = Math.min(98, Math.round((completedOps / totalOps) * 95) + 2);
      setProgressState((prev) =>
        prev
          ? {
              ...prev,
              currentIndex: completedOps + 1,
              percent: Math.max(prev.percent, pct),
              stageText: 'Removing deleted photo...',
            }
          : prev,
      );
      try {
        await deleteAdminPhoto(photoId);
        succeeded++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Could not delete photo.');
      }
      completedOps++;
    }

    // 4. Refresh dataset smoothly IN PLACE (no blank loading screen!)
    setProgressState((prev) =>
      prev
        ? {
            ...prev,
            percent: 99,
            stageText: 'Updating live Street View & room cards...',
          }
        : prev,
    );

    discardAllChanges();
    await loadData(true);

    setProgressState({
      active: true,
      done: true,
      percent: 100,
      stageText:
        errors.length === 0
          ? `All ${succeeded} change${succeeded === 1 ? '' : 's'} uploaded & live!`
          : `Finished: ${succeeded} saved, ${errors.length} failed.`,
      currentIndex: totalOps,
      totalItems: totalOps,
      succeeded,
      errors,
      lastRoomId,
    });
  };

  const filteredRooms = useMemo(() => {
    if (!dataset) return [];
    const q = searchQuery.trim().toLowerCase();
    return dataset.nodes.filter((rm) => {
      const stagedCount = stagedUploads.filter((s) => s.nodeId === rm.node_id).length;
      const hasAny = rm.photo_count > 0 || stagedCount > 0;
      if (filterMode === 'missing' && hasAny) return false;
      if (filterMode === 'mapped' && !hasAny) return false;
      if (!q) return true;
      return (
        rm.name.toLowerCase().includes(q) ||
        rm.building_name.toLowerCase().includes(q) ||
        formatLevel(rm.level).toLowerCase().includes(q)
      );
    });
  }, [dataset, searchQuery, filterMode, stagedUploads]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm font-semibold text-slate-500">Loading rooms...</p>
      </div>
    );
  }

  if (error || !dataset || !venue) {
    return <ErrorState message={error || 'Rooms unavailable.'} onRetry={() => void loadData(false)} />;
  }

  const entranceNode =
    dataset.nodes.find((n) => n.name.toLowerCase().includes('entrance')) ?? dataset.nodes[0];

  return (
    <div className={`max-w-5xl mx-auto space-y-4 ${totalPendingChanges > 0 ? 'pb-28' : 'pb-10'}`}>
      {/* ================================================================= */}
      {/* 1. CLEAN, SIMPLE HEADER (ZERO USELESS JARGON)                     */}
      {/* ================================================================= */}
      <div className="rounded-3xl bg-slate-950 p-4 sm:p-5 text-white ring-1 ring-white/15 shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-extrabold text-white">
              Room Photos &amp; 360° Uploader
            </h1>
            <p className="text-xs text-slate-300 mt-0.5">
              <strong>{venue.name}</strong> ·{' '}
              <span className="text-emerald-300 font-bold">
                {dataset.totals.covered} of {dataset.totals.nodes} rooms mapped
              </span>{' '}
              ({dataset.totals.photos} total photos)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/v/${encodeURIComponent(selectedSlug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 shadow hover:bg-emerald-400 transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>View Live Map</span>
            </a>
            <button
              type="button"
              onClick={() => void downloadUpdatedStaticBundle()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-100 ring-1 ring-white/15 hover:bg-white/15 transition"
              title="Download backup bundle file with your uploaded photos"
            >
              <HardDrive className="h-3.5 w-3.5 text-cyan-300" />
              <span>Export Backup</span>
            </button>
          </div>
        </div>

        {/* Simple 3-Step Visual Hint */}
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/[0.06] p-2.5 text-center text-[11px] font-bold text-slate-200 ring-1 ring-white/10">
          <div>
            <span className="text-cyan-300">1.</span> Pick Room
          </div>
          <div>
            <span className="text-emerald-300">2.</span> Camera / 360° Video
          </div>
          <div>
            <span className="text-amber-300">3.</span> Tap Upload
          </div>
        </div>

        {/* Collapsible 360° Full-View Guide */}
        <div className="rounded-2xl bg-cyan-500/10 ring-1 ring-cyan-400/30 overflow-hidden">
          <button
            type="button"
            onClick={() => setShow360Tip((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-extrabold text-cyan-200"
          >
            <span>🌐 Want full 360° view on a normal phone? (Tap for 2 easy ways)</span>
            {show360Tip ? (
              <ChevronUp className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" />
            )}
          </button>
          {show360Tip && (
            <div className="px-3.5 pb-3 text-xs text-slate-200 space-y-1.5 border-t border-cyan-400/20 pt-2">
              <p>
                <strong>Option A (Best — 360° Spin Video):</strong> Tap{' '}
                <strong className="text-emerald-300">📷 Camera / 360°</strong> on any room, switch to{' '}
                <strong className="text-rose-300">🌐 360° Video</strong>, and slowly spin in a full
                circle (6–10 sec). When you tap Upload, we automatically stitch it into a seamless
                360° panorama!
              </p>
              <p>
                <strong>Option B (Phone Panorama Mode):</strong> Take a wide{' '}
                <strong>Panorama ("Pano")</strong> photo in your phone&apos;s camera app and pick it
                via <strong className="text-cyan-300">🖼️ Gallery / Video</strong>. Street View
                wraps wide panoramas 360° automatically!
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* 2. SIMPLE SEARCH & FILTER BAR                                     */}
      {/* ================================================================= */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search room (e.g. Room 308, Entrance)..."
            className="w-full rounded-2xl bg-white pl-10 pr-4 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 rounded-2xl bg-white p-1 ring-1 ring-slate-200 shadow-sm">
          {(
            [
              { id: 'all', label: `All (${dataset.nodes.length})` },
              {
                id: 'missing',
                label: `Needs Photo (${dataset.nodes.length - dataset.totals.covered})`,
              },
              { id: 'mapped', label: `Mapped (${dataset.totals.covered})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`flex-1 sm:flex-none rounded-xl px-3 py-1.5 text-xs font-extrabold whitespace-nowrap transition ${
                filterMode === tab.id
                  ? 'bg-slate-900 text-white shadow'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ================================================================= */}
      {/* 3. CLEAN ROOM-BY-ROOM CARDS (DIRECT CAMERA + GALLERY + QUEUE)     */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredRooms.map((rm) => {
          const roomStaged = stagedUploads.filter((s) => s.nodeId === rm.node_id);
          const visibleExisting = rm.photos.filter((p) => !stagedDeletes.includes(p.id));
          const latestSaved = visibleExisting[0] ?? null;
          const latestStaged = roomStaged[roomStaged.length - 1] ?? null;
          const isExpanded = expandedRoomId === rm.node_id;

          return (
            <div
              key={rm.node_id}
              className={`rounded-3xl bg-white p-3.5 shadow-sm transition flex flex-col justify-between gap-3 ${
                roomStaged.length > 0
                  ? 'ring-2 ring-amber-400 shadow-amber-100'
                  : 'ring-1 ring-slate-200'
              }`}
            >
              {/* Room Title + Status Badge */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-extrabold text-slate-950 truncate">
                    {rm.name}
                  </h2>
                  <p className="text-[11px] font-semibold text-slate-500 truncate">
                    {rm.building_name} · {formatLevel(rm.level)}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                      visibleExisting.length > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {visibleExisting.length > 0
                      ? `${visibleExisting.length} Saved ✓`
                      : 'Needs Photo'}
                  </span>
                  {roomStaged.length > 0 && (
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold text-slate-950">
                      +{roomStaged.length} Ready to Upload
                    </span>
                  )}
                </div>
              </div>

              {/* Main Un-Cropped Preview (Shows Staged Photo First if Added!) */}
              <div className="relative h-36 w-full overflow-hidden rounded-2xl bg-slate-950 flex items-center justify-center">
                {latestStaged ? (
                  latestStaged.isVideo ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 text-center px-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 ring-1 ring-rose-400/40">
                        <Video className="h-6 w-6" />
                      </div>
                      <span className="text-xs font-extrabold text-white">
                        🌐 360° Spin Video Staged
                      </span>
                      <span className="text-[10px] text-amber-300 font-semibold">
                        Will stitch to 360° panorama on Upload
                      </span>
                    </div>
                  ) : (
                    <img
                      src={latestStaged.previewUrl}
                      alt={rm.name}
                      className="h-full w-full object-contain"
                    />
                  )
                ) : latestSaved ? (
                  <img
                    src={mediaUrl(latestSaved.thumbnail_url || latestSaved.url)}
                    alt={rm.name}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="text-center px-4 text-xs font-semibold text-slate-400">
                    No photo yet — tap Camera or Gallery below
                  </div>
                )}

                {latestStaged && (
                  <span className="absolute top-2 left-2 rounded-lg bg-amber-400 px-2 py-0.5 text-[10px] font-black text-slate-950 shadow">
                    NEW · NOT UPLOADED YET
                  </span>
                )}
                {!latestStaged && latestSaved?.ocr_text === '360° Panorama' && (
                  <span className="absolute top-2 left-2 rounded-lg bg-cyan-400 px-2 py-0.5 text-[10px] font-black text-slate-950 shadow">
                    🌐 360° PANO
                  </span>
                )}
              </div>

              {/* Staged Queue Mini-Strip for This Room (with easy Remove X) */}
              {roomStaged.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {roomStaged.map((st) => (
                    <div
                      key={st.id}
                      className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-900 ring-2 ring-amber-400 flex items-center justify-center"
                    >
                      {st.isVideo ? (
                        <Video className="h-5 w-5 text-rose-400" />
                      ) : (
                        <img src={st.previewUrl} alt="" className="h-full w-full object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeStagedUpload(st.id)}
                        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white shadow"
                        title="Remove from upload queue"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Primary Action Buttons: Full-Screen Camera/360° + Gallery/Video */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCameraRoom(rm)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-3 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-500 active:scale-95 transition"
                >
                  <Camera className="h-4 w-4 shrink-0" />
                  <span>Camera / 360°</span>
                </button>

                <label className="cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 px-3 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition">
                  <ImageIcon className="h-4 w-4 shrink-0" />
                  <span>Gallery / Video</span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        addFilesToQueue(rm, e.target.files);
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              {/* Manage Saved Photos (Expandable Drawer — Keeps Main Card Clean!) */}
              {rm.photos.length > 0 && (
                <div className="pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setExpandedRoomId(isExpanded ? null : rm.node_id)}
                    className="w-full flex items-center justify-between text-[11px] font-bold text-slate-600 hover:text-slate-950 py-1"
                  >
                    <span>Manage Saved Photos ({rm.photos.length})</span>
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="mt-2 space-y-2">
                      {rm.photos.map((ph) => {
                        const markedDelete = stagedDeletes.includes(ph.id);
                        const movedTarget = stagedMoves[ph.id] ?? rm.node_id;
                        return (
                          <div
                            key={ph.id}
                            className={`flex items-center gap-2 rounded-xl p-2 ring-1 ${
                              markedDelete
                                ? 'bg-rose-50 ring-rose-300 opacity-65'
                                : movedTarget !== rm.node_id
                                  ? 'bg-amber-50 ring-amber-300'
                                  : 'bg-slate-50 ring-slate-200'
                            }`}
                          >
                            <img
                              src={mediaUrl(ph.thumbnail_url || ph.url)}
                              alt=""
                              className="h-12 w-12 shrink-0 rounded-lg bg-slate-900 object-contain"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <select
                                disabled={markedDelete}
                                value={movedTarget}
                                onChange={(e) =>
                                  stageMovePhoto(ph.id, rm.node_id, e.target.value)
                                }
                                className="w-full rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-800 ring-1 ring-slate-200"
                              >
                                {dataset.nodes.map((nd) => (
                                  <option key={nd.node_id} value={nd.node_id}>
                                    📍 {nd.name}
                                  </option>
                                ))}
                              </select>
                              {markedDelete && (
                                <span className="text-[10px] font-extrabold text-rose-700">
                                  Marked for delete (tap Upload to confirm)
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleStagedDelete(ph.id)}
                              className={`rounded-lg p-2 transition ${
                                markedDelete
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-white text-slate-500 hover:text-rose-600 ring-1 ring-slate-200'
                              }`}
                              title={markedDelete ? 'Undo delete' : 'Mark photo for deletion'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ================================================================= */}
      {/* 4. STICKY BOTTOM "UPLOAD & SAVE ALL CHANGES" ACTION BAR           */}
      {/* ================================================================= */}
      {totalPendingChanges > 0 && !progressState?.active && (
        <div className="fixed bottom-3 inset-x-3 sm:inset-x-auto sm:right-6 sm:left-64 z-40 flex justify-center pointer-events-none">
          <div className="pointer-events-auto w-full max-w-xl rounded-2xl bg-slate-950 p-3 text-white ring-2 ring-emerald-400 shadow-2xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-extrabold text-white truncate">
                {totalPendingChanges} Pending Change{totalPendingChanges === 1 ? '' : 's'} Ready
              </div>
              <div className="text-[11px] text-slate-300 truncate">
                {[
                  stagedUploads.length > 0 ? `${stagedUploads.length} new media` : '',
                  pendingMoveCount > 0 ? `${pendingMoveCount} moved` : '',
                  stagedDeletes.length > 0 ? `${stagedDeletes.length} deleted` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={discardAllChanges}
                className="rounded-xl bg-white/10 px-3 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUploadAndSaveAll()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2.5 text-xs sm:text-sm font-black text-slate-950 shadow-lg hover:brightness-105 active:scale-95 transition"
              >
                <Upload className="h-4 w-4 stroke-[2.5]" />
                <span>Upload &amp; Save</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 5. LIVE 0% -> 100% UPLOAD PROGRESS MODAL                          */}
      {/* ================================================================= */}
      {progressState?.active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-2xl ring-1 ring-slate-200 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {progressState.done ? (
                  progressState.errors.length === 0 ? (
                    <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                  ) : (
                    <XCircle className="h-7 w-7 text-amber-500" />
                  )
                ) : (
                  <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
                )}
                <div>
                  <h3 className="font-display text-lg font-extrabold text-slate-950">
                    {progressState.done ? 'Upload Complete!' : 'Uploading Changes...'}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500">
                    Item {progressState.currentIndex} of {progressState.totalItems}
                  </p>
                </div>
              </div>

              <span className="font-display text-2xl font-black text-indigo-600">
                {progressState.percent}%
              </span>
            </div>

            {/* Live Percentage Bar */}
            <div className="space-y-2">
              <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    progressState.done
                      ? 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                      : 'bg-gradient-to-r from-indigo-600 via-cyan-500 to-emerald-400'
                  }`}
                  style={{ width: `${progressState.percent}%` }}
                />
              </div>
              <p className="text-xs font-bold text-slate-700 text-center">
                {progressState.stageText}
              </p>
            </div>

            {progressState.errors.length > 0 && (
              <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-800 ring-1 ring-rose-200 space-y-1 max-h-32 overflow-y-auto">
                {progressState.errors.map((errMsg, idx) => (
                  <div key={idx} className="font-semibold">
                    • {errMsg}
                  </div>
                ))}
              </div>
            )}

            {progressState.done && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {progressState.lastRoomId && entranceNode && (
                  <a
                    href={`/v/${encodeURIComponent(selectedSlug)}/route?from=${encodeURIComponent(
                      entranceNode.node_id,
                    )}&to=${encodeURIComponent(progressState.lastRoomId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-extrabold text-white shadow hover:bg-emerald-500 transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>See in Street View</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setProgressState(null)}
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-xs font-extrabold text-white hover:bg-slate-800 transition"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 6. FULL-SCREEN 100% EDGE-TO-EDGE PHONE CAMERA & 360° RECORDER     */}
      {/* ================================================================= */}
      <Camera360CaptureModal
        open={cameraRoom !== null}
        onClose={() => setCameraRoom(null)}
        venueName={venue.name}
        targetLabel={cameraRoom ? `${cameraRoom.name} (${formatLevel(cameraRoom.level)})` : ''}
        onSubmitFrames={(files) => {
          if (cameraRoom && files.length > 0) {
            addFilesToQueue(cameraRoom, files);
          }
          setCameraRoom(null);
        }}
      />
    </div>
  );
};

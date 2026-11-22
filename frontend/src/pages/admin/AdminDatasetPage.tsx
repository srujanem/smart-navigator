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
  Plus,
  Search,
  Trash2,
  Upload,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import {
  createAdminNode,
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

  // "+ Add Room" Quick Inline Modal
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [addingRoom, setAddingRoom] = useState(false);

  // Full-Screen Camera Modal Target Room
  const [cameraRoom, setCameraRoom] = useState<DatasetNode | null>(null);

  // Immediate Gallery Preview & Confirm Modal (so user NEVER wonders where their picked photo/video went!)
  const [galleryConfirm, setGalleryConfirm] = useState<{
    room: DatasetNode;
    items: StagedUploadItem[];
  } | null>(null);

  // Staged Queue for Multi-Room Batch Uploads / Moves / Deletes
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
        setError(err instanceof Error ? err.message : 'Unable to load rooms.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedSlug],
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const buildStagedItems = (room: DatasetNode, fileList: FileList | File[]): StagedUploadItem[] => {
    return Array.from(fileList).map((file) => {
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
  // CORE UPLOAD EXECUTOR WITH LIVE 0% -> 100% PROGRESS BAR
  // =========================================================================
  const runUploadBatch = async (
    uploadsToRun: StagedUploadItem[],
    movesToRun: [string, string][] = [],
    deletesToRun: string[] = [],
    clearQueueAfter = false,
  ) => {
    if (!selectedSlug) return;
    const totalOps = uploadsToRun.length + movesToRun.length + deletesToRun.length;
    if (totalOps === 0) return;

    let completedOps = 0;
    let succeeded = 0;
    const errors: string[] = [];
    let lastRoomId: string | null = uploadsToRun[0]?.nodeId ?? null;

    setProgressState({
      active: true,
      done: false,
      percent: 4,
      stageText: 'Starting upload...',
      currentIndex: 1,
      totalItems: totalOps,
      succeeded: 0,
      errors: [],
      lastRoomId,
    });

    // 1. Upload photos & 360° videos with live percentage progress
    for (let i = 0; i < uploadsToRun.length; i++) {
      const item = uploadsToRun[i];
      lastRoomId = item.nodeId;
      const basePct = Math.round((completedOps / totalOps) * 94);
      const spanPct = Math.max(4, Math.round(94 / totalOps));

      setProgressState((prev) =>
        prev
          ? {
              ...prev,
              currentIndex: completedOps + 1,
              percent: Math.max(prev.percent, basePct + 3),
              stageText: item.isVideo
                ? `Converting 360° video for ${item.roomName}...`
                : `Uploading to ${item.roomName}...`,
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

        if (res.accepted.length > 0) succeeded += res.accepted.length;
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

    // 2. Apply moves
    for (const [photoId, targetNodeId] of movesToRun) {
      const pct = Math.min(97, Math.round((completedOps / totalOps) * 94) + 3);
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

    // 3. Apply deletes
    for (const photoId of deletesToRun) {
      const pct = Math.min(98, Math.round((completedOps / totalOps) * 94) + 3);
      setProgressState((prev) =>
        prev
          ? {
              ...prev,
              currentIndex: completedOps + 1,
              percent: Math.max(prev.percent, pct),
              stageText: 'Deleting photo...',
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

    setProgressState((prev) =>
      prev
        ? {
            ...prev,
            percent: 99,
            stageText: 'Updating live map...',
          }
        : prev,
    );

    if (clearQueueAfter) {
      discardAllChanges();
    } else {
      uploadsToRun.forEach((it) => {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      });
    }

    await loadData(true);

    setProgressState({
      active: true,
      done: true,
      percent: 100,
      stageText:
        errors.length === 0
          ? `Successfully uploaded ${succeeded} item${succeeded === 1 ? '' : 's'}!`
          : `Saved ${succeeded}, failed ${errors.length}.`,
      currentIndex: totalOps,
      totalItems: totalOps,
      succeeded,
      errors,
      lastRoomId,
    });
  };

  const handleQuickAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !venue || !newRoomName.trim()) return;
    setAddingRoom(true);
    try {
      const bldg = venue.buildings[0];
      const flr = bldg?.floors[0];
      const existingCount = dataset?.nodes.length ?? 0;
      await createAdminNode(selectedSlug, {
        name: newRoomName.trim(),
        kind: 'room',
        category: 'classroom',
        building_id: bldg?.id || `${selectedSlug}:main`,
        floor_id: flr?.id || `${selectedSlug}:f0`,
        x: 20 + (existingCount % 6) * 12,
        y: 25 + Math.floor(existingCount / 6) * 14,
        is_place: true,
      });
      setNewRoomName('');
      setAddRoomOpen(false);
      await loadData(true);
    } finally {
      setAddingRoom(false);
    }
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
    <div className={`space-y-4 ${totalPendingChanges > 0 ? 'pb-28' : 'pb-10'}`}>
      {/* ================================================================= */}
      {/* 1. SUPER SIMPLE TOP ACTION STRIP (ZERO USELESS INFO!)             */}
      {/* ================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl bg-white p-3.5 ring-1 ring-slate-200 shadow-sm">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-extrabold text-slate-950">
            {venue.name} — Room Photos
          </h1>
          <p className="text-xs font-semibold text-slate-500">
            <span className="text-emerald-700 font-extrabold">
              {dataset.totals.covered} of {dataset.totals.nodes} rooms
            </span>{' '}
            have photos · Tap <strong>Camera / 360°</strong> or <strong>Gallery</strong> on any room
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAddRoomOpen(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-extrabold text-white shadow hover:bg-indigo-500 active:scale-95 transition"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>Add Room</span>
          </button>

          <button
            type="button"
            onClick={() => void downloadUpdatedStaticBundle()}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200 transition"
            title="Download backup file with your uploaded photos"
          >
            <HardDrive className="h-3.5 w-3.5 text-indigo-600" />
            <span>Backup</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 2. SEARCH + SIMPLE 3-TAB FILTER                                   */}
      {/* ================================================================= */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find room (e.g. Room 308, Entrance)..."
            className="w-full rounded-2xl bg-white pl-10 pr-4 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200 shadow-sm">
          {(
            [
              { id: 'all', label: `All (${dataset.nodes.length})` },
              {
                id: 'missing',
                label: `Needs Photo (${dataset.nodes.length - dataset.totals.covered})`,
              },
              { id: 'mapped', label: `Done (${dataset.totals.covered})` },
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
      {/* 3. CLEAN ROOM CARDS                                               */}
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
                  ? 'ring-2 ring-amber-400'
                  : 'ring-1 ring-slate-200'
              }`}
            >
              {/* Title + Status */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-extrabold text-slate-950 truncate">
                    {rm.name}
                  </h2>
                  <p className="text-[11px] font-semibold text-slate-500 truncate">
                    {formatLevel(rm.level)}
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
                      +{roomStaged.length} Queued
                    </span>
                  )}
                </div>
              </div>

              {/* Photo / 360° Preview */}
              <div className="relative h-36 w-full overflow-hidden rounded-2xl bg-slate-950 flex items-center justify-center">
                {latestStaged ? (
                  latestStaged.isVideo ? (
                    <div className="text-center px-4 space-y-1">
                      <Video className="h-7 w-7 text-rose-400 mx-auto" />
                      <div className="text-xs font-extrabold text-white">360° Video Queued</div>
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
                    No photo yet
                  </div>
                )}

                {latestStaged && (
                  <span className="absolute top-2 left-2 rounded-lg bg-amber-400 px-2 py-0.5 text-[10px] font-black text-slate-950 shadow">
                    QUEUED · TAP UPLOAD
                  </span>
                )}
                {!latestStaged && latestSaved?.ocr_text === '360° Panorama' && (
                  <span className="absolute top-2 left-2 rounded-lg bg-cyan-400 px-2 py-0.5 text-[10px] font-black text-slate-950 shadow">
                    🌐 360° VIEW
                  </span>
                )}
              </div>

              {/* Queued Strip (Remove X) */}
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
                        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 2 Giant Clear Action Buttons */}
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
                        const picked = buildStagedItems(rm, e.target.files);
                        setGalleryConfirm({ room: rm, items: picked });
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              {/* Expandable Saved Photos Manager */}
              {rm.photos.length > 0 && (
                <div className="pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setExpandedRoomId(isExpanded ? null : rm.node_id)}
                    className="w-full flex items-center justify-between text-[11px] font-bold text-slate-600 hover:text-slate-950 py-1"
                  >
                    <span>Saved Photos ({rm.photos.length})</span>
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
                                  Tap Upload &amp; Save below to delete
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
      {/* 4. STICKY BOTTOM "UPLOAD & SAVE ALL" BAR (WHEN CHANGES QUEUED)    */}
      {/* ================================================================= */}
      {totalPendingChanges > 0 && !progressState?.active && (
        <div className="fixed bottom-3 inset-x-3 z-40 flex justify-center pointer-events-none">
          <div className="pointer-events-auto w-full max-w-xl rounded-2xl bg-slate-950 p-3 text-white ring-2 ring-emerald-400 shadow-2xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-extrabold text-white truncate">
                {totalPendingChanges} Change{totalPendingChanges === 1 ? '' : 's'} Ready
              </div>
              <div className="text-[11px] text-slate-300 truncate">
                Tap Upload &amp; Save to apply now
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={discardAllChanges}
                className="rounded-xl bg-white/10 px-3 py-2.5 text-xs font-bold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  void runUploadBatch(
                    [...stagedUploads],
                    Object.entries(stagedMoves),
                    [...stagedDeletes],
                    true,
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2.5 text-xs sm:text-sm font-black text-slate-950 shadow-lg active:scale-95 transition"
              >
                <Upload className="h-4 w-4 stroke-[2.5]" />
                <span>Upload &amp; Save</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 5. IMMEDIATE GALLERY PICK CONFIRMATION POPUP (NEVER CONFUSING!)   */}
      {/* ================================================================= */}
      {galleryConfirm && (
        <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/85 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-extrabold text-slate-950">
                  Upload to {galleryConfirm.room.name}?
                </h3>
                <p className="text-xs font-semibold text-slate-500">
                  {galleryConfirm.items.length} file
                  {galleryConfirm.items.length === 1 ? '' : 's'} selected
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  galleryConfirm.items.forEach((it) => {
                    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
                  });
                  setGalleryConfirm(null);
                }}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
              {galleryConfirm.items.map((it) => (
                <div
                  key={it.id}
                  className="rounded-2xl bg-slate-950 overflow-hidden ring-1 ring-slate-200 h-32 flex items-center justify-center"
                >
                  {it.isVideo ? (
                    <div className="text-center p-2 space-y-1">
                      <Video className="h-7 w-7 text-rose-400 mx-auto" />
                      <div className="text-[11px] font-extrabold text-white truncate max-w-[130px]">
                        {it.file.name}
                      </div>
                      <div className="text-[10px] font-bold text-cyan-300">
                        🌐 360° Video → Pano
                      </div>
                    </div>
                  ) : (
                    <img
                      src={it.previewUrl}
                      alt={it.roomName}
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  const batch = galleryConfirm.items;
                  setGalleryConfirm(null);
                  void runUploadBatch(batch, [], [], false);
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-4 py-3.5 text-sm font-black text-slate-950 shadow-lg active:scale-95 transition"
              >
                <Upload className="h-4 w-4 stroke-[2.5]" />
                <span>⬆ Upload &amp; Save Now</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStagedUploads((prev) => [...prev, ...galleryConfirm.items]);
                  setGalleryConfirm(null);
                }}
                className="w-full rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-200 transition"
              >
                + Keep in Queue (Add More Rooms First)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 6. LIVE 0% -> 100% UPLOAD PROGRESS MODAL                          */}
      {/* ================================================================= */}
      {progressState?.active && (
        <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/85 p-4">
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
                    {progressState.done ? 'Upload Complete!' : 'Uploading...'}
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
              <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-800 ring-1 ring-rose-200 space-y-1 max-h-36 overflow-y-auto">
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
                    <span>See 360° Live View</span>
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
      {/* 7. QUICK "+ ADD ROOM" MODAL                                       */}
      {/* ================================================================= */}
      {addRoomOpen && (
        <div
          className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
          onClick={() => setAddRoomOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl ring-1 ring-slate-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold text-slate-950">
                Add New Room
              </h3>
              <button
                type="button"
                onClick={() => setAddRoomOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleQuickAddRoom(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Room Name *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. Room 311 or Seminar Hall"
                  className="w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={addingRoom}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
              >
                {addingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span>Add Room</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 8. FULL-SCREEN 100% EDGE-TO-EDGE PHONE CAMERA & 10s 360° SPIN     */}
      {/* ================================================================= */}
      <Camera360CaptureModal
        open={cameraRoom !== null}
        onClose={() => setCameraRoom(null)}
        venueName={venue.name}
        targetLabel={cameraRoom ? cameraRoom.name : ''}
        onSubmitFrames={(files, uploadImmediately = true) => {
          const room = cameraRoom;
          setCameraRoom(null);
          if (!room || files.length === 0) return;
          const items = buildStagedItems(room, files);
          if (uploadImmediately) {
            void runUploadBatch(items, [], [], false);
          } else {
            setStagedUploads((prev) => [...prev, ...items]);
          }
        }}
      />
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FolderUp,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Plus,
  Rocket,
  RotateCw,
  Search,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import {
  bulkCreateRoomsFromPhotos,
  createAdminFloor,
  createAdminNode,
  deleteAdminNode,
  deleteAdminPhoto,
  exportVenuePackage,
  getAdminDataset,
  getVenue,
  getVenuePublishStatus,
  importVenuePackage,
  mediaUrl,
  promoteAdminPhotoCover,
  publishAdminVenue,
  rotateAdminPhoto90,
  updateAdminPhoto,
  uploadAdminPhotos,
  type VenuePublishStatus,
} from '../../lib/api';
import { isVideoFile, stitchMultiplePhotosTo360 } from '../../lib/panorama360';
import { formatLevel } from '../../lib/locationStore';
import { Camera360CaptureModal } from '../../components/Camera360CaptureModal';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type { DatasetNode, DatasetResponse, VenueDetail } from '../../lib/types';

interface PublishModalState {
  active: boolean;
  done: boolean;
  percent: number;
  stageText: string;
  rooms: number;
  paths: number;
  photos: number;
  error: string | null;
}

export const AdminDatasetPage: React.FC = () => {
  const { selectedSlug, setSelectedSlug, refreshVenues } = useAdminVenue();

  const addRoomFileRef = useRef<HTMLInputElement>(null);
  const bulkPhotosRef = useRef<HTMLInputElement>(null);
  const importPackageRef = useRef<HTMLInputElement>(null);

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [dataset, setDataset] = useState<DatasetResponse | null>(null);
  const [publishStatus, setPublishStatus] = useState<VenuePublishStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'missing' | 'mapped'>('all');
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const [fitModeByRoom, setFitModeByRoom] = useState<Record<string, boolean>>({});
  const [panoYawByRoom, setPanoYawByRoom] = useState<Record<string, number>>({});
  const dragCardRef = useRef<{ roomId: string; startX: number; initYaw: number } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Step 1: Unified Add Room + Floor + Direct Photo/360° Input!
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomKind, setNewRoomKind] = useState<'room' | 'corridor' | 'entrance' | 'stairs' | 'lift'>('room');
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [newRoomFiles, setNewRoomFiles] = useState<{ file: File; preview: string; isVid: boolean }[]>([]);
  const [stitchNewRoomAs360, setStitchNewRoomAs360] = useState(false);
  const [addingRoom, setAddingRoom] = useState(false);
  const [addingFloorQuick, setAddingFloorQuick] = useState(false);

  // Inline Per-Room Upload Progress (ZERO blocking confirmation popups!)
  const [roomUploadState, setRoomUploadState] = useState<
    Record<string, { pct: number; text: string }>
  >({});
  const [busyBulk, setBusyBulk] = useState<{ pct: number; text: string } | null>(null);

  // Camera Modal Target Room
  const [cameraRoom, setCameraRoom] = useState<DatasetNode | null>(null);

  // Final Venue Publish Modal
  const [publishModal, setPublishModal] = useState<PublishModalState | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3800);
  };

  const loadData = useCallback(
    async (silent = false) => {
      if (!selectedSlug) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [v, ds, pub] = await Promise.all([
          getVenue(selectedSlug),
          getAdminDataset(selectedSlug),
          getVenuePublishStatus(selectedSlug),
        ]);
        setVenue(v);
        setDataset(ds);
        setPublishStatus(pub);
        const firstFloor = v.buildings[0]?.floors[0]?.id || '';
        setSelectedFloorId((prev) => prev || firstFloor);
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

  const allFloors = useMemo(() => {
    if (!venue) return [];
    const list: { buildingId: string; buildingName: string; floorId: string; level: number; label: string }[] = [];
    for (const b of venue.buildings) {
      for (const f of b.floors.slice().sort((x, y) => x.level - y.level)) {
        list.push({
          buildingId: b.id,
          buildingName: b.name,
          floorId: f.id,
          level: f.level,
          label:
            venue.buildings.length > 1
              ? `${b.name} · ${formatLevel(f.level, f.name)}`
              : formatLevel(f.level, f.name),
        });
      }
    }
    return list;
  }, [venue]);

  // Quick "+ Floor" button right inside Step 1 so multi-floor buildings never need Map Editor first!
  const handleQuickAddNextFloor = async () => {
    if (!selectedSlug || !venue || addingFloorQuick) return;
    const bldg = venue.buildings[0];
    if (!bldg) return;
    setAddingFloorQuick(true);
    try {
      const maxLevel = bldg.floors.reduce((m, f) => Math.max(m, f.level), 0);
      const nextLvl = maxLevel + 1;
      const created = await createAdminFloor(selectedSlug, {
        building_id: bldg.id,
        level: nextLvl,
      });
      await loadData(true);
      setSelectedFloorId(created.id);
      showToast(`Added ${formatLevel(nextLvl, created.name)}!`);
    } finally {
      setAddingFloorQuick(false);
    }
  };

  // =========================================================================
  // DIRECT 1-TAP UPLOAD TO ANY ROOM CARD (NO EXTRA POPUPS!)
  // =========================================================================
  const uploadDirectToRoom = async (
    room: DatasetNode,
    rawFiles: FileList | File[],
    stitchAs360 = false,
  ) => {
    if (!selectedSlug) return;
    const arr = Array.from(rawFiles);
    if (arr.length === 0) return;

    setRoomUploadState((prev) => ({
      ...prev,
      [room.node_id]: {
        pct: 8,
        text: stitchAs360 ? 'Stitching 360° panorama...' : 'Enhancing & saving...',
      },
    }));

    try {
      let filesToSave = arr;
      if (stitchAs360 && arr.length >= 2) {
        const cleanStem = room.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
        const stitched = await stitchMultiplePhotosTo360(arr, cleanStem, (pct, stage) => {
          setRoomUploadState((prev) => ({
            ...prev,
            [room.node_id]: { pct: Math.min(75, pct), text: stage },
          }));
        });
        filesToSave = [stitched.file];
      }

      const res = await uploadAdminPhotos(
        selectedSlug,
        room.node_id,
        filesToSave,
        null,
        true,
        (pct, stage) => {
          setRoomUploadState((prev) => ({
            ...prev,
            [room.node_id]: { pct, text: stage },
          }));
        },
      );

      await loadData(true);
      await refreshVenues();

      if (res.accepted.length > 0) {
        showToast(
          `Saved ${res.accepted.length} ${
            res.accepted[0]?.media_type === 'video' ? '360° panorama' : 'photo'
          }${res.accepted.length > 1 ? 's' : ''} to ${room.name}!`,
        );
      }
      if (res.rejected.length > 0) {
        showToast(`Warning: ${res.rejected[0].reason}`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setRoomUploadState((prev) => {
        const copy = { ...prev };
        delete copy[room.node_id];
        return copy;
      });
    }
  };

  // =========================================================================
  // STEP 1: UNIFIED CREATE ROOM + ATTACH PHOTO/360° IN ONE CLICK!
  // =========================================================================
  const handleQuickAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !venue || !newRoomName.trim()) return;
    setAddingRoom(true);
    try {
      const floorInfo =
        allFloors.find((f) => f.floorId === selectedFloorId) ?? allFloors[0];
      const bldgId = floorInfo?.buildingId || venue.buildings[0]?.id || `${selectedSlug}:main`;
      const flrId = floorInfo?.floorId || venue.buildings[0]?.floors[0]?.id || `${selectedSlug}:f0`;
      const existingCount = dataset?.nodes.length ?? 0;

      const created = await createAdminNode(selectedSlug, {
        name: newRoomName.trim(),
        kind: newRoomKind,
        category: newRoomKind === 'corridor' ? 'corridor' : 'classroom',
        building_id: bldgId,
        floor_id: flrId,
        x: 18 + (existingCount % 5) * 15,
        y: 26 + Math.floor(existingCount / 5) * 15,
        is_place: newRoomKind !== 'corridor',
      });

      const attached = newRoomFiles.map((x) => x.file);
      const shouldStitch = stitchNewRoomAs360 && attached.length >= 2;

      // Clean up preview URLs
      newRoomFiles.forEach((x) => {
        if (x.preview) URL.revokeObjectURL(x.preview);
      });
      setNewRoomFiles([]);
      setStitchNewRoomAs360(false);
      setNewRoomName('');

      if (attached.length > 0) {
        let toSave = attached;
        if (shouldStitch) {
          const cleanStem = created.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
          const pano = await stitchMultiplePhotosTo360(attached, cleanStem);
          toSave = [pano.file];
        }
        await uploadAdminPhotos(selectedSlug, created.id, toSave, null, true);
        showToast(`Created "${created.name}" & saved ${toSave.length} photo/360°!`);
      } else {
        showToast(`Added "${created.name}" (${formatLevel(created.level)})!`);
      }

      await loadData(true);
      await refreshVenues();
    } finally {
      setAddingRoom(false);
    }
  };

  // =========================================================================
  // 1-TAP BULK IMPORT: MULTIPLE PHOTOS -> AUTO-CREATE ROOMS!
  // =========================================================================
  const handleBulkCreateFromPhotos = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !selectedSlug || !venue) return;
    const files = Array.from(fileList);
    const floorInfo =
      allFloors.find((f) => f.floorId === selectedFloorId) ?? allFloors[0];
    const bldgId = floorInfo?.buildingId || venue.buildings[0]?.id || `${selectedSlug}:main`;
    const flrId = floorInfo?.floorId || venue.buildings[0]?.floors[0]?.id || `${selectedSlug}:f0`;

    setBusyBulk({ pct: 6, text: `Importing ${files.length} room photo(s)...` });
    try {
      const rep = await bulkCreateRoomsFromPhotos(
        selectedSlug,
        files,
        bldgId,
        flrId,
        (pct, stage) => setBusyBulk({ pct, text: stage }),
      );
      await loadData(true);
      await refreshVenues();
      showToast(
        `Bulk imported ${rep.photosSaved} photo(s) across ${
          rep.roomsCreated > 0 ? `${rep.roomsCreated} new room(s)` : 'matched rooms'
        }!`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Bulk import failed.');
    } finally {
      setBusyBulk(null);
    }
  };

  // =========================================================================
  // INSTANT PHOTO ACTIONS (ROTATE 90°, SET COVER, MOVE, DELETE)
  // =========================================================================
  const handleRotatePhoto = async (photoId: string) => {
    try {
      await rotateAdminPhoto90(photoId);
      await loadData(true);
      showToast('Rotated photo 90°!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cannot rotate bundled demo photo.');
    }
  };

  const handleSetPrimaryPhoto = async (photoId: string) => {
    if (!selectedSlug) return;
    await promoteAdminPhotoCover(selectedSlug, photoId, true);
    await loadData(true);
    await refreshVenues();
    showToast('Set as primary room & venue cover photo!');
  };

  const handleInstantMovePhoto = async (photoId: string, nextNodeId: string) => {
    await updateAdminPhoto(photoId, { node_id: nextNodeId });
    await loadData(true);
    showToast('Moved photo to selected room!');
  };

  const handleInstantDeletePhoto = async (photoId: string) => {
    await deleteAdminPhoto(photoId);
    await loadData(true);
    await refreshVenues();
    showToast('Removed photo.');
  };

  const handleDeleteRoom = async (room: DatasetNode) => {
    if (dataset && dataset.nodes.length <= 1) {
      showToast('Venue needs at least 1 room.');
      return;
    }
    if (!window.confirm(`Remove room "${room.name}"?`)) return;
    await deleteAdminNode(room.node_id);
    await loadData(true);
    await refreshVenues();
    showToast(`Removed "${room.name}".`);
  };

  // =========================================================================
  // FINAL PUBLISH VENUE LIVE
  // =========================================================================
  const handleFinalPublishVenue = async () => {
    if (!selectedSlug || !venue) return;
    setPublishModal({
      active: true,
      done: false,
      percent: 10,
      stageText: `Connecting walk paths & indexing "${venue.name}"...`,
      rooms: 0,
      paths: 0,
      photos: 0,
      error: null,
    });

    try {
      const result = await publishAdminVenue(selectedSlug, (pct, stage) => {
        setPublishModal((prev) =>
          prev ? { ...prev, percent: pct, stageText: stage } : prev,
        );
      });
      await loadData(true);
      await refreshVenues();

      setPublishModal({
        active: true,
        done: true,
        percent: 100,
        stageText: `"${venue.name}" is published with ${result.rooms} rooms, ${result.paths} walk paths & ${result.photos} photos!`,
        rooms: result.rooms,
        paths: result.paths,
        photos: result.photos,
        error: null,
      });
    } catch (err) {
      setPublishModal({
        active: true,
        done: true,
        percent: 100,
        stageText: 'Publish encountered an issue.',
        rooms: 0,
        paths: 0,
        photos: 0,
        error: err instanceof Error ? err.message : 'Publish failed.',
      });
    }
  };

  const handleImportVenueFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = await importVenuePackage(file);
      await refreshVenues();
      setSelectedSlug(imported.slug);
      await loadData(false);
      showToast(`Imported venue "${imported.name}" successfully!`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not import venue package.');
    }
  };

  const filteredRooms = useMemo(() => {
    if (!dataset) return [];
    const q = searchQuery.trim().toLowerCase();
    return dataset.nodes.filter((rm) => {
      if (filterMode === 'missing' && rm.photo_count > 0) return false;
      if (filterMode === 'mapped' && rm.photo_count === 0) return false;
      if (!q) return true;
      return (
        rm.name.toLowerCase().includes(q) ||
        formatLevel(rm.level).toLowerCase().includes(q)
      );
    });
  }, [dataset, searchQuery, filterMode]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm font-semibold text-slate-500">Loading your venue studio...</p>
      </div>
    );
  }

  if (error || !dataset || !venue) {
    return <ErrorState message={error || 'Venue unavailable.'} onRetry={() => void loadData(false)} />;
  }

  const entranceNode =
    dataset.nodes.find((n) => n.name.toLowerCase().includes('entrance')) ?? dataset.nodes[0];
  const secondNode =
    dataset.nodes.find((n) => n.node_id !== entranceNode?.node_id) ?? null;
  const publicVenueUrl = `${window.location.origin}/v/${encodeURIComponent(selectedSlug)}`;
  const step1Done = dataset.nodes.length >= 2;
  const step2Done = dataset.totals.covered > 0;
  const step3Done = Boolean(publishStatus?.published);

  return (
    <div className="space-y-4 pb-12">
      {/* Non-blocking Toast Banner */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-sm w-[calc(100%-1.5rem)] rounded-2xl bg-slate-950 px-4 py-3 text-xs font-extrabold text-emerald-300 ring-1 ring-emerald-400/50 shadow-2xl flex items-center justify-between gap-2">
          <span className="truncate">✅ {toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* TOP VENUE STATUS + PUBLISH + CROSS-DEVICE SHARE BAR               */}
      {/* ================================================================= */}
      <div className="rounded-3xl bg-slate-950 p-4 text-white ring-1 ring-white/15 shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-lg sm:text-xl font-extrabold text-white truncate">
                {venue.name}
              </h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  step3Done
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40'
                    : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40'
                }`}
              >
                {step3Done ? '● PUBLISHED' : '● DRAFT'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Add rooms with photos/360° in one step — saves instantly with zero popups.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              ref={importPackageRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                void handleImportVenueFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => void exportVenuePackage(selectedSlug)}
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-cyan-200 ring-1 ring-white/15 hover:bg-white/15 transition"
              title="Export portable venue file to open on another phone or laptop"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export</span>
            </button>
            <button
              type="button"
              onClick={() => importPackageRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-slate-200 ring-1 ring-white/15 hover:bg-white/15 transition"
              title="Import a venue package exported from another device"
            >
              <FolderUp className="h-3.5 w-3.5" />
              <span>Import</span>
            </button>
            <button
              type="button"
              onClick={() => void handleFinalPublishVenue()}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2 text-xs font-black text-slate-950 shadow-lg hover:brightness-105 active:scale-95 transition"
            >
              <Rocket className="h-4 w-4" />
              <span>{step3Done ? 'Update Venue' : 'Publish Live'}</span>
            </button>
          </div>
        </div>

        {/* Clean 3-Step Readiness Strip */}
        <div className="grid grid-cols-3 gap-2">
          <div
            className={`rounded-2xl p-2.5 ring-1 ${
              step1Done ? 'bg-emerald-500/15 ring-emerald-400/40' : 'bg-white/[0.06] ring-white/15'
            }`}
          >
            <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
              Step 1 {step1Done ? '✓' : ''}
            </div>
            <div className="text-xs font-extrabold text-white mt-0.5">Rooms</div>
            <div className="text-[10px] text-slate-300">{dataset.nodes.length} added</div>
          </div>

          <div
            className={`rounded-2xl p-2.5 ring-1 ${
              step2Done ? 'bg-emerald-500/15 ring-emerald-400/40' : 'bg-white/[0.06] ring-white/15'
            }`}
          >
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-300">
              Step 2 {step2Done ? '✓' : ''}
            </div>
            <div className="text-xs font-extrabold text-white mt-0.5">Photos / 360°</div>
            <div className="text-[10px] text-slate-300">
              {dataset.totals.covered}/{dataset.totals.nodes} saved
            </div>
          </div>

          <div
            className={`rounded-2xl p-2.5 ring-1 ${
              step3Done ? 'bg-emerald-500/15 ring-emerald-400/40' : 'bg-amber-500/15 ring-amber-400/40'
            }`}
          >
            <div className="text-[10px] font-black uppercase tracking-wider text-amber-300">
              Step 3 {step3Done ? '✓' : ''}
            </div>
            <div className="text-xs font-extrabold text-white mt-0.5">Publish</div>
            <div className="text-[10px] text-slate-300">
              {step3Done ? 'Live Ready' : 'Tap Publish'}
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* STEP 1: UNIFIED ADD ROOM + FLOOR + DIRECT PHOTO/360° INPUT        */}
      {/* ================================================================= */}
      <div className="rounded-3xl bg-white p-4 ring-1 ring-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">
              1
            </span>
            <h2 className="font-display text-sm sm:text-base font-extrabold text-slate-950">
              Add Room + Photo / 360° in One Step
            </h2>
          </div>

          {/* 1-Tap Bulk Auto-Importer from Multiple Photos */}
          <div>
            <input
              ref={bulkPhotosRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleBulkCreateFromPhotos(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={Boolean(busyBulk)}
              onClick={() => bulkPhotosRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-[11px] font-extrabold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100 transition"
              title="Pick multiple room photos at once — creates rooms automatically from filenames!"
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              <span>Bulk Upload Room Photos</span>
            </button>
          </div>
        </div>

        {busyBulk && (
          <div className="rounded-2xl bg-indigo-50 p-3 ring-1 ring-indigo-200 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-extrabold text-indigo-950">
              <span className="truncate">{busyBulk.text}</span>
              <span>{busyBulk.pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-indigo-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-600 to-cyan-500 transition-all duration-200"
                style={{ width: `${busyBulk.pct}%` }}
              />
            </div>
          </div>
        )}

        <form onSubmit={(e) => void handleQuickAddRoom(e)} className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <input
              type="text"
              required
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room name (e.g. Room 101, AI Lab)..."
              className="sm:col-span-5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <div className="sm:col-span-4 flex items-center gap-1.5">
              <select
                value={selectedFloorId}
                onChange={(e) => setSelectedFloorId(e.target.value)}
                aria-label="Select Floor"
                className="flex-1 min-w-0 rounded-xl bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-slate-800 ring-1 ring-slate-200"
              >
                {allFloors.map((fl) => (
                  <option key={fl.floorId} value={fl.floorId}>
                    {fl.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={addingFloorQuick}
                onClick={() => void handleQuickAddNextFloor()}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-cyan-50 px-2.5 py-2.5 text-xs font-extrabold text-cyan-800 ring-1 ring-cyan-200 hover:bg-cyan-100"
                title="Add next floor (1st Floor, 2nd Floor...)"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>+Floor</span>
              </button>
            </div>

            <select
              value={newRoomKind}
              onChange={(e) =>
                setNewRoomKind(e.target.value as 'room' | 'corridor' | 'entrance' | 'stairs' | 'lift')
              }
              aria-label="Spot Type"
              className="sm:col-span-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-800 ring-1 ring-slate-200"
            >
              <option value="room">Room / Lab</option>
              <option value="corridor">Corridor</option>
              <option value="entrance">Entrance</option>
              <option value="stairs">Stairs</option>
              <option value="lift">Elevator / Lift</option>
            </select>
          </div>

          {/* Inline Photo / Panorama Attachment inside Add Room! */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={addRoomFileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const incoming = e.target.files ? Array.from(e.target.files) : [];
                  if (incoming.length > 0) {
                    const mapped = incoming.map((f) => {
                      const vid = isVideoFile(f);
                      return {
                        file: f,
                        preview: vid ? '' : URL.createObjectURL(f),
                        isVid: vid,
                      };
                    });
                    setNewRoomFiles((prev) => [...prev, ...mapped]);
                  }
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => addRoomFileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-200 transition"
              >
                <ImageIcon className="h-4 w-4 text-indigo-600" />
                <span>
                  {newRoomFiles.length > 0
                    ? `${newRoomFiles.length} Photo/Video Attached (+ Add More)`
                    : 'Attach Photo / 360° (Optional)'}
                </span>
              </button>

              {newRoomFiles.length >= 2 && (
                <label className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-50 px-3 py-2 text-xs font-extrabold text-cyan-900 ring-1 ring-cyan-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stitchNewRoomAs360}
                    onChange={(e) => setStitchNewRoomAs360(e.target.checked)}
                    className="rounded text-cyan-600"
                  />
                  <span>🌐 Stitch {newRoomFiles.length} photos into 360°</span>
                </label>
              )}
            </div>

            <button
              type="submit"
              disabled={addingRoom || !newRoomName.trim()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-extrabold text-white shadow hover:bg-indigo-500 disabled:opacity-50 active:scale-95 transition"
            >
              {addingRoom ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 stroke-[2.5]" />
              )}
              <span>
                {newRoomFiles.length > 0 ? 'Save Room & Photo' : 'Add Room'}
              </span>
            </button>
          </div>

          {newRoomFiles.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pt-1 pb-0.5">
              {newRoomFiles.map((item, idx) => (
                <div
                  key={idx}
                  className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-300"
                >
                  {item.isVid ? (
                    <div className="h-full flex items-center justify-center text-cyan-300">
                      <Video className="h-5 w-5" />
                    </div>
                  ) : (
                    <img
                      src={item.preview}
                      alt=""
                      className="h-full w-full object-cover object-center"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (item.preview) URL.revokeObjectURL(item.preview);
                      setNewRoomFiles((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-white"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </form>
      </div>

      {/* ================================================================= */}
      {/* STEP 2: ROOM CARDS (1-TAP INSTANT UPLOAD, 0 BLACK BARS, LIVE 360) */}
      {/* ================================================================= */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-black text-white">
              2
            </span>
            <h2 className="font-display text-sm sm:text-base font-extrabold text-slate-950">
              Room Photos &amp; Interactive 360° Views
            </h2>
          </div>
          <span className="text-[11px] font-bold text-emerald-700">
            {dataset.totals.covered}/{dataset.totals.nodes} rooms mapped
          </span>
        </div>

        {/* Search + Filter */}
        {dataset.nodes.length > 3 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search room or floor..."
                className="w-full rounded-2xl bg-white pl-10 pr-4 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
        )}

        {/* Room Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredRooms.map((rm) => {
            const latestSaved = rm.photos[0] ?? null;
            const isPano = latestSaved?.ocr_text === '360° Panorama' || latestSaved?.media_type === 'video';
            const isExpanded = expandedRoomId === rm.node_id;
            const fitUncropped = Boolean(fitModeByRoom[rm.node_id]);
            const cardYaw = panoYawByRoom[rm.node_id] ?? 50;
            const activeUpload = roomUploadState[rm.node_id];

            return (
              <div
                key={rm.node_id}
                className="rounded-3xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200 flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-extrabold text-slate-950 truncate">
                      {rm.name}
                    </h3>
                    <p className="text-[11px] font-semibold text-slate-500 truncate">
                      {formatLevel(rm.level)} · {rm.kind}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                        rm.photos.length > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {rm.photos.length > 0 ? `${rm.photos.length} Saved ✓` : 'Needs Photo'}
                    </span>
                    {dataset.nodes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteRoom(rm)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                        title={`Delete ${rm.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* FULL-BLEED EDGE-TO-EDGE ROOM PHOTO OR LIVE DRAGGABLE 360° VIEWER! */}
                <div className="relative h-44 w-full overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200/80">
                  {latestSaved ? (
                    isPano ? (
                      <div
                        onMouseDown={(e) => {
                          dragCardRef.current = {
                            roomId: rm.node_id,
                            startX: e.clientX,
                            initYaw: cardYaw,
                          };
                        }}
                        onMouseMove={(e) => {
                          if (!dragCardRef.current || dragCardRef.current.roomId !== rm.node_id)
                            return;
                          const dx = e.clientX - dragCardRef.current.startX;
                          setPanoYawByRoom((prev) => ({
                            ...prev,
                            [rm.node_id]: dragCardRef.current!.initYaw - dx * 0.25,
                          }));
                        }}
                        onMouseUp={() => {
                          dragCardRef.current = null;
                        }}
                        onTouchStart={(e) => {
                          if (e.touches[0]) {
                            dragCardRef.current = {
                              roomId: rm.node_id,
                              startX: e.touches[0].clientX,
                              initYaw: cardYaw,
                            };
                          }
                        }}
                        onTouchMove={(e) => {
                          if (
                            !dragCardRef.current ||
                            dragCardRef.current.roomId !== rm.node_id ||
                            !e.touches[0]
                          ) {
                            return;
                          }
                          const dx = e.touches[0].clientX - dragCardRef.current.startX;
                          setPanoYawByRoom((prev) => ({
                            ...prev,
                            [rm.node_id]: dragCardRef.current!.initYaw - dx * 0.3,
                          }));
                        }}
                        onTouchEnd={() => {
                          dragCardRef.current = null;
                        }}
                        style={{
                          backgroundImage: `url("${mediaUrl(latestSaved.url)}")`,
                          backgroundRepeat: 'repeat-x',
                          backgroundSize: 'auto 100%',
                          backgroundPosition: `${cardYaw}% 50%`,
                        }}
                        className="h-full w-full cursor-grab active:cursor-grabbing"
                      >
                        <span className="pointer-events-none absolute top-2 left-2 rounded-lg bg-cyan-400 px-2 py-0.5 text-[10px] font-black text-slate-950 shadow">
                          🌐 360° · DRAG TO SPIN
                        </span>
                      </div>
                    ) : (
                      <>
                        {fitUncropped && (
                          <img
                            src={mediaUrl(latestSaved.thumbnail_url || latestSaved.url)}
                            alt=""
                            aria-hidden="true"
                            className="absolute inset-0 h-full w-full object-cover blur-xl scale-110 opacity-60"
                          />
                        )}
                        <img
                          src={mediaUrl(latestSaved.thumbnail_url || latestSaved.url)}
                          alt={rm.name}
                          loading="lazy"
                          className={`relative z-[1] h-full w-full transition-all ${
                            fitUncropped ? 'object-contain' : 'object-cover object-center'
                          }`}
                        />
                        <div className="absolute top-2 right-2 z-[2] flex items-center gap-1">
                          {latestSaved.id.startsWith('local-') && (
                            <button
                              type="button"
                              onClick={() => void handleRotatePhoto(latestSaved.id)}
                              className="rounded-lg bg-slate-950/75 p-1.5 text-white hover:bg-slate-900 backdrop-blur-md shadow"
                              title="Rotate photo 90°"
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setFitModeByRoom((prev) => ({
                                ...prev,
                                [rm.node_id]: !prev[rm.node_id],
                              }))
                            }
                            className="rounded-lg bg-slate-950/75 p-1.5 text-white hover:bg-slate-900 backdrop-blur-md shadow"
                            title={fitUncropped ? 'Fill card edge-to-edge' : 'Show full uncropped bounds'}
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    /* Interactive Tap-to-Upload Drop Area When Empty */
                    <label className="cursor-pointer h-full w-full flex flex-col items-center justify-center gap-1.5 px-4 text-center hover:bg-indigo-50/60 transition">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                        <Upload className="h-5 w-5" />
                      </div>
                      <span className="text-xs font-extrabold text-slate-700">
                        Tap to Upload Photo / Panorama / Video
                      </span>
                      <span className="text-[10px] font-medium text-slate-500">
                        Saves immediately in 1 tap
                      </span>
                      <input
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            void uploadDirectToRoom(rm, e.target.files, false);
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}

                  {/* Inline Live Progress Overlay right on the card! */}
                  {activeUpload && (
                    <div className="absolute inset-0 z-10 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center space-y-2 text-white">
                      <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                      <div className="text-xs font-extrabold">{activeUpload.pct}%</div>
                      <div className="w-full max-w-[180px] h-2 rounded-full bg-white/15 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                          style={{ width: `${activeUpload.pct}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-300 truncate max-w-full">
                        {activeUpload.text}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3 Crisp Action Buttons: Camera/360°, Instant Upload, Stitch Multi-Photos -> 360° */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={Boolean(activeUpload)}
                    onClick={() => setCameraRoom(rm)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2 py-2.5 text-[11px] font-extrabold text-white shadow-sm hover:bg-emerald-500 active:scale-95 transition"
                  >
                    <Camera className="h-3.5 w-3.5 shrink-0" />
                    <span>Camera</span>
                  </button>

                  <label className="cursor-pointer inline-flex items-center justify-center gap-1 rounded-xl bg-indigo-600 px-2 py-2.5 text-[11px] font-extrabold text-white shadow-sm hover:bg-indigo-500 active:scale-95 transition">
                    <Upload className="h-3.5 w-3.5 shrink-0" />
                    <span>+ Photo</span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          void uploadDirectToRoom(rm, e.target.files, false);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <label
                    className="cursor-pointer inline-flex items-center justify-center gap-1 rounded-xl bg-cyan-50 px-2 py-2.5 text-[11px] font-extrabold text-cyan-900 ring-1 ring-cyan-200 hover:bg-cyan-100 active:scale-95 transition"
                    title="Select 2 to 8 wall photos to stitch into one seamless 360° panorama"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-cyan-600 shrink-0" />
                    <span>Stitch 360°</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length >= 2) {
                          void uploadDirectToRoom(rm, e.target.files, true);
                        } else if (e.target.files?.length === 1) {
                          void uploadDirectToRoom(rm, e.target.files, false);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {/* Expandable Saved Photos Manager (1-Tap Rotate, Cover, Move, Delete) */}
                {rm.photos.length > 0 && (
                  <div className="pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setExpandedRoomId(isExpanded ? null : rm.node_id)}
                      className="w-full flex items-center justify-between text-[11px] font-bold text-slate-600 hover:text-slate-950 py-1"
                    >
                      <span>Manage Photos ({rm.photos.length})</span>
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 space-y-2">
                        {rm.photos.map((ph, idx) => (
                          <div
                            key={ph.id}
                            className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200"
                          >
                            <img
                              src={mediaUrl(ph.thumbnail_url || ph.url)}
                              alt=""
                              className="h-12 w-12 shrink-0 rounded-lg bg-slate-200 object-cover object-center"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <select
                                value={rm.node_id}
                                onChange={(e) => void handleInstantMovePhoto(ph.id, e.target.value)}
                                className="w-full rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-800 ring-1 ring-slate-200"
                              >
                                {dataset.nodes.map((nd) => (
                                  <option key={nd.node_id} value={nd.node_id}>
                                    📍 {nd.name}
                                  </option>
                                ))}
                              </select>
                              <div className="flex items-center gap-1">
                                {idx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => void handleSetPrimaryPhoto(ph.id)}
                                    className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900"
                                  >
                                    <Star className="h-2.5 w-2.5" /> Set Cover
                                  </button>
                                )}
                                {ph.id.startsWith('local-') && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRotatePhoto(ph.id)}
                                    className="inline-flex items-center gap-0.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-800"
                                  >
                                    <RotateCw className="h-2.5 w-2.5" /> Rotate
                                  </button>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleInstantDeletePhoto(ph.id)}
                              className="rounded-lg bg-white p-2 text-slate-500 hover:bg-rose-600 hover:text-white ring-1 ring-slate-200 transition"
                              title="Delete photo immediately"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ================================================================= */}
      {/* STEP 3 (FINAL): PUBLISH VENUE LIVE & SHARE                        */}
      {/* ================================================================= */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-[#0B1736] to-emerald-950 p-5 text-white ring-2 ring-emerald-400/50 shadow-2xl space-y-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/40">
            <Rocket className="h-3.5 w-3.5" />
            <span>Step 3 · Publish &amp; Share</span>
          </div>
          <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
            Ready to Launch &ldquo;{venue.name}&rdquo;?
          </h2>
          <p className="text-xs text-slate-300">
            Auto-connects all rooms into walkable routes and activates your public Street View page. Use <strong>Export Package</strong> to move or share custom venues across other devices.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={() => void handleFinalPublishVenue()}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 px-6 py-4 text-sm sm:text-base font-black text-slate-950 shadow-2xl hover:brightness-105 active:scale-95 transition"
          >
            <Rocket className="h-5 w-5" />
            <span>
              {step3Done
                ? `Update "${venue.name}" Live`
                : `Publish "${venue.name}" Live`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void exportVenuePackage(selectedSlug)}
            className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-4 py-3.5 text-xs font-extrabold text-white ring-1 ring-white/20 hover:bg-white/15 transition"
          >
            <Download className="h-4 w-4 text-cyan-300" />
            <span>Export Portable Package</span>
          </button>
        </div>

        {step3Done && (
          <div className="rounded-2xl bg-emerald-500/15 p-3 ring-1 ring-emerald-400/35 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
              <span className="font-bold text-emerald-100 break-all">
                {publicVenueUrl}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(publicVenueUrl);
                    setCopiedLink(true);
                    window.setTimeout(() => setCopiedLink(false), 2000);
                  } catch {
                    // Ignore
                  }
                }}
                className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-2.5 py-1.5 text-[11px] font-extrabold text-white"
              >
                {copiedLink ? (
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
              <Link
                to={`/v/${encodeURIComponent(selectedSlug)}`}
                className="inline-flex items-center gap-1 rounded-xl bg-emerald-400 px-3 py-1.5 text-[11px] font-black text-slate-950"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open Venue</span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* PUBLISH PROGRESS MODAL                                            */}
      {/* ================================================================= */}
      {publishModal?.active && (
        <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/85 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-2xl ring-1 ring-slate-200 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {publishModal.done ? (
                  publishModal.error ? (
                    <XCircle className="h-7 w-7 text-rose-500" />
                  ) : (
                    <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                  )
                ) : (
                  <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
                )}
                <h3 className="font-display text-lg font-extrabold text-slate-950">
                  {publishModal.done
                    ? publishModal.error
                      ? 'Publish Error'
                      : 'Venue Published!'
                    : 'Publishing Venue...'}
                </h3>
              </div>
              <span className="font-display text-2xl font-black text-indigo-600">
                {publishModal.percent}%
              </span>
            </div>

            <div className="space-y-2">
              <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-300"
                  style={{ width: `${publishModal.percent}%` }}
                />
              </div>
              <p className="text-xs font-bold text-slate-700 text-center">
                {publishModal.error || publishModal.stageText}
              </p>
            </div>

            {publishModal.done && (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Link
                    to={`/v/${encodeURIComponent(selectedSlug)}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-extrabold text-white shadow hover:bg-emerald-500 transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open Venue Page</span>
                  </Link>
                  {entranceNode && secondNode && (
                    <Link
                      to={`/v/${encodeURIComponent(selectedSlug)}/route?from=${encodeURIComponent(
                        entranceNode.node_id,
                      )}&to=${encodeURIComponent(secondNode.node_id)}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-3 text-xs font-extrabold text-white shadow hover:bg-indigo-500 transition"
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      <span>Walk to {secondNode.name}</span>
                    </Link>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `Explore ${venue.name} Indoor Map: ${publicVenueUrl}`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs font-extrabold text-emerald-800 ring-1 ring-emerald-200"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span>WhatsApp</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setPublishModal(null)}
                    className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-extrabold text-white"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FULL-SCREEN CAMERA & 360° STUDIO */}
      <Camera360CaptureModal
        open={cameraRoom !== null}
        onClose={() => setCameraRoom(null)}
        venueName={venue.name}
        targetLabel={cameraRoom ? cameraRoom.name : ''}
        onSubmitFrames={(files) => {
          const room = cameraRoom;
          setCameraRoom(null);
          if (!room || files.length === 0) return;
          void uploadDirectToRoom(room, files, false);
        }}
      />
    </div>
  );
};

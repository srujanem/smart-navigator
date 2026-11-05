import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Camera,
  CheckCircle2,
  Compass,
  Crosshair,
  GitCommit,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  MousePointer,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  createAdminBuilding,
  createAdminEdge,
  createAdminFloor,
  createAdminNode,
  deleteAdminEdge,
  deleteAdminNode,
  deleteAdminVenue,
  getVenue,
  getVenueGraph,
  mediaUrl,
  rebuildAdminIndex,
  updateAdminNode,
  updateAdminVenue,
  uploadAdminPhotos,
  uploadAdminVenueCover,
  uploadFloorBlueprint,
} from '../../lib/api';
import { formatLevel } from '../../lib/locationStore';
import { FloorPlan2D } from '../../components/FloorPlan2D';
import { ErrorState } from '../../components/ErrorState';
import { useAdminVenue } from './adminVenueContext';
import type {
  EdgeKind,
  GEdge,
  GNode,
  Graph,
  VenueDetail,
} from '../../lib/types';

const NODE_KINDS = [
  { value: 'room', label: 'Room / Clinic / Lab' },
  { value: 'corridor', label: 'Corridor / Junction (Waypoint)' },
  { value: 'entrance', label: 'Main Entrance / Gate' },
  { value: 'exit', label: 'Emergency / Fire Exit' },
  { value: 'emergency', label: 'Emergency Ward / Trauma' },
  { value: 'lift', label: 'Elevator / Lift Shaft' },
  { value: 'stairs', label: 'Staircase' },
  { value: 'washroom', label: 'Washroom / Restroom' },
  { value: 'pharmacy', label: 'Pharmacy / Dispensary' },
  { value: 'reception', label: 'Reception / Help Desk' },
  { value: 'cafeteria', label: 'Cafeteria / Food Court' },
];

const COMPASS_HEADINGS: { label: string; value: string }[] = [
  { label: 'Auto / Unspecified', value: '' },
  { label: '0° North (Up on Plan)', value: '0' },
  { label: '45° North-East', value: '45' },
  { label: '90° East (Right on Plan)', value: '90' },
  { label: '135° South-East', value: '135' },
  { label: '180° South (Down on Plan)', value: '180' },
  { label: '225° South-West', value: '225' },
  { label: '270° West (Left on Plan)', value: '270' },
  { label: '315° North-West', value: '315' },
];

export const AdminMapBuilderPage: React.FC = () => {
  const { selectedSlug, refreshVenues } = useAdminVenue();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const blueprintInputRef = useRef<HTMLInputElement>(null);
  const inspectorPhotoRef = useRef<HTMLInputElement>(null);

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Active Building / Floor
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<number>(0);

  // Editor Canvas Mode
  const [editorMode, setEditorMode] = useState<'select' | 'add_node' | 'connect'>('select');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | null>(null);

  // Edge Connector Settings
  const [edgeKind, setEdgeKind] = useState<EdgeKind>('walk');
  const [edgeAccessible, setEdgeAccessible] = useState<boolean>(true);
  const [edgeStretcherOk, setEdgeStretcherOk] = useState<boolean>(true);
  const [crossFloorTargetId, setCrossFloorTargetId] = useState<string>('');

  // Quick Add-Node Drawer (when clicking on canvas in add_node mode)
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number } | null>(null);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeKind, setNewNodeKind] = useState('room');
  const [newNodeCategory, setNewNodeCategory] = useState('general');
  const [newNodeKeywords, setNewNodeKeywords] = useState('');
  const [newNodeIsPlace, setNewNodeIsPlace] = useState(true);
  const [newNodeFiles, setNewNodeFiles] = useState<File[]>([]);
  const [newNodeHeading, setNewNodeHeading] = useState('');
  const [creatingNode, setCreatingNode] = useState(false);

  // Selected Node Edit Form
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState('room');
  const [editCategory, setEditCategory] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editIsPlace, setEditIsPlace] = useState(true);
  const [savingNode, setSavingNode] = useState(false);
  const [inspectorHeading, setInspectorHeading] = useState('');
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  // Add Building / Add Floor Modals
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [bldgName, setBldgName] = useState('');
  const [bldgW, setBldgW] = useState('60');
  const [bldgD, setBldgD] = useState('42');
  const [bldgX, setBldgX] = useState('0');
  const [bldgY, setBldgY] = useState('0');

  const [showAddFloor, setShowAddFloor] = useState(false);
  const [floorLevel, setFloorLevel] = useState('1');
  const [floorName, setFloorName] = useState('');

  const [busyAction, setBusyAction] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadMapBundle = useCallback(async () => {
    if (!selectedSlug) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [v, g] = await Promise.all([
        getVenue(selectedSlug),
        getVenueGraph(selectedSlug),
      ]);
      setVenue(v);
      setGraph(g);
      if (v.buildings.length > 0) {
        setSelectedBuildingId((prev) =>
          prev && v.buildings.some((b) => b.id === prev) ? prev : v.buildings[0].id,
        );
        const allLvls = v.buildings.flatMap((b) => b.floors.map((f) => f.level));
        if (allLvls.length > 0 && !allLvls.includes(selectedLevel)) {
          setSelectedLevel(allLvls[0]);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load venue map builder.',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedSlug, selectedLevel]);

  useEffect(() => {
    void loadMapBundle();
  }, [loadMapBundle]);

  const activeBuilding = useMemo(
    () =>
      venue?.buildings.find((b) => b.id === selectedBuildingId) ??
      venue?.buildings[0] ??
      null,
    [venue, selectedBuildingId],
  );

  const activeFloor = useMemo(() => {
    if (!activeBuilding) return null;
    return (
      activeBuilding.floors.find((f) => f.level === selectedLevel) ??
      activeBuilding.floors[0] ??
      null
    );
  }, [activeBuilding, selectedLevel]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? graph?.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [graph, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => (selectedEdgeId ? graph?.edges.find((e) => e.id === selectedEdgeId) ?? null : null),
    [graph, selectedEdgeId],
  );

  // Sync edit form whenever selectedNode changes
  useEffect(() => {
    if (!selectedNode) return;
    setEditName(selectedNode.name);
    setEditKind(selectedNode.kind);
    setEditCategory(selectedNode.category || '');
    setEditKeywords(selectedNode.keywords || '');
    setEditIsPlace(selectedNode.is_place);
  }, [selectedNode]);

  const handleNodeClickOnCanvas = async (node: GNode) => {
    setSelectedEdgeId(null);

    if (editorMode === 'connect') {
      if (!connectFromNodeId) {
        setConnectFromNodeId(node.id);
        showToast(`Start pin locked: ${node.name}. Now click destination pin to connect.`);
        return;
      }
      if (connectFromNodeId === node.id) {
        setConnectFromNodeId(null);
        return;
      }
      if (!selectedSlug) return;
      try {
        await createAdminEdge(selectedSlug, {
          source: connectFromNodeId,
          target: node.id,
          kind: edgeKind,
          accessible: edgeAccessible,
          stretcher_ok: edgeStretcherOk,
        });
        setConnectFromNodeId(node.id);
        const freshGraph = await getVenueGraph(selectedSlug);
        setGraph(freshGraph);
        showToast(`Connected walkable path to ${node.name}! Click next pin to chain.`);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not create connection.');
        setConnectFromNodeId(null);
      }
      return;
    }

    setSelectedNodeId(node.id);
    setPendingCoords(null);
  };

  const handleCanvasClick = (x: number, y: number) => {
    if (editorMode === 'add_node') {
      setPendingCoords({ x, y });
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    } else if (editorMode === 'connect') {
      setConnectFromNodeId(null);
    }
  };

  const handleNodeDragEnd = async (node: GNode, x: number, y: number) => {
    if (!selectedSlug) return;
    try {
      await updateAdminNode(node.id, { x, y });
      const freshGraph = await getVenueGraph(selectedSlug);
      setGraph(freshGraph);
      showToast(`Moved ${node.name} to (${x.toFixed(1)}m, ${y.toFixed(1)}m)`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to move node.');
    }
  };

  const handleCreateNodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !activeBuilding || !activeFloor || !pendingCoords || !newNodeName.trim()) {
      return;
    }
    setCreatingNode(true);
    try {
      const created = await createAdminNode(selectedSlug, {
        building_id: activeBuilding.id,
        floor_id: activeFloor.id,
        name: newNodeName.trim(),
        kind: newNodeKind,
        category: newNodeCategory.trim() || null,
        x: pendingCoords.x,
        y: pendingCoords.y,
        keywords: newNodeKeywords.trim(),
        is_place: newNodeKind === 'corridor' ? false : newNodeIsPlace,
      });

      if (newNodeFiles.length > 0) {
        const parsedHeading = newNodeHeading !== '' ? Number(newNodeHeading) : null;
        await uploadAdminPhotos(selectedSlug, created.id, newNodeFiles, parsedHeading);
      }

      const [v, g] = await Promise.all([
        getVenue(selectedSlug),
        getVenueGraph(selectedSlug),
      ]);
      setVenue(v);
      setGraph(g);
      await refreshVenues();

      setNewNodeName('');
      setNewNodeKeywords('');
      setNewNodeFiles([]);
      setPendingCoords(null);
      setSelectedNodeId(created.id);
      setEditorMode('select');
      showToast(
        newNodeFiles.length > 0
          ? `Created "${created.name}" & indexed ${newNodeFiles.length} real photo(s)!`
          : `Created "${created.name}"! Connect it to corridors next.`,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create node.');
    } finally {
      setCreatingNode(false);
    }
  };

  const handleSaveSelectedNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !selectedSlug) return;
    setSavingNode(true);
    try {
      await updateAdminNode(selectedNode.id, {
        name: editName.trim(),
        kind: editKind,
        category: editCategory.trim() || null,
        keywords: editKeywords.trim(),
        is_place: editIsPlace,
      });
      const [v, g] = await Promise.all([
        getVenue(selectedSlug),
        getVenueGraph(selectedSlug),
      ]);
      setVenue(v);
      setGraph(g);
      showToast(`Saved changes to ${editName.trim()}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update spot.');
    } finally {
      setSavingNode(false);
    }
  };

  const handleUploadPhotosForSelectedNode = async (fileList: FileList | null) => {
    if (!fileList || !selectedNode || !selectedSlug) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;

    setUploadingPhotos(true);
    try {
      const parsedHeading = inspectorHeading !== '' ? Number(inspectorHeading) : null;
      const res = await uploadAdminPhotos(
        selectedSlug,
        selectedNode.id,
        files,
        parsedHeading,
      );
      const [v, g] = await Promise.all([
        getVenue(selectedSlug),
        getVenueGraph(selectedSlug),
      ]);
      setVenue(v);
      setGraph(g);
      await refreshVenues();
      showToast(
        `Indexed ${res.accepted.length} photo(s) on ${selectedNode.name}${
          res.rejected.length > 0 ? ` (${res.rejected.length} rejected)` : ''
        }`,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleDeleteSelectedNode = async () => {
    if (!selectedNode || !selectedSlug) return;
    if (!window.confirm(`Delete "${selectedNode.name}" and its connected edges?`)) return;
    setBusyAction(true);
    try {
      await deleteAdminNode(selectedNode.id);
      setSelectedNodeId(null);
      const [v, g] = await Promise.all([
        getVenue(selectedSlug),
        getVenueGraph(selectedSlug),
      ]);
      setVenue(v);
      setGraph(g);
      await refreshVenues();
      showToast(`Deleted ${selectedNode.name}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete node.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteSelectedEdge = async () => {
    if (!selectedEdge || !selectedSlug) return;
    setBusyAction(true);
    try {
      await deleteAdminEdge(selectedEdge.id);
      setSelectedEdgeId(null);
      const g = await getVenueGraph(selectedSlug);
      setGraph(g);
      showToast('Removed corridor edge.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete edge.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCrossFloorConnect = async () => {
    if (!selectedSlug || !connectFromNodeId || !crossFloorTargetId) return;
    setBusyAction(true);
    try {
      await createAdminEdge(selectedSlug, {
        source: connectFromNodeId,
        target: crossFloorTargetId,
        kind: edgeKind === 'walk' ? 'lift' : edgeKind,
        accessible: edgeAccessible,
        stretcher_ok: edgeStretcherOk,
      });
      setCrossFloorTargetId('');
      const g = await getVenueGraph(selectedSlug);
      setGraph(g);
      showToast('Connected cross-floor vertical shaft (Lift / Stairs)!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to connect floors.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !bldgName.trim()) return;
    setBusyAction(true);
    try {
      const created = await createAdminBuilding(selectedSlug, {
        name: bldgName.trim(),
        w: Number(bldgW) || 60,
        d: Number(bldgD) || 42,
        x: Number(bldgX) || 0,
        y: Number(bldgY) || 0,
      });
      setBldgName('');
      setShowAddBuilding(false);
      await loadMapBundle();
      setSelectedBuildingId(created.id);
      await refreshVenues();
      showToast(`Added building "${created.name}"!`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create building.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateFloor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !activeBuilding) return;
    const lvl = Number(floorLevel);
    setBusyAction(true);
    try {
      await createAdminFloor(selectedSlug, {
        building_id: activeBuilding.id,
        level: lvl,
        name: floorName.trim() || undefined,
      });
      setFloorName('');
      setShowAddFloor(false);
      await loadMapBundle();
      setSelectedLevel(lvl);
      await refreshVenues();
      showToast(`Added ${formatLevel(lvl)} to ${activeBuilding.name}!`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add floor.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleUploadBlueprint = async (file: File | undefined) => {
    if (!file || !activeFloor || !selectedSlug) return;
    setBusyAction(true);
    try {
      await uploadFloorBlueprint(activeFloor.id, file);
      const v = await getVenue(selectedSlug);
      setVenue(v);
      showToast(`Blueprint uploaded underneath ${activeFloor.name}!`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Blueprint upload failed.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleUploadCover = async (file: File | undefined) => {
    if (!file || !selectedSlug) return;
    setBusyAction(true);
    try {
      await uploadAdminVenueCover(selectedSlug, file);
      await loadMapBundle();
      await refreshVenues();
      showToast('Venue cover photo updated!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cover upload failed.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSetSpecialVenueNode = async (
    field: 'entrance_node_id' | 'emergency_node_id',
    nodeId: string,
  ) => {
    if (!selectedSlug) return;
    try {
      await updateAdminVenue(selectedSlug, { [field]: nodeId || null });
      const v = await getVenue(selectedSlug);
      setVenue(v);
      showToast(
        field === 'entrance_node_id'
          ? 'Updated Main Entrance pin!'
          : 'Updated Emergency Destination pin!',
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not update venue setting.');
    }
  };

  const handleDeleteCurrentVenue = async () => {
    if (!venue) return;
    if (
      !window.confirm(
        `Permanently delete venue "${venue.name}" and all its mapped nodes and uploaded photos?`,
      )
    ) {
      return;
    }
    setBusyAction(true);
    try {
      await deleteAdminVenue(venue.slug);
      await refreshVenues();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete venue.');
    } finally {
      setBusyAction(false);
    }
  };

  if (!selectedSlug) {
    return (
      <div className="card p-10 text-center space-y-3 max-w-2xl mx-auto mt-8">
        <Sparkles className="h-8 w-8 text-indigo-600 mx-auto" />
        <h2 className="font-display text-xl font-extrabold text-slate-950">
          Create Your First Venue Map
        </h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Click <strong>"+ New Venue Map"</strong> in the left sidebar to initialize a clean venue workspace with zero fake demo images, then upload your floorplan and drop pins!
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm text-slate-500">
          Opening Visual Map Builder...
        </p>
      </div>
    );
  }

  if (error || !venue || !graph) {
    return (
      <ErrorState
        message={error || 'Unable to load map editor.'}
        onRetry={() => void loadMapBundle()}
      />
    );
  }

  const connectFromNode = connectFromNodeId
    ? graph.nodes.find((n) => n.id === connectFromNodeId) ?? null
    : null;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Top Studio Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-extrabold text-slate-950">
              Visual Map Builder · {venue.name}
            </h1>
            <span className="chip bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200">
              {graph.nodes.length} Pins · {graph.edges.length} Paths ·{' '}
              {venue.stats.photos} Real Photos
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload architectural floorplan blueprints, drop room/corridor pins, attach real camera-angled photos, and connect walkable/lift paths.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void handleUploadCover(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            className="btn-ghost text-xs py-2"
          >
            <ImageIcon className="h-3.5 w-3.5 text-indigo-600" />
            Upload Venue Cover
          </button>

          <button
            type="button"
            disabled={busyAction}
            onClick={async () => {
              setBusyAction(true);
              try {
                const rep = await rebuildAdminIndex(venue.slug);
                showToast(
                  `AI Index rebuilt (${rep.photos} photos · Top-1: ${Math.round(rep.top1 * 100)}%)`,
                );
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Rebuild failed.');
              } finally {
                setBusyAction(false);
              }
            }}
            className="btn-primary text-xs py-2"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Rebuild AI Index
          </button>

          <button
            type="button"
            disabled={busyAction}
            onClick={() => void handleDeleteCurrentVenue()}
            className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-600 hover:text-white transition"
            title="Delete venue"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {toast && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-950 px-4 py-2.5 text-xs font-bold text-emerald-200 shadow-lg ring-1 ring-emerald-400/40">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Building, Floor & Blueprint Management Bar */}
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Building Selector */}
          <div className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4 text-indigo-600" />
            <select
              value={activeBuilding?.id || ''}
              onChange={(e) => {
                const b = venue.buildings.find((x) => x.id === e.target.value);
                setSelectedBuildingId(e.target.value);
                if (b && b.floors[0]) setSelectedLevel(b.floors[0].level);
              }}
              className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-900 ring-1 ring-slate-200"
            >
              {venue.buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  Building: {b.name} ({b.w}m × {b.d}m)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowAddBuilding((v) => !v)}
              className="rounded-xl bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
            >
              + Building
            </button>
          </div>

          {/* Floor Selector */}
          {activeBuilding && (
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-cyan-600" />
              <select
                value={String(selectedLevel)}
                onChange={(e) => setSelectedLevel(Number(e.target.value))}
                className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-900 ring-1 ring-slate-200"
              >
                {activeBuilding.floors
                  .slice()
                  .sort((a, b) => a.level - b.level)
                  .map((f) => (
                    <option key={f.id} value={String(f.level)}>
                      {formatLevel(f.level, f.name)}
                      {f.blueprint_url ? ' (Blueprint ✓)' : ''}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => setShowAddFloor((v) => !v)}
                className="rounded-xl bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-800 ring-1 ring-cyan-200 hover:bg-cyan-100"
              >
                + Floor
              </button>
            </div>
          )}

          {/* Blueprint Uploader */}
          {activeFloor && (
            <>
              <input
                ref={blueprintInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void handleUploadBlueprint(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => blueprintInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
              >
                <Upload className="h-3.5 w-3.5 text-cyan-400" />
                {activeFloor.blueprint_url
                  ? 'Replace Floor Blueprint'
                  : 'Upload Floorplan Blueprint'}
              </button>
            </>
          )}
        </div>

        {/* Entrance / Emergency Default Selectors */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={venue.entrance_node_id || ''}
            onChange={(e) =>
              void handleSetSpecialVenueNode('entrance_node_id', e.target.value)
            }
            className="rounded-xl bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
            title="Default Main Entrance"
          >
            <option value="">Main Entrance: Auto</option>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                Entrance: {n.name}
              </option>
            ))}
          </select>

          <select
            value={venue.emergency_node_id || ''}
            onChange={(e) =>
              void handleSetSpecialVenueNode('emergency_node_id', e.target.value)
            }
            className="rounded-xl bg-rose-50/70 px-2.5 py-1.5 text-xs font-semibold text-rose-800 ring-1 ring-rose-200"
            title="Emergency SOS Destination"
          >
            <option value="">SOS Target: None</option>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                SOS: {n.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Optional Add Building / Add Floor Inline Forms */}
      {showAddBuilding && (
        <form
          onSubmit={(e) => void handleCreateBuilding(e)}
          className="card p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end bg-indigo-50/40"
        >
          <div className="col-span-2">
            <label className="label">Building Name *</label>
            <input
              type="text"
              required
              value={bldgName}
              onChange={(e) => setBldgName(e.target.value)}
              placeholder="e.g., Block B / Science Wing"
              className="input py-2 text-xs"
            />
          </div>
          <div>
            <label className="label">Width (m)</label>
            <input
              type="number"
              value={bldgW}
              onChange={(e) => setBldgW(e.target.value)}
              className="input py-2 text-xs"
            />
          </div>
          <div>
            <label className="label">Depth (m)</label>
            <input
              type="number"
              value={bldgD}
              onChange={(e) => setBldgD(e.target.value)}
              className="input py-2 text-xs"
            />
          </div>
          <div>
            <label className="label">Offset X / Y (m)</label>
            <div className="flex gap-1">
              <input
                type="number"
                value={bldgX}
                onChange={(e) => setBldgX(e.target.value)}
                placeholder="X"
                className="input py-2 text-xs"
              />
              <input
                type="number"
                value={bldgY}
                onChange={(e) => setBldgY(e.target.value)}
                placeholder="Y"
                className="input py-2 text-xs"
              />
            </div>
          </div>
          <div className="flex gap-1.5">
            <button type="submit" className="btn-indigo py-2 px-3 text-xs flex-1">
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowAddBuilding(false)}
              className="btn-ghost py-2 px-2.5 text-xs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      )}

      {showAddFloor && activeBuilding && (
        <form
          onSubmit={(e) => void handleCreateFloor(e)}
          className="card p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end bg-cyan-50/40"
        >
          <div>
            <label className="label">Numeric Level (-1 = Basement, 0 = Ground)</label>
            <input
              type="number"
              required
              value={floorLevel}
              onChange={(e) => setFloorLevel(e.target.value)}
              className="input py-2 text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Floor Display Name</label>
            <input
              type="text"
              value={floorName}
              onChange={(e) => setFloorName(e.target.value)}
              placeholder="e.g., First Floor - Diagnostics"
              className="input py-2 text-xs"
            />
          </div>
          <div className="flex gap-1.5">
            <button type="submit" className="btn-primary py-2 px-4 text-xs flex-1">
              Create Floor
            </button>
            <button
              type="button"
              onClick={() => setShowAddFloor(false)}
              className="btn-ghost py-2 px-2.5 text-xs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      )}

      {/* Main Split: Left 2D Interactive Map Canvas + Right Inspector / Creator Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT: Interactive 2D Map Canvas */}
        <div className="lg:col-span-8 card p-4 space-y-3">
          {/* 3-Mode Editor Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setEditorMode('select');
                  setConnectFromNodeId(null);
                  setPendingCoords(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  editorMode === 'select'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MousePointer className="h-3.5 w-3.5" />
                1. Select / Drag Pins
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditorMode('add_node');
                  setConnectFromNodeId(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  editorMode === 'add_node'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Crosshair className="h-3.5 w-3.5" />
                2. Click to Drop Pin + Photo
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditorMode('connect');
                  setPendingCoords(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  editorMode === 'connect'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <GitCommit className="h-3.5 w-3.5" />
                3. Connect Walk / Lift Paths
              </button>
            </div>

            {editorMode === 'connect' && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={edgeKind}
                  onChange={(e) => setEdgeKind(e.target.value as EdgeKind)}
                  className="rounded-lg bg-indigo-50 px-2.5 py-1 font-bold text-indigo-800 ring-1 ring-indigo-200"
                >
                  <option value="walk">Corridor Walk</option>
                  <option value="door">Room Doorway</option>
                  <option value="lift">Elevator / Lift</option>
                  <option value="stairs">Staircase</option>
                  <option value="outdoor">Outdoor Walkway</option>
                </select>

                <label className="inline-flex items-center gap-1 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={edgeAccessible}
                    onChange={(e) => setEdgeAccessible(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  ♿ Accessible
                </label>

                <label className="inline-flex items-center gap-1 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={edgeStretcherOk}
                    onChange={(e) => setEdgeStretcherOk(e.target.checked)}
                    className="rounded text-amber-600"
                  />
                  🛏️ Stretcher
                </label>
              </div>
            )}
          </div>

          {/* Interactive SVG Canvas */}
          <div className="h-[490px] w-full">
            <FloorPlan2D
              venue={venue}
              graph={graph}
              selectedLevel={selectedLevel}
              onChangeLevel={(lvl) => setSelectedLevel(lvl)}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              editorMode={editorMode}
              connectFromNodeId={connectFromNodeId}
              onSelectNode={(n) => void handleNodeClickOnCanvas(n)}
              onSelectEdge={(edge: GEdge) => {
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
              }}
              onCanvasClick={handleCanvasClick}
              onNodeDragEnd={(node, x, y) => void handleNodeDragEnd(node, x, y)}
            />
          </div>
        </div>

        {/* RIGHT: Contextual Inspector / Pin Creator / Shaft Connector */}
        <div className="lg:col-span-4 space-y-4">
          {/* 1. ADD NODE QUICK DRAWER */}
          {editorMode === 'add_node' && (
            <div className="card p-5 space-y-4 ring-2 ring-emerald-500/50">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                    Drop New Spatial Pin
                  </span>
                  <h2 className="font-display text-base font-extrabold text-slate-950">
                    {pendingCoords
                      ? `Coordinates: (${pendingCoords.x}m, ${pendingCoords.y}m)`
                      : 'Click anywhere on the 2D floorplan'}
                  </h2>
                </div>
              </div>

              {!pendingCoords ? (
                <p className="text-xs text-slate-500 leading-relaxed">
                  Click on any room, doorway, corridor junction, lift, or staircase on the left blueprint to drop a pin at that exact spot.
                </p>
              ) : (
                <form onSubmit={(e) => void handleCreateNodeSubmit(e)} className="space-y-3">
                  <div>
                    <label className="label">Spot / Signboard Name *</label>
                    <input
                      type="text"
                      required
                      value={newNodeName}
                      onChange={(e) => setNewNodeName(e.target.value)}
                      placeholder="e.g., Room 104 - Radiology / Lift Lobby A"
                      className="input py-2 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="label">Node Kind</label>
                      <select
                        value={newNodeKind}
                        onChange={(e) => {
                          setNewNodeKind(e.target.value);
                          if (e.target.value === 'corridor') setNewNodeIsPlace(false);
                          else setNewNodeIsPlace(true);
                        }}
                        className="input py-2 text-xs"
                      >
                        {NODE_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Category</label>
                      <input
                        type="text"
                        value={newNodeCategory}
                        onChange={(e) => setNewNodeCategory(e.target.value)}
                        placeholder="diagnostics, labs..."
                        className="input py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label">Signboard / Search Keywords</label>
                    <input
                      type="text"
                      value={newNodeKeywords}
                      onChange={(e) => setNewNodeKeywords(e.target.value)}
                      placeholder="X-Ray, Scan, Block A, 104..."
                      className="input py-2 text-xs"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newNodeIsPlace}
                      onChange={(e) => setNewNodeIsPlace(e.target.checked)}
                      className="rounded text-emerald-600"
                    />
                    Show in public Places Directory
                  </label>

                  {/* Immediate Real Photo Attachment + Camera Compass Heading */}
                  <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 space-y-2.5">
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-cyan-600" />
                      Attach Real Reference Photos (Optional)
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) =>
                        setNewNodeFiles(
                          e.target.files ? Array.from(e.target.files) : [],
                        )
                      }
                      className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-900 file:px-2.5 file:py-1.5 file:text-xs file:font-bold file:text-white"
                    />
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Camera Facing Direction (for Step-1 Turn Hint)
                      </label>
                      <select
                        value={newNodeHeading}
                        onChange={(e) => setNewNodeHeading(e.target.value)}
                        className="input py-1.5 text-xs"
                      >
                        {COMPASS_HEADINGS.map((ch) => (
                          <option key={ch.label} value={ch.value}>
                            {ch.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={creatingNode}
                      className="btn-primary flex-1 py-2.5 text-xs font-extrabold"
                    >
                      {creatingNode ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Create Pin{newNodeFiles.length > 0 ? ` & Index ${newNodeFiles.length} Photo(s)` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingCoords(null)}
                      className="btn-ghost py-2.5 px-3 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* 2. CONNECT MODE HELPER + CROSS-FLOOR LIFT/STAIRS CONNECTOR */}
          {editorMode === 'connect' && (
            <div className="card p-5 space-y-4 ring-2 ring-indigo-500/50">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                  Path & Vertical Shaft Connector
                </span>
                <h2 className="font-display text-base font-extrabold text-slate-950 mt-0.5">
                  {connectFromNode
                    ? `Connecting from: ${connectFromNode.name}`
                    : 'Click first pin on the floorplan'}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Click Pin A then Pin B on the same floor to draw a walkable path — or use the Cross-Floor connector below to link lifts and stairs across floors!
                </p>
              </div>

              {connectFromNode && (
                <div className="rounded-2xl bg-indigo-50/70 p-3.5 ring-1 ring-indigo-200 space-y-2.5">
                  <div className="text-xs font-bold text-indigo-950">
                    Connect "{connectFromNode.name}" to Another Floor (Lift / Stairs):
                  </div>
                  <select
                    value={crossFloorTargetId}
                    onChange={(e) => setCrossFloorTargetId(e.target.value)}
                    className="input py-2 text-xs bg-white"
                  >
                    <option value="">Select pin on another floor...</option>
                    {graph.nodes
                      .filter((n) => n.id !== connectFromNode.id && n.level !== connectFromNode.level)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} ({n.building_name} · {formatLevel(n.level)})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!crossFloorTargetId || busyAction}
                    onClick={() => void handleCrossFloorConnect()}
                    className="btn-indigo w-full py-2 text-xs font-bold"
                  >
                    Link Cross-Floor Shaft
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3. SELECTED EDGE INSPECTOR */}
          {selectedEdge && (
            <div className="card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                  Selected Path Segment
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedEdgeId(null)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="text-sm font-bold text-slate-900">
                {graph.nodes.find((n) => n.id === selectedEdge.source)?.name || selectedEdge.source}{' '}
                ↔{' '}
                {graph.nodes.find((n) => n.id === selectedEdge.target)?.name || selectedEdge.target}
              </div>
              <div className="text-xs text-slate-600 flex flex-wrap gap-2">
                <span className="chip bg-slate-100 text-slate-700">
                  Kind: {selectedEdge.kind}
                </span>
                <span className="chip bg-slate-100 text-slate-700">
                  {Math.round(selectedEdge.distance)} m
                </span>
                <span className="chip bg-emerald-50 text-emerald-800">
                  {selectedEdge.accessible ? '♿ Accessible' : 'Stairs Only'}
                </span>
              </div>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleDeleteSelectedEdge()}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 py-2 text-xs font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-600 hover:text-white transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Path Connection
              </button>
            </div>
          )}

          {/* 4. SELECTED NODE INSPECTOR & REAL PHOTO UPLOADER */}
          {selectedNode && editorMode === 'select' && (
            <div className="card p-5 space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                    Selected Pin · {selectedNode.building_name} ·{' '}
                    {formatLevel(selectedNode.level)}
                  </span>
                  <h2 className="font-display text-lg font-extrabold text-slate-950">
                    {selectedNode.name}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Position: ({selectedNode.x}m, {selectedNode.y}m) · Drag pin on map to reposition
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {selectedNode.photo_url && (
                <div className="relative h-32 w-full overflow-hidden rounded-2xl bg-slate-900">
                  <img
                    src={mediaUrl(selectedNode.photo_url)}
                    alt={selectedNode.name}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute right-2 top-2 rounded-md bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                    {selectedNode.photo_count} Real Photo{selectedNode.photo_count === 1 ? '' : 's'}
                  </span>
                </div>
              )}

              {/* Quick Photo Upload with Compass Heading */}
              <div className="rounded-2xl bg-cyan-50/60 p-3.5 ring-1 ring-cyan-200/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5 text-cyan-600" />
                    Upload Real Photos for This Spot
                  </span>
                  <span className="text-[11px] font-semibold text-cyan-800">
                    {selectedNode.photo_count} indexed
                  </span>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Camera Compass Heading
                  </label>
                  <div className="relative">
                    <Compass className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <select
                      value={inspectorHeading}
                      onChange={(e) => setInspectorHeading(e.target.value)}
                      className="input pl-8 py-1.5 text-xs bg-white"
                    >
                      {COMPASS_HEADINGS.map((ch) => (
                        <option key={ch.label} value={ch.value}>
                          {ch.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <input
                  ref={inspectorPhotoRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleUploadPhotosForSelectedNode(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={uploadingPhotos}
                  onClick={() => inspectorPhotoRef.current?.click()}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2 text-xs font-bold text-white hover:bg-indigo-600 transition"
                >
                  {uploadingPhotos ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 text-cyan-400" />
                  )}
                  {uploadingPhotos ? 'Indexing & Face-Blurring...' : 'Select Photos to Index'}
                </button>
              </div>

              {/* Edit Pin Metadata Form */}
              <form onSubmit={(e) => void handleSaveSelectedNode(e)} className="space-y-3">
                <div>
                  <label className="label">Name</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="input py-2 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Kind</label>
                    <select
                      value={editKind}
                      onChange={(e) => setEditKind(e.target.value)}
                      className="input py-2 text-xs"
                    >
                      {NODE_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Category</label>
                    <input
                      type="text"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="input py-2 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">OCR / Search Keywords</label>
                  <input
                    type="text"
                    value={editKeywords}
                    onChange={(e) => setEditKeywords(e.target.value)}
                    className="input py-2 text-xs"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsPlace}
                    onChange={(e) => setEditIsPlace(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  Listed as destination in public directory
                </label>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={savingNode}
                    className="btn-indigo flex-1 py-2 text-xs font-bold"
                  >
                    {savingNode ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save Pin
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleDeleteSelectedNode()}
                    className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-600 hover:text-white transition"
                    title="Delete pin"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Default Quick-Guide Card when nothing is selected */}
          {editorMode === 'select' && !selectedNode && !selectedEdge && (
            <div className="card p-5 space-y-3 bg-slate-50/70">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-indigo-600">
                <MapPin className="h-4 w-4" />
                3-Step Creator Workflow
              </div>
              <ol className="space-y-2 text-xs text-slate-600 list-decimal list-inside leading-relaxed">
                <li>
                  <strong>Upload Floor Blueprint:</strong> Optional PNG/JPG architectural drawing rendered underneath your pins.
                </li>
                <li>
                  <strong>Drop Pins & Upload Real Photos:</strong> Switch to{' '}
                  <em>"2. Click to Drop Pin + Photo"</em> to place rooms, corridors, lifts, exits, and attach real camera photos.
                </li>
                <li>
                  <strong>Connect Walkable & Lift Paths:</strong> Switch to{' '}
                  <em>"3. Connect Walk / Lift Paths"</em> to link corridors and multi-floor shafts, then click <strong>Rebuild AI Index</strong>!
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

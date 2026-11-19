import React, { useMemo, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { CoverageLevel, GEdge, GNode, Graph, VenueDetail } from '../lib/types';
import { mediaUrl } from '../lib/api';
import { formatLevel } from '../lib/locationStore';

export interface FloorPlan2DProps {
  venue: VenueDetail;
  graph: Graph;
  selectedLevel: number;
  onChangeLevel?: (level: number) => void;
  selectedNodeId?: string | null;
  startNodeId?: string | null;
  endNodeId?: string | null;
  routePath?: string[];
  walkerNodeId?: string | null;
  headingDeg?: number | null;
  coverageByNode?: Record<string, CoverageLevel>;
  selectedEdgeId?: string | null;
  onSelectNode?: (node: GNode) => void;
  onSelectEdge?: (edge: GEdge) => void;
  dark?: boolean;
  // Interactive Map Builder extensions
  editorMode?: 'view' | 'select' | 'add_node' | 'connect';
  connectFromNodeId?: string | null;
  onCanvasClick?: (x: number, y: number) => void;
  onNodeDragEnd?: (node: GNode, x: number, y: number) => void;
}

function getRoomZoneTheme(
  n: GNode,
  dark: boolean,
): { fill: string; stroke: string; badge: string; glyph: string } {
  const k = `${n.kind} ${n.category}`.toLowerCase();
  if (k.includes('emergency') || k.includes('exit')) {
    return {
      fill: dark ? 'rgba(244, 63, 94, 0.14)' : 'rgba(255, 228, 230, 0.85)',
      stroke: dark ? '#fb7185' : '#f43f5e',
      badge: '#e11d48',
      glyph: '!',
    };
  }
  if (k.includes('entrance') || k.includes('reception') || k.includes('lobby')) {
    return {
      fill: dark ? 'rgba(16, 185, 129, 0.14)' : 'rgba(209, 250, 229, 0.82)',
      stroke: dark ? '#34d399' : '#10b981',
      badge: '#059669',
      glyph: 'E',
    };
  }
  if (k.includes('lift') || k.includes('elevator')) {
    return {
      fill: dark ? 'rgba(6, 182, 212, 0.16)' : 'rgba(207, 250, 254, 0.88)',
      stroke: dark ? '#22d3ee' : '#06b6d4',
      badge: '#0891b2',
      glyph: '↕',
    };
  }
  if (k.includes('stair')) {
    return {
      fill: dark ? 'rgba(245, 158, 11, 0.16)' : 'rgba(254, 243, 199, 0.88)',
      stroke: dark ? '#fbbf24' : '#f59e0b',
      badge: '#d97706',
      glyph: '≡',
    };
  }
  if (k.includes('washroom') || k.includes('toilet') || k.includes('restroom')) {
    return {
      fill: dark ? 'rgba(168, 85, 247, 0.15)' : 'rgba(243, 232, 255, 0.86)',
      stroke: dark ? '#c084fc' : '#a855f7',
      badge: '#9333ea',
      glyph: 'W',
    };
  }
  if (k.includes('cafe') || k.includes('mess') || k.includes('food')) {
    return {
      fill: dark ? 'rgba(249, 115, 22, 0.14)' : 'rgba(255, 237, 213, 0.86)',
      stroke: dark ? '#fb923c' : '#f97316',
      badge: '#ea580c',
      glyph: '☕',
    };
  }
  if (k.includes('pharmacy') || k.includes('lab') || k.includes('medical') || k.includes('ward')) {
    return {
      fill: dark ? 'rgba(20, 184, 166, 0.14)' : 'rgba(204, 251, 241, 0.82)',
      stroke: dark ? '#2dd4bf' : '#14b8a6',
      badge: '#0d9488',
      glyph: '+',
    };
  }
  return {
    fill: dark ? 'rgba(56, 189, 248, 0.11)' : 'rgba(238, 242, 255, 0.82)',
    stroke: dark ? '#38bdf8' : '#818cf8',
    badge: '#4f46e5',
    glyph: '',
  };
}

export const FloorPlan2D: React.FC<FloorPlan2DProps> = ({
  venue,
  graph,
  selectedLevel,
  onChangeLevel,
  selectedNodeId,
  startNodeId,
  endNodeId,
  routePath = [],
  walkerNodeId,
  headingDeg = null,
  coverageByNode,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  dark = false,
  editorMode = 'view',
  connectFromNodeId = null,
  onCanvasClick,
  onNodeDragEnd,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingPan, setDraggingPan] = useState<{
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [draggingNode, setDraggingNode] = useState<{
    node: GNode;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(
    null,
  );
  const touchRef = useRef<{
    startX: number;
    startY: number;
    initPan: { x: number; y: number };
    initDist?: number;
    initZoom?: number;
  } | null>(null);

  const isEditing = editorMode !== 'view';

  const clientToSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const res = pt.matrixTransform(ctm.inverse());
    return {
      x: Math.round(res.x * 10) / 10,
      y: Math.round(res.y * 10) / 10,
    };
  };

  const levels = useMemo(() => {
    const s = new Set<number>();
    venue.buildings.forEach((b) => b.floors.forEach((f) => s.add(f.level)));
    graph.nodes.forEach((n) => s.add(n.level));
    const arr = Array.from(s).sort((a, b) => a - b);
    return arr.length > 0 ? arr : [0];
  }, [venue.buildings, graph.nodes]);

  const bounds = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const b of venue.buildings) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.w);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y + b.d);
    }
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }

    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 100;
      minY = 0;
      maxY = 100;
    }

    const padX = Math.max((maxX - minX) * 0.1, 8);
    const padY = Math.max((maxY - minY) * 0.1, 8);
    return {
      x: minX - padX,
      y: minY - padY,
      w: Math.max(maxX - minX + padX * 2, 20),
      h: Math.max(maxY - minY + padY * 2, 20),
    };
  }, [venue.buildings, graph.nodes]);

  const unit = useMemo(() => Math.max(bounds.w, bounds.h) / 100, [bounds]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, GNode>();
    graph.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [graph.nodes]);

  const floorBuildings = useMemo(
    () =>
      venue.buildings.filter((b) =>
        b.floors.some((f) => f.level === selectedLevel),
      ),
    [venue.buildings, selectedLevel],
  );

  const floorNodes = useMemo(
    () => graph.nodes.filter((n) => n.level === selectedLevel),
    [graph.nodes, selectedLevel],
  );

  const floorEdges = useMemo(
    () =>
      graph.edges.filter((e) => {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        return s && t && s.level === selectedLevel && t.level === selectedLevel;
      }),
    [graph.edges, nodeMap, selectedLevel],
  );

  const floorRouteSegments = useMemo(() => {
    const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < routePath.length - 1; i++) {
      const a = nodeMap.get(routePath[i]);
      const b = nodeMap.get(routePath[i + 1]);
      if (a && b && a.level === selectedLevel && b.level === selectedLevel) {
        segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    return segs;
  }, [routePath, nodeMap, selectedLevel]);

  const routeNodeSet = useMemo(() => new Set(routePath), [routePath]);

  const fillForNode = (n: GNode): string => {
    if (n.id === connectFromNodeId) return '#f59e0b';
    if (coverageByNode) {
      const cov = coverageByNode[n.id] ?? 'none';
      if (cov === 'good') return '#10b981';
      if (cov === 'low') return '#f59e0b';
      return '#f43f5e';
    }
    if (n.id === startNodeId) return '#0284c7';
    if (n.id === endNodeId) return '#e11d48';
    if (n.id === selectedNodeId) return '#7c3aed';
    const k = n.kind.toLowerCase();
    if (k.includes('emergency')) return '#ef4444';
    if (k.includes('lift')) return '#06b6d4';
    if (k.includes('stair')) return '#f59e0b';
    if (k.includes('entrance') || k.includes('exit')) return '#10b981';
    if (!n.is_place) return dark ? '#64748b' : '#94a3b8';
    return dark ? '#38bdf8' : '#4f46e5';
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const connectSourceNode = connectFromNodeId
    ? nodeMap.get(connectFromNodeId) ?? null
    : null;

  // Compute facing view-cone angle (degrees where 0° = North / -Y) for the Google-Maps-style "You Are Here" cone
  const activeRadarNodeId = walkerNodeId || startNodeId || null;
  const facingAngleDeg = useMemo(() => {
    if (typeof headingDeg === 'number' && Number.isFinite(headingDeg)) {
      return headingDeg;
    }
    if (activeRadarNodeId && routePath.length >= 2) {
      const idx = routePath.indexOf(activeRadarNodeId);
      const nextId =
        idx >= 0 && idx < routePath.length - 1
          ? routePath[idx + 1]
          : idx > 0
            ? routePath[idx - 1]
            : null;
      const curN = nodeMap.get(activeRadarNodeId);
      const nxtN = nextId ? nodeMap.get(nextId) : null;
      if (curN && nxtN && curN.level === nxtN.level) {
        const dx = nxtN.x - curN.x;
        const dy = nxtN.y - curN.y;
        if (Math.hypot(dx, dy) > 0.05) {
          return (Math.atan2(dx, -dy) * 180) / Math.PI;
        }
      }
    }
    return 0;
  }, [headingDeg, activeRadarNodeId, routePath, nodeMap]);

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-2xl select-none ${
        dark
          ? 'bg-[#080E1F] text-white ring-1 ring-white/10 spatial-grid-dark'
          : 'bg-slate-50 text-slate-900 ring-1 ring-slate-200/90 spatial-grid-light'
      }`}
    >
      {/* Top Floor & Zoom Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 z-10 ${
          dark
            ? 'border-white/10 bg-[#0B1228]/90'
            : 'border-slate-200/80 bg-white/90 backdrop-blur-md'
        }`}
      >
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {levels.map((lvl) => {
            const active = lvl === selectedLevel;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => onChangeLevel?.(lvl)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  active
                    ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-sm'
                    : dark
                      ? 'text-slate-300 hover:bg-white/10'
                      : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {formatLevel(lvl)}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          {isEditing && cursorWorld && (
            <span className="mr-2 rounded-md bg-slate-900/80 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
              x:{cursorWorld.x.toFixed(1)}, y:{cursorWorld.y.toFixed(1)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3.4, +(z + 0.25).toFixed(2)))}
            className={`rounded-lg p-1.5 transition ${
              dark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
            }`}
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.65, +(z - 0.25).toFixed(2)))}
            className={`rounded-lg p-1.5 transition ${
              dark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
            }`}
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetView}
            className={`rounded-lg p-1.5 transition ${
              dark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
            }`}
            title="Reset view"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Interactive SVG Blueprint */}
      <div
        style={{ touchAction: 'none' }}
        className={`relative flex-1 overflow-hidden ${
          editorMode === 'add_node'
            ? 'cursor-crosshair'
            : editorMode === 'connect'
              ? 'cursor-pointer'
              : 'cursor-grab active:cursor-grabbing'
        }`}
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.16 : -0.16;
          setZoom((z) => Math.max(0.65, Math.min(3.8, +(z + delta).toFixed(2))));
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            const t = e.touches[0];
            touchRef.current = {
              startX: t.clientX,
              startY: t.clientY,
              initPan: { ...pan },
            };
          } else if (e.touches.length === 2) {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            touchRef.current = {
              startX: (t1.clientX + t2.clientX) / 2,
              startY: (t1.clientY + t2.clientY) / 2,
              initPan: { ...pan },
              initDist: dist,
              initZoom: zoom,
            };
          }
        }}
        onTouchMove={(e) => {
          if (!touchRef.current) return;
          if (e.touches.length === 1 && touchRef.current.initDist === undefined) {
            const t = e.touches[0];
            const dx = t.clientX - touchRef.current.startX;
            const dy = t.clientY - touchRef.current.startY;
            setPan({
              x: touchRef.current.initPan.x + dx,
              y: touchRef.current.initPan.y + dy,
            });
          } else if (e.touches.length === 2 && touchRef.current.initDist && touchRef.current.initZoom) {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            const scale = dist / touchRef.current.initDist;
            const nextZoom = Math.max(0.6, Math.min(4.0, touchRef.current.initZoom * scale));
            setZoom(nextZoom);
          }
        }}
        onTouchEnd={() => {
          touchRef.current = null;
        }}
        onMouseDown={(e) => {
          if (draggingNode) return;
          setDraggingPan({
            startX: e.clientX - pan.x,
            startY: e.clientY - pan.y,
            moved: false,
          });
        }}
        onMouseMove={(e) => {
          if (isEditing) {
            const wpt = clientToSvgPoint(e.clientX, e.clientY);
            if (wpt) setCursorWorld(wpt);
          }

          if (draggingNode) {
            const wpt = clientToSvgPoint(e.clientX, e.clientY);
            if (wpt) {
              setDraggingNode({
                ...draggingNode,
                x: wpt.x,
                y: wpt.y,
                moved: true,
              });
            }
            return;
          }

          if (draggingPan) {
            const nx = e.clientX - draggingPan.startX;
            const ny = e.clientY - draggingPan.startY;
            const dist = Math.hypot(nx - pan.x, ny - pan.y);
            if (dist > 3) {
              setPan({ x: nx, y: ny });
              if (!draggingPan.moved) {
                setDraggingPan({ ...draggingPan, moved: true });
              }
            }
          }
        }}
        onMouseUp={(e) => {
          if (draggingNode) {
            const dn = draggingNode;
            setDraggingNode(null);
            if (dn.moved && onNodeDragEnd) {
              onNodeDragEnd(dn.node, dn.x, dn.y);
            }
            return;
          }
          const wasMoved = draggingPan?.moved ?? false;
          setDraggingPan(null);
          if (!wasMoved && editorMode === 'add_node' && onCanvasClick) {
            const pt = clientToSvgPoint(e.clientX, e.clientY);
            if (pt) onCanvasClick(pt.x, pt.y);
          }
        }}
        onMouseLeave={() => {
          setDraggingPan(null);
          setDraggingNode(null);
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
          className="h-full w-full will-change-transform"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <defs>
            {/* Google-Maps-Style Facing View Cone Gradient */}
            <radialGradient id="viewConeGrad" cx="50%" cy="100%" r="100%">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.45" />
              <stop offset="65%" stopColor="#38bdf8" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </radialGradient>
            {/* Admin Studio Coverage Heatmap Radial Glows */}
            <radialGradient id="covGoodGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="covLowGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="covNoneGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Building Footprints + Optional Uploaded Floorplan Blueprint Image */}
          {floorBuildings.map((b) => {
            const fl = b.floors.find((f) => f.level === selectedLevel);
            return (
              <g key={b.id}>
                {/* Subtle Architectural Floorplate Drop-Shadow */}
                <rect
                  x={b.x + unit * 0.45}
                  y={b.y + unit * 0.55}
                  width={b.w}
                  height={b.d}
                  rx={unit * 1.35}
                  fill={dark ? '#020617' : '#cbd5e1'}
                  opacity={dark ? 0.55 : 0.4}
                />
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.d}
                  rx={unit * 1.25}
                  fill={dark ? '#0f172a' : '#ffffff'}
                  stroke={dark ? '#38bdf8' : '#94a3b8'}
                  strokeOpacity={dark ? 0.48 : 0.72}
                  strokeWidth={unit * 0.4}
                />
                {/* Inner Architectural Wall Frame */}
                <rect
                  x={b.x + unit * 0.6}
                  y={b.y + unit * 0.6}
                  width={Math.max(0, b.w - unit * 1.2)}
                  height={Math.max(0, b.d - unit * 1.2)}
                  rx={unit * 0.9}
                  fill="none"
                  stroke={dark ? '#1e293b' : '#e2e8f0'}
                  strokeWidth={unit * 0.18}
                />
                {fl?.blueprint_url && (
                  <image
                    href={mediaUrl(fl.blueprint_url)}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.d}
                    preserveAspectRatio="none"
                    opacity={dark ? 0.48 : 0.72}
                  />
                )}
                <text
                  x={b.x + unit * 0.6}
                  y={b.y - unit * 0.9}
                  fill={dark ? '#93c5fd' : '#475569'}
                  fontSize={unit * 1.55}
                  fontWeight={800}
                >
                  {b.name} {fl ? `· ${fl.name}` : ''}
                </text>
              </g>
            );
          })}

          {/* Architectural Wide Hallway Corridor Strips (Background Layer) */}
          {floorEdges.map((e) => {
            if (e.closed) return null;
            const sRaw = nodeMap.get(e.source);
            const tRaw = nodeMap.get(e.target);
            if (!sRaw || !tRaw) return null;
            const sx = draggingNode && draggingNode.node.id === sRaw.id ? draggingNode.x : sRaw.x;
            const sy = draggingNode && draggingNode.node.id === sRaw.id ? draggingNode.y : sRaw.y;
            const tx = draggingNode && draggingNode.node.id === tRaw.id ? draggingNode.x : tRaw.x;
            const ty = draggingNode && draggingNode.node.id === tRaw.id ? draggingNode.y : tRaw.y;
            return (
              <line
                key={`cor-${e.id}`}
                x1={sx}
                y1={sy}
                x2={tx}
                y2={ty}
                stroke={dark ? '#1e293b' : '#f1f5f9'}
                strokeWidth={unit * 2.9}
                strokeLinecap="round"
                pointerEvents="none"
              />
            );
          })}

          {/* Color-Coded Architectural Room Zone Blocks & Walls */}
          {floorNodes.map((n) => {
            if (!n.is_place) return null;
            const drawX = draggingNode && draggingNode.node.id === n.id ? draggingNode.x : n.x;
            const drawY = draggingNode && draggingNode.node.id === n.id ? draggingNode.y : n.y;
            const zone = getRoomZoneTheme(n, dark);
            const kLow = n.kind.toLowerCase();
            const isLarge =
              kLow.includes('lobby') ||
              kLow.includes('entrance') ||
              kLow.includes('ward') ||
              kLow.includes('cafe') ||
              kLow.includes('mess');
            const rw = isLarge ? unit * 6.8 : unit * 5.2;
            const rh = isLarge ? unit * 4.6 : unit * 3.8;
            const isHighlighted =
              n.id === startNodeId ||
              n.id === endNodeId ||
              n.id === selectedNodeId ||
              routeNodeSet.has(n.id);

            return (
              <g
                key={`zone-${n.id}`}
                transform={`translate(${drawX}, ${drawY})`}
                pointerEvents="none"
              >
                <rect
                  x={-rw / 2}
                  y={-rh / 2}
                  width={rw}
                  height={rh}
                  rx={unit * 0.72}
                  fill={zone.fill}
                  stroke={zone.stroke}
                  strokeOpacity={isHighlighted ? 0.92 : 0.45}
                  strokeWidth={isHighlighted ? unit * 0.3 : unit * 0.2}
                />
                {/* Top Zone Accent Bar */}
                <rect
                  x={-rw / 2 + unit * 0.6}
                  y={-rh / 2}
                  width={rw - unit * 1.2}
                  height={unit * 0.32}
                  rx={unit * 0.16}
                  fill={zone.stroke}
                  opacity={0.75}
                />
              </g>
            );
          })}

          {/* Admin Coverage Heatmap Glow Overlay (Only when coverageByNode is active) */}
          {coverageByNode &&
            floorNodes.map((n) => {
              const cov = coverageByNode[n.id] ?? 'none';
              const drawX = draggingNode && draggingNode.node.id === n.id ? draggingNode.x : n.x;
              const drawY = draggingNode && draggingNode.node.id === n.id ? draggingNode.y : n.y;
              const gradId =
                cov === 'good'
                  ? 'url(#covGoodGrad)'
                  : cov === 'low'
                    ? 'url(#covLowGrad)'
                    : 'url(#covNoneGrad)';
              return (
                <circle
                  key={`heat-${n.id}`}
                  cx={drawX}
                  cy={drawY}
                  r={unit * 4.8}
                  fill={gradId}
                  pointerEvents="none"
                />
              );
            })}

          {/* Corridor & Transition Edges */}
          {floorEdges.map((e) => {
            const sRaw = nodeMap.get(e.source);
            const tRaw = nodeMap.get(e.target);
            if (!sRaw || !tRaw) return null;
            const sx =
              draggingNode && draggingNode.node.id === sRaw.id ? draggingNode.x : sRaw.x;
            const sy =
              draggingNode && draggingNode.node.id === sRaw.id ? draggingNode.y : sRaw.y;
            const tx =
              draggingNode && draggingNode.node.id === tRaw.id ? draggingNode.x : tRaw.x;
            const ty =
              draggingNode && draggingNode.node.id === tRaw.id ? draggingNode.y : tRaw.y;
            const isSelectedEdge = selectedEdgeId === e.id;
            const mx = (sx + tx) / 2;
            const my = (sy + ty) / 2;

            return (
              <g
                key={e.id}
                onClick={(ev) => {
                  if (onSelectEdge) {
                    ev.stopPropagation();
                    onSelectEdge(e);
                  }
                }}
                style={{ cursor: onSelectEdge ? 'pointer' : 'default' }}
              >
                {onSelectEdge && (
                  <line
                    x1={sx}
                    y1={sy}
                    x2={tx}
                    y2={ty}
                    stroke="transparent"
                    strokeWidth={unit * 2.5}
                  />
                )}
                <line
                  x1={sx}
                  y1={sy}
                  x2={tx}
                  y2={ty}
                  stroke={
                    e.closed
                      ? '#ef4444'
                      : isSelectedEdge
                        ? '#f59e0b'
                        : dark
                          ? '#475569'
                          : '#cbd5e1'
                  }
                  strokeWidth={e.closed || isSelectedEdge ? unit * 0.75 : unit * 0.42}
                  strokeDasharray={e.closed ? `${unit * 1.1} ${unit * 0.8}` : undefined}
                  strokeLinecap="round"
                />
                {e.closed && (
                  <g transform={`translate(${mx}, ${my})`}>
                    <circle r={unit * 1.15} fill="#ef4444" />
                    <text
                      textAnchor="middle"
                      dy={unit * 0.42}
                      fill="#ffffff"
                      fontSize={unit * 1.2}
                      fontWeight={800}
                    >
                      ×
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Live Rubber-Band Line in Connect Mode */}
          {editorMode === 'connect' &&
            connectSourceNode &&
            connectSourceNode.level === selectedLevel &&
            cursorWorld && (
              <line
                x1={connectSourceNode.x}
                y1={connectSourceNode.y}
                x2={cursorWorld.x}
                y2={cursorWorld.y}
                stroke="#f59e0b"
                strokeWidth={unit * 0.65}
                strokeDasharray={`${unit * 1.1} ${unit * 0.7}`}
                pointerEvents="none"
              />
            )}

          {/* Active Route Segments + Animated Directional Flow Chevrons + Gliding Pulse Particle */}
          {floorRouteSegments.map((seg, idx) => {
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            const len = Math.hypot(dx, dy);
            const angDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
            const midX = (seg.x1 + seg.x2) / 2;
            const midY = (seg.y1 + seg.y2) / 2;
            return (
              <g key={idx}>
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke="#06b6d4"
                  strokeOpacity={0.28}
                  strokeWidth={unit * 2.1}
                  strokeLinecap="round"
                />
                <line
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke="#0ea5e9"
                  strokeWidth={unit * 0.9}
                  strokeDasharray={`${unit * 1.5} ${unit * 0.95}`}
                  strokeLinecap="round"
                  className="route-dash"
                />
                {/* Crisp Directional Chevron Indicator at Segment Midpoint */}
                {len > unit * 3.5 && (
                  <g transform={`translate(${midX}, ${midY}) rotate(${angDeg})`}>
                    <path
                      d={`M ${-unit * 0.65} ${-unit * 0.65} L ${unit * 0.55} 0 L ${-unit * 0.65} ${unit * 0.65}`}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={unit * 0.42}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={`M ${-unit * 0.65} ${-unit * 0.65} L ${unit * 0.55} 0 L ${-unit * 0.65} ${unit * 0.65}`}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={unit * 0.22}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                )}
              </g>
            );
          })}

          {/* Hardware-Accelerated SVG Route Tracer Pulse Gliding Along Active Path */}
          {floorRouteSegments.length > 0 && (() => {
            const pathD = floorRouteSegments
              .map((seg, i) => (i === 0 ? `M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}` : `L ${seg.x2} ${seg.y2}`))
              .join(' ');
            const durSec = Math.max(2.6, Math.min(7.5, floorRouteSegments.length * 1.1));
            return (
              <g pointerEvents="none">
                <circle r={unit * 1.15} fill="#22d3ee" opacity="0.38">
                  <animateMotion dur={`${durSec}s`} repeatCount="indefinite" path={pathD} />
                </circle>
                <circle r={unit * 0.58} fill="#ffffff" stroke="#0284c7" strokeWidth={unit * 0.22}>
                  <animateMotion dur={`${durSec}s`} repeatCount="indefinite" path={pathD} />
                </circle>
              </g>
            );
          })()}

          {/* Floor Nodes + Google-Maps Radar Pulse & Facing View Cone */}
          {floorNodes.map((n) => {
            const isStart = n.id === startNodeId;
            const isEnd = n.id === endNodeId;
            const isSelected = n.id === selectedNodeId || n.id === connectFromNodeId;
            const isWalker = n.id === walkerNodeId;
            const isRadarAnchor = n.id === activeRadarNodeId && !coverageByNode;
            const inRoute = routeNodeSet.has(n.id);

            const drawX =
              draggingNode && draggingNode.node.id === n.id ? draggingNode.x : n.x;
            const drawY =
              draggingNode && draggingNode.node.id === n.id ? draggingNode.y : n.y;

            if (!n.is_place && !coverageByNode && !inRoute && !isSelected && !isEditing) {
              return (
                <circle
                  key={n.id}
                  cx={drawX}
                  cy={drawY}
                  r={unit * 0.42}
                  fill={dark ? '#475569' : '#94a3b8'}
                  opacity={0.55}
                />
              );
            }

            const fill = fillForNode(n);
            const zone = getRoomZoneTheme(n, dark);
            const r =
              isStart || isEnd || isSelected || isWalker
                ? unit * 1.48
                : n.is_place
                  ? unit * 1.08
                  : unit * 0.78;
            const showText = n.is_place || isStart || isEnd || isSelected || isEditing;
            const labelW = Math.max(unit * 4.5, n.name.length * unit * 0.74 + unit * 1.4);
            const pinGlyph = isEnd
              ? '★'
              : isStart || isWalker
                ? '●'
                : zone.glyph;

            return (
              <g
                key={n.id}
                transform={`translate(${drawX}, ${drawY})`}
                onMouseDown={(ev) => {
                  if (editorMode === 'select' && onNodeDragEnd) {
                    ev.stopPropagation();
                    setDraggingNode({
                      node: n,
                      x: n.x,
                      y: n.y,
                      moved: false,
                    });
                  }
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectNode?.(n);
                }}
                style={{
                  cursor: editorMode === 'select' && onNodeDragEnd ? 'move' : 'pointer',
                }}
              >
                {/* Google-Maps-Style Directional Facing View Cone + Animated Radar Ripple */}
                {isRadarAnchor && (
                  <>
                    <g transform={`rotate(${facingAngleDeg})`} pointerEvents="none">
                      <path
                        d={`M 0 0 L ${-unit * 3.1} ${-unit * 6.4} A ${unit * 7.1} ${unit * 7.1} 0 0 1 ${unit * 3.1} ${-unit * 6.4} Z`}
                        fill="url(#viewConeGrad)"
                      />
                    </g>
                    <circle
                      r={r * 1.45}
                      fill="#0ea5e9"
                      className="radar-ping-svg"
                      pointerEvents="none"
                    />
                  </>
                )}

                {(isStart || isEnd || isSelected || isWalker) && (
                  <circle
                    r={r * 1.85}
                    fill={isWalker ? '#22d3ee' : fill}
                    opacity={0.22}
                  />
                )}
                <circle
                  r={r}
                  fill={fill}
                  stroke={dark ? '#0f172a' : '#ffffff'}
                  strokeWidth={unit * 0.34}
                />
                {pinGlyph && (
                  <text
                    textAnchor="middle"
                    dy={unit * 0.38}
                    fill="#ffffff"
                    fontSize={r * 0.92}
                    fontWeight={800}
                    pointerEvents="none"
                  >
                    {pinGlyph}
                  </text>
                )}
                {showText && (
                  <g transform={`translate(0, ${r + unit * 1.35})`} pointerEvents="none">
                    <rect
                      x={-labelW / 2}
                      y={-unit * 1.05}
                      width={labelW}
                      height={unit * 1.95}
                      rx={unit * 0.65}
                      fill={dark ? 'rgba(15, 23, 42, 0.86)' : 'rgba(255, 255, 255, 0.92)'}
                      stroke={
                        isStart || isEnd || isSelected
                          ? fill
                          : dark
                            ? 'rgba(148, 163, 184, 0.25)'
                            : 'rgba(148, 163, 184, 0.35)'
                      }
                      strokeWidth={unit * 0.16}
                    />
                    <text
                      y={unit * 0.36}
                      textAnchor="middle"
                      fill={dark ? '#f1f5f9' : '#0f172a'}
                      fontSize={unit * 1.24}
                      fontWeight={isStart || isEnd || isSelected ? 800 : 700}
                    >
                      {n.name}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Architectural Compass Rose & Dynamic Scale Bar HUD */}
        <div
          className={`pointer-events-none absolute top-2.5 right-2.5 flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ring-1 backdrop-blur-md ${
            dark
              ? 'bg-slate-950/75 text-slate-200 ring-white/10'
              : 'bg-white/90 text-slate-700 ring-slate-200/80 shadow-sm'
          }`}
        >
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[9px] font-mono font-bold tracking-wider opacity-75">
              {Math.max(2, Math.round(12 / zoom))}m
            </span>
            <div className="flex items-center">
              <span className="h-1.5 w-[1.5px] bg-current opacity-60" />
              <span className="h-[1.5px] w-7 bg-current opacity-60" />
              <span className="h-1.5 w-[1.5px] bg-current opacity-60" />
            </div>
          </div>
          <svg viewBox="0 0 28 28" className="h-6 w-6 shrink-0" aria-hidden="true">
            <circle
              cx="14"
              cy="14"
              r="12"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.22"
              strokeWidth="1.2"
            />
            <polygon points="14,3 17,14 14,12 11,14" fill="#0ea5e9" />
            <polygon points="14,25 17,14 14,16 11,14" fill="currentColor" opacity="0.35" />
            <text
              x="14"
              y="10"
              textAnchor="middle"
              fontSize="5.5"
              fontWeight="800"
              fill={dark ? '#38bdf8' : '#0284c7'}
            >
              N
            </text>
          </svg>
        </div>

        {/* Interactive Stacked Isometric Floor Plate Selector (Multi-Floor Buildings) */}
        {levels.length > 1 && onChangeLevel && (
          <div
            className={`hidden sm:flex absolute right-2.5 top-1/2 -translate-y-1/2 flex-col-reverse gap-1 rounded-2xl p-1.5 ring-1 backdrop-blur-md z-10 ${
              dark
                ? 'bg-slate-950/80 ring-white/10'
                : 'bg-white/90 ring-slate-200/80 shadow-md'
            }`}
            title="Switch floor layer"
          >
            {levels.map((lvl) => {
              const active = lvl === selectedLevel;
              const hasRouteOnFloor = routePath.some((nid) => nodeMap.get(nid)?.level === lvl);
              return (
                <button
                  key={`stack-${lvl}`}
                  type="button"
                  onClick={() => onChangeLevel(lvl)}
                  className={`group relative flex items-center gap-1.5 rounded-xl px-2 py-1 text-[10px] font-extrabold transition ${
                    active
                      ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-sm'
                      : dark
                        ? 'text-slate-300 hover:bg-white/10'
                        : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <svg viewBox="0 0 20 12" className="h-3 w-4 shrink-0" aria-hidden="true">
                    <polygon
                      points="10,1 19,6 10,11 1,6"
                      fill={active ? '#ffffff' : 'currentColor'}
                      fillOpacity={active ? 0.9 : 0.3}
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  </svg>
                  <span>{lvl === 0 ? 'G' : `F${lvl}`}</span>
                  {hasRouteOnFloor && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Legend Footer */}
        <div
          className={`pointer-events-none absolute bottom-2.5 left-2.5 flex flex-wrap items-center gap-2.5 rounded-xl px-3 py-1.5 text-[11px] ring-1 backdrop-blur-md ${
            dark
              ? 'bg-slate-950/75 text-slate-300 ring-white/10'
              : 'bg-white/90 text-slate-600 ring-slate-200/80'
          }`}
        >
          {coverageByNode ? (
            <>
              <span className="inline-flex items-center gap-1 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Good (3+ photos)
              </span>
              <span className="inline-flex items-center gap-1 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Low (1–2 photos)
              </span>
              <span className="inline-flex items-center gap-1 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Missing (0)
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-600" /> Start
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> Destination
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" /> Lift
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Closed Path
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

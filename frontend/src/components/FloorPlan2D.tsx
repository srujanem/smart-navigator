import React, { useMemo, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { CoverageLevel, GEdge, GNode, Graph, VenueDetail } from '../lib/types';
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
  coverageByNode?: Record<string, CoverageLevel>;
  selectedEdgeId?: string | null;
  onSelectNode?: (node: GNode) => void;
  onSelectEdge?: (edge: GEdge) => void;
  dark?: boolean;
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
  coverageByNode,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  dark = false,
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ startX: number; startY: number } | null>(
    null,
  );

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

  // Route segments on the currently viewed floor
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
    if (k.includes('entrance')) return '#10b981';
    return dark ? '#38bdf8' : '#4f46e5';
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

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
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3.2, +(z + 0.25).toFixed(2)))}
            className={`rounded-lg p-1.5 transition ${
              dark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
            }`}
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.25).toFixed(2)))}
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
        className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={(e) =>
          setDragging({ startX: e.clientX - pan.x, startY: e.clientY - pan.y })
        }
        onMouseMove={(e) => {
          if (!dragging) return;
          setPan({
            x: e.clientX - dragging.startX,
            y: e.clientY - dragging.startY,
          });
        }}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
      >
        <svg
          viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
          className="h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          {/* Building Footprints */}
          {floorBuildings.map((b) => {
            const fl = b.floors.find((f) => f.level === selectedLevel);
            return (
              <g key={b.id}>
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.d}
                  rx={unit * 1.2}
                  fill={dark ? '#111c38' : '#ffffff'}
                  stroke={dark ? '#38bdf8' : '#94a3b8'}
                  strokeOpacity={dark ? 0.45 : 0.65}
                  strokeWidth={unit * 0.35}
                />
                <text
                  x={b.x + unit * 1.4}
                  y={b.y + unit * 2.5}
                  fill={dark ? '#93c5fd' : '#475569'}
                  fontSize={unit * 1.8}
                  fontWeight={700}
                >
                  {b.name} {fl ? `· ${fl.name}` : ''}
                </text>
              </g>
            );
          })}

          {/* Corridor & Transition Edges */}
          {floorEdges.map((e) => {
            const s = nodeMap.get(e.source);
            const t = nodeMap.get(e.target);
            if (!s || !t) return null;
            const isSelectedEdge = selectedEdgeId === e.id;
            const mx = (s.x + t.x) / 2;
            const my = (s.y + t.y) / 2;

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
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke="transparent"
                    strokeWidth={unit * 2.5}
                  />
                )}
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={
                    e.closed
                      ? '#ef4444'
                      : isSelectedEdge
                        ? '#f59e0b'
                        : dark
                          ? '#475569'
                          : '#cbd5e1'
                  }
                  strokeWidth={e.closed || isSelectedEdge ? unit * 0.75 : unit * 0.45}
                  strokeDasharray={e.closed ? `${unit * 1.1} ${unit * 0.8}` : undefined}
                  strokeLinecap="round"
                />
                {e.closed && (
                  <g transform={`translate(${mx}, ${my})`}>
                    <circle r={unit * 1.1} fill="#ef4444" />
                    <text
                      textAnchor="middle"
                      dy={unit * 0.4}
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

          {/* Active Route Segments on This Floor */}
          {floorRouteSegments.map((seg, idx) => (
            <g key={idx}>
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke="#06b6d4"
                strokeOpacity={0.28}
                strokeWidth={unit * 1.8}
                strokeLinecap="round"
              />
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke="#0ea5e9"
                strokeWidth={unit * 0.85}
                strokeDasharray={`${unit * 1.4} ${unit * 0.9}`}
                strokeLinecap="round"
                className="route-dash"
              />
            </g>
          ))}

          {/* Floor Nodes */}
          {floorNodes.map((n) => {
            const isStart = n.id === startNodeId;
            const isEnd = n.id === endNodeId;
            const isSelected = n.id === selectedNodeId;
            const isWalker = n.id === walkerNodeId;
            const inRoute = routeNodeSet.has(n.id);

            if (!n.is_place && !coverageByNode && !inRoute && !isSelected) {
              return (
                <circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={unit * 0.45}
                  fill={dark ? '#475569' : '#94a3b8'}
                  opacity={0.55}
                />
              );
            }

            const fill = fillForNode(n);
            const r =
              isStart || isEnd || isSelected
                ? unit * 1.45
                : n.is_place
                  ? unit * 1.05
                  : unit * 0.72;

            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectNode?.(n);
                }}
                style={{ cursor: 'pointer' }}
              >
                {(isStart || isEnd || isSelected || isWalker) && (
                  <circle
                    r={r * 1.85}
                    fill={isWalker ? '#22d3ee' : fill}
                    opacity={0.25}
                  />
                )}
                <circle
                  r={r}
                  fill={fill}
                  stroke={dark ? '#0f172a' : '#ffffff'}
                  strokeWidth={unit * 0.3}
                />
                {(n.is_place || isStart || isEnd || isSelected) && (
                  <text
                    y={r + unit * 1.55}
                    textAnchor="middle"
                    fill={dark ? '#e2e8f0' : '#1e293b'}
                    fontSize={unit * 1.35}
                    fontWeight={isStart || isEnd || isSelected ? 700 : 600}
                  >
                    {n.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

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

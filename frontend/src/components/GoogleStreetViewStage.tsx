import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Minus,
  Share2,
  Volume2,
  X,
} from 'lucide-react';
import type { GNode, Graph, Route, Step, VenueDetail } from '../lib/types';
import { mediaUrl } from '../lib/api';
import { formatLevel } from '../lib/locationStore';
import { IsometricVenueArt } from './VenueCard';

export interface GoogleStreetViewStageProps {
  venue: VenueDetail;
  graph: Graph;
  route: Route;
  activeStepIdx: number;
  onSelectStep: (step: Step, idx: number) => void;
  onClose?: () => void;
  onSpeakStep?: (step: Step) => void;
  onShareRoute?: () => void;
  onOpenLightbox?: (url: string, caption: string) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(deg: number): number {
  const r = ((deg + 180) % 360 + 360) % 360 - 180;
  return r;
}

export const GoogleStreetViewStage: React.FC<GoogleStreetViewStageProps> = ({
  venue,
  graph,
  route,
  activeStepIdx,
  onSelectStep,
  onClose,
  onSpeakStep,
  onShareRoute,
  onOpenLightbox,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const steps = route.steps;
  const activeStep = steps[activeStepIdx] ?? steps[0];
  const nextStep = activeStepIdx < steps.length - 1 ? steps[activeStepIdx + 1] : null;
  const prevStep = activeStepIdx > 0 ? steps[activeStepIdx - 1] : null;

  const nodeMap = useMemo(() => {
    const m = new Map<string, GNode>();
    graph.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [graph.nodes]);

  const activeNode = activeStep ? nodeMap.get(activeStep.node_id) ?? null : null;
  const nextNode = nextStep ? nodeMap.get(nextStep.node_id) ?? null : null;

  // Compute natural route forward bearing in world degrees (0° = North / -Y)
  const routeForwardHeading = useMemo(() => {
    if (activeNode && nextNode && activeNode.level === nextNode.level) {
      const dx = nextNode.x - activeNode.x;
      const dy = nextNode.y - activeNode.y;
      if (Math.hypot(dx, dy) > 0.05) {
        return (Math.atan2(dx, -dy) * 180) / Math.PI;
      }
    }
    if (activeNode && prevStep) {
      const prevN = nodeMap.get(prevStep.node_id);
      if (prevN && prevN.level === activeNode.level) {
        const dx = activeNode.x - prevN.x;
        const dy = activeNode.y - prevN.y;
        if (Math.hypot(dx, dy) > 0.05) {
          return (Math.atan2(dx, -dy) * 180) / Math.PI;
        }
      }
    }
    return 0;
  }, [activeNode, nextNode, prevStep, nodeMap]);

  // 360° interactive look-around state: yaw (-180..+180 relative to forward route), pitch (-24..+24), zoom (1..2.2)
  const [yaw, setYaw] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(-4);
  const [fovZoom, setFovZoom] = useState<number>(1);
  const [isDraggingLook, setIsDraggingLook] = useState(false);
  const [autoWalk, setAutoWalk] = useState(false);
  const [miniMapExpanded, setMiniMapExpanded] = useState(false);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());

  // Google Street View forward dolly-zoom transition state
  const [dollyTransition, setDollyTransition] = useState<{
    fromUrl: string | null;
    dir: 'forward' | 'backward';
  } | null>(null);

  // Interactive ground chevron cursor disc position (normalized % inside floor zone)
  const [groundCursor, setGroundCursor] = useState<{
    xPct: number;
    yPct: number;
    hoveringFloor: boolean;
  }>({ xPct: 50, yPct: 76, hoveringFloor: false });

  const dragRef = useRef<{
    startX: number;
    startY: number;
    initYaw: number;
    initPitch: number;
    moved: boolean;
  } | null>(null);

  // Resolve best display photo for any step (falls back along nearby route steps so Street View always has a rich corridor photo)
  const resolveStepPhotoUrl = useCallback(
    (idx: number): string | null => {
      const st = steps[idx];
      if (!st) return null;
      if (st.photo_url && !failedUrls.has(st.photo_url)) {
        return mediaUrl(st.photo_url);
      }
      const n = nodeMap.get(st.node_id);
      if (n?.photo_url && !failedUrls.has(n.photo_url)) {
        return mediaUrl(n.photo_url);
      }
      // Look ahead/behind for nearest corridor photo on same floor
      for (let d = 1; d < steps.length; d++) {
        const fwd = steps[idx + d];
        if (fwd && fwd.photo_url && !failedUrls.has(fwd.photo_url)) {
          return mediaUrl(fwd.photo_url);
        }
        const bwd = steps[idx - d];
        if (bwd && bwd.photo_url && !failedUrls.has(bwd.photo_url)) {
          return mediaUrl(bwd.photo_url);
        }
      }
      return null;
    },
    [steps, nodeMap, failedUrls],
  );

  const currentPhotoUrl = useMemo(
    () => resolveStepPhotoUrl(activeStepIdx),
    [resolveStepPhotoUrl, activeStepIdx],
  );

  // Smoothly recenter yaw towards the upcoming turn when step changes
  useEffect(() => {
    setYaw(0);
    setPitch(-4);
  }, [activeStepIdx]);

  // Step forward / backward with Google Street View dolly-zoom animation
  const triggerStepMove = useCallback(
    (targetIdx: number, dir: 'forward' | 'backward') => {
      if (targetIdx < 0 || targetIdx >= steps.length || targetIdx === activeStepIdx) {
        setAutoWalk(false);
        return;
      }
      setDollyTransition({
        fromUrl: currentPhotoUrl,
        dir,
      });
      onSelectStep(steps[targetIdx], targetIdx);
      window.setTimeout(() => {
        setDollyTransition(null);
      }, 420);
    },
    [steps, activeStepIdx, currentPhotoUrl, onSelectStep],
  );

  // Auto-Walk tour timer
  useEffect(() => {
    if (!autoWalk) return;
    if (activeStepIdx >= steps.length - 1) {
      setAutoWalk(false);
      return;
    }
    const timer = window.setTimeout(() => {
      triggerStepMove(activeStepIdx + 1, 'forward');
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [autoWalk, activeStepIdx, steps.length, triggerStepMove]);

  // Keyboard navigation (Arrow keys to pan/walk just like Google Street View)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        setYaw((y) => normalizeAngle(y - 18));
      } else if (e.key === 'ArrowRight') {
        setYaw((y) => normalizeAngle(y + 18));
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        if (activeStepIdx < steps.length - 1) {
          e.preventDefault();
          triggerStepMove(activeStepIdx + 1, 'forward');
        }
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        if (activeStepIdx > 0) {
          e.preventDefault();
          triggerStepMove(activeStepIdx - 1, 'backward');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeStepIdx, steps.length, triggerStepMove]);

  // Turn deflection angle for the ground-projected Google Street View corridor path
  const turnDeflectionDeg = useMemo(() => {
    const ic = activeStep?.icon;
    if (ic === 'left') return -34;
    if (ic === 'right') return 34;
    if (nextStep?.icon === 'left') return -22;
    if (nextStep?.icon === 'right') return 22;
    return 0;
  }, [activeStep?.icon, nextStep?.icon]);

  // Ground road rotation combines upcoming turn deflection minus current camera yaw
  const groundRoadAngle = clamp(turnDeflectionDeg - yaw * 0.72, -68, 68);

  // Corridor floor printed label (just like "Moodabidri - Karkala Rd" printed on the road in Google Maps Street View!)
  const corridorFloorTitle = useMemo(() => {
    if (!activeStep) return venue.name;
    if (nextStep && nextStep.name !== activeStep.name) {
      return `${activeStep.name} → ${nextStep.name}`;
    }
    return activeStep.name;
  }, [activeStep, nextStep, venue.name]);

  // Nearby rooms on the same floor to render as 3D world-space pins as you pan around
  const nearbyWorldPins = useMemo(() => {
    if (!activeNode) return [];
    const pins: {
      id: string;
      name: string;
      relYaw: number;
      distM: number;
      isDest: boolean;
    }[] = [];

    for (const n of graph.nodes) {
      if (n.id === activeNode.id || n.level !== activeNode.level) continue;
      if (!n.is_place && n.id !== route.to_node) continue;
      const dx = n.x - activeNode.x;
      const dy = n.y - activeNode.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 34 && n.id !== route.to_node) continue;
      const absBearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const relYaw = normalizeAngle(absBearing - routeForwardHeading);
      pins.push({
        id: n.id,
        name: n.name,
        relYaw,
        distM: Math.max(1, Math.round(dist)),
        isDest: n.id === route.to_node,
      });
    }
    return pins.sort((a, b) => (a.isDest === b.isDest ? a.distM - b.distM : a.isDest ? -1 : 1)).slice(0, 5);
  }, [activeNode, graph.nodes, route.to_node, routeForwardHeading]);

  // Mini-Map bounds for the current floor
  const miniMapData = useMemo(() => {
    const curLevel = activeStep?.level ?? 0;
    const floorNodes = graph.nodes.filter((n) => n.level === curLevel);
    const allN = floorNodes.length > 0 ? floorNodes : graph.nodes;
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
    for (const n of allN) {
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
    const padX = Math.max((maxX - minX) * 0.14, 8);
    const padY = Math.max((maxY - minY) * 0.14, 8);
    const vx = minX - padX;
    const vy = minY - padY;
    const vw = Math.max(maxX - minX + padX * 2, 20);
    const vh = Math.max(maxY - minY + padY * 2, 20);
    const unit = Math.max(vw, vh) / 100;

    // Route polyline points on this floor
    const pts: string[] = [];
    for (const nid of route.path) {
      const n = nodeMap.get(nid);
      if (n && n.level === curLevel) {
        pts.push(`${n.x},${n.y}`);
      }
    }

    return {
      viewBox: `${vx} ${vy} ${vw} ${vh}`,
      unit,
      floorNodes: allN,
      polyline: pts.join(' '),
      curLevel,
    };
  }, [activeStep?.level, graph.nodes, venue.buildings, route.path, nodeMap]);

  const absCompassHeading = normalizeAngle(routeForwardHeading + yaw);
  const isFinalStep = activeStepIdx >= steps.length - 1;

  // Pan offset for 360° look-around illusion: shifts panoramic triptych smoothly across -180..+180 deg
  const panShiftPct = clamp((-yaw / 180) * 34, -34, 34);
  const tiltShiftPct = clamp((pitch / 24) * 10, -10, 10);

  return (
    <div
      ref={stageRef}
      style={{ touchAction: 'none' }}
      className={`relative h-full w-full overflow-hidden select-none bg-[#070B14] text-white ${
        isDraggingLook ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button, a, [data-no-drag="true"]')) return;
        setIsDraggingLook(true);
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          initYaw: yaw,
          initPitch: pitch,
          moved: false,
        };
      }}
      onMouseMove={(e) => {
        const rect = stageRef.current?.getBoundingClientRect();
        if (rect && rect.height > 0) {
          const xPct = clamp(((e.clientX - rect.left) / rect.width) * 100, 18, 82);
          const yPct = clamp(((e.clientY - rect.top) / rect.height) * 100, 56, 91);
          const inFloor = (e.clientY - rect.top) / rect.height >= 0.52;
          setGroundCursor({ xPct, yPct, hoveringFloor: inFloor });
        }

        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        if (Math.hypot(dx, dy) > 5) {
          dragRef.current.moved = true;
        }
        setYaw(normalizeAngle(dragRef.current.initYaw - dx * 0.35));
        setPitch(clamp(dragRef.current.initPitch + dy * 0.16, -24, 24));
      }}
      onMouseUp={(e) => {
        const wasMoved = dragRef.current?.moved ?? false;
        dragRef.current = null;
        setIsDraggingLook(false);

        // If user clicked the floor road area without dragging, walk forward just like Google Street View!
        if (!wasMoved && !(e.target as HTMLElement).closest('button, a, [data-no-drag="true"]')) {
          const rect = stageRef.current?.getBoundingClientRect();
          if (rect) {
            const relY = (e.clientY - rect.top) / rect.height;
            if (relY >= 0.54 && activeStepIdx < steps.length - 1) {
              triggerStepMove(activeStepIdx + 1, 'forward');
            }
          }
        }
      }}
      onMouseLeave={() => {
        dragRef.current = null;
        setIsDraggingLook(false);
        setGroundCursor((prev) => ({ ...prev, hoveringFloor: false }));
      }}
      onTouchStart={(e) => {
        if ((e.target as HTMLElement).closest('button, a, [data-no-drag="true"]')) return;
        if (e.touches.length === 1) {
          const t = e.touches[0];
          dragRef.current = {
            startX: t.clientX,
            startY: t.clientY,
            initYaw: yaw,
            initPitch: pitch,
            moved: false,
          };
        }
      }}
      onTouchMove={(e) => {
        if (!dragRef.current || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - dragRef.current.startX;
        const dy = t.clientY - dragRef.current.startY;
        if (Math.hypot(dx, dy) > 6) {
          dragRef.current.moved = true;
        }
        setYaw(normalizeAngle(dragRef.current.initYaw - dx * 0.42));
        setPitch(clamp(dragRef.current.initPitch + dy * 0.18, -24, 24));
      }}
      onTouchEnd={() => {
        dragRef.current = null;
      }}
      onWheel={(e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.14 : -0.14;
        setFovZoom((z) => clamp(+(z + delta).toFixed(2), 1, 2.2));
      }}
    >
      {/* ===================================================================== */}
      {/* 1. 360° PANORAMIC CORRIDOR PHOTO STAGE + DOLLY-ZOOM MOTION TRANSITION */}
      {/* ===================================================================== */}
      <div className="absolute inset-0 overflow-hidden bg-[#060A14]">
        {currentPhotoUrl ? (
          <div
            style={{
              transform: `scale(${fovZoom * (dollyTransition ? 1.24 : 1.04)}) translate3d(${panShiftPct}%, ${tiltShiftPct}%, 0)`,
              transition: isDraggingLook
                ? 'none'
                : dollyTransition
                  ? 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)'
                  : 'transform 160ms ease-out',
            }}
            className="relative h-full w-[170%] -left-[35%] flex items-center justify-center"
          >
            {/* Ambient 360° peripheral surround backdrop */}
            <img
              src={currentPhotoUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover blur-2xl scale-110 opacity-55"
            />
            {/* Mirrored Left Peripheral Wing for 360° look-around continuity */}
            <img
              src={currentPhotoUrl}
              alt=""
              aria-hidden="true"
              style={{ transform: 'scaleX(-1)' }}
              className="hidden sm:block h-full w-1/4 object-cover opacity-50 blur-[1px]"
            />
            {/* Primary Un-Cropped High-Clarity Corridor / Doorway Frame */}
            <div className="relative h-full w-full sm:w-2/4 flex items-center justify-center overflow-hidden">
              <img
                src={currentPhotoUrl}
                alt={activeStep?.name || venue.name}
                onError={() => {
                  if (activeStep?.photo_url) {
                    setFailedUrls((prev) => new Set(prev).add(activeStep.photo_url!));
                  }
                }}
                className={`relative z-[2] h-full w-full object-contain sm:object-cover transition-all duration-300 ${
                  dollyTransition ? 'scale-110 blur-[1.5px]' : 'scale-100'
                }`}
              />
            </div>
            {/* Mirrored Right Peripheral Wing for 360° look-around continuity */}
            <img
              src={currentPhotoUrl}
              alt=""
              aria-hidden="true"
              style={{ transform: 'scaleX(-1)' }}
              className="hidden sm:block h-full w-1/4 object-cover opacity-50 blur-[1px]"
            />
          </div>
        ) : (
          <IsometricVenueArt
            accent={venue.accent || '#0ea5e9'}
            buildings={venue.buildings.length}
            floors={Math.max(2, route.levels.length)}
          />
        )}

        {/* Previous frame dolly-zoom cross-fade overlay (matches frame_2.jpg forward motion transition!) */}
        {dollyTransition?.fromUrl && (
          <img
            src={dollyTransition.fromUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[3] h-full w-full object-cover opacity-0 scale-150 blur-sm transition-all duration-400"
          />
        )}

        {/* Subtle Google Street View Horizon & Ground Vignette */}
        <div className="pointer-events-none absolute inset-0 z-[4] bg-gradient-to-t from-black/75 via-transparent to-black/35" />
      </div>

      {/* ===================================================================== */}
      {/* 2. FLOATING 3D WORLD-SPACE ROOM PINS (ROTATE LIVE WITH YAW)           */}
      {/* ===================================================================== */}
      <div className="pointer-events-none absolute inset-x-0 top-[24%] z-[8] h-24 overflow-hidden">
        {nearbyWorldPins.map((pin) => {
          const deltaAngle = normalizeAngle(pin.relYaw - yaw);
          if (Math.abs(deltaAngle) > 68) return null;
          const leftPct = 50 + (deltaAngle / 68) * 42;
          return (
            <div
              key={pin.id}
              style={{ left: `${leftPct}%` }}
              className="absolute top-2 -translate-x-1/2 flex flex-col items-center transition-all duration-100"
            >
              <div
                className={`rounded-xl px-2.5 py-1 text-[11px] font-extrabold shadow-lg ring-1 whitespace-nowrap ${
                  pin.isDest
                    ? 'bg-emerald-600/95 text-white ring-emerald-300 shadow-emerald-950/60'
                    : 'bg-slate-950/85 text-cyan-200 ring-white/20'
                }`}
              >
                {pin.isDest ? '🏁 ' : '🚪 '}
                {pin.name} · {pin.distM}m
              </div>
              <div className="h-4 w-0.5 bg-white/60" />
              <div className="h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-white" />
            </div>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* 3. GOOGLE STREET VIEW 3D GROUND-PROJECTED ROAD, FLOOR TEXT & DISC (^) */}
      {/* ===================================================================== */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[54%] z-[9] flex items-end justify-center overflow-hidden">
        {/* 3D Perspective Road / Corridor Carpet on the Floor */}
        <div
          style={{
            transform: `perspective(460px) rotateX(${clamp(66 - pitch * 0.4, 54, 76)}deg) rotateZ(${groundRoadAngle}deg)`,
            transformOrigin: '50% 100%',
          }}
          className="relative w-72 sm:w-96 h-[130%] flex flex-col items-center justify-between py-6 transition-transform duration-100"
        >
          {/* Google Street View Translucent Corridor Path Strip */}
          <div
            className="absolute inset-x-6 inset-y-0 rounded-t-full"
            style={{
              background:
                'linear-gradient(to top, rgba(59, 130, 246, 0.34) 0%, rgba(56, 189, 248, 0.24) 55%, rgba(56, 189, 248, 0.0) 100%)',
              boxShadow: 'inset 0 0 28px rgba(56, 189, 248, 0.28)',
              borderLeft: '2px solid rgba(186, 230, 253, 0.38)',
              borderRight: '2px solid rgba(186, 230, 253, 0.38)',
            }}
          />

          {/* Google Street View White 'X' Intersection Waypoint Marker on Road */}
          {!isFinalStep && (
            <div className="relative z-10 mt-8 text-white/70 font-sans text-2xl font-black tracking-widest select-none">
              ✕
            </div>
          )}

          {/* 3D Perspective Corridor / Street Name Printed Directly on the Floor (like "Moodabidri - Karkala Rd"!) */}
          <div
            style={{
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              transform: 'rotate(180deg)',
              textShadow:
                '0 2px 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1), 1px 1px 0 #0f172a, -1px -1px 0 #0f172a',
            }}
            className="relative z-10 my-auto font-display text-xl sm:text-2xl font-black tracking-wider text-white/90 uppercase whitespace-nowrap py-2"
          >
            {corridorFloorTitle}
          </div>

          {/* Primary Clickable Ground Chevron Disc ( ( ^ ) ) on the Floor */}
          {!isFinalStep ? (
            <button
              type="button"
              data-no-drag="true"
              onClick={(e) => {
                e.stopPropagation();
                triggerStepMove(activeStepIdx + 1, 'forward');
              }}
              title={`Walk forward to ${nextStep?.name || 'next step'}`}
              className="pointer-events-auto group relative z-20 mb-14 flex h-20 w-20 items-center justify-center rounded-full bg-white/40 ring-4 ring-white/80 shadow-[0_0_30px_rgba(255,255,255,0.65)] hover:bg-white/65 hover:scale-110 active:scale-95 transition-all cursor-pointer"
            >
              <svg viewBox="0 0 48 48" className="h-12 w-12 drop-shadow-[0_2px_4px_rgba(0,0,0,0.65)]">
                <path
                  d="M12 29 L24 17 L36 29"
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth="6.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 29 L24 17 L36 29"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
            <div className="relative z-20 mb-16 flex flex-col items-center gap-1 rounded-3xl bg-emerald-600/95 px-5 py-2.5 ring-4 ring-emerald-300 shadow-2xl">
              <span className="text-xs font-black uppercase tracking-widest text-white">
                ★ Destination Reached
              </span>
            </div>
          )}
        </div>

        {/* Floating Interactive Ground Cursor Disc (follows mouse cursor on the floor just like frame_0.jpg & frame_4.jpg!) */}
        {groundCursor.hoveringFloor && !isFinalStep && !isDraggingLook && (
          <div
            style={{
              left: `${groundCursor.xPct}%`,
              top: `${groundCursor.yPct}%`,
              transform: 'translate(-50%, -50%) perspective(320px) rotateX(62deg)',
            }}
            className="pointer-events-none fixed sm:absolute z-10 hidden sm:flex h-16 w-16 items-center justify-center rounded-full bg-white/35 ring-2 ring-white/85 shadow-xl transition-all duration-75"
          >
            <svg viewBox="0 0 36 36" className="h-8 w-8">
              <path
                d="M9 22 L18 13 L27 22"
                fill="none"
                stroke="#1e293b"
                strokeWidth="4.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 4. TOP-LEFT GOOGLE MAPS STREET VIEW DARK FLOATING CARD                */}
      {/* ===================================================================== */}
      <div
        data-no-drag="true"
        className="absolute top-3 left-3 z-20 w-[calc(100%-5.75rem)] max-w-[330px] rounded-2xl bg-[#11161F]/92 p-3 sm:p-3.5 text-white ring-1 ring-white/15 shadow-2xl"
      >
        <div className="flex items-start gap-2.5">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-slate-200 hover:bg-white/20 transition"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1.5">
              <h3 className="font-display text-xs sm:text-sm font-extrabold text-white truncate">
                {activeStep?.short_action || activeStep?.name || venue.name}
              </h3>
              <span className="shrink-0 rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                {activeStepIdx + 1}/{steps.length}
              </span>
            </div>

            <p className="text-[11px] text-slate-300 truncate mt-0.5">
              {venue.name}
              {venue.city ? ` · ${venue.city}` : ''} ·{' '}
              {formatLevel(activeStep?.level ?? 0, activeNode?.floor_name)}
            </p>

            {/* Google Street View Badge Row */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold text-sky-300 ring-1 ring-white/15">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-[9px] font-black text-blue-600">
                  G
                </span>
                Street View Route
              </span>

              {activeStep && activeStep.distance_m > 0 && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300 ring-1 ring-emerald-400/35">
                  {Math.round(activeStep.distance_m)} m
                  {activeStep.steps_count ? ` · ~${activeStep.steps_count} steps` : ''}
                </span>
              )}

              {activeStep?.door_side && activeStep.door_side !== 'ahead' && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-extrabold text-amber-200 ring-1 ring-amber-400/40">
                  🚪 Door on {activeStep.door_side.toUpperCase()}
                </span>
              )}
            </div>

            {/* Plain-English Human Instruction */}
            <p className="mt-1.5 text-[11px] sm:text-xs font-semibold text-slate-100 leading-snug line-clamp-2">
              {activeStep?.instruction}
            </p>

            {/* Step Controls & Auto-Walk Inside Card */}
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                type="button"
                disabled={activeStepIdx <= 0}
                onClick={() => triggerStepMove(activeStepIdx - 1, 'backward')}
                className="inline-flex items-center justify-center rounded-xl bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-white/20 disabled:opacity-35 transition"
                title="Previous Step"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>

              <button
                type="button"
                onClick={() => setAutoWalk((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-extrabold transition ${
                  autoWalk
                    ? 'bg-amber-400 text-slate-950 shadow-md'
                    : 'bg-white/10 text-cyan-300 hover:bg-white/20'
                }`}
                title="Auto-Walk down the corridor route"
              >
                {autoWalk ? (
                  <>
                    <Pause className="h-3 w-3" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" /> Auto-Walk
                  </>
                )}
              </button>

              {onSpeakStep && activeStep && (
                <button
                  type="button"
                  onClick={() => onSpeakStep(activeStep)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-white/10 text-slate-200 hover:bg-white/20 transition"
                  title="Speak direction"
                >
                  <Volume2 className="h-3.5 w-3.5 text-cyan-300" />
                </button>
              )}

              <button
                type="button"
                disabled={isFinalStep}
                onClick={() => triggerStepMove(activeStepIdx + 1, 'forward')}
                className="ml-auto inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-[11px] font-extrabold text-white hover:bg-blue-500 disabled:opacity-35 transition shadow-md"
                title="Step Forward"
              >
                Step
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 5. TOP-RIGHT SHARE & CLOSE / FULLSCREEN BUTTONS                       */}
      {/* ===================================================================== */}
      <div
        data-no-drag="true"
        className="absolute top-3 right-3 z-20 flex items-center gap-1.5"
      >
        {onShareRoute && (
          <button
            type="button"
            onClick={onShareRoute}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#11161F]/90 px-3 py-2 text-xs font-bold text-white ring-1 ring-white/15 shadow-lg hover:bg-[#1B2230] transition"
            title="Share Route"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
        )}

        {currentPhotoUrl && onOpenLightbox && (
          <button
            type="button"
            onClick={() =>
              onOpenLightbox(
                currentPhotoUrl,
                `${activeStep?.name || venue.name} (${formatLevel(activeStep?.level ?? 0)})`,
              )
            }
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#11161F]/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-[#1B2230] transition"
            title="Inspect full photo"
          >
            <Maximize2 className="h-3.5 w-3.5 text-cyan-300" />
          </button>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#11161F]/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-[#1B2230] transition"
            title="Exit Street View"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 6. BOTTOM-LEFT LIVE MINI-MAP WITH YELLOW PEGMAN & ROTATING FOV CONE   */}
      {/* ===================================================================== */}
      <div
        data-no-drag="true"
        className={`absolute bottom-3 left-3 z-20 overflow-hidden rounded-2xl bg-[#E8EEF5] ring-2 ring-white shadow-2xl transition-all duration-200 ${
          miniMapExpanded
            ? 'h-48 w-64 sm:h-56 sm:w-72'
            : 'h-24 w-36 sm:h-28 sm:w-44'
        }`}
      >
        <svg
          viewBox={miniMapData.viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full bg-[#EDF2F7]"
        >
          {/* Building Floor Outlines */}
          {venue.buildings.map((b) => (
            <rect
              key={b.id}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.d}
              rx={miniMapData.unit * 1.6}
              fill="#FFFFFF"
              stroke="#CBD5E1"
              strokeWidth={miniMapData.unit * 0.6}
            />
          ))}

          {/* Google Maps Blue Route Polyline */}
          {miniMapData.polyline && (
            <>
              <polyline
                points={miniMapData.polyline}
                fill="none"
                stroke="#1D4ED8"
                strokeWidth={miniMapData.unit * 3.1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={miniMapData.polyline}
                fill="none"
                stroke="#3B82F6"
                strokeWidth={miniMapData.unit * 1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* Floor Nodes (click any node on mini-map to jump to that step!) */}
          {miniMapData.floorNodes.map((n) => {
            const stepMatchIdx = steps.findIndex((s) => s.node_id === n.id);
            const isDest = n.id === route.to_node;
            return (
              <circle
                key={n.id}
                cx={n.x}
                cy={n.y}
                r={isDest ? miniMapData.unit * 2.2 : miniMapData.unit * 1.25}
                fill={isDest ? '#EF4444' : stepMatchIdx >= 0 ? '#2563EB' : '#94A3B8'}
                stroke="#FFFFFF"
                strokeWidth={miniMapData.unit * 0.45}
                className={stepMatchIdx >= 0 ? 'cursor-pointer' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  if (stepMatchIdx >= 0) {
                    onSelectStep(steps[stepMatchIdx], stepMatchIdx);
                  }
                }}
              />
            );
          })}

          {/* Yellow Google Pegman + Rotating View Cone at Current Position */}
          {activeNode && (
            <g transform={`translate(${activeNode.x}, ${activeNode.y})`}>
              {/* Rotating Directional FOV Cone */}
              <g transform={`rotate(${absCompassHeading})`}>
                <path
                  d={`M 0 0 L ${-miniMapData.unit * 5.2} ${-miniMapData.unit * 9.5} A ${miniMapData.unit * 10.5} ${miniMapData.unit * 10.5} 0 0 1 ${miniMapData.unit * 5.2} ${-miniMapData.unit * 9.5} Z`}
                  fill="rgba(245, 158, 11, 0.35)"
                  stroke="#F59E0B"
                  strokeWidth={miniMapData.unit * 0.35}
                />
              </g>
              {/* Yellow Pegman Icon */}
              <circle
                r={miniMapData.unit * 2.6}
                fill="#FACC15"
                stroke="#92400E"
                strokeWidth={miniMapData.unit * 0.65}
              />
              <circle
                cy={-miniMapData.unit * 0.65}
                r={miniMapData.unit * 0.95}
                fill="#B45309"
              />
            </g>
          )}
        </svg>

        {/* Bottom-left Expand Mini-Map Button (exact match to Google Street View mini-map!) */}
        <button
          type="button"
          onClick={() => setMiniMapExpanded((v) => !v)}
          className="absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-white/95 text-slate-800 shadow ring-1 ring-slate-300 hover:bg-white"
          title={miniMapExpanded ? 'Shrink mini-map' : 'Expand mini-map'}
        >
          {miniMapExpanded ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>

        <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-800 shadow-sm">
          {activeNode?.name || venue.name}
        </span>
      </div>

      {/* ===================================================================== */}
      {/* 7. BOTTOM-RIGHT 3D COMPASS NEEDLE (N/S) + ZOOM (+/-) CONTROLS         */}
      {/* ===================================================================== */}
      <div
        data-no-drag="true"
        className="absolute bottom-3 right-3 z-20 flex flex-col items-center gap-2"
      >
        {/* Rotating Google Street View Compass Needle (Tap to Reset Heading Straight Ahead) */}
        <button
          type="button"
          onClick={() => {
            setYaw(0);
            setPitch(-4);
            setFovZoom(1);
          }}
          title="Reset camera heading straight down the corridor"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#11161F]/90 ring-1 ring-white/20 shadow-xl hover:bg-[#1B2230] transition"
        >
          <svg
            viewBox="0 0 36 36"
            style={{ transform: `rotate(${-absCompassHeading}deg)` }}
            className="h-7 w-7 transition-transform duration-75"
          >
            {/* Red North Needle */}
            <polygon points="18,4 22,18 14,18" fill="#EF4444" />
            {/* White South Needle */}
            <polygon points="18,32 22,18 14,18" fill="#F8FAFC" />
            <circle cx="18" cy="18" r="2.2" fill="#0F172A" />
          </svg>
        </button>

        {/* + / - Zoom Stack */}
        <div className="flex flex-col overflow-hidden rounded-xl bg-[#11161F]/90 ring-1 ring-white/20 shadow-xl">
          <button
            type="button"
            onClick={() => setFovZoom((z) => clamp(+(z + 0.25).toFixed(2), 1, 2.2))}
            className="flex h-8 w-8 items-center justify-center text-white hover:bg-white/15 border-b border-white/10 transition"
            title="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setFovZoom((z) => clamp(+(z - 0.25).toFixed(2), 1, 2.2))}
            className="flex h-8 w-8 items-center justify-center text-white hover:bg-white/15 transition"
            title="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bottom Center Google Maps Style Watermark & Drag Hint */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-10 hidden sm:flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white/85">
        <span>Drag to look 360° · Click floor arrow (^) to walk forward</span>
      </div>
    </div>
  );
};

export default GoogleStreetViewStage;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Float, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Compass,
  Eye,
  Layers,
  Moon,
  Navigation,
  Orbit,
  Radar,
  Sun,
  X,
} from 'lucide-react';
import type { Building, GEdge, GNode, Graph, VenueDetail } from '../lib/types';
import { mediaUrl } from '../lib/api';
import { formatLevel } from '../lib/locationStore';

export type Camera3DMode = 'orbit' | 'chase' | 'first_person' | 'top_down';
export type Radar3DFilter = 'none' | 'emergency' | 'lift' | 'washroom';

export interface Venue3DProps {
  venue: VenueDetail;
  graph: Graph;
  selectedLevel: number | 'all';
  selectedNodeId?: string | null;
  startNodeId?: string | null;
  endNodeId?: string | null;
  routePath?: string[];
  walkerProgress?: number | null;
  isPlayingWalker?: boolean;
  onSelectNode?: (node: GNode) => void;
}

interface Transform3D {
  toWorld: (x: number, y: number, level: number) => [number, number, number];
  scale: number;
  levels: number[];
}

const BASE_LEVEL_GAP = 12;

function computeTransform(
  venue: VenueDetail,
  graph: Graph,
  explodeFactor = 1,
): Transform3D {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const levelSet = new Set<number>();

  for (const b of venue.buildings) {
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x + b.w);
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y + b.d);
    for (const f of b.floors) {
      levelSet.add(f.level);
    }
  }

  for (const n of graph.nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
    levelSet.add(n.level);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 100;
    minY = 0;
    maxY = 100;
  }

  const levels = Array.from(levelSet).sort((a, b) => a - b);
  if (levels.length === 0) levels.push(0);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 10);
  const scale = 54 / span;

  const levelIndexMap = new Map<number, number>();
  levels.forEach((lvl, idx) => levelIndexMap.set(lvl, idx));

  const gap = BASE_LEVEL_GAP * explodeFactor;
  const centerYOffset = ((levels.length - 1) * gap) / 2;

  return {
    scale,
    levels,
    toWorld: (x: number, y: number, level: number) => {
      const idx = levelIndexMap.get(level) ?? 0;
      return [
        (x - cx) * scale,
        idx * gap - centerYOffset,
        (y - cy) * scale,
      ];
    },
  };
}

function nodeColor(node: GNode): string {
  const k = node.kind.toLowerCase();
  if (k.includes('emergency')) return '#f43f5e';
  if (k.includes('entrance') || k.includes('exit')) return '#10b981';
  if (k.includes('lift')) return '#06b6d4';
  if (k.includes('stair')) return '#f59e0b';
  if (k.includes('washroom')) return '#a855f7';
  if (k.includes('cafe') || k.includes('food')) return '#f97316';
  if (k.includes('cabin') || k.includes('doctor')) return '#818cf8';
  return '#38bdf8';
}

function rectBorder(w: number, d: number): [number, number, number][] {
  const hw = w / 2;
  const hd = d / 2;
  return [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd],
    [-hw, 0, -hd],
  ];
}

const AnimatedLiftCab: React.FC<{
  x: number;
  z: number;
  yMin: number;
  yMax: number;
  seed: number;
}> = ({ x, z, yMin, yMax, seed }) => {
  const cabRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!cabRef.current) return;
    const t = state.clock.getElapsedTime() * 0.45 + seed;
    const u = (Math.sin(t) + 1) / 2;
    cabRef.current.position.y = yMin + 1.0 + u * Math.max(0.5, yMax - yMin - 2.0);
  });
  return (
    <mesh ref={cabRef} position={[x, (yMin + yMax) / 2, z]}>
      <boxGeometry args={[1.25, 1.35, 1.25]} />
      <meshStandardMaterial
        color="#22d3ee"
        emissive="#06b6d4"
        emissiveIntensity={1.15}
        transparent
        opacity={0.86}
      />
    </mesh>
  );
};

const ROUTE_FLOW_CONES = 10;

const WalkerAndBeacons: React.FC<{
  routePoints: [number, number, number][];
  startPos: [number, number, number] | null;
  endPos: [number, number, number] | null;
  walkerProgress?: number | null;
  isPlayingWalker: boolean;
  cameraMode: Camera3DMode;
}> = ({
  routePoints,
  startPos,
  endPos,
  walkerProgress,
  isPlayingWalker,
  cameraMode,
}) => {
  const walkerRef = useRef<THREE.Mesh>(null);
  const walkerAuraRef = useRef<THREE.Mesh>(null);
  const startRingRef = useRef<THREE.Mesh>(null);
  const endRingRef = useRef<THREE.Mesh>(null);
  const flowConeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const internalProgress = useRef(0);
  const smoothLook = useRef(new THREE.Vector3());

  const curve = useMemo(() => {
    if (routePoints.length < 2) return null;
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < routePoints.length - 1; i++) {
      const a = new THREE.Vector3(...routePoints[i]);
      const b = new THREE.Vector3(...routePoints[i + 1]);
      if (a.distanceToSquared(b) > 0.0001) {
        path.add(new THREE.LineCurve3(a, b));
      }
    }
    return path.curves.length > 0 ? path : null;
  }, [routePoints]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();

    if (cameraMode === 'top_down') {
      const desiredTop = new THREE.Vector3(0, 66, 0.01);
      state.camera.position.lerp(desiredTop, Math.min(1, delta * 3.5));
      smoothLook.current.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, delta * 4.5));
      state.camera.lookAt(smoothLook.current);
    }

    if (curve && walkerRef.current && walkerAuraRef.current) {
      let u = 0;
      if (typeof walkerProgress === 'number' && Number.isFinite(walkerProgress)) {
        u = Math.max(0, Math.min(1, walkerProgress));
        internalProgress.current = u;
      } else {
        if (isPlayingWalker) {
          internalProgress.current = (internalProgress.current + delta * 0.14) % 1;
        }
        u = internalProgress.current;
      }
      const pt = curve.getPointAt(u);
      walkerRef.current.position.copy(pt);
      walkerAuraRef.current.position.copy(pt);
      walkerAuraRef.current.scale.setScalar(1 + Math.sin(t * 6) * 0.25);

      // Animate marching 3D laser flow cones along the route curve
      for (let i = 0; i < ROUTE_FLOW_CONES; i++) {
        const coneMesh = flowConeRefs.current[i];
        if (!coneMesh) continue;
        const coneU = (i / ROUTE_FLOW_CONES + t * 0.16) % 1;
        const conePt = curve.getPointAt(coneU);
        const coneTan = curve.getTangentAt(Math.min(0.995, coneU));
        coneMesh.position.set(conePt.x, conePt.y + 0.15, conePt.z);
        const targetLook = conePt.clone().add(coneTan);
        coneMesh.lookAt(targetLook);
        coneMesh.rotateX(Math.PI / 2);
      }

      if (cameraMode === 'chase' || cameraMode === 'first_person') {
        const tangent = curve.getTangentAt(Math.min(0.995, u));
        const horiz = new THREE.Vector3(tangent.x, 0, tangent.z);
        if (horiz.lengthSq() < 0.01) {
          horiz.set(0.6, 0, 0.8);
        }
        horiz.normalize();

        if (cameraMode === 'first_person') {
          const desiredCam = pt
            .clone()
            .sub(horiz.clone().multiplyScalar(2.4))
            .add(new THREE.Vector3(0, 2.2, 0));
          const desiredTarget = pt
            .clone()
            .add(horiz.clone().multiplyScalar(8.5))
            .add(new THREE.Vector3(0, 1.3, 0));
          state.camera.position.lerp(desiredCam, Math.min(1, delta * 4.5));
          smoothLook.current.lerp(desiredTarget, Math.min(1, delta * 5.2));
          state.camera.lookAt(smoothLook.current);
        } else {
          const desiredCam = pt
            .clone()
            .sub(horiz.clone().multiplyScalar(11.5))
            .add(new THREE.Vector3(0, 6.8, 0));
          const desiredTarget = pt.clone().add(horiz.clone().multiplyScalar(3.5));

          state.camera.position.lerp(desiredCam, Math.min(1, delta * 3.8));
          smoothLook.current.lerp(desiredTarget, Math.min(1, delta * 4.5));
          state.camera.lookAt(smoothLook.current);
        }
      }
    }

    if (startRingRef.current) {
      const p = (t * 0.75) % 1;
      startRingRef.current.scale.setScalar(0.7 + p * 2.3);
      (startRingRef.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - p) * 0.75;
    }

    if (endRingRef.current) {
      const p = (t * 0.75 + 0.35) % 1;
      endRingRef.current.scale.setScalar(0.7 + p * 2.5);
      (endRingRef.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - p) * 0.8;
    }
  });

  return (
    <>
      {curve && (
        <>
          <mesh ref={walkerRef}>
            <sphereGeometry args={[0.55, 24, 24]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh ref={walkerAuraRef}>
            <sphereGeometry args={[1.1, 24, 24]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.45} />
          </mesh>
          {/* 3D Animated Marching Route Flow Chevrons / Cones */}
          {Array.from({ length: ROUTE_FLOW_CONES }).map((_, idx) => (
            <mesh
              key={`flow-cone-${idx}`}
              ref={(el) => {
                flowConeRefs.current[idx] = el;
              }}
            >
              <coneGeometry args={[0.28, 0.78, 12]} />
              <meshStandardMaterial
                color="#34d399"
                emissive="#10b981"
                emissiveIntensity={1.6}
                transparent
                opacity={0.9}
              />
            </mesh>
          ))}
        </>
      )}

      {startPos && (
        <group position={startPos}>
          {/* 3D Hologram Start Beacon Beam */}
          <mesh position={[0, 4.5, 0]}>
            <cylinderGeometry args={[0.14, 0.45, 9, 20, 1, true]} />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={0.22}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, 0.75, 0]}>
            <sphereGeometry args={[0.58, 24, 24]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#0284c7"
              emissiveIntensity={1.6}
            />
          </mesh>
          <mesh
            ref={startRingRef}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.15, 0]}
          >
            <ringGeometry args={[0.55, 0.9, 32]} />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}

      {endPos && (
        <group position={endPos}>
          {/* 3D Hologram Destination Beacon Beam */}
          <mesh position={[0, 5.2, 0]}>
            <cylinderGeometry args={[0.16, 0.52, 10.4, 20, 1, true]} />
            <meshBasicMaterial
              color="#fb7185"
              transparent
              opacity={0.25}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={endRingRef}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.15, 0]}
          >
            <ringGeometry args={[0.6, 0.98, 32]} />
            <meshBasicMaterial
              color="#fb7185"
              transparent
              opacity={0.75}
              side={THREE.DoubleSide}
            />
          </mesh>
          <Float speed={3.2} rotationIntensity={0.25} floatIntensity={0.5}>
            <group position={[0, 1.9, 0]}>
              <mesh position={[0, 0.55, 0]}>
                <sphereGeometry args={[0.62, 24, 24]} />
                <meshStandardMaterial
                  color="#fb7185"
                  emissive="#e11d48"
                  emissiveIntensity={1.4}
                />
              </mesh>
              <mesh position={[0, -0.25, 0]} rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.45, 1.15, 24]} />
                <meshStandardMaterial
                  color="#fb7185"
                  emissive="#be123c"
                  emissiveIntensity={1.2}
                />
              </mesh>
            </group>
          </Float>
        </group>
      )}
    </>
  );
};

function matchesRadarFilter(node: GNode, filter: Radar3DFilter): boolean {
  if (filter === 'none') return false;
  const k = `${node.kind} ${node.category} ${node.name}`.toLowerCase();
  if (filter === 'emergency') {
    return (
      k.includes('emergency') ||
      k.includes('entrance') ||
      k.includes('exit') ||
      k.includes('gate') ||
      k.includes('casualty')
    );
  }
  if (filter === 'lift') {
    return k.includes('lift') || k.includes('stair') || k.includes('elevator');
  }
  if (filter === 'washroom') {
    return k.includes('washroom') || k.includes('toilet') || k.includes('restroom');
  }
  return false;
}

const SceneContent: React.FC<
  Venue3DProps & {
    cameraMode: Camera3DMode;
    daylight: boolean;
    explodeFactor: number;
    showRoomVolumes: boolean;
    radarFilter: Radar3DFilter;
  }
> = ({
  venue,
  graph,
  selectedLevel,
  selectedNodeId,
  startNodeId,
  endNodeId,
  routePath = [],
  walkerProgress = null,
  isPlayingWalker = true,
  onSelectNode,
  cameraMode,
  daylight,
  explodeFactor,
  showRoomVolumes,
  radarFilter,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const tf = useMemo(
    () => computeTransform(venue, graph, explodeFactor),
    [venue, graph, explodeFactor],
  );

  const nodeById = useMemo(() => {
    const m = new Map<string, GNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph.nodes]);

  const routeNodeSet = useMemo(() => new Set(routePath), [routePath]);

  const routePoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (const id of routePath) {
      const n = nodeById.get(id);
      if (n) {
        const [wx, wy, wz] = tf.toWorld(n.x, n.y, n.level);
        pts.push([wx, wy + 0.52, wz]);
      }
    }
    return pts;
  }, [routePath, nodeById, tf]);

  const routeColors = useMemo(() => {
    if (routePoints.length < 2) return undefined;
    return routePoints.map((_, idx) => {
      const t = idx / (routePoints.length - 1);
      const c = new THREE.Color('#06b6d4').lerp(new THREE.Color('#10b981'), t);
      return [c.r, c.g, c.b] as [number, number, number];
    });
  }, [routePoints]);

  const verticalShafts = useMemo(() => {
    const list: {
      id: string;
      x: number;
      z: number;
      yMin: number;
      yMax: number;
      yMid: number;
      height: number;
      kind: GEdge['kind'];
      closed: boolean;
    }[] = [];

    for (const e of graph.edges) {
      const s = nodeById.get(e.source);
      const t = nodeById.get(e.target);
      if (!s || !t || s.level === t.level) continue;
      const [sx, sy, sz] = tf.toWorld(s.x, s.y, s.level);
      const [tx, ty, tz] = tf.toWorld(t.x, t.y, t.level);
      list.push({
        id: e.id,
        x: (sx + tx) / 2,
        z: (sz + tz) / 2,
        yMin: Math.min(sy, ty),
        yMax: Math.max(sy, ty),
        yMid: (sy + ty) / 2,
        height: Math.abs(ty - sy),
        kind: e.kind,
        closed: e.closed,
      });
    }
    return list;
  }, [graph.edges, nodeById, tf]);

  const startNode = startNodeId ? nodeById.get(startNodeId) ?? null : null;
  const endNode = endNodeId ? nodeById.get(endNodeId) ?? null : null;

  const startPos = startNode
    ? tf.toWorld(startNode.x, startNode.y, startNode.level)
    : null;
  const endPos = endNode
    ? tf.toWorld(endNode.x, endNode.y, endNode.level)
    : null;

  const baseFloorY = tf.toWorld(0, 0, tf.levels[0])[1];

  return (
    <group>
      <gridHelper
        args={[
          92,
          46,
          daylight ? '#94a3b8' : '#1e293b',
          daylight ? '#cbd5e1' : '#0f172a',
        ]}
        position={[0, baseFloorY - 2.2, 0]}
      />

      {/* Architectural Buildings: Slabs + Glass Curtain Walls + Structural Columns */}
      {venue.buildings.map((b: Building) => {
        const sortedFloors = [...b.floors].sort((x, y) => x.level - y.level);
        const topLvl =
          sortedFloors.length > 0
            ? sortedFloors[sortedFloors.length - 1].level
            : 0;
        const botLvl = sortedFloors.length > 0 ? sortedFloors[0].level : 0;
        const [bx, botY, bz] = tf.toWorld(b.x + b.w / 2, b.y + b.d / 2, botLvl);
        const [, topY] = tf.toWorld(b.x + b.w / 2, b.y + b.d / 2, topLvl);
        const sw = Math.max(b.w * tf.scale, 2.5);
        const sd = Math.max(b.d * tf.scale, 2.5);
        const totalBldgHeight = Math.max(topY - botY + 4.4, 4.4);
        const colCorners: [number, number][] = [
          [-sw / 2 + 0.25, -sd / 2 + 0.25],
          [sw / 2 - 0.25, -sd / 2 + 0.25],
          [sw / 2 - 0.25, sd / 2 - 0.25],
          [-sw / 2 + 0.25, sd / 2 - 0.25],
        ];

        return (
          <group key={b.id}>
            {/* Full-Height Corner Structural Pillars */}
            {selectedLevel === 'all' &&
              colCorners.map(([px, pz], idx) => (
                <mesh
                  key={idx}
                  position={[bx + px, botY + totalBldgHeight / 2 - 0.2, bz + pz]}
                >
                  <boxGeometry args={[0.28, totalBldgHeight, 0.28]} />
                  <meshStandardMaterial
                    color={daylight ? '#64748b' : '#38bdf8'}
                    transparent
                    opacity={0.42}
                  />
                </mesh>
              ))}

            {sortedFloors.map((fl) => {
              const isFocused =
                selectedLevel === 'all' || selectedLevel === fl.level;
              const [cx, wy, cz] = tf.toWorld(
                b.x + b.w / 2,
                b.y + b.d / 2,
                fl.level,
              );
              const border = rectBorder(sw, sd);
              const isTopFloor = fl.level === topLvl;
              const wallH = selectedLevel === 'all' ? 4.2 : 3.2;

              return (
                <group key={`${b.id}-${fl.id}`} position={[cx, wy, cz]}>
                  {/* Floor Slab */}
                  <mesh receiveShadow>
                    <boxGeometry args={[sw, 0.32, sd]} />
                    <meshPhysicalMaterial
                      color={
                        daylight
                          ? isFocused
                            ? '#f1f5f9'
                            : '#e2e8f0'
                          : isFocused
                            ? '#10224a'
                            : '#0b1329'
                      }
                      transparent
                      opacity={isFocused ? (daylight ? 0.88 : 0.64) : 0.14}
                      roughness={0.2}
                      metalness={0.18}
                      clearcoat={0.5}
                    />
                  </mesh>

                  {/* Translucent Architectural Glass Curtain Wall */}
                  {isFocused && (
                    <mesh position={[0, wallH / 2 + 0.16, 0]}>
                      <boxGeometry args={[sw - 0.14, wallH, sd - 0.14]} />
                      <meshPhysicalMaterial
                        color={daylight ? '#bae6fd' : '#1e3a8a'}
                        transparent
                        opacity={daylight ? 0.14 : 0.08}
                        roughness={0.1}
                        depthWrite={false}
                      />
                    </mesh>
                  )}

                  <Line
                    points={border}
                    position={[0, 0.18, 0]}
                    color={
                      isFocused
                        ? daylight
                          ? '#0284c7'
                          : '#38bdf8'
                        : '#475569'
                    }
                    lineWidth={isFocused ? 1.7 : 0.8}
                    transparent
                    opacity={isFocused ? 0.72 : 0.22}
                  />

                  {isTopFloor && (selectedLevel === 'all' || isFocused) && (
                    <Html
                      position={[-sw / 2 + 1.4, wallH + 0.9, -sd / 2 + 1.4]}
                      center={false}
                      style={{ pointerEvents: 'none' }}
                    >
                      <div className="whitespace-nowrap rounded-lg bg-slate-950/85 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-500/35 shadow-md backdrop-blur-md">
                        {b.name}
                      </div>
                    </Html>
                  )}
                </group>
              );
            })}
          </group>
        );
      })}

      {/* Vertical Glass Lift Shafts + Moving Elevator Cars + Stepped Staircases */}
      {verticalShafts.map((sh, idx) => {
        const color = sh.closed
          ? '#f43f5e'
          : sh.kind === 'lift'
            ? '#06b6d4'
            : '#f59e0b';

        return (
          <group key={sh.id}>
            <group position={[sh.x, sh.yMid, sh.z]}>
              {sh.kind === 'lift' ? (
                <>
                  <mesh>
                    <boxGeometry args={[1.65, sh.height, 1.65]} />
                    <meshStandardMaterial
                      color={color}
                      emissive={color}
                      emissiveIntensity={0.3}
                      transparent
                      opacity={selectedLevel === 'all' ? 0.18 : 0.1}
                    />
                  </mesh>
                  <lineSegments>
                    <edgesGeometry
                      args={[new THREE.BoxGeometry(1.66, sh.height, 1.66)]}
                    />
                    <lineBasicMaterial
                      color={color}
                      transparent
                      opacity={0.45}
                    />
                  </lineSegments>
                </>
              ) : (
                <>
                  <mesh>
                    <cylinderGeometry args={[0.62, 0.62, sh.height, 16]} />
                    <meshStandardMaterial
                      color={color}
                      emissive={color}
                      emissiveIntensity={0.35}
                      transparent
                      opacity={selectedLevel === 'all' ? 0.28 : 0.14}
                    />
                  </mesh>
                  {/* Stepped Stair Treads */}
                  {selectedLevel === 'all' &&
                    [0.18, 0.36, 0.54, 0.72, 0.88].map((frac, sIdx) => (
                      <mesh
                        key={sIdx}
                        position={[
                          Math.cos(sIdx * 0.9) * 0.35,
                          -sh.height / 2 + sh.height * frac,
                          Math.sin(sIdx * 0.9) * 0.35,
                        ]}
                      >
                        <boxGeometry args={[0.9, 0.16, 0.55]} />
                        <meshStandardMaterial
                          color="#f59e0b"
                          emissive="#d97706"
                          emissiveIntensity={0.45}
                        />
                      </mesh>
                    ))}
                </>
              )}
            </group>

            {sh.kind === 'lift' && !sh.closed && selectedLevel === 'all' && (
              <AnimatedLiftCab
                x={sh.x}
                z={sh.z}
                yMin={sh.yMin}
                yMax={sh.yMax}
                seed={idx * 1.7}
              />
            )}
          </group>
        );
      })}

      {/* Corridor Graph Edges */}
      {graph.edges.map((e) => {
        const s = nodeById.get(e.source);
        const t = nodeById.get(e.target);
        if (!s || !t) return null;
        const onSelectedFloor =
          selectedLevel === 'all' ||
          s.level === selectedLevel ||
          t.level === selectedLevel;
        if (!onSelectedFloor) return null;

        const [sx, sy, sz] = tf.toWorld(s.x, s.y, s.level);
        const [tx, ty, tz] = tf.toWorld(t.x, t.y, t.level);

        return (
          <Line
            key={e.id}
            points={[
              [sx, sy + 0.24, sz],
              [tx, ty + 0.24, tz],
            ]}
            color={e.closed ? '#f43f5e' : daylight ? '#475569' : '#64748b'}
            lineWidth={e.closed ? 2.4 : 1.2}
            transparent
            opacity={e.closed ? 0.9 : 0.42}
          />
        );
      })}

      {/* Active Luminous Route Ribbon */}
      {routePoints.length >= 2 && (
        <Line
          points={routePoints}
          vertexColors={routeColors}
          lineWidth={5.5}
          transparent
          opacity={0.98}
        />
      )}

      {/* Place & Corridor Nodes + 3D Volumetric Rooms + Facility Radar Pillars */}
      {graph.nodes.map((node) => {
        const isStart = node.id === startNodeId;
        const isEnd = node.id === endNodeId;
        const isSelected = node.id === selectedNodeId;
        const isHovered = node.id === hoveredId;
        const inRoute = routeNodeSet.has(node.id);
        const isRadarMatch = matchesRadarFilter(node, radarFilter);
        const levelMatch =
          selectedLevel === 'all' || node.level === selectedLevel;

        if (
          !levelMatch &&
          !inRoute &&
          !isStart &&
          !isEnd &&
          !isSelected &&
          !isRadarMatch
        ) {
          return null;
        }
        if (!node.is_place && !inRoute && !isSelected && !isRadarMatch) {
          return null;
        }

        const [wx, wy, wz] = tf.toWorld(node.x, node.y, node.level);
        const color = isStart
          ? '#38bdf8'
          : isEnd
            ? '#fb7185'
            : isSelected
              ? '#c084fc'
              : nodeColor(node);

        const radius = node.is_place
          ? isSelected || isHovered
            ? 0.66
            : 0.46
          : 0.24;

        const showLabel =
          isHovered ||
          isSelected ||
          isStart ||
          isEnd ||
          isRadarMatch ||
          ((cameraMode === 'chase' || cameraMode === 'first_person') &&
            inRoute &&
            node.is_place);

        const roomBoxW =
          node.kind.toLowerCase().includes('ward') ||
          node.kind.toLowerCase().includes('lobby') ||
          node.kind.toLowerCase().includes('mess')
            ? 3.1
            : 2.2;
        const roomBoxD =
          node.kind.toLowerCase().includes('ward') ||
          node.kind.toLowerCase().includes('lobby') ||
          node.kind.toLowerCase().includes('mess')
            ? 2.8
            : 2.0;
        const roomBoxH = 2.15;

        return (
          <group key={node.id} position={[wx, wy + 0.28, wz]}>
            {/* 3D Volumetric Architectural Room Enclosure */}
            {showRoomVolumes && node.is_place && levelMatch && (
              <group position={[0, roomBoxH / 2 - 0.08, 0]}>
                <mesh
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectNode?.(node);
                  }}
                >
                  <boxGeometry args={[roomBoxW, roomBoxH, roomBoxD]} />
                  <meshPhysicalMaterial
                    color={color}
                    transparent
                    opacity={
                      isSelected || isStart || isEnd || inRoute ? 0.28 : 0.14
                    }
                    roughness={0.18}
                    metalness={0.1}
                    depthWrite={false}
                  />
                </mesh>
                <Line
                  points={rectBorder(roomBoxW, roomBoxD)}
                  position={[0, roomBoxH / 2, 0]}
                  color={color}
                  lineWidth={isSelected || inRoute ? 2.1 : 1.1}
                  transparent
                  opacity={isSelected || inRoute ? 0.92 : 0.55}
                />
              </group>
            )}

            {/* 3D Facility Radar Highlight Beam */}
            {isRadarMatch && (
              <group position={[0, 4.2, 0]}>
                <mesh>
                  <cylinderGeometry args={[0.16, 0.58, 8.4, 20, 1, true]} />
                  <meshBasicMaterial
                    color={color}
                    transparent
                    opacity={0.38}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                  />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4.1, 0]}>
                  <ringGeometry args={[0.68, 1.15, 28]} />
                  <meshBasicMaterial
                    color={color}
                    transparent
                    opacity={0.85}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </group>
            )}

            <mesh
              onClick={(ev) => {
                ev.stopPropagation();
                onSelectNode?.(node);
              }}
              onPointerOver={(ev) => {
                ev.stopPropagation();
                setHoveredId(node.id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHoveredId((prev) => (prev === node.id ? null : prev));
                document.body.style.cursor = 'auto';
              }}
            >
              <cylinderGeometry args={[radius, radius, 0.3, 22]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={
                  isSelected || isHovered || isRadarMatch ? 1.65 : 0.95
                }
              />
            </mesh>

            {showLabel && (
              <Html
                position={[
                  0,
                  isEnd
                    ? 2.6
                    : isStart
                      ? 2.1
                      : showRoomVolumes && node.is_place
                        ? 2.35
                        : 1.25,
                  0,
                ]}
                center
                style={{ pointerEvents: 'none' }}
              >
                <div
                  className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold shadow-lg backdrop-blur-md ring-1 ${
                    isStart
                      ? 'bg-sky-500/95 text-white ring-sky-300'
                      : isEnd
                        ? 'bg-rose-500/95 text-white ring-rose-300'
                        : isSelected
                          ? 'bg-purple-600/95 text-white ring-purple-300'
                          : isRadarMatch
                            ? 'bg-emerald-600/95 text-white ring-emerald-300'
                            : 'bg-slate-900/90 text-white ring-white/20'
                  }`}
                >
                  <span>
                    {isStart
                      ? '📍 Start: '
                      : isEnd
                        ? '🏁 Dest: '
                        : isRadarMatch
                          ? '📡 '
                          : ''}
                    {node.name}
                  </span>
                  <span className="ml-1.5 text-[10px] opacity-80">
                    ({formatLevel(node.level, node.floor_name)})
                  </span>
                </div>
              </Html>
            )}
          </group>
        );
      })}

      {/* Animated Walker + Follow Camera + Start/Destination Beacons + Route Flow Cones */}
      <WalkerAndBeacons
        routePoints={routePoints}
        startPos={startPos}
        endPos={endPos}
        walkerProgress={walkerProgress}
        isPlayingWalker={isPlayingWalker}
        cameraMode={cameraMode}
      />

      <ContactShadows
        position={[0, baseFloorY - 2.15, 0]}
        opacity={daylight ? 0.32 : 0.48}
        scale={90}
        blur={2.5}
        far={28}
      />
    </group>
  );
};

const Venue3D: React.FC<Venue3DProps> = (props) => {
  const hasRoute = (props.routePath?.length ?? 0) >= 2;
  const [cameraMode, setCameraMode] = useState<Camera3DMode>('orbit');
  const [explodeFactor, setExplodeFactor] = useState<number>(1);
  const [showRoomVolumes, setShowRoomVolumes] = useState<boolean>(true);
  const [radarFilter, setRadarFilter] = useState<Radar3DFilter>('none');
  const [daylight, setDaylight] = useState(false);
  const [mobileTouchOrbit, setMobileTouchOrbit] = useState(true);
  const [inspectedNode, setInspectedNode] = useState<GNode | null>(null);

  // Sync selectedNodeId prop with inspected node
  useEffect(() => {
    if (props.selectedNodeId) {
      const match = props.graph.nodes.find((n) => n.id === props.selectedNodeId);
      if (match) setInspectedNode(match);
    }
  }, [props.selectedNodeId, props.graph.nodes]);

  // Reset chase/first_person camera mode if route is cleared
  useEffect(() => {
    if (!hasRoute && (cameraMode === 'chase' || cameraMode === 'first_person')) {
      setCameraMode('orbit');
    }
  }, [hasRoute, cameraMode]);

  // Route place nodes for sequential landmark carousel
  const routePlaces = useMemo(() => {
    if (!props.routePath || props.routePath.length === 0) return [];
    const placeMap = new Map<string, GNode>();
    for (const nid of props.routePath) {
      const n = props.graph.nodes.find((node) => node.id === nid);
      if (n && (n.is_place || n.photo_url)) {
        placeMap.set(n.id, n);
      }
    }
    return Array.from(placeMap.values());
  }, [props.routePath, props.graph.nodes]);

  const routePlaceIndex = useMemo(() => {
    if (!inspectedNode) return -1;
    return routePlaces.findIndex((p) => p.id === inspectedNode.id);
  }, [inspectedNode, routePlaces]);

  const handlePrevPlace = () => {
    if (routePlaces.length === 0) return;
    const curIdx = routePlaceIndex >= 0 ? routePlaceIndex : 0;
    const prevIdx = (curIdx - 1 + routePlaces.length) % routePlaces.length;
    const nextNode = routePlaces[prevIdx];
    setInspectedNode(nextNode);
    props.onSelectNode?.(nextNode);
  };

  const handleNextPlace = () => {
    if (routePlaces.length === 0) return;
    const curIdx = routePlaceIndex >= 0 ? routePlaceIndex : 0;
    const nextIdx = (curIdx + 1) % routePlaces.length;
    const nextNode = routePlaces[nextIdx];
    setInspectedNode(nextNode);
    props.onSelectNode?.(nextNode);
  };

  const cycleExplodeFactor = () => {
    setExplodeFactor((prev) => (prev === 1 ? 1.7 : prev === 1.7 ? 2.5 : 1));
  };

  return (
    <div
      className={`relative h-full w-full select-none rounded-2xl overflow-hidden transition-colors duration-500 ${
        daylight
          ? 'bg-gradient-to-b from-sky-100 via-slate-100 to-slate-200 spatial-grid-light ring-1 ring-slate-300'
          : 'bg-[#070B18] spatial-grid-dark'
      }`}
    >
      <Canvas
        camera={{ position: [34, 30, 38], fov: 41 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color
          attach="background"
          args={[daylight ? '#eef4fb' : '#070B18']}
        />
        <ambientLight intensity={daylight ? 1.35 : 0.95} />
        <directionalLight
          position={[25, 48, 25]}
          intensity={daylight ? 1.75 : 1.4}
          color={daylight ? '#ffffff' : '#f0f9ff'}
        />
        <pointLight
          position={[-25, 20, -20]}
          intensity={daylight ? 0.5 : 1.0}
          color="#6366f1"
        />
        <pointLight
          position={[20, 15, 20]}
          intensity={daylight ? 0.5 : 0.95}
          color="#38bdf8"
        />
        <SceneContent
          {...props}
          cameraMode={cameraMode}
          daylight={daylight}
          explodeFactor={explodeFactor}
          showRoomVolumes={showRoomVolumes}
          radarFilter={radarFilter}
          onSelectNode={(node) => {
            setInspectedNode(node);
            props.onSelectNode?.(node);
          }}
        />
        {cameraMode === 'orbit' && (
          <OrbitControls
            makeDefault
            enabled={mobileTouchOrbit}
            enableDamping
            dampingFactor={0.07}
            minDistance={12}
            maxDistance={135}
            maxPolarAngle={Math.PI / 2.04}
            touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
          />
        )}
      </Canvas>

      {/* Top Left 4-Mode 3D Camera Bar */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1 rounded-xl bg-slate-950/85 p-1 text-[11px] ring-1 ring-white/15 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setCameraMode('orbit')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold transition ${
            cameraMode === 'orbit'
              ? 'bg-cyan-500 text-slate-950 shadow-sm'
              : 'text-slate-300 hover:bg-white/10'
          }`}
        >
          <Orbit className="h-3.5 w-3.5" />
          Orbit 3D
        </button>

        {hasRoute && (
          <>
            <button
              type="button"
              onClick={() => setCameraMode('chase')}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold transition ${
                cameraMode === 'chase'
                  ? 'bg-emerald-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              <Navigation className="h-3.5 w-3.5" />
              Chase POV
            </button>
            <button
              type="button"
              onClick={() => setCameraMode('first_person')}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold transition ${
                cameraMode === 'first_person'
                  ? 'bg-purple-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              1st-Person Walk
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() =>
            setCameraMode((m) => (m === 'top_down' ? 'orbit' : 'top_down'))
          }
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold transition ${
            cameraMode === 'top_down'
              ? 'bg-amber-400 text-slate-950 shadow-sm'
              : 'text-slate-300 hover:bg-white/10'
          }`}
          title="Top-down architectural drone view"
        >
          <Compass className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Drone Top</span>
        </button>
      </div>

      {/* Top Right 3D Architectural Controls (Explode Stack, 3D Rooms, Daylight, Mobile Orbit) */}
      <div className="absolute top-3 right-3 z-10 flex flex-wrap items-center justify-end gap-1.5">
        {props.selectedLevel === 'all' && (
          <button
            type="button"
            onClick={cycleExplodeFactor}
            className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-bold ring-1 backdrop-blur-md transition ${
              explodeFactor > 1
                ? 'bg-indigo-500/90 text-white ring-indigo-300 shadow-md'
                : 'bg-slate-950/80 text-slate-200 ring-white/15 hover:bg-slate-900'
            }`}
            title="Explode vertical spacing between floors for X-Ray inspection"
          >
            <Layers className="h-3.5 w-3.5 text-cyan-300" />
            <span>Explode {explodeFactor}×</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowRoomVolumes((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-bold ring-1 backdrop-blur-md transition ${
            showRoomVolumes
              ? 'bg-cyan-500/90 text-slate-950 ring-cyan-300'
              : 'bg-slate-950/80 text-slate-300 ring-white/15 hover:bg-slate-900'
          }`}
          title="Toggle 3D Volumetric Room Enclosures"
        >
          <Box className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">3D Rooms</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTouchOrbit((v) => !v)}
          className={`sm:hidden inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-bold ring-1 backdrop-blur-md transition ${
            mobileTouchOrbit
              ? 'bg-cyan-500/90 text-slate-950 ring-cyan-300'
              : 'bg-slate-900/90 text-amber-300 ring-amber-400/40'
          }`}
          title="Toggle 3D Orbit vs Page Scroll on Mobile"
        >
          {mobileTouchOrbit ? '🕹️ Orbit' : '📜 Scroll'}
        </button>

        <button
          type="button"
          onClick={() => setDaylight((v) => !v)}
          className="inline-flex items-center gap-1 rounded-xl bg-slate-950/80 px-2.5 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/15 backdrop-blur-md hover:bg-slate-900 transition"
        >
          {daylight ? (
            <>
              <Moon className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Night</span>
            </>
          ) : (
            <>
              <Sun className="h-3.5 w-3.5 text-amber-300" />
              <span className="hidden sm:inline">Daylight</span>
            </>
          )}
        </button>
      </div>

      {/* 3D Facility Radar Highlight Bar (Emergency/Exits, Lifts/Stairs, Washrooms) */}
      <div className="absolute top-14 left-3 z-10 flex items-center gap-1 rounded-xl bg-slate-950/80 p-1 text-[10px] ring-1 ring-white/10 backdrop-blur-md">
        <span className="inline-flex items-center gap-1 px-1.5 text-slate-400 font-bold">
          <Radar className="h-3 w-3 text-cyan-400" />
          <span className="hidden sm:inline">3D Radar:</span>
        </span>
        {(
          [
            { id: 'none', label: 'Off' },
            { id: 'emergency', label: '🚨 Exits/ER' },
            { id: 'lift', label: '🛗 Lifts/Stairs' },
            { id: 'washroom', label: '🚻 WC' },
          ] as { id: Radar3DFilter; label: string }[]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              setRadarFilter((cur) => (cur === item.id ? 'none' : item.id))
            }
            className={`rounded-lg px-2 py-0.5 font-bold transition ${
              radarFilter === item.id
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* FIXED ANCHOR INSPECTOR PANEL & LANDMARK CAROUSEL (Never overlaps 3D scene) */}
      {inspectedNode && (
        <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 z-20 w-[calc(100%-1.5rem)] sm:w-80 rounded-2xl bg-slate-950/92 p-3 text-white ring-1 ring-white/20 shadow-2xl backdrop-blur-xl transition-all">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-2 w-2 rounded-full bg-cyan-400 shrink-0 animate-pulse" />
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-300 truncate">
                {inspectedNode.building_name} ·{' '}
                {formatLevel(inspectedNode.level, inspectedNode.floor_name)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setInspectedNode(null)}
              className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-white/10"
              title="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Media View (Video or High-DPI Photo) */}
          <div className="relative h-40 w-full overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10">
            {inspectedNode.video_url ? (
              <video
                src={mediaUrl(inspectedNode.video_url)}
                poster={
                  inspectedNode.photo_url
                    ? mediaUrl(inspectedNode.photo_url)
                    : undefined
                }
                autoPlay
                loop
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            ) : inspectedNode.photo_url ? (
              <img
                src={mediaUrl(inspectedNode.photo_url)}
                alt={inspectedNode.name}
                loading="lazy"
                className="h-full w-full object-cover hdr-photo"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                No preview photo for this spot
              </div>
            )}
            <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
              {inspectedNode.kind}
            </span>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h4 className="font-display text-sm font-bold truncate">
                {inspectedNode.id === props.startNodeId
                  ? '📍 '
                  : inspectedNode.id === props.endNodeId
                    ? '🏁 '
                    : ''}
                {inspectedNode.name}
              </h4>
              <p className="text-[11px] text-slate-400 truncate">
                {inspectedNode.category || inspectedNode.kind}
              </p>
            </div>

            {/* Landmark Carousel Buttons */}
            {routePlaces.length > 1 && (
              <div className="flex items-center gap-1 shrink-0 bg-white/10 rounded-xl p-0.5">
                <button
                  type="button"
                  onClick={handlePrevPlace}
                  className="rounded-lg p-1 text-white hover:bg-white/20 transition"
                  title="Previous route landmark"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-[10px] font-mono font-bold px-1 text-cyan-300">
                  {routePlaceIndex >= 0
                    ? `${routePlaceIndex + 1}/${routePlaces.length}`
                    : `1/${routePlaces.length}`}
                </span>
                <button
                  type="button"
                  onClick={handleNextPlace}
                  className="rounded-lg p-1 text-white hover:bg-white/20 transition"
                  title="Next route landmark"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subtle 3D Legend Overlay (only when panel is not open or on desktop) */}
      {!inspectedNode && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-950/80 px-3 py-1.5 text-[11px] text-slate-200 ring-1 ring-white/10 backdrop-blur-md">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-sky-400" /> 3D Rooms
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Flow Cones
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-cyan-400" /> Moving Lift
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> 3D Stairs
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500" /> Destination
          </span>
          <span className="hidden sm:inline text-slate-400 ml-1">
            · Tap any room/pin to inspect
          </span>
        </div>
      )}
    </div>
  );
};

export default Venue3D;

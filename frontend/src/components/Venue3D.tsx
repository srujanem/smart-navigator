import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Building, GEdge, GNode, Graph, VenueDetail } from '../lib/types';
import { formatLevel } from '../lib/locationStore';

export interface Venue3DProps {
  venue: VenueDetail;
  graph: Graph;
  selectedLevel: number | 'all';
  selectedNodeId?: string | null;
  startNodeId?: string | null;
  endNodeId?: string | null;
  routePath?: string[];
  walkerProgress?: number | null; // 0..1 when externally scrubbed, null for automatic loop
  isPlayingWalker?: boolean;
  onSelectNode?: (node: GNode) => void;
}

interface Transform3D {
  toWorld: (x: number, y: number, level: number) => [number, number, number];
  scale: number;
  levels: number[];
}

const LEVEL_GAP = 12;

function computeTransform(venue: VenueDetail, graph: Graph): Transform3D {
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

  const centerYOffset = ((levels.length - 1) * LEVEL_GAP) / 2;

  return {
    scale,
    levels,
    toWorld: (x: number, y: number, level: number) => {
      const idx = levelIndexMap.get(level) ?? 0;
      return [
        (x - cx) * scale,
        idx * LEVEL_GAP - centerYOffset,
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

const WalkerAndBeacons: React.FC<{
  routePoints: [number, number, number][];
  startPos: [number, number, number] | null;
  endPos: [number, number, number] | null;
  walkerProgress?: number | null;
  isPlayingWalker: boolean;
}> = ({ routePoints, startPos, endPos, walkerProgress, isPlayingWalker }) => {
  const walkerRef = useRef<THREE.Mesh>(null);
  const walkerAuraRef = useRef<THREE.Mesh>(null);
  const startRingRef = useRef<THREE.Mesh>(null);
  const endRingRef = useRef<THREE.Mesh>(null);
  const internalProgress = useRef(0);

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
            <sphereGeometry args={[0.52, 24, 24]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh ref={walkerAuraRef}>
            <sphereGeometry args={[1.05, 24, 24]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.42} />
          </mesh>
        </>
      )}

      {startPos && (
        <group position={startPos}>
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

const SceneContent: React.FC<Venue3DProps> = ({
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
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const tf = useMemo(() => computeTransform(venue, graph), [venue, graph]);

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
      const c = new THREE.Color('#38bdf8').lerp(new THREE.Color('#34d399'), t);
      return [c.r, c.g, c.b] as [number, number, number];
    });
  }, [routePoints]);

  // Vertical shafts for lift/stairs edges connecting different levels
  const verticalShafts = useMemo(() => {
    const list: {
      id: string;
      x: number;
      z: number;
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

  return (
    <group>
      {/* Subtle Ground Spatial Grid */}
      <gridHelper
        args={[85, 42, '#1e293b', '#0f172a']}
        position={[0, tf.toWorld(0, 0, tf.levels[0])[1] - 2.2, 0]}
      />

      {/* Building Floor Slabs */}
      {venue.buildings.map((b: Building) =>
        b.floors.map((fl) => {
          const isFocused = selectedLevel === 'all' || selectedLevel === fl.level;
          const [cx, wy, cz] = tf.toWorld(b.x + b.w / 2, b.y + b.d / 2, fl.level);
          const sw = Math.max(b.w * tf.scale, 2.5);
          const sd = Math.max(b.d * tf.scale, 2.5);
          const border = rectBorder(sw, sd);
          const isTopFloor =
            fl.level === Math.max(...b.floors.map((f) => f.level));

          return (
            <group key={`${b.id}-${fl.id}`} position={[cx, wy, cz]}>
              <mesh receiveShadow>
                <boxGeometry args={[sw, 0.28, sd]} />
                <meshPhysicalMaterial
                  color={isFocused ? '#102044' : '#0b1329'}
                  transparent
                  opacity={isFocused ? 0.58 : 0.14}
                  roughness={0.22}
                  metalness={0.15}
                />
              </mesh>
              <Line
                points={border}
                position={[0, 0.16, 0]}
                color={isFocused ? '#38bdf8' : '#334155'}
                lineWidth={isFocused ? 1.5 : 0.8}
                transparent
                opacity={isFocused ? 0.65 : 0.22}
              />
              {isTopFloor && (selectedLevel === 'all' || isFocused) && (
                <Html
                  position={[-sw / 2 + 1.2, 1.4, -sd / 2 + 1.2]}
                  center={false}
                  style={{ pointerEvents: 'none' }}
                >
                  <div className="whitespace-nowrap rounded-md bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-500/30 backdrop-blur-sm">
                    {b.name}
                  </div>
                </Html>
              )}
            </group>
          );
        }),
      )}

      {/* Vertical Lift & Stair Shafts */}
      {verticalShafts.map((sh) => {
        const color = sh.closed
          ? '#f43f5e'
          : sh.kind === 'lift'
            ? '#06b6d4'
            : '#f59e0b';
        return (
          <group key={sh.id} position={[sh.x, sh.yMid, sh.z]}>
            <mesh>
              <cylinderGeometry args={[0.55, 0.55, sh.height, 16]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.35}
                transparent
                opacity={selectedLevel === 'all' ? 0.26 : 0.14}
              />
            </mesh>
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
              [sx, sy + 0.22, sz],
              [tx, ty + 0.22, tz],
            ]}
            color={e.closed ? '#f43f5e' : '#64748b'}
            lineWidth={e.closed ? 2.2 : 1.1}
            transparent
            opacity={e.closed ? 0.85 : 0.36}
          />
        );
      })}

      {/* Active Luminous Route Ribbon */}
      {routePoints.length >= 2 && (
        <Line
          points={routePoints}
          vertexColors={routeColors}
          lineWidth={5}
          transparent
          opacity={0.98}
        />
      )}

      {/* Place & Corridor Nodes */}
      {graph.nodes.map((node) => {
        const isStart = node.id === startNodeId;
        const isEnd = node.id === endNodeId;
        const isSelected = node.id === selectedNodeId;
        const isHovered = node.id === hoveredId;
        const inRoute = routeNodeSet.has(node.id);
        const levelMatch =
          selectedLevel === 'all' || node.level === selectedLevel;

        if (!levelMatch && !inRoute && !isStart && !isEnd && !isSelected) {
          return null;
        }
        if (!node.is_place && !inRoute && !isSelected) {
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

        const radius = node.is_place ? (isSelected || isHovered ? 0.62 : 0.44) : 0.22;
        const showLabel = isHovered || isSelected || isStart || isEnd;

        return (
          <group key={node.id} position={[wx, wy + 0.26, wz]}>
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
              <cylinderGeometry args={[radius, radius, 0.28, 20]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isSelected || isHovered ? 1.5 : 0.95}
              />
            </mesh>

            {showLabel && (
              <Html
                position={[0, isEnd ? 3.2 : isStart ? 1.7 : 1.15, 0]}
                center
                style={{ pointerEvents: 'none' }}
              >
                <div
                  className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold shadow-lg backdrop-blur-md ring-1 ${
                    isStart
                      ? 'bg-sky-500/90 text-white ring-sky-300'
                      : isEnd
                        ? 'bg-rose-500/95 text-white ring-rose-300'
                        : 'bg-slate-900/90 text-white ring-white/20'
                  }`}
                >
                  <span>
                    {isStart ? '📍 Start: ' : isEnd ? '🏁 Dest: ' : ''}
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

      {/* Animated Walker + Start/Destination Beacons */}
      <WalkerAndBeacons
        routePoints={routePoints}
        startPos={startPos}
        endPos={endPos}
        walkerProgress={walkerProgress}
        isPlayingWalker={isPlayingWalker}
      />
    </group>
  );
};

const Venue3D: React.FC<Venue3DProps> = (props) => {
  return (
    <div className="relative h-full w-full select-none rounded-2xl overflow-hidden bg-[#070B18] spatial-grid-dark">
      <Canvas
        camera={{ position: [34, 30, 38], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#070B18']} />
        <ambientLight intensity={0.95} />
        <directionalLight position={[25, 45, 25]} intensity={1.35} color="#f0f9ff" />
        <pointLight position={[-25, 20, -20]} intensity={1.0} color="#6366f1" />
        <pointLight position={[20, 15, 20]} intensity={0.9} color="#38bdf8" />
        <SceneContent {...props} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.07}
          minDistance={12}
          maxDistance={120}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>

      {/* Subtle 3D Legend Overlay */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-950/75 px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-white/10 backdrop-blur-md">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-sky-400" /> Places
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-cyan-400" /> Lift Shaft
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> Stairs
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-rose-500" /> Closed / Pin
        </span>
        <span className="hidden sm:inline text-slate-400 ml-1">
          · Drag to orbit · Scroll to zoom · Click any node
        </span>
      </div>
    </div>
  );
};

export default Venue3D;

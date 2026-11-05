import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Float, Line, OrbitControls } from '@react-three/drei';
import { Moon, Sun } from 'lucide-react';
import * as THREE from 'three';

interface SlabSpec {
  pos: [number, number, number];
  size: [number, number];
  level: number;
  wallHeight?: number;
}

const SLABS: SlabSpec[] = [
  // Ground complex
  { pos: [0, 0, 0], size: [11.8, 7.6], level: 0, wallHeight: 2.5 },
  { pos: [-6.3, 0, 1.4], size: [4.8, 5.2], level: 0, wallHeight: 2.5 },
  { pos: [6.1, 0, -1.2], size: [4.6, 5.0], level: 0, wallHeight: 2.5 },
  // Level 1
  { pos: [0, 2.5, 0], size: [10.8, 6.9], level: 1, wallHeight: 2.5 },
  { pos: [-5.9, 2.5, 1.4], size: [4.4, 4.8], level: 1, wallHeight: 2.4 },
  { pos: [5.8, 2.5, -1.2], size: [4.2, 4.6], level: 1, wallHeight: 2.5 },
  // Level 2
  { pos: [0, 5.0, 0], size: [9.6, 6.1], level: 2, wallHeight: 2.5 },
  { pos: [5.4, 5.0, -1.2], size: [3.9, 4.3], level: 2, wallHeight: 2.2 },
  // Level 3 Penthouse / Specialty Atrium
  { pos: [0.6, 7.5, -0.3], size: [6.8, 4.6], level: 3, wallHeight: 1.9 },
];

const SPATIAL_NODES: { pos: [number, number, number]; color: string }[] = [
  { pos: [-4.6, 0.18, 3.1], color: '#38bdf8' },
  { pos: [-1.8, 0.18, 1.6], color: '#818cf8' },
  { pos: [2.8, 0.18, 2.0], color: '#34d399' },
  { pos: [6.2, 0.18, -1.5], color: '#38bdf8' },
  { pos: [-5.6, 2.68, 1.2], color: '#818cf8' },
  { pos: [-2.2, 2.68, -1.5], color: '#38bdf8' },
  { pos: [3.2, 2.68, 1.4], color: '#34d399' },
  { pos: [5.8, 2.68, -1.0], color: '#f472b6' },
  { pos: [-2.8, 5.18, 1.3], color: '#38bdf8' },
  { pos: [2.5, 5.18, -1.1], color: '#818cf8' },
  { pos: [5.5, 5.18, -1.2], color: '#34d399' },
  { pos: [-1.2, 7.68, -0.4], color: '#38bdf8' },
  { pos: [2.4, 7.68, 0.5], color: '#34d399' },
];

const ROUTE_WAYPOINTS: [number, number, number][] = [
  [-4.6, 0.24, 3.1], // Ground Entrance
  [-2.0, 0.24, 3.1],
  [-2.0, 0.24, 0.3],
  [0.9, 0.24, 0.3], // Lift Core Ground
  [0.9, 2.74, 0.3], // Lift Core L1
  [0.9, 5.24, 0.3], // Lift Core L2
  [3.1, 5.24, 0.3],
  [3.1, 5.24, -1.2],
  [5.5, 5.24, -1.2], // Destination Node on L2 East Wing
];

function buildRectBorder(w: number, d: number): [number, number, number][] {
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

const ArchitecturalWing: React.FC<{
  slab: SlabSpec;
  daylight: boolean;
}> = ({ slab, daylight }) => {
  const [w, d] = slab.size;
  const wh = slab.wallHeight ?? 2.4;
  const borderPts = useMemo(() => buildRectBorder(w, d), [w, d]);
  const topBorderPts = useMemo(() => buildRectBorder(w, d), [w, d]);
  const hw = w / 2 - 0.16;
  const hd = d / 2 - 0.16;

  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];

  const edgeColor =
    slab.level === 2
      ? '#38bdf8'
      : daylight
        ? '#0284c7'
        : '#6366f1';

  return (
    <group position={slab.pos}>
      {/* Floor Slab */}
      <mesh receiveShadow castShadow>
        <boxGeometry args={[w, 0.16, d]} />
        <meshPhysicalMaterial
          color={daylight ? '#e2e8f0' : '#0f1f44'}
          transparent
          opacity={daylight ? 0.84 : 0.62}
          roughness={0.18}
          metalness={0.22}
          clearcoat={0.6}
        />
      </mesh>

      {/* Architectural Glass Curtain Facade */}
      <mesh position={[0, wh / 2, 0]}>
        <boxGeometry args={[w - 0.08, wh - 0.16, d - 0.08]} />
        <meshPhysicalMaterial
          color={daylight ? '#bae6fd' : '#1e3a8a'}
          transparent
          opacity={daylight ? 0.16 : 0.11}
          roughness={0.08}
          metalness={0.1}
          transmission={0.35}
          depthWrite={false}
        />
      </mesh>

      {/* 4 Structural Corner Columns */}
      {corners.map(([cx, cz], i) => (
        <mesh key={i} position={[cx, wh / 2, cz]}>
          <boxGeometry args={[0.14, wh, 0.14]} />
          <meshStandardMaterial
            color={daylight ? '#64748b' : '#38bdf8'}
            emissive={daylight ? '#0f172a' : '#0284c7'}
            emissiveIntensity={daylight ? 0.05 : 0.35}
            transparent
            opacity={0.55}
          />
        </mesh>
      ))}

      {/* Floor & Ceiling Glowing Mullionims */}
      <Line
        points={borderPts}
        position={[0, 0.09, 0]}
        color={edgeColor}
        lineWidth={1.5}
        transparent
        opacity={0.7}
      />
      <Line
        points={topBorderPts}
        position={[0, wh - 0.05, 0]}
        color={edgeColor}
        lineWidth={0.9}
        transparent
        opacity={0.35}
      />
    </group>
  );
};

const HologramComplex: React.FC<{ daylight: boolean }> = ({ daylight }) => {
  const groupRef = useRef<THREE.Group>(null);
  const walkerRef = useRef<THREE.Mesh>(null);
  const walkerGlowRef = useRef<THREE.Mesh>(null);
  const elevatorCabRef = useRef<THREE.Mesh>(null);
  const pulseRing1Ref = useRef<THREE.Mesh>(null);
  const pulseRing2Ref = useRef<THREE.Mesh>(null);
  const startRingRef = useRef<THREE.Mesh>(null);

  const curve = useMemo(() => {
    const pts = ROUTE_WAYPOINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < pts.length - 1; i++) {
      path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    }
    return path;
  }, []);

  const routeColors = useMemo(() => {
    return ROUTE_WAYPOINTS.map((_, idx) => {
      const t = idx / (ROUTE_WAYPOINTS.length - 1);
      const c = new THREE.Color('#06b6d4').lerp(new THREE.Color('#10b981'), t);
      return [c.r, c.g, c.b] as [number, number, number];
    });
  }, []);

  const particles = useMemo(() => {
    const count = 130;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s1 = Math.sin(i * 12.9898) * 43758.5453;
      const s2 = Math.sin(i * 78.233 + 1.5) * 43758.5453;
      const s3 = Math.sin(i * 39.425 + 3.1) * 43758.5453;
      const r1 = s1 - Math.floor(s1);
      const r2 = s2 - Math.floor(s2);
      const r3 = s3 - Math.floor(s3);
      positions[i * 3] = (r1 - 0.5) * 25;
      positions[i * 3 + 1] = r2 * 11.5 - 0.8;
      positions[i * 3 + 2] = (r3 - 0.5) * 19;
    }
    return positions;
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    if (groupRef.current) {
      const targetRotY = t * 0.13 + state.pointer.x * 0.3;
      const targetRotX = state.pointer.y * 0.1;
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        targetRotY,
        0.04,
      );
      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x,
        targetRotX,
        0.04,
      );
    }

    const u = (t * 0.16) % 1;
    const pt = curve.getPointAt(u);
    if (walkerRef.current) {
      walkerRef.current.position.copy(pt);
    }
    if (walkerGlowRef.current) {
      walkerGlowRef.current.position.copy(pt);
      walkerGlowRef.current.scale.setScalar(1 + Math.sin(t * 6) * 0.24);
    }

    // Smoothly animate physical glass elevator cabin along shaft
    if (elevatorCabRef.current) {
      const cabY = Math.max(0.55, Math.min(7.8, pt.y + 0.35));
      elevatorCabRef.current.position.y = THREE.MathUtils.lerp(
        elevatorCabRef.current.position.y,
        cabY,
        0.12,
      );
    }

    if (pulseRing1Ref.current) {
      const p1 = (t * 0.7) % 1;
      pulseRing1Ref.current.scale.setScalar(0.6 + p1 * 2.3);
      (pulseRing1Ref.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - p1) * 0.75;
    }
    if (pulseRing2Ref.current) {
      const p2 = (t * 0.7 + 0.5) % 1;
      pulseRing2Ref.current.scale.setScalar(0.6 + p2 * 2.3);
      (pulseRing2Ref.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - p2) * 0.75;
    }
    if (startRingRef.current) {
      const ps = (t * 0.8) % 1;
      startRingRef.current.scale.setScalar(0.6 + ps * 2.0);
      (startRingRef.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - ps) * 0.7;
    }
  });

  const dest = ROUTE_WAYPOINTS[ROUTE_WAYPOINTS.length - 1];
  const start = ROUTE_WAYPOINTS[0];

  return (
    <group ref={groupRef} position={[0, -2.7, 0]}>
      <gridHelper
        args={[
          36,
          36,
          daylight ? '#94a3b8' : '#1e3a8a',
          daylight ? '#cbd5e1' : '#0f172a',
        ]}
        position={[0, -0.5, 0]}
      />

      {/* Realistic Architectural Glass Floor Wings */}
      {SLABS.map((slab, idx) => (
        <ArchitecturalWing key={idx} slab={slab} daylight={daylight} />
      ))}

      {/* Skybridge Linking Level 1 East Wing */}
      <mesh position={[3.3, 2.55, -0.6]}>
        <boxGeometry args={[2.2, 0.14, 1.3]} />
        <meshPhysicalMaterial
          color={daylight ? '#cbd5e1' : '#1e3a8a'}
          transparent
          opacity={0.75}
        />
      </mesh>

      {/* Central Glass Elevator Core + Moving Glowing Cabin */}
      <group position={[0.9, 0, 0.3]}>
        <mesh position={[0, 4.1, 0]}>
          <boxGeometry args={[1.32, 8.4, 1.32]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0284c7"
            emissiveIntensity={0.3}
            transparent
            opacity={0.14}
          />
        </mesh>
        <lineSegments position={[0, 4.1, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(1.34, 8.4, 1.34)]} />
          <lineBasicMaterial color="#38bdf8" transparent opacity={0.55} />
        </lineSegments>

        {/* Moving Elevator Car */}
        <mesh ref={elevatorCabRef} position={[0, 0.6, 0]}>
          <boxGeometry args={[1.02, 0.85, 1.02]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#22d3ee"
            emissiveIntensity={1.1}
            transparent
            opacity={0.82}
          />
        </mesh>
      </group>

      {/* West Wing 3D Stepped Staircase Flight */}
      <group position={[-5.8, 0.1, 1.4]}>
        {[0, 1, 2, 3, 4, 5, 6].map((stepIdx) => (
          <mesh
            key={stepIdx}
            position={[-0.45 + stepIdx * 0.16, stepIdx * 0.35 + 0.15, 0]}
          >
            <boxGeometry args={[0.24, 0.1, 0.95]} />
            <meshStandardMaterial
              color="#f59e0b"
              emissive="#d97706"
              emissiveIntensity={0.5}
              transparent
              opacity={0.8}
            />
          </mesh>
        ))}
      </group>

      {/* Glowing Spatial Place Nodes */}
      {SPATIAL_NODES.map((n, idx) => (
        <group key={idx} position={n.pos}>
          <mesh>
            <cylinderGeometry args={[0.2, 0.2, 0.16, 20]} />
            <meshStandardMaterial
              color={n.color}
              emissive={n.color}
              emissiveIntensity={1.25}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
            <ringGeometry args={[0.24, 0.39, 24]} />
            <meshBasicMaterial
              color={n.color}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}

      {/* Luminous Multi-Floor Route Ribbon */}
      <Line
        points={ROUTE_WAYPOINTS}
        vertexColors={routeColors}
        lineWidth={4.5}
        transparent
        opacity={0.98}
      />

      {/* Animated Walker Sphere */}
      <mesh ref={walkerRef}>
        <sphereGeometry args={[0.23, 20, 20]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh ref={walkerGlowRef}>
        <sphereGeometry args={[0.48, 20, 20]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.42} />
      </mesh>

      {/* Start Photo-Localized Beacon */}
      <group position={start}>
        <mesh position={[0, 0.34, 0]}>
          <sphereGeometry args={[0.25, 20, 20]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0284c7"
            emissiveIntensity={1.6}
          />
        </mesh>
        <mesh
          ref={startRingRef}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.28, 0.46, 32]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.65}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Floating 3D Destination Beacon Pin */}
      <group position={dest}>
        <mesh
          ref={pulseRing1Ref}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.3, 0.5, 32]} />
          <meshBasicMaterial
            color="#34d399"
            transparent
            opacity={0.75}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh
          ref={pulseRing2Ref}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.3, 0.5, 32]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.75}
            side={THREE.DoubleSide}
          />
        </mesh>

        <Float speed={3} rotationIntensity={0.3} floatIntensity={0.65}>
          <group position={[0, 1.1, 0]}>
            <mesh position={[0, 0.35, 0]}>
              <sphereGeometry args={[0.38, 24, 24]} />
              <meshStandardMaterial
                color="#34d399"
                emissive="#10b981"
                emissiveIntensity={1.45}
              />
            </mesh>
            <mesh position={[0, -0.15, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.27, 0.68, 24]} />
              <meshStandardMaterial
                color="#34d399"
                emissive="#059669"
                emissiveIntensity={1.15}
              />
            </mesh>
          </group>
        </Float>
      </group>

      {/* Ambient Spatial Particles */}
      {!daylight && (
        <points>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[particles, 3]}
            />
          </bufferGeometry>
          <pointsMaterial
            size={0.11}
            color="#7dd3fc"
            transparent
            opacity={0.55}
            sizeAttenuation
          />
        </points>
      )}
    </group>
  );
};

const Hero3D: React.FC = () => {
  const [daylight, setDaylight] = useState(false);

  return (
    <div
      className={`relative h-full w-full select-none transition-colors duration-500 ${
        daylight
          ? 'bg-gradient-to-b from-sky-100 via-slate-100 to-slate-200'
          : 'bg-transparent'
      }`}
    >
      <Canvas
        camera={{ position: [14.5, 10.6, 16.5], fov: 39 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={daylight ? 1.35 : 0.9} />
        <directionalLight
          position={[14, 22, 12]}
          intensity={daylight ? 1.8 : 1.45}
          color={daylight ? '#ffffff' : '#e0f2fe'}
        />
        <pointLight
          position={[-10, 6, -8]}
          intensity={daylight ? 0.6 : 1.2}
          color="#6366f1"
        />
        <pointLight
          position={[8, 8, 6]}
          intensity={daylight ? 0.6 : 1.1}
          color="#38bdf8"
        />
        <HologramComplex daylight={daylight} />
        <ContactShadows
          position={[0, -3.25, 0]}
          opacity={daylight ? 0.35 : 0.45}
          scale={28}
          blur={2.4}
          far={10}
        />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 5}
          maxPolarAngle={Math.PI / 2.22}
        />
      </Canvas>

      {/* Architectural Lighting Switcher */}
      <button
        type="button"
        onClick={() => setDaylight((v) => !v)}
        className="absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 rounded-xl bg-slate-950/80 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/15 backdrop-blur-md hover:bg-slate-900 transition"
      >
        {daylight ? (
          <>
            <Moon className="h-3.5 w-3.5 text-cyan-400" />
            Night Hologram
          </>
        ) : (
          <>
            <Sun className="h-3.5 w-3.5 text-amber-300" />
            Daylight Twin
          </>
        )}
      </button>
    </div>
  );
};

export default Hero3D;

import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface SlabSpec {
  pos: [number, number, number];
  size: [number, number];
  level: number;
}

const SLABS: SlabSpec[] = [
  // Ground complex
  { pos: [0, 0, 0], size: [11.5, 7.5], level: 0 },
  { pos: [-6.2, 0, 1.4], size: [4.8, 5.2], level: 0 },
  { pos: [6.0, 0, -1.2], size: [4.6, 5.0], level: 0 },
  // Level 1
  { pos: [0, 2.5, 0], size: [10.6, 6.8], level: 1 },
  { pos: [-5.8, 2.5, 1.4], size: [4.4, 4.8], level: 1 },
  { pos: [5.7, 2.5, -1.2], size: [4.2, 4.6], level: 1 },
  // Level 2
  { pos: [0, 5.0, 0], size: [9.4, 6.0], level: 2 },
  { pos: [5.3, 5.0, -1.2], size: [3.8, 4.2], level: 2 },
  // Level 3 Penthouse / Specialty Wing
  { pos: [0.6, 7.5, -0.3], size: [6.8, 4.6], level: 3 },
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

const HologramComplex: React.FC = () => {
  const groupRef = useRef<THREE.Group>(null);
  const walkerRef = useRef<THREE.Mesh>(null);
  const walkerGlowRef = useRef<THREE.Mesh>(null);
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
      const c = new THREE.Color('#38bdf8').lerp(new THREE.Color('#34d399'), t);
      return [c.r, c.g, c.b] as [number, number, number];
    });
  }, []);

  const particles = useMemo(() => {
    const count = 110;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Deterministic pseudo-random layout so renders stay pure
      const s1 = Math.sin(i * 12.9898) * 43758.5453;
      const s2 = Math.sin(i * 78.233 + 1.5) * 43758.5453;
      const s3 = Math.sin(i * 39.425 + 3.1) * 43758.5453;
      const r1 = s1 - Math.floor(s1);
      const r2 = s2 - Math.floor(s2);
      const r3 = s3 - Math.floor(s3);
      positions[i * 3] = (r1 - 0.5) * 24;
      positions[i * 3 + 1] = r2 * 11 - 0.8;
      positions[i * 3 + 2] = (r3 - 0.5) * 18;
    }
    return positions;
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    if (groupRef.current) {
      const targetRotY = t * 0.14 + state.pointer.x * 0.28;
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

    // Animate walker along path
    const u = (t * 0.16) % 1;
    const pt = curve.getPointAt(u);
    if (walkerRef.current) {
      walkerRef.current.position.copy(pt);
    }
    if (walkerGlowRef.current) {
      walkerGlowRef.current.position.copy(pt);
      const s = 1 + Math.sin(t * 6) * 0.22;
      walkerGlowRef.current.scale.setScalar(s);
    }

    // Expanding pulse rings at destination
    if (pulseRing1Ref.current) {
      const p1 = (t * 0.7) % 1;
      pulseRing1Ref.current.scale.setScalar(0.6 + p1 * 2.2);
      const mat = pulseRing1Ref.current.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - p1) * 0.7;
    }
    if (pulseRing2Ref.current) {
      const p2 = (t * 0.7 + 0.5) % 1;
      pulseRing2Ref.current.scale.setScalar(0.6 + p2 * 2.2);
      const mat = pulseRing2Ref.current.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - p2) * 0.7;
    }
    if (startRingRef.current) {
      const ps = (t * 0.8) % 1;
      startRingRef.current.scale.setScalar(0.6 + ps * 1.9);
      const mat = startRingRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - ps) * 0.65;
    }
  });

  const dest = ROUTE_WAYPOINTS[ROUTE_WAYPOINTS.length - 1];
  const start = ROUTE_WAYPOINTS[0];

  return (
    <group ref={groupRef} position={[0, -2.6, 0]}>
      {/* Subtle Holographic Base Grid */}
      <gridHelper
        args={[34, 34, '#1e3a8a', '#0f172a']}
        position={[0, -0.5, 0]}
      />

      {/* Glass Floor Slabs */}
      {SLABS.map((slab, idx) => {
        const borderPts = buildRectBorder(slab.size[0], slab.size[1]);
        const edgeColor = slab.level === 2 ? '#38bdf8' : '#6366f1';
        return (
          <group key={idx} position={slab.pos}>
            <mesh receiveShadow>
              <boxGeometry args={[slab.size[0], 0.14, slab.size[1]]} />
              <meshPhysicalMaterial
                color="#0f1f44"
                transparent
                opacity={0.52}
                roughness={0.18}
                metalness={0.2}
                transmission={0.25}
              />
            </mesh>
            <Line
              points={borderPts}
              position={[0, 0.08, 0]}
              color={edgeColor}
              lineWidth={1.3}
              transparent
              opacity={0.55}
            />
          </group>
        );
      })}

      {/* Vertical Translucent Elevator Core Shaft */}
      <group position={[0.9, 3.9, 0.3]}>
        <mesh>
          <boxGeometry args={[1.25, 8.2, 1.25]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0284c7"
            emissiveIntensity={0.35}
            transparent
            opacity={0.16}
          />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(1.26, 8.2, 1.26)]} />
          <lineBasicMaterial color="#38bdf8" transparent opacity={0.45} />
        </lineSegments>
      </group>

      {/* Secondary West Stair/Lift Core */}
      <group position={[-5.8, 1.3, 1.4]}>
        <mesh>
          <cylinderGeometry args={[0.42, 0.42, 2.8, 16]} />
          <meshStandardMaterial
            color="#818cf8"
            emissive="#4f46e5"
            emissiveIntensity={0.3}
            transparent
            opacity={0.2}
          />
        </mesh>
      </group>

      {/* Glowing Spatial Place Nodes */}
      {SPATIAL_NODES.map((n, idx) => (
        <group key={idx} position={n.pos}>
          <mesh>
            <cylinderGeometry args={[0.2, 0.2, 0.14, 20]} />
            <meshStandardMaterial
              color={n.color}
              emissive={n.color}
              emissiveIntensity={1.2}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
            <ringGeometry args={[0.24, 0.38, 24]} />
            <meshBasicMaterial
              color={n.color}
              transparent
              opacity={0.45}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}

      {/* Luminous Multi-Floor Route Ribbon */}
      <Line
        points={ROUTE_WAYPOINTS}
        vertexColors={routeColors}
        lineWidth={4}
        transparent
        opacity={0.95}
      />

      {/* Animated Walker Sphere */}
      <mesh ref={walkerRef}>
        <sphereGeometry args={[0.22, 20, 20]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh ref={walkerGlowRef}>
        <sphereGeometry args={[0.45, 20, 20]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.38} />
      </mesh>

      {/* Start Photo-Localized Beacon */}
      <group position={start}>
        <mesh position={[0, 0.32, 0]}>
          <sphereGeometry args={[0.24, 20, 20]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#38bdf8"
            emissiveIntensity={1.5}
          />
        </mesh>
        <mesh
          ref={startRingRef}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.28, 0.44, 32]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Floating 3D Destination Beacon Pin + Pulse Rings */}
      <group position={dest}>
        <mesh
          ref={pulseRing1Ref}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.3, 0.48, 32]} />
          <meshBasicMaterial
            color="#34d399"
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh
          ref={pulseRing2Ref}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <ringGeometry args={[0.3, 0.48, 32]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>

        <Float speed={3} rotationIntensity={0.3} floatIntensity={0.65}>
          <group position={[0, 1.05, 0]}>
            <mesh position={[0, 0.35, 0]}>
              <sphereGeometry args={[0.36, 24, 24]} />
              <meshStandardMaterial
                color="#34d399"
                emissive="#10b981"
                emissiveIntensity={1.4}
              />
            </mesh>
            <mesh position={[0, -0.15, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.26, 0.65, 24]} />
              <meshStandardMaterial
                color="#34d399"
                emissive="#059669"
                emissiveIntensity={1.1}
              />
            </mesh>
          </group>
        </Float>
      </group>

      {/* Ambient Spatial Particles */}
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
    </group>
  );
};

const Hero3D: React.FC = () => {
  return (
    <div className="relative h-full w-full select-none">
      <Canvas
        camera={{ position: [14.5, 10.5, 16.5], fov: 40 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[12, 20, 10]} intensity={1.4} color="#e0f2fe" />
        <pointLight position={[-10, 6, -8]} intensity={1.2} color="#6366f1" />
        <pointLight position={[8, 8, 6]} intensity={1.1} color="#38bdf8" />
        <HologramComplex />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 5}
          maxPolarAngle={Math.PI / 2.25}
        />
      </Canvas>
    </div>
  );
};

export default Hero3D;

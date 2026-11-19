import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Compass,
  Film,
  FlipHorizontal,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';

export interface Captured360Frame {
  id: string;
  file: File;
  previewUrl: string;
  headingDeg: number;
  roomHint: string;
  label: string;
}

interface Camera360CaptureModalProps {
  open: boolean;
  onClose: () => void;
  venueName: string;
  targetLabel?: string;
  submitting?: boolean;
  onSubmitFrames: (files: File[]) => Promise<void> | void;
}

type CaptureTab = 'sweep360' | 'walkthrough' | 'panorama_import';

const CARDINAL_LABELS: Record<number, string> = {
  0: 'N · Front',
  45: 'NE',
  90: 'E · Right',
  135: 'SE',
  180: 'S · Back',
  225: 'SW',
  270: 'W · Left',
  315: 'NW',
};

export const Camera360CaptureModal: React.FC<Camera360CaptureModalProps> = ({
  open,
  onClose,
  venueName,
  targetLabel = 'Auto-OCR Floor Model Builder',
  submitting = false,
  onSubmitFrames,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const panoInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<CaptureTab>('sweep360');
  const [showSettings, setShowSettings] = useState(false);

  // 360° Camera Settings State
  const [sectorCount, setSectorCount] = useState<4 | 8>(4);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [maxRes, setMaxRes] = useState<1600 | 1280>(1600);
  const [walkIntervalMs, setWalkIntervalMs] = useState<800 | 1200 | 2000>(1200);
  const [autoSnapCompass, setAutoSnapCompass] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [roomTag, setRoomTag] = useState<string>('');

  // Camera & Sensor State
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveCompassDeg, setLiveCompassDeg] = useState<number | null>(null);
  const [manualHeadingDeg, setManualHeadingDeg] = useState<number>(0);
  const [isRecordingWalk, setIsRecordingWalk] = useState(false);
  const [unwrappingPano, setUnwrappingPano] = useState(false);
  const [panoScrubX, setPanoScrubX] = useState<number>(0);

  // Captured 360° / Walkthrough Frames
  const [frames, setFrames] = useState<Captured360Frame[]>([]);

  const sectors = useMemo(
    () => (sectorCount === 8 ? [0, 45, 90, 135, 180, 225, 270, 315] : [0, 90, 180, 270]),
    [sectorCount],
  );

  const currentHeading = useMemo(() => {
    if (liveCompassDeg !== null) return Math.round(liveCompassDeg) % 360;
    return manualHeadingDeg % 360;
  }, [liveCompassDeg, manualHeadingDeg]);

  const nearestSector = useMemo(() => {
    let best = sectors[0];
    let bestDiff = 360;
    for (const s of sectors) {
      const diff = Math.min(
        Math.abs(currentHeading - s),
        360 - Math.abs(currentHeading - s),
      );
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    return best;
  }, [sectors, currentHeading]);

  const capturedSectorSet = useMemo(() => {
    const set = new Set<number>();
    for (const f of frames) {
      let best = sectors[0];
      let bestDiff = 360;
      for (const s of sectors) {
        const diff = Math.min(
          Math.abs(f.headingDeg - s),
          360 - Math.abs(f.headingDeg - s),
        );
        if (diff < bestDiff) {
          bestDiff = diff;
          best = s;
        }
      }
      if (bestDiff <= 25) set.add(best);
    }
    return set;
  }, [frames, sectors]);

  const stopCamera = useCallback(() => {
    setIsRecordingWalk(false);
    setCameraReady(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Live camera stream is unavailable on this browser. You can still use the "360° Panorama / Video Unwrapper" tab below!',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
    } catch {
      setCameraError(
        'Camera permission denied or no webcam attached. Use the "360° Panorama / File Unwrapper" tab to import 360° photos or videos from your device.',
      );
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (open && activeTab !== 'panorama_import') {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, activeTab, startCamera, stopCamera]);

  // Cleanup preview object URLs when modal closes
  useEffect(() => {
    if (!open) {
      setFrames((prev) => {
        prev.forEach((f) => URL.revokeObjectURL(f.previewUrl));
        return [];
      });
      setIsRecordingWalk(false);
    }
  }, [open]);

  // Device compass orientation listener
  useEffect(() => {
    if (!open) return;
    const handleOrientation = (ev: DeviceOrientationEvent) => {
      const webkitCompass = (ev as unknown as { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof webkitCompass === 'number' && Number.isFinite(webkitCompass)) {
        setLiveCompassDeg(Math.round(webkitCompass) % 360);
      } else if (typeof ev.alpha === 'number' && Number.isFinite(ev.alpha)) {
        setLiveCompassDeg((360 - Math.round(ev.alpha)) % 360);
      }
    };
    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, [open]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Torch not supported on desktop/some cameras
    }
  };

  const captureFrameAtHeading = useCallback(
    async (headingToTag: number, customTag?: string) => {
      const video = videoRef.current;
      if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;

      const scale = Math.min(1, maxRes / Math.max(video.videoWidth, video.videoHeight, 1));
      const w = Math.max(1, Math.round(video.videoWidth * scale));
      const h = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);

      let blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.9),
      );
      let mime = 'image/webp';
      let ext = 'webp';
      if (!blob) {
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.9),
        );
        mime = 'image/jpeg';
        ext = 'jpg';
      }
      if (!blob) return;

      const cleanRoom = (customTag ?? roomTag).trim().replace(/[^a-zA-Z0-9-]/g, '');
      const hdgPadded = String(Math.round(headingToTag) % 360).padStart(3, '0');
      const prefix = cleanRoom ? `room_${cleanRoom}_` : 'scan360_';
      const fname = `${prefix}hdg${hdgPadded}_${Date.now().toString().slice(-4)}.${ext}`;
      const file = new File([blob], fname, { type: mime });
      const previewUrl = URL.createObjectURL(blob);

      const newFrame: Captured360Frame = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl,
        headingDeg: Math.round(headingToTag) % 360,
        roomHint: cleanRoom,
        label: `${cleanRoom ? `Room ${cleanRoom} · ` : ''}${Math.round(headingToTag) % 360}° ${
          CARDINAL_LABELS[nearestSector] || ''
        }`,
      };

      setFrames((prev) => [...prev, newFrame]);
    },
    [maxRes, roomTag, nearestSector],
  );

  // Auto-snap when rotating into an uncaptured 360° sector
  useEffect(() => {
    if (
      !open ||
      activeTab !== 'sweep360' ||
      !autoSnapCompass ||
      !cameraReady ||
      liveCompassDeg === null
    ) {
      return;
    }
    const diff = Math.min(
      Math.abs(currentHeading - nearestSector),
      360 - Math.abs(currentHeading - nearestSector),
    );
    if (diff <= 8 && !capturedSectorSet.has(nearestSector)) {
      const timer = window.setTimeout(() => {
        void captureFrameAtHeading(nearestSector);
      }, 380);
      return () => window.clearTimeout(timer);
    }
  }, [
    open,
    activeTab,
    autoSnapCompass,
    cameraReady,
    liveCompassDeg,
    currentHeading,
    nearestSector,
    capturedSectorSet,
    captureFrameAtHeading,
  ]);

  // Continuous walkthrough auto-slicer interval
  useEffect(() => {
    if (!open || activeTab !== 'walkthrough' || !isRecordingWalk || !cameraReady) {
      return;
    }
    const timer = window.setInterval(() => {
      void captureFrameAtHeading(currentHeading);
    }, walkIntervalMs);
    return () => window.clearInterval(timer);
  }, [
    open,
    activeTab,
    isRecordingWalk,
    cameraReady,
    walkIntervalMs,
    currentHeading,
    captureFrameAtHeading,
  ]);

  const handleSnapAndAdvanceSector = async () => {
    const hdg = liveCompassDeg !== null ? nearestSector : manualHeadingDeg;
    await captureFrameAtHeading(hdg);
    if (liveCompassDeg === null) {
      const curIdx = sectors.indexOf(nearestSector);
      const nextSector = sectors[(curIdx + 1) % sectors.length];
      setManualHeadingDeg(nextSector);
    }
  };

  // Unwrap uploaded 360° Panorama image (or multi-angle photos) into directional perspective frames
  const handlePanoramaFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    setUnwrappingPano(true);
    try {
      const cleanRoom = roomTag.trim().replace(/[^a-zA-Z0-9-]/g, '');
      const prefix = cleanRoom ? `room_${cleanRoom}_` : '';
      const generated: Captured360Frame[] = [];

      for (const f of incoming) {
        if (f.type.startsWith('image/') && typeof createImageBitmap === 'function') {
          const bmp = await createImageBitmap(f);
          const ratio = bmp.width / Math.max(1, bmp.height);

          if (ratio >= 1.85) {
            // Wide 360° Panorama -> Slice into 4 or 8 directional perspective views!
            const numSlices = sectorCount;
            const sliceHeadings =
              numSlices === 8 ? [0, 45, 90, 135, 180, 225, 270, 315] : [0, 90, 180, 270];
            const sliceW = Math.min(bmp.width, Math.max(Math.round(bmp.height * 1.15), Math.round(bmp.width / numSlices)));
            const outH = Math.min(maxRes, bmp.height);
            const outW = Math.round(sliceW * (outH / bmp.height));

            for (let i = 0; i < sliceHeadings.length; i++) {
              const hdg = sliceHeadings[i];
              const x0 = Math.round((i * bmp.width) / numSlices);
              const canvas = document.createElement('canvas');
              canvas.width = outW;
              canvas.height = outH;
              const ctx = canvas.getContext('2d');
              if (!ctx) continue;

              if (x0 + sliceW <= bmp.width) {
                ctx.drawImage(bmp, x0, 0, sliceW, bmp.height, 0, 0, outW, outH);
              } else {
                const firstW = bmp.width - x0;
                const remW = sliceW - firstW;
                const outFirstW = Math.round(outW * (firstW / sliceW));
                ctx.drawImage(bmp, x0, 0, firstW, bmp.height, 0, 0, outFirstW, outH);
                ctx.drawImage(bmp, 0, 0, remW, bmp.height, outFirstW, 0, outW - outFirstW, outH);
              }

              const blob = await new Promise<Blob | null>((res) =>
                canvas.toBlob(res, 'image/webp', 0.9),
              );
              if (!blob) continue;
              const hdgPad = String(hdg).padStart(3, '0');
              const baseName = f.name.replace(/\.[^.]+$/, '');
              const fname = `${prefix}${baseName}_360_hdg${hdgPad}.webp`;
              const sliceFile = new File([blob], fname, { type: 'image/webp' });
              generated.push({
                id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                file: sliceFile,
                previewUrl: URL.createObjectURL(blob),
                headingDeg: hdg,
                roomHint: cleanRoom,
                label: `360° Slice · ${hdg}° ${CARDINAL_LABELS[hdg] || ''}`,
              });
            }
            bmp.close();
            continue;
          }
          bmp.close();
        }

        // Standard photo or video file -> Tag with current selected heading & room prefix
        const hdgPad = String(currentHeading).padStart(3, '0');
        const ext = f.name.split('.').pop() || 'webp';
        const stem = f.name.replace(/\.[^.]+$/, '');
        const taggedFile = new File([f], `${prefix}${stem}_hdg${hdgPad}.${ext}`, {
          type: f.type,
        });
        generated.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          file: taggedFile,
          previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
          headingDeg: currentHeading,
          roomHint: cleanRoom,
          label: `${f.name} (${currentHeading}°)`,
        });
      }

      setFrames((prev) => [...prev, ...generated]);
    } finally {
      setUnwrappingPano(false);
    }
  };

  const removeFrame = (id: string) => {
    setFrames((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleFinishAndUpload = async () => {
    if (frames.length === 0 || submitting) return;
    await onSubmitFrames(frames.map((f) => f.file));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-2.5 sm:p-4 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-[#070B18] text-white ring-1 ring-cyan-400/35 shadow-2xl flex flex-col max-h-[94dvh]">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-950/90 px-4 sm:px-6 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-600 text-slate-950 shadow-lg shadow-cyan-500/25">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base sm:text-lg font-extrabold truncate">
                  360° Spatial Camera & Floor Model Studio
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-400/30">
                  <Sparkles className="h-2.5 w-2.5" />
                  Auto-3D Ready
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {venueName} · Target: <strong className="text-cyan-300">{targetLabel}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ring-1 transition ${
                showSettings
                  ? 'bg-cyan-400 text-slate-950 ring-cyan-300'
                  : 'bg-white/10 text-slate-200 ring-white/15 hover:bg-white/15'
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>360° Settings</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-white/10 p-2 text-slate-300 hover:bg-white/15 hover:text-white"
              aria-label="Close 360 Camera"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Expandable 360° Camera Settings Drawer */}
        {showSettings && (
          <div className="border-b border-white/10 bg-slate-900/95 px-4 sm:px-6 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="space-y-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-cyan-300">
                360° Sweep Density
              </label>
              <select
                value={sectorCount}
                onChange={(e) => setSectorCount(Number(e.target.value) as 4 | 8)}
                className="w-full rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white ring-1 ring-white/15"
              >
                <option value={4}>4 Cardinal Angles (90° steps)</option>
                <option value={8}>8 Full-360° Angles (45° steps)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-cyan-300">
                Walk Auto-Slice Speed
              </label>
              <select
                value={walkIntervalMs}
                onChange={(e) =>
                  setWalkIntervalMs(Number(e.target.value) as 800 | 1200 | 2000)
                }
                className="w-full rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white ring-1 ring-white/15"
              >
                <option value={800}>Every 0.8s (Fast Walk)</option>
                <option value={1200}>Every 1.2s (Balanced Walk)</option>
                <option value={2000}>Every 2.0s (Careful Scan)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-cyan-300">
                Capture Resolution & Lens
              </label>
              <div className="flex gap-1.5">
                <select
                  value={maxRes}
                  onChange={(e) => setMaxRes(Number(e.target.value) as 1600 | 1280)}
                  className="flex-1 rounded-xl bg-slate-950 px-2.5 py-2 text-xs font-bold text-white ring-1 ring-white/15"
                >
                  <option value={1600}>1600px HD OCR</option>
                  <option value={1280}>1280px Fast</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
                  }
                  className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-2 text-xs font-bold text-cyan-300 ring-1 ring-white/15 hover:bg-white/15"
                  title="Switch Rear / Front Camera"
                >
                  <FlipHorizontal className="h-3.5 w-3.5" />
                  {facingMode === 'environment' ? 'Rear' : 'Front'}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
                Compass Auto-Snap
              </label>
              <button
                type="button"
                onClick={() => setAutoSnapCompass((v) => !v)}
                className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold ring-1 transition ${
                  autoSnapCompass
                    ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/50'
                    : 'bg-slate-950 text-slate-300 ring-white/15'
                }`}
              >
                <span>{autoSnapCompass ? 'Auto-Snap on Turn: ON' : 'Manual Tap Mode'}</span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    autoSnapCompass ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Mode Switcher Tabs + Optional Room Number Hint Input */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 bg-slate-900/60 px-4 sm:px-6 py-2.5">
          <div className="flex items-center gap-1 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('sweep360')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                activeTab === 'sweep360'
                  ? 'bg-cyan-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              <span>360° Compass Sweep</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('walkthrough')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                activeTab === 'walkthrough'
                  ? 'bg-emerald-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              <span>Corridor Walk Auto-Slicer</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('panorama_import')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                activeTab === 'panorama_import'
                  ? 'bg-indigo-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>360° Panorama Unwrapper</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">
              Room Tag (optional):
            </span>
            <input
              type="text"
              value={roomTag}
              onChange={(e) => setRoomTag(e.target.value)}
              placeholder="e.g. 308 or Lab-2"
              className="w-32 rounded-xl bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-cyan-300 ring-1 ring-white/15 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            />
          </div>
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {activeTab !== 'panorama_import' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
              {/* Live Camera Viewfinder with 360° HUD Overlay */}
              <div className="lg:col-span-8 relative overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-white/15 aspect-video flex items-center justify-center">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  className="h-full w-full object-cover"
                />

                {/* HUD Viewfinder Grid & Corner Brackets */}
                <div className="pointer-events-none absolute inset-0 ai-hud-grid opacity-35" />
                <span className="pointer-events-none absolute left-3 top-3 h-5 w-5 border-l-2 border-t-2 border-cyan-400" />
                <span className="pointer-events-none absolute right-3 top-3 h-5 w-5 border-r-2 border-t-2 border-cyan-400" />
                <span className="pointer-events-none absolute left-3 bottom-3 h-5 w-5 border-l-2 border-b-2 border-cyan-400" />
                <span className="pointer-events-none absolute right-3 bottom-3 h-5 w-5 border-r-2 border-b-2 border-cyan-400" />

                {/* Top Camera Status Bar */}
                <div className="absolute top-3 inset-x-4 flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-3 py-1 font-mono font-bold text-cyan-300 ring-1 ring-cyan-400/40 backdrop-blur-md">
                    <Compass className="h-3.5 w-3.5" />
                    {currentHeading}° {CARDINAL_LABELS[nearestSector] || ''}
                    {liveCompassDeg !== null ? ' (Live Sensor)' : ' (Stepped)'}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void toggleTorch()}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 backdrop-blur-md ${
                        torchOn
                          ? 'bg-amber-400 text-slate-950 ring-amber-300'
                          : 'bg-slate-950/80 text-slate-300 ring-white/15'
                      }`}
                      title="Toggle camera flashlight"
                    >
                      <Zap className="h-3 w-3 inline mr-0.5" />
                      Torch
                    </button>
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="rounded-full bg-slate-950/80 p-1.5 text-slate-300 ring-1 ring-white/15 hover:text-white"
                      title="Restart camera stream"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center space-y-3">
                    <Camera className="h-9 w-9 text-cyan-400" />
                    <p className="text-xs sm:text-sm text-slate-300 max-w-md leading-relaxed">
                      {cameraError}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void startCamera()}
                        className="rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white ring-1 ring-white/15 hover:bg-white/15"
                      >
                        Retry Camera Permission
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('panorama_import')}
                        className="rounded-xl bg-cyan-400 px-3.5 py-2 text-xs font-extrabold text-slate-950"
                      >
                        Switch to 360° Panorama / File Unwrapper →
                      </button>
                    </div>
                  </div>
                )}

                {/* Bottom Shutter Controls inside Viewfinder */}
                {!cameraError && (
                  <div className="absolute bottom-3 inset-x-4 flex items-center justify-center">
                    {activeTab === 'sweep360' ? (
                      <button
                        type="button"
                        disabled={!cameraReady}
                        onClick={() => void handleSnapAndAdvanceSector()}
                        className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-3 text-xs sm:text-sm font-extrabold text-slate-950 shadow-xl hover:brightness-105 active:scale-95 disabled:opacity-40 transition"
                      >
                        <Camera className="h-4 w-4" />
                        <span>
                          Snap {currentHeading}° ({CARDINAL_LABELS[nearestSector] || 'Sector'}) & Advance
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!cameraReady}
                        onClick={() => setIsRecordingWalk((v) => !v)}
                        className={`inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-xs sm:text-sm font-extrabold shadow-xl transition ${
                          isRecordingWalk
                            ? 'bg-rose-600 text-white animate-pulse'
                            : 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950'
                        }`}
                      >
                        {isRecordingWalk ? (
                          <>
                            <Square className="h-4 w-4 fill-current" />
                            <span>Stop Walk Auto-Slicer ({frames.length} frames)</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 fill-current" />
                            <span>Start Hands-Free Walk Auto-Slicer</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Interactive 360° Compass Radar Ring & Sector Dial */}
              <div className="lg:col-span-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 flex flex-col items-center space-y-3">
                <div className="text-xs font-extrabold uppercase tracking-wider text-cyan-300">
                  360° Coverage Radar ({capturedSectorSet.size}/{sectors.length} Angles)
                </div>

                {/* Interactive SVG 360° Sector Wheel */}
                <svg viewBox="0 0 180 180" className="h-40 w-40">
                  <circle
                    cx="90"
                    cy="90"
                    r="72"
                    fill="rgba(15,23,42,0.8)"
                    stroke="rgba(56,189,248,0.25)"
                    strokeWidth="1.5"
                  />
                  {sectors.map((deg) => {
                    const rad = ((deg - 90) * Math.PI) / 180;
                    const x = 90 + Math.cos(rad) * 56;
                    const y = 90 + Math.sin(rad) * 56;
                    const done = capturedSectorSet.has(deg);
                    const isCur = nearestSector === deg;
                    return (
                      <g
                        key={deg}
                        onClick={() => setManualHeadingDeg(deg)}
                        style={{ cursor: 'pointer' }}
                      >
                        <line
                          x1="90"
                          y1="90"
                          x2={x}
                          y2={y}
                          stroke={done ? '#10b981' : isCur ? '#22d3ee' : '#334155'}
                          strokeWidth={isCur ? '2.5' : '1.5'}
                          strokeDasharray={done ? undefined : '3 3'}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r={isCur ? 14 : 11}
                          fill={
                            done
                              ? '#10b981'
                              : isCur
                                ? '#0ea5e9'
                                : '#1e293b'
                          }
                          stroke="#ffffff"
                          strokeWidth={isCur ? '2' : '1'}
                        />
                        <text
                          x={x}
                          y={y + 3}
                          textAnchor="middle"
                          fontSize="7.5"
                          fontWeight="800"
                          fill="#ffffff"
                        >
                          {done ? '✓' : `${deg}°`}
                        </text>
                      </g>
                    );
                  })}
                  <circle cx="90" cy="90" r="16" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
                  <text
                    x="90"
                    y="93"
                    textAnchor="middle"
                    fontSize="8.5"
                    fontWeight="800"
                    fill="#38bdf8"
                  >
                    360°
                  </text>
                </svg>

                <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                  Click any angle on the ring (or rotate your phone) and tap{' '}
                  <strong className="text-white">Snap & Advance</strong> to capture a complete 360° room/corridor signature.
                </p>
              </div>
            </div>
          ) : (
            /* 360° Equirectangular Panorama / Video File Unwrapper Tab */
            <div
              onClick={() => panoInputRef.current?.click()}
              className="cursor-pointer rounded-2xl border-2 border-dashed border-cyan-400/40 bg-white/[0.03] p-8 text-center hover:border-cyan-400 hover:bg-cyan-500/10 transition space-y-3"
            >
              <input
                ref={panoInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void handlePanoramaFiles(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              {unwrappingPano ? (
                <div className="py-4 space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mx-auto" />
                  <p className="text-sm font-bold text-white">
                    Unwrapping 360° Equirectangular Panorama into {sectorCount} directional perspective views...
                  </p>
                </div>
              ) : (
                <>
                  <Globe className="h-10 w-10 text-cyan-400 mx-auto" />
                  <h3 className="font-display text-base sm:text-lg font-extrabold text-white">
                    Drop 360° Panorama Photos, Phone Panoramas, or Walkthrough Videos
                  </h3>
                  <p className="text-xs text-slate-300 max-w-xl mx-auto leading-relaxed">
                    Upload a wide <strong>360° / Panorama photo</strong> from your phone camera, Insta360, or Ricoh Theta. Navigator automatically slices it into <strong>{sectorCount} directional perspective views (0° N, 90° E, 180° S, 270° W)</strong> so DINOv2 & RapidOCR read every door signboard around the entire 360° room!
                  </p>
                  <span className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-extrabold text-slate-950">
                    <Upload className="h-3.5 w-3.5" />
                    Choose 360° Panorama / Photos / Video
                  </span>
                </>
              )}
            </div>
          )}

          {/* Interactive 360° Stitched Panorama Strip + Captured Frames Filmstrip */}
          {frames.length > 0 && (
            <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    {frames.length} Directional Frame{frames.length > 1 ? 's' : ''} Ready for 3D Model Builder
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    frames.forEach((f) => URL.revokeObjectURL(f.previewUrl));
                    setFrames([]);
                  }}
                  className="text-[11px] font-bold text-rose-300 hover:text-rose-200"
                >
                  Clear All
                </button>
              </div>

              {/* Interactive 360° Panorama Scrubbable Viewer when >= 2 image frames */}
              {frames.filter((f) => f.previewUrl).length >= 2 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-cyan-300 font-semibold">
                    <span>🌐 Live 360° Panoramic Horizon Preview (Drag slider to look around)</span>
                    <span className="font-mono">{panoScrubX}°</span>
                  </div>
                  <div className="relative h-28 w-full overflow-hidden rounded-xl bg-slate-950 ring-1 ring-cyan-400/40">
                    <div
                      className="flex h-full transition-transform duration-150"
                      style={{
                        width: `${Math.max(100, frames.length * 45)}%`,
                        transform: `translateX(-${(panoScrubX / 360) * 50}%)`,
                      }}
                    >
                      {[...frames]
                        .sort((a, b) => a.headingDeg - b.headingDeg)
                        .map((f) =>
                          f.previewUrl ? (
                            <div key={`pano-${f.id}`} className="relative h-full flex-1 min-w-[120px]">
                              <img
                                src={f.previewUrl}
                                alt={f.label}
                                className="h-full w-full object-cover"
                              />
                              <span className="absolute bottom-1.5 left-1.5 rounded bg-slate-950/80 px-1.5 py-0.5 text-[9px] font-mono font-bold text-cyan-300">
                                {f.headingDeg}°
                              </span>
                            </div>
                          ) : null,
                        )}
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={panoScrubX}
                    onChange={(e) => setPanoScrubX(Number(e.target.value))}
                    className="w-full accent-cyan-400 h-1.5 cursor-ew-resize"
                    aria-label="Pan 360 preview"
                  />
                </div>
              )}

              {/* Individual Frame Cards */}
              <div className="flex gap-2.5 overflow-x-auto pb-1 thin-scrollbar">
                {frames.map((f) => (
                  <div
                    key={f.id}
                    className="relative w-32 shrink-0 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/15"
                  >
                    {f.previewUrl ? (
                      <img
                        src={f.previewUrl}
                        alt={f.label}
                        className="h-20 w-full object-cover"
                      />
                    ) : (
                      <div className="h-20 w-full flex items-center justify-center bg-slate-950 text-cyan-400 text-xs font-bold">
                        🎥 Video
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFrame(f.id)}
                      className="absolute top-1 right-1 rounded-md bg-slate-950/80 p-1 text-slate-300 hover:text-rose-400"
                      title="Remove frame"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <div className="p-1.5 text-[10px] font-bold text-slate-200 truncate">
                      {f.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Submit CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-slate-950/90 px-4 sm:px-6 py-3.5">
          <div className="text-xs text-slate-400">
            All frames are auto-tagged with <strong>360° compass headings</strong> & compressed to{' '}
            <strong>{maxRes}px WebP</strong>.
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/15"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={frames.length === 0 || submitting}
              onClick={() => void handleFinishAndUpload()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-slate-950 shadow-lg hover:brightness-105 disabled:opacity-40 transition"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Processing 360° Frames & Building 3D Model...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>
                    Upload {frames.length} Frame{frames.length !== 1 ? 's' : ''} & Build 3D Model
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

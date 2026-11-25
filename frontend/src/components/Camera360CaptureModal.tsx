import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FlipHorizontal,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
} from 'lucide-react';
import {
  enhanceCanvasClarityAndLighting,
  isVideoFile,
  stitch360VideoToPanorama,
  stitch4CrispAnglesTo360,
  stitchMultiplePhotosTo360,
} from '../lib/panorama360';

export interface CapturedItem {
  id: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
  isPanorama360: boolean;
  sharpnessScore: number;
  label: string;
}

interface Camera360CaptureModalProps {
  open: boolean;
  onClose: () => void;
  venueName: string;
  targetLabel?: string;
  submitting?: boolean;
  onSubmitFrames: (files: File[], uploadImmediately?: boolean) => Promise<void> | void;
}

const ANGLE_STEPS = [
  { label: 'Front Wall (0°)', hint: 'Face straight ahead, hold steady & tap Shutter' },
  { label: 'Right Wall (90°)', hint: 'Turn 90° right (keep slight overlap) & tap Shutter' },
  { label: 'Back Wall (180°)', hint: 'Turn 90° right again (behind you) & tap Shutter' },
  { label: 'Left Wall (270°)', hint: 'Turn 90° right for final wall & tap Shutter' },
];

export const Camera360CaptureModal: React.FC<Camera360CaptureModalProps> = ({
  open,
  onClose,
  venueName,
  targetLabel = 'Room',
  submitting = false,
  onSubmitFrames,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const angleCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const spinFramesRef = useRef<HTMLCanvasElement[]>([]);
  const spinTimerRef = useRef<number | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const multiStitchInputRef = useRef<HTMLInputElement>(null);
  const nativePhotoInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'photo' | 'pano4' | 'spin'>('photo');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashEffect, setFlashEffect] = useState(false);

  // 4-Wall Cylindrical 360° State
  const [angleCount, setAngleCount] = useState(0);
  const [buildingPano, setBuildingPano] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Live Spin Video Capture State
  const [recordingSpin, setRecordingSpin] = useState(false);
  const [spinProgressPct, setSpinProgressPct] = useState(0);

  // Interactive 360° Preview Drag State
  const [previewYawPct, setPreviewYawPct] = useState(50);
  const previewDragRef = useRef<{ startX: number; initPct: number } | null>(null);

  // Captured Items + Immediate Review Screen
  const [items, setItems] = useState<CapturedItem[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const clearSpinTimer = () => {
    if (spinTimerRef.current !== null) {
      window.clearInterval(spinTimerRef.current);
      spinTimerRef.current = null;
    }
  };

  const stopCamera = useCallback(() => {
    clearSpinTimer();
    setRecordingSpin(false);
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
      setCameraError('Browser live camera unavailable here. Use Phone Camera or Gallery below.');
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
      setCameraError('Camera permission denied or unavailable. Use Phone Camera or Gallery below.');
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (open) {
      void startCamera();
    } else {
      stopCamera();
      angleCanvasesRef.current = [];
      spinFramesRef.current = [];
      setItems((prev) => {
        prev.forEach((it) => {
          if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
        });
        return [];
      });
      setReviewing(false);
      setAngleCount(0);
      setBuildingPano(false);
      setStatusMsg(null);
      setSpinProgressPct(0);
    }
    return () => {
      stopCamera();
    };
  }, [open, startCamera, stopCamera]);

  const grabCrispHDCanvas = useCallback((maxSide = 1280): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight, 1));
    const w = Math.max(320, Math.round(video.videoWidth * scale));
    const h = Math.max(320, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, w, h);
    return canvas;
  }, []);

  const finish4Angle360 = useCallback(async () => {
    const captured = angleCanvasesRef.current;
    if (captured.length === 0) return;
    angleCanvasesRef.current = [];
    setBuildingPano(true);
    setStatusMsg('Cylindrically blending 360° horizon...');
    try {
      const cleanName = targetLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
      const result = await stitch4CrispAnglesTo360(captured, `${cleanName}_360`, (_p, st) =>
        setStatusMsg(st),
      );
      const previewUrl = URL.createObjectURL(result.file);
      const score = result.sharpnessScore ?? 90;
      setItems([
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          file: result.file,
          previewUrl,
          isVideo: false,
          isPanorama360: true,
          sharpnessScore: score,
          label: `Seamless 360° (${captured.length} walls · ${result.width}×${result.height})`,
        },
      ]);
      setPreviewYawPct(50);
      setReviewing(true);
    } finally {
      setBuildingPano(false);
      setStatusMsg(null);
      setAngleCount(0);
    }
  }, [targetLabel]);

  const snap4AngleStep = useCallback(async () => {
    const c = grabCrispHDCanvas(1080);
    if (!c) {
      multiStitchInputRef.current?.click();
      return;
    }
    setFlashEffect(true);
    window.setTimeout(() => setFlashEffect(false), 90);

    angleCanvasesRef.current.push(c);
    const nextCount = angleCanvasesRef.current.length;
    setAngleCount(nextCount);

    if (nextCount >= 4) {
      await finish4Angle360();
    }
  }, [finish4Angle360, grabCrispHDCanvas]);

  // Smooth 6-second 360° Spin Capture (auto-samples 12 crisp frames & cylindrically stitches!)
  const stopAndStitchSpin = useCallback(async () => {
    clearSpinTimer();
    setRecordingSpin(false);
    const frames = spinFramesRef.current;
    spinFramesRef.current = [];
    setSpinProgressPct(0);
    if (frames.length < 2) return;

    setBuildingPano(true);
    setStatusMsg('Aligning 360° spin frames...');
    try {
      const cleanName = targetLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
      const picks =
        frames.length > 6
          ? [0, 0.25, 0.5, 0.75, 0.95].map((f) => frames[Math.min(frames.length - 1, Math.floor(f * frames.length))])
          : frames;
      const result = await stitch4CrispAnglesTo360(picks, `${cleanName}_spin360`, (_p, st) =>
        setStatusMsg(st),
      );
      const previewUrl = URL.createObjectURL(result.file);
      const score = result.sharpnessScore ?? 88;
      setItems([
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          file: result.file,
          previewUrl,
          isVideo: false,
          isPanorama360: true,
          sharpnessScore: score,
          label: `360° Spin Panorama (${result.width}×${result.height})`,
        },
      ]);
      setPreviewYawPct(50);
      setReviewing(true);
    } finally {
      setBuildingPano(false);
      setStatusMsg(null);
    }
  }, [targetLabel]);

  const toggleSpinRecording = useCallback(() => {
    if (recordingSpin) {
      void stopAndStitchSpin();
      return;
    }
    if (!cameraReady) {
      galleryInputRef.current?.click();
      return;
    }
    spinFramesRef.current = [];
    setRecordingSpin(true);
    setSpinProgressPct(5);
    const first = grabCrispHDCanvas(960);
    if (first) spinFramesRef.current.push(first);

    let step = 1;
    const maxSteps = 12;
    spinTimerRef.current = window.setInterval(() => {
      const frame = grabCrispHDCanvas(960);
      if (frame) spinFramesRef.current.push(frame);
      step++;
      setSpinProgressPct(Math.min(100, Math.round((step / maxSteps) * 100)));
      if (step >= maxSteps) {
        void stopAndStitchSpin();
      }
    }, 520);
  }, [cameraReady, grabCrispHDCanvas, recordingSpin, stopAndStitchSpin]);

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
      // Torch unsupported
    }
  };

  const snapHDPhoto = useCallback(async () => {
    const canvas = grabCrispHDCanvas(1440);
    if (!canvas) {
      nativePhotoInputRef.current?.click();
      return;
    }

    setFlashEffect(true);
    window.setTimeout(() => setFlashEffect(false), 90);

    const clarity = enhanceCanvasClarityAndLighting(canvas);
    let blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.9));
    let mime = 'image/webp';
    let ext = 'webp';
    if (!blob || (blob.type && blob.type !== 'image/webp')) {
      blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
      mime = 'image/jpeg';
      ext = 'jpg';
    }
    if (!blob) return;

    const cleanName = targetLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
    const file = new File([blob], `${cleanName}_${Date.now().toString().slice(-4)}.${ext}`, {
      type: mime,
    });
    const ratio = canvas.width / Math.max(1, canvas.height);
    setItems([
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        previewUrl: URL.createObjectURL(blob),
        isVideo: false,
        isPanorama360: ratio >= 1.65,
        sharpnessScore: clarity.sharpnessScore,
        label: `HD Room Photo (${canvas.width}×${canvas.height})`,
      },
    ]);
    setReviewing(true);
  }, [grabCrispHDCanvas, targetLabel]);

  const addExternalFiles = async (fileList: FileList | null, stitchTogether = false) => {
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList);

    if (stitchTogether && arr.length >= 2) {
      setBuildingPano(true);
      setStatusMsg(`Stitching ${arr.length} photos into 360° panorama...`);
      try {
        const cleanName = targetLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
        const res = await stitchMultiplePhotosTo360(arr, cleanName, (_p, st) => setStatusMsg(st));
        setItems([
          {
            id: `${Date.now()}-stitch`,
            file: res.file,
            previewUrl: URL.createObjectURL(res.file),
            isVideo: false,
            isPanorama360: true,
            sharpnessScore: res.sharpnessScore ?? 90,
            label: `Stitched 360° (${arr.length} photos · ${res.width}×${res.height})`,
          },
        ]);
        setPreviewYawPct(50);
        setReviewing(true);
      } finally {
        setBuildingPano(false);
        setStatusMsg(null);
      }
      return;
    }

    // If user picked a video, stitch it into an interactive 360° preview right away!
    if (arr.length === 1 && isVideoFile(arr[0])) {
      setBuildingPano(true);
      setStatusMsg('Converting 360° video into panorama...');
      try {
        const res = await stitch360VideoToPanorama(arr[0], (_p, st) => setStatusMsg(st));
        setItems([
          {
            id: `${Date.now()}-vid`,
            file: res.file,
            previewUrl: URL.createObjectURL(res.file),
            isVideo: false,
            isPanorama360: true,
            sharpnessScore: res.sharpnessScore ?? 88,
            label: `360° Panorama from Video (${res.width}×${res.height})`,
          },
        ]);
        setPreviewYawPct(50);
        setReviewing(true);
      } catch {
        setItems([
          {
            id: `${Date.now()}-vidraw`,
            file: arr[0],
            previewUrl: '',
            isVideo: true,
            isPanorama360: true,
            sharpnessScore: 88,
            label: `360° Video (${arr[0].name})`,
          },
        ]);
        setReviewing(true);
      } finally {
        setBuildingPano(false);
        setStatusMsg(null);
      }
      return;
    }

    const added: CapturedItem[] = [];
    for (const f of arr) {
      const vid = isVideoFile(f);
      const url = vid ? '' : URL.createObjectURL(f);
      let isPano = vid;
      if (!vid && url) {
        const dims = await new Promise<{ w: number; h: number }>((r) => {
          const im = new Image();
          im.onload = () => r({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
          im.onerror = () => r({ w: 1, h: 1 });
          im.src = url;
        });
        isPano = dims.w / Math.max(1, dims.h) >= 1.65;
      }
      added.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        previewUrl: url,
        isVideo: vid,
        isPanorama360: isPano,
        sharpnessScore: 92,
        label: isPano ? `360° Panorama (${f.name})` : `Photo (${f.name})`,
      });
    }
    setItems(added);
    setPreviewYawPct(50);
    setReviewing(true);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((x) => x.id !== id);
      if (next.length === 0) setReviewing(false);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (items.length === 0 || submitting) return;
    await onSubmitFrames(
      items.map((x) => x.file),
      true,
    );
  };

  if (!open) return null;

  const activeStepInfo = ANGLE_STEPS[Math.min(angleCount, ANGLE_STEPS.length - 1)];
  const topSharpness = items[0]?.sharpnessScore ?? 90;

  return (
    <div className="fixed inset-0 !m-0 z-50 h-[100dvh] w-screen bg-slate-950 text-white overflow-hidden select-none">
      {/* Hidden File Inputs with explicit image/video accept attributes */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addExternalFiles(e.target.files, false);
          e.target.value = '';
        }}
      />
      <input
        ref={multiStitchInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addExternalFiles(e.target.files, true);
          e.target.value = '';
        }}
      />
      <input
        ref={nativePhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void addExternalFiles(e.target.files, false);
          e.target.value = '';
        }}
      />

      {/* 1. LIVE CAMERA VIEWFINDER */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="absolute inset-0 h-full w-full object-cover bg-slate-950"
      />

      {flashEffect && <div className="pointer-events-none absolute inset-0 z-30 bg-white/80" />}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 z-10 bg-gradient-to-b from-black/85 via-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 z-10 bg-gradient-to-t from-black/95 via-black/65 to-transparent" />

      {/* 2. TOP BAR (z-40 SO CLOSE BUTTON IS ALWAYS ACCESSIBLE!) */}
      <div className="absolute top-3 inset-x-3 z-40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 rounded-full bg-black/80 px-3.5 py-2 ring-1 ring-white/20">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white truncate max-w-[155px] sm:max-w-xs">
              {targetLabel}
            </div>
            <div className="text-[10px] text-slate-300 truncate">{venueName}</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!reviewing && (
            <>
              <button
                type="button"
                onClick={() => nativePhotoInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-2 text-[11px] font-black text-slate-950 shadow"
                title="Open native phone camera app"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Phone Cam</span>
              </button>
              <button
                type="button"
                onClick={() => void toggleTorch()}
                className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 transition ${
                  torchOn
                    ? 'bg-amber-400 text-slate-950 ring-amber-200'
                    : 'bg-black/80 text-white ring-white/20'
                }`}
                title="Flashlight"
              >
                <Zap className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/80 text-white ring-1 ring-white/20"
                title="Flip Camera"
              >
                <FlipHorizontal className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Camera"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/85 text-white ring-1 ring-white/25 hover:bg-rose-600 transition"
            title="Close Camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 3. PROCESSING / 4-WALL / SPIN HUD */}
      {buildingPano && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/90 px-6 text-center space-y-3">
          <Loader2 className="h-9 w-9 animate-spin text-cyan-400" />
          <div className="text-sm font-extrabold text-white">
            {statusMsg || 'Building seamless 360° Panorama...'}
          </div>
        </div>
      )}

      {mode === 'pano4' && !cameraError && !reviewing && !buildingPano && (
        <div className="pointer-events-none absolute top-16 inset-x-4 z-20 flex flex-col items-center">
          <div className="w-full max-w-xs rounded-2xl bg-black/85 px-4 py-2.5 text-center ring-1 ring-cyan-400/50 shadow-xl space-y-1.5">
            <div className="flex items-center justify-center gap-1.5">
              {[0, 1, 2, 3].map((idx) => (
                <span
                  key={idx}
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    idx < angleCount
                      ? 'bg-emerald-400'
                      : idx === angleCount
                        ? 'bg-cyan-400 animate-pulse'
                        : 'bg-white/20'
                  }`}
                />
              ))}
            </div>
            <div className="text-xs font-black text-cyan-300">
              Wall {Math.min(angleCount + 1, 4)} of 4 · {activeStepInfo.label}
            </div>
            <div className="text-[11px] font-semibold text-slate-200 leading-snug">
              {activeStepInfo.hint}
            </div>
          </div>
        </div>
      )}

      {mode === 'spin' && !cameraError && !reviewing && !buildingPano && (
        <div className="pointer-events-none absolute top-16 inset-x-4 z-20 flex flex-col items-center">
          <div className="w-full max-w-xs rounded-2xl bg-black/85 px-4 py-2.5 text-center ring-1 ring-emerald-400/50 shadow-xl space-y-1.5">
            <div className="text-xs font-black text-emerald-300">
              {recordingSpin ? `Recording 360° Turn (${spinProgressPct}%)` : 'Smooth 6-Sec 360° Spin'}
            </div>
            {recordingSpin && (
              <div className="h-2 w-full rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-300"
                  style={{ width: `${spinProgressPct}%` }}
                />
              </div>
            )}
            <div className="text-[11px] font-semibold text-slate-200 leading-snug">
              {recordingSpin
                ? 'Turn slowly in a circle — stitches automatically!'
                : 'Tap Record & rotate slowly around the room'}
            </div>
          </div>
        </div>
      )}

      {/* 4. FALLBACK IF BROWSER CAMERA IS BLOCKED */}
      {cameraError && !reviewing && !buildingPano && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950 px-5 text-center space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40">
            <Camera className="h-7 w-7" />
          </div>
          <p className="text-xs sm:text-sm font-semibold text-slate-200 max-w-sm leading-relaxed">
            {cameraError}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full max-w-md">
            <button
              type="button"
              onClick={() => nativePhotoInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3.5 text-xs font-extrabold text-slate-950 shadow-lg"
            >
              <Camera className="h-4 w-4" />
              <span>Phone Camera</span>
            </button>
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3.5 text-xs font-extrabold text-white shadow-lg"
            >
              <ImageIcon className="h-4 w-4" />
              <span>Pick Photo / Video</span>
            </button>
            <button
              type="button"
              onClick={() => multiStitchInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3.5 text-xs font-extrabold text-slate-950 shadow-lg"
            >
              <Sparkles className="h-4 w-4" />
              <span>Stitch 2–8 Photos → 360°</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void startCamera()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-slate-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry Live Camera</span>
          </button>
        </div>
      )}

      {/* 5. EDGE-TO-EDGE ZERO-BLACK-BAR PREVIEW & 1-TAP SAVE SCREEN */}
      {reviewing && items.length > 0 ? (
        <div className="absolute inset-0 z-30 flex flex-col justify-between bg-slate-950 p-4 pt-16 pb-6">
          <div className="space-y-1 text-center">
            {topSharpness >= 60 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-extrabold text-emerald-300 ring-1 ring-emerald-400/40">
                ✨ HD Enhanced &amp; Ready ({topSharpness}% Clarity)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-extrabold text-amber-200 ring-1 ring-amber-400/40">
                ⚠️ Low contrast / slight blur — Retake if needed
              </span>
            )}
            <h3 className="font-display text-base sm:text-lg font-extrabold text-white">
              {items[0]?.isPanorama360
                ? 'Drag Left / Right Below to Test Your 360° View'
                : `Ready to Save to ${targetLabel}`}
            </h3>
          </div>

          <div className="flex-1 my-3 flex flex-col items-center justify-center gap-3 overflow-y-auto">
            {items.map((it) => (
              <div
                key={it.id}
                className="relative w-full max-w-lg rounded-3xl bg-slate-900 ring-1 ring-white/20 overflow-hidden shadow-2xl"
              >
                {it.isPanorama360 && it.previewUrl ? (
                  /* LIVE INTERACTIVE 360° WRAP-AROUND PREVIEW — ZERO BLACK BARS! */
                  <div
                    onMouseDown={(e) => {
                      previewDragRef.current = { startX: e.clientX, initPct: previewYawPct };
                    }}
                    onMouseMove={(e) => {
                      if (!previewDragRef.current) return;
                      const dx = e.clientX - previewDragRef.current.startX;
                      setPreviewYawPct(previewDragRef.current.initPct - dx * 0.22);
                    }}
                    onMouseUp={() => {
                      previewDragRef.current = null;
                    }}
                    onTouchStart={(e) => {
                      if (e.touches[0]) {
                        previewDragRef.current = {
                          startX: e.touches[0].clientX,
                          initPct: previewYawPct,
                        };
                      }
                    }}
                    onTouchMove={(e) => {
                      if (!previewDragRef.current || !e.touches[0]) return;
                      const dx = e.touches[0].clientX - previewDragRef.current.startX;
                      setPreviewYawPct(previewDragRef.current.initPct - dx * 0.28);
                    }}
                    onTouchEnd={() => {
                      previewDragRef.current = null;
                    }}
                    style={{
                      backgroundImage: `url("${it.previewUrl}")`,
                      backgroundRepeat: 'repeat-x',
                      backgroundSize: 'auto 100%',
                      backgroundPosition: `${previewYawPct}% 50%`,
                    }}
                    className="relative h-60 sm:h-72 w-full cursor-grab active:cursor-grabbing"
                  >
                    <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-cyan-400 px-2.5 py-1 text-[10px] font-black text-slate-950 shadow">
                      🌐 LIVE 360° · SWIPE TO SPIN
                    </span>
                  </div>
                ) : (
                  /* FULL-BLEED PORTRAIT / LANDSCAPE PREVIEW — ZERO BLACK PILLARBOXES! */
                  <div className="relative h-60 sm:h-72 w-full overflow-hidden bg-slate-900">
                    {it.previewUrl ? (
                      <img
                        src={it.previewUrl}
                        alt={it.label}
                        className="h-full w-full object-cover object-center"
                      />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center p-4 space-y-1.5">
                        <Video className="h-10 w-10 text-cyan-400" />
                        <div className="text-sm font-extrabold text-white">{it.label}</div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900 border-t border-white/10">
                  <span className="text-xs font-bold text-slate-200 truncate">
                    {it.isPanorama360 ? '🌐 ' : '📷 '}
                    {it.label}
                  </span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-600 hover:text-white"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="w-full max-w-lg mx-auto space-y-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmit()}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3.5 text-sm sm:text-base font-black text-slate-950 shadow-2xl active:scale-95 transition"
            >
              <Upload className="h-5 w-5 stroke-[2.5]" />
              <span>Save to {targetLabel}</span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                items.forEach((it) => {
                  if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
                });
                setItems([]);
                setReviewing(false);
              }}
              className="w-full flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-4 py-3 text-xs font-extrabold text-white ring-1 ring-white/15 hover:bg-white/15 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Retake / Pick Different Photo</span>
            </button>
          </div>
        </div>
      ) : (
        /* 6. BOTTOM CAMERA SHUTTER & 3-MODE SWITCHER */
        <div className="absolute bottom-0 inset-x-0 z-20 px-3 pb-6 pt-3 flex flex-col items-center gap-3.5">
          {/* 3-Mode Switcher */}
          <div className="inline-flex items-center gap-1 rounded-full bg-black/80 p-1 ring-1 ring-white/20 max-w-full overflow-x-auto">
            <button
              type="button"
              disabled={buildingPano || recordingSpin}
              onClick={() => {
                setMode('photo');
                angleCanvasesRef.current = [];
                setAngleCount(0);
              }}
              className={`rounded-full px-3.5 py-1.5 text-[11px] sm:text-xs font-extrabold whitespace-nowrap transition ${
                mode === 'photo'
                  ? 'bg-white text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              📷 Photo
            </button>
            <button
              type="button"
              disabled={buildingPano || recordingSpin}
              onClick={() => {
                setMode('pano4');
                angleCanvasesRef.current = [];
                setAngleCount(0);
              }}
              className={`rounded-full px-3.5 py-1.5 text-[11px] sm:text-xs font-extrabold whitespace-nowrap transition ${
                mode === 'pano4'
                  ? 'bg-cyan-400 text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              🌐 360° Walls (4)
            </button>
            <button
              type="button"
              disabled={buildingPano}
              onClick={() => {
                setMode('spin');
                angleCanvasesRef.current = [];
                setAngleCount(0);
              }}
              className={`rounded-full px-3.5 py-1.5 text-[11px] sm:text-xs font-extrabold whitespace-nowrap transition ${
                mode === 'spin'
                  ? 'bg-emerald-400 text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              🎥 360° Spin
            </button>
          </div>

          <div className="w-full max-w-md flex items-center justify-between gap-2 px-1">
            {/* Left: Gallery Picker */}
            <button
              type="button"
              disabled={buildingPano || recordingSpin}
              onClick={() => galleryInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-black/80 px-3 py-2.5 ring-1 ring-white/20 active:scale-95 transition min-w-[76px]"
            >
              <ImageIcon className="h-5 w-5 text-cyan-300" />
              <span className="text-[10px] font-bold text-white">Gallery</span>
            </button>

            {/* Center: Mode-Specific Shutter */}
            {mode === 'photo' ? (
              <button
                type="button"
                onClick={() => void snapHDPhoto()}
                aria-label="Take HD Photo"
                className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/20 p-1.5 shadow-2xl active:scale-90 transition"
              >
                <span className="h-full w-full rounded-full bg-white" />
              </button>
            ) : mode === 'pano4' ? (
              <button
                type="button"
                disabled={buildingPano}
                onClick={() => void snap4AngleStep()}
                aria-label={`Snap Wall ${angleCount + 1} of 4`}
                className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-cyan-300 bg-black/40 p-1.5 shadow-2xl active:scale-90 transition"
              >
                <span className="flex h-full w-full items-center justify-center rounded-full bg-cyan-400 text-sm font-black text-slate-950">
                  {angleCount + 1}/4
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={buildingPano}
                onClick={toggleSpinRecording}
                aria-label={recordingSpin ? 'Stop 360 Spin' : 'Start 360 Spin'}
                className={`relative flex h-20 w-20 items-center justify-center rounded-full border-4 p-1.5 shadow-2xl active:scale-90 transition ${
                  recordingSpin
                    ? 'border-rose-400 bg-rose-500/25'
                    : 'border-emerald-300 bg-black/40'
                }`}
              >
                {recordingSpin ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500 text-white">
                    <Square className="h-5 w-5 fill-current" />
                  </span>
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-emerald-400 text-xs font-black text-slate-950">
                    SPIN
                  </span>
                )}
              </button>
            )}

            {/* Right: Finish 360° early OR Stitch Multi-Photos from Gallery */}
            {mode === 'pano4' && angleCount >= 2 ? (
              <button
                type="button"
                disabled={buildingPano}
                onClick={() => void finish4Angle360()}
                className="flex items-center gap-1 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-3 py-3 text-xs font-black text-slate-950 shadow-xl active:scale-95 transition min-w-[76px] justify-center"
              >
                <Check className="h-4 w-4 stroke-[3]" />
                <span>Done ({angleCount})</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={buildingPano || recordingSpin}
                onClick={() => multiStitchInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-black/80 px-2.5 py-2.5 ring-1 ring-cyan-400/35 active:scale-95 transition min-w-[76px]"
                title="Select 2 to 8 wall photos from Gallery to stitch into 360°"
              >
                <Sparkles className="h-5 w-5 text-emerald-300" />
                <span className="text-[10px] font-bold text-emerald-200">Stitch 360°</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

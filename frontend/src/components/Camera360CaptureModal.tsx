import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  FlipHorizontal,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { isVideoFile, stitchCanvasesToPanorama } from '../lib/panorama360';

export interface CapturedItem {
  id: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
  isPanorama360: boolean;
  label: string;
}

interface Camera360CaptureModalProps {
  open: boolean;
  onClose: () => void;
  venueName: string;
  targetLabel?: string;
  submitting?: boolean;
  /** Called with captured files and whether to upload immediately (true) or queue for later (false) */
  onSubmitFrames: (files: File[], uploadImmediately?: boolean) => Promise<void> | void;
}

const SPIN_TOTAL_FRAMES = 20;
const SPIN_INTERVAL_MS = 400;

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
  const spinCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const spinTimerRef = useRef<number | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const nativePhotoInputRef = useRef<HTMLInputElement>(null);
  const nativeVideoInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'photo' | 'video360'>('photo');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashEffect, setFlashEffect] = useState(false);

  // Live 10-Second 360° Spin Capture State (100% Canvas-Based — Zero MediaRecorder Bugs!)
  const [isSpinning360, setIsSpinning360] = useState(false);
  const [spinCount, setSpinCount] = useState(0);
  const [stitchingSpin, setStitchingSpin] = useState(false);

  // Captured Items + Immediate Review Screen
  const [items, setItems] = useState<CapturedItem[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const clearSpinTimer = useCallback(() => {
    if (spinTimerRef.current !== null) {
      window.clearInterval(spinTimerRef.current);
      spinTimerRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    clearSpinTimer();
    setIsSpinning360(false);
    setCameraReady(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [clearSpinTimer]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live browser camera is unavailable on this device. Tap Phone Camera or Gallery below.');
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
      setCameraError('Camera access was blocked or unavailable. Tap Phone Camera or Gallery below.');
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (open) {
      void startCamera();
    } else {
      stopCamera();
      spinCanvasesRef.current = [];
      setItems((prev) => {
        prev.forEach((it) => {
          if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
        });
        return [];
      });
      setReviewing(false);
      setSpinCount(0);
      setStitchingSpin(false);
    }
    return () => {
      stopCamera();
    };
  }, [open, startCamera, stopCamera]);

  const grabLiveFrameCanvas = useCallback((maxHeight = 640): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    const scale = Math.min(1, maxHeight / Math.max(video.videoHeight, 1));
    const w = Math.max(160, Math.round(video.videoWidth * scale));
    const h = Math.max(160, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas;
  }, []);

  const finish360Spin = useCallback(async () => {
    clearSpinTimer();
    setIsSpinning360(false);
    const frames = spinCanvasesRef.current;
    spinCanvasesRef.current = [];
    if (frames.length === 0) return;

    setStitchingSpin(true);
    try {
      const cleanName = targetLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
      const result = await stitchCanvasesToPanorama(frames, `${cleanName}_360`);
      const previewUrl = URL.createObjectURL(result.file);
      setItems((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          file: result.file,
          previewUrl,
          isVideo: false,
          isPanorama360: result.isPanorama360,
          label: result.isPanorama360
            ? 'Aligned 360° Panorama'
            : 'Room Photo (Turn more for 360°)',
        },
      ]);
      // Immediately open crystal-clear Preview & Upload Screen so user knows exactly what to tap!
      setReviewing(true);
    } catch {
      // Fallback: keep camera open
    } finally {
      setStitchingSpin(false);
      setSpinCount(0);
    }
  }, [clearSpinTimer, targetLabel]);

  const start360Spin = useCallback(() => {
    if (!cameraReady || !videoRef.current || videoRef.current.videoWidth <= 0) {
      nativeVideoInputRef.current?.click();
      return;
    }

    spinCanvasesRef.current = [];
    setSpinCount(0);
    setIsSpinning360(true);

    // Grab first angle immediately
    const first = grabLiveFrameCanvas(600);
    if (first) {
      spinCanvasesRef.current.push(first);
      setSpinCount(1);
    }

    // Sample densely every 400ms so pixel-alignment has high overlap and zero duplicate seams!
    spinTimerRef.current = window.setInterval(() => {
      const c = grabLiveFrameCanvas(600);
      if (c) {
        spinCanvasesRef.current.push(c);
        const count = spinCanvasesRef.current.length;
        setSpinCount(count);
        if (count >= SPIN_TOTAL_FRAMES) {
          void finish360Spin();
        }
      }
    }, SPIN_INTERVAL_MS);
  }, [cameraReady, finish360Spin, grabLiveFrameCanvas]);

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

  const snapPhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      nativePhotoInputRef.current?.click();
      return;
    }

    setFlashEffect(true);
    window.setTimeout(() => setFlashEffect(false), 140);

    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight, 1));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    let blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.88));
    let mime = 'image/webp';
    let ext = 'webp';
    if (!blob || (blob.type && blob.type !== 'image/webp')) {
      blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
      mime = 'image/jpeg';
      ext = 'jpg';
    }
    if (!blob) return;

    const cleanName = targetLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
    const file = new File([blob], `${cleanName}_${Date.now().toString().slice(-4)}.${ext}`, {
      type: mime,
    });
    setItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        previewUrl: URL.createObjectURL(blob!),
        isVideo: false,
        isPanorama360: false,
        label: `Photo ${prev.length + 1}`,
      },
    ]);
  }, [targetLabel]);

  const addExternalFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const added: CapturedItem[] = [];
    for (const f of Array.from(fileList)) {
      const vid = isVideoFile(f);
      added.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        previewUrl: vid ? '' : URL.createObjectURL(f),
        isVideo: vid,
        isPanorama360: vid,
        label: vid ? `360° Video (${f.name})` : f.name,
      });
    }
    setItems((prev) => [...prev, ...added]);
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

  const handleSubmit = async (uploadImmediately: boolean) => {
    if (items.length === 0 || submitting) return;
    await onSubmitFrames(
      items.map((x) => x.file),
      uploadImmediately,
    );
  };

  if (!open) return null;

  const spinPct = Math.min(100, Math.round((spinCount / SPIN_TOTAL_FRAMES) * 100));

  return (
    <div className="fixed inset-0 !m-0 z-50 h-[100dvh] w-screen bg-black text-white overflow-hidden select-none">
      {/* Hidden native inputs for Gallery / Fallback Native Camera */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addExternalFiles(e.target.files);
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
          addExternalFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={nativeVideoInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addExternalFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* ================================================================= */}
      {/* 1. FULL-BLEED 100% SCREEN LIVE CAMERA VIEWFINDER                  */}
      {/* ================================================================= */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="absolute inset-0 h-full w-full object-cover bg-black"
      />

      {flashEffect && (
        <div className="pointer-events-none absolute inset-0 z-30 bg-white/80" />
      )}

      {/* Top & Bottom Soft Scrims */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 z-10 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 z-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent" />

      {/* ================================================================= */}
      {/* 2. FLOATING TOP BAR                                               */}
      {/* ================================================================= */}
      <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 rounded-full bg-black/70 px-3.5 py-2 ring-1 ring-white/20">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white truncate max-w-[175px] sm:max-w-xs">
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
                onClick={() => void toggleTorch()}
                className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 transition ${
                  torchOn
                    ? 'bg-amber-400 text-slate-950 ring-amber-200'
                    : 'bg-black/70 text-white ring-white/20'
                }`}
                title="Flashlight"
              >
                <Zap className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/20"
                title="Switch Camera"
              >
                <FlipHorizontal className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/20"
            title="Close Camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 3. LIVE 10-SEC 360° SPIN CAPTURE HUD                              */}
      {/* ================================================================= */}
      {mode === 'video360' && !cameraError && !reviewing && (
        <div className="pointer-events-none absolute top-20 inset-x-4 z-20 flex flex-col items-center gap-2">
          {stitchingSpin ? (
            <div className="w-full max-w-xs rounded-2xl bg-indigo-600/95 px-4 py-3 text-center ring-2 ring-cyan-300 shadow-2xl flex items-center justify-center gap-2.5">
              <Loader2 className="h-5 w-5 animate-spin text-white" />
              <span className="text-xs font-extrabold">Stitching your 360° Panorama...</span>
            </div>
          ) : isSpinning360 ? (
            <div className="w-full max-w-xs rounded-2xl bg-rose-600/95 px-4 py-3 text-center ring-2 ring-rose-200 shadow-2xl space-y-1.5">
              <div className="flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider">
                <span className="h-2.5 w-2.5 rounded-full bg-white animate-ping" />
                <span>
                  Capturing 360° · {spinCount} / {SPIN_TOTAL_FRAMES} ({spinPct}%)
                </span>
              </div>
              <div className="text-[11px] font-bold text-rose-100">
                Slowly turn around in a full circle ↻
              </div>
              <div className="h-2 w-full rounded-full bg-black/35 overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-300"
                  style={{ width: `${spinPct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-black/75 px-4 py-2 text-xs font-bold text-cyan-200 ring-1 ring-cyan-400/40 text-center max-w-xs">
              🌐 Tap the Red Circle &amp; slowly turn around in a full 360° circle (10 sec)
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* 4. FALLBACK IF LIVE CAMERA IS BLOCKED                             */}
      {/* ================================================================= */}
      {cameraError && !reviewing && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950 px-6 text-center space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40">
            <Camera className="h-8 w-8" />
          </div>
          <p className="text-sm font-semibold text-slate-200 max-w-sm leading-relaxed">
            {cameraError}
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 w-full max-w-xs">
            <button
              type="button"
              onClick={() => nativePhotoInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3.5 text-sm font-extrabold text-slate-950 shadow-lg"
            >
              <Camera className="h-4 w-4" />
              <span>Phone Camera</span>
            </button>
            <button
              type="button"
              onClick={() => nativeVideoInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-rose-500 px-4 py-3.5 text-sm font-extrabold text-white shadow-lg"
            >
              <Video className="h-4 w-4" />
              <span>360° Video</span>
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

      {/* ================================================================= */}
      {/* 5. CRYSTAL-CLEAR PREVIEW & IMMEDIATE UPLOAD SCREEN!               */}
      {/* ================================================================= */}
      {reviewing && items.length > 0 ? (
        <div className="absolute inset-0 z-30 flex flex-col justify-between bg-slate-950/95 p-4 pt-16 pb-6">
          <div className="space-y-2 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-extrabold text-emerald-300 ring-1 ring-emerald-400/40">
              ✅ Ready for {targetLabel} ({items.length} item{items.length === 1 ? '' : 's'})
            </span>
            <h3 className="font-display text-lg font-extrabold text-white">
              Preview Before Uploading
            </h3>
          </div>

          {/* Preview Carousel */}
          <div className="flex-1 my-4 flex flex-col items-center justify-center gap-3 overflow-y-auto">
            {items.map((it) => (
              <div
                key={it.id}
                className="relative w-full max-w-lg rounded-2xl bg-slate-900 ring-1 ring-white/20 overflow-hidden shadow-xl"
              >
                <div className="h-44 sm:h-56 w-full bg-black flex items-center justify-center">
                  {it.previewUrl ? (
                    <img
                      src={it.previewUrl}
                      alt={it.label}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="text-center p-4 space-y-1.5">
                      <Video className="h-10 w-10 text-rose-400 mx-auto" />
                      <div className="text-sm font-extrabold text-white">{it.label}</div>
                      <div className="text-xs text-cyan-300">
                        Will automatically convert to 360° Panorama on upload
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-slate-900">
                  <span className="text-xs font-bold text-slate-200 truncate">
                    {it.isPanorama360 ? '🌐 ' : '📷 '}
                    {it.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-600 hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* GIANT UNMISSABLE UPLOAD BUTTONS */}
          <div className="w-full max-w-lg mx-auto space-y-2.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmit(true)}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-4 text-sm sm:text-base font-black text-slate-950 shadow-2xl active:scale-95 transition"
            >
              <Upload className="h-5 w-5 stroke-[2.5]" />
              <span>⬆ Upload &amp; Save to {targetLabel} Now</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setReviewing(false)}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-4 py-3 text-xs font-extrabold text-white ring-1 ring-white/15"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Take Another</span>
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit(false)}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-3 text-xs font-extrabold text-white"
              >
                <span>+ Queue for Later</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ================================================================= */
        /* 6. FLOATING BOTTOM CAMERA SHUTTER CONTROLS                        */
        /* ================================================================= */
        <div className="absolute bottom-0 inset-x-0 z-20 px-4 pb-6 pt-3 flex flex-col items-center gap-4">
          {/* 2-Mode Toggle: Photo vs 360° Spin (10s) */}
          <div className="inline-flex items-center gap-1 rounded-full bg-black/75 p-1 ring-1 ring-white/20">
            <button
              type="button"
              disabled={isSpinning360 || stitchingSpin}
              onClick={() => setMode('photo')}
              className={`rounded-full px-4 py-1.5 text-xs font-extrabold transition ${
                mode === 'photo'
                  ? 'bg-white text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              📷 Photo
            </button>
            <button
              type="button"
              disabled={isSpinning360 || stitchingSpin}
              onClick={() => setMode('video360')}
              className={`rounded-full px-4 py-1.5 text-xs font-extrabold transition ${
                mode === 'video360'
                  ? 'bg-rose-500 text-white shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              🌐 360° Spin (10s)
            </button>
          </div>

          {/* 3-Column Shutter Row */}
          <div className="w-full max-w-md flex items-center justify-between gap-3">
            {/* Left: Gallery Picker */}
            <button
              type="button"
              disabled={isSpinning360 || stitchingSpin}
              onClick={() => galleryInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-black/70 px-3.5 py-2.5 ring-1 ring-white/20 active:scale-95 transition min-w-[76px]"
            >
              <ImageIcon className="h-5 w-5 text-cyan-300" />
              <span className="text-[11px] font-bold text-white">Gallery</span>
            </button>

            {/* Center: Giant Native Shutter / 360° Spin Button */}
            {mode === 'photo' ? (
              <button
                type="button"
                onClick={() => void snapPhoto()}
                disabled={!cameraReady && !cameraError}
                aria-label="Take Photo"
                className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/20 p-1.5 shadow-2xl active:scale-90 transition"
              >
                <span className="h-full w-full rounded-full bg-white" />
              </button>
            ) : (
              <button
                type="button"
                disabled={stitchingSpin}
                onClick={() => (isSpinning360 ? void finish360Spin() : start360Spin())}
                aria-label={isSpinning360 ? 'Finish 360 Spin' : 'Start 10s 360 Spin'}
                className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-black/40 p-2 shadow-2xl active:scale-90 transition"
              >
                {isSpinning360 ? (
                  <span className="h-8 w-8 rounded-lg bg-rose-500 shadow-lg" />
                ) : (
                  <span className="h-full w-full rounded-full bg-rose-600 shadow-lg" />
                )}
              </button>
            )}

            {/* Right: Review & Upload Button */}
            {items.length > 0 ? (
              <button
                type="button"
                disabled={isSpinning360 || stitchingSpin}
                onClick={() => setReviewing(true)}
                className="flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-3.5 py-3 text-xs font-black text-slate-950 shadow-xl active:scale-95 transition"
              >
                <Upload className="h-4 w-4 stroke-[2.5]" />
                <span>Next ({items.length})</span>
              </button>
            ) : (
              <div className="min-w-[76px] text-center text-[10px] font-bold text-slate-300">
                {mode === 'photo' ? 'Tap circle to snap' : 'Tap red & spin 360°'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

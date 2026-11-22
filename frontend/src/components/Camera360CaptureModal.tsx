import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  FlipHorizontal,
  Image as ImageIcon,
  RefreshCw,
  Trash2,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { isVideoFile } from '../lib/panorama360';

export interface CapturedItem {
  id: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const nativePhotoInputRef = useRef<HTMLInputElement>(null);
  const nativeVideoInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'photo' | 'video360'>('photo');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashEffect, setFlashEffect] = useState(false);

  // 360° Spin Video Recording State
  const [isRecording360, setIsRecording360] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const MAX_360_SECONDS = 10;

  // Captured Queue inside camera session
  const [items, setItems] = useState<CapturedItem[]>([]);
  const [showTray, setShowTray] = useState(false);

  const stopCamera = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // Ignore
      }
    }
    recorderRef.current = null;
    setIsRecording360(false);
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
      setCameraError('Live browser camera is unavailable on this device. Use Phone Camera or Gallery below.');
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
      setCameraError('Camera access was blocked or unavailable. Tap "Phone Camera" or "Gallery" below.');
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (open) {
      void startCamera();
    } else {
      stopCamera();
      setItems((prev) => {
        prev.forEach((it) => {
          if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
        });
        return [];
      });
      setShowTray(false);
      setRecordSeconds(0);
    }
    return () => {
      stopCamera();
    };
  }, [open, startCamera, stopCamera]);

  const stop360Recording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        // Ignore
      }
    }
    setIsRecording360(false);
  }, []);

  // Countdown timer for 360° spin video recording
  useEffect(() => {
    if (!isRecording360) return;
    const timer = window.setInterval(() => {
      setRecordSeconds((prev) => {
        const next = prev + 1;
        if (next >= MAX_360_SECONDS) {
          stop360Recording();
          return MAX_360_SECONDS;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRecording360, stop360Recording]);

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
      // Torch unsupported on some devices
    }
  };

  const snapPhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      nativePhotoInputRef.current?.click();
      return;
    }

    setFlashEffect(true);
    window.setTimeout(() => setFlashEffect(false), 160);

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
        label: `Photo ${prev.length + 1}`,
      },
    ]);
  }, [targetLabel]);

  const start360Recording = useCallback(() => {
    if (!streamRef.current || typeof MediaRecorder === 'undefined') {
      nativeVideoInputRef.current?.click();
      return;
    }

    try {
      const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ];
      const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || '';
      const recorder = mimeType
        ? new MediaRecorder(streamRef.current, { mimeType })
        : new MediaRecorder(streamRef.current);

      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'video/webm';
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunksRef.current, { type });
        if (blob.size > 0) {
          const cleanName = targetLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'room';
          const file = new File([blob], `${cleanName}_360spin_${Date.now().toString().slice(-4)}.${ext}`, {
            type,
          });
          setItems((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              file,
              previewUrl: '',
              isVideo: true,
              label: `360° Spin Video`,
            },
          ]);
        }
        setIsRecording360(false);
        setRecordSeconds(0);
      };

      recorderRef.current = recorder;
      setRecordSeconds(0);
      setIsRecording360(true);
      recorder.start(250);
    } catch {
      nativeVideoInputRef.current?.click();
    }
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
        label: vid ? '360° Video' : f.name,
      });
    }
    setItems((prev) => [...prev, ...added]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const handleDone = async () => {
    if (items.length === 0 || submitting) return;
    await onSubmitFrames(items.map((x) => x.file));
  };

  if (!open) return null;

  const latestItem = items[items.length - 1] ?? null;
  const spinPct = Math.min(100, Math.round((recordSeconds / MAX_360_SECONDS) * 100));

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

      {/* Shutter Flash Feedback */}
      {flashEffect && (
        <div className="pointer-events-none absolute inset-0 z-30 bg-white/80 transition-opacity" />
      )}

      {/* Subtle Top & Bottom Gradient Scrims so Floating Controls Stay Crisp */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 z-10 bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent" />

      {/* ================================================================= */}
      {/* 2. FLOATING TOP BAR (ROOM BADGE + FLIP + TORCH + CLOSE)           */}
      {/* ================================================================= */}
      <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 rounded-full bg-black/65 px-3.5 py-2 ring-1 ring-white/20">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white truncate max-w-[170px] sm:max-w-xs">
              {targetLabel}
            </div>
            <div className="text-[10px] text-slate-300 truncate">{venueName}</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void toggleTorch()}
            className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 transition ${
              torchOn
                ? 'bg-amber-400 text-slate-950 ring-amber-200'
                : 'bg-black/65 text-white ring-white/20'
            }`}
            title="Flashlight"
          >
            <Zap className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white ring-1 ring-white/20"
            title="Switch Camera"
          >
            <FlipHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white ring-1 ring-white/20"
            title="Close Camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 3. LIVE 360° SPIN RECORDING GUIDE OVERLAY                         */}
      {/* ================================================================= */}
      {mode === 'video360' && !cameraError && (
        <div className="pointer-events-none absolute top-20 inset-x-4 z-20 flex flex-col items-center gap-2">
          {isRecording360 ? (
            <div className="w-full max-w-xs rounded-2xl bg-rose-600/90 px-4 py-2.5 text-center ring-2 ring-rose-300 shadow-2xl space-y-1.5">
              <div className="flex items-center justify-center gap-2 text-xs font-extrabold uppercase tracking-wider">
                <span className="h-2.5 w-2.5 rounded-full bg-white animate-ping" />
                <span>
                  Recording 360° · {recordSeconds}s / {MAX_360_SECONDS}s
                </span>
              </div>
              <div className="text-[11px] font-semibold text-rose-100">
                Slowly turn around in a full circle (360°) ↻
              </div>
              <div className="h-1.5 w-full rounded-full bg-black/30 overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-300"
                  style={{ width: `${spinPct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-full bg-black/70 px-4 py-1.5 text-xs font-bold text-cyan-200 ring-1 ring-cyan-400/40 text-center">
              🌐 Tap Red Record &amp; turn slowly in a full 360° circle (6–10s)
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* 4. FALLBACK IF BROWSER CAMERA IS BLOCKED / UNAVAILABLE            */}
      {/* ================================================================= */}
      {cameraError && (
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
      {/* 5. CAPTURED PREVIEW TRAY (ONLY WHEN USER TAPS THUMBNAIL)          */}
      {/* ================================================================= */}
      {showTray && items.length > 0 && (
        <div className="absolute bottom-44 inset-x-3 z-20 rounded-2xl bg-slate-950/95 p-3 ring-1 ring-white/20 shadow-2xl space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-200">
            <span>Captured for {targetLabel} ({items.length})</span>
            <button
              type="button"
              onClick={() => setShowTray(false)}
              className="text-cyan-300 font-extrabold"
            >
              Hide
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map((it) => (
              <div
                key={it.id}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/20 flex items-center justify-center"
              >
                {it.isVideo ? (
                  <div className="text-center px-1">
                    <Video className="h-5 w-5 text-rose-400 mx-auto" />
                    <span className="text-[9px] font-extrabold text-rose-200 block mt-0.5">
                      360° Vid
                    </span>
                  </div>
                ) : (
                  <img
                    src={it.previewUrl}
                    alt={it.label}
                    className="h-full w-full object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white"
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 6. FLOATING BOTTOM CAMERA CONTROLS (NATIVE PHONE FEEL)            */}
      {/* ================================================================= */}
      <div className="absolute bottom-0 inset-x-0 z-20 px-4 pb-6 pt-3 flex flex-col items-center gap-4">
        {/* Clean 2-Mode Toggle: Photo vs 360° Spin Video */}
        <div className="inline-flex items-center gap-1 rounded-full bg-black/70 p-1 ring-1 ring-white/20">
          <button
            type="button"
            disabled={isRecording360}
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
            disabled={isRecording360}
            onClick={() => setMode('video360')}
            className={`rounded-full px-4 py-1.5 text-xs font-extrabold transition ${
              mode === 'video360'
                ? 'bg-rose-500 text-white shadow'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            🌐 360° Video
          </button>
        </div>

        {/* 3-Column Shutter Row: Gallery | Giant Shutter | Done (N) */}
        <div className="w-full max-w-md flex items-center justify-between gap-4">
          {/* Left: Gallery Picker */}
          <button
            type="button"
            disabled={isRecording360}
            onClick={() => galleryInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-black/65 px-3.5 py-2.5 ring-1 ring-white/20 active:scale-95 transition min-w-[76px]"
          >
            <ImageIcon className="h-5 w-5 text-cyan-300" />
            <span className="text-[11px] font-bold text-white">Gallery</span>
          </button>

          {/* Center: Giant Native Shutter / 360° Record Button */}
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
              onClick={() => (isRecording360 ? stop360Recording() : start360Recording())}
              aria-label={isRecording360 ? 'Stop 360 Video' : 'Record 360 Video'}
              className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-black/40 p-2 shadow-2xl active:scale-90 transition"
            >
              {isRecording360 ? (
                <span className="h-8 w-8 rounded-lg bg-rose-500 shadow-lg" />
              ) : (
                <span className="h-full w-full rounded-full bg-rose-600 shadow-lg" />
              )}
            </button>
          )}

          {/* Right: Done / Add to Upload Queue */}
          {items.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowTray((v) => !v)}
                className="relative h-12 w-12 overflow-hidden rounded-xl bg-slate-900 ring-2 ring-cyan-400 shrink-0 flex items-center justify-center"
                title="Preview captured items"
              >
                {latestItem?.previewUrl ? (
                  <img
                    src={latestItem.previewUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Video className="h-5 w-5 text-rose-400" />
                )}
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-black text-slate-950">
                  {items.length}
                </span>
              </button>
              <button
                type="button"
                disabled={isRecording360 || submitting}
                onClick={() => void handleDone()}
                className="flex items-center gap-1 rounded-2xl bg-emerald-500 px-3.5 py-3 text-xs font-extrabold text-slate-950 shadow-xl active:scale-95 transition"
              >
                <Check className="h-4 w-4 stroke-[3]" />
                <span>Add ({items.length})</span>
              </button>
            </div>
          ) : (
            <div className="min-w-[76px] text-center text-[10px] font-bold text-slate-400">
              {mode === 'photo' ? 'Tap circle to snap' : 'Tap red to spin 360°'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

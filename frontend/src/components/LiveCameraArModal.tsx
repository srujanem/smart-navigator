import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Compass,
  Volume2,
  X,
} from 'lucide-react';
import { mediaUrl } from '../lib/api';
import { formatLevel } from '../lib/locationStore';
import type { Route, Step, VenueDetail } from '../lib/types';

interface LiveCameraArModalProps {
  open: boolean;
  onClose: () => void;
  venue: VenueDetail;
  route: Route;
  activeStepIdx: number;
  onSelectStep: (step: Step, idx: number) => void;
  onSpeakStep?: (step: Step) => void;
}

export const LiveCameraArModal: React.FC<LiveCameraArModalProps> = ({
  open,
  onClose,
  venue,
  route,
  activeStepIdx,
  onSelectStep,
  onSpeakStep,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camActive, setCamActive] = useState(false);
  const [camFallback, setCamFallback] = useState(false);
  const [heading, setHeading] = useState<number>(0);

  const activeStep = route.steps[activeStepIdx] ?? route.steps[0];
  const isFinal = activeStepIdx >= route.steps.length - 1;

  const stopCam = useCallback(() => {
    setCamActive(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      stopCam();
      return;
    }
    let cancelled = false;
    setCamFallback(false);
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            void videoRef.current.play().catch(() => {});
          }
          setCamActive(true);
        })
        .catch(() => {
          if (!cancelled) setCamFallback(true);
        });
    } else {
      setCamFallback(true);
    }

    const onOrient = (ev: DeviceOrientationEvent) => {
      const wk = (ev as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof wk === 'number') setHeading(Math.round(wk));
      else if (typeof ev.alpha === 'number') setHeading(Math.round((360 - ev.alpha) % 360));
    };
    window.addEventListener('deviceorientation', onOrient, true);

    return () => {
      cancelled = true;
      window.removeEventListener('deviceorientation', onOrient, true);
      stopCam();
    };
  }, [open, stopCam]);

  if (!open || !activeStep) return null;

  const arrowRotDeg =
    activeStep.icon === 'left'
      ? -44
      : activeStep.icon === 'right'
        ? 44
        : 0;

  return (
    <div className="fixed inset-0 !m-0 z-50 h-[100dvh] w-screen bg-slate-950 text-white overflow-hidden select-none flex flex-col justify-between">
      {/* Live Camera Feed (or Reference Corridor Fallback if camera permission blocked) */}
      {!camFallback ? (
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : activeStep.photo_url ? (
        <img
          src={mediaUrl(activeStep.photo_url)}
          alt={activeStep.name}
          className="absolute inset-0 h-full w-full object-cover opacity-80"
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 via-transparent to-black/85" />

      {/* Top AR HUD Bar */}
      <div className="relative z-20 p-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 rounded-full bg-black/80 px-3.5 py-2 ring-1 ring-cyan-400/40 backdrop-blur-md">
          <Camera className="h-4 w-4 text-cyan-400 shrink-0" />
          <div>
            <div className="text-xs font-extrabold text-white">
              {camActive ? 'Live Camera AR Wayfinding' : 'AR Wayfinding HUD'}
            </div>
            <div className="text-[10px] text-cyan-200">
              {venue.name} · {formatLevel(activeStep.level)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/80 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300 ring-1 ring-white/20">
            <Compass className="h-3.5 w-3.5" />
            {heading}°
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Live AR"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/85 text-white ring-1 ring-white/25 hover:bg-rose-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Center Floating 3D AR Direction Beacon + Door Wall Tag */}
      <div className="pointer-events-none relative z-20 flex flex-col items-center justify-center gap-4 px-4">
        <div className="rounded-3xl bg-slate-950/85 px-5 py-3 text-center ring-2 ring-cyan-400/75 shadow-[0_0_35px_rgba(34,211,238,0.35)] backdrop-blur-md max-w-sm">
          <div className="text-[11px] font-black uppercase tracking-widest text-cyan-300">
            Step {activeStepIdx + 1} of {route.steps.length}
            {activeStep.distance_m > 0 ? ` · ${Math.round(activeStep.distance_m)} m` : ''}
          </div>
          <div className="font-display text-lg sm:text-xl font-extrabold text-white mt-0.5">
            {activeStep.short_action || activeStep.name}
          </div>
          {activeStep.door_side && activeStep.door_side !== 'ahead' && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/25 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-200 ring-1 ring-emerald-400/40">
              🚪 Target Door on {activeStep.door_side.toUpperCase()} Wall
            </div>
          )}
        </div>

        {/* 3D Perspective Floating AR Floor Arrow */}
        {!isFinal ? (
          <div
            style={{
              transform: `perspective(360px) rotateX(50deg) rotateZ(${arrowRotDeg}deg)`,
            }}
            className="flex flex-col items-center -space-y-4 drop-shadow-[0_6px_24px_rgba(34,211,238,0.95)]"
          >
            {[0, 1, 2].map((i) => (
              <svg
                key={i}
                viewBox="0 0 80 42"
                style={{ animationDelay: `${i * 180}ms` }}
                className="h-12 w-24 animate-pulse"
              >
                <path
                  d="M12 34 L40 8 L68 34"
                  fill="none"
                  stroke={i === 2 ? '#ffffff' : '#22d3ee'}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ))}
          </div>
        ) : (
          <div className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-black uppercase tracking-wider text-slate-950 shadow-2xl ring-4 ring-emerald-200">
            🎯 You Have Arrived at {activeStep.name}!
          </div>
        )}
      </div>

      {/* Bottom Reference Landmark PiP + Step Thumb Controls */}
      <div className="relative z-20 p-4 space-y-3">
        <div className="mx-auto max-w-md rounded-2xl bg-slate-950/90 p-3 ring-1 ring-white/20 backdrop-blur-md flex items-center gap-3">
          {activeStep.photo_url && (
            <img
              src={mediaUrl(activeStep.photo_url)}
              alt={activeStep.name}
              className="h-14 w-16 shrink-0 rounded-xl object-cover object-center ring-1 ring-cyan-400/40"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
              Match Landmark View
            </div>
            <div className="text-xs font-bold text-white leading-snug line-clamp-2">
              {activeStep.instruction}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-md flex items-center gap-2">
          <button
            type="button"
            disabled={activeStepIdx <= 0}
            onClick={() => {
              const prev = Math.max(0, activeStepIdx - 1);
              onSelectStep(route.steps[prev], prev);
            }}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-2xl bg-white/15 py-3.5 text-xs font-extrabold text-white ring-1 ring-white/20 disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </button>

          {onSpeakStep && (
            <button
              type="button"
              onClick={() => onSpeakStep(activeStep)}
              className="rounded-2xl bg-indigo-600 px-4 py-3.5 text-white shadow"
              aria-label="Speak direction"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            disabled={isFinal}
            onClick={() => {
              const nxt = Math.min(route.steps.length - 1, activeStepIdx + 1);
              onSelectStep(route.steps[nxt], nxt);
            }}
            className="flex-[1.6] inline-flex items-center justify-center gap-1 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 py-3.5 text-xs font-black text-slate-950 shadow-xl disabled:opacity-35"
          >
            <span>{isFinal ? 'Arrived ✓' : 'Next Step'}</span>
            {!isFinal && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};

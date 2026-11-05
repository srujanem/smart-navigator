import React from 'react';
import { AlertCircle, Box, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  dark?: boolean;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Connection Interrupted',
  message,
  onRetry,
  dark = false,
}) => {
  return (
    <div
      className={`rounded-2xl p-6 text-center max-w-lg mx-auto my-6 ${
        dark
          ? 'bg-white/[0.04] ring-1 ring-white/10 text-white'
          : 'bg-white ring-1 ring-slate-200 shadow-soft text-slate-900'
      }`}
    >
      <div
        className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl ${
          dark ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-50 text-rose-600'
        }`}
      >
        <AlertCircle className="h-5 w-5" />
      </div>
      <h3 className="font-display text-base font-bold">{title}</h3>
      <p
        className={`mt-1.5 text-sm leading-relaxed ${
          dark ? 'text-slate-400' : 'text-slate-600'
        }`}
      >
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-cyan-400 hover:to-indigo-500 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry Connection
        </button>
      )}
    </div>
  );
};

export const Skeleton3D: React.FC<{ label?: string; dark?: boolean }> = ({
  label = 'Initializing 3D Spatial Digital Twin...',
  dark = true,
}) => {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center rounded-2xl spatial-grid-dark ${
        dark ? 'bg-[#070B18] text-slate-300' : 'bg-slate-900 text-slate-200'
      }`}
    >
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 rounded-2xl border border-cyan-400/30 animate-ping" />
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-400/40">
          <Box className="h-6 w-6 animate-pulse" />
        </div>
      </div>
      <p className="mt-3 text-xs font-medium tracking-wide text-slate-400">{label}</p>
    </div>
  );
};

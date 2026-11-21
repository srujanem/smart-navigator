import React from 'react';
import { AlertTriangle, Box, Home, RefreshCw } from 'lucide-react';

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isChunkError: boolean;
}

const CHUNK_RELOAD_KEY = 'navigator_chunk_reload_at';

function isChunkLoadFailure(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('ChunkLoadError') ||
    msg.includes('Loading chunk')
  );
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
    isChunkError: false,
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const chunkErr = isChunkLoadFailure(error);
    return {
      hasError: true,
      errorMessage:
        error instanceof Error && error.message
          ? error.message
          : 'An unexpected screen error occurred.',
      isChunkError: chunkErr,
    };
  }

  componentDidCatch(error: unknown): void {
    // Auto-recover once if a fresh Vercel deploy rotated JS chunk hashes while the tab was open
    if (isChunkLoadFailure(error) && typeof window !== 'undefined') {
      try {
        const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0');
        if (Date.now() - lastReload > 15_000) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        // Ignore storage errors on restricted mobile WebViews
      }
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-[100dvh] w-full bg-[#070B18] text-white flex items-center justify-center p-5">
        <div className="w-full max-w-md rounded-3xl bg-[#0F172A] p-6 ring-1 ring-white/15 shadow-2xl text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-lg font-extrabold text-white">
              {this.state.isChunkError
                ? 'App Updated — Quick Refresh Needed'
                : 'Something Went Wrong'}
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              {this.state.isChunkError
                ? 'A newer version of Navigator was just published. Tap reload to load the latest mobile screen cleanly.'
                : 'Navigator caught a display error safely so your browser stays responsive.'}
            </p>
            {!this.state.isChunkError && this.state.errorMessage && (
              <p className="mt-2 rounded-xl bg-slate-950/80 px-3 py-2 font-mono text-[11px] text-rose-300 break-words">
                {this.state.errorMessage.slice(0, 180)}
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-4 py-3 text-sm font-extrabold text-white shadow-md active:scale-[0.98]"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Screen
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/venues';
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-slate-200 ring-1 ring-white/15 active:scale-[0.98]"
            >
              <Home className="h-4 w-4" />
              All Venues
            </button>
          </div>
        </div>
      </div>
    );
  }
}

interface Canvas3DErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onFallbackTo2D?: () => void;
}

interface Canvas3DErrorBoundaryState {
  hasError: boolean;
}

export class Canvas3DErrorBoundary extends React.Component<
  Canvas3DErrorBoundaryProps,
  Canvas3DErrorBoundaryState
> {
  state: Canvas3DErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): Canvas3DErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl bg-[#070B18] p-6 text-center text-white ring-1 ring-white/10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/30">
          <Box className="h-6 w-6" />
        </div>
        <div className="space-y-1 max-w-xs">
          <h3 className="font-display text-sm font-extrabold">
            {this.props.fallbackTitle || '3D Graphics Paused on This Device'}
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your phone browser temporarily ran low on WebGL graphics memory. You can retry 3D or switch to the instant 2D Floor Map.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white ring-1 ring-white/15 active:scale-[0.98]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry 3D
          </button>
          {this.props.onFallbackTo2D && (
            <button
              type="button"
              onClick={this.props.onFallbackTo2D}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 active:scale-[0.98]"
            >
              Switch to Fast 2D Map
            </button>
          )}
        </div>
      </div>
    );
  }
}

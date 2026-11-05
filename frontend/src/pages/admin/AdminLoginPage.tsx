import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Compass,
  KeyRound,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react';
import { adminLogin } from '../../lib/api';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const venueParam = searchParams.get('venue');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fillDemo = () => {
    setEmail('admin@navigator.dev');
    setPassword('admin123');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await adminLogin(email.trim(), password);
      navigate(venueParam ? `/admin?venue=${encodeURIComponent(venueParam)}` : '/admin', {
        replace: true,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Invalid email or password.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B18] text-white flex flex-col justify-between p-4 sm:p-6 spatial-grid-dark relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 left-1/3 h-96 w-96 rounded-full bg-cyan-500/15 blur-[130px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-indigo-600/20 blur-[140px]" />

      {/* Top Back Link */}
      <div className="mx-auto w-full max-w-6xl flex items-center justify-between z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Navigator
        </Link>
      </div>

      {/* Centered Login Card */}
      <div className="mx-auto w-full max-w-md z-10 my-8">
        <div className="rounded-3xl bg-[#0C1329]/90 p-7 sm:p-8 ring-1 ring-white/15 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-600 text-white shadow-lg shadow-cyan-500/25">
              <Compass className="h-6 w-6" />
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight">
              Navigator Admin Studio
            </h1>
            <p className="text-xs text-slate-400">
              Manage venue photo datasets, AI vision index health, live doctor/staff availability, and corridor closures.
            </p>
          </div>

          {/* 1-Click Demo Credentials Helper */}
          <button
            type="button"
            onClick={fillDemo}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-cyan-500/15 px-4 py-2.5 text-xs font-bold text-cyan-300 ring-1 ring-cyan-400/35 hover:bg-cyan-500/25 transition"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Fill Demo Admin Credentials
          </button>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/15 p-3.5 text-xs text-rose-200 ring-1 ring-rose-400/30">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@navigator.dev"
                className="input-dark"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-dark"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 text-sm font-bold shadow-lg shadow-cyan-500/20"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Sign In to Studio
            </button>
          </form>

          <div className="pt-2 border-t border-white/10 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <Lock className="h-3 w-3" />
            Bearer token stored locally for Admin API authorization
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-500 z-10">
        Navigator Spatial Operations Console
      </div>
    </div>
  );
};

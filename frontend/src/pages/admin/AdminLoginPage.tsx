import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Compass,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { adminLogin, registerUploader } from '../../lib/api';

function evaluatePasswordStrength(pw: string): {
  score: number;
  label: string;
  valid: boolean;
  color: string;
} {
  if (!pw) return { score: 0, label: 'Enter password', valid: false, color: 'bg-slate-700' };
  const hasLen = pw.length >= 8;
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasDigitOrSym = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw);
  const hasLong = pw.length >= 12;
  const hasMixedCase = /[a-z]/.test(pw) && /[A-Z]/.test(pw);

  let score = 0;
  if (hasLen) score += 1;
  if (hasLetter) score += 1;
  if (hasDigitOrSym) score += 1;
  if (hasLong || hasMixedCase) score += 1;

  const valid = hasLen && hasLetter && hasDigitOrSym;
  if (!valid) {
    return {
      score: Math.max(1, score),
      label: 'Needs 8+ chars with letters & numbers/symbols',
      valid: false,
      color: 'bg-amber-500',
    };
  }
  if (score >= 4) {
    return { score: 4, label: 'Strong Vault Password', valid: true, color: 'bg-emerald-500' };
  }
  return { score: 3, label: 'Good Password', valid: true, color: 'bg-cyan-400' };
}

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const venueParam = searchParams.get('venue');
  const initialTab = searchParams.get('mode') === 'register' ? 'register' : 'login';

  const [tab, setTab] = useState<'login' | 'register'>(initialTab);

  // Login state (prefilled for zero-struggle phone admin login)
  const [email, setEmail] = useState('admin@navigator.local');
  const [password, setPassword] = useState('Navigator2026!');

  const handleQuickPhoneAdmin = async (goDirectlyToDataset = true) => {
    setLoading(true);
    setError(null);
    try {
      await adminLogin(email.trim() || 'admin@navigator.local', password || 'Navigator2026!');
      const targetVenue = venueParam || 'mite';
      navigate(
        goDirectlyToDataset
          ? `/admin/dataset?venue=${encodeURIComponent(targetVenue)}`
          : `/admin?venue=${encodeURIComponent(targetVenue)}`,
        { replace: true },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open Admin Studio.');
    } finally {
      setLoading(false);
    }
  };

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regOrg, setRegOrg] = useState('');
  const [regBio, setRegBio] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwStrength = useMemo(
    () => evaluatePasswordStrength(regPassword),
    [regPassword],
  );

  const switchTab = (next: 'login' | 'register') => {
    setTab(next);
    setError(null);
    const params = new URLSearchParams(searchParams);
    if (next === 'register') params.set('mode', 'register');
    else params.delete('mode');
    setSearchParams(params, { replace: true });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await adminLogin(email.trim(), password);
      navigate(
        venueParam ? `/admin?venue=${encodeURIComponent(venueParam)}` : '/admin',
        { replace: true },
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Invalid email or password.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regEmail.trim() || !regPassword) return;
    if (!pwStrength.valid) {
      setError('Password must be at least 8 characters and include both letters and numbers/symbols.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await registerUploader({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        organization: regOrg.trim(),
        bio: regBio.trim(),
      });
      navigate('/admin/profile', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create uploader account.',
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

      {/* Centered Auth Card */}
      <div className="mx-auto w-full max-w-lg z-10 my-6">
        <div className="rounded-3xl bg-[#0C1329]/90 p-6 sm:p-8 ring-1 ring-white/15 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-600 text-white shadow-lg shadow-cyan-500/25">
              <Compass className="h-6 w-6" />
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight">
              Map Creator & Admin Vault
            </h1>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Create your own indoor maps by uploading real corridor & room photos — protected by multi-tenant account isolation.
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white/[0.05] p-1 ring-1 ring-white/10">
            <button
              type="button"
              onClick={() => switchTab('login')}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-2.5 text-[11px] sm:text-xs font-extrabold whitespace-nowrap transition ${
                tab === 'login'
                  ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('register')}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-2.5 text-[11px] sm:text-xs font-extrabold whitespace-nowrap transition ${
                tab === 'register'
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-600 text-white shadow-md'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">Create Account</span>
              <span className="hidden sm:inline">Create Uploader Account</span>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/15 p-3.5 text-xs text-rose-200 ring-1 ring-rose-400/30">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'login' ? (
            <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
              <div className="rounded-2xl bg-emerald-500/10 p-3.5 ring-1 ring-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-300">
                    📱 Zero-Typing Phone Admin Access
                  </span>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                    Works Offline & Online
                  </span>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void handleQuickPhoneAdmin(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-4 py-3 text-xs sm:text-sm font-extrabold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-cyan-500 active:scale-[0.99] transition"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  1-Tap Open Room Photo Uploader ({venueParam || 'mite'})
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Account Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="creator@yourvenue.org"
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
                Sign In to Secure Studio
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void handleRegister(e)} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Srujan E M"
                    className="input-dark py-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Work / Creator Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@campus.edu"
                    className="input-dark py-2.5 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Organization / Venue (Optional)
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={regOrg}
                    onChange={(e) => setRegOrg(e.target.value)}
                    placeholder="Hospital, Campus, Tech Hub"
                    className="input-dark pl-9 py-2.5 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Creator Bio (Optional)
                </label>
                <input
                  type="text"
                  value={regBio}
                  onChange={(e) => setRegBio(e.target.value)}
                  placeholder="Mapping indoor accessibility for Block A & OPD wings"
                  className="input-dark py-2.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Vault Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Min 8 chars + number"
                    className="input-dark py-2.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Confirm Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="input-dark py-2.5 text-xs"
                  />
                </div>
              </div>

              {/* Password Strength Meter */}
              <div className="space-y-1.5 pt-0.5">
                <div className="flex gap-1.5 h-1.5">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={`flex-1 rounded-full transition-colors ${
                        pwStrength.score >= step ? pwStrength.color : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span
                    className={
                      pwStrength.valid ? 'text-emerald-300 font-semibold' : 'text-slate-400'
                    }
                  >
                    {pwStrength.label}
                  </span>
                  {pwStrength.valid && (
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                      <CheckCircle2 className="h-3 w-3" /> Ready
                    </span>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3 text-sm font-bold shadow-lg shadow-emerald-500/20"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Create Secure Uploader Account
              </button>
            </form>
          )}

          {/* Security Assurances Footer */}
          <div className="pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>PBKDF2-SHA256 (210k rounds) + Lockout</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <span>Strict Owner-Only Venue Write Isolation</span>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-500 z-10">
        Navigator Spatial Operations & Creator Vault
      </div>
    </div>
  );
};

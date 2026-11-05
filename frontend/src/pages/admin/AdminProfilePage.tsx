import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  Camera,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  Map as MapIcon,
  MapPin,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import {
  changeAdminPassword,
  getMyProfile,
  revokeOtherSessions,
  updateMyProfile,
} from '../../lib/api';
import { ErrorState } from '../../components/ErrorState';
import { VenueTypeBadge } from '../../components/StatusChip';
import { useAdminVenue } from './adminVenueContext';
import type { UploaderProfileResponse } from '../../lib/types';

const AVATAR_SWATCHES = [
  '#0ea5e9',
  '#4f46e5',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#ef4444',
];

export const AdminProfilePage: React.FC = () => {
  const { setSelectedSlug, refreshVenues } = useAdminVenue();

  const [profile, setProfile] = useState<UploaderProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit profile state
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [bio, setBio] = useState('');
  const [avatarColor, setAvatarColor] = useState('#0ea5e9');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);

  // Password vault state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMyProfile();
      setProfile(data);
      setName(data.user.name || '');
      setOrganization(data.user.organization || '');
      setBio(data.user.bio || '');
      setAvatarColor(data.user.avatar_color || '#0ea5e9');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load creator profile.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingProfile(true);
    setProfileSavedMsg(null);
    try {
      await updateMyProfile({
        name: name.trim(),
        organization: organization.trim(),
        bio: bio.trim(),
        avatar_color: avatarColor,
      });
      await loadProfile();
      await refreshVenues();
      setProfileSavedMsg('Profile identity updated across your venues.');
      setTimeout(() => setProfileSavedMsg(null), 3500);
    } catch (err) {
      setProfileSavedMsg(
        err instanceof Error ? err.message : 'Failed to update profile.',
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecurityMsg(null);
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setSecurityMsg({ type: 'err', text: 'New passwords do not match.' });
      return;
    }
    setChangingPw(true);
    try {
      await changeAdminPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await loadProfile();
      setSecurityMsg({
        type: 'ok',
        text: 'Password updated with 210,000-round PBKDF2-SHA256 & all older device tokens revoked!',
      });
    } catch (err) {
      setSecurityMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Password update failed.',
      });
    } finally {
      setChangingPw(false);
    }
  };

  const handleRevokeSessions = async () => {
    setRevoking(true);
    setSecurityMsg(null);
    try {
      await revokeOtherSessions();
      await loadProfile();
      setSecurityMsg({
        type: 'ok',
        text: 'Token version rotated! Every other browser/device session has been invalidated immediately.',
      });
    } catch (err) {
      setSecurityMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not revoke sessions.',
      });
    } finally {
      setRevoking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="mt-3 text-sm text-slate-500">
          Loading Uploader Profile & Security Vault...
        </p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <ErrorState
        message={error || 'Profile unavailable.'}
        onRetry={() => void loadProfile()}
      />
    );
  }

  const { user, stats, venues } = profile;
  const initials = (user.name || 'U')
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();

  const roleLabel =
    user.role === 'admin'
      ? 'Platform Super-Admin'
      : user.role === 'uploader'
        ? 'Verified Map Creator / Uploader'
        : 'Facility Operations Staff';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Identity Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#070B18] via-[#0E1836] to-[#131F45] p-6 sm:p-8 text-white shadow-xl ring-1 ring-white/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-extrabold text-white shadow-lg ring-2 ring-white/20"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-extrabold tracking-tight">
                  {user.name}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/35">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {roleLabel}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300">
                {user.email}
                {user.organization ? ` · ${user.organization}` : ''}
              </p>
              {user.bio && (
                <p className="text-xs text-cyan-200/90 max-w-xl pt-0.5">
                  "{user.bio}"
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-cyan-200 ring-1 ring-white/15">
              <Lock className="h-3.5 w-3.5 text-emerald-400" />
              Vault Key Version: v{user.token_version ?? 1}
            </div>
            <span className="text-[11px] text-slate-400">
              Owner-isolated map workspace active
            </span>
          </div>
        </div>

        {/* 4 Personal Mapping Impact KPIs */}
        <div className="relative z-10 mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 border-t border-white/10">
          <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Venues Created
            </div>
            <div className="mt-1 font-display text-2xl font-extrabold text-white">
              {stats.venues_created}
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Spots Mapped
            </div>
            <div className="mt-1 font-display text-2xl font-extrabold text-cyan-300">
              {stats.nodes_mapped}
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Photos Uploaded
            </div>
            <div className="mt-1 font-display text-2xl font-extrabold text-emerald-300">
              {stats.photos_uploaded}
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Avg Photo Quality
            </div>
            <div className="mt-1 font-display text-2xl font-extrabold text-amber-300">
              {stats.photos_uploaded > 0
                ? `${Math.round(stats.avg_photo_quality * 100)}%`
                : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Owned / Accessible Venues Portfolio */}
      <div className="card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-extrabold text-slate-950 flex items-center gap-2">
              <MapIcon className="h-5 w-5 text-indigo-600" />
              {user.role === 'admin'
                ? 'All Platform Venues'
                : 'Your Isolated Map Portfolio'}
            </h2>
            <p className="text-xs text-slate-500">
              Only your account (and platform super-admin) can add/edit nodes, blueprints, or photos inside venues you create. No fake sample images are ever added.
            </p>
          </div>
        </div>

        {venues.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center space-y-2">
            <Sparkles className="h-7 w-7 text-indigo-500 mx-auto" />
            <h3 className="font-display text-base font-bold text-slate-900">
              You haven't created a venue map yet
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Use the <strong>"+ New Venue Map"</strong> button in the left sidebar to create a clean blank venue, drop pins on your floorplan, and upload your real photos!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {venues.map((v) => (
              <div
                key={v.id}
                className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/80 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <VenueTypeBadge type={v.type} />
                    <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-cyan-600" />
                      {v.city}
                    </span>
                  </div>
                  <h3 className="font-display text-base font-extrabold text-slate-900">
                    {v.name}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>{v.stats.buildings} Bldgs</span>
                    <span>·</span>
                    <span>{v.stats.floors} Floors</span>
                    <span>·</span>
                    <span>{v.stats.places} Places</span>
                    <span>·</span>
                    <span className="font-semibold text-indigo-600">
                      {v.stats.photos} Photos
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/70">
                  <Link
                    to={`/admin/map-editor?venue=${encodeURIComponent(v.slug)}`}
                    onClick={() => setSelectedSlug(v.slug)}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-600 transition"
                  >
                    <MapIcon className="h-3.5 w-3.5" />
                    Edit Map
                  </Link>
                  <Link
                    to={`/admin/dataset?venue=${encodeURIComponent(v.slug)}`}
                    onClick={() => setSelectedSlug(v.slug)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 transition"
                  >
                    <Camera className="h-3.5 w-3.5 text-cyan-600" />
                    Photos
                  </Link>
                  <Link
                    to={`/v/${v.slug}`}
                    className="inline-flex items-center justify-center rounded-xl bg-white p-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-indigo-600"
                    title="Open public navigator"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Split: Edit Identity + Security & Password Vault */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Edit Creator Identity */}
        <form onSubmit={(e) => void handleSaveProfile(e)} className="card p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <UserCheck className="h-5 w-5 text-indigo-600" />
            <div>
              <h2 className="font-display text-base font-extrabold text-slate-950">
                Uploader Identity & Attribution
              </h2>
              <p className="text-xs text-slate-500">
                Displayed as "Mapped by {name || user.name}" on venues you publish
              </p>
            </div>
          </div>

          {profileSavedMsg && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              {profileSavedMsg}
            </div>
          )}

          <div>
            <label className="label">Display Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label">Organization / Institution</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="e.g., City Hospital Mapping Team"
                className="input pl-9"
              />
            </div>
          </div>

          <div>
            <label className="label">Creator Bio</label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short note about the buildings or campuses you maintain..."
              className="input"
            />
          </div>

          <div>
            <label className="label">Avatar Badge Color</label>
            <div className="flex items-center gap-2 pt-1">
              {AVATAR_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setAvatarColor(hex)}
                  style={{ backgroundColor: hex }}
                  className={`h-7 w-7 rounded-full transition ${
                    avatarColor === hex
                      ? 'ring-2 ring-offset-2 ring-slate-900 scale-110'
                      : 'opacity-75 hover:opacity-100'
                  }`}
                  aria-label={`Select color ${hex}`}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="btn-indigo w-full py-2.5 text-xs font-bold"
          >
            {savingProfile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Creator Profile
          </button>
        </form>

        {/* Account Security & Session Revocation Vault */}
        <div className="card p-6 space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldAlert className="h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="font-display text-base font-extrabold text-slate-950">
                Account Security & Session Vault
              </h2>
              <p className="text-xs text-slate-500">
                Rotate your password or revoke active tokens on other devices
              </p>
            </div>
          </div>

          {securityMsg && (
            <div
              className={`flex items-start gap-2 rounded-xl p-3 text-xs font-semibold ring-1 ${
                securityMsg.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                  : 'bg-rose-50 text-rose-900 ring-rose-200'
              }`}
            >
              {securityMsg.type === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{securityMsg.text}</span>
            </div>
          )}

          <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-3">
            <div>
              <label className="label">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">New Password (8+ chars)</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Letters + numbers"
                  className="input"
                />
              </div>
              <div>
                <label className="label">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="input"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={changingPw}
              className="btn-primary w-full py-2.5 text-xs font-bold"
            >
              {changingPw ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Update Password & Rotate Vault Key
            </button>
          </form>

          <div className="border-t border-slate-100 pt-4 space-y-2.5">
            <div className="text-xs font-bold text-slate-800">
              Signed in on a shared lab PC or another laptop?
            </div>
            <p className="text-xs text-slate-500">
              Rotating your session key increments your account's cryptographic token version (currently <strong>v{user.token_version ?? 1}</strong>), immediately logging out all other browsers while keeping this session active.
            </p>
            <button
              type="button"
              disabled={revoking}
              onClick={() => void handleRevokeSessions()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-extrabold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-600 hover:text-white transition"
            >
              {revoking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Revoke All Other Device Sessions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

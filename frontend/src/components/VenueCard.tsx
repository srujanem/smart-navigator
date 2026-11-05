import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Building2,
  Camera,
  Layers,
  MapPin,
  Users,
} from 'lucide-react';
import type { VenueSummary } from '../lib/types';
import { VenueTypeBadge } from './StatusChip';

interface VenueCardProps {
  venue: VenueSummary;
  dark?: boolean;
}

export const VenueCard: React.FC<VenueCardProps> = ({ venue, dark = false }) => {
  const accent = venue.accent || '#0ea5e9';
  const peopleLabel =
    venue.type === 'hospital'
      ? 'Doctors'
      : venue.type === 'campus'
        ? 'Faculty'
        : 'Staff';

  return (
    <Link
      to={`/v/${venue.slug}`}
      className={`group relative flex flex-col overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-1 ${
        dark
          ? 'bg-[#0C1428]/90 ring-1 ring-white/10 hover:ring-cyan-400/50 shadow-xl shadow-black/30'
          : 'bg-white ring-1 ring-slate-900/[0.07] hover:ring-indigo-500/40 shadow-soft hover:shadow-lift'
      }`}
    >
      {/* Cover Visual */}
      <div className="relative h-44 w-full overflow-hidden bg-slate-900">
        {venue.cover_url ? (
          <img
            src={venue.cover_url}
            alt={venue.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-90"
          />
        ) : (
          <div
            className="h-full w-full spatial-grid-dark"
            style={{
              background: `radial-gradient(circle at 25% 25%, ${accent}55, transparent 60%), linear-gradient(135deg, #070B18 0%, #111c3a 100%)`,
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#070B18] via-[#070B18]/35 to-transparent" />

        {/* Accent glow bar */}
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ backgroundColor: accent }}
        />

        <div className="absolute left-4 top-4 flex items-center gap-2">
          <VenueTypeBadge type={venue.type} dark />
        </div>

        <div className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/50 backdrop-blur-md px-2.5 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/15">
          <MapPin className="h-3 w-3 text-cyan-400" />
          {venue.city}
        </div>

        <div className="absolute bottom-3 left-4 right-4">
          <h3 className="font-display text-lg font-bold text-white leading-snug group-hover:text-cyan-300 transition-colors">
            {venue.name}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col justify-between p-5">
        <p
          className={`text-sm line-clamp-2 mb-4 ${
            dark ? 'text-slate-300' : 'text-slate-600'
          }`}
        >
          {venue.tagline}
        </p>

        <div>
          {/* Stats Grid */}
          <div
            className={`grid grid-cols-5 gap-1.5 rounded-xl p-2.5 text-center mb-4 ${
              dark
                ? 'bg-white/[0.04] ring-1 ring-white/[0.07]'
                : 'bg-slate-50 ring-1 ring-slate-200/70'
            }`}
          >
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-bold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Building2 className="h-3 w-3 text-cyan-500" />
                {venue.stats.buildings}
              </div>
              <div className="text-[10px] text-slate-400">Bldgs</div>
            </div>
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-bold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Layers className="h-3 w-3 text-indigo-500" />
                {venue.stats.floors}
              </div>
              <div className="text-[10px] text-slate-400">Floors</div>
            </div>
            <div>
              <div
                className={`text-xs font-bold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {venue.stats.places}
              </div>
              <div className="text-[10px] text-slate-400">Places</div>
            </div>
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-bold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Users className="h-3 w-3 text-emerald-500" />
                {venue.stats.people}
              </div>
              <div className="text-[10px] text-slate-400">{peopleLabel}</div>
            </div>
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-bold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Camera className="h-3 w-3 text-amber-500" />
                {venue.stats.photos}
              </div>
              <div className="text-[10px] text-slate-400">Photos</div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-medium ${
                dark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              3D Twin · Photo Locate · A* Route
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-transform group-hover:translate-x-0.5"
              style={{ backgroundColor: accent }}
            >
              Open Navigator
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
};

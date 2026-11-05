import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Building2,
  Camera,
  Cuboid,
  Layers,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { VenueSummary } from '../lib/types';
import { mediaUrl } from '../lib/api';
import { VenueTypeBadge } from './StatusChip';

interface IsometricVenueArtProps {
  accent?: string;
  buildings?: number;
  floors?: number;
  compact?: boolean;
  label?: string;
}

/**
 * Procedural 3D Isometric Architectural Blueprint SVG.
 * Renders a realistic multi-floor architectural wireframe for newly created or
 * zero-photo venues without adding any fake sample dataset images.
 */
export const IsometricVenueArt: React.FC<IsometricVenueArtProps> = ({
  accent = '#0ea5e9',
  buildings = 2,
  floors = 3,
  compact = false,
  label,
}) => {
  const towerCount = Math.max(1, Math.min(buildings || 1, 3));
  const floorCount = Math.max(2, Math.min(floors || 2, 5));

  const towers =
    towerCount === 1
      ? [{ cx: 200, cy: 152, rx: 68, ry: 34, levels: floorCount }]
      : towerCount === 2
        ? [
            { cx: 145, cy: 156, rx: 56, ry: 28, levels: floorCount },
            {
              cx: 262,
              cy: 144,
              rx: 50,
              ry: 25,
              levels: Math.max(2, floorCount - 1),
            },
          ]
        : [
            { cx: 118, cy: 158, rx: 46, ry: 23, levels: Math.max(2, floorCount - 1) },
            { cx: 204, cy: 148, rx: 52, ry: 26, levels: floorCount },
            { cx: 292, cy: 156, rx: 44, ry: 22, levels: Math.max(2, floorCount - 2) },
          ];

  return (
    <div
      className="relative h-full w-full overflow-hidden select-none"
      style={{
        background: `radial-gradient(circle at 28% 22%, ${accent}44, transparent 58%), radial-gradient(circle at 80% 78%, rgba(99,102,241,0.28), transparent 55%), linear-gradient(135deg, #050914 0%, #0D1730 55%, #070C1B 100%)`,
      }}
    >
      <svg
        viewBox="0 0 400 220"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`iso-top-${accent}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.46" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient id={`iso-left-${accent}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id={`iso-right-${accent}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {/* Isometric blueprint ground grid */}
        <g stroke="rgba(148,163,184,0.12)" strokeWidth="0.8">
          {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => (
            <React.Fragment key={i}>
              <line
                x1={200 + i * 38 - 150}
                y1={120 + i * 19 + 75}
                x2={200 + i * 38 + 150}
                y2={120 + i * 19 - 75}
              />
              <line
                x1={200 + i * 38 - 150}
                y1={120 - i * 19 - 75}
                x2={200 + i * 38 + 150}
                y2={120 - i * 19 + 75}
              />
            </React.Fragment>
          ))}
        </g>

        {/* Connecting Skybridge when >= 2 buildings */}
        {towers.length >= 2 && (
          <g>
            <line
              x1={towers[0].cx + 18}
              y1={towers[0].cy - 26}
              x2={towers[1].cx - 18}
              y2={towers[1].cy - 26}
              stroke={accent}
              strokeWidth="5"
              strokeOpacity="0.38"
            />
            <line
              x1={towers[0].cx + 18}
              y1={towers[0].cy - 26}
              x2={towers[1].cx - 18}
              y2={towers[1].cy - 26}
              stroke="#67e8f9"
              strokeWidth="1.4"
              strokeDasharray="4 3"
            />
          </g>
        )}

        {/* Stacked Isometric Glass Towers */}
        {towers.map((t, ti) => {
          const stepH = 16;
          const totalH = t.levels * stepH;
          const topY = t.cy - totalH;
          return (
            <g key={ti}>
              {/* Soft base shadow */}
              <polygon
                points={`${t.cx},${t.cy - t.ry + 6} ${t.cx + t.rx + 6},${t.cy + 6} ${t.cx},${t.cy + t.ry + 6} ${t.cx - t.rx - 6},${t.cy + 6}`}
                fill="rgba(0,0,0,0.45)"
              />

              {/* Left Glass Wall */}
              <polygon
                points={`${t.cx - t.rx},${topY} ${t.cx},${topY + t.ry} ${t.cx},${t.cy + t.ry} ${t.cx - t.rx},${t.cy}`}
                fill={`url(#iso-left-${accent})`}
                stroke={accent}
                strokeOpacity="0.55"
                strokeWidth="1"
              />

              {/* Right Glass Wall */}
              <polygon
                points={`${t.cx},${topY + t.ry} ${t.cx + t.rx},${topY} ${t.cx + t.rx},${t.cy} ${t.cx},${t.cy + t.ry}`}
                fill={`url(#iso-right-${accent})`}
                stroke="#38bdf8"
                strokeOpacity="0.45"
                strokeWidth="1"
              />

              {/* Stacked Interior Floor Slabs */}
              {Array.from({ length: t.levels }).map((_, lvl) => {
                const y = t.cy - lvl * stepH;
                return (
                  <polyline
                    key={lvl}
                    points={`${t.cx - t.rx},${y} ${t.cx},${y + t.ry} ${t.cx + t.rx},${y}`}
                    fill="none"
                    stroke="#bae6fd"
                    strokeOpacity={lvl === t.levels - 1 ? 0.7 : 0.32}
                    strokeWidth="0.9"
                  />
                );
              })}

              {/* Roof Slab */}
              <polygon
                points={`${t.cx},${topY - t.ry} ${t.cx + t.rx},${topY} ${t.cx},${topY + t.ry} ${t.cx - t.rx},${topY}`}
                fill={`url(#iso-top-${accent})`}
                stroke="#e0f2fe"
                strokeOpacity="0.75"
                strokeWidth="1.1"
              />

              {/* Glowing Lift Core Shaft */}
              <line
                x1={t.cx}
                y1={t.cy + 4}
                x2={t.cx}
                y2={topY - 6}
                stroke="#22d3ee"
                strokeWidth="2.2"
                strokeOpacity="0.85"
              />
              <circle cx={t.cx} cy={topY - 6} r="3" fill="#22d3ee" />
            </g>
          );
        })}
      </svg>

      {!compact && (
        <div className="pointer-events-none absolute right-3.5 bottom-12 inline-flex items-center gap-1 rounded-md bg-slate-950/75 px-2 py-0.5 text-[10px] font-mono font-semibold text-cyan-300 ring-1 ring-cyan-400/30 backdrop-blur-md">
          <Cuboid className="h-3 w-3" />
          {label || '3D ARCHITECTURAL TWIN'}
        </div>
      )}
    </div>
  );
};

interface VenueCardProps {
  venue: VenueSummary;
  dark?: boolean;
}

export const VenueCard: React.FC<VenueCardProps> = ({ venue, dark = false }) => {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [tilt, setTilt] = useState<{ rx: number; ry: number; sx: number; sy: number; active: boolean }>({
    rx: 0,
    ry: 0,
    sx: 50,
    sy: 30,
    active: false,
  });

  const accent = venue.accent || '#0ea5e9';
  const peopleLabel =
    venue.type === 'hospital'
      ? 'Doctors'
      : venue.type === 'campus'
        ? 'Faculty'
        : 'Staff';

  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const ry = (px - 0.5) * 8;
    const rx = (0.5 - py) * 7;
    setTilt({
      rx,
      ry,
      sx: Math.round(px * 100),
      sy: Math.round(py * 100),
      active: true,
    });
  };

  const handleMouseLeave = () => {
    setTilt((prev) => ({ ...prev, rx: 0, ry: 0, active: false }));
  };

  return (
    <Link
      ref={cardRef}
      to={`/v/${venue.slug}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: tilt.active
          ? `perspective(1000px) rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg) translateY(-4px)`
          : 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)',
        transition: tilt.active
          ? 'transform 90ms ease-out, box-shadow 250ms ease'
          : 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 300ms ease',
      }}
      className={`group relative flex flex-col overflow-hidden rounded-3xl will-change-transform ${
        dark
          ? 'bg-[#0B1326]/95 ring-1 ring-white/10 hover:ring-cyan-400/55 shadow-2xl shadow-black/45'
          : 'bg-white ring-1 ring-slate-900/[0.08] hover:ring-indigo-500/45 shadow-soft hover:shadow-2xl'
      }`}
    >
      {/* Dynamic Specular Cursor Spotlight */}
      <div
        className="pointer-events-none absolute inset-0 z-20 transition-opacity duration-300"
        style={{
          opacity: tilt.active ? 1 : 0,
          background: `radial-gradient(380px circle at ${tilt.sx}% ${tilt.sy}%, ${
            dark ? 'rgba(56,189,248,0.15)' : 'rgba(99,102,241,0.10)'
          }, transparent 65%)`,
        }}
      />

      {/* Cinema HDR Cover Visual */}
      <div className="relative h-52 w-full overflow-hidden bg-[#060A16]">
        {venue.cover_url ? (
          <>
            <img
              src={mediaUrl(venue.cover_url)}
              alt={venue.name}
              loading="lazy"
              className="h-full w-full object-cover hdr-photo transition-transform duration-700 ease-out group-hover:scale-110"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#050914]/90 via-[#050914]/25 to-transparent" />
          </>
        ) : (
          <IsometricVenueArt
            accent={accent}
            buildings={venue.stats.buildings}
            floors={venue.stats.floors}
          />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#060A16] via-[#060A16]/70 to-transparent" />

        {/* Accent luminous top ribbon */}
        <div
          className="absolute inset-x-0 top-0 h-1.5"
          style={{
            background: `linear-gradient(90deg, ${accent}, #38bdf8, ${accent})`,
          }}
        />

        <div className="absolute left-4 top-4 flex items-center gap-2">
          <VenueTypeBadge type={venue.type} dark />
          {venue.stats.photos > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/20 backdrop-blur-md px-2.5 py-0.5 text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-400/35">
              <Sparkles className="h-2.5 w-2.5 text-emerald-300" />
              Visual AI Ready
            </span>
          )}
        </div>

        <div className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-slate-950/65 backdrop-blur-md px-2.5 py-1 text-[11px] font-semibold text-slate-100 ring-1 ring-white/15">
          <MapPin className="h-3 w-3 text-cyan-400" />
          {venue.city}
        </div>

        <div className="absolute bottom-3.5 left-4 right-4 flex items-end justify-between gap-2">
          <div>
            <h3 className="font-display text-xl font-extrabold text-white leading-tight tracking-tight group-hover:text-cyan-300 transition-colors drop-shadow-sm">
              {venue.name}
            </h3>
          </div>
          {venue.owner_name && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/12 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-cyan-200 ring-1 ring-white/20">
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              {venue.owner_name}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 flex flex-1 flex-col justify-between p-5">
        <p
          className={`text-sm leading-relaxed line-clamp-2 mb-4 ${
            dark ? 'text-slate-300' : 'text-slate-600'
          }`}
        >
          {venue.tagline}
        </p>

        <div>
          {/* Architectural Telemetry Grid */}
          <div
            className={`grid grid-cols-5 gap-1.5 rounded-2xl p-2.5 text-center mb-4 ${
              dark
                ? 'bg-white/[0.04] ring-1 ring-white/[0.08]'
                : 'bg-slate-50/90 ring-1 ring-slate-200/80'
            }`}
          >
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-extrabold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Building2 className="h-3 w-3 text-cyan-500" />
                {venue.stats.buildings}
              </div>
              <div className="text-[10px] font-medium text-slate-400">Bldgs</div>
            </div>
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-extrabold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Layers className="h-3 w-3 text-indigo-500" />
                {venue.stats.floors}
              </div>
              <div className="text-[10px] font-medium text-slate-400">Floors</div>
            </div>
            <div>
              <div
                className={`text-xs font-extrabold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {venue.stats.places}
              </div>
              <div className="text-[10px] font-medium text-slate-400">Places</div>
            </div>
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-extrabold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Users className="h-3 w-3 text-emerald-500" />
                {venue.stats.people}
              </div>
              <div className="text-[10px] font-medium text-slate-400">{peopleLabel}</div>
            </div>
            <div>
              <div
                className={`flex items-center justify-center gap-1 text-xs font-extrabold ${
                  dark ? 'text-white' : 'text-slate-900'
                }`}
              >
                <Camera className="h-3 w-3 text-amber-500" />
                {venue.stats.photos}
              </div>
              <div className="text-[10px] font-medium text-slate-400">Photos</div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="flex items-center justify-between pt-0.5">
            <span
              className={`text-xs font-semibold ${
                dark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              3D Glass Twin · Photo AI · A*
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white shadow-md transition-all duration-300 group-hover:translate-x-0.5 group-hover:shadow-lg"
              style={{
                background: `linear-gradient(135deg, ${accent}, #4f46e5)`,
              }}
            >
              Launch Twin
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
};

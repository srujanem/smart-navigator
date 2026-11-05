import React from 'react';
import {
  ArrowRightLeft,
  Briefcase,
  Clock,
  GraduationCap,
  Hospital,
  ShoppingBag,
  UserX,
} from 'lucide-react';
import type { PersonStatus, VenueType } from '../lib/types';

export const StatusChip: React.FC<{ status: PersonStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'sm',
}) => {
  const pad = size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs';

  switch (status) {
    case 'available':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/25 font-semibold ${pad}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Available
        </span>
      );
    case 'busy':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/25 font-semibold ${pad}`}
        >
          <Clock className="h-3 w-3 text-amber-600" />
          Busy
        </span>
      );
    case 'moved':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/25 font-semibold ${pad}`}
        >
          <ArrowRightLeft className="h-3 w-3 text-sky-600" />
          Moved Location
        </span>
      );
    case 'leave':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/25 font-semibold ${pad}`}
        >
          <UserX className="h-3 w-3 text-rose-600" />
          On Leave
        </span>
      );
  }
};

export const VenueTypeBadge: React.FC<{
  type: VenueType;
  dark?: boolean;
}> = ({ type, dark = false }) => {
  const configs: Record<
    VenueType,
    { label: string; icon: React.ReactNode; lightCls: string; darkCls: string }
  > = {
    hospital: {
      label: 'Hospital',
      icon: <Hospital className="h-3.5 w-3.5" />,
      lightCls: 'bg-rose-50 text-rose-700 ring-rose-200',
      darkCls: 'bg-rose-500/15 text-rose-300 ring-rose-400/30',
    },
    campus: {
      label: 'Campus',
      icon: <GraduationCap className="h-3.5 w-3.5" />,
      lightCls: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
      darkCls: 'bg-indigo-500/15 text-indigo-300 ring-indigo-400/30',
    },
    mall: {
      label: 'Mall & Transit',
      icon: <ShoppingBag className="h-3.5 w-3.5" />,
      lightCls: 'bg-amber-50 text-amber-700 ring-amber-200',
      darkCls: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
    },
    office: {
      label: 'Office Park',
      icon: <Briefcase className="h-3.5 w-3.5" />,
      lightCls: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
      darkCls: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/30',
    },
  };

  const cfg = configs[type] ?? configs.campus;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
        dark ? cfg.darkCls : cfg.lightCls
      }`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
};

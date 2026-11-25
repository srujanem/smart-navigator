import React, { useMemo, useState } from 'react';
import { Check, Copy, Printer, QrCode, X } from 'lucide-react';
import { encodeQrMatrix } from '../lib/qrEncoder';
import { formatLevel } from '../lib/locationStore';
import type { GNode, VenueDetail } from '../lib/types';

interface PrintableQrSheetModalProps {
  open: boolean;
  onClose: () => void;
  venue: VenueDetail;
  nodes: GNode[];
}

export const QrCodeSvg: React.FC<{ value: string; size?: number }> = ({
  value,
  size = 136,
}) => {
  const matrix = useMemo(() => encodeQrMatrix(value), [value]);
  const modCount = matrix.length;
  const quiet = 3;
  const total = modCount + quiet * 2;

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-xl bg-white"
      aria-label={`QR Code for ${value}`}
    >
      <rect width={total} height={total} fill="#ffffff" />
      {matrix.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
              key={`${x}-${y}`}
              x={x + quiet}
              y={y + quiet}
              width={1}
              height={1}
              fill="#0f172a"
            />
          ) : null,
        ),
      )}
    </svg>
  );
};

export const PrintableQrSheetModal: React.FC<PrintableQrSheetModalProps> = ({
  open,
  onClose,
  venue,
  nodes,
}) => {
  const [filter, setFilter] = useState<'checkpoints' | 'all'>('checkpoints');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const displayedNodes = useMemo(() => {
    if (filter === 'all') return nodes;
    const keyOnes = nodes.filter((n) => {
      const k = n.kind.toLowerCase();
      return (
        k.includes('entrance') ||
        k.includes('lift') ||
        k.includes('stair') ||
        k.includes('reception') ||
        n.is_place
      );
    });
    return keyOnes.length > 0 ? keyOnes : nodes;
  }, [nodes, filter]);

  if (!open) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-6 overflow-y-auto print:bg-white print:p-0"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-white p-4 sm:p-6 text-slate-900 shadow-2xl ring-1 ring-slate-200 space-y-4 print:max-h-none print:shadow-none print:ring-0"
      >
        {/* Top Bar (Hidden when printing) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-950">
                Printable Wall QR Checkpoints · {venue.name}
              </h2>
              <p className="text-xs text-slate-500">
                Stick beside entrances, lifts, or doors — visitors scan with any phone camera for instant 100% check-in!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => setFilter('checkpoints')}
                className={`rounded-lg px-2.5 py-1 transition ${
                  filter === 'checkpoints' ? 'bg-slate-900 text-white' : 'text-slate-600'
                }`}
              >
                Places ({nodes.filter((n) => n.is_place).length || nodes.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`rounded-lg px-2.5 py-1 transition ${
                  filter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600'
                }`}
              >
                All ({nodes.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white shadow hover:bg-emerald-500 transition"
            >
              <Printer className="h-4 w-4" />
              <span>Print / PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close QR sheet"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Sticker Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 print:grid-cols-3">
          {displayedNodes.map((nd) => {
            const checkInUrl = `${origin}/v/${encodeURIComponent(venue.slug)}?at=${encodeURIComponent(
              nd.id,
            )}`;
            const isCopied = copiedId === nd.id;

            return (
              <div
                key={nd.id}
                className="flex flex-col items-center justify-between rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-4 text-center space-y-2.5 break-inside-avoid print:bg-white"
              >
                <div className="space-y-0.5">
                  <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                    {venue.name} · Indoor Navigation
                  </div>
                  <div className="font-display text-sm font-extrabold text-slate-950">
                    📍 {nd.name}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-500">
                    {nd.building_name} · {formatLevel(nd.level, nd.floor_name)}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-2 ring-1 ring-slate-200 shadow-sm">
                  <QrCodeSvg value={checkInUrl} size={132} />
                </div>

                <div className="text-[10px] font-bold text-slate-600">
                  Scan Camera → Pick Destination → Walk 360°
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(checkInUrl);
                      setCopiedId(nd.id);
                      window.setTimeout(() => setCopiedId(null), 1800);
                    } catch {
                      // Ignore
                    }
                  }}
                  className="print:hidden inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-extrabold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-600" /> Copied URL
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy QR Link
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

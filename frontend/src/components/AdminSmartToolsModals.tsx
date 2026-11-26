import React, { useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  MousePointerClick,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  SUPABASE_SQL_SETUP,
  getSupabaseConfig,
  saveSupabaseConfig,
} from '../lib/cloudSync';
import {
  type DoorHotspot,
  type ExamAllocationRule,
  addDoorHotspot,
  getVenueExamRules,
  getVenueHotspots,
  parseExamCsvLines,
  removeDoorHotspot,
  saveVenueExamRules,
} from '../lib/examStore';
import { mediaUrl } from '../lib/api';
import type { DatasetNode, GNode } from '../lib/types';

// ============================================================================
// 1. CLOUD SYNC CONFIGURATION MODAL (Supabase + Built-in Relay)
// ============================================================================

export const CloudSyncModal: React.FC<{
  open: boolean;
  onClose: () => void;
  venueName: string;
  onTriggerCloudSync: () => Promise<{ synced: boolean; target: 'supabase' | 'api' | 'local' }>;
}> = ({ open, onClose, venueName, onTriggerCloudSync }) => {
  const existing = getSupabaseConfig();
  const [sbUrl, setSbUrl] = useState(existing?.url || '');
  const [sbKey, setSbKey] = useState(existing?.anonKey || '');
  const [copiedSql, setCopiedSql] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savedMsg, setSavedMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) return null;

  const handleSaveAndSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sbUrl.trim() && sbKey.trim()) {
      saveSupabaseConfig({ url: sbUrl, anonKey: sbKey });
    } else {
      saveSupabaseConfig(null);
    }
    setSyncing(true);
    setSavedMsg(null);
    try {
      const res = await onTriggerCloudSync();
      if (res.synced) {
        setSavedMsg({
          ok: true,
          text: `Synced to ${
            res.target === 'supabase' ? 'Supabase Cloud' : 'Cloud API Relay'
          }! Visitors opening your link on other devices will receive the latest map.`,
        });
      } else {
        setSavedMsg({
          ok: false,
          text: sbUrl.trim()
            ? 'Could not reach Supabase table (verify URL, Anon Key & SQL table setup above). Map remains safely saved in your On-Device Vault.'
            : 'Saved in On-Device Vault. Enter a free Supabase URL + Anon Key above (or use Export Package) to sync across other devices.',
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl bg-white p-5 sm:p-6 text-slate-900 shadow-2xl ring-1 ring-slate-200 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-600 text-white">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-950">
                Cloud Sync · {venueName}
              </h2>
              <p className="text-xs text-slate-500">
                Connect free Supabase for permanent cross-device sync, or use Export Package offline
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSaveAndSync(e)} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Supabase Project URL (Optional — Free Tier)
            </label>
            <input
              type="url"
              value={sbUrl}
              onChange={(e) => setSbUrl(e.target.value)}
              placeholder="https://xyzcompany.supabase.co"
              className="w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 ring-1 ring-slate-200"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Supabase Public Anon Key (Optional)
            </label>
            <input
              type="password"
              value={sbKey}
              onChange={(e) => setSbKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
              className="w-full rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 ring-1 ring-slate-200"
            />
          </div>

          <div className="rounded-2xl bg-slate-950 p-3 text-[11px] text-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-300">
                1-Time Supabase SQL Table Setup:
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(SUPABASE_SQL_SETUP);
                    setCopiedSql(true);
                    window.setTimeout(() => setCopiedSql(false), 1800);
                  } catch {
                    // Ignore
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2 py-1 text-[10px] font-bold text-white"
              >
                {copiedSql ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
                <span>{copiedSql ? 'Copied SQL' : 'Copy SQL'}</span>
              </button>
            </div>
            <pre className="overflow-x-auto text-[10px] text-slate-300 font-mono leading-relaxed">
              {SUPABASE_SQL_SETUP}
            </pre>
          </div>

          {savedMsg && (
            <div
              className={`rounded-xl px-3.5 py-2.5 text-xs font-bold ring-1 ${
                savedMsg.ok
                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  : 'bg-sky-50 text-sky-900 ring-sky-200'
              }`}
            >
              {savedMsg.ok ? '✅ ' : 'ℹ️ '}
              {savedMsg.text}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-5 py-2.5 text-xs font-extrabold text-white shadow"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              <span>Save &amp; Sync Venue Now</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// 2. EXAM USN / EVENT HALL CSV & QUICK ALLOCATION MODAL
// ============================================================================

export const ExamEventManagerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  slug: string;
  venueName: string;
  nodes: GNode[];
  onUpdated?: () => void;
}> = ({ open, onClose, slug, venueName, nodes, onUpdated }) => {
  const csvFileRef = useRef<HTMLInputElement>(null);
  const [rules, setRules] = useState<ExamAllocationRule[]>(() => getVenueExamRules(slug, nodes));
  const [pattern, setPattern] = useState('');
  const [nodeId, setNodeId] = useState(nodes[0]?.id || '');
  const [title, setTitle] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRules(getVenueExamRules(slug, nodes));
      if (!nodeId && nodes[0]) setNodeId(nodes[0].id);
    }
  }, [open, slug, nodes, nodeId]);

  if (!open) return null;

  const persist = (next: ExamAllocationRule[]) => {
    setRules(next);
    saveVenueExamRules(slug, next);
    onUpdated?.();
  };

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const target = nodes.find((n) => n.id === nodeId) ?? nodes[0];
    if (!pattern.trim() || !target) return;
    const item: ExamAllocationRule = {
      id: `ex-${Date.now().toString(36)}`,
      slug,
      pattern: pattern.trim(),
      nodeId: target.id,
      roomName: target.name,
      title: title.trim() || 'Exam / Event Hall',
    };
    persist([item, ...rules]);
    setPattern('');
    setTitle('');
    setFeedback(`Mapped "${item.pattern}" → ${target.name}!`);
  };

  const handleBulkParse = (text: string) => {
    const { added, skipped } = parseExamCsvLines(slug, text, nodes);
    if (added.length > 0) {
      persist([...added, ...rules]);
      setBulkText('');
      setFeedback(
        `Imported ${added.length} exam/event rule(s)${
          skipped.length ? ` (${skipped.length} unmatched room names)` : '!'
        }`,
      );
    } else if (skipped.length > 0) {
      setFeedback(`Could not match room names: ${skipped[0]}`);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-6 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-white p-5 sm:p-6 text-slate-900 shadow-2xl ring-1 ring-slate-200 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-950">
                Exam USN &amp; Event Hall Finder · {venueName}
              </h2>
              <p className="text-xs text-slate-500">
                Map USN ranges (e.g. 4MT23CS001-060) or fest events so students find their exact room in 1 tap
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Quick 1-Row Add */}
        <form
          onSubmit={handleQuickAdd}
          className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200 space-y-2.5"
        >
          <div className="text-xs font-extrabold text-slate-800">
            Quick Add USN Range or Event
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="4MT23CS001-060 or Hackathon"
              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-900 ring-1 ring-slate-200"
            />
            <select
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900 ring-1 ring-slate-200"
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  📍 {n.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Exam / Time (e.g. OS Exam 9:30AM)"
              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-900 ring-1 ring-slate-200"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white shadow hover:bg-indigo-500"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Allocation</span>
          </button>
        </form>

        {/* CSV Upload or Multi-Row Paste */}
        <div className="rounded-2xl bg-cyan-50/60 p-3.5 ring-1 ring-cyan-200 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-cyan-950 flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4 text-cyan-600" />
              Upload CSV Sheet or Paste Rows
            </span>
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) {
                  const txt = await f.text();
                  handleBulkParse(txt);
                }
              }}
            />
            <button
              type="button"
              onClick={() => csvFileRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-[11px] font-extrabold text-white"
            >
              <Upload className="h-3.5 w-3.5 text-cyan-300" />
              <span>Upload .CSV File</span>
            </button>
          </div>
          <textarea
            rows={2}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={`Example:\n4MT23CS001-4MT23CS060, ${nodes[0]?.name || 'Room 101'}, Morning Exam`}
            className="w-full rounded-xl bg-white p-2.5 text-xs font-mono text-slate-800 ring-1 ring-cyan-200"
          />
          {bulkText.trim() && (
            <button
              type="button"
              onClick={() => handleBulkParse(bulkText)}
              className="rounded-xl bg-cyan-600 px-3.5 py-1.5 text-xs font-extrabold text-white"
            >
              Import Pasted Rows
            </button>
          )}
        </div>

        {feedback && (
          <div className="rounded-xl bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
            ✅ {feedback}
          </div>
        )}

        {/* Active Allocations List */}
        <div className="space-y-2">
          <div className="text-xs font-extrabold text-slate-700">
            Active Exam / Event Mappings ({rules.length})
          </div>
          {rules.length === 0 ? (
            <p className="text-xs text-slate-400">No exam or event allocations added yet.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200"
                >
                  <div className="min-w-0">
                    <span className="font-mono font-extrabold text-indigo-700">{r.pattern}</span>
                    <span className="mx-1.5 text-slate-400">→</span>
                    <strong className="text-slate-900">{r.roomName}</strong>
                    <span className="ml-2 text-slate-500">({r.title})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => persist(rules.filter((x) => x.id !== r.id))}
                    className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. CLICK-ON-DOOR 360° HOTSPOT LINKER MODAL
// ============================================================================

export const HotspotEditorModal: React.FC<{
  open: boolean;
  onClose: () => void;
  slug: string;
  room: DatasetNode | null;
  allNodes: GNode[];
}> = ({ open, onClose, slug, room, allNodes }) => {
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const [hotspots, setHotspots] = useState<DoorHotspot[]>(() =>
    getVenueHotspots(slug, allNodes),
  );
  const [pendingPt, setPendingPt] = useState<{ xPct: number; yPct: number } | null>(null);
  const [targetId, setTargetId] = useState<string>('');

  React.useEffect(() => {
    if (open && room) {
      setHotspots(getVenueHotspots(slug, allNodes));
      const other = allNodes.find((n) => n.id !== room.node_id) ?? allNodes[0];
      setTargetId(other?.id || '');
      setPendingPt(null);
    }
  }, [open, slug, room, allNodes]);

  if (!open || !room) return null;

  const photo = room.photos[0];
  const roomHotspots = hotspots.filter((h) => h.fromNodeId === room.node_id);
  const destinationOptions = allNodes.filter((n) => n.id !== room.node_id);

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = imgBoxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xPct = Math.max(4, Math.min(96, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const yPct = Math.max(12, Math.min(88, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    setPendingPt({ xPct, yPct });
  };

  const handleSaveHotspot = () => {
    if (!pendingPt || !targetId) return;
    const targetNode = allNodes.find((n) => n.id === targetId);
    if (!targetNode) return;
    const updated = addDoorHotspot(
      slug,
      {
        fromNodeId: room.node_id,
        toNodeId: targetNode.id,
        toName: targetNode.name,
        xPct: pendingPt.xPct,
        yPct: pendingPt.yPct,
      },
      allNodes,
    );
    setHotspots(updated);
    setPendingPt(null);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-6 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-slate-200 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <MousePointerClick className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-extrabold text-slate-950">
                Link 360° Door Hotspots · {room.name}
              </h2>
              <p className="text-xs text-slate-500">
                Tap any door or hallway in the image below to place a clickable Street View portal arrow!
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {photo ? (
          <div
            ref={imgBoxRef}
            onClick={handleImageClick}
            className="relative h-60 sm:h-72 w-full overflow-hidden rounded-2xl bg-slate-900 cursor-crosshair ring-2 ring-indigo-500/40 select-none"
          >
            <img
              src={mediaUrl(photo.url)}
              alt={room.name}
              className="h-full w-full object-cover object-center pointer-events-none"
            />

            {roomHotspots.map((hs) => (
              <div
                key={hs.id}
                style={{ left: `${hs.xPct}%`, top: `${hs.yPct}%` }}
                onClick={(e) => e.stopPropagation()}
                className="-translate-x-1/2 -translate-y-1/2 absolute inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-black text-slate-950 shadow-xl ring-2 ring-white"
              >
                <span>🚪 {hs.toName}</span>
                <button
                  type="button"
                  onClick={() => setHotspots(removeDoorHotspot(slug, hs.id, allNodes))}
                  className="ml-0.5 rounded-full bg-slate-950/20 p-0.5 hover:bg-rose-600 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            {pendingPt && (
              <div
                style={{ left: `${pendingPt.xPct}%`, top: `${pendingPt.yPct}%` }}
                className="pointer-events-none -translate-x-1/2 -translate-y-1/2 absolute h-7 w-7 rounded-full border-4 border-amber-300 bg-amber-400/50 animate-ping"
              />
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-50 p-6 text-center text-xs text-slate-500">
            Upload a photo or 360° panorama for {room.name} first to place door hotspots.
          </div>
        )}

        {pendingPt && destinationOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
            <span className="text-xs font-extrabold text-emerald-950">
              Door leads to:
            </span>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="flex-1 min-w-[140px] rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900 ring-1 ring-emerald-300"
            >
              {destinationOptions.map((nd) => (
                <option key={nd.id} value={nd.id}>
                  📍 {nd.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSaveHotspot}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white shadow hover:bg-emerald-500"
            >
              Place Door Portal
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

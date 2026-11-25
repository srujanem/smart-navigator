/**
 * Exam USN / Roll-Number & Campus Event Hall Allocation Engine
 * + Click-on-Door 360° Street View Hotspot Store.
 */

import type { GNode } from './types';

export interface ExamAllocationRule {
  id: string;
  slug: string;
  /** Exact USN / Event name OR range like "4MT23CS001-4MT23CS060" */
  pattern: string;
  nodeId: string;
  roomName: string;
  title: string;
  seatHint?: string;
}

export interface ExamLookupHit {
  rule: ExamAllocationRule;
  matchedQuery: string;
  computedSeat: string | null;
}

export interface DoorHotspot {
  id: string;
  slug: string;
  fromNodeId: string;
  toNodeId: string;
  toName: string;
  /** Horizontal position across the image/panorama (0..100%) */
  xPct: number;
  /** Vertical position on the image/panorama (10..90%) */
  yPct: number;
}

const EXAMS_STORAGE_KEY = 'navigator_exam_allocations_v1';
const HOTSPOTS_STORAGE_KEY = 'navigator_door_hotspots_v1';

function readJsonMap<T>(key: string): Record<string, T[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T[]>) : {};
  } catch {
    return {};
  }
}

function writeJsonMap<T>(key: string, val: Record<string, T[]>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // Ignore storage quota errors
  }
}

export function getVenueExamRules(slug: string, nodes: GNode[] = []): ExamAllocationRule[] {
  const map = readJsonMap<ExamAllocationRule>(EXAMS_STORAGE_KEY);
  if (map[slug] && map[slug].length > 0) {
    return map[slug];
  }

  // Pre-seed realistic Exam USN ranges & Tech-Fest events on bundled MITE campus!
  if (slug === 'mite' && nodes.length > 0) {
    const findRoom = (sub: string) =>
      nodes.find((n) => n.name.toLowerCase().includes(sub)) ?? nodes.find((n) => n.is_place) ?? nodes[0];
    const r308 = findRoom('308');
    const r304 = findRoom('304');
    const r301 = findRoom('301');
    if (r308 && r304 && r301) {
      return [
        {
          id: 'mite-ex-1',
          slug: 'mite',
          pattern: '4MT23CS001-4MT23CS060',
          nodeId: r308.id,
          roomName: r308.name,
          title: 'CSE Semester Exam · 9:30 AM',
        },
        {
          id: 'mite-ex-2',
          slug: 'mite',
          pattern: '4MT23AI001-4MT23AI060',
          nodeId: r304.id,
          roomName: r304.name,
          title: 'AI & ML Lab Viva · 10:00 AM',
        },
        {
          id: 'mite-ex-3',
          slug: 'mite',
          pattern: 'Coding Hackathon',
          nodeId: r301.id,
          roomName: r301.name,
          title: 'Sentia TechFest Hackathon',
          seatHint: 'Desk Cluster A',
        },
      ];
    }
  }
  return map[slug] ?? [];
}

export function saveVenueExamRules(slug: string, rules: ExamAllocationRule[]): void {
  const map = readJsonMap<ExamAllocationRule>(EXAMS_STORAGE_KEY);
  map[slug] = rules;
  writeJsonMap(EXAMS_STORAGE_KEY, map);
}

/**
 * Parses CSV / TSV / pasted lines into ExamAllocationRules:
 *   Format: `USN_or_Range_or_Event, Room Name, Optional Exam Title, Optional Seat`
 *   Example:
 *     4MT23CS001-4MT23CS060, Room 308, Data Structures Exam
 *     4MT23CS061, AI Lab 201, OS Lab Exam, Seat B4
 */
export function parseExamCsvLines(
  slug: string,
  rawText: string,
  nodes: GNode[],
): { added: ExamAllocationRule[]; skipped: string[] } {
  const added: ExamAllocationRule[] = [];
  const skipped: string[] = [];
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  for (const line of lines) {
    const parts = line.split(/[,|\t]/).map((p) => p.trim());
    if (parts.length < 2) {
      skipped.push(line);
      continue;
    }
    // Skip header row if detected
    if (/^(usn|roll|register|student|pattern)\b/i.test(parts[0]) && /room|hall/i.test(parts[1])) {
      continue;
    }

    const [pattern, roomToken, titleRaw, seatRaw] = parts;
    const roomLow = roomToken.toLowerCase();
    const matchedNode =
      nodes.find((n) => n.name.trim().toLowerCase() === roomLow) ??
      nodes.find((n) => n.name.toLowerCase().includes(roomLow) || roomLow.includes(n.name.toLowerCase()));

    if (!matchedNode) {
      skipped.push(`${pattern} → "${roomToken}" (room not found)`);
      continue;
    }

    added.push({
      id: `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      slug,
      pattern,
      nodeId: matchedNode.id,
      roomName: matchedNode.name,
      title: titleRaw || 'Exam / Event Hall',
      seatHint: seatRaw || undefined,
    });
  }

  return { added, skipped };
}

function parseAlnumCode(code: string): { prefix: string; num: number; digits: number } | null {
  const m = code.trim().toUpperCase().match(/^([A-Z0-9]*?[A-Z])(\d{1,5})$/);
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10), digits: m[2].length };
}

/**
 * Matches a visitor's USN / Roll Number / Event search against exact rules & USN ranges!
 */
export function lookupExamOrEvent(
  query: string,
  rules: ExamAllocationRule[],
): ExamLookupHit[] {
  const q = query.trim();
  if (q.length < 2 || rules.length === 0) return [];
  const qUp = q.toUpperCase();
  const qLow = q.toLowerCase();
  const parsedQ = parseAlnumCode(qUp);

  const hits: ExamLookupHit[] = [];

  for (const rule of rules) {
    const pat = rule.pattern.trim();
    // Check range syntax: e.g. "4MT23CS001-4MT23CS060" or "4MT23CS001-060"
    if (pat.includes('-') && parsedQ) {
      const [startRaw, endRaw] = pat.split('-').map((s) => s.trim().toUpperCase());
      const startCode = parseAlnumCode(startRaw);
      let endNum: number | null = null;
      if (startCode) {
        const fullEnd = parseAlnumCode(endRaw);
        if (fullEnd && fullEnd.prefix === startCode.prefix) {
          endNum = fullEnd.num;
        } else if (/^\d+$/.test(endRaw)) {
          endNum = parseInt(endRaw, 10);
        }
        if (
          endNum !== null &&
          parsedQ.prefix === startCode.prefix &&
          parsedQ.num >= startCode.num &&
          parsedQ.num <= endNum
        ) {
          const seatIdx = parsedQ.num - startCode.num + 1;
          hits.push({
            rule,
            matchedQuery: qUp,
            computedSeat: rule.seatHint || `Seat #${seatIdx}`,
          });
          continue;
        }
      }
    }

    // Exact or substring match on USN or Event title
    if (
      pat.toLowerCase().includes(qLow) ||
      qLow.includes(pat.toLowerCase()) ||
      rule.title.toLowerCase().includes(qLow)
    ) {
      hits.push({
        rule,
        matchedQuery: q,
        computedSeat: rule.seatHint || null,
      });
    }
  }

  return hits.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Click-on-Door 360° Street View Hotspot Store
// ---------------------------------------------------------------------------

export function getVenueHotspots(slug: string, nodes: GNode[] = []): DoorHotspot[] {
  const map = readJsonMap<DoorHotspot>(HOTSPOTS_STORAGE_KEY);
  if (map[slug] && map[slug].length > 0) {
    return map[slug];
  }
  // Seed helpful clickable door portals on bundled MITE corridor views
  if (slug === 'mite' && nodes.length > 0) {
    const cor = nodes.find((n) => n.name.toLowerCase().includes('corridor'));
    const r308 = nodes.find((n) => n.name.toLowerCase().includes('308'));
    const r301 = nodes.find((n) => n.name.toLowerCase().includes('301'));
    if (cor && r308 && r301) {
      return [
        {
          id: 'mite-hs-308',
          slug: 'mite',
          fromNodeId: cor.id,
          toNodeId: r308.id,
          toName: r308.name,
          xPct: 32,
          yPct: 48,
        },
        {
          id: 'mite-hs-301',
          slug: 'mite',
          fromNodeId: cor.id,
          toNodeId: r301.id,
          toName: r301.name,
          xPct: 68,
          yPct: 48,
        },
      ];
    }
  }
  return map[slug] ?? [];
}

export function saveVenueHotspots(slug: string, hotspots: DoorHotspot[]): void {
  const map = readJsonMap<DoorHotspot>(HOTSPOTS_STORAGE_KEY);
  map[slug] = hotspots;
  writeJsonMap(HOTSPOTS_STORAGE_KEY, map);
}

export function addDoorHotspot(
  slug: string,
  hotspot: Omit<DoorHotspot, 'id' | 'slug'>,
  nodes: GNode[] = [],
): DoorHotspot[] {
  const current = getVenueHotspots(slug, nodes);
  const created: DoorHotspot = {
    ...hotspot,
    id: `hs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    slug,
  };
  const next = [...current, created];
  saveVenueHotspots(slug, next);
  return next;
}

export function removeDoorHotspot(slug: string, hotspotId: string, nodes: GNode[] = []): DoorHotspot[] {
  const current = getVenueHotspots(slug, nodes).filter((h) => h.id !== hotspotId);
  saveVenueHotspots(slug, current);
  return current;
}

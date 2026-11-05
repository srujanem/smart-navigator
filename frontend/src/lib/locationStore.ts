import { useCallback, useEffect, useState } from 'react';

export interface SavedVisitorLocation {
  nodeId: string;
  name: string;
  buildingName: string;
  level: number;
  floorName?: string;
  source: 'photo' | 'manual';
  updatedAt: number;
}

const EVENT_NAME = 'navigator:location-changed';

function storageKey(slug: string): string {
  return `navigator_visitor_loc_${slug}`;
}

export function getSavedLocation(slug: string): SavedVisitorLocation | null {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return null;
    return JSON.parse(raw) as SavedVisitorLocation;
  } catch {
    return null;
  }
}

export function saveVisitorLocation(slug: string, loc: SavedVisitorLocation | null): void {
  try {
    if (!loc) {
      localStorage.removeItem(storageKey(slug));
    } else {
      localStorage.setItem(storageKey(slug), JSON.stringify(loc));
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { slug } }));
  } catch {
    // Ignore storage failures
  }
}

export function useVisitorLocation(slug: string | undefined) {
  const [location, setLocationState] = useState<SavedVisitorLocation | null>(() =>
    slug ? getSavedLocation(slug) : null,
  );

  useEffect(() => {
    if (!slug) {
      setLocationState(null);
      return;
    }
    setLocationState(getSavedLocation(slug));

    const handleChange = () => {
      setLocationState(getSavedLocation(slug));
    };

    window.addEventListener(EVENT_NAME, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(EVENT_NAME, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, [slug]);

  const setLocation = useCallback(
    (loc: SavedVisitorLocation | null) => {
      if (!slug) return;
      saveVisitorLocation(slug, loc);
      setLocationState(loc);
    },
    [slug],
  );

  return { location, setLocation };
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '< 1 min';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins >= 10 || rem < 10) return `${mins} min`;
  return `${mins} min ${rem}s`;
}

export function formatLevel(level: number, floorName?: string): string {
  if (floorName && floorName.trim()) return floorName;
  if (level === 0) return 'Ground Floor';
  if (level < 0) return `Basement ${Math.abs(level)}`;
  return `Floor ${level}`;
}

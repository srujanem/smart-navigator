import { createContext, useContext } from 'react';
import type { VenueSummary } from '../../lib/types';

export interface AdminVenueContextValue {
  venues: VenueSummary[];
  selectedSlug: string;
  selectedVenue: VenueSummary | null;
  setSelectedSlug: (slug: string) => void;
  refreshVenues: () => Promise<void>;
}

export const AdminVenueContext = createContext<AdminVenueContextValue>({
  venues: [],
  selectedSlug: '',
  selectedVenue: null,
  setSelectedSlug: () => {},
  refreshVenues: async () => {},
});

export function useAdminVenue(): AdminVenueContextValue {
  return useContext(AdminVenueContext);
}

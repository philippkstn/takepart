import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

export interface PublicConfig {
  imprintUrl: string | null;
  privacyUrl: string | null;
  sourceUrl: string;
  /** Teams-App auf diesem Server eingeschaltet (TEAMS_APP) */
  teams: boolean;
}

/** Fußzeilen-Links kommen vom Server – jede Instanz verlinkt ihr eigenes Impressum. */
export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => api<PublicConfig>('/api/config'), staleTime: Infinity }).data;
}

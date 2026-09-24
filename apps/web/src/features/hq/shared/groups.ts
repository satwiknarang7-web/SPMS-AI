'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface HqGroup { id: string; name: string; priority: number; description: string | null; createdAt: string; members: { id: string; code: string; name: string }[]; rankingBasis: string | null }

export function useGroups() {
  return useQuery({ queryKey: ['hq', 'groups'], queryFn: () => api.get<HqGroup[]>('/hq/groups') });
}

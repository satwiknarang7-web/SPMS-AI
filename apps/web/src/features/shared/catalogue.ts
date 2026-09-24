'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useCategories() {
  return useQuery({ queryKey: ['catalogue', 'categories'], queryFn: () => api.get<{ category: string; count: number }[]>('/platform/catalogue/categories'), staleTime: 300_000 });
}

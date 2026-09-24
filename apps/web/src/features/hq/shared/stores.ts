'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Store { id: string; code: string; name: string; status: string }

export const useStores = () => useQuery({ queryKey: ['hq', 'stores'], queryFn: () => api.get<Store[]>('/hq/stores') });

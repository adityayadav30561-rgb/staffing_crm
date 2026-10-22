import { useQuery } from '@tanstack/react-query';
import type { LookupKind, Settings } from '@crm/shared';
import { api } from './api';
import type { Lookup, User } from './types';

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users'), staleTime: 60_000 });
}

export function useLookups() {
  return useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookup[]>('/lookups'), staleTime: 5 * 60_000 });
}

export function useLookup(kind: LookupKind | undefined) {
  const { data } = useLookups();
  return (data ?? []).filter((l) => l.kind === kind && l.active);
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings'), staleTime: 5 * 60_000 });
}

export interface Counts {
  open: number;
  overdue: number;
  dueToday: number;
  unreadNotifications: number;
}
export function useCounts() {
  return useQuery({ queryKey: ['counts'], queryFn: () => api.get<Counts>('/tasks/counts'), refetchInterval: 60_000 });
}

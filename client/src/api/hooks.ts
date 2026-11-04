import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, qs, type ApiError, type RiderIdentity } from './client';
import { useToast } from '../components/ui/Toast';
import type {
  Assignment,
  Dashboard,
  FitResult,
  Integrity,
  Job,
  JobDetail,
  JobEvent,
  Meta,
  Page,
  Recommendation,
  Rider,
  SystemConfig,
} from './types';

const POLL = 4000;

export const useMeta = () =>
  useQuery({
    queryKey: ['meta'],
    queryFn: () => api.get<{ data: Meta }>('/meta').then((r) => r.data),
    staleTime: Infinity,
  });
export const useDashboard = () =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<{ data: Dashboard }>('/dashboard').then((r) => r.data),
    refetchInterval: POLL,
  });
export const useSystemConfig = () =>
  useQuery({
    queryKey: ['system-config'],
    queryFn: () => api.get<{ data: SystemConfig }>('/system/config').then((r) => r.data),
    refetchInterval: POLL,
  });
export const useIntegrity = () =>
  useQuery({
    queryKey: ['integrity'],
    queryFn: () => api.get<{ data: Integrity }>('/system/integrity').then((r) => r.data),
    refetchInterval: 10_000,
  });

export interface JobFilters {
  q?: string;
  status?: string;
  zone?: string;
  priority?: string;
  attention?: boolean;
  page?: number;
  sort?: string;
}
export const useJobs = (f: JobFilters) =>
  useQuery({
    queryKey: ['jobs', f],
    queryFn: () => api.get<Page<Job>>(`/jobs${qs({ ...f, limit: 15 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: POLL,
  });
export const useJob = (id: string) =>
  useQuery({
    queryKey: ['job', id],
    queryFn: () => api.get<{ data: JobDetail }>(`/jobs/${id}`).then((r) => r.data),
    refetchInterval: POLL,
  });
export const useJobEvents = (id: string) =>
  useQuery({
    queryKey: ['job', id, 'events'],
    queryFn: () => api.get<{ data: JobEvent[] }>(`/jobs/${id}/events`).then((r) => r.data),
    refetchInterval: POLL,
  });
export const useJobAssignments = (id: string) =>
  useQuery({
    queryKey: ['job', id, 'assignments'],
    queryFn: () => api.get<{ data: Assignment[] }>(`/jobs/${id}/assignments`).then((r) => r.data),
    refetchInterval: POLL,
  });
export const useRecommendations = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['job', id, 'recommendations'],
    queryFn: () =>
      api.get<{ data: Recommendation }>(`/jobs/${id}/recommendations`).then((r) => r.data),
    enabled,
    refetchInterval: POLL,
  });
export const useRiders = () =>
  useQuery({
    queryKey: ['riders'],
    queryFn: () => api.get<{ data: Rider[] }>('/riders').then((r) => r.data),
    refetchInterval: POLL,
  });
export const useManualQueue = () =>
  useQuery({
    queryKey: ['manual-queue'],
    queryFn: () =>
      api.get<{ data: (Job & { failedAttempts: number })[] }>('/manual-queue').then((r) => r.data),
    refetchInterval: POLL,
  });
export const useFit = (
  riderId: string,
  params: { pickupZone: string; deliveryZone: string; load: number },
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['fit', riderId, params],
    queryFn: () =>
      api.get<{ data: FitResult }>(`/riders/${riderId}/fit${qs(params)}`).then((r) => r.data),
    enabled,
  });

interface ActionOptions<T> {
  success?: string | ((result: T) => string);
  onSuccess?: (result: T) => void;
}

export function useAction<V, T = unknown>(
  fn: (vars: V) => Promise<T>,
  opts: ActionOptions<T> = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<T, ApiError, V>({
    mutationFn: fn,
    onSuccess: (result) => {
      void qc.invalidateQueries();
      const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
      if (message) toast.success(message);
      opts.onSuccess?.(result);
    },
    onError: (err) => {
      void qc.invalidateQueries();
      toast.error(err.message, err.code);
    },
  });
}

export { api, type RiderIdentity };

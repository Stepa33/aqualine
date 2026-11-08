import { createClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import type { Box, Service, Studio, WorkPhoto } from './schema';
import { addDays, type BusyLite, type Hours, zoned } from './schedule';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export type StudioBundle = { studio: Studio; boxes: Box[]; services: Service[]; photos: WorkPhoto[]; hours: Hours };

export const photoUrl = (path: string) => (path ? supabase.storage.from('studio-photos').getPublicUrl(path).data.publicUrl : '');

export function useStudio(slug: string) {
  return useQuery({
    queryKey: ['studio', slug],
    staleTime: 60_000,
    queryFn: async (): Promise<StudioBundle | null> => {
      const { data: studio, error } = await supabase.from('studios').select('id, slug, status, tz, settings').eq('slug', slug).maybeSingle();
      if (error) throw error;
      if (!studio) return null;
      const [boxes, services, photos] = await Promise.all([
        supabase.from('boxes').select('*').eq('studio_id', studio.id).eq('active', true).order('sort'),
        supabase.from('services').select('*').eq('studio_id', studio.id).eq('active', true).order('sort'),
        supabase.from('work_photos').select('*').eq('studio_id', studio.id).order('sort'),
      ]);
      const s = studio as Studio;
      return {
        studio: s, boxes: (boxes.data ?? []) as Box[], services: (services.data ?? []) as Service[], photos: (photos.data ?? []) as WorkPhoto[],
        hours: { open: s.settings.open, close: s.settings.close, daysOff: s.settings.daysOff, holidays: s.settings.holidays, bufferMin: s.settings.bufferMin, stepMin: s.settings.stepMin, tz: s.tz },
      };
    },
  });
}

/** Busy time for the next weeks, without any personal data. Refreshes every 30 s. */
export function useBusy(slug: string, hours: Hours | undefined, fromDate: string) {
  return useQuery({
    queryKey: ['busy', slug, fromDate],
    enabled: !!hours,
    refetchInterval: 30_000,
    queryFn: async (): Promise<BusyLite[]> => {
      const { data, error } = await supabase.rpc('get_busy', {
        p_slug: slug, p_from: zoned(hours!, addDays(fromDate, -1), 0), p_to: zoned(hours!, addDays(fromDate, 22), 0),
      });
      if (error) throw error;
      return (data ?? []) as BusyLite[];
    },
  });
}

export async function api<T>(path: string, body: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.message || json.error || 'request_failed'), { code: json.error, status: r.status });
  return json as T;
}

/* Things kept on the client's device: booking keys and last contact details. */
const KEY = (slug: string) => `bookings:${slug}`;
export const myTokens = (slug: string): { id: string; token: string }[] => { try { return JSON.parse(localStorage.getItem(KEY(slug)) || '[]'); } catch { return []; } };
export const saveToken = (slug: string, id: string, token: string) => {
  const l = myTokens(slug).filter((x) => x.id !== id); l.push({ id, token });
  try { localStorage.setItem(KEY(slug), JSON.stringify(l.slice(-50))); } catch { /* private mode */ }
};
export const contact = { get: () => { try { return JSON.parse(localStorage.getItem('contact') || '{}'); } catch { return {}; } }, set: (c: object) => { try { localStorage.setItem('contact', JSON.stringify(c)); } catch { /* ignore */ } } };

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Box, Service, Studio } from '../../src/lib/schema.js';
import type { Hours } from '../../src/lib/schedule.js';

let admin: SupabaseClient | null = null;
/** Service-role client. Never sent to the browser; every query below filters by studio. */
export function db(): SupabaseClient {
  if (!admin) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
    admin = createClient(url, key, { auth: { persistSession: false } });
  }
  return admin;
}

export type Bundle = { studio: Studio; boxes: Box[]; services: Service[]; hours: Hours };

export async function loadStudio(slug: string): Promise<Bundle | null> {
  const { data: studio } = await db().from('studios').select('id, slug, status, tz, settings').eq('slug', slug).maybeSingle();
  if (!studio) return null;
  const [{ data: boxes }, { data: services }] = await Promise.all([
    db().from('boxes').select('*').eq('studio_id', studio.id).eq('active', true).order('sort'),
    db().from('services').select('*').eq('studio_id', studio.id).eq('active', true).order('sort'),
  ]);
  return { studio: studio as Studio, boxes: (boxes ?? []) as Box[], services: (services ?? []) as Service[], hours: hoursOf(studio as Studio) };
}

export const hoursOf = (s: Studio): Hours => ({
  open: s.settings.open, close: s.settings.close, daysOff: s.settings.daysOff, holidays: s.settings.holidays,
  bufferMin: s.settings.bufferMin, stepMin: s.settings.stepMin, tz: s.tz,
});

export async function busyFor(studioId: string, fromIso: string, toIso: string) {
  const { data, error } = await db().from('bookings').select('box_id, starts_at, blocked_until')
    .eq('studio_id', studioId).in('status', ['new', 'accepted', 'done'])
    .lt('starts_at', toIso).gt('blocked_until', fromIso);
  if (error) throw error;
  return data ?? [];
}

/** The owner's identity from the browser's Supabase session token. */
export async function ownerOf(req: VercelRequest, studioId: string): Promise<boolean> {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data } = await db().auth.getUser(token);
  if (!data.user) return false;
  const { data: s } = await db().from('studios').select('id').eq('id', studioId).eq('owner_id', data.user.id).maybeSingle();
  return !!s;
}

export function clientKey(req: VercelRequest): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return fwd || String(req.socket?.remoteAddress ?? 'unknown');
}

export function only(method: string, req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ error: 'method_not_allowed' });
  return false;
}

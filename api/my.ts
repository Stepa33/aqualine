import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db, only } from './_lib/server.js';

const Body = z.object({ slug: z.string(), tokens: z.array(z.string().uuid()).max(50) });

/** A client's own bookings, found by the keys saved on their device. No other data is returned. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!only('POST', req, res)) return;
  const p = Body.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid' });
  if (!p.data.tokens.length) return res.status(200).json({ bookings: [] });
  const { data: studio } = await db().from('studios').select('id').eq('slug', p.data.slug).maybeSingle();
  if (!studio) return res.status(404).json({ error: 'studio_not_found' });
  const { data, error } = await db().from('bookings')
    .select('id, client_token, service_name, price, starts_at, ends_at, status, car, boxes(name)')
    .eq('studio_id', studio.id).in('client_token', p.data.tokens).order('starts_at');
  if (error) return res.status(500).json({ error: 'load_failed' });
  return res.status(200).json({ bookings: data });
}

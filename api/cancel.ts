import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db, only } from './_lib/server.js';
import { esc, notifyOwners, when } from './_lib/telegram.js';

const Body = z.object({ id: z.string().uuid(), token: z.string().uuid() });

/** Client cancels their own booking, if the studio's rule allows (not later than N hours before). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!only('POST', req, res)) return;
  const p = Body.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid' });
  const { data: b } = await db().from('bookings').select('id, studio_id, status, starts_at, service_name, client_name, client_phone, studios(settings, tz)')
    .eq('id', p.data.id).eq('client_token', p.data.token).maybeSingle();
  if (!b) return res.status(404).json({ error: 'not_found' });
  if (b.status !== 'new' && b.status !== 'accepted') return res.status(409).json({ error: 'not_cancellable', message: 'Эту запись уже нельзя отменить' });
  const studio = (Array.isArray(b.studios) ? b.studios[0] : b.studios) as { settings: { cancelHours: number }; tz: string } | null;
  const hours = studio?.settings.cancelHours ?? 2;
  if (Date.parse(b.starts_at) - Date.now() < hours * 3_600_000) {
    return res.status(409).json({ error: 'too_late', message: `Отменить можно не позже чем за ${hours} ч. Позвоните в студию.` });
  }
  const { error } = await db().from('bookings').update({ status: 'cancelled' }).eq('id', b.id).eq('client_token', p.data.token);
  if (error) return res.status(500).json({ error: 'save_failed' });
  await notifyOwners(b.studio_id, `❌ <b>Клиент отменил запись</b>\n${esc(b.service_name)} · ${when(b.starts_at, studio?.tz ?? 'Europe/Kyiv')}\n${esc(b.client_name)} · ${esc(b.client_phone)}`).catch(() => undefined);
  return res.status(200).json({ ok: true });
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { BookRequest } from '../src/lib/schema.js';
import { createBooking } from './_lib/booking.js';
import { loadStudio, only } from './_lib/server.js';
import { notifyNewBooking, verifyInitData } from './_lib/telegram.js';

const Body = BookRequest.extend({ tgInitData: z.string().max(4096).optional() });

/** Booking from the website (also when it is opened inside Telegram as a Mini App). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!only('POST', req, res)) return;
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', message: parsed.error.issues[0]?.message });
  const r = parsed.data;
  const b = await loadStudio(r.slug);
  if (!b) return res.status(404).json({ error: 'studio_not_found' });

  // Opened from the studio's Telegram bot: link the booking to the chat for reminders and "Мои записи".
  const tgUser = r.tgInitData ? await verifyInitData(b.studio.id, r.tgInitData) : null;

  const out = await createBooking(b, { ...r, tgChatId: tgUser?.id ?? null });
  if (!out.ok) return res.status(out.status).json({ error: out.error, message: out.message });
  if (out.fresh) await notifyNewBooking(b, out.id).catch(() => undefined);
  return res.status(out.fresh ? 201 : 200).json({ id: out.id, token: out.token });
}

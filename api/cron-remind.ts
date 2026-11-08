import type { VercelRequest, VercelResponse } from '@vercel/node';
import { addDays, nowLocal, zoned } from '../src/lib/schedule.js';
import { db, hoursOf } from './_lib/server.js';
import { botFor, esc, tg, when } from './_lib/telegram.js';
import type { Studio } from '../src/lib/schema.js';

/**
 * Runs once a day (vercel.json → crons). Sends a Telegram reminder to everyone
 * who booked through the bot or the Mini App and comes tomorrow.
 * Daily schedule works on the free Vercel plan; on Pro you can run it hourly for "exactly 24 h before".
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  const { data: studios } = await db().from('studios').select('id, slug, status, tz, settings').eq('status', 'live');
  let sent = 0;
  for (const s of (studios ?? []) as Studio[]) {
    const bot = await botFor(s.id);
    if (!bot) continue;
    const h = hoursOf(s);
    const tomorrow = addDays(nowLocal(h).date, 1);
    const { data } = await db().from('bookings').select('id, tg_chat_id, service_name, starts_at')
      .eq('studio_id', s.id).in('status', ['new', 'accepted']).not('tg_chat_id', 'is', null).is('reminded_at', null)
      .gte('starts_at', zoned(h, tomorrow, 0)).lt('starts_at', zoned(h, addDays(tomorrow, 1), 0));
    for (const b of (data ?? []) as { id: string; tg_chat_id: number; service_name: string; starts_at: string }[]) {
      const ok = await tg(bot.token, 'sendMessage', {
        chat_id: b.tg_chat_id, parse_mode: 'HTML',
        text: `🔔 Напоминаем: завтра <b>${esc(b.service_name)}</b>, ${when(b.starts_at, s.tz)}.${s.settings.address ? `\n📍 ${esc(s.settings.address)}` : ''}\nЕсли планы изменились — отмените запись в боте.`,
        reply_markup: { inline_keyboard: [[{ text: '🗓 Мои записи', callback_data: 'my' }]] },
      });
      if (ok) { await db().from('bookings').update({ reminded_at: new Date().toISOString() }).eq('id', b.id); sent++; }
    }
  }
  return res.status(200).json({ sent });
}

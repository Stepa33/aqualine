import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { db, type Bundle } from './server.js';

export type Bot = { studio_id: string; token: string; secret: string; owner_code: string };
export type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
export type Markup =
  | { inline_keyboard: Button[][] }
  | { keyboard: { text: string; request_contact?: boolean }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean }
  | { remove_keyboard: true };

const bots = new Map<string, { bot: Bot | null; at: number }>();
/** The studio's bot. Cached for a minute, so a re-run of tg:setup takes effect quickly. */
export async function botFor(studioId: string): Promise<Bot | null> {
  const hit = bots.get(studioId);
  if (hit && Date.now() - hit.at < 60_000) return hit.bot;
  const { data } = await db().from('tg_bots').select('*').eq('studio_id', studioId).maybeSingle();
  bots.set(studioId, { bot: (data as Bot) ?? null, at: Date.now() });
  return (data as Bot) ?? null;
}

export async function tg<T = unknown>(token: string, method: string, body: Record<string, unknown>): Promise<T | null> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!j.ok) { console.error('telegram', method, j.description); return null; }
  return j.result ?? null;
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
export const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ₴`;
export const when = (iso: string, tz: string) => {
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const d = new Date(iso);
  return `${formatInTimeZone(d, tz, 'dd.MM')} (${WD[Number(formatInTimeZone(d, tz, 'i')) % 7]}) ${formatInTimeZone(d, tz, 'HH:mm')}`;
};
export const siteUrl = (slug: string) => `${(process.env.SITE_URL ?? '').replace(/\/$/, '')}/s/${slug}/`;

/**
 * Checks that Mini App data really comes from Telegram for this studio's bot
 * (HMAC as described in Telegram's Web Apps docs). Returns the Telegram user or null.
 */
export async function verifyInitData(studioId: string, initData: string): Promise<{ id: number; first_name?: string } | null> {
  const bot = await botFor(studioId);
  if (!bot) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(bot.token).digest();
  const calc = createHmac('sha256', secret).update(check).digest('hex');
  if (calc.length !== hash.length || !timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date') ?? 0) > 86_400) return null;
  try { return JSON.parse(params.get('user') ?? 'null'); } catch { return null; }
}

export async function ownerChats(studioId: string): Promise<number[]> {
  const { data } = await db().from('tg_owners').select('chat_id').eq('studio_id', studioId);
  return (data ?? []).map((x: { chat_id: number }) => Number(x.chat_id));
}

type Row = { id: string; service_name: string; price: number; starts_at: string; client_name: string; client_phone: string; car: string; status: string; tg_chat_id: number | null; boxes: { name: string } | { name: string }[] | null };
export async function bookingRow(id: string): Promise<Row | null> {
  const { data } = await db().from('bookings').select('id, service_name, price, starts_at, client_name, client_phone, car, status, tg_chat_id, boxes(name)').eq('id', id).maybeSingle();
  return (data as Row) ?? null;
}
export const boxName = (r: Row) => (Array.isArray(r.boxes) ? r.boxes[0]?.name : r.boxes?.name) ?? '';

/** New booking → message to every owner chat, with Accept / Cancel buttons. */
export async function notifyNewBooking(b: Bundle, bookingId: string) {
  const bot = await botFor(b.studio.id);
  if (!bot) return;
  const r = await bookingRow(bookingId);
  if (!r) return;
  const text = `🆕 <b>Новая запись</b>\n${esc(r.service_name)} · ${money(r.price)}\n${when(r.starts_at, b.hours.tz)} · ${esc(boxName(r))}\n${esc(r.client_name)} · ${esc(r.client_phone)}\n${esc(r.car)}${r.tg_chat_id ? '\n(через Telegram)' : ''}`;
  for (const chat of await ownerChats(b.studio.id)) {
    await tg(bot.token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ Принять', callback_data: `oa:${r.id}` }, { text: '✖ Отменить', callback_data: `ox:${r.id}` }]] } });
  }
}

export async function notifyOwners(studioId: string, text: string) {
  const bot = await botFor(studioId);
  if (!bot) return;
  for (const chat of await ownerChats(studioId)) await tg(bot.token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML' });
}

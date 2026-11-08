import { addDays, nowLocal, toMin, tryStart, zoned } from '../../src/lib/schedule.js';
import { busyFor, db, type Bundle } from './server.js';

export type NewBooking = {
  serviceId: string; date: string; startMin: number;
  name: string; phone: string; car: string; requestId: string; tgChatId?: number | null;
};
export type BookResult =
  | { ok: true; id: string; token: string; fresh: boolean }
  | { ok: false; status: number; error: string; message: string };

/**
 * One booking, used by the website and the Telegram bot.
 * Free time is re-checked here; the database constraint no_double_booking makes
 * the insert all-or-nothing, so two people can never get the same box and time.
 */
export async function createBooking(b: Bundle, r: NewBooking): Promise<BookResult> {
  const { data: existing } = await db().from('bookings').select('id, client_token').eq('request_id', r.requestId).maybeSingle();
  if (existing) return { ok: true, id: existing.id, token: existing.client_token, fresh: false };

  if (b.studio.status !== 'live') return { ok: false, status: 403, error: 'sample_only', message: 'Это образец студии, запись пока выключена.' };
  const svc = b.services.find((s) => s.id === r.serviceId);
  if (!svc) return { ok: false, status: 400, error: 'service_not_found', message: 'Такой услуги нет.' };
  const now = nowLocal(b.hours);
  if (r.date < now.date || (r.date === now.date && r.startMin < now.min + 30)) return { ok: false, status: 409, error: 'too_late', message: 'Это время уже прошло.' };
  if (svc.days > 1 && r.startMin !== toMin(b.hours.open)) return { ok: false, status: 400, error: 'invalid_start', message: 'Многодневные работы начинаются с открытия.' };

  const busy = await busyFor(b.studio.id, zoned(b.hours, addDays(r.date, -1), 0), zoned(b.hours, addDays(r.date, 14), 0));
  let boxIds = b.boxes.map((x) => x.id);
  const taken = { ok: false as const, status: 409, error: 'taken', message: 'Это время только что заняли. Выберите другое.' };

  while (boxIds.length) {
    const slot = tryStart(b.hours, svc, boxIds, busy, r.date, r.startMin);
    if (!slot) return taken;
    const { data, error } = await db().from('bookings').insert({
      studio_id: b.studio.id, box_id: slot.boxId, service_id: svc.id, service_name: svc.name, price: svc.price,
      starts_at: slot.startsAt, ends_at: slot.endsAt, blocked_until: slot.blockedUntil,
      client_name: r.name, client_phone: r.phone, car: r.car, request_id: r.requestId, source: 'client',
      tg_chat_id: r.tgChatId ?? null,
    }).select('id, client_token').single();
    if (!error && data) return { ok: true, id: data.id, token: data.client_token, fresh: true };
    if (error?.code === '23505') {
      const { data: again } = await db().from('bookings').select('id, client_token').eq('request_id', r.requestId).single();
      if (again) return { ok: true, id: again.id, token: again.client_token, fresh: false };
    }
    if (error?.code !== '23P01') return { ok: false, status: 500, error: 'save_failed', message: 'Не получилось сохранить запись.' };
    boxIds = boxIds.filter((id) => id !== slot.boxId); // this box was taken a moment ago — try the next one
  }
  return taken;
}

/**
 * Free-time calculation. Shared by the browser (to show slots) and by the
 * server (to re-check a slot before saving), so both always agree.
 * Times inside a day are minutes from midnight in the studio's time zone.
 */
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export type Hours = {
  open: string; close: string; daysOff: number[]; holidays: string[];
  bufferMin: number; stepMin: number; tz: string;
};
export type SvcLite = { id: string; duration_min: number; days: number };
export type BusyLite = { box_id: string; starts_at: string; blocked_until: string };
export type Slot = { date: string; startMin: number; boxId: string; startsAt: string; endsAt: string; blockedUntil: string; dates: string[] };

export const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const isWorkday = (h: Hours, date: string) => !h.holidays.includes(date) && !h.daysOff.includes(weekday(date));

export function workdaysFrom(h: Hours, date: string, n: number): string[] {
  const out: string[] = [];
  for (let d = date, guard = 0; out.length < n && guard < 90; d = addDays(d, 1), guard++) if (isWorkday(h, d)) out.push(d);
  return out;
}

/** Local date + minutes → UTC ISO string. */
export const zoned = (h: Hours, date: string, min: number) => fromZonedTime(`${date}T${hm(min)}:00`, h.tz).toISOString();
/** "Now" in the studio: local date and minutes. */
export function nowLocal(h: Hours, now = new Date()) {
  return { date: formatInTimeZone(now, h.tz, 'yyyy-MM-dd'), min: toMin(formatInTimeZone(now, h.tz, 'HH:mm')) };
}

function boxFree(busy: BusyLite[], boxId: string, from: string, until: string) {
  const a = Date.parse(from), b = Date.parse(until);
  return busy.every((x) => x.box_id !== boxId || Date.parse(x.starts_at) >= b || Date.parse(x.blocked_until) <= a);
}

/** One candidate start; returns the first free box or null. */
export function tryStart(h: Hours, svc: SvcLite, boxIds: string[], busy: BusyLite[], date: string, startMin: number): Slot | null {
  const open = toMin(h.open), close = toMin(h.close);
  if (!isWorkday(h, date)) return null;
  let dates = [date], endsAt: string;
  if (svc.days > 1) {
    if (startMin !== open) return null;
    dates = workdaysFrom(h, date, svc.days);
    endsAt = zoned(h, dates[dates.length - 1]!, close);
  } else {
    if (startMin < open || startMin + svc.duration_min > close) return null;
    endsAt = zoned(h, date, startMin + svc.duration_min);
  }
  const startsAt = zoned(h, date, startMin);
  const blockedUntil = new Date(Date.parse(endsAt) + h.bufferMin * 60_000).toISOString();
  for (const boxId of boxIds) if (boxFree(busy, boxId, startsAt, blockedUntil)) return { date, startMin, boxId, startsAt, endsAt, blockedUntil, dates };
  return null;
}

/** All free starts for a day. Starts closer than `leadMin` to now are hidden. */
export function slotsFor(h: Hours, svc: SvcLite, boxIds: string[], busy: BusyLite[], date: string, now = new Date(), leadMin = 30): Slot[] {
  if (!isWorkday(h, date)) return [];
  const open = toMin(h.open), close = toMin(h.close), n = nowLocal(h, now);
  if (date < n.date) return [];
  const starts = svc.days > 1 ? [open] : [] as number[];
  if (svc.days <= 1) for (let t = open; t + svc.duration_min <= close; t += h.stepMin) starts.push(t);
  const out: Slot[] = [];
  for (const t of starts) {
    if (date === n.date && t < n.min + leadMin) continue;
    const s = tryStart(h, svc, boxIds, busy, date, t);
    if (s) out.push(s);
  }
  return out;
}

export function nearestSlots(h: Hours, svc: SvcLite, boxIds: string[], busy: BusyLite[], from: string, limit = 5, now = new Date()): Slot[] {
  const out: Slot[] = [];
  for (let i = 0, d = from; i < 21 && out.length < limit; i++, d = addDays(d, 1)) {
    for (const s of slotsFor(h, svc, boxIds, busy, d, now)) { out.push(s); if (out.length >= limit) break; }
  }
  return out;
}

import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import type { Service } from './schema';

export const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ₴`;
export const duration = (s: Pick<Service, 'days' | 'duration_min'>) =>
  s.days > 1 ? `${s.days} дня` : s.duration_min < 60 ? `${s.duration_min} мин` : `${Math.floor(s.duration_min / 60)} ч${s.duration_min % 60 ? ` ${s.duration_min % 60} мин` : ''}`;
export const dayLabel = (date: string) => formatInTimeZone(new Date(`${date}T12:00:00Z`), 'UTC', 'd MMMM, EEEEEE', { locale: ru });
export const whenLabel = (iso: string, tz: string) => formatInTimeZone(new Date(iso), tz, 'd MMMM, EEEEEE, HH:mm', { locale: ru });
export const STATUS: Record<string, string> = { new: 'Новая', accepted: 'Принята', done: 'Готово', cancelled: 'Отменена', refunded: 'Возврат' };

/** Calendar file with a reminder one day before — works on iPhone, Android and computers. */
export function icsFile(o: { title: string; start: string; end: string; location?: string; details?: string }) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//studio//booking//RU', 'BEGIN:VEVENT',
    `UID:${f(o.start)}-${Math.random().toString(36).slice(2)}@studio`, `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(o.start)}`, `DTEND:${f(o.end)}`, `SUMMARY:${esc(o.title)}`,
    o.location ? `LOCATION:${esc(o.location)}` : '', o.details ? `DESCRIPTION:${esc(o.details)}` : '',
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(o.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
}

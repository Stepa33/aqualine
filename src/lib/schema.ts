import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД');

export const StudioSettings = z
  .object({
    name: z.string().min(1).max(60),
    tagline: z.string().max(100).default(''),
    about: z.string().max(600).default(''),
    address: z.string().max(160).default(''),
    mapUrl: z.string().url().or(z.literal('')).default(''),
    phone: z.string().max(30).default(''),
    telegram: z.string().max(40).default(''),
    open: hhmm,
    close: hhmm,
    daysOff: z.array(z.number().int().min(0).max(6)).default([]),
    holidays: z.array(isoDate).default([]),
    bufferMin: z.number().int().min(0).max(180).default(15),
    stepMin: z.number().int().min(10).max(120).default(30),
    cancelHours: z.number().int().min(0).max(168).default(2),
    cards: z.array(z.object({ title: z.string().max(60), text: z.string().max(160) })).length(3),
    heroPath: z.string().default(''),
    logoPath: z.string().default(''),
  })
  .refine((s) => s.close > s.open, { message: 'Закрытие должно быть позже открытия', path: ['close'] });
export type StudioSettings = z.infer<typeof StudioSettings>;

export const ServiceInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).default(''),
  price: z.number().int().min(0).max(1_000_000),
  duration_min: z.number().int().min(0).max(720),
  days: z.number().int().min(1).max(7),
}).refine((s) => s.days > 1 || s.duration_min >= 10, { message: 'Длительность от 10 минут', path: ['duration_min'] });

export type Studio = { id: string; slug: string; status: 'draft' | 'live'; tz: string; settings: StudioSettings };
export type Box = { id: string; studio_id: string; name: string; sort: number; active: boolean };
export type Service = { id: string; studio_id: string; name: string; description: string; price: number; duration_min: number; days: number; sort: number; active: boolean };
export type WorkPhoto = { id: string; studio_id: string; path: string; caption: string; sort: number };
export type BookingStatus = 'new' | 'accepted' | 'done' | 'cancelled' | 'refunded';
export type Booking = {
  id: string; studio_id: string; box_id: string; service_id: string | null; service_name: string; price: number;
  starts_at: string; ends_at: string; blocked_until: string; status: BookingStatus; paid: number; refunded: number;
  client_name: string; client_phone: string; car: string; source: 'client' | 'owner'; created_at: string;
};

export const BookRequest = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  serviceId: z.string().uuid(),
  date: isoDate,
  startMin: z.number().int().min(0).max(24 * 60),
  name: z.string().trim().min(1, 'Укажите имя').max(60),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{9,20}$/, 'Проверьте номер телефона'),
  car: z.string().trim().min(1, 'Укажите автомобиль').max(80),
  requestId: z.string().uuid(),
});
export type BookRequest = z.infer<typeof BookRequest>;

/** Tenant file in tenants/<slug>/tenant.json */
export const TenantFile = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  ownerEmail: z.string().email(),
  tz: z.string().default('Europe/Kyiv'),
  settings: StudioSettings,
  boxes: z.array(z.string().min(1)).min(1),
  services: z.array(ServiceInput).min(1),
  hero: z.string().min(1),
  logo: z.string().optional(),
  works: z.array(z.object({ file: z.string().min(1), caption: z.string().max(120) })).max(30),
});
export type TenantFile = z.infer<typeof TenantFile>;

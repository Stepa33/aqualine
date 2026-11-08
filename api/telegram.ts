import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { addDays, hm, nowLocal, slotsFor, zoned } from '../src/lib/schedule.js';
import { allowAI, runAssistant, type ChatMsg } from './_lib/assistant.js';
import { createBooking } from './_lib/booking.js';
import { busyFor, db, loadStudio, type Bundle } from './_lib/server.js';
import { botFor, bookingRow, boxName, esc, money, notifyNewBooking, notifyOwners, ownerChats, siteUrl, tg, when, type Bot, type Button, type Markup } from './_lib/telegram.js';

/**
 * Telegram bot webhook: /api/telegram?s=<studio>
 * The whole booking happens in the chat with buttons; the site also opens inside Telegram.
 */

type State = {
  step?: 'name' | 'phone' | 'car' | 'confirm';
  svcId?: string; date?: string; startMin?: number;
  name?: string; phone?: string; car?: string; requestId?: string;
  chat?: ChatMsg[];
};
type Msg = { message_id: number; chat: { id: number; type: string }; from?: { id: number; first_name?: string }; text?: string; contact?: { phone_number: string; user_id?: number } };
type Update = { message?: Msg; callback_query?: { id: string; from: { id: number; first_name?: string }; message?: Msg; data?: string } };

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const PHONE = /^\+?[\d\s()-]{9,20}$/;
const dTxt = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return `${String(x.getUTCDate()).padStart(2, '0')}.${String(x.getUTCMonth() + 1).padStart(2, '0')} (${WD[x.getUTCDay()]})`; };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  const slug = String(req.query.s ?? '');
  const b = await loadStudio(slug);
  const bot = b ? await botFor(b.studio.id) : null;
  if (!b || !bot || req.headers['x-telegram-bot-api-secret-token'] !== bot.secret) return res.status(401).send('no');
  try {
    await handle(new Ctx(b, bot), req.body as Update);
  } catch (e) {
    console.error('bot', e);
  }
  return res.status(200).send('ok'); // always 200, otherwise Telegram keeps re-sending the same update
}

class Ctx {
  constructor(public b: Bundle, public bot: Bot) {}
  send(chat: number, text: string, markup?: Markup) { return tg(this.bot.token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) }); }
  edit(chat: number, id: number, text: string, markup?: Markup) { return tg(this.bot.token, 'editMessageText', { chat_id: chat, message_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) }); }
  async state(chat: number): Promise<State> {
    const { data } = await db().from('tg_sessions').select('state').eq('studio_id', this.b.studio.id).eq('chat_id', chat).maybeSingle();
    return (data?.state as State) ?? {};
  }
  async save(chat: number, s: State) {
    await db().from('tg_sessions').upsert({ studio_id: this.b.studio.id, chat_id: chat, state: s, updated_at: new Date().toISOString() });
  }
  async isOwner(chat: number) { return (await ownerChats(this.b.studio.id)).includes(chat); }
  get s() { return this.b.studio.settings; }
}

function menu(c: Ctx): Markup {
  const rows: Button[][] = [
    [{ text: '📅 Записаться', callback_data: 'book' }],
    [{ text: '🗓 Мои записи', callback_data: 'my' }, { text: '💰 Цены', callback_data: 'prices' }],
    [{ text: '📍 Как нас найти', callback_data: 'where' }, { text: '💬 Задать вопрос', callback_data: 'ask' }],
  ];
  if (process.env.SITE_URL) rows.push([{ text: '📱 Открыть приложение', web_app: { url: siteUrl(c.b.studio.slug) } }]);
  return { inline_keyboard: rows };
}

async function handle(c: Ctx, u: Update) {
  if (u.callback_query) {
    const q = u.callback_query, chat = q.message?.chat.id ?? q.from.id;
    await tg(c.bot.token, 'answerCallbackQuery', { callback_query_id: q.id });
    if (q.message?.chat.type !== 'private') return;
    return onButton(c, chat, q.message?.message_id ?? 0, q.data ?? '', q.from.first_name);
  }
  const m = u.message;
  if (!m || m.chat.type !== 'private') return; // the bot only works in private chats
  const chat = m.chat.id, text = (m.text ?? '').trim();

  if (text.startsWith('/start') || text === '/menu') {
    await c.save(chat, {});
    return c.send(chat, `Здравствуйте! Это <b>${esc(c.s.name)}</b>${c.s.tagline ? ` — ${esc(c.s.tagline.toLowerCase())}` : ''}.\nЗапишитесь в пару нажатий или задайте вопрос.`, menu(c));
  }
  if (text.startsWith('/owner')) {
    const code = text.split(/\s+/)[1] ?? '';
    if (code && code === c.bot.owner_code) {
      await db().from('tg_owners').upsert({ studio_id: c.b.studio.id, chat_id: chat });
      return c.send(chat, '✅ Готово. Сюда будут приходить новые записи и отмены.\nКоманды: /today — записи на сегодня, /tomorrow — на завтра. Можно спрашивать обычными словами: «Сколько денег получено на этой неделе?»');
    }
    return c.send(chat, 'Неверный код владельца.');
  }
  if (text === '/today' || text === '/tomorrow') {
    if (!(await c.isOwner(chat))) return c.send(chat, 'Эта команда только для владельца.');
    return c.send(chat, await dayList(c, text === '/today' ? 0 : 1));
  }
  if (text === '/book') return onButton(c, chat, 0, 'book');
  if (text === '/my') return onButton(c, chat, 0, 'my');

  const st = await c.state(chat);
  if (st.step === 'name' && text) { st.name = text.slice(0, 60); return askPhone(c, chat, st); }
  if (st.step === 'phone') {
    const phone = m.contact ? (m.contact.phone_number.startsWith('+') ? m.contact.phone_number : `+${m.contact.phone_number}`) : text;
    if (!PHONE.test(phone)) return c.send(chat, 'Похоже, номер с ошибкой. Напишите его в формате +380 67 123 45 67 или нажмите кнопку ниже.');
    st.phone = phone; st.step = 'car'; await c.save(chat, st);
    return c.send(chat, 'Какой у вас автомобиль? Марка, модель, цвет.', { remove_keyboard: true });
  }
  if (st.step === 'car' && text) { st.car = text.slice(0, 80); return confirmStep(c, chat, 0, st); }

  if (!text) return;
  // Anything else is a question for the assistant.
  const owner = await c.isOwner(chat);
  if (!(await allowAI(`tg:${c.b.studio.slug}:${chat}`))) return c.send(chat, 'Слишком много вопросов подряд. Подождите несколько минут.');
  await tg(c.bot.token, 'sendChatAction', { chat_id: chat, action: 'typing' });
  const history = [...(st.chat ?? []), { role: 'user' as const, content: text.slice(0, 500) }].slice(-8);
  let answer: string;
  try { answer = await runAssistant(c.b, owner ? 'owner' : 'client', history); } catch { answer = 'Помощник сейчас недоступен. Попробуйте позже или позвоните нам.'; }
  st.chat = [...history, { role: 'assistant' as const, content: answer }].slice(-8);
  await c.save(chat, st);
  return c.send(chat, esc(answer), { inline_keyboard: [[{ text: '📅 Записаться', callback_data: 'book' }, { text: 'Меню', callback_data: 'menu' }]] });
}

async function onButton(c: Ctx, chat: number, msgId: number, data: string, firstName?: string) {
  const [cmd, arg = ''] = [data.split(':')[0], data.slice(data.indexOf(':') + 1)];
  const reply = (text: string, markup?: Markup) => (msgId ? c.edit(chat, msgId, text, markup) : c.send(chat, text, markup));
  const st = await c.state(chat);

  switch (cmd) {
    case 'menu': return c.send(chat, 'Чем помочь?', menu(c));
    case 'prices':
      return c.send(chat, `<b>Цены</b>\n${c.b.services.map((s) => `• ${esc(s.name)} — ${money(s.price)} (${s.days > 1 ? `${s.days} дня` : `${s.duration_min} мин`})`).join('\n')}`, { inline_keyboard: [[{ text: '📅 Записаться', callback_data: 'book' }]] });
    case 'where': {
      const s = c.s;
      const lines = [`<b>${esc(s.name)}</b>`, s.address ? `📍 ${esc(s.address)}` : '📍 Адрес пока не указан', `🕘 ${s.open}–${s.close}${s.daysOff.length ? `, выходные: ${s.daysOff.map((d) => WD[d]).join(', ')}` : ', без выходных'}`, s.phone ? `📞 ${esc(s.phone)}` : ''];
      return c.send(chat, lines.filter(Boolean).join('\n'), s.mapUrl ? { inline_keyboard: [[{ text: 'Открыть карту', url: s.mapUrl }]] } : undefined);
    }
    case 'ask': return c.send(chat, 'Напишите вопрос обычными словами. Например: «Когда ближайшее окно на комплекс?»');

    case 'book': {
      if (c.b.studio.status !== 'live') return c.send(chat, 'Запись через бота скоро откроется.');
      await c.save(chat, { requestId: randomUUID(), chat: st.chat });
      return reply('Выберите услугу:', { inline_keyboard: c.b.services.map((s) => [{ text: `${s.name} — ${money(s.price)}`, callback_data: `s:${s.id}` }]) });
    }
    case 's': {
      const svc = c.b.services.find((s) => s.id === arg);
      if (!svc) return reply('Эта услуга больше не доступна.', menu(c));
      Object.assign(st, { svcId: svc.id, date: undefined, startMin: undefined, requestId: st.requestId ?? randomUUID() });
      await c.save(chat, st);
      const today = nowLocal(c.b.hours).date;
      const busy = await busyFor(c.b.studio.id, zoned(c.b.hours, addDays(today, -1), 0), zoned(c.b.hours, addDays(today, 22), 0));
      const days: Button[] = [];
      for (let i = 0; i < 14; i++) {
        const d = addDays(today, i);
        if (slotsFor(c.b.hours, svc, c.b.boxes.map((x) => x.id), busy, d).length) {
          const dt = new Date(`${d}T12:00:00Z`);
          days.push({ text: `${i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WD[dt.getUTCDay()]} ${String(dt.getUTCDate()).padStart(2, '0')}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}`, callback_data: `d:${d}` });
        }
      }
      if (!days.length) return reply(`На «${esc(svc.name)}» в ближайшие 2 недели свободного времени нет.`, menu(c));
      const rows: Button[][] = [];
      for (let i = 0; i < days.length; i += 3) rows.push(days.slice(i, i + 3));
      rows.push([{ text: '← Услуги', callback_data: 'book' }]);
      return reply(`<b>${esc(svc.name)}</b> · ${money(svc.price)}\nВыберите день:`, { inline_keyboard: rows });
    }
    case 'd': {
      const svc = c.b.services.find((s) => s.id === st.svcId);
      if (!svc) return onButton(c, chat, msgId, 'book');
      const busy = await busyFor(c.b.studio.id, zoned(c.b.hours, addDays(arg, -1), 0), zoned(c.b.hours, addDays(arg, 9), 0));
      const slots = slotsFor(c.b.hours, svc, c.b.boxes.map((x) => x.id), busy, arg);
      if (!slots.length) return reply('На этот день время уже заняли. Выберите другой.', { inline_keyboard: [[{ text: '← Дни', callback_data: `s:${svc.id}` }]] });
      st.date = arg; await c.save(chat, st);
      const rows: Button[][] = [];
      for (let i = 0; i < slots.length; i += 4) rows.push(slots.slice(i, i + 4).map((x) => ({ text: hm(x.startMin), callback_data: `t:${x.startMin}` })));
      rows.push([{ text: '← Дни', callback_data: `s:${svc.id}` }]);
      const note = svc.days > 1 ? `\nМашина остаётся у нас ${svc.days} рабочих дня.` : '';
      return reply(`<b>${esc(svc.name)}</b>\n${slots[0]!.dates.length > 1 ? `с ${dTxt(arg)} по ${dTxt(slots[0]!.dates.at(-1)!)}` : dTxt(arg)}. Выберите время:${note}`, { inline_keyboard: rows });
    }
    case 't': {
      if (!st.svcId || !st.date) return onButton(c, chat, msgId, 'book');
      st.startMin = Number(arg); st.step = 'name'; await c.save(chat, st);
      const svc = c.b.services.find((s) => s.id === st.svcId)!;
      await reply(`<b>${esc(svc.name)}</b>, ${dTxt(st.date)} в ${hm(st.startMin)}.\nКак к вам обращаться?`, firstName ? { inline_keyboard: [[{ text: `Я — ${firstName.slice(0, 30)}`, callback_data: 'nm' }]] } : undefined);
      return;
    }
    case 'nm': if (firstName) { st.name = firstName.slice(0, 60); return askPhone(c, chat, st); } return;
    case 'ok': {
      if (!st.svcId || !st.date || st.startMin == null || !st.name || !st.phone || !st.car || !st.requestId) return onButton(c, chat, msgId, 'book');
      const out = await createBooking(c.b, { serviceId: st.svcId, date: st.date, startMin: st.startMin, name: st.name, phone: st.phone, car: st.car, requestId: st.requestId, tgChatId: chat });
      if (!out.ok) {
        await c.save(chat, { ...st, step: undefined, startMin: undefined });
        return reply(`⚠️ ${esc(out.message)}`, out.error === 'taken' ? { inline_keyboard: [[{ text: 'Выбрать другое время', callback_data: `d:${st.date}` }]] } : menu(c));
      }
      await c.save(chat, { chat: st.chat });
      if (out.fresh) await notifyNewBooking(c.b, out.id).catch(() => undefined);
      const r = await bookingRow(out.id);
      return reply(`✅ <b>Вы записаны!</b>\n${esc(r?.service_name ?? '')}\n${r ? when(r.starts_at, c.b.hours.tz) : ''} · ${esc(r ? boxName(r) : '')}\n${money(r?.price ?? 0)}\n\nЗа сутки пришлём напоминание.${c.s.address ? `\n📍 ${esc(c.s.address)}` : ''}`, { inline_keyboard: [[{ text: '🗓 Мои записи', callback_data: 'my' }, { text: 'Меню', callback_data: 'menu' }]] });
    }
    case 'x': await c.save(chat, { chat: st.chat }); return reply('Запись не создана.', menu(c));

    case 'my': {
      const { data } = await db().from('bookings').select('id, service_name, price, starts_at, status')
        .eq('studio_id', c.b.studio.id).eq('tg_chat_id', chat).in('status', ['new', 'accepted']).gte('ends_at', new Date().toISOString()).order('starts_at');
      const list = (data ?? []) as { id: string; service_name: string; price: number; starts_at: string; status: string }[];
      if (!list.length) return c.send(chat, 'Активных записей нет.', { inline_keyboard: [[{ text: '📅 Записаться', callback_data: 'book' }]] });
      const rows = list.filter((x) => Date.parse(x.starts_at) - Date.now() >= c.s.cancelHours * 3_600_000).map((x) => [{ text: `Отменить ${when(x.starts_at, c.b.hours.tz)}`, callback_data: `c:${x.id}` }]);
      const text = `<b>Ваши записи</b>\n${list.map((x) => `• ${when(x.starts_at, c.b.hours.tz)} — ${esc(x.service_name)}, ${money(x.price)}${x.status === 'accepted' ? ' ✅' : ''}`).join('\n')}${rows.length < list.length ? `\n\nОтменить можно не позже чем за ${c.s.cancelHours} ч${c.s.phone ? `, дальше — по телефону ${esc(c.s.phone)}` : ''}.` : ''}`;
      return c.send(chat, text, rows.length ? { inline_keyboard: rows } : undefined);
    }
    case 'c': return reply('Точно отменить запись?', { inline_keyboard: [[{ text: 'Да, отменить', callback_data: `cc:${arg}` }, { text: 'Нет', callback_data: 'my' }]] });
    case 'cc': {
      const { data: x } = await db().from('bookings').select('id, starts_at, status').eq('id', arg).eq('studio_id', c.b.studio.id).eq('tg_chat_id', chat).maybeSingle();
      if (!x || (x.status !== 'new' && x.status !== 'accepted')) return reply('Эту запись уже нельзя отменить.');
      if (Date.parse(x.starts_at) - Date.now() < c.s.cancelHours * 3_600_000) return reply(`Отменить можно не позже чем за ${c.s.cancelHours} ч.${c.s.phone ? ` Позвоните: ${esc(c.s.phone)}` : ''}`);
      await db().from('bookings').update({ status: 'cancelled' }).eq('id', x.id);
      const r = await bookingRow(x.id);
      if (r) await notifyOwners(c.b.studio.id, `❌ <b>Клиент отменил запись</b>\n${esc(r.service_name)} · ${when(r.starts_at, c.b.hours.tz)}\n${esc(r.client_name)} · ${esc(r.client_phone)}`);
      return reply('Запись отменена.', menu(c));
    }

    // Owner buttons under "new booking" notifications
    case 'oa': case 'ox': {
      if (!(await c.isOwner(chat))) return;
      const r = await bookingRow(arg);
      if (!r || (r.status !== 'new' && r.status !== 'accepted')) return c.send(chat, 'Эта запись уже изменена.');
      const status = cmd === 'oa' ? 'accepted' : 'cancelled';
      const { error } = await db().from('bookings').update({ status }).eq('id', r.id).eq('studio_id', c.b.studio.id);
      if (error) return c.send(chat, 'Не получилось сохранить.');
      await reply(`${cmd === 'oa' ? '✅ Принята' : '❌ Отменена'}: ${esc(r.service_name)} · ${when(r.starts_at, c.b.hours.tz)}\n${esc(r.client_name)} · ${esc(r.client_phone)}`);
      if (r.tg_chat_id) {
        await c.send(r.tg_chat_id, cmd === 'oa'
          ? `✅ Ваша запись подтверждена: ${esc(r.service_name)}, ${when(r.starts_at, c.b.hours.tz)}.`
          : `К сожалению, студия отменила запись на ${when(r.starts_at, c.b.hours.tz)}.${c.s.phone ? ` Свяжитесь с нами: ${esc(c.s.phone)}` : ''}`, { inline_keyboard: [[{ text: '📅 Записаться снова', callback_data: 'book' }]] });
      }
      return;
    }
  }
}

async function askPhone(c: Ctx, chat: number, st: State) {
  st.step = 'phone'; await c.save(chat, st);
  return c.send(chat, 'Ваш номер телефона? Нажмите кнопку ниже или напишите его.', { keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });
}

async function confirmStep(c: Ctx, chat: number, _msgId: number, st: State) {
  st.step = 'confirm'; await c.save(chat, st);
  const svc = c.b.services.find((s) => s.id === st.svcId);
  return c.send(chat, `Проверьте запись:\n<b>${esc(svc?.name ?? '')}</b> · ${money(svc?.price ?? 0)}\n${dTxt(st.date ?? '')} в ${hm(st.startMin ?? 0)}\n${esc(st.name ?? '')} · ${esc(st.phone ?? '')}\n${esc(st.car ?? '')}`,
    { inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: 'ok' }, { text: '✖ Отмена', callback_data: 'x' }]] });
}

async function dayList(c: Ctx, plus: number) {
  const d = addDays(nowLocal(c.b.hours).date, plus);
  const { data } = await db().from('bookings').select('starts_at, service_name, client_name, client_phone, car, status, boxes(name)')
    .eq('studio_id', c.b.studio.id).gte('starts_at', zoned(c.b.hours, d, 0)).lt('starts_at', zoned(c.b.hours, addDays(d, 1), 0))
    .in('status', ['new', 'accepted', 'done']).order('starts_at');
  const l = (data ?? []) as { starts_at: string; service_name: string; client_name: string; client_phone: string; car: string; status: string; boxes: { name: string } | null }[];
  if (!l.length) return `${plus ? 'Завтра' : 'Сегодня'} записей нет.`;
  return `<b>${plus ? 'Завтра' : 'Сегодня'}, ${dTxt(d)}</b>\n${l.map((x) => `• ${when(x.starts_at, c.b.hours.tz).slice(-5)} ${esc(x.boxes?.name ?? '')} — ${esc(x.service_name)}\n   ${esc(x.client_name)}, ${esc(x.client_phone)}, ${esc(x.car)}`).join('\n')}`;
}

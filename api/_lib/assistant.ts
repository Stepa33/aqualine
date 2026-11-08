import OpenAI from 'openai';
import { addDays, hm, nearestSlots, nowLocal, zoned } from '../../src/lib/schedule.js';
import { busyFor, db, type Bundle } from './server.js';


type Tool = { def: OpenAI.Chat.Completions.ChatCompletionTool; run: (args: any) => Promise<unknown> };

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dayTxt = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return `${x.getUTCDate()}.${String(x.getUTCMonth() + 1).padStart(2, '0')}, ${WD[x.getUTCDay()]}`; };

function clientTools(b: Bundle): Tool[] {
  const fn = (name: string, description: string, properties: Record<string, unknown> = {}): OpenAI.Chat.Completions.ChatCompletionTool =>
    ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, additionalProperties: false } } });
  const findSvc = (q?: string) => {
    const s = (q ?? '').toLowerCase();
    return b.services.find((x) => s && x.name.toLowerCase().includes(s)) ??
      b.services.find((x) => s && s.split(/\s+/).some((w) => w.length > 3 && x.name.toLowerCase().includes(w.slice(0, -1)))) ?? null;
  };
  return [
    { def: fn('get_services', 'Услуги студии: название, цена в гривнах, длительность.'),
      run: async () => b.services.map((s) => ({ name: s.name, price_uah: s.price, duration: s.days > 1 ? `${s.days} дня` : `${s.duration_min} мин`, about: s.description })) },
    { def: fn('find_free_slots', 'Ближайшее свободное время на услугу. Если услуга не названа, верни needs_service.', {
        service: { type: 'string', description: 'Название или часть названия услуги' },
        from_date: { type: 'string', description: 'YYYY-MM-DD, с какого дня искать' } }),
      run: async (a: { service?: string; from_date?: string }) => {
        const svc = findSvc(a.service);
        if (!svc) return { needs_service: true, services: b.services.map((s) => s.name) };
        const from = /^\d{4}-\d{2}-\d{2}$/.test(a.from_date ?? '') ? a.from_date! : nowLocal(b.hours).date;
        const busy = await busyFor(b.studio.id, zoned(b.hours, addDays(from, -1), 0), zoned(b.hours, addDays(from, 22), 0));
        const slots = nearestSlots(b.hours, svc, b.boxes.map((x) => x.id), busy, from, 6);
        return { service: svc.name, slots: slots.map((s) => ({ date: s.date, day: dayTxt(s.date), time: hm(s.startMin) })) };
      } },
    { def: fn('get_studio_info', 'Адрес, ссылка на карту, телефон, часы работы и выходные.'),
      run: async () => { const s = b.studio.settings; return { name: s.name, address: s.address || 'не указан', map: s.mapUrl || null, phone: s.phone || null, hours: `${s.open}–${s.close}`, days_off: s.daysOff.map((d) => WD[d]), holidays: s.holidays }; } },
  ];
}

function ownerTools(b: Bundle): Tool[] {
  const range = { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD включительно' } };
  const fn = (name: string, description: string): OpenAI.Chat.Completions.ChatCompletionTool =>
    ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: range, required: ['from', 'to'], additionalProperties: false } } });
  const load = async (from: string, to: string) => {
    const { data } = await db().from('bookings').select('starts_at, service_name, client_name, car, status, price, paid')
      .eq('studio_id', b.studio.id).gte('starts_at', zoned(b.hours, from, 0)).lt('starts_at', zoned(b.hours, addDays(to, 1), 0)).order('starts_at').limit(300);
    return (data ?? []) as { starts_at: string; service_name: string; client_name: string; car: string; status: string; price: number; paid: number }[];
  };
  return [
    { def: fn('list_bookings', 'Записи студии за период (только чтение).'),
      run: async (a: { from: string; to: string }) => (await load(a.from, a.to)).slice(0, 80) },
    { def: fn('get_stats', 'Итоги за период: заезды, завершено, получено денег.'),
      run: async (a: { from: string; to: string }) => {
        const l = await load(a.from, a.to);
        return { cars: l.filter((x) => x.status !== 'cancelled' && x.status !== 'refunded').length, done: l.filter((x) => x.status === 'done').length, money_uah: l.reduce((s, x) => s + (x.paid ?? 0), 0) };
      } },
  ];
}

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

/** Rate limit per visitor/chat. Returns false when the limit for the last 10 minutes is used up. */
export async function allowAI(key: string): Promise<boolean> {
  const limit = Number(process.env.AI_LIMIT_PER_10_MIN ?? 20);
  const { data } = await db().rpc('ai_hit', { p_key: key, p_limit: limit, p_window_min: 10 });
  return data !== false;
}

/** Answers from the studio's own data only (through read-only tools). Shared by the website and the bot. */
export async function runAssistant(b: Bundle, role: 'client' | 'owner', messages: ChatMsg[]): Promise<string> {
  const now = nowLocal(b.hours);
  const s = b.studio.settings;
  const system = role === 'client'
    ? `Ты помощник автомойки «${s.name}». Сегодня ${now.date} (${dayTxt(now.date)}), время ${hm(now.min)} (${b.hours.tz}). Отвечай коротко, на языке вопроса, без markdown. Про цены, свободное время, адрес и график отвечай ТОЛЬКО по данным инструментов — сначала вызови инструмент. Не придумывай. Если не хватает данных (например, какая услуга), задай один уточняющий вопрос. Сам не записываешь: предложи нажать «Записаться». Ничего не сообщай о других клиентах.`
    : `Ты помощник владельца автомойки «${s.name}». Сегодня ${now.date} (${dayTxt(now.date)}). Отвечай коротко, без markdown. Факты бери только из инструментов, ничего не меняешь. Изменения записей делаются в кабинете.`;
  const tools = role === 'client' ? clientTools(b) : ownerTools(b);
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'system', content: system }, ...messages.slice(-10)];
  for (let round = 0; round < 4; round++) {
    const r = await ai.chat.completions.create({ model, messages: convo, tools: tools.map((t) => t.def), temperature: 0.2, max_tokens: 500 });
    const msg = r.choices[0]?.message;
    if (!msg) break;
    if (!msg.tool_calls?.length) return msg.content ?? '';
    convo.push(msg);
    for (const call of msg.tool_calls) {
      const tool = tools.find((t) => t.def.function.name === call.function.name);
      let out: unknown;
      try { out = tool ? await tool.run(JSON.parse(call.function.arguments || '{}')) : { error: 'unknown_tool' }; }
      catch { out = { error: 'tool_failed' }; }
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 12000) });
    }
  }
  return 'Не получилось ответить. Попробуйте переформулировать вопрос.';
}

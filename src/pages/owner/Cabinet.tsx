import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, photoUrl, useBusy } from '../../lib/data';
import { addDays, hm, nowLocal, slotsFor, weekday, zoned, type Slot } from '../../lib/schedule';
import { dayLabel, money, STATUS, whenLabel } from '../../lib/format';
import { ServiceInput, StudioSettings, type Booking, type Service } from '../../lib/schema';
import { useStudioCtx } from '../../components/Layout';

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function Cabinet() {
  const { isOwner } = useStudioCtx();
  const [session, setSession] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(!!s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === null) return <div className="view muted">Загружаем…</div>;
  if (!session) return <Login />;
  if (!isOwner) return <div className="view"><h2 className="big-h">Кабинет</h2><p className="muted">Этот аккаунт не владелец студии.</p><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Выйти</button></div>;
  return <Owner />;
}

function Login() {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) setErr('Неверная почта или пароль.');
  }
  async function reset() {
    if (!email) return setErr('Впишите почту, и мы пришлём ссылку для нового пароля.');
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href });
    setSent(true);
  }
  return (
    <form className="view narrow" onSubmit={submit}>
      <h2 className="big-h">Вход для владельца</h2>
      <label className="f">Почта<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
      <label className="f mt">Пароль<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
      <p className="err">{err}</p>
      <button className="btn wide" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      <p className="mt"><button type="button" className="lnk" onClick={reset}>Забыли пароль?</button>{sent && <span className="muted small"> Ссылка отправлена на почту.</span>}</p>
    </form>
  );
}

type Tab = 'list' | 'stats' | 'settings' | 'photos' | 'ai';

function Owner() {
  const { openChat } = useStudioCtx();
  const [tab, setTab] = useState<Tab>('list');
  const tabs: [Tab, string][] = [['list', 'Записи'], ['stats', 'Итоги'], ['settings', 'Настройки'], ['photos', 'Фото'], ['ai', 'Помощник']];
  return (
    <div className="view">
      <h2 className="big-h">Кабинет</h2>
      <div className="otabs" role="tablist">{tabs.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>)}</div>
      {tab === 'list' && <Bookings />}
      {tab === 'stats' && <Stats />}
      {tab === 'settings' && <Settings />}
      {tab === 'photos' && <Photos />}
      {tab === 'ai' && <div className="step"><h3>Помощник владельца</h3><p className="muted">Отвечает по вашим записям и оплатам. Сам ничего не меняет.</p><button className="btn" onClick={() => openChat('owner')}>Открыть помощника</button></div>}
      <p className="mt"><button className="lnk" onClick={() => supabase.auth.signOut()}>Выйти из кабинета</button></p>
    </div>
  );
}

function useOwnerBookings(from: string, to: string) {
  const { b } = useStudioCtx();
  return useQuery({
    queryKey: ['owner-bookings', b.studio.id, from, to],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('bookings').select('*').eq('studio_id', b.studio.id)
        .lt('starts_at', zoned(b.hours, addDays(to, 1), 0)).gt('ends_at', zoned(b.hours, from, 0)).order('starts_at');
      if (error) throw error;
      return data as Booking[];
    },
  });
}
const weekOf = (d: string) => { const a = addDays(d, -((weekday(d) + 6) % 7)); return [a, addDays(a, 6)] as const; };

function Bookings() {
  const { b } = useStudioCtx();
  const qc = useQueryClient();
  const [day, setDay] = useState(nowLocal(b.hours).date);
  const [span, setSpan] = useState<'day' | 'week'>('day');
  const [from, to] = span === 'day' ? [day, day] : weekOf(day);
  const q = useOwnerBookings(from, to);
  const [open, setOpen] = useState<{ id: string; kind: 'move' | 'pay' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const boxName = (id: string) => b.boxes.find((x) => x.id === id)?.name ?? '';
  const refresh = () => { qc.invalidateQueries({ queryKey: ['owner-bookings'] }); qc.invalidateQueries({ queryKey: ['busy'] }); };

  async function patch(x: Booking, p: Partial<Booking>, ok: string) {
    const { error } = await supabase.from('bookings').update(p).eq('id', x.id);
    setMsg(error ? (error.code === '23P01' ? 'Это время уже занято.' : 'Не получилось сохранить.') : ok);
    setOpen(null); refresh();
  }
  const list = q.data ?? [];
  return (
    <div>
      <div className="toolbar">
        <button className="btn sm ghost" onClick={() => setDay(addDays(day, span === 'day' ? -1 : -7))} aria-label="Назад">‹</button>
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button className="btn sm ghost" onClick={() => setDay(addDays(day, span === 'day' ? 1 : 7))} aria-label="Вперёд">›</button>
        <div className="chips"><button className="chip" aria-pressed={span === 'day'} onClick={() => setSpan('day')}>День</button><button className="chip" aria-pressed={span === 'week'} onClick={() => setSpan('week')}>Неделя</button></div>
        <button className="btn sm push" onClick={() => setAdding(true)}>+ Запись</button>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      {adding && <AddBooking onDone={(m) => { setAdding(false); if (m) setMsg(m); refresh(); }} />}
      <p className="muted small">{span === 'day' ? dayLabel(from) : `${dayLabel(from)} — ${dayLabel(to)}`} · записей: {list.filter((x) => x.status !== 'cancelled' && x.status !== 'refunded').length}</p>
      {q.isLoading ? <p className="muted">Загружаем…</p> : !list.length ? <div className="empty">Записей нет</div> : list.map((x) => (
        <div key={x.id} className="bk">
          <div className="bk-h"><b>{whenLabel(x.starts_at, b.hours.tz)} · {x.service_name}</b><span className={`tag ${x.status}`}>{STATUS[x.status]}</span></div>
          <div className="meta">{boxName(x.box_id)} · {money(x.price)}{x.paid ? ` · оплачено ${money(x.paid)}` : ''}<br />{x.client_name} · <a href={`tel:${x.client_phone.replace(/[^\d+]/g, '')}`}>{x.client_phone}</a> · {x.car}{x.source === 'owner' ? ' · добавлено вручную' : ''}</div>
          <div className="acts">
            {x.status === 'new' && <button className="btn sm" onClick={() => patch(x, { status: 'accepted' }, 'Запись принята')}>Принять</button>}
            {(x.status === 'new' || x.status === 'accepted') && <>
              <button className="btn sm ghost" onClick={() => patch(x, { status: 'done' }, 'Машина готова')}>Готово</button>
              <button className="btn sm ghost" onClick={() => setOpen({ id: x.id, kind: 'move' })}>Перенести</button>
              <Confirm label="Отменить" ask="Точно отменить?" onYes={() => patch(x, { status: 'cancelled' }, 'Запись отменена')} />
            </>}
            {x.status !== 'cancelled' && x.status !== 'refunded' && <button className="btn sm ghost" onClick={() => setOpen({ id: x.id, kind: 'pay' })}>{x.paid ? 'Изменить оплату' : 'Внести оплату'}</button>}
            {x.paid > 0 && <Confirm label="Возврат" ask={`Вернуть ${money(x.paid)}?`} onYes={() => patch(x, { status: 'refunded', refunded: x.paid, paid: 0 }, 'Возврат отмечен')} />}
          </div>
          {open?.id === x.id && open.kind === 'pay' && <PayForm x={x} onSave={(v) => patch(x, { paid: v }, 'Оплата сохранена')} onCancel={() => setOpen(null)} />}
          {open?.id === x.id && open.kind === 'move' && <MoveForm x={x} onSave={(s) => patch(x, { starts_at: s.startsAt, ends_at: s.endsAt, blocked_until: s.blockedUntil, box_id: s.boxId }, 'Запись перенесена')} onCancel={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}

function Confirm({ label, ask, onYes }: { label: string; ask: string; onYes: () => void }) {
  const [sure, setSure] = useState(false);
  return <button className="btn sm danger" onClick={() => (sure ? onYes() : setSure(true))}>{sure ? ask : label}</button>;
}

function PayForm({ x, onSave, onCancel }: { x: Booking; onSave: (v: number) => void; onCancel: () => void }) {
  const [v, setV] = useState(String(x.paid || x.price));
  return (
    <div className="inline grid2">
      <label className="f">Получено, ₴<input type="number" min={0} step={10} value={v} onChange={(e) => setV(e.target.value)} /></label>
      <div className="row-end"><button className="btn sm" onClick={() => onSave(Math.max(0, Math.round(+v || 0)))}>Сохранить</button><button className="btn sm ghost" onClick={onCancel}>Отмена</button></div>
    </div>
  );
}

function SlotPicker({ svc, excludeId, onPick }: { svc: Pick<Service, 'id' | 'duration_min' | 'days'>; excludeId?: string; onPick: (s: Slot | null) => void }) {
  const { b, slug } = useStudioCtx();
  const today = nowLocal(b.hours).date;
  const [date, setDate] = useState(today);
  const [sel, setSel] = useState<number | null>(null);
  const busyQ = useBusy(slug, b.hours, today);
  const own = useOwnerBookings(addDays(date, -7), addDays(date, 7)); // to skip the booking being moved
  const busy = useMemo(() => {
    const skip = own.data?.find((x) => x.id === excludeId);
    return (busyQ.data ?? []).filter((x) => !(skip && x.box_id === skip.box_id && x.starts_at === skip.starts_at));
  }, [busyQ.data, own.data, excludeId]);
  const slots = slotsFor(b.hours, svc, b.boxes.map((x) => x.id), busy, date, new Date(), 0);
  return (
    <div>
      <label className="f">Дата<input type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setSel(null); onPick(null); }} /></label>
      <div className="slots mt">{slots.length ? slots.map((s) => <button key={s.startMin} type="button" className="slot" aria-pressed={sel === s.startMin} onClick={() => { setSel(s.startMin); onPick(s); }}>{hm(s.startMin)}</button>) : <span className="muted small">Нет свободного времени</span>}</div>
    </div>
  );
}

function MoveForm({ x, onSave, onCancel }: { x: Booking; onSave: (s: Slot) => void; onCancel: () => void }) {
  const { b } = useStudioCtx();
  const svc = b.services.find((s) => s.id === x.service_id) ?? { id: '', days: 1, duration_min: Math.round((Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 60000) };
  const [pick, setPick] = useState<Slot | null>(null);
  return (
    <div className="inline"><b>Перенести на</b><div className="mt"><SlotPicker svc={svc} excludeId={x.id} onPick={setPick} /></div>
      <div className="row-end mt"><button className="btn sm" disabled={!pick} onClick={() => pick && onSave(pick)}>Перенести</button><button className="btn sm ghost" onClick={onCancel}>Отмена</button></div></div>
  );
}

function AddBooking({ onDone }: { onDone: (msg?: string) => void }) {
  const { b } = useStudioCtx();
  const [svcId, setSvcId] = useState(b.services[0]?.id ?? '');
  const svc = b.services.find((s) => s.id === svcId);
  const [pick, setPick] = useState<Slot | null>(null);
  const [f, setF] = useState({ name: '', phone: '', car: '' });
  const [err, setErr] = useState('');
  async function save() {
    if (!svc || !pick) return;
    if (!f.name.trim()) return setErr('Укажите имя клиента.');
    const { error } = await supabase.from('bookings').insert({
      studio_id: b.studio.id, box_id: pick.boxId, service_id: svc.id, service_name: svc.name, price: svc.price,
      starts_at: pick.startsAt, ends_at: pick.endsAt, blocked_until: pick.blockedUntil, status: 'accepted', source: 'owner',
      client_name: f.name.trim(), client_phone: f.phone.trim() || '—', car: f.car.trim() || '—',
    });
    if (error) return setErr(error.code === '23P01' ? 'Это время уже заняли.' : 'Не получилось сохранить.');
    onDone('Запись добавлена');
  }
  return (
    <div className="inline">
      <b>Новая запись</b>
      <div className="grid2 mt">
        <label className="f">Услуга<select value={svcId} onChange={(e) => { setSvcId(e.target.value); setPick(null); }}>{b.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="f">Имя клиента<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} /></label>
        <label className="f">Телефон<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} /></label>
        <label className="f">Автомобиль<input value={f.car} onChange={(e) => setF({ ...f, car: e.target.value })} maxLength={80} /></label>
      </div>
      {svc && <div className="mt"><SlotPicker key={svc.id} svc={svc} onPick={setPick} /></div>}
      <p className="err">{err}</p>
      <div className="row-end"><button className="btn sm" disabled={!pick} onClick={save}>Добавить</button><button className="btn sm ghost" onClick={() => onDone()}>Закрыть</button></div>
    </div>
  );
}

function Stats() {
  const { b } = useStudioCtx();
  const today = nowLocal(b.hours).date;
  const [a, z] = weekOf(today);
  const q = useOwnerBookings(a, z);
  const calc = (from: string, to: string) => {
    const l = (q.data ?? []).filter((x) => { const local = nowLocal(b.hours, new Date(x.starts_at)).date; return local >= from && local <= to; });
    return { cars: l.filter((x) => x.status !== 'cancelled' && x.status !== 'refunded').length, done: l.filter((x) => x.status === 'done').length, money: l.reduce((s, x) => s + x.paid, 0) };
  };
  const block = (title: string, s: ReturnType<typeof calc>) => (
    <><h3 className="h3">{title}</h3><div className="stats"><div className="stat"><small>Заездов</small><b>{s.cars}</b></div><div className="stat"><small>Завершено</small><b>{s.done}</b></div><div className="stat"><small>Получено</small><b>{money(s.money)}</b></div></div></>
  );
  if (q.isLoading) return <p className="muted">Загружаем…</p>;
  return <div>{block('Сегодня', calc(today, today))}<div style={{ height: 22 }} />{block('Эта неделя', calc(a, z))}<p className="muted small mt">«Получено» — по оплатам, отмеченным в записях. Возвраты не входят.</p></div>;
}

function Settings() {
  const { b } = useStudioCtx();
  const qc = useQueryClient();
  const [s, setS] = useState(() => structuredClone(b.studio.settings));
  const [boxes, setBoxes] = useState(() => b.boxes.map((x) => ({ id: x.id as string | undefined, name: x.name })));
  const [svcs, setSvcs] = useState(() => b.services.map((x) => ({ ...x, id: x.id as string | undefined })));
  const [holidays, setHolidays] = useState(s.holidays.join(', '));
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS({ ...s, [k]: v });

  async function save() {
    setMsg('');
    const next = { ...s, holidays: holidays.split(/[\s,]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) };
    const ok = StudioSettings.safeParse(next);
    if (!ok.success) return setMsg(ok.error.issues[0]?.message ?? 'Проверьте поля');
    for (const x of svcs) { const r = ServiceInput.safeParse(x); if (!r.success) return setMsg(`${x.name || 'Услуга'}: ${r.error.issues[0]?.message}`); }
    if (!boxes.some((x) => x.name.trim())) return setMsg('Нужен хотя бы один бокс.');
    setBusy(true);
    try {
      const sid = b.studio.id;
      const e1 = (await supabase.from('studios').update({ settings: ok.data }).eq('id', sid)).error; if (e1) throw e1;
      // Boxes and services that already have bookings are switched off, not deleted, so history stays intact.
      const keepBox = boxes.filter((x) => x.name.trim());
      for (const [i, x] of keepBox.entries()) {
        const r = x.id ? await supabase.from('boxes').update({ name: x.name.trim(), sort: i, active: true }).eq('id', x.id) : await supabase.from('boxes').insert({ studio_id: sid, name: x.name.trim(), sort: i });
        if (r.error) throw r.error;
      }
      const goneBoxes = b.boxes.filter((x) => !keepBox.some((k) => k.id === x.id)).map((x) => x.id);
      if (goneBoxes.length) await supabase.from('boxes').update({ active: false }).in('id', goneBoxes);
      for (const [i, x] of svcs.entries()) {
        const row = { name: x.name, description: x.description, price: x.price, duration_min: x.days > 1 ? 0 : x.duration_min, days: x.days, sort: i, active: true };
        const r = x.id ? await supabase.from('services').update(row).eq('id', x.id) : await supabase.from('services').insert({ ...row, studio_id: sid });
        if (r.error) throw r.error;
      }
      const goneSvcs = b.services.filter((x) => !svcs.some((k) => k.id === x.id)).map((x) => x.id);
      if (goneSvcs.length) await supabase.from('services').update({ active: false }).in('id', goneSvcs);
      await qc.invalidateQueries({ queryKey: ['studio'] });
      setMsg('Сохранено');
    } catch { setMsg('Не получилось сохранить.'); } finally { setBusy(false); }
  }

  const field = (k: 'name' | 'tagline' | 'address' | 'mapUrl' | 'phone' | 'telegram', label: string) =>
    <label className="f">{label}<input value={s[k]} onChange={(e) => set(k, e.target.value)} /></label>;
  return (
    <div>
      <div className="step"><h3>Студия</h3>
        <div className="grid2">{field('name', 'Название')}{field('tagline', 'Подзаголовок')}{field('address', 'Адрес')}{field('mapUrl', 'Ссылка на карту')}{field('phone', 'Телефон')}{field('telegram', 'Telegram')}</div>
        <label className="f mt">Описание<textarea value={s.about} onChange={(e) => set('about', e.target.value)} maxLength={600} /></label>
      </div>
      <div className="step"><h3>График</h3>
        <div className="grid2">
          <label className="f">Открываемся<input type="time" value={s.open} onChange={(e) => set('open', e.target.value)} /></label>
          <label className="f">Закрываемся<input type="time" value={s.close} onChange={(e) => set('close', e.target.value)} /></label>
          <label className="f">Пауза между машинами, мин<input type="number" min={0} value={s.bufferMin} onChange={(e) => set('bufferMin', +e.target.value || 0)} /></label>
          <label className="f">Отмена клиентом не позже, ч<input type="number" min={0} value={s.cancelHours} onChange={(e) => set('cancelHours', +e.target.value || 0)} /></label>
        </div>
        <p className="f mt">Выходные дни недели</p>
        <div className="chips">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" className="chip" aria-pressed={s.daysOff.includes(d)} onClick={() => set('daysOff', s.daysOff.includes(d) ? s.daysOff.filter((x) => x !== d) : [...s.daysOff, d])}>{WD[d]}</button>)}</div>
        <label className="f mt">Праздники (даты через запятую)<input value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2026-12-31, 2027-01-01" /></label>
      </div>
      <div className="step"><h3>Боксы</h3>
        {boxes.map((x, i) => <div key={i} className="row mt"><input className="grow" value={x.name} onChange={(e) => setBoxes(boxes.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /><button className="btn sm danger" onClick={() => setBoxes(boxes.filter((_, j) => j !== i))} aria-label="Убрать бокс">✕</button></div>)}
        <button className="btn sm ghost mt" onClick={() => setBoxes([...boxes, { id: undefined, name: `Бокс ${boxes.length + 1}` }])}>+ Бокс</button>
      </div>
      <div className="step"><h3>Услуги</h3>
        {svcs.map((x, i) => {
          const up = (p: Partial<typeof x>) => setSvcs(svcs.map((y, j) => (j === i ? { ...y, ...p } : y)));
          return (
            <div key={i} className="svc-ed">
              <label className="f">Название<input value={x.name} onChange={(e) => up({ name: e.target.value })} /></label>
              <label className="f">Цена, ₴<input type="number" min={0} value={x.price} onChange={(e) => up({ price: Math.max(0, Math.round(+e.target.value || 0)) })} /></label>
              <label className="f">Минут<input type="number" min={10} step={5} disabled={x.days > 1} value={x.days > 1 ? '' : x.duration_min} onChange={(e) => up({ duration_min: Math.round(+e.target.value || 0) })} /></label>
              <label className="f">Дней<input type="number" min={1} max={7} value={x.days} onChange={(e) => up({ days: Math.min(7, Math.max(1, Math.round(+e.target.value || 1))) })} /></label>
              <button className="btn sm danger" onClick={() => setSvcs(svcs.filter((_, j) => j !== i))} aria-label="Удалить услугу">✕</button>
              <label className="f full">Описание<input value={x.description} onChange={(e) => up({ description: e.target.value })} /></label>
            </div>
          );
        })}
        <button className="btn sm ghost mt" onClick={() => setSvcs([...svcs, { id: undefined, studio_id: b.studio.id, name: 'Новая услуга', description: '', price: 500, duration_min: 60, days: 1, sort: svcs.length, active: true }])}>+ Услуга</button>
      </div>
      <div className="step"><h3>Карточки на главной</h3>
        {s.cards.map((c, i) => <div key={i} className="grid2 mt">
          <label className="f">Заголовок {i + 1}<input value={c.title} onChange={(e) => set('cards', s.cards.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} /></label>
          <label className="f">Текст<input value={c.text} onChange={(e) => set('cards', s.cards.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} /></label></div>)}
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      <div className="savebar"><button className="btn" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button></div>
    </div>
  );
}

function Photos() {
  const { b } = useStudioCtx();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(b.photos.map((p) => [p.id, p.caption])));
  const sid = b.studio.id;
  const done = async (m: string) => { setMsg(m); await qc.invalidateQueries({ queryKey: ['studio'] }); };
  async function upload(file: File) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${sid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('studio-photos').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) throw error;
    return path;
  }
  const guard = (fn: () => Promise<void>) => fn().catch(() => setMsg('Не получилось загрузить файл.'));
  const pick = (cb: (f: File) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) cb(f); };

  return (
    <div>
      {msg && <p className="note" role="status">{msg}</p>}
      <div className="step"><h3>Главное фото и логотип</h3>
        <div className="ph"><img src={photoUrl(b.studio.settings.heroPath)} alt="" /><div><span className="muted small">Большое фото на главной</span>
          <div className="acts"><label className="btn sm ghost">Заменить фото<input type="file" accept="image/*" hidden onChange={pick((f) => guard(async () => {
            const path = await upload(f);
            const { error } = await supabase.from('studios').update({ settings: { ...b.studio.settings, heroPath: path } }).eq('id', sid);
            if (error) throw error; await done('Главное фото заменено');
          }))} /></label>
          <label className="btn sm ghost">Логотип и иконка<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick((f) => guard(async () => {
            const path = await upload(f);
            const { error } = await supabase.from('studios').update({ settings: { ...b.studio.settings, logoPath: path } }).eq('id', sid);
            if (error) throw error; await done('Логотип обновлён. Иконка на телефоне сменится при следующей установке.');
          }))} /></label></div></div></div>
      </div>
      <div className="step"><h3>Фото работ</h3>
        {b.photos.length === 0 && <div className="empty">Фото работ пока нет</div>}
        {b.photos.map((p) => (
          <div key={p.id} className="ph">
            <img src={photoUrl(p.path)} alt="" />
            <div>
              <label className="f">Подпись<input value={caps[p.id] ?? ''} onChange={(e) => setCaps({ ...caps, [p.id]: e.target.value })} maxLength={120} /></label>
              <div className="acts">
                <button className="btn sm ghost" onClick={() => guard(async () => { const { error } = await supabase.from('work_photos').update({ caption: caps[p.id] ?? '' }).eq('id', p.id); if (error) throw error; await done('Подпись сохранена'); })}>Сохранить подпись</button>
                {/* Replacing touches only this card; the other photos stay as they are. */}
                <label className="btn sm ghost">Заменить фото<input type="file" accept="image/*" hidden onChange={pick((f) => guard(async () => { const path = await upload(f); const { error } = await supabase.from('work_photos').update({ path }).eq('id', p.id); if (error) throw error; await done('Фото заменено'); }))} /></label>
                <Confirm label="Удалить" ask="Точно удалить?" onYes={() => guard(async () => { const { error } = await supabase.from('work_photos').delete().eq('id', p.id); if (error) throw error; await done('Карточка удалена'); })} />
              </div>
            </div>
          </div>
        ))}
        <label className="btn sm mt">+ Добавить карточку<input type="file" accept="image/*" hidden onChange={pick((f) => guard(async () => {
          const path = await upload(f);
          const { error } = await supabase.from('work_photos').insert({ studio_id: sid, path, caption: 'Новая работа', sort: b.photos.length });
          if (error) throw error; await done('Карточка добавлена');
        }))} /></label>
      </div>
    </div>
  );
}


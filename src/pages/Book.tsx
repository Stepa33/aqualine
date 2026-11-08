import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, contact, saveToken, useBusy } from '../lib/data';
import { addDays, hm, nowLocal, slotsFor, type Slot } from '../lib/schedule';
import { dayLabel, duration, icsFile, money } from '../lib/format';
import { useStudioCtx } from '../components/Layout';
import { tgFirstName, tgHaptic, tgInitData } from '../lib/tg';

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function Book() {
  const { b, slug } = useStudioCtx();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const today = nowLocal(b.hours).date;
  const busyQ = useBusy(slug, b.hours, today);
  const busy = busyQ.data ?? [];
  const boxIds = b.boxes.map((x) => x.id);

  const [svcId, setSvcId] = useState(params.get('service') ?? '');
  const [date, setDate] = useState<string | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const saved = contact.get();
  const [name, setName] = useState<string>(saved.name ?? tgFirstName());
  const [phone, setPhone] = useState<string>(saved.phone ?? '');
  const [car, setCar] = useState<string>(saved.car ?? '');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<null | { slot: Slot; svcName: string; price: number }>(null);
  const requestId = useRef(crypto.randomUUID()); // one id per attempt: a second tap returns the same booking

  const svc = b.services.find((x) => x.id === svcId);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const slots = useMemo(() => (svc && date ? slotsFor(b.hours, svc, boxIds, busy, date) : []), [svc, date, busy, b.hours, boxIds]);
  const slot = slots.find((x) => x.startMin === start) ?? null;
  const live = b.studio.status === 'live';

  async function confirm() {
    setErr('');
    if (!svc || !slot) return setErr('Выберите услугу и время.');
    if (!name.trim() || !phone.trim() || !car.trim()) return setErr('Заполните имя, телефон и автомобиль.');
    contact.set({ name, phone, car });
    setPending(true);
    try {
      const r = await api<{ id: string; token: string }>('/api/book', { slug, serviceId: svc.id, date: slot.date, startMin: slot.startMin, name, phone, car, requestId: requestId.current, tgInitData: tgInitData() });
      saveToken(slug, r.id, r.token);
      setDone({ slot, svcName: svc.name, price: svc.price });
      tgHaptic('success');
      requestId.current = crypto.randomUUID();
      qc.invalidateQueries({ queryKey: ['busy', slug] });
    } catch (e) {
      const ex = e as Error & { code?: string };
      setErr(ex.message);
      if (ex.code === 'taken') { setStart(null); busyQ.refetch(); }
    } finally { setPending(false); }
  }

  if (done) {
    const s = b.studio.settings;
    const ics = icsFile({ title: `${s.name}: ${done.svcName}`, start: done.slot.startsAt, end: done.slot.endsAt, location: s.address, details: s.phone ? `Телефон студии: ${s.phone}` : '' });
    return (
      <div className="view">
        <h2 className="big-h">Вы записаны</h2>
        <div className="bk"><div className="bk-h"><b>{done.svcName}</b><span className="tag new">Новая</span></div>
          <div className="meta">{dayLabel(done.slot.date)}, {hm(done.slot.startMin)}{done.slot.dates.length > 1 && ` · до ${dayLabel(done.slot.dates.at(-1)!)}`} · {money(done.price)}</div></div>
        <div className="step"><h3>Напомнить за сутки?</h3>
          <p className="muted" style={{ margin: '0 0 14px' }}>{tgInitData() ? 'Бот пришлёт напоминание в Telegram за сутки. Можно ещё добавить запись в календарь.' : 'Добавьте запись в календарь телефона — напоминание за сутки уже включено в файл.'}</p>
          <a className="btn" href={ics} download="zapis.ics">Добавить в календарь</a>{' '}
          <Link className="btn ghost" to={`/s/${slug}/my`}>Моя запись</Link></div>
      </div>
    );
  }

  return (
    <div className="view">
      <h2 className="big-h">Запись в студию</h2>
      <div className="step"><h3><i>1</i>Услуга</h3>
        {b.services.map((x) => (
          <label key={x.id} className="pickrow">
            <input type="radio" name="svc" checked={svcId === x.id} onChange={() => { setSvcId(x.id); setStart(null); }} />
            <span>{x.name}<small>{duration(x)} · {x.description}</small></span><span className="pp">{money(x.price)}</span>
          </label>
        ))}
      </div>
      <div className="step"><h3><i>2</i>День</h3>
        <div className="hscroll">
          {days.map((d, i) => {
            const has = svc ? slotsFor(b.hours, svc, boxIds, busy, d).length > 0 : true;
            const dt = new Date(`${d}T12:00:00Z`);
            return (
              <button key={d} type="button" className="day" aria-pressed={date === d} disabled={!has} onClick={() => { setDate(d); setStart(null); }}>
                <small>{i === 0 ? 'сегодня' : i === 1 ? 'завтра' : WD[dt.getUTCDay()]}</small><b>{dt.getUTCDate()}</b><small>{MON[dt.getUTCMonth()]}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="step"><h3><i>3</i>Время</h3>
        {!svc ? <p className="muted m0">Сначала выберите услугу.</p> : !date ? <p className="muted m0">Выберите день.</p> : busyQ.isLoading ? <p className="muted m0">Загружаем свободное время…</p> :
          !slots.length ? <p className="muted m0">На этот день свободного времени нет.</p> : (
            <>
              {svc.days > 1 && <div className="note">Машина остаётся у нас {svc.days} рабочих дня: {slots[0]!.dates.map(dayLabel).join(' и ')}.</div>}
              <div className="slots">{slots.map((x) => <button key={x.startMin} type="button" className="slot" aria-pressed={start === x.startMin} onClick={() => setStart(x.startMin)}>{hm(x.startMin)}</button>)}</div>
            </>
          )}
      </div>
      <div className="step"><h3><i>4</i>Контакты</h3>
        <div className="grid2">
          <label className="f">Имя<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} /></label>
          <label className="f">Телефон<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="+380" maxLength={20} /></label>
        </div>
        <label className="f mt">Автомобиль<input value={car} onChange={(e) => setCar(e.target.value)} placeholder="Марка, модель, цвет" maxLength={80} /></label>
      </div>
      <div className="step"><h3><i>5</i>Проверьте и подтвердите</h3>
        <div className="sum">
          <div><span>Услуга</span><span>{svc?.name ?? '—'}</span></div>
          <div><span>Когда</span><span>{slot ? `${dayLabel(slot.date)}, ${hm(slot.startMin)}` : '—'}</span></div>
          <div><span>Стоимость</span><span>{svc ? money(svc.price) : '—'}</span></div>
        </div>
        <p className="err" aria-live="polite">{err}</p>
        <button className="btn wide" type="button" disabled={!slot || pending || !live} onClick={confirm}>
          {!live ? 'Запись откроется после запуска студии' : pending ? 'Сохраняем…' : 'Подтвердить запись'}
        </button>
      </div>
    </div>
  );
}

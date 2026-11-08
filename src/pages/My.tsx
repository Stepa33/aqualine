import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, myTokens } from '../lib/data';
import { icsFile, money, STATUS, whenLabel } from '../lib/format';
import { useStudioCtx } from '../components/Layout';

type Mine = { id: string; client_token: string; service_name: string; price: number; starts_at: string; ends_at: string; status: string; car: string; boxes: { name: string } | null };

export function My() {
  const { b, slug } = useStudioCtx();
  const qc = useQueryClient();
  const tokens = myTokens(slug);
  const q = useQuery({ queryKey: ['my', slug, tokens.length], queryFn: () => api<{ bookings: Mine[] }>('/api/my', { slug, tokens: tokens.map((t) => t.token) }) });
  const [sure, setSure] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const s = b.studio.settings;
  const list = q.data?.bookings ?? [];
  const now = Date.now();
  const active = list.filter((x) => (x.status === 'new' || x.status === 'accepted') && Date.parse(x.ends_at) > now);
  const past = list.filter((x) => !active.includes(x)).reverse();
  const cancellable = (x: Mine) => Date.parse(x.starts_at) - now >= s.cancelHours * 3_600_000;

  async function cancel(x: Mine) {
    if (sure !== x.id) return setSure(x.id);
    try { await api('/api/cancel', { id: x.id, token: x.client_token }); setMsg('Запись отменена'); qc.invalidateQueries({ queryKey: ['my', slug] }); qc.invalidateQueries({ queryKey: ['busy', slug] }); }
    catch (e) { setMsg((e as Error).message); }
    setSure(null);
  }

  const card = (x: Mine, isActive: boolean) => (
    <div key={x.id} className="bk">
      <div className="bk-h"><b>{x.service_name}</b><span className={`tag ${x.status}`}>{STATUS[x.status]}</span></div>
      <div className="meta">{whenLabel(x.starts_at, b.hours.tz)}{x.boxes?.name ? ` · ${x.boxes.name}` : ''}<br />{money(x.price)} · {x.car}</div>
      {isActive && (
        <div className="acts">
          <a className="btn sm ghost" href={icsFile({ title: `${s.name}: ${x.service_name}`, start: x.starts_at, end: x.ends_at, location: s.address })} download="zapis.ics">В календарь</a>
          {cancellable(x)
            ? <button className="btn sm danger" type="button" onClick={() => cancel(x)}>{sure === x.id ? 'Точно отменить?' : 'Отменить'}</button>
            : <span className="muted small">Отмена не позже чем за {s.cancelHours} ч{s.phone ? `, звоните ${s.phone}` : ''}</span>}
        </div>
      )}
    </div>
  );

  return (
    <div className="view">
      <h2 className="big-h">Моя запись</h2>
      {msg && <p className="note" role="status">{msg}</p>}
      {q.isLoading ? <p className="muted">Загружаем…</p> : q.isError ? <p className="err">Не удалось загрузить записи.</p> :
        active.length ? active.map((x) => card(x, true)) : <div className="empty">Активных записей нет.<br /><br /><Link className="btn" to={`/s/${slug}/book`}>Записаться</Link></div>}
      {past.length > 0 && <div className="sec"><div className="sec-h"><h2>История</h2></div>{past.map((x) => card(x, false))}</div>}
      <p className="muted small mt">Записи хранятся на этом устройстве. С другого телефона их не будет видно.</p>
    </div>
  );
}

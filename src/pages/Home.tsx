import { Link } from 'react-router-dom';
import { photoUrl } from '../lib/data';
import { duration, money } from '../lib/format';
import { useReveal, useStudioCtx } from '../components/Layout';

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function Home() {
  const { b, slug } = useStudioCtx();
  const s = b.studio.settings;
  useReveal(b);
  return (
    <div className="view">
      <div className="hero">
        <img src={photoUrl(s.heroPath)} alt="" />
        <div className="hero-txt">
          <div><h1>{s.name}</h1><p>{s.tagline}</p></div>
          {/* The glass button lives inside the photo, so it scrolls with it and only blurs the photo behind it. */}
          <Link className="cta glass" to={`/s/${slug}/book`}>Записаться</Link>
        </div>
      </div>
      {s.about && <p className="about rv">{s.about}</p>}
      <div className="sec rv"><div className="cards">{s.cards.map((c, i) => <div key={i} className="card"><b>{c.title}</b><span>{c.text}</span></div>)}</div></div>
      <div className="sec rv">
        <div className="sec-h"><h2>Услуги и цены</h2><Link to={`/s/${slug}/services`}>Все услуги</Link></div>
        {b.services.slice(0, 4).map((x) => (
          <div key={x.id} className="svc"><b>{x.name}</b><span className="p">{money(x.price)}<small className="muted">{duration(x)}</small></span><small>{x.description}</small></div>
        ))}
      </div>
      {b.photos.length > 0 && (
        <div className="sec rv"><div className="sec-h"><h2>Наши работы</h2></div>
          <div className="works">{b.photos.map((p) => <figure key={p.id} className="work"><img src={photoUrl(p.path)} alt={p.caption} loading="lazy" /><figcaption>{p.caption}</figcaption></figure>)}</div>
        </div>
      )}
      <div className="sec rv info">
        <div className="card"><b>Адрес</b><span>{s.address || 'Не указан'}{s.mapUrl && <><br /><a href={s.mapUrl} target="_blank" rel="noopener">Открыть на карте</a></>}</span></div>
        <div className="card"><b>Время работы</b><span>{s.open}–{s.close}<br />{s.daysOff.length ? `Выходные: ${s.daysOff.map((d) => WD[d]).join(', ')}` : 'Без выходных'}</span></div>
        <div className="card"><b>Связь</b><span>{s.phone ? <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>{s.phone}</a> : 'Телефон не указан'}{s.telegram && <><br /><a href={`https://t.me/${s.telegram.replace(/^@/, '')}`} target="_blank" rel="noopener">Telegram</a></>}</span></div>
      </div>
      <div className="sec rv">
        <h2 className="big-h">Запись в студию</h2>
        <p className="muted" style={{ margin: '-6px 0 18px' }}>Выберите услугу и свободное время. Подтверждение сразу.</p>
        <Link className="btn" to={`/s/${slug}/book`}>Выбрать время</Link>
      </div>
    </div>
  );
}

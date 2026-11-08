import { Link } from 'react-router-dom';
import { duration, money } from '../lib/format';
import { useReveal, useStudioCtx } from '../components/Layout';

export function Services() {
  const { b, slug } = useStudioCtx();
  useReveal(b);
  return (
    <div className="view">
      <h2 className="big-h">Услуги</h2>
      {b.services.map((x) => (
        <div key={x.id} className="svc rv">
          <b>{x.name}</b>
          <span className="p">{money(x.price)}<small className="muted">{duration(x)}</small></span>
          <small>{x.description}</small>
          <Link className="btn sm go" to={`/s/${slug}/book?service=${x.id}`}>Записаться</Link>
        </div>
      ))}
    </div>
  );
}

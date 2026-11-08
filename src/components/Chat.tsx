import { useEffect, useRef, useState } from 'react';
import { PaperPlaneRight, X } from '@phosphor-icons/react';
import { api } from '../lib/data';

type Msg = { role: 'user' | 'assistant'; content: string };
const EXAMPLES = {
  client: ['Когда ближайшее окно?', 'Сколько стоит полировка?', 'Как найти студию?'],
  owner: ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?'],
};
const history: Record<string, Msg[]> = {};

export function Chat({ role, slug, onClose }: { role: 'client' | 'owner'; slug: string; onClose: () => void }) {
  const key = `${slug}:${role}`;
  const [msgs, setMsgs] = useState<Msg[]>(history[key] ?? []);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  useEffect(() => { history[key] = msgs; list.current?.scrollTo({ top: 1e9 }); }, [msgs, key]);
  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, []);
  const close = () => { onClose(); (opener.current as HTMLElement | null)?.focus?.(); };

  async function ask(q: string) {
    q = q.trim().slice(0, 500);
    if (!q || busy) return;
    const next = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await api<{ text: string }>('/api/assistant', { slug, role, messages: next.slice(-10) }, role === 'owner');
      setMsgs([...next, { role: 'assistant', content: r.text || 'Не получилось ответить.' }]);
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: (e as Error).message || 'Помощник временно недоступен.' }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="scrim" onClick={close} />
      <section className="sheet glass" role="dialog" aria-modal="true" aria-label="Помощник">
        <header>
          <div><b>{role === 'client' ? 'Помощник' : 'Помощник владельца'}</b><small>{role === 'client' ? 'Цены, свободное время, адрес' : 'Записи, машины, деньги'}</small></div>
          <button className="x" type="button" aria-label="Закрыть" onClick={close}><X size={18} /></button>
        </header>
        <div className="msgs" ref={list} aria-live="polite">
          {!msgs.length && <div className="msg ai">{role === 'client' ? 'Здравствуйте! Спросите про цены, свободное время или как нас найти.' : 'Спросите про записи, машины за период или полученные деньги.'}</div>}
          {msgs.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'ai'}`}>{m.content}</div>)}
          {busy && <div className="msg ai wait">Думаю…</div>}
        </div>
        <div className="chips">{EXAMPLES[role].map((q) => <button key={q} type="button" className="chip" onClick={() => ask(q)} disabled={busy}>{q}</button>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Напишите вопрос" maxLength={500} />
          <button className="btn" type="submit" aria-label="Отправить" disabled={busy}><PaperPlaneRight size={18} /></button>
        </form>
      </section>
    </>
  );
}

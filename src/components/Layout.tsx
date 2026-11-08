import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { tgApp } from '../lib/tg';
import { CalendarCheck, ChatCircleDots, House, ListBullets, ChartBar } from '@phosphor-icons/react';
import { photoUrl, supabase, useStudio, type StudioBundle } from '../lib/data';
import { isWorkday, nowLocal, toMin } from '../lib/schedule';
import { Chat } from './Chat';

export type Ctx = { b: StudioBundle; slug: string; isOwner: boolean; openChat: (role: 'client' | 'owner') => void };
export const useStudioCtx = () => useOutletContext<Ctx>();

/** Fade-in on scroll; skipped when the device asks for reduced motion. */
export function useReveal(dep: unknown) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.rv:not(.in)')];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.05 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

export function Layout() {
  const { slug = '' } = useParams();
  const loc = useLocation();
  const q = useStudio(slug);
  const [chat, setChat] = useState<null | 'client' | 'owner'>(null);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user || !q.data) return setIsOwner(false);
      const { data: s } = await supabase.from('studios').select('id').eq('id', q.data.studio.id).eq('owner_id', data.user.id).maybeSingle();
      setIsOwner(!!s);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => sub.subscription.unsubscribe();
  }, [q.data]);

  useEffect(() => { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) window.scrollTo({ top: 0 }); }, [loc.pathname]);
  const navigate = useNavigate();
  // Inside Telegram: show Telegram's own "Back" button on every page except the home page.
  useEffect(() => {
    if (!tgApp) return;
    const back = () => navigate(-1);
    const home = /^\/s\/[^/]+\/?$/.test(loc.pathname);
    if (home) tgApp.BackButton.hide(); else tgApp.BackButton.show();
    tgApp.BackButton.onClick(back);
    return () => tgApp?.BackButton.offClick(back);
  }, [loc.pathname, navigate]);
  useEffect(() => { if (q.data) document.title = `${q.data.studio.settings.name} — запись`; }, [q.data]);

  if (q.isLoading) return <div className="wrap center muted">Загружаем…</div>;
  if (q.isError) return <div className="wrap center">Не удалось загрузить студию. Проверьте интернет и обновите страницу.</div>;
  if (!q.data) return <div className="wrap center">Студия не найдена.</div>;

  const b = q.data, s = b.studio.settings, n = nowLocal(b.hours);
  const open = isWorkday(b.hours, n.date) && n.min >= toMin(s.open) && n.min < toMin(s.close);
  const base = `/s/${slug}`;

  return (
    <>
      <div className="bgfx" aria-hidden="true" />
      <div className="wrap">
        <header className="top">
          <NavLink to={`${base}/`} className="logo">{s.logoPath ? <img src={photoUrl(s.logoPath)} alt="" /> : <i />}<span>{s.name}</span></NavLink>
          <span className="status"><i style={{ background: open ? 'var(--ok)' : '#6b7280' }} />{open ? `Открыто до ${s.close}` : 'Закрыто'}</span>
        </header>
        {b.studio.status === 'draft' && <p className="mode">Это образец студии: запись пока выключена.</p>}
        <main><Outlet context={{ b, slug, isOwner, openChat: setChat } satisfies Ctx} /></main>
      </div>
      <nav className="nav glass" aria-label="Разделы">
        <NavLink end to={`${base}/`}><House size={22} />Главная</NavLink>
        <NavLink to={`${base}/services`}><ListBullets size={22} />Услуги</NavLink>
        <NavLink to={`${base}/my`}><CalendarCheck size={22} />Моя запись</NavLink>
        {isOwner && <NavLink to={`${base}/owner`}><ChartBar size={22} />Кабинет</NavLink>}
      </nav>
      <button className="ask glass" type="button" aria-label="Помощник" onClick={() => setChat(loc.pathname.endsWith('/owner') && isOwner ? 'owner' : 'client')}><ChatCircleDots size={26} /></button>
      {chat && <Chat role={chat} slug={slug} onClose={() => setChat(null)} />}
    </>
  );
}

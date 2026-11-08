/** Telegram Mini App helpers. Everything is a no-op when the site is opened in a normal browser. */
type WebApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string } };
  ready(): void; expand(): void;
  setHeaderColor(c: string): void; setBackgroundColor(c: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { notificationOccurred(t: 'success' | 'error' | 'warning'): void };
};
declare global { interface Window { Telegram?: { WebApp?: WebApp } } }

export const tgApp: WebApp | null = typeof window !== 'undefined' && window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;

export function initTelegram() {
  if (!tgApp) return;
  tgApp.ready();
  tgApp.expand();
  try { tgApp.setHeaderColor('#07080a'); tgApp.setBackgroundColor('#07080a'); } catch { /* older Telegram */ }
  document.documentElement.classList.add('in-tg');
}

export const tgFirstName = () => tgApp?.initDataUnsafe.user?.first_name ?? '';
export const tgInitData = () => tgApp?.initData || undefined;
export const tgHaptic = (t: 'success' | 'error') => tgApp?.HapticFeedback?.notificationOccurred(t);

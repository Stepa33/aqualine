import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Services } from './pages/Services';
import { Book } from './pages/Book';
import { My } from './pages/My';
import { Cabinet } from './pages/owner/Cabinet';
import { initTelegram } from './lib/tg';

registerSW({ immediate: true });
initTelegram();
// Liquid-glass refraction: only Chromium renders SVG filters behind elements; others get plain frosted glass.
if ((navigator as Navigator & { userAgentData?: unknown }).userAgentData && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('lgx');

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
const fallback = import.meta.env.VITE_DEFAULT_STUDIO || 'aqualine';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to={`/s/${fallback}/`} replace /> },
  {
    path: '/s/:slug',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'services', element: <Services /> },
      { path: 'book', element: <Book /> },
      { path: 'my', element: <My /> },
      { path: 'owner', element: <Cabinet /> },
    ],
  },
  { path: '*', element: <Navigate to={`/s/${fallback}/`} replace /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/server.js';

/** Per-studio install manifest: its own name, address /s/<slug>/ and icon. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = String(req.query.slug ?? process.env.VITE_DEFAULT_STUDIO ?? '').toLowerCase();
  let name = 'Запись в студию', icon192 = '/icon-192.png', icon512 = '/icon-512.png';
  if (/^[a-z0-9-]{2,40}$/.test(slug)) {
    const { data } = await db().from('studios').select('id, settings').eq('slug', slug).maybeSingle();
    if (data) {
      name = data.settings?.name ?? name;
      const logo = data.settings?.logoPath as string | undefined;
      if (logo) {
        const url = db().storage.from('studio-photos').getPublicUrl(logo).data.publicUrl;
        icon192 = icon512 = url;
      }
    }
  }
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    name, short_name: name.slice(0, 12),
    start_url: slug ? `/s/${slug}/` : '/', scope: slug ? `/s/${slug}/` : '/', id: slug ? `/s/${slug}/` : '/',
    display: 'standalone', background_color: '#07080a', theme_color: '#07080a', lang: 'ru',
    icons: [
      { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  });
}

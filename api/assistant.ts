import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { allowAI, runAssistant } from './_lib/assistant.js';
import { clientKey, loadStudio, only, ownerOf } from './_lib/server.js';

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  role: z.enum(['client', 'owner']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1000) })).min(1).max(16),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!only('POST', req, res)) return;
  const p = Body.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'invalid' });
  const { slug, role, messages } = p.data;
  const b = await loadStudio(slug);
  if (!b) return res.status(404).json({ error: 'studio_not_found' });
  if (role === 'owner' && !(await ownerOf(req, b.studio.id))) return res.status(401).json({ error: 'owner_only' });
  if (!(await allowAI(`${slug}:${role}:${clientKey(req)}`))) return res.status(429).json({ error: 'rate_limited', message: 'Слишком много вопросов. Подождите несколько минут.' });
  try {
    return res.status(200).json({ text: await runAssistant(b, role, messages) });
  } catch {
    return res.status(502).json({ error: 'ai_failed', message: 'Помощник временно недоступен.' });
  }
}

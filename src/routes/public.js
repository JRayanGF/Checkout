import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { createCheckout, getPublicOrder, getQuote, httpError } from '../services/orders.js';

export const publicRouter = Router();

const checkoutLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const slugSchema = z.string().regex(/^[a-z0-9-]{2,60}$/);

const productFields = 'slug, name, description, image_url, original_cents, price_cents, max_installments';

publicRouter.get('/products', async (_req, res) => {
  res.json((await query(`SELECT ${productFields} FROM products WHERE active ORDER BY id DESC`)).rows);
});

publicRouter.get('/products/:slug', async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);
  const p = (await query(`SELECT ${productFields} FROM products WHERE slug=$1 AND active`, [slug])).rows[0];
  if (!p) throw httpError(404, 'Produto não encontrado');
  res.json(p);
});

publicRouter.post('/quote', checkoutLimiter, async (req, res) => {
  const body = z.object({ slug: slugSchema, quantity: z.number().int().min(1).max(99), coupon: z.string().max(40).nullish() }).parse(req.body);
  res.json(await getQuote(body));
});

const checkoutSchema = z.object({
  clientKey: z.string().min(16).max(64),
  slug: slugSchema,
  quantity: z.number().int().min(1).max(99),
  coupon: z.string().max(40).nullish(),
  consent: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar a Política de Privacidade' }) }),
  customer: z.object({
    name: z.string().trim().min(3).max(120),
    document: z.string().max(20),
    email: z.string().email().max(160),
    phone: z.string().min(10).max(20),
  }),
});

publicRouter.post('/checkout', checkoutLimiter, async (req, res) => {
  res.status(201).json(await createCheckout(checkoutSchema.parse(req.body)));
});

publicRouter.get('/orders/:publicId', async (req, res) => {
  const id = z.string().regex(/^PED-[A-F0-9]{16}$/).parse(req.params.publicId);
  res.json(await getPublicOrder(id));
});

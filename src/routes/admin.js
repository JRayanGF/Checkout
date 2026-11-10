import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { httpError } from '../services/orders.js';
import { maskDocument } from '../utils/cpfCnpj.js';

export const adminRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const COOKIE = 'admin_session';
const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: config.env === 'production', maxAge: 8 * 3600 * 1000, path: '/' };

// Hash fictício para manter o tempo de resposta igual quando o e-mail não existe.
const DUMMY_HASH = bcrypt.hashSync('senha-ficticia-para-tempo-constante', 12);

adminRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = z.object({ email: z.string().email().max(160), password: z.string().min(1).max(200) }).parse(req.body);
  const admin = (await query('SELECT * FROM admins WHERE email=$1', [email.toLowerCase()])).rows[0];
  const ok = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !ok) throw httpError(401, 'E-mail ou senha incorretos');
  const token = jwt.sign({ sub: admin.id, email: admin.email }, config.jwtSecret, { expiresIn: '8h' });
  res.cookie(COOKIE, token, cookieOpts).json({ email: admin.email });
});

adminRouter.post('/logout', (_req, res) => res.clearCookie(COOKIE, { path: '/' }).json({ ok: true }));

// Tudo abaixo exige sessão válida.
adminRouter.use((req, _res, next) => {
  try {
    req.admin = jwt.verify(req.cookies[COOKIE] || '', config.jwtSecret);
    next();
  } catch {
    next(httpError(401, 'Sessão expirada. Entre novamente.'));
  }
});

adminRouter.get('/me', (req, res) => res.json({ email: req.admin.email }));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined));
const filterSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'refunded']).optional().or(z.literal('').transform(() => undefined)),
  from: date, to: date, q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

function orderFilters(f) {
  const w = [], p = [];
  if (f.status) { p.push(f.status); w.push(`o.status=$${p.length}`); }
  if (f.from) { p.push(f.from); w.push(`o.created_at >= $${p.length}::date`); }
  if (f.to) { p.push(f.to); w.push(`o.created_at < ($${p.length}::date + 1)`); }
  if (f.q) { p.push(`%${f.q}%`); w.push(`(o.public_id ILIKE $${p.length} OR c.name ILIKE $${p.length} OR c.email ILIKE $${p.length})`); }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

const orderSelect = `SELECT o.id, o.public_id, o.status, o.payment_method, o.quantity, o.unit_cents, o.discount_cents, o.total_cents, o.created_at,
  c.name AS customer_name, c.email AS customer_email, p.name AS product_name, cp.code AS coupon_code
  FROM orders o JOIN customers c ON c.id=o.customer_id JOIN products p ON p.id=o.product_id LEFT JOIN coupons cp ON cp.id=o.coupon_id`;

adminRouter.get('/stats', async (req, res) => {
  const f = filterSchema.parse(req.query);
  const { where, params } = orderFilters({ from: f.from, to: f.to });
  const base = where;
  const totals = (await query(
    `SELECT COUNT(*)::int AS orders,
            COALESCE(SUM(total_cents) FILTER (WHERE status='approved'),0)::bigint AS sold_cents,
            COUNT(*) FILTER (WHERE status='approved')::int AS approved,
            COUNT(*) FILTER (WHERE status='pending')::int AS pending,
            COUNT(*) FILTER (WHERE status IN ('rejected','cancelled'))::int AS rejected
     FROM orders o ${base}`, params)).rows[0];
  const byDay = (await query(
    `SELECT to_char(o.created_at::date,'YYYY-MM-DD') AS day, COALESCE(SUM(total_cents) FILTER (WHERE status='approved'),0)::bigint AS sold_cents
     FROM orders o ${base} GROUP BY 1 ORDER BY 1 DESC LIMIT 30`, params)).rows;
  res.json({ ...totals, sold_cents: Number(totals.sold_cents), byDay: byDay.map((d) => ({ ...d, sold_cents: Number(d.sold_cents) })) });
});

adminRouter.get('/orders', async (req, res) => {
  const f = filterSchema.parse(req.query);
  const { where, params } = orderFilters(f);
  const total = (await query(`SELECT COUNT(*)::int AS n FROM orders o JOIN customers c ON c.id=o.customer_id ${where}`, params)).rows[0].n;
  const rows = (await query(`${orderSelect} ${where} ORDER BY o.id DESC LIMIT 25 OFFSET ${(f.page - 1) * 25}`, params)).rows;
  res.json({ total, page: f.page, pageSize: 25, rows });
});

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmulas no Excel
  return `"${s.replace(/"/g, '""')}"`;
};

adminRouter.get('/orders.csv', async (req, res) => {
  const f = filterSchema.parse(req.query);
  const { where, params } = orderFilters(f);
  const rows = (await query(`${orderSelect} ${where} ORDER BY o.id DESC LIMIT 20000`, params)).rows;
  const head = ['Pedido', 'Data', 'Status', 'Forma', 'Produto', 'Qtd', 'Subtotal', 'Desconto', 'Total', 'Cupom', 'Cliente', 'E-mail'];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([r.public_id, new Date(r.created_at).toISOString(), r.status, r.payment_method, r.product_name, r.quantity,
      (r.unit_cents * r.quantity / 100).toFixed(2), (r.discount_cents / 100).toFixed(2), (r.total_cents / 100).toFixed(2),
      r.coupon_code, r.customer_name, r.customer_email].map(csvCell).join(';'));
  }
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pedidos.csv"' }).send('\uFEFF' + lines.join('\r\n'));
});

adminRouter.get('/orders/:id', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const order = (await query(`${orderSelect} WHERE o.id=$1`, [id])).rows[0];
  if (!order) throw httpError(404, 'Pedido não encontrado');
  const payments = (await query('SELECT mp_payment_id, method, status, status_detail, installments, created_at FROM payments WHERE order_id=$1 ORDER BY id', [id])).rows;
  const logs = (await query('SELECT event, detail, created_at FROM transaction_logs WHERE order_id=$1 ORDER BY id', [id])).rows;
  res.json({ order, payments, logs });
});

adminRouter.get('/logs', async (_req, res) => {
  res.json((await query('SELECT l.id, l.event, l.detail, l.created_at, o.public_id FROM transaction_logs l LEFT JOIN orders o ON o.id=l.order_id ORDER BY l.id DESC LIMIT 200')).rows);
});

// ---- Produtos ----
const productSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/, 'Use letras minúsculas, números e hífens'),
  name: z.string().trim().min(2).max(120),
  description: z.string().max(2000).default(''),
  image_url: z.string().max(500).refine((v) => v === '' || /^https:\/\//.test(v), 'A imagem deve começar com https://').default(''),
  original_cents: z.number().int().min(0).max(100_000_000),
  price_cents: z.number().int().min(0).max(100_000_000),
  max_installments: z.number().int().min(1).max(12).default(12),
  active: z.boolean().default(true),
});

adminRouter.get('/products', async (_req, res) => res.json((await query('SELECT * FROM products ORDER BY id DESC')).rows));

adminRouter.post('/products', async (req, res) => {
  const p = productSchema.parse(req.body);
  try {
    const r = await query(
      `INSERT INTO products(slug,name,description,image_url,original_cents,price_cents,max_installments,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [p.slug, p.name, p.description, p.image_url, p.original_cents, p.price_cents, p.max_installments, p.active]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'Já existe um produto com esse endereço (slug)');
    throw e;
  }
});

adminRouter.put('/products/:id', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const p = productSchema.parse(req.body);
  const r = await query(
    `UPDATE products SET slug=$2,name=$3,description=$4,image_url=$5,original_cents=$6,price_cents=$7,max_installments=$8,active=$9,updated_at=now() WHERE id=$1 RETURNING *`,
    [id, p.slug, p.name, p.description, p.image_url, p.original_cents, p.price_cents, p.max_installments, p.active]);
  if (!r.rows[0]) throw httpError(404, 'Produto não encontrado');
  res.json(r.rows[0]);
});

// ---- Cupons ----
const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Use 3 a 30 letras, números, _ ou -'),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().min(1),
  max_uses: z.number().int().min(1).nullish(),
  expires_at: z.string().datetime({ offset: true }).nullish().or(z.literal('').transform(() => null)),
  active: z.boolean().default(true),
}).refine((c) => c.type !== 'percent' || c.value <= 100, { message: 'Percentual máximo é 100', path: ['value'] });

adminRouter.get('/coupons', async (_req, res) => res.json((await query('SELECT * FROM coupons ORDER BY id DESC')).rows));

adminRouter.post('/coupons', async (req, res) => {
  const c = couponSchema.parse(req.body);
  try {
    const r = await query('INSERT INTO coupons(code,type,value,max_uses,expires_at,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [c.code, c.type, c.value, c.max_uses ?? null, c.expires_at ?? null, c.active]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'Já existe um cupom com esse código');
    throw e;
  }
});

adminRouter.put('/coupons/:id', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const c = couponSchema.parse(req.body);
  const r = await query('UPDATE coupons SET code=$2,type=$3,value=$4,max_uses=$5,expires_at=$6,active=$7 WHERE id=$1 RETURNING *',
    [id, c.code, c.type, c.value, c.max_uses ?? null, c.expires_at ?? null, c.active]);
  if (!r.rows[0]) throw httpError(404, 'Cupom não encontrado');
  res.json(r.rows[0]);
});

// ---- Clientes (LGPD: CPF/CNPJ mascarado na listagem; anonimização sob pedido do titular) ----
adminRouter.get('/customers', async (req, res) => {
  const q = z.string().max(80).optional().parse(req.query.q);
  const params = q ? [`%${q}%`] : [];
  const rows = (await query(
    `SELECT c.id, c.name, c.document, c.email, c.phone, c.created_at, c.anonymized_at,
            COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_cents) FILTER (WHERE o.status='approved'),0)::bigint AS spent_cents
     FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
     ${q ? 'WHERE c.name ILIKE $1 OR c.email ILIKE $1' : ''} GROUP BY c.id ORDER BY c.id DESC LIMIT 200`, params)).rows;
  res.json(rows.map((r) => ({ ...r, document: maskDocument(r.document), spent_cents: Number(r.spent_cents) })));
});

adminRouter.post('/customers/:id/anonymize', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const r = await query(
    `UPDATE customers SET name='Cliente anonimizado', document='00000000000', email='anon-' || id || '@anonimizado.invalid',
            phone='00000000000', address=NULL, anonymized_at=now() WHERE id=$1 RETURNING id`, [id]);
  if (!r.rows[0]) throw httpError(404, 'Cliente não encontrado');
  res.json({ ok: true });
});

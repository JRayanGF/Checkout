import crypto from 'node:crypto';
import { pool, query } from '../db.js';
import { config } from '../config.js';
import { documentType, onlyDigits } from '../utils/cpfCnpj.js';
import { couponIsUsable, computeTotals } from '../utils/money.js';
import { sendPaymentApprovedEmail } from '../mailer.js';

export const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

/** Registro de auditoria. Nunca grave token de cartão, CPF/CNPJ ou dados de pagamento aqui. */
export const log = (orderId, event, detail = {}) =>
  query('INSERT INTO transaction_logs(order_id, event, detail) VALUES($1,$2,$3)', [orderId, event, JSON.stringify(detail)]).catch((e) =>
    console.error('falha ao gravar log', e.message),
  );

export async function getQuote({ slug, quantity, coupon }) {
  const prod = (await query('SELECT * FROM products WHERE slug=$1 AND active', [slug])).rows[0];
  if (!prod) throw httpError(404, 'Produto não encontrado');
  let c = null;
  if (coupon) {
    c = (await query('SELECT * FROM coupons WHERE code=$1', [coupon.trim().toUpperCase()])).rows[0];
    if (!couponIsUsable(c)) throw httpError(400, 'Cupom inválido, expirado ou esgotado');
  }
  return { ...computeTotals(prod.price_cents, quantity, c), coupon: c ? c.code : null };
}

export async function createCheckout(input) {
  const existing = (await query('SELECT public_id FROM orders WHERE client_key=$1', [input.clientKey])).rows[0];
  if (existing) return getPublicOrder(existing.public_id);

  const prod = (await query('SELECT * FROM products WHERE slug=$1 AND active', [input.slug])).rows[0];
  if (!prod) throw httpError(404, 'Produto não encontrado');
  if (!documentType(input.customer.document)) throw httpError(400, 'CPF/CNPJ inválido');
  const doc = onlyDigits(input.customer.document);

  const publicId = 'PED-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const client = await pool.connect();
  let order;
  try {
    await client.query('BEGIN');
    let coupon = null;
    if (input.coupon) {
      coupon = (await client.query('SELECT * FROM coupons WHERE code=$1 FOR UPDATE', [input.coupon.trim().toUpperCase()])).rows[0];
      if (!couponIsUsable(coupon)) throw httpError(400, 'Cupom inválido, expirado ou esgotado');
      await client.query('UPDATE coupons SET used_count = used_count + 1 WHERE id=$1', [coupon.id]);
    }
    const t = computeTotals(prod.price_cents, input.quantity, coupon);
    if (t.total < 100) throw httpError(400, 'Valor total inválido');

    const cust = await client.query(
      `INSERT INTO customers(name, document, email, phone, consent_at)
       VALUES($1,$2,$3,$4, now())
       ON CONFLICT (email, document) DO UPDATE
         SET name=EXCLUDED.name, phone=EXCLUDED.phone, consent_at=now(), anonymized_at=NULL
       RETURNING id`,
      [input.customer.name.trim(), doc, input.customer.email.toLowerCase(), onlyDigits(input.customer.phone)],
    );
    const o = await client.query(
      `INSERT INTO orders(public_id, client_key, customer_id, product_id, quantity, unit_cents, discount_cents, total_cents, coupon_id, payment_method)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pix') RETURNING *`,
      [publicId, input.clientKey, cust.rows[0].id, prod.id, input.quantity, prod.price_cents, t.discount, t.total, coupon?.id ?? null],
    );
    await client.query('COMMIT');
    order = o.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505' && String(e.constraint).includes('client_key')) {
      const again = (await query('SELECT public_id FROM orders WHERE client_key=$1', [input.clientKey])).rows[0];
      if (again) return getPublicOrder(again.public_id);
    }
    throw e;
  } finally {
    client.release();
  }
  await log(order.id, 'order_created', { publicId, method: 'pix', totalCents: order.total_cents });
  return getPublicOrder(publicId);
}

const TRANSITIONS = { pending: ['approved', 'cancelled'], approved: ['refunded'] };

/** Altera o status de um pedido (confirmação manual do Pix no painel). Idempotente e protegido contra transições inválidas. */
export async function setOrderStatus(orderId, newStatus, actor) {
  const c = await pool.connect();
  let from;
  try {
    await c.query('BEGIN');
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!o) throw httpError(404, 'Pedido não encontrado');
    if (o.status === newStatus) { await c.query('COMMIT'); return; }
    if (!TRANSITIONS[o.status]?.includes(newStatus)) throw httpError(400, 'Esta alteração de status não é permitida');
    from = o.status;
    await c.query('UPDATE orders SET status=$2, updated_at=now() WHERE id=$1', [orderId, newStatus]);
    if (o.coupon_id && o.status === 'pending' && newStatus === 'cancelled') {
      await c.query('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id=$1', [o.coupon_id]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await log(orderId, 'status_changed', { from, to: newStatus, by: actor });

  if (newStatus === 'approved') {
    try {
      const r = (await query(
        `SELECT cu.name, cu.email, o.public_id, o.total_cents, p.name AS product_name
         FROM orders o JOIN customers cu ON cu.id=o.customer_id JOIN products p ON p.id=o.product_id WHERE o.id=$1`, [orderId])).rows[0];
      await sendPaymentApprovedEmail({ to: r.email, name: r.name, publicId: r.public_id, productName: r.product_name, totalCents: r.total_cents });
      await log(orderId, 'email_sent', {});
    } catch (e) {
      await log(orderId, 'email_failed', { message: e.message });
    }
  }
}

export async function getPublicOrder(publicId) {
  const r = (await query(
    `SELECT o.public_id, o.status, o.total_cents, p.name AS product_name
     FROM orders o JOIN products p ON p.id=o.product_id WHERE o.public_id=$1`, [publicId])).rows[0];
  if (!r) throw httpError(404, 'Pedido não encontrado');
  return {
    publicId: r.public_id,
    status: r.status,
    method: 'pix',
    totalCents: r.total_cents,
    productName: r.product_name,
    pix: r.status === 'pending' ? { key: config.pixKey, name: config.pixName || null } : null,
  };
}

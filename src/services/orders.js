import crypto from 'node:crypto';
import { pool, query } from '../db.js';
import { config } from '../config.js';
import { mpCreatePayment, mpGetPayment } from '../mp.js';
import { documentType, onlyDigits } from '../utils/cpfCnpj.js';
import { couponIsUsable, computeTotals, toReais } from '../utils/money.js';
import { sendPaymentApprovedEmail } from '../mailer.js';

export const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

/** Registro de auditoria. Nunca grave token de cartão, CPF/CNPJ ou dados de pagamento aqui. */
export const log = (orderId, event, detail = {}) =>
  query('INSERT INTO transaction_logs(order_id, event, detail) VALUES($1,$2,$3)', [orderId, event, JSON.stringify(detail)]).catch((e) =>
    console.error('falha ao gravar log', e.message),
  );

export function mapStatus(mpStatus) {
  switch (mpStatus) {
    case 'approved': return 'approved';
    case 'pending': case 'in_process': case 'authorized': case 'in_mediation': return 'pending';
    case 'rejected': return 'rejected';
    case 'cancelled': return 'cancelled';
    case 'refunded': case 'charged_back': return 'refunded';
    default: return 'pending';
  }
}

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
  const docType = documentType(input.customer.document);
  if (!docType) throw httpError(400, 'CPF/CNPJ inválido');
  const doc = onlyDigits(input.customer.document);
  const addr = input.customer.address || {};
  if (input.method === 'card' && !input.card) throw httpError(400, 'Dados do cartão ausentes');
  if (input.method === 'boleto') {
    for (const k of ['zip_code', 'street_name', 'street_number', 'neighborhood', 'city', 'federal_unit']) {
      if (!addr[k]) throw httpError(400, 'Preencha o endereço completo para gerar o boleto');
    }
  }

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
      `INSERT INTO customers(name, document, email, phone, address, consent_at)
       VALUES($1,$2,$3,$4,$5, now())
       ON CONFLICT (email, document) DO UPDATE
         SET name=EXCLUDED.name, phone=EXCLUDED.phone,
             address=COALESCE(EXCLUDED.address, customers.address), consent_at=now(), anonymized_at=NULL
       RETURNING id`,
      [input.customer.name.trim(), doc, input.customer.email.toLowerCase(), onlyDigits(input.customer.phone), Object.keys(addr).length ? JSON.stringify(addr) : null],
    );
    const o = await client.query(
      `INSERT INTO orders(public_id, client_key, customer_id, product_id, quantity, unit_cents, discount_cents, total_cents, coupon_id, payment_method)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [publicId, input.clientKey, cust.rows[0].id, prod.id, input.quantity, prod.price_cents, t.discount, t.total, coupon?.id ?? null, input.method],
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
  await log(order.id, 'order_created', { publicId, method: input.method, totalCents: order.total_cents });

  const [firstName, ...rest] = input.customer.name.trim().split(/\s+/);
  const payer = {
    email: input.customer.email,
    first_name: firstName,
    last_name: rest.join(' ') || firstName,
    identification: { type: docType, number: doc },
  };
  const base = {
    transaction_amount: toReais(order.total_cents),
    description: `${prod.name} x${input.quantity}`.slice(0, 200),
    external_reference: publicId,
    notification_url: `${config.appUrl}/api/webhooks/mercadopago`,
    payer,
  };
  let body;
  if (input.method === 'pix') {
    body = { ...base, payment_method_id: 'pix' };
  } else if (input.method === 'boleto') {
    body = {
      ...base,
      payment_method_id: 'bolbradesco',
      payer: { ...payer, address: { zip_code: onlyDigits(addr.zip_code), street_name: addr.street_name, street_number: String(addr.street_number), neighborhood: addr.neighborhood, city: addr.city, federal_unit: addr.federal_unit } },
    };
  } else {
    body = {
      ...base,
      token: input.card.token,
      installments: Math.min(input.card.installments, prod.max_installments),
      payment_method_id: input.card.payment_method_id,
      issuer_id: input.card.issuer_id ? Number(input.card.issuer_id) : undefined,
    };
  }

  let mp;
  try {
    mp = await mpCreatePayment(body, publicId);
  } catch (e) {
    await log(order.id, 'mp_create_failed', { status: e.status, message: e.mp?.message || e.message });
    await cancelOrder(order.id);
    throw httpError(502, 'Não foi possível processar o pagamento agora. Revise os dados e tente novamente.');
  }
  await applyPaymentStatus(order.id, mp, input.method);
  return getPublicOrder(publicId);
}

async function cancelOrder(orderId) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (o && o.status === 'pending') {
      await c.query("UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1", [orderId]);
      if (o.coupon_id) await c.query('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id=$1', [o.coupon_id]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(e);
  } finally {
    c.release();
  }
}

/** Atualiza pagamento e pedido de forma idempotente (webhook, polling e criação usam a mesma função). */
export async function applyPaymentStatus(orderId, mp, method) {
  const newStatus = mapStatus(mp.status);
  const c = await pool.connect();
  let becameApproved = false;
  let changed = false;
  try {
    await c.query('BEGIN');
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    const td = mp.point_of_interaction?.transaction_data;
    const safeRaw = {
      id: mp.id, status: mp.status, status_detail: mp.status_detail,
      payment_method_id: mp.payment_method_id, payment_type_id: mp.payment_type_id, transaction_amount: mp.transaction_amount,
    };
    await c.query(
      `INSERT INTO payments(order_id, mp_payment_id, method, status, status_detail, installments, pix_qr_code, pix_qr_base64, boleto_url, raw)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (mp_payment_id) DO UPDATE
         SET status=EXCLUDED.status, status_detail=EXCLUDED.status_detail, raw=EXCLUDED.raw, updated_at=now()`,
      [orderId, String(mp.id), method || o.payment_method, mp.status, mp.status_detail ?? null, mp.installments ?? null,
        td?.qr_code ?? null, td?.qr_code_base64 ?? null, mp.transaction_details?.external_resource_url ?? null, JSON.stringify(safeRaw)],
    );

    if (Math.round(Number(mp.transaction_amount) * 100) !== o.total_cents) {
      await c.query('COMMIT');
      await log(orderId, 'amount_mismatch', { expected: o.total_cents, received: mp.transaction_amount });
      return;
    }

    const allowed = o.status === 'pending' || (o.status === 'approved' && newStatus === 'refunded');
    if (allowed && o.status !== newStatus) {
      await c.query('UPDATE orders SET status=$2, updated_at=now() WHERE id=$1', [orderId, newStatus]);
      if (o.coupon_id && o.status === 'pending' && ['rejected', 'cancelled'].includes(newStatus)) {
        await c.query('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id=$1', [o.coupon_id]);
      }
      becameApproved = newStatus === 'approved';
      changed = true;
    }
    await c.query('COMMIT');
    if (changed) await log(orderId, 'status_changed', { from: o.status, to: newStatus, mpStatus: mp.status, detail: mp.status_detail });
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  if (becameApproved) {
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

export async function getPublicOrder(publicId, { reconcile = false } = {}) {
  const q = () => query(
    `SELECT o.id, o.public_id, o.status, o.payment_method, o.total_cents, p.name AS product_name,
            pay.mp_payment_id, pay.status_detail, pay.pix_qr_code, pay.pix_qr_base64, pay.boleto_url, pay.updated_at AS pay_updated
     FROM orders o JOIN products p ON p.id=o.product_id
     LEFT JOIN LATERAL (SELECT * FROM payments WHERE order_id=o.id ORDER BY id DESC LIMIT 1) pay ON true
     WHERE o.public_id=$1`, [publicId]);
  let r = (await q()).rows[0];
  if (!r) throw httpError(404, 'Pedido não encontrado');

  // Rede de segurança caso o webhook atrase: consulta o Mercado Pago no máximo a cada 10 s.
  if (reconcile && r.status === 'pending' && r.mp_payment_id && Date.now() - new Date(r.pay_updated).getTime() > 10_000) {
    try {
      await applyPaymentStatus(r.id, await mpGetPayment(r.mp_payment_id));
      r = (await q()).rows[0];
    } catch (e) {
      console.error('reconciliação falhou', e.message);
    }
  }
  return {
    publicId: r.public_id,
    status: r.status,
    method: r.payment_method,
    totalCents: r.total_cents,
    productName: r.product_name,
    statusDetail: r.status_detail,
    pix: r.status === 'pending' && r.pix_qr_code ? { code: r.pix_qr_code, qrBase64: r.pix_qr_base64 } : null,
    boletoUrl: r.status === 'pending' ? r.boleto_url : null,
  };
}

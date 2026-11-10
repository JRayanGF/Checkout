import { config } from './config.js';

const BASE = 'https://api.mercadopago.com';

async function mpFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.mpAccessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Mercado Pago respondeu ${res.status}: ${data.message || data.error || 'erro'}`);
    err.status = res.status;
    err.mp = { message: data.message, cause: data.cause };
    throw err;
  }
  return data;
}

export const mpCreatePayment = (body, idempotencyKey) =>
  mpFetch('/v1/payments', { method: 'POST', body: JSON.stringify(body), headers: { 'X-Idempotency-Key': idempotencyKey } });

export const mpGetPayment = (id) => mpFetch(`/v1/payments/${encodeURIComponent(id)}`);

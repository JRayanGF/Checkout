import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { mpGetPayment } from '../mp.js';
import { verifyWebhookSignature } from '../utils/signature.js';
import { applyPaymentStatus, log } from '../services/orders.js';

export const webhookRouter = Router();

webhookRouter.post('/mercadopago', async (req, res) => {
  const dataId = String(req.query['data.id'] ?? req.body?.data?.id ?? '');
  const valid = verifyWebhookSignature({
    xSignature: req.get('x-signature'),
    xRequestId: req.get('x-request-id'),
    dataId,
    secret: config.mpWebhookSecret,
  });
  if (!valid) {
    await log(null, 'webhook_invalid_signature', { ip: req.ip });
    return res.sendStatus(401);
  }
  const type = req.body?.type ?? req.query.type;
  if (type !== 'payment' || !dataId) return res.sendStatus(200);

  try {
    // Nunca confiamos no corpo da notificação: consultamos o pagamento direto na API.
    const mp = await mpGetPayment(dataId);
    const order = (await query('SELECT id FROM orders WHERE public_id=$1', [mp.external_reference])).rows[0];
    if (!order) {
      await log(null, 'webhook_unknown_order', { paymentId: dataId });
      return res.sendStatus(200);
    }
    await applyPaymentStatus(order.id, mp);
    await query('INSERT INTO webhook_events(event_key, payload) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      `${dataId}:${req.get('x-request-id') ?? ''}`, JSON.stringify({ type, id: dataId }),
    ]);
    res.sendStatus(200);
  } catch (e) {
    console.error('erro no webhook', e.message);
    res.sendStatus(500); // o Mercado Pago tentará novamente
  }
});

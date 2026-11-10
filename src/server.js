import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { publicRouter } from './routes/public.js';
import { webhookRouter } from './routes/webhook.js';
import { adminRouter } from './routes/admin.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const mp = ['https://*.mercadopago.com', 'https://*.mercadopago.com.br', 'https://*.mercadolibre.com', 'https://*.mlstatic.com'];
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://sdk.mercadopago.com', ...mp],
      styleSrc: ["'self'", "'unsafe-inline'", ...mp],
      imgSrc: ["'self'", 'data:', 'https:'],
      frameSrc: mp,
      connectSrc: ["'self'", ...mp],
      fontSrc: ["'self'", 'data:', ...mp],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

app.use('/api/webhooks', webhookRouter);
app.use('/api/admin', adminRouter);
app.use('/api', publicRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// Express 5 encaminha erros de handlers async para este middleware automaticamente.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues[0]?.message || 'Dados inválidos', field: err.issues[0]?.path?.join('.') });
  }
  if (err.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
});

const server = app.listen(config.port, () => console.log(`Checkout rodando em ${config.appUrl} (porta ${config.port})`));
const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

import 'dotenv/config';

const required = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Variável de ambiente ausente: ${k} (veja .env.example)`);
  return v;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appUrl: required('APP_URL').replace(/\/$/, ''),
  jwtSecret: required('JWT_SECRET'),
  mpAccessToken: required('MP_ACCESS_TOKEN'),
  mpPublicKey: required('MP_PUBLIC_KEY'),
  mpWebhookSecret: required('MP_WEBHOOK_SECRET'),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || 'pedidos@localhost',
  },
};

if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres');
required('DATABASE_URL');

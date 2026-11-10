import nodemailer from 'nodemailer';
import { config } from './config.js';

let transporter;
const getTransporter = () => {
  if (!config.smtp.host) return null;
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendPaymentApprovedEmail({ to, name, publicId, productName, totalCents }) {
  const t = getTransporter();
  if (!t) return;
  const total = (totalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  await t.sendMail({
    from: config.smtp.from,
    to,
    subject: `Pagamento confirmado — pedido ${publicId}`,
    html: `<p>Olá, ${esc(name)}!</p><p>Recebemos o pagamento do pedido <b>${esc(publicId)}</b> (${esc(productName)}) no valor de <b>${total}</b>.</p><p>Obrigado pela compra.</p>`,
  });
}

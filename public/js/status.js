const publicId = new URLSearchParams(location.search).get('o') || '';
let timer;

const VIEWS = {
  approved: { title: 'Pagamento aprovado', text: 'Recebemos seu pagamento. Enviamos a confirmação para o seu e-mail.', tone: 'text-moss-dark' },
  pending: { title: 'Pagamento pendente', text: 'Estamos aguardando a confirmação. Esta página atualiza sozinha.', tone: 'text-amber-700' },
  rejected: { title: 'Pagamento recusado', text: 'A operadora não aprovou o pagamento. Confira os dados ou use outra forma de pagamento.', tone: 'text-red-700' },
  cancelled: { title: 'Pedido cancelado', text: 'Este pedido foi cancelado ou expirou. Você pode fazer um novo pedido.', tone: 'text-red-700' },
  refunded: { title: 'Pagamento estornado', text: 'O valor deste pedido foi devolvido.', tone: 'text-slate-700' },
};

function render(o) {
  const v = VIEWS[o.status] || VIEWS.pending;
  let extra = '';
  if (o.status === 'pending' && o.pix) extra = `<img alt="QR Code do Pix" class="mx-auto mt-4 h-48 w-48" src="data:image/png;base64,${esc(o.pix.qrBase64)}"><textarea readonly rows="3" class="field mt-3 text-xs">${esc(o.pix.code)}</textarea>`;
  if (o.status === 'pending' && o.boletoUrl && /^https:\/\//.test(o.boletoUrl)) extra = `<a class="btn mt-5" target="_blank" rel="noopener" href="${esc(o.boletoUrl)}">Abrir boleto</a>`;
  if (['rejected', 'cancelled'].includes(o.status)) extra = `<a class="btn mt-5" href="/">Tentar novamente</a>`;
  $('#box').innerHTML = `
    <h1 class="font-display text-2xl ${v.tone}">${v.title}</h1>
    <p class="mt-2 text-sm text-slate-600">${v.text}</p>
    <dl class="mt-6 space-y-1 text-left text-sm">
      <div class="flex justify-between"><dt>Pedido</dt><dd class="font-mono">${esc(o.publicId)}</dd></div>
      <div class="flex justify-between"><dt>Produto</dt><dd>${esc(o.productName)}</dd></div>
      <div class="flex justify-between"><dt>Total</dt><dd>${brl(o.totalCents)}</dd></div>
    </dl>${extra}`;
}

async function load() {
  try {
    const o = await api('/orders/' + encodeURIComponent(publicId));
    render(o);
    if (o.status !== 'pending') clearInterval(timer);
  } catch (e) {
    clearInterval(timer);
    $('#box').textContent = e.status === 404 || e.status === 400 ? 'Pedido não encontrado.' : 'Não foi possível consultar o pedido agora.';
  }
}
load();
timer = setInterval(load, 5000);

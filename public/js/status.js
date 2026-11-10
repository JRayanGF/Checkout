const publicId = new URLSearchParams(location.search).get('o') || '';
let timer;

const VIEWS = {
  approved: { title: 'Pagamento confirmado', text: 'Recebemos seu pagamento. Obrigado pela compra!', tone: 'text-moss-dark' },
  pending: { title: 'Falta só o pagamento', text: 'Copie a chave Pix abaixo, pague no app do seu banco e volte aqui. Esta página atualiza sozinha quando confirmarmos.', tone: 'text-amber-700' },
  rejected: { title: 'Pagamento não confirmado', text: 'Não conseguimos confirmar este pagamento. Faça um novo pedido ou fale com a loja.', tone: 'text-red-700' },
  cancelled: { title: 'Pedido cancelado', text: 'Este pedido foi cancelado. Você pode fazer um novo pedido.', tone: 'text-red-700' },
  refunded: { title: 'Pagamento estornado', text: 'O valor deste pedido foi devolvido.', tone: 'text-slate-700' },
};

const BANKS = [
  ['Nubank', 'https://app.nubank.com.br/'], ['Itaú', 'https://www.itau.com.br/'], ['Bradesco', 'https://banco.bradesco/'],
  ['Banco do Brasil', 'https://www.bb.com.br/'], ['Caixa', 'https://www.caixa.gov.br/'], ['Inter', 'https://inter.co/'],
  ['Santander', 'https://www.santander.com.br/'], ['C6 Bank', 'https://www.c6bank.com.br/'],
];

function pixBlock(o) {
  return `
    <div class="mt-6 rounded-xl border border-line bg-paper p-4 text-left">
      <p class="text-xs uppercase tracking-wide text-slate-500">Chave Pix${o.pix.name ? ' · ' + esc(o.pix.name) : ''}</p>
      <p id="pixKey" class="mt-1 break-all font-mono text-sm">${esc(o.pix.key)}</p>
      <button id="copyKey" type="button" class="btn mt-3 w-full">Copiar chave Pix</button>
      <p class="mt-4 text-xs uppercase tracking-wide text-slate-500">Valor a pagar</p>
      <p class="font-display text-2xl">${brl(o.totalCents)}</p>
      <button id="copyAmount" type="button" class="btn-ghost mt-2 w-full">Copiar valor</button>
    </div>
    <p class="mt-6 text-sm font-medium">Agora abra seu banco e cole a chave em Pix → Pagar → Chave:</p>
    <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      ${BANKS.map(([n, u]) => `<a class="btn-ghost !px-2 !py-2 text-center text-xs" target="_blank" rel="noopener" href="${esc(u)}">${esc(n)}</a>`).join('')}
    </div>
    <p class="mt-3 text-xs text-slate-500">Se o seu banco não aparecer, abra o app dele normalmente. No celular, o link costuma abrir o aplicativo.</p>`;
}

function render(o) {
  const v = VIEWS[o.status] || VIEWS.pending;
  let extra = '';
  if (o.status === 'pending' && o.pix) extra = pixBlock(o);
  if (['rejected', 'cancelled'].includes(o.status)) extra = `<a class="btn mt-5" href="/">Fazer novo pedido</a>`;
  $('#box').innerHTML = `
    <h1 class="font-display text-2xl ${v.tone}">${v.title}</h1>
    <p class="mt-2 text-sm text-slate-600">${v.text}</p>
    <dl class="mt-6 space-y-1 text-left text-sm">
      <div class="flex justify-between"><dt>Pedido</dt><dd class="font-mono">${esc(o.publicId)}</dd></div>
      <div class="flex justify-between"><dt>Produto</dt><dd>${esc(o.productName)}</dd></div>
      <div class="flex justify-between"><dt>Total</dt><dd>${brl(o.totalCents)}</dd></div>
    </dl>${extra}`;
  const copy = (id, text, label) => {
    const b = $(id); if (!b) return;
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = '✓ Copiado'; }
      catch { b.textContent = 'Selecione e copie manualmente'; }
      setTimeout(() => (b.textContent = label), 2500);
    });
  };
  if (o.pix) {
    copy('#copyKey', o.pix.key, 'Copiar chave Pix');
    copy('#copyAmount', (o.totalCents / 100).toFixed(2).replace('.', ','), 'Copiar valor');
  }
}

let lastSig = '';
async function load() {
  try {
    const o = await api('/orders/' + encodeURIComponent(publicId));
    const sig = o.status + o.totalCents;
    if (sig !== lastSig) { lastSig = sig; render(o); } // não redesenha à toa, para não perder o "Copiado"
    if (o.status !== 'pending') clearInterval(timer);
  } catch (e) {
    clearInterval(timer);
    $('#box').textContent = e.status === 404 || e.status === 400 ? 'Pedido não encontrado.' : 'Não foi possível consultar o pedido agora.';
  }
}
load();
timer = setInterval(load, 8000);

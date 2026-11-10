const slug = new URLSearchParams(location.search).get('p') || '';
let product, cfg, quote, method = 'pix', brick = null, clientKey = crypto.randomUUID(), couponApplied = null, busy = false, pollTimer;

const showError = (msg) => { const e = $('#error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); if (msg) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

async function init() {
  try {
    [product, cfg] = await Promise.all([api('/products/' + encodeURIComponent(slug)), api('/config')]);
  } catch {
    $('#loading').textContent = 'Produto não encontrado ou indisponível.';
    return;
  }
  document.title = product.name + ' — Pagamento';
  $('#pName').textContent = product.name;
  $('#pDesc').textContent = product.description;
  $('#pPrice').textContent = brl(product.price_cents);
  if (product.original_cents > product.price_cents) $('#pOriginal').textContent = brl(product.original_cents);
  if (product.image_url) $('#productImg').innerHTML = `<img src="${esc(product.image_url)}" alt="" class="aspect-[4/3] w-full rounded-lg object-cover">`;
  $('#loading').classList.add('hidden');
  $('#content').classList.remove('hidden');
  await refreshQuote();
}

async function refreshQuote() {
  const qty = Math.min(99, Math.max(1, parseInt($('#qty').value, 10) || 1));
  try {
    quote = await api('/quote', { method: 'POST', body: { slug, quantity: qty, coupon: couponApplied } });
  } catch (e) {
    couponApplied = null;
    setCouponMsg(e.message, true);
    quote = await api('/quote', { method: 'POST', body: { slug, quantity: qty } });
  }
  $('#sSub').textContent = brl(quote.subtotal);
  $('#sDisc').textContent = quote.discount ? '− ' + brl(quote.discount) : brl(0);
  $('#sTotal').textContent = brl(quote.total);
  if (method === 'card') mountCard();
}

function setCouponMsg(text, bad) { const m = $('#couponMsg'); m.textContent = text; m.className = 'mt-1 text-sm ' + (bad ? 'text-red-700' : 'text-moss-dark'); }

$('#qty').addEventListener('change', () => refreshQuote().catch((e) => showError(e.message)));
$('#applyCoupon').addEventListener('click', async () => {
  const code = $('#coupon').value.trim().toUpperCase();
  if (!code) { couponApplied = null; setCouponMsg('', false); return refreshQuote(); }
  couponApplied = code;
  await refreshQuote();
  if (couponApplied) setCouponMsg('Cupom aplicado.', false);
});

$('#doc').addEventListener('input', (e) => (e.target.value = maskDoc(e.target.value)));
$('#phone').addEventListener('input', (e) => (e.target.value = maskPhone(e.target.value)));
$('#cep').addEventListener('input', (e) => (e.target.value = maskCep(e.target.value)));

document.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => {
  method = b.dataset.method;
  document.querySelectorAll('[data-method]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  ['pix', 'card', 'boleto'].forEach((m) => $('#panel-' + m).classList.toggle('hidden', m !== method));
  $('#pay').classList.toggle('hidden', method === 'card'); // o cartão usa o botão do próprio formulário seguro
  showError('');
  if (method === 'card') mountCard();
}));

function collectCustomer() {
  const c = {
    name: $('#name').value.trim(), document: $('#doc').value, email: $('#email').value.trim(), phone: $('#phone').value,
  };
  if (c.name.split(/\s+/).length < 2) throw new Error('Informe seu nome completo.');
  if (![11, 14].includes(onlyDigits(c.document).length)) throw new Error('Informe um CPF ou CNPJ válido.');
  if (!/^\S+@\S+\.\S+$/.test(c.email)) throw new Error('Informe um e-mail válido.');
  if (onlyDigits(c.phone).length < 10) throw new Error('Informe um telefone com DDD.');
  if (!$('#consent').checked) throw new Error('Aceite a Política de Privacidade para continuar.');
  if (method === 'boleto') {
    c.address = { zip_code: $('#cep').value, street_name: $('#street').value.trim(), street_number: $('#number').value.trim(),
      neighborhood: $('#district').value.trim(), city: $('#city').value.trim(), federal_unit: $('#uf').value.trim().toUpperCase() };
    if (Object.values(c.address).some((v) => !v)) throw new Error('Preencha o endereço completo para gerar o boleto.');
  }
  return c;
}

async function submitCheckout(extra = {}) {
  const customer = collectCustomer();
  try {
    const order = await api('/checkout', {
      method: 'POST',
      body: { clientKey, slug, quantity: quote ? Math.max(1, parseInt($('#qty').value, 10) || 1) : 1, coupon: couponApplied, consent: true, method, customer, ...extra },
    });
    return order;
  } catch (e) {
    clientKey = crypto.randomUUID(); // permite nova tentativa após erro
    throw e;
  }
}

function handleOrder(order) {
  if (order.method === 'pix' && order.status === 'pending' && order.pix) return showPix(order);
  location.href = '/status.html?o=' + encodeURIComponent(order.publicId);
}

function showPix(order) {
  $('#pixQr').src = 'data:image/png;base64,' + order.pix.qrBase64;
  $('#pixCode').value = order.pix.code;
  $('#pixResult').classList.remove('hidden');
  $('#pixResult').scrollIntoView({ behavior: 'smooth' });
  $('#pay').disabled = true;
  pollTimer = setInterval(async () => {
    try {
      const o = await api('/orders/' + order.publicId);
      if (o.status !== 'pending') { clearInterval(pollTimer); location.href = '/status.html?o=' + encodeURIComponent(order.publicId); }
    } catch { /* tenta novamente no próximo ciclo */ }
  }, 4000);
}

$('#copyPix').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#pixCode').value); $('#copyPix').textContent = 'Código copiado'; }
  catch { $('#pixCode').select(); }
});

$('#pay').addEventListener('click', async () => {
  if (busy) return;
  busy = true; showError('');
  const btn = $('#pay'); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Processando…';
  try { handleOrder(await submitCheckout()); }
  catch (e) { showError(e.message); btn.disabled = false; btn.textContent = label; }
  finally { busy = false; }
});

let mountSeq = 0;
async function mountCard() {
  const seq = ++mountSeq;
  if (!window.MercadoPago) return showError('Não foi possível carregar o formulário de cartão. Verifique sua conexão.');
  if (brick) { try { await brick.unmount(); } catch { /* já removido */ } brick = null; }
  if (seq !== mountSeq) return;
  const mp = new MercadoPago(cfg.mpPublicKey, { locale: 'pt-BR' });
  brick = await mp.bricks().create('cardPayment', 'cardBrick', {
    initialization: { amount: quote.total / 100, payer: { email: $('#email').value.trim() || undefined } },
    customization: { paymentMethods: { maxInstallments: product.max_installments } },
    callbacks: {
      onReady: () => {},
      onError: (err) => console.error('Brick', err),
      onSubmit: async (d) => {
        showError('');
        try {
          const order = await submitCheckout({ card: { token: d.token, installments: d.installments, payment_method_id: d.payment_method_id, issuer_id: d.issuer_id } });
          handleOrder(order);
        } catch (e) { showError(e.message); throw e; }
      },
    },
  });
}

init();

const slug = new URLSearchParams(location.search).get('p') || '';
let product, quote, clientKey = crypto.randomUUID(), couponApplied = null, busy = false;

const showError = (msg) => { const e = $('#error'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); if (msg) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

async function init() {
  try {
    product = await api('/products/' + encodeURIComponent(slug));
  } catch {
    $('#loading').textContent = 'Produto não encontrado ou indisponível.';
    return;
  }
  document.title = product.name + ' — Finalizar pedido';
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

function collectCustomer() {
  const c = { name: $('#name').value.trim(), document: $('#doc').value, email: $('#email').value.trim(), phone: $('#phone').value };
  if (c.name.split(/\s+/).length < 2) throw new Error('Informe seu nome completo.');
  if (![11, 14].includes(onlyDigits(c.document).length)) throw new Error('Informe um CPF ou CNPJ válido.');
  if (!/^\S+@\S+\.\S+$/.test(c.email)) throw new Error('Informe um e-mail válido.');
  if (onlyDigits(c.phone).length < 10) throw new Error('Informe um telefone com DDD.');
  if (!$('#consent').checked) throw new Error('Aceite a Política de Privacidade para continuar.');
  return c;
}

$('#pay').addEventListener('click', async () => {
  if (busy) return;
  busy = true; showError('');
  const btn = $('#pay'); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Criando pedido…';
  try {
    const customer = collectCustomer();
    const order = await api('/checkout', {
      method: 'POST',
      body: { clientKey, slug, quantity: Math.max(1, parseInt($('#qty').value, 10) || 1), coupon: couponApplied, consent: true, customer },
    });
    location.href = '/status.html?o=' + encodeURIComponent(order.publicId);
  } catch (e) {
    clientKey = crypto.randomUUID(); // permite nova tentativa após erro
    showError(e.message);
    btn.disabled = false; btn.textContent = label;
  } finally { busy = false; }
});

init();

const TABS = [['dashboard', 'Vendas'], ['orders', 'Pedidos'], ['products', 'Produtos'], ['coupons', 'Cupons'], ['customers', 'Clientes'], ['logs', 'Logs']];
const STATUS = { pending: 'Pendente', approved: 'Aprovado', rejected: 'Recusado', cancelled: 'Cancelado', refunded: 'Estornado' };
const METHOD = { pix: 'Pix' };
const BADGE = { approved: 'bg-moss-soft text-moss-dark', pending: 'bg-amber-100 text-amber-800', rejected: 'bg-red-100 text-red-800', cancelled: 'bg-slate-200 text-slate-700', refunded: 'bg-slate-200 text-slate-700' };
const badge = (s) => `<span class="rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[s] || ''}">${esc(STATUS[s] || s)}</span>`;
const fmtDate = (d) => new Date(d).toLocaleString('pt-BR');
const toCents = (v) => Math.round(parseFloat(String(v).replace(/\./g, '').replace(',', '.')) * 100);
const fromCents = (c) => (c / 100).toFixed(2).replace('.', ',');
let tab = 'dashboard';
const view = () => $('#view');

function table(heads, rows) {
  return `<div class="overflow-x-auto rounded-xl border border-line bg-white"><table class="w-full text-left text-sm">
    <thead class="border-b border-line bg-paper text-slate-600"><tr>${heads.map((h) => `<th class="px-3 py-2 font-medium">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr class="border-b border-line last:border-0">${r.map((c) => `<td class="px-3 py-2 align-top">${c}</td>`).join('')}</tr>`).join('') : `<tr><td class="px-3 py-6 text-slate-500" colspan="${heads.length}">Nada por aqui ainda.</td></tr>`}</tbody></table></div>`;
}

function showLogin(msg) {
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  if (msg) { $('#lerr').textContent = msg; $('#lerr').classList.remove('hidden'); }
}
async function guarded(fn) {
  try { return await fn(); } catch (e) { if (e.status === 401) { showLogin('Sessão expirada. Entre novamente.'); return null; } alert(e.message); return null; }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#lerr').classList.add('hidden');
  try { await api('/admin/login', { method: 'POST', body: { email: $('#lemail').value, password: $('#lpass').value } }); $('#lpass').value = ''; start(); }
  catch (err) { showLogin(err.message); }
});
$('#logout').addEventListener('click', async () => { await api('/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

function nav() {
  $('#nav').innerHTML = TABS.map(([k, l]) => `<button class="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('');
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; nav(); render(); }));
}
async function start() {
  try { await api('/admin/me'); } catch { return showLogin(); }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); nav(); render();
}
const render = () => guarded(() => ({ dashboard, orders, products, coupons, customers, logs }[tab]()));

const dateInputs = (f = {}) => `<div><label class="label">De</label><input type="date" id="fFrom" class="field" value="${esc(f.from || '')}"></div><div><label class="label">Até</label><input type="date" id="fTo" class="field" value="${esc(f.to || '')}"></div>`;

async function dashboard() {
  const f = { from: $('#fFrom')?.value || '', to: $('#fTo')?.value || '' };
  const s = await api(`/admin/stats?from=${f.from}&to=${f.to}`);
  const card = (l, v) => `<div class="card"><p class="text-sm text-slate-600">${l}</p><p class="mt-1 font-display text-2xl">${v}</p></div>`;
  view().innerHTML = `
    <div class="mb-6 flex flex-wrap items-end gap-3">${dateInputs(f)}<button id="fGo" class="btn">Filtrar</button></div>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      ${card('Total vendido', brl(s.sold_cents))}${card('Pedidos', s.orders)}${card('Aprovados', s.approved)}${card('Pendentes', s.pending)}${card('Recusados/cancelados', s.rejected)}
    </div>
    <h2 class="mb-3 mt-8 font-display text-xl">Vendas por dia</h2>
    ${table(['Dia', 'Vendido'], s.byDay.map((d) => [esc(d.day), brl(d.sold_cents)]))}`;
  $('#fGo').addEventListener('click', () => render());
}

let ordersFilter = { status: '', from: '', to: '', q: '', page: 1 };
async function orders() {
  const qs = (f) => new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null)).toString();
  const r = await api('/admin/orders?' + qs(ordersFilter));
  view().innerHTML = `
    <div class="mb-6 flex flex-wrap items-end gap-3">
      <div><label class="label">Status</label><select id="fStatus" class="field"><option value="">Todos</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${ordersFilter.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      ${dateInputs(ordersFilter)}
      <div><label class="label">Buscar</label><input id="fQ" class="field" placeholder="Pedido, nome ou e-mail" value="${esc(ordersFilter.q)}"></div>
      <button id="fGo" class="btn">Filtrar</button>
      <a id="csv" class="btn-ghost" href="/api/admin/orders.csv?${qs({ ...ordersFilter, page: '' })}">Exportar CSV</a>
    </div>
    ${table(['Pedido', 'Data', 'Cliente', 'Produto', 'Forma', 'Total', 'Status'], r.rows.map((o) => [
      `<button class="font-mono underline" data-order="${o.id}">${esc(o.public_id)}</button>`, fmtDate(o.created_at),
      `${esc(o.customer_name)}<br><span class="text-slate-500">${esc(o.customer_email)}</span>`, `${esc(o.product_name)} × ${o.quantity}`,
      esc(METHOD[o.payment_method] || ''), brl(o.total_cents), badge(o.status)]))}
    <div class="mt-4 flex items-center gap-3 text-sm"><span>${r.total} pedidos</span>
      <button class="btn-ghost" id="prev" ${r.page <= 1 ? 'disabled' : ''}>Anterior</button><span>Página ${r.page}</span>
      <button class="btn-ghost" id="next" ${r.page * r.pageSize >= r.total ? 'disabled' : ''}>Próxima</button></div>
    <div id="detail" class="mt-8"></div>`;
  $('#fGo').addEventListener('click', () => { ordersFilter = { status: $('#fStatus').value, from: $('#fFrom').value, to: $('#fTo').value, q: $('#fQ').value.trim(), page: 1 }; render(); });
  $('#prev').addEventListener('click', () => { ordersFilter.page--; render(); });
  $('#next').addEventListener('click', () => { ordersFilter.page++; render(); });
  document.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => guarded(() => orderDetail(b.dataset.order))));
}

const ORDER_ACTIONS = {
  pending: [['approved', 'Confirmar pagamento recebido'], ['cancelled', 'Cancelar pedido']],
  approved: [['refunded', 'Marcar como estornado']],
};

async function orderDetail(id) {
  const d = await api('/admin/orders/' + id);
  $('#detail').innerHTML = `<h2 class="mb-3 font-display text-xl">Pedido ${esc(d.order.public_id)}</h2>
    <p class="mb-3 text-sm">Status: ${badge(d.order.status)} · Total: ${brl(d.order.total_cents)}</p>
    <div class="mb-2 flex flex-wrap gap-2">${(ORDER_ACTIONS[d.order.status] || []).map(([st, label]) => `<button class="btn-ghost" data-set="${st}">${label}</button>`).join('')}</div>
    <h3 class="mb-2 mt-4 font-medium">Histórico</h3>
    ${table(['Data', 'Evento', 'Detalhe'], d.logs.map((l) => [fmtDate(l.created_at), esc(l.event), `<code class="text-xs">${esc(JSON.stringify(l.detail))}</code>`]))}`;
  document.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => guarded(async () => {
    if (!confirm('Confirmar: ' + b.textContent + '?')) return;
    await api('/admin/orders/' + id + '/status', { method: 'POST', body: { status: b.dataset.set } });
    await render();
    await orderDetail(id);
  })));
  $('#detail').scrollIntoView({ behavior: 'smooth' });
}

async function products() {
  const items = await api('/admin/products');
  view().innerHTML = `<div class="mb-4 flex justify-between"><h2 class="font-display text-xl">Produtos e serviços</h2><button class="btn" id="newP">Novo produto</button></div>
    ${table(['Nome', 'Endereço', 'Preço', 'Original', 'Parcelas', 'Status', ''], items.map((p) => [esc(p.name), `<a class="underline" target="_blank" href="/checkout.html?p=${encodeURIComponent(p.slug)}">${esc(p.slug)}</a>`, brl(p.price_cents), brl(p.original_cents), p.max_installments + 'x', p.active ? 'Ativo' : 'Inativo', `<button class="btn-ghost" data-edit="${p.id}">Editar</button>`]))}
    <div id="form" class="mt-8"></div>`;
  $('#newP').addEventListener('click', () => productForm());
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => productForm(items.find((x) => x.id == b.dataset.edit))));
}

function productForm(p = {}) {
  $('#form').innerHTML = `<form id="pf" class="card grid gap-4 sm:grid-cols-2">
    <h3 class="font-display text-lg sm:col-span-2">${p.id ? 'Editar produto' : 'Novo produto'}</h3>
    <div><label class="label">Nome</label><input name="name" class="field" required value="${esc(p.name)}"></div>
    <div><label class="label">Endereço (slug)</label><input name="slug" class="field" required pattern="[a-z0-9-]{2,60}" placeholder="meu-produto" value="${esc(p.slug)}"></div>
    <div class="sm:col-span-2"><label class="label">Descrição</label><textarea name="description" rows="3" class="field">${esc(p.description)}</textarea></div>
    <div class="sm:col-span-2"><label class="label">URL da imagem (https://)</label><input name="image_url" class="field" value="${esc(p.image_url)}"></div>
    <div><label class="label">Preço original (R$)</label><input name="original" class="field" required value="${p.id ? fromCents(p.original_cents) : ''}"></div>
    <div><label class="label">Preço promocional (R$)</label><input name="price" class="field" required value="${p.id ? fromCents(p.price_cents) : ''}"></div>
    <div><label class="label">Máx. de parcelas</label><input name="inst" type="number" min="1" max="12" class="field" value="${p.max_installments || 12}"></div>
    <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="active" ${p.active === false ? '' : 'checked'}> Ativo</label>
    <div class="sm:col-span-2"><button class="btn">Salvar</button></div></form>`;
  $('#pf').addEventListener('submit', (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const body = { name: f.get('name'), slug: f.get('slug'), description: f.get('description'), image_url: f.get('image_url'), original_cents: toCents(f.get('original')), price_cents: toCents(f.get('price')), max_installments: Number(f.get('inst')), active: f.get('active') === 'on' };
    guarded(async () => { await api(p.id ? '/admin/products/' + p.id : '/admin/products', { method: p.id ? 'PUT' : 'POST', body }); render(); });
  });
}

async function coupons() {
  const items = await api('/admin/coupons');
  view().innerHTML = `<div class="mb-4 flex justify-between"><h2 class="font-display text-xl">Cupons de desconto</h2><button class="btn" id="newC">Novo cupom</button></div>
    ${table(['Código', 'Desconto', 'Usos', 'Validade', 'Status', ''], items.map((c) => [`<span class="font-mono">${esc(c.code)}</span>`, c.type === 'percent' ? c.value + '%' : brl(c.value), `${c.used_count}${c.max_uses ? ' / ' + c.max_uses : ''}`, c.expires_at ? fmtDate(c.expires_at) : 'Sem validade', c.active ? 'Ativo' : 'Inativo', `<button class="btn-ghost" data-edit="${c.id}">Editar</button>`]))}
    <div id="form" class="mt-8"></div>`;
  $('#newC').addEventListener('click', () => couponForm());
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => couponForm(items.find((x) => x.id == b.dataset.edit))));
}

function couponForm(c = {}) {
  $('#form').innerHTML = `<form id="cf" class="card grid gap-4 sm:grid-cols-2">
    <h3 class="font-display text-lg sm:col-span-2">${c.id ? 'Editar cupom' : 'Novo cupom'}</h3>
    <div><label class="label">Código</label><input name="code" class="field uppercase" required value="${esc(c.code)}"></div>
    <div><label class="label">Tipo</label><select name="type" class="field"><option value="percent" ${c.type !== 'fixed' ? 'selected' : ''}>Percentual (%)</option><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>Valor fixo (R$)</option></select></div>
    <div><label class="label">Valor (% ou R$)</label><input name="value" class="field" required value="${c.id ? (c.type === 'fixed' ? fromCents(c.value) : c.value) : ''}"></div>
    <div><label class="label">Limite de usos (vazio = ilimitado)</label><input name="max" type="number" min="1" class="field" value="${c.max_uses ?? ''}"></div>
    <div><label class="label">Validade (vazio = sem validade)</label><input name="exp" type="datetime-local" class="field" value="${c.expires_at ? new Date(new Date(c.expires_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}"></div>
    <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="active" ${c.active === false ? '' : 'checked'}> Ativo</label>
    <div class="sm:col-span-2"><button class="btn">Salvar</button></div></form>`;
  $('#cf').addEventListener('submit', (e) => {
    e.preventDefault(); const f = new FormData(e.target); const fixed = f.get('type') === 'fixed';
    const body = { code: f.get('code'), type: f.get('type'), value: fixed ? toCents(f.get('value')) : parseInt(f.get('value'), 10), max_uses: f.get('max') ? Number(f.get('max')) : null, expires_at: f.get('exp') ? new Date(f.get('exp')).toISOString() : null, active: f.get('active') === 'on' };
    guarded(async () => { await api(c.id ? '/admin/coupons/' + c.id : '/admin/coupons', { method: c.id ? 'PUT' : 'POST', body }); render(); });
  });
}

async function customers() {
  const q = $('#cq')?.value || '';
  const items = await api('/admin/customers?q=' + encodeURIComponent(q));
  view().innerHTML = `<div class="mb-4 flex items-end gap-3"><div><label class="label">Buscar</label><input id="cq" class="field" value="${esc(q)}" placeholder="Nome ou e-mail"></div><button id="cGo" class="btn">Buscar</button></div>
    ${table(['Nome', 'CPF/CNPJ', 'E-mail', 'Telefone', 'Pedidos', 'Total pago', ''], items.map((c) => [esc(c.name), esc(c.document), esc(c.email), esc(c.phone), c.orders, brl(c.spent_cents), c.anonymized_at ? 'Anonimizado' : `<button class="btn-ghost" data-anon="${c.id}">Anonimizar</button>`]))}
    <p class="mt-3 text-sm text-slate-600">Anonimizar remove nome, documento, e-mail, telefone e endereço (direito do titular na LGPD). Os pedidos e valores continuam registrados.</p>`;
  $('#cGo').addEventListener('click', () => render());
  document.querySelectorAll('[data-anon]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Anonimizar este cliente? Esta ação não pode ser desfeita.')) guarded(async () => { await api(`/admin/customers/${b.dataset.anon}/anonymize`, { method: 'POST' }); render(); });
  }));
}

async function logs() {
  const items = await api('/admin/logs');
  view().innerHTML = `<h2 class="mb-4 font-display text-xl">Últimos 200 eventos</h2>${table(['Data', 'Pedido', 'Evento', 'Detalhe'], items.map((l) => [fmtDate(l.created_at), esc(l.public_id || '—'), esc(l.event), `<code class="text-xs">${esc(JSON.stringify(l.detail))}</code>`]))}`;
}

start();

api('/products').then((items) => {
      if (!items.length) return $('#empty').classList.remove('hidden');
      $('#list').innerHTML = items.map((p) => `
        <a href="/checkout.html?p=${encodeURIComponent(p.slug)}" class="card block transition hover:border-moss">
          ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" class="mb-4 aspect-[4/3] w-full rounded-lg object-cover">` : ''}
          <h2 class="font-display text-lg">${esc(p.name)}</h2>
          <p class="mt-1 text-sm text-slate-600">${brl(p.price_cents)}</p>
        </a>`).join('');
    }).catch(() => { $('#empty').textContent = 'Não foi possível carregar os produtos.'; $('#empty').classList.remove('hidden'); });

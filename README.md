# Checkout Pix

Checkout simples com **pagamento via Pix manual**: o cliente preenche os dados, recebe um link com a chave Pix para copiar com um toque e abrir o banco; você confere o pagamento e confirma o pedido no painel administrativo.

**Stack:** Node.js 20+ · Express 5 · PostgreSQL (Supabase) · Tailwind CSS (compilado) · JavaScript puro no frontend.

## Como funciona

1. O cliente abre `/checkout.html?p=SLUG-DO-PRODUTO`, preenche nome, CPF/CNPJ, e-mail e telefone e aceita a política de privacidade.
2. O pedido é criado como **Pendente** e o cliente é levado para `/status.html?o=PED-...`.
3. Essa página mostra a **chave Pix** (`PIX_KEY`) com botões para copiar a chave e o valor, e atalhos para abrir o banco.
4. Você confere o recebimento no seu banco e, em **Admin → Pedidos → (abrir o pedido)**, clica em **Confirmar pagamento recebido**. O cliente vê a confirmação na mesma página e, se o SMTP estiver configurado, recebe um e-mail.

Também há: cupons, produtos, clientes (com anonimização LGPD), logs de auditoria, exportação CSV e painel de vendas. Pedidos duplicados são evitados por `client_key` e o cupom é reservado de forma atômica.

## Rodando localmente

```bash
npm install
cp .env.example .env     # preencha DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PIX_KEY
npm run migrate          # cria as tabelas e o usuário admin
npm run dev
```

Admin em `/admin.html`. Cadastre um produto e use o endereço dele na aba **Produtos**.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `APP_URL` | URL pública do site |
| `DATABASE_URL` / `DATABASE_SSL` | PostgreSQL (use `DATABASE_SSL=true` no Supabase/Render) |
| `JWT_SECRET` | 32+ caracteres aleatórios |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin criado pelo `npm run migrate` (senha de 10+ caracteres) |
| `PIX_KEY` | chave Pix mostrada ao cliente |
| `PIX_NAME` | nome do recebedor (opcional) |
| `SMTP_*`, `MAIL_FROM` | e-mail de confirmação (opcional) |

## Testes

```bash
npm test
```

## Limitações

- A confirmação do pagamento é **manual**: não há integração bancária, então o sistema não sabe sozinho que o Pix caiu.
- A chave Pix não carrega o valor: o cliente digita/cola o valor mostrado na tela.

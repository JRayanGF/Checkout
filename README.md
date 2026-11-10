# Checkout Mercado Pago

Sistema de checkout com Pix (QR Code e copia e cola), cartão com parcelamento e boleto, painel administrativo e webhooks do Mercado Pago.

**Stack:** Node.js 20+ · Express 5 · PostgreSQL · Tailwind CSS (compilado) · JavaScript puro no frontend · Mercado Pago (API REST + Card Payment Brick).

> O frontend é servido pelo próprio Express (um único serviço para publicar). Não usa Next.js/React.

## Como funciona

1. O cliente abre `/checkout.html?p=<slug-do-produto>`.
2. O **backend recalcula o valor** (preço × quantidade − cupom). O valor nunca vem do navegador.
3. Pix e boleto: o backend cria o pagamento na API do Mercado Pago. Cartão: o navegador tokeniza o cartão no Mercado Pago (o número e o CVV **nunca** passam pelo servidor) e o backend usa só o token.
4. O Mercado Pago chama `POST /api/webhooks/mercadopago`. O backend valida a assinatura (HMAC-SHA256), consulta o pagamento na API e atualiza o pedido.
5. O cliente vê `/status.html?o=<pedido>` (aprovado, pendente ou recusado). A página atualiza sozinha.

Proteções: pedido duplicado (`client_key` único + `X-Idempotency-Key`), conferência do valor pago × valor do pedido, cupom reservado de forma atômica, rate limit, CSP, cookies httpOnly/sameSite, consultas SQL parametrizadas, saída HTML escapada, logs em `transaction_logs`.

## 1. Pré-requisitos (Windows)

1. **Node.js 20 ou superior (LTS)**: https://nodejs.org
2. **PostgreSQL 16**: instalador em https://www.postgresql.org/download/windows/ **ou** Docker Desktop (use o `docker-compose.yml`).
3. Conta no Mercado Pago com uma aplicação criada em https://www.mercadopago.com.br/developers/panel/app

## 2. Instalação

No PowerShell, dentro da pasta do projeto:

```powershell
npm install
copy .env.example .env
notepad .env
```

Preencha o `.env`:

| Variável | O que colocar |
|---|---|
| `DATABASE_URL` | `postgres://usuario:senha@localhost:5432/checkout` |
| `JWT_SECRET` | rode `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` e cole o resultado |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | acesso ao painel (senha com 10+ caracteres) |
| `MP_ACCESS_TOKEN` / `MP_PUBLIC_KEY` | credenciais de **teste** da sua aplicação |
| `MP_WEBHOOK_SECRET` | veja o passo 4 |
| `APP_URL` | `http://localhost:3000` (em produção, o endereço HTTPS do site) |

Com Docker, suba o banco com `docker compose up -d` (usuário `checkout`, senha `troque_esta_senha`; troque-a no `docker-compose.yml` e no `.env`).

## 3. Banco de dados e execução

```powershell
npm run migrate    # cria as tabelas e o usuário administrador
npm start          # http://localhost:3000
```

- Painel: http://localhost:3000/admin
- Cadastre um produto em **Produtos** e abra o endereço mostrado na lista (`/checkout.html?p=<slug>`).

## 4. Webhook (confirmação automática)

O Mercado Pago precisa alcançar seu servidor por **HTTPS público**. Em desenvolvimento, use um túnel:

```powershell
ngrok http 3000     # ou: cloudflared tunnel --url http://localhost:3000
```

1. Coloque a URL HTTPS do túnel em `APP_URL` no `.env` e reinicie.
2. No painel do Mercado Pago: **Suas integrações → sua aplicação → Webhooks**.
3. URL: `https://SEU-ENDERECO/api/webhooks/mercadopago` · evento: **Pagamentos**.
4. Copie a **assinatura secreta** para `MP_WEBHOOK_SECRET` e reinicie.

Se o webhook atrasar, a página de status consulta o Mercado Pago a cada 10 s como rede de segurança. Isso não substitui o webhook.

## 4.1 Testando no sandbox

Use credenciais de **teste** e os cartões/usuários de teste da documentação oficial (https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-test/test-cards). Pagamentos aprovados ou recusados dependem do nome do titular informado no formulário do cartão (ex.: `APRO` aprova, `OTHE` recusa). Nenhum pagamento é simulado pelo nosso código.

## 5. Testes automatizados

```powershell
npm test
```

Cobrem validação de CPF/CNPJ, cálculo de descontos e validação da assinatura do webhook. Para testar o fluxo completo, use o sandbox (item 4.1).

## 6. Publicar na internet

Qualquer hospedagem Node.js com PostgreSQL serve (Render, Railway, Fly.io, VPS). Exemplo no **Render**:

1. Suba o projeto para um repositório no GitHub (o `.env` está no `.gitignore`).
2. Crie um **PostgreSQL** e copie a *Internal Database URL*.
3. Crie um **Web Service** apontando para o repositório: Build `npm install`, Start `npm run migrate && npm start`.
4. Cadastre as variáveis do `.env`, com `NODE_ENV=production`, `DATABASE_SSL=true` se o provedor exigir, `APP_URL=https://seu-dominio` e as credenciais de **produção** do Mercado Pago.
5. Configure o webhook de produção (passo 4) com o domínio final.
6. Faça um pagamento real de baixo valor para validar de ponta a ponta.

Em produção, mantenha HTTPS ativo, faça backup do banco e restrinja o acesso ao `/admin` (senha forte; se possível, por IP ou VPN).

## 7. LGPD, o que o sistema já faz

- Coleta só o necessário e registra o aceite da Política de Privacidade (`consent_at`).
- Não armazena número de cartão nem CVV; só o status do pagamento e dados mínimos.
- CPF/CNPJ aparece mascarado na lista de clientes e o painel permite **anonimizar** um titular.
- **Você precisa** revisar `public/privacidade.html` (é um modelo) com um profissional jurídico e definir prazos de retenção e o encarregado (DPO).

## Limitações conhecidas

- Um produto por pedido (sem carrinho com vários itens).
- Estornos são refletidos pelo webhook, mas não há botão de estorno no painel (faça no painel do Mercado Pago).
- Sem recuperação de senha do admin: para trocar a senha, atualize o `password_hash` (bcrypt) no banco.
- Boleto usa `bolbradesco` e exige endereço completo. Confira no painel do Mercado Pago se a sua conta tem boleto habilitado.

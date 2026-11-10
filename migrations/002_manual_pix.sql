-- Pagamento passa a ser Pix manual (chave fixa + confirmação no painel admin).
-- As tabelas abaixo eram usadas somente pela integração com gateway.
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS webhook_events;

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida no .env');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log('Migration aplicada:', file);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  const admins = await pool.query('SELECT 1 FROM admins LIMIT 1');
  if (!admins.rows.length) {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      console.log('Nenhum administrador criado: defina ADMIN_EMAIL e ADMIN_PASSWORD no .env e rode novamente.');
    } else if (ADMIN_PASSWORD.length < 10) {
      throw new Error('ADMIN_PASSWORD deve ter pelo menos 10 caracteres');
    } else {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      await pool.query('INSERT INTO admins(email, password_hash) VALUES($1,$2)', [ADMIN_EMAIL.toLowerCase(), hash]);
      console.log('Administrador criado:', ADMIN_EMAIL.toLowerCase());
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

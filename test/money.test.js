import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, couponIsUsable, toReais } from '../src/utils/money.js';

test('totais sem cupom', () => {
  assert.deepEqual(computeTotals(9990, 2, null), { subtotal: 19980, discount: 0, total: 19980 });
});

test('cupom percentual arredonda para baixo', () => {
  assert.deepEqual(computeTotals(999, 1, { type: 'percent', value: 10 }), { subtotal: 999, discount: 99, total: 900 });
});

test('cupom fixo nunca passa do subtotal', () => {
  assert.equal(computeTotals(5000, 1, { type: 'fixed', value: 9000 }).total, 0);
  assert.equal(computeTotals(5000, 1, { type: 'fixed', value: 1000 }).total, 4000);
});

test('validade do cupom', () => {
  const ok = { active: true, used_count: 0, max_uses: 2, expires_at: null };
  assert.equal(couponIsUsable(ok), true);
  assert.equal(couponIsUsable({ ...ok, active: false }), false);
  assert.equal(couponIsUsable({ ...ok, used_count: 2 }), false);
  assert.equal(couponIsUsable({ ...ok, expires_at: '2000-01-01T00:00:00Z' }), false);
  assert.equal(couponIsUsable(null), false);
});

test('toReais', () => assert.equal(toReais(12345), 123.45));

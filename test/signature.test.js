import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyWebhookSignature } from '../src/utils/signature.js';

const secret = 'segredo-de-teste';
const sign = (manifest) => crypto.createHmac('sha256', secret).update(manifest).digest('hex');

test('aceita assinatura correta', () => {
  const v1 = sign('id:abc123;request-id:req-1;ts:1700000000;');
  assert.equal(verifyWebhookSignature({ xSignature: `ts=1700000000,v1=${v1}`, xRequestId: 'req-1', dataId: 'ABC123', secret }), true);
});

test('rejeita assinatura adulterada, ausente ou com outro id', () => {
  const v1 = sign('id:abc123;request-id:req-1;ts:1700000000;');
  assert.equal(verifyWebhookSignature({ xSignature: `ts=1700000000,v1=${v1}`, xRequestId: 'req-1', dataId: 'outro', secret }), false);
  assert.equal(verifyWebhookSignature({ xSignature: `ts=1700000000,v1=${'0'.repeat(64)}`, xRequestId: 'req-1', dataId: 'abc123', secret }), false);
  assert.equal(verifyWebhookSignature({ xSignature: undefined, xRequestId: 'req-1', dataId: 'abc123', secret }), false);
  assert.equal(verifyWebhookSignature({ xSignature: 'lixo', xRequestId: 'req-1', dataId: 'abc123', secret }), false);
});

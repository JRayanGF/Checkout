import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCPF, isValidCNPJ, documentType, maskDocument } from '../src/utils/cpfCnpj.js';

test('CPF válido e inválido', () => {
  assert.equal(isValidCPF('529.982.247-25'), true);
  assert.equal(isValidCPF('52998224726'), false);
  assert.equal(isValidCPF('111.111.111-11'), false);
  assert.equal(isValidCPF('123'), false);
});

test('CNPJ válido e inválido', () => {
  assert.equal(isValidCNPJ('11.222.333/0001-81'), true);
  assert.equal(isValidCNPJ('11.222.333/0001-82'), false);
  assert.equal(isValidCNPJ('00000000000000'), false);
});

test('documentType e máscara', () => {
  assert.equal(documentType('52998224725'), 'CPF');
  assert.equal(documentType('11222333000181'), 'CNPJ');
  assert.equal(documentType('abc'), null);
  assert.equal(maskDocument('52998224725'), '***.982.***-25');
});

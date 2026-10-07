import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateMaterial } from '../lib/material-rules.ts';
import { InMemoryWorkOrderRepository, sha256Hex } from '../lib/work-order-repository.ts';

test('creates, updates and ignores exact duplicate content hashes', async () => {
  const repository = new InMemoryWorkOrderRepository();
  const record = evaluateMaterial({ workOrder:'WO-DEMO-TEST', fileVersion:'current', sourceState:'in_progress', operator:'OP-DEMO', confirmationTime:'2026-08-26 00:00', requiredPn:10, receivedPn:10, pnDifference:0, receiptQty:100, issueQty:100, qtyDifference:0, shortageCount:0, extraPnCount:0, actualReceiptQtyDiffCount:0, lastUpdated:'2026-08-26 00:00', sourceFile:'demo.xlsx' });
  assert.equal(await repository.upsert(record, 'hash-1', '2026-08-26T00:00:00Z'), 'created');
  assert.equal(await repository.upsert({ ...record, receivedPn: 39 }, 'hash-2', '2026-08-26T00:01:00Z'), 'updated');
  assert.equal(await repository.upsert(record, 'hash-2', '2026-08-26T00:02:00Z'), 'duplicate');
  assert.equal((await repository.list()).length, 1);
  assert.deepEqual((await repository.ingestionHistory()).map((event) => event.outcome), ['created', 'updated', 'duplicate']);
});

test('sha256Hex is stable for identical content', async () => {
  const first = await sha256Hex(Buffer.from('same-content'));
  const second = await sha256Hex(Buffer.from('same-content'));
  assert.equal(first, second);
  assert.equal(first.length, 64);
});

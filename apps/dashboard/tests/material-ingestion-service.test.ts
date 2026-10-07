import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ingestMaterialFile } from '../lib/material-ingestion-service.ts';
import { InMemoryIngestionErrorRepository, InMemoryWorkOrderRepository } from '../lib/work-order-repository.ts';

function excelJsBuffer(data: Uint8Array): Parameters<ExcelJS.Workbook['xlsx']['load']>[0] {
  return Uint8Array.from(data).buffer as Parameters<ExcelJS.Workbook['xlsx']['load']>[0];
}

const demoDir = path.resolve(import.meta.dirname, '..', 'public', 'demo-files');

function dependencies() {
  return { workOrders: new InMemoryWorkOrderRepository(), errors: new InMemoryIngestionErrorRepository() };
}

test('ingests a valid workbook and records an exact duplicate without adding a second record', async () => {
  const deps = dependencies();
  const fileName = 'IN_PROGRESS_CURRENT_COMPLETED_WO-DEMO-001.xlsx';
  const data = await fs.readFile(path.join(demoDir, fileName));
  const options = { sourceFile: fileName, sourceState: 'in_progress' as const, syntheticOnly: true, lastUpdated: '2026-08-26T01:00:00Z' };
  const first = await ingestMaterialFile(data, options, deps);
  const second = await ingestMaterialFile(data, options, deps);
  assert.equal(first.ok && first.outcome, 'created');
  assert.equal(second.ok && second.outcome, 'duplicate');
  assert.equal((await deps.workOrders.list()).length, 1);
  assert.equal((await deps.workOrders.ingestionHistory()).length, 2);
});

test('updates the current state when the same work order arrives with different content', async () => {
  const deps = dependencies();
  const fileName = 'IN_PROGRESS_CURRENT_COMPLETED_WO-DEMO-001.xlsx';
  const original = await fs.readFile(path.join(demoDir, fileName));
  const options = { sourceFile: fileName, sourceState: 'in_progress' as const, syntheticOnly: true, lastUpdated: '2026-08-26T01:00:00Z' };
  assert.equal((await ingestMaterialFile(original, options, deps)).ok, true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excelJsBuffer(original));
  workbook.getWorksheet('Dashboard')!.getCell('B8').value = 1;
  const changed = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await ingestMaterialFile(changed, { ...options, lastUpdated: '2026-08-26T01:05:00Z' }, deps);
  assert.equal(result.ok && result.outcome, 'updated');
  assert.equal(result.ok && result.record.receiptStatus, 'shortage');
  assert.equal((await deps.workOrders.list()).length, 1);
});

test('records invalid files in the error repository without creating a work order', async () => {
  const deps = dependencies();
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Wrong Sheet');
  const result = await ingestMaterialFile(Buffer.from(await workbook.xlsx.writeBuffer()), {
    sourceFile: 'invalid.xlsx', sourceState: 'in_progress', syntheticOnly: true, lastUpdated: '2026-08-26T01:10:00Z',
  }, deps);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.errorCode, 'dashboard_missing');
  assert.equal((await deps.workOrders.list()).length, 0);
  assert.equal((await deps.errors.list())[0].errorCode, 'dashboard_missing');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { MaterialFileParseError, parseMaterialWorkbook } from '../lib/material-file-parser.ts';

function excelJsBuffer(data: Uint8Array): Parameters<ExcelJS.Workbook['xlsx']['load']>[0] {
  return Uint8Array.from(data).buffer as Parameters<ExcelJS.Workbook['xlsx']['load']>[0];
}

const demoDir = path.resolve(import.meta.dirname, '..', 'public', 'demo-files');
const cases = [
  ['IN_PROGRESS_CURRENT_COMPLETED_WO-DEMO-001.xlsx', 'in_progress', 'current', 'completed', 0],
  ['IN_PROGRESS_CURRENT_PENDING_WO-DEMO-002.xlsx', 'in_progress', 'current', 'pending', 0],
  ['IN_PROGRESS_CURRENT_SHORTAGE_WO-DEMO-003.xlsx', 'in_progress', 'current', 'shortage', 0],
  ['IN_PROGRESS_CURRENT_QUANTITY_DIFFERENCE_WO-DEMO-004.xlsx', 'in_progress', 'current', 'quantity_difference', 0],
  ['IN_PROGRESS_CURRENT_ACTUAL_QTY_DIFFERENCE_WO-DEMO-005.xlsx', 'in_progress', 'current', 'receipt_issue', 2],
  ['IN_PROGRESS_LEGACY_EXTRA_PN_WO-DEMO-006.xlsx', 'in_progress', 'legacy', 'review_required', null],
  ['ARCHIVED_LEGACY_MISSING_METADATA_WO-DEMO-007.xlsx', 'archived', 'legacy', 'completed', null],
] as const;

for (const [fileName, sourceState, version, status, actualDiff] of cases) {
  test(`parses ${fileName}`, async () => {
    const buffer = await fs.readFile(path.join(demoDir, fileName));
    const result = await parseMaterialWorkbook(buffer, {
      sourceFile: fileName,
      sourceState,
      sourceDocumentUrl: `/demo-files/${fileName}`,
      lastUpdated: '2026-08-26 00:00',
      syntheticOnly: true,
    });
    assert.equal(result.record.fileVersion, version);
    assert.equal(result.record.receiptStatus, status);
    assert.equal(result.record.actualReceiptQtyDiffCount, actualDiff);
    assert.match(result.record.workOrder, /^WO-DEMO-/);
  });
}

test('records missing metadata without changing archived legacy receipt status', async () => {
  const fileName = 'ARCHIVED_LEGACY_MISSING_METADATA_WO-DEMO-007.xlsx';
  const result = await parseMaterialWorkbook(await fs.readFile(path.join(demoDir, fileName)), {
    sourceFile: fileName,
    sourceState: 'archived',
    syntheticOnly: true,
  });
  assert.deepEqual(result.warnings.sort(), ['confirmation_time_missing', 'operator_missing']);
  assert.equal(result.record.dataQualityStatus, 'legacy_incomplete');
  assert.equal(result.record.actionRequired, false);
});

async function workbookBuffer(configure: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  configure(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function expectParseError(buffer: Buffer, code: MaterialFileParseError['code']) {
  await assert.rejects(
    () => parseMaterialWorkbook(buffer, { sourceFile: 'invalid.xlsx', sourceState: 'in_progress', syntheticOnly: true }),
    (error: unknown) => error instanceof MaterialFileParseError && error.code === code,
  );
}

test('rejects workbook without Dashboard', async () => {
  await expectParseError(await workbookBuffer((workbook) => workbook.addWorksheet('Other')), 'dashboard_missing');
});

test('rejects non-synthetic work order in synthetic mode', async () => {
  const source = await fs.readFile(path.join(demoDir, 'IN_PROGRESS_LEGACY_EXTRA_PN_WO-DEMO-006.xlsx'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excelJsBuffer(source));
  workbook.getWorksheet('Dashboard')!.getCell('B1').value = 'REAL-WO-001';
  await expectParseError(Buffer.from(await workbook.xlsx.writeBuffer()), 'unsafe_demo_identifier');
});

test('rejects invalid numeric field', async () => {
  const source = await fs.readFile(path.join(demoDir, 'IN_PROGRESS_LEGACY_EXTRA_PN_WO-DEMO-006.xlsx'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excelJsBuffer(source));
  workbook.getWorksheet('Dashboard')!.getCell('B2').value = 'not-a-number';
  await expectParseError(Buffer.from(await workbook.xlsx.writeBuffer()), 'invalid_number');
});

test('rejects current workbook without B10', async () => {
  const source = await fs.readFile(path.join(demoDir, 'IN_PROGRESS_CURRENT_COMPLETED_WO-DEMO-001.xlsx'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excelJsBuffer(source));
  workbook.getWorksheet('Dashboard')!.getCell('B10').value = null;
  await expectParseError(Buffer.from(await workbook.xlsx.writeBuffer()), 'current_b10_missing');
});

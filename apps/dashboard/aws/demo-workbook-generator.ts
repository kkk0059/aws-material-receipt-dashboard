import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import ExcelJS from 'exceljs';
import type { WorkOrderRepository } from '../lib/work-order-repository.ts';

export type DemoScenario =
  | 'current_completed' | 'current_pending' | 'current_shortage' | 'current_quantity_difference' | 'current_receipt_issue'
  | 'legacy_completed' | 'legacy_pending' | 'legacy_shortage' | 'legacy_quantity_difference' | 'legacy_receipt_issue' | 'legacy_extra_pn'
  | 'damaged_xlsx';

type ScenarioValues = { requiredPn: number; receivedPn: number; receiptQty: number; issueQty: number; shortageCount: number; extraPnCount: number; actualReceiptQtyDiffCount: number };
const scenarios: Record<DemoScenario, ScenarioValues> = {
  current_completed: { requiredPn: 40, receivedPn: 40, receiptQty: 12000, issueQty: 12000, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  current_pending: { requiredPn: 36, receivedPn: 29, receiptQty: 9300, issueQty: 11000, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  current_shortage: { requiredPn: 42, receivedPn: 42, receiptQty: 15900, issueQty: 15900, shortageCount: 2, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  current_quantity_difference: { requiredPn: 34, receivedPn: 34, receiptQty: 10200, issueQty: 10800, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  current_receipt_issue: { requiredPn: 38, receivedPn: 38, receiptQty: 14500, issueQty: 14500, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 2 },
  legacy_completed: { requiredPn: 20, receivedPn: 20, receiptQty: 8000, issueQty: 8000, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  legacy_pending: { requiredPn: 20, receivedPn: 16, receiptQty: 6400, issueQty: 8000, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  legacy_shortage: { requiredPn: 20, receivedPn: 20, receiptQty: 8000, issueQty: 8000, shortageCount: 1, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  legacy_quantity_difference: { requiredPn: 20, receivedPn: 20, receiptQty: 7600, issueQty: 8000, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
  legacy_receipt_issue: { requiredPn: 20, receivedPn: 20, receiptQty: 8000, issueQty: 8000, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 2 },
  legacy_extra_pn: { requiredPn: 20, receivedPn: 20, receiptQty: 8000, issueQty: 8000, shortageCount: 0, extraPnCount: 1, actualReceiptQtyDiffCount: 0 },
  damaged_xlsx: { requiredPn: 0, receivedPn: 0, receiptQty: 0, issueQty: 0, shortageCount: 0, extraPnCount: 0, actualReceiptQtyDiffCount: 0 },
};

function isScenario(value: unknown): value is DemoScenario { return typeof value === 'string' && value in scenarios; }
function timeText(date = new Date()) { return date.toISOString().slice(0, 16).replace('T', ' '); }

export async function generateDemoWorkbook(options: { s3: Pick<S3Client, 'send'>; bucket: string; workOrders: WorkOrderRepository; scenario: unknown }) {
  if (!isScenario(options.scenario)) throw new Error('Unsupported demo scenario.');
  const existing = await options.workOrders.list();
  const largestNumber = existing.reduce((largest, record) => Math.max(largest, Number(record.workOrder.match(/(\d{3})$/)?.[1] ?? 0)), 7);
  const workOrder = `WO-DEMO-${String(largestNumber + 1).padStart(3, '0')}`;

  // 這不是可開啟的 Excel，而是刻意以 .xlsx 副檔名送入來源位置的合成失效檔。
  // 它必須走與真實損壞檔相同的 S3 事件、rejected/ 及 CloudWatch Error Log 路徑。
  if (options.scenario === 'damaged_xlsx') {
    const fileName = `INCOMING_${workOrder}_DAMAGED.xlsx`;
    await options.s3.send(new PutObjectCommand({
      Bucket: options.bucket,
      Key: `incoming/in-progress/${fileName}`,
      Body: Buffer.from(`Synthetic damaged XLSX demonstration for ${workOrder}. This file is intentionally not a valid workbook.`, 'utf8'),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Metadata: { synthetic: 'true', scenario: options.scenario, expected_result: 'rejected' },
    }));
    return { workOrder, fileName, scenario: options.scenario };
  }

  const isLegacy = options.scenario.startsWith('legacy_');
  const templateKey = isLegacy
    ? 'processed/in-progress/IN_PROGRESS_LEGACY_EXTRA_PN_WO-DEMO-006.xlsx'
    : 'processed/in-progress/IN_PROGRESS_CURRENT_COMPLETED_WO-DEMO-001.xlsx';
  const template = await options.s3.send(new GetObjectCommand({ Bucket: options.bucket, Key: templateKey }));
  if (!template.Body) throw new Error('Demo template is unavailable. Upload the baseline demo files first.');
  const data = scenarios[options.scenario];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await template.Body.transformToByteArray()));
  const dashboard = workbook.getWorksheet('Dashboard');
  if (!dashboard) throw new Error('Demo template is missing Dashboard worksheet.');
  dashboard.getCell('B1').value = workOrder;
  dashboard.getCell('B2').value = data.requiredPn;
  dashboard.getCell('B3').value = data.receivedPn;
  dashboard.getCell('B4').value = data.requiredPn - data.receivedPn;
  dashboard.getCell('B5').value = data.receiptQty;
  dashboard.getCell('B6').value = data.issueQty;
  dashboard.getCell('B7').value = data.receiptQty - data.issueQty;
  dashboard.getCell('B8').value = data.shortageCount;
  dashboard.getCell('B9').value = data.extraPnCount;
  if (!isLegacy) dashboard.getCell('B10').value = data.actualReceiptQtyDiffCount;
  dashboard.getCell('D2').value = 'OP-DEMO-AWS';
  dashboard.getCell('D3').value = `確認時間 Confirmation time：${timeText()}`;
  const stationRaw = workbook.getWorksheet('StationRaw');
  if (stationRaw) {
    stationRaw.getCell('F2').value = `${workOrder}_SYNTHETIC.xls`;
    stationRaw.getCell('F6').value = workOrder;
    stationRaw.getCell('F8').value = timeText();
    stationRaw.getCell('F12').value = `${workOrder}_Warehouse_SYNTHETIC.xlsx`;
    stationRaw.getCell('F14').value = timeText();
  }
  const fileName = `INCOMING_${workOrder}.xlsx`;
  await options.s3.send(new PutObjectCommand({
    Bucket: options.bucket,
    Key: `incoming/in-progress/${fileName}`,
    Body: Buffer.from(await workbook.xlsx.writeBuffer()),
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    Metadata: { synthetic: 'true', scenario: options.scenario },
  }));
  return { workOrder, fileName, scenario: options.scenario };
}

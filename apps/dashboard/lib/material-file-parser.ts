import ExcelJS from 'exceljs';
import { evaluateMaterial, type MaterialRecord, type SourceState } from './material-rules.ts';

export type ParseWarningCode = 'operator_missing' | 'confirmation_time_missing';
export type ParseErrorCode =
  | 'invalid_workbook'
  | 'dashboard_missing'
  | 'work_order_missing'
  | 'unsafe_demo_identifier'
  | 'invalid_number'
  | 'negative_count'
  | 'current_b10_missing';

export class MaterialFileParseError extends Error {
  public readonly code: ParseErrorCode;
  public readonly cell?: string;

  constructor(
    code: ParseErrorCode,
    message: string,
    cell?: string,
  ) {
    super(message);
    this.name = 'MaterialFileParseError';
    this.code = code;
    this.cell = cell;
  }
}

export interface ParseMaterialFileOptions {
  sourceFile: string;
  sourceState: SourceState;
  sourceDocumentUrl?: string;
  sourceObjectKey?: string;
  lastUpdated?: string;
  syntheticOnly?: boolean;
}

export interface ParsedMaterialFile {
  record: MaterialRecord;
  warnings: ParseWarningCode[];
}

function getCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;

  if ('result' in value) return value.result ?? null;
  if ('text' in value && typeof value.text === 'string') return value.text;
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('');
  }
  return null;
}

function readText(cell: ExcelJS.Cell): string | null {
  const value = getCellValue(cell);
  if (value === null || value === undefined) return null;
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  return text.length > 0 ? text : null;
}

function readNumber(cell: ExcelJS.Cell, options: { required?: boolean; nonNegative?: boolean } = {}): number | null {
  const raw = getCellValue(cell);
  if ((raw === null || raw === undefined || raw === '') && !options.required) return null;
  const parsed = typeof raw === 'number' ? raw : Number(String(raw ?? '').replaceAll(',', '').trim());
  if (!Number.isFinite(parsed)) {
    throw new MaterialFileParseError('invalid_number', `${cell.address} must contain a valid number.`, cell.address);
  }
  if (options.nonNegative && parsed < 0) {
    throw new MaterialFileParseError('negative_count', `${cell.address} cannot be negative.`, cell.address);
  }
  return parsed;
}

function extractConfirmationTime(cell: ExcelJS.Cell): string | null {
  const raw = getCellValue(cell);
  if (raw instanceof Date) return raw.toISOString().slice(0, 16).replace('T', ' ');
  const text = readText(cell);
  if (!text) return null;
  const match = text.match(/(20\d{2}[-/]\d{2}[-/]\d{2})\s+(\d{2}:\d{2})(?::\d{2})?/);
  return match ? `${match[1].replaceAll('/', '-')} ${match[2]}` : text;
}

export async function parseMaterialWorkbook(
  data: Buffer | Uint8Array | ArrayBuffer,
  options: ParseMaterialFileOptions,
): Promise<ParsedMaterialFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const workbookBuffer = Uint8Array.from(bytes).buffer as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBuffer);
  } catch (error) {
    throw new MaterialFileParseError('invalid_workbook', `Unable to read workbook: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  const dashboard = workbook.getWorksheet('Dashboard');
  if (!dashboard) throw new MaterialFileParseError('dashboard_missing', 'Dashboard worksheet is required.');

  const fileVersion = workbook.getWorksheet('StationAssign') ? 'current' : 'legacy';
  const workOrder = readText(dashboard.getCell('B1'));
  if (!workOrder) throw new MaterialFileParseError('work_order_missing', 'Dashboard!B1 Work Order is required.', 'B1');
  if (options.syntheticOnly && !workOrder.startsWith('WO-DEMO-')) {
    throw new MaterialFileParseError('unsafe_demo_identifier', 'Synthetic files must use a WO-DEMO-* work order.', 'B1');
  }

  const operator = readText(dashboard.getCell('D2'));
  const confirmationTime = extractConfirmationTime(dashboard.getCell('D3'));
  const requiredPn = readNumber(dashboard.getCell('B2'), { required: true, nonNegative: true })!;
  const receivedPn = readNumber(dashboard.getCell('B3'), { required: true, nonNegative: true })!;
  const pnDifference = readNumber(dashboard.getCell('B4'), { required: true })!;
  const receiptQty = readNumber(dashboard.getCell('B5'), { required: true, nonNegative: true })!;
  const issueQty = readNumber(dashboard.getCell('B6'), { required: true, nonNegative: true })!;
  const sourceQtyDifference = readNumber(dashboard.getCell('B7'));
  const qtyDifference = sourceQtyDifference ?? receiptQty - issueQty;
  const shortageCount = readNumber(dashboard.getCell('B8'), { required: true, nonNegative: true })!;
  const extraPnCount = readNumber(dashboard.getCell('B9'), { required: true, nonNegative: true })!;

  let actualReceiptQtyDiffCount: number | null = null;
  if (fileVersion === 'current') {
    actualReceiptQtyDiffCount = readNumber(dashboard.getCell('B10'));
    if (actualReceiptQtyDiffCount === null) {
      throw new MaterialFileParseError('current_b10_missing', 'Current files require Dashboard!B10.', 'B10');
    }
    if (actualReceiptQtyDiffCount < 0) {
      throw new MaterialFileParseError('negative_count', 'Dashboard!B10 cannot be negative.', 'B10');
    }
  }

  const warnings: ParseWarningCode[] = [];
  if (!operator) warnings.push('operator_missing');
  if (!confirmationTime) warnings.push('confirmation_time_missing');

  return {
    record: evaluateMaterial({
      workOrder,
      fileVersion,
      sourceFile: options.sourceFile,
      sourceState: options.sourceState,
      operator,
      confirmationTime,
      requiredPn,
      receivedPn,
      pnDifference,
      receiptQty,
      issueQty,
      qtyDifference,
      shortageCount,
      extraPnCount,
      actualReceiptQtyDiffCount,
      sourceDocumentUrl: options.sourceDocumentUrl,
      sourceObjectKey: options.sourceObjectKey,
      lastUpdated: options.lastUpdated ?? new Date().toISOString(),
    }),
    warnings,
  };
}

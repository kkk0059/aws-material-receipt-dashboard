import {
  MaterialFileParseError,
  parseMaterialWorkbook,
  type ParseMaterialFileOptions,
  type ParseWarningCode,
} from './material-file-parser.ts';
import type { MaterialRecord } from './material-rules.ts';
import {
  sha256Hex,
  type IngestionErrorRepository,
  type UpsertOutcome,
  type WorkOrderRepository,
} from './work-order-repository.ts';

export type IngestionResult =
  | {
      ok: true;
      outcome: UpsertOutcome;
      contentHash: string;
      record: MaterialRecord;
      warnings: ParseWarningCode[];
    }
  | {
      ok: false;
      contentHash: string;
      errorCode: string;
      message: string;
      cell?: string;
    };

export interface MaterialIngestionDependencies {
  workOrders: WorkOrderRepository;
  errors: IngestionErrorRepository;
}

export async function ingestMaterialFile(
  data: Buffer | Uint8Array | ArrayBuffer,
  options: ParseMaterialFileOptions,
  dependencies: MaterialIngestionDependencies,
): Promise<IngestionResult> {
  const contentHash = await sha256Hex(data);
  const importedAt = options.lastUpdated ?? new Date().toISOString();

  try {
    const parsed = await parseMaterialWorkbook(data, { ...options, lastUpdated: importedAt });
    const outcome = await dependencies.workOrders.upsert(parsed.record, contentHash, importedAt);
    return { ok: true, outcome, contentHash, record: parsed.record, warnings: parsed.warnings };
  } catch (error) {
    const parseError = error instanceof MaterialFileParseError
      ? error
      : new MaterialFileParseError('invalid_workbook', error instanceof Error ? error.message : 'Unknown ingestion error');
    await dependencies.errors.add({
      sourceFile: options.sourceFile,
      contentHash,
      importedAt,
      errorCode: parseError.code,
      message: parseError.message,
      cell: parseError.cell,
    });
    return {
      ok: false,
      contentHash,
      errorCode: parseError.code,
      message: parseError.message,
      cell: parseError.cell,
    };
  }
}

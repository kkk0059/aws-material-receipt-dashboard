import type { MaterialRecord } from './material-rules.ts';

export type UpsertOutcome = 'created' | 'updated' | 'duplicate';

export interface IngestionEvent {
  ingestionId: string;
  workOrder: string;
  sourceFile: string;
  contentHash: string;
  importedAt: string;
  outcome: UpsertOutcome;
}

export interface IngestionErrorEvent {
  ingestionId: string;
  sourceFile: string;
  contentHash: string;
  importedAt: string;
  errorCode: string;
  message: string;
  cell?: string;
}

export interface WorkOrderRepository {
  list(): Promise<MaterialRecord[]>;
  get(workOrder: string): Promise<MaterialRecord | null>;
  upsert(record: MaterialRecord, contentHash: string, importedAt?: string): Promise<UpsertOutcome>;
  ingestionHistory(): Promise<IngestionEvent[]>;
}

export interface IngestionErrorRepository {
  add(error: Omit<IngestionErrorEvent, 'ingestionId'>): Promise<void>;
  list(): Promise<IngestionErrorEvent[]>;
}

export class InMemoryWorkOrderRepository implements WorkOrderRepository {
  private readonly records = new Map<string, MaterialRecord>();
  private readonly processedHashes = new Set<string>();
  private readonly events: IngestionEvent[] = [];

  constructor(seed: MaterialRecord[] = []) {
    seed.forEach((record) => this.records.set(record.workOrder, structuredClone(record)));
  }

  async list(): Promise<MaterialRecord[]> {
    return [...this.records.values()]
      .map((record) => structuredClone(record))
      .sort((a, b) => a.workOrder.localeCompare(b.workOrder));
  }

  async get(workOrder: string): Promise<MaterialRecord | null> {
    const record = this.records.get(workOrder);
    return record ? structuredClone(record) : null;
  }

  async upsert(record: MaterialRecord, contentHash: string, importedAt = new Date().toISOString()): Promise<UpsertOutcome> {
    const sourceFile = record.sourceFile ?? 'unknown';
    if (this.processedHashes.has(contentHash)) {
      this.events.push({ ingestionId: crypto.randomUUID(), workOrder: record.workOrder, sourceFile, contentHash, importedAt, outcome: 'duplicate' });
      return 'duplicate';
    }

    const outcome: UpsertOutcome = this.records.has(record.workOrder) ? 'updated' : 'created';
    this.records.set(record.workOrder, structuredClone(record));
    this.processedHashes.add(contentHash);
    this.events.push({ ingestionId: crypto.randomUUID(), workOrder: record.workOrder, sourceFile, contentHash, importedAt, outcome });
    return outcome;
  }

  async ingestionHistory(): Promise<IngestionEvent[]> {
    return this.events.map((event) => structuredClone(event));
  }
}

export class InMemoryIngestionErrorRepository implements IngestionErrorRepository {
  private readonly errors: IngestionErrorEvent[] = [];

  async add(error: Omit<IngestionErrorEvent, 'ingestionId'>): Promise<void> {
    this.errors.push({ ingestionId: crypto.randomUUID(), ...structuredClone(error) });
  }

  async list(): Promise<IngestionErrorEvent[]> {
    return this.errors.map((error) => structuredClone(error));
  }
}

export async function sha256Hex(data: Buffer | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

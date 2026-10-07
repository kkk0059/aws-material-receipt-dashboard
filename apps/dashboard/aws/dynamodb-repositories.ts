import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';
import type { MaterialRecord } from '../lib/material-rules.ts';
import type {
  IngestionErrorEvent,
  IngestionErrorRepository,
  IngestionEvent,
  UpsertOutcome,
  WorkOrderRepository,
} from '../lib/work-order-repository.ts';

type DocumentClient = Pick<DynamoDBDocumentClient, 'send'>;
interface WorkOrderItem {
  work_order: string;
  record: MaterialRecord;
  content_hash: string;
  imported_at: string;
}

export interface DynamoDbRepositoryOptions {
  client: DocumentClient;
  workOrdersTable: string;
  ingestionRecordsTable: string;
  eventTtlDays?: number;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function eventExpiry(importedAt: string, ttlDays: number): number {
  return Math.floor(new Date(importedAt).getTime() / 1000) + ttlDays * 86_400;
}

function isConditionalFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return false;
  const reasons = (error as Error & { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
  return reasons?.some((reason) => reason.Code === 'ConditionalCheckFailed') ?? false;
}

export class DynamoDbWorkOrderRepository implements WorkOrderRepository {
  private readonly client: DocumentClient;
  private readonly workOrdersTable: string;
  private readonly ingestionRecordsTable: string;
  private readonly eventTtlDays: number;

  constructor(options: DynamoDbRepositoryOptions) {
    this.client = options.client;
    this.workOrdersTable = options.workOrdersTable;
    this.ingestionRecordsTable = options.ingestionRecordsTable;
    this.eventTtlDays = options.eventTtlDays ?? 30;
  }

  async list(): Promise<MaterialRecord[]> {
    const records: MaterialRecord[] = [];
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.workOrdersTable,
        ExclusiveStartKey: exclusiveStartKey,
      }));
      records.push(...(result.Items ?? []).map((item) => (item as WorkOrderItem).record));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return records.sort((a, b) => a.workOrder.localeCompare(b.workOrder));
  }

  async get(workOrder: string): Promise<MaterialRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.workOrdersTable,
      Key: { work_order: workOrder },
    }));
    return (result.Item as WorkOrderItem | undefined)?.record ?? null;
  }

  async upsert(record: MaterialRecord, contentHash: string, importedAt = new Date().toISOString()): Promise<UpsertOutcome> {
    const previous = await this.get(record.workOrder);
    const outcome: UpsertOutcome = previous ? 'updated' : 'created';
    const markerId = `HASH#${contentHash}`;
    const eventId = `EVENT#${crypto.randomUUID()}`;
    const expiresAt = eventExpiry(importedAt, this.eventTtlDays);
    const canonicalItem = {
      work_order: record.workOrder,
      record: withoutUndefined(record),
      content_hash: contentHash,
      imported_at: importedAt,
    };
    const event = withoutUndefined({
      record_id: eventId,
      entity_type: 'ingestion_event',
      ingestion_id: eventId.slice(6),
      work_order: record.workOrder,
      source_file: record.sourceFile ?? 'unknown',
      content_hash: contentHash,
      imported_at: importedAt,
      outcome,
      expires_at: expiresAt,
    });

    try {
      await this.client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.ingestionRecordsTable,
              Item: {
                record_id: markerId,
                entity_type: 'content_hash',
                content_hash: contentHash,
                work_order: record.workOrder,
                imported_at: importedAt,
                expires_at: expiresAt,
              },
              ConditionExpression: 'attribute_not_exists(record_id)',
            },
          },
          { Put: { TableName: this.workOrdersTable, Item: canonicalItem } },
          { Put: { TableName: this.ingestionRecordsTable, Item: event } },
        ],
      }));
      return outcome;
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
      const duplicateEventId = `EVENT#${crypto.randomUUID()}`;
      await this.client.send(new PutCommand({
        TableName: this.ingestionRecordsTable,
        Item: {
          record_id: duplicateEventId,
          entity_type: 'ingestion_event',
          ingestion_id: duplicateEventId.slice(6),
          work_order: record.workOrder,
          source_file: record.sourceFile ?? 'unknown',
          content_hash: contentHash,
          imported_at: importedAt,
          outcome: 'duplicate',
          expires_at: expiresAt,
        },
      }));
      return 'duplicate';
    }
  }

  async ingestionHistory(): Promise<IngestionEvent[]> {
    const result = await this.client.send(new ScanCommand({
      TableName: this.ingestionRecordsTable,
      FilterExpression: 'entity_type = :eventType',
      ExpressionAttributeValues: { ':eventType': 'ingestion_event' },
    }));
    return (result.Items ?? []).map((item) => ({
      ingestionId: String(item.ingestion_id),
      workOrder: String(item.work_order),
      sourceFile: String(item.source_file),
      contentHash: String(item.content_hash),
      importedAt: String(item.imported_at),
      outcome: item.outcome as UpsertOutcome,
    })).sort((a, b) => a.importedAt.localeCompare(b.importedAt));
  }
}

export class DynamoDbIngestionErrorRepository implements IngestionErrorRepository {
  private readonly options: DynamoDbRepositoryOptions;

  constructor(options: DynamoDbRepositoryOptions) {
    this.options = options;
  }

  async add(error: Omit<IngestionErrorEvent, 'ingestionId'>): Promise<void> {
    const eventId = `EVENT#${crypto.randomUUID()}`;
    await this.options.client.send(new PutCommand({
      TableName: this.options.ingestionRecordsTable,
      Item: withoutUndefined({
        record_id: eventId,
        entity_type: 'ingestion_error',
        ingestion_id: eventId.slice(6),
        source_file: error.sourceFile,
        content_hash: error.contentHash,
        imported_at: error.importedAt,
        error_code: error.errorCode,
        message: error.message,
        cell: error.cell,
        expires_at: eventExpiry(error.importedAt, this.options.eventTtlDays ?? 30),
      }),
    }));
  }

  async list(): Promise<IngestionErrorEvent[]> {
    const result = await this.options.client.send(new ScanCommand({
      TableName: this.options.ingestionRecordsTable,
      FilterExpression: 'entity_type = :eventType',
      ExpressionAttributeValues: { ':eventType': 'ingestion_error' },
    }));
    return (result.Items ?? []).map((item) => ({
      ingestionId: String(item.ingestion_id),
      sourceFile: String(item.source_file),
      contentHash: String(item.content_hash),
      importedAt: String(item.imported_at),
      errorCode: String(item.error_code),
      message: String(item.message),
      cell: item.cell ? String(item.cell) : undefined,
    }));
  }
}

export function createDynamoDbRepositories(environment = process.env) {
  const workOrdersTable = environment.WORK_ORDERS_TABLE;
  const ingestionRecordsTable = environment.INGESTION_RECORDS_TABLE;
  if (!workOrdersTable || !ingestionRecordsTable) {
    throw new Error('WORK_ORDERS_TABLE and INGESTION_RECORDS_TABLE are required.');
  }
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const options = { client, workOrdersTable, ingestionRecordsTable };
  return {
    workOrders: new DynamoDbWorkOrderRepository(options),
    errors: new DynamoDbIngestionErrorRepository(options),
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApiHandler } from '../aws/api-handler.ts';
import {
  DynamoDbIngestionErrorRepository,
  DynamoDbWorkOrderRepository,
} from '../aws/dynamodb-repositories.ts';
import { createProcessorHandler } from '../aws/processor-handler.ts';
import { generateDemoWorkbook } from '../aws/demo-workbook-generator.ts';
import { demoWorkOrders } from '../lib/demo-data.ts';
import {
  InMemoryIngestionErrorRepository,
  InMemoryWorkOrderRepository,
} from '../lib/work-order-repository.ts';

const demoDir = path.resolve(import.meta.dirname, '..', 'public', 'demo-files');

test('DynamoDB repository writes an idempotency marker, current state and ingestion event atomically', async () => {
  const commands: object[] = [];
  const client = {
    async send(command: object) {
      commands.push(command);
      if (command.constructor.name === 'GetCommand') return {};
      return {};
    },
  };
  const repository = new DynamoDbWorkOrderRepository({
    client: client as never,
    workOrdersTable: 'work-orders',
    ingestionRecordsTable: 'ingestion-records',
  });
  const record = { ...demoWorkOrders[0], sourceObjectKey: 'processed/in-progress/demo.xlsx' };
  const outcome = await repository.upsert(record, 'hash-001', '2026-08-26T08:00:00.000Z');

  assert.equal(outcome, 'created');
  assert.equal(commands.map((command) => command.constructor.name).join(','), 'GetCommand,TransactWriteCommand');
  const transaction = commands[1] as { input: { TransactItems: unknown[] } };
  assert.equal(transaction.input.TransactItems.length, 3);
  assert.equal(JSON.stringify(transaction.input).includes('HASH#hash-001'), true);
  assert.equal(JSON.stringify(transaction.input).includes('processed/in-progress/demo.xlsx'), true);
});

test('DynamoDB repository records a duplicate event when the content marker already exists', async () => {
  const commands: object[] = [];
  const client = {
    async send(command: object) {
      commands.push(command);
      if (command.constructor.name === 'GetCommand') return { Item: { record: demoWorkOrders[0] } };
      if (command.constructor.name === 'TransactWriteCommand') {
        const error = new Error('conditional marker exists') as Error & { CancellationReasons?: Array<{ Code: string }> };
        error.name = 'TransactionCanceledException';
        error.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
        throw error;
      }
      return {};
    },
  };
  const repository = new DynamoDbWorkOrderRepository({
    client: client as never,
    workOrdersTable: 'work-orders',
    ingestionRecordsTable: 'ingestion-records',
  });
  const outcome = await repository.upsert(demoWorkOrders[0], 'same-hash', '2026-08-26T08:01:00.000Z');

  assert.equal(outcome, 'duplicate');
  assert.equal(commands.at(-1)?.constructor.name, 'PutCommand');
  assert.equal(JSON.stringify(commands.at(-1)).includes('duplicate'), true);
});

test('DynamoDB error repository omits an undefined cell and preserves the parser error code', async () => {
  let saved: object | undefined;
  const client = { async send(command: object) { saved = command; return {}; } };
  const repository = new DynamoDbIngestionErrorRepository({
    client: client as never,
    workOrdersTable: 'work-orders',
    ingestionRecordsTable: 'ingestion-records',
  });
  await repository.add({
    sourceFile: 'bad.xlsx',
    contentHash: 'bad-hash',
    importedAt: '2026-08-26T08:02:00.000Z',
    errorCode: 'dashboard_missing',
    message: 'Dashboard worksheet is required.',
  });
  const json = JSON.stringify(saved);
  assert.equal(json.includes('dashboard_missing'), true);
  assert.equal(json.includes('"cell"'), false);
});

test('HTTP API hides the S3 object key and returns a short-lived source URL through a dedicated route', async () => {
  const record = { ...demoWorkOrders[0], sourceObjectKey: 'processed/in-progress/demo.xlsx' };
  const workOrders = new InMemoryWorkOrderRepository([record]);
  const handler = createApiHandler({
    workOrders,
    createSourceUrl: async () => 'https://example.invalid/signed',
    generateDemo: async () => ({ workOrder: 'WO-DEMO-008', fileName: 'INCOMING_WO-DEMO-008.xlsx', scenario: 'current_completed' }),
  });

  const listResponse = await handler({ rawPath: '/work-orders', requestContext: { http: { method: 'GET' } } });
  const listBody = JSON.parse(listResponse.body);
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listBody.data[0].sourceObjectKey, undefined);

  const sourceResponse = await handler({
    rawPath: `/work-orders/${record.workOrder}/source-document`,
    requestContext: { http: { method: 'GET' } },
    pathParameters: { workOrder: record.workOrder },
  });
  assert.equal(sourceResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(sourceResponse.body), {
    url: 'https://example.invalid/signed',
    expiresInSeconds: 300,
  });
});

test('HTTP API accepts a synthetic Demo request and queues it for the existing S3 ingestion flow', async () => {
  const workOrders = new InMemoryWorkOrderRepository();
  let scenario: unknown;
  const handler = createApiHandler({
    workOrders,
    createSourceUrl: async () => 'unused',
    generateDemo: async (requestedScenario) => {
      scenario = requestedScenario;
      return { workOrder: 'WO-DEMO-011', fileName: 'INCOMING_WO-DEMO-011.xlsx', scenario: 'current_shortage' };
    },
  });
  const result = await handler({
    rawPath: '/demo/generate',
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify({ scenario: 'current_shortage' }),
  });
  assert.equal(result.statusCode, 202);
  assert.equal(scenario, 'current_shortage');
  assert.equal(JSON.parse(result.body).data.workOrder, 'WO-DEMO-011');
});

test('Damaged XLSX Demo writes an intentionally invalid workbook-shaped file to the watched incoming prefix', async () => {
  const commands: object[] = [];
  const result = await generateDemoWorkbook({
    s3: { async send(command: object) { commands.push(command); return {}; } } as never,
    bucket: 'synthetic-demo-bucket',
    workOrders: new InMemoryWorkOrderRepository(),
    scenario: 'damaged_xlsx',
  });
  assert.equal(result.scenario, 'damaged_xlsx');
  assert.equal(result.fileName, 'INCOMING_WO-DEMO-008_DAMAGED.xlsx');
  assert.equal(commands.length, 1);
  const command = commands[0] as { constructor: { name: string }; input: { Key: string; Metadata: Record<string, string>; Body: Buffer } };
  assert.equal(command.constructor.name, 'PutObjectCommand');
  assert.equal(command.input.Key, 'incoming/in-progress/INCOMING_WO-DEMO-008_DAMAGED.xlsx');
  assert.equal(command.input.Metadata.expected_result, 'rejected');
  assert.equal(command.input.Body.toString('utf8').includes('not a valid workbook'), true);
});

test('S3 processor parses a synthetic workbook, writes current state and moves the source to processed', async () => {
  const fileName = 'IN_PROGRESS_CURRENT_COMPLETED_WO-DEMO-001.xlsx';
  const bytes = await fs.readFile(path.join(demoDir, fileName));
  const commands: object[] = [];
  const s3 = {
    async send(command: object) {
      commands.push(command);
      if (command.constructor.name === 'GetObjectCommand') {
        return { Body: { transformToByteArray: async () => Uint8Array.from(bytes) } };
      }
      return {};
    },
  };
  const workOrders = new InMemoryWorkOrderRepository();
  const errors = new InMemoryIngestionErrorRepository();
  const handler = createProcessorHandler({
    s3: s3 as never,
    workOrders,
    errors,
    expectedBucket: 'synthetic-demo-bucket',
  });
  const result = await handler({ Records: [{
    s3: {
      bucket: { name: 'synthetic-demo-bucket' },
      object: { key: `incoming/in-progress/${fileName}` },
    },
  }] });

  assert.deepEqual(result, { processed: 1, rejected: 0, duplicate: 0 });
  assert.equal(commands.map((command) => command.constructor.name).join(','), 'GetObjectCommand,CopyObjectCommand,DeleteObjectCommand');
  const saved = await workOrders.get('WO-DEMO-001');
  assert.equal(saved?.sourceObjectKey, `processed/in-progress/${fileName}`);
  assert.equal((await errors.list()).length, 0);
});

test('S3 processor records a structured CloudWatch error summary and moves a damaged workbook to rejected', async () => {
  const commands: object[] = [];
  const s3 = {
    async send(command: object) {
      commands.push(command);
      if (command.constructor.name === 'GetObjectCommand') {
        return { Body: { transformToByteArray: async () => Uint8Array.from([0x00, 0x01, 0x02]) } };
      }
      return {};
    },
  };
  const errors = new InMemoryIngestionErrorRepository();
  const handler = createProcessorHandler({
    s3: s3 as never,
    workOrders: new InMemoryWorkOrderRepository(),
    errors,
    expectedBucket: 'synthetic-demo-bucket',
  });
  const originalError = console.error;
  let capturedLog = '';
  console.error = (message: unknown) => { capturedLog = String(message); };
  try {
    const result = await handler({ Records: [{
      s3: { bucket: { name: 'synthetic-demo-bucket' }, object: { key: 'incoming/INCOMING_WO-DEMO-ERROR.xlsx' } },
    }] });
    assert.deepEqual(result, { processed: 0, rejected: 1, duplicate: 0 });
  } finally {
    console.error = originalError;
  }
  assert.equal(commands.map((command) => command.constructor.name).join(','), 'GetObjectCommand,CopyObjectCommand,DeleteObjectCommand');
  assert.equal((await errors.list()).length, 1);
  assert.equal(capturedLog.includes('material_ingestion_rejected'), true);
  assert.equal(capturedLog.includes('rejected/INCOMING_WO-DEMO-ERROR.xlsx'), true);
  assert.equal(capturedLog.includes('invalid_workbook'), true);
});

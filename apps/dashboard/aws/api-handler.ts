import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MaterialRecord } from '../lib/material-rules.ts';
import type { WorkOrderRepository } from '../lib/work-order-repository.ts';
import { createDynamoDbRepositories } from './dynamodb-repositories.ts';
import { generateDemoWorkbook } from './demo-workbook-generator.ts';

interface HttpApiEvent {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  pathParameters?: Record<string, string | undefined>;
  body?: string | null;
}

interface ApiDependencies {
  workOrders: WorkOrderRepository;
  createSourceUrl: (record: MaterialRecord) => Promise<string>;
  generateDemo: (scenario: unknown) => Promise<{ workOrder: string; fileName: string; scenario: string }>;
}

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function publicRecord(record: MaterialRecord): MaterialRecord {
  const { sourceObjectKey: _sourceObjectKey, ...visible } = record;
  return visible;
}

export function createApiHandler(dependencies: ApiDependencies) {
  return async (event: HttpApiEvent) => {
    try {
      const method = event.requestContext?.http?.method;
      const rawPath = event.rawPath ?? '';
      if (method === 'POST' && rawPath.endsWith('/demo/generate')) {
        let scenario: unknown;
        try { scenario = JSON.parse(event.body ?? '{}').scenario; } catch { return response(400, { error: { code: 'invalid_json', message: 'Request body must be JSON.' } }); }
        const generated = await dependencies.generateDemo(scenario);
        return response(202, { data: generated, meta: { status: 'uploaded_to_incoming', message: 'Synthetic workbook uploaded; waiting for automatic import.' } });
      }
      if (method !== 'GET') return response(405, { error: { code: 'method_not_allowed', message: 'Only GET and demo generation POST are supported.' } });
      const workOrder = event.pathParameters?.workOrder;
      if (rawPath.endsWith('/source-document') && workOrder) {
        const record = await dependencies.workOrders.get(workOrder);
        if (!record) return response(404, { error: { code: 'not_found', message: 'Work order was not found.' } });
        if (!record.sourceObjectKey) return response(409, { error: { code: 'source_unavailable', message: 'Source document is not available.' } });
        const url = await dependencies.createSourceUrl(record);
        return response(200, { url, expiresInSeconds: 300 });
      }
      if (workOrder) {
        const record = await dependencies.workOrders.get(workOrder);
        return record
          ? response(200, { data: publicRecord(record) })
          : response(404, { error: { code: 'not_found', message: 'Work order was not found.' } });
      }
      const records = await dependencies.workOrders.list();
      return response(200, {
        data: records.map(publicRecord),
        meta: { count: records.length, source: 'aws-dynamodb' },
      });
    } catch (error) {
      console.error('Material dashboard API failed.', error);
      return response(500, { error: { code: 'internal_error', message: 'Unable to process the request.' } });
    }
  };
}

let runtimeHandler: ReturnType<typeof createApiHandler> | undefined;

export async function handler(event: HttpApiEvent) {
  if (!runtimeHandler) {
    const sourceBucket = process.env.SOURCE_BUCKET;
    if (!sourceBucket) throw new Error('SOURCE_BUCKET is required.');
    const s3 = new S3Client({});
    const repositories = createDynamoDbRepositories();
    runtimeHandler = createApiHandler({
      workOrders: repositories.workOrders,
      createSourceUrl: async (record) => getSignedUrl(s3, new GetObjectCommand({
        Bucket: sourceBucket,
        Key: record.sourceObjectKey!,
        ResponseContentDisposition: `inline; filename="${encodeURIComponent(record.sourceFile ?? `${record.workOrder}.xlsx`)}"`,
      }), { expiresIn: 300 }),
      generateDemo: async (scenario) => generateDemoWorkbook({ s3, bucket: sourceBucket, workOrders: repositories.workOrders, scenario }),
    });
  }
  return runtimeHandler(event);
}

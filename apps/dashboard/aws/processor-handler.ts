import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  type S3Client as S3ClientType,
} from '@aws-sdk/client-s3';
import { ingestMaterialFile } from '../lib/material-ingestion-service.ts';
import type { SourceState } from '../lib/material-rules.ts';
import type { IngestionErrorRepository, WorkOrderRepository } from '../lib/work-order-repository.ts';
import { createDynamoDbRepositories } from './dynamodb-repositories.ts';

interface S3EventRecord {
  s3: { bucket: { name: string }; object: { key: string } };
}

interface S3Event {
  Records?: S3EventRecord[];
}

interface ProcessorDependencies {
  s3: Pick<S3ClientType, 'send'>;
  workOrders: WorkOrderRepository;
  errors: IngestionErrorRepository;
  expectedBucket: string;
}

function decodeS3Key(key: string): string {
  return decodeURIComponent(key.replaceAll('+', ' '));
}

function sourceStateFromKey(key: string): SourceState {
  return key.startsWith('incoming/archived/') ? 'archived' : 'in_progress';
}

function destinationKey(key: string, result: 'processed' | 'rejected'): string {
  return key.replace(/^incoming\//, `${result}/`);
}

async function moveObject(
  s3: Pick<S3ClientType, 'send'>,
  bucket: string,
  sourceKey: string,
  targetKey: string,
): Promise<void> {
  const encodedKey = encodeURIComponent(sourceKey).replaceAll('%2F', '/');
  await s3.send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${encodedKey}`,
    Key: targetKey,
  }));
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
}

export function createProcessorHandler(dependencies: ProcessorDependencies) {
  return async (event: S3Event) => {
    const summary = { processed: 0, rejected: 0, duplicate: 0 };
    for (const eventRecord of event.Records ?? []) {
      const bucket = eventRecord.s3.bucket.name;
      const key = decodeS3Key(eventRecord.s3.object.key);
      if (bucket !== dependencies.expectedBucket) throw new Error(`Unexpected S3 bucket: ${bucket}`);
      if (!key.startsWith('incoming/') || !key.toLowerCase().endsWith('.xlsx')) continue;

      const targetKey = destinationKey(key, 'processed');
      const object = await dependencies.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!object.Body) throw new Error(`S3 object has no body: ${key}`);
      const bytes = await object.Body.transformToByteArray();
      const result = await ingestMaterialFile(bytes, {
        sourceFile: key.split('/').at(-1) ?? key,
        sourceObjectKey: targetKey,
        sourceState: sourceStateFromKey(key),
        syntheticOnly: true,
      }, {
        workOrders: dependencies.workOrders,
        errors: dependencies.errors,
      });

      if (!result.ok) {
        const rejectedKey = destinationKey(key, 'rejected');
        await moveObject(dependencies.s3, bucket, key, rejectedKey);
        summary.rejected += 1;
        console.error(JSON.stringify({
          event: 'material_ingestion_rejected', bucket, sourceKey: key, rejectedKey,
          errorCode: result.errorCode, cell: result.cell ?? null, message: result.message,
          contentHash: result.contentHash,
        }));
        continue;
      }

      await moveObject(dependencies.s3, bucket, key, targetKey);
      if (result.outcome === 'duplicate') summary.duplicate += 1;
      else summary.processed += 1;
      console.info(JSON.stringify({
        event: 'material_ingestion_succeeded', bucket, sourceKey: key, processedKey: targetKey,
        workOrder: result.record.workOrder, outcome: result.outcome, contentHash: result.contentHash,
      }));
    }
    console.info(JSON.stringify({ event: 'material_ingestion_batch_complete', ...summary }));
    return summary;
  };
}

let runtimeHandler: ReturnType<typeof createProcessorHandler> | undefined;

export async function handler(event: S3Event) {
  if (!runtimeHandler) {
    const sourceBucket = process.env.SOURCE_BUCKET;
    if (!sourceBucket) throw new Error('SOURCE_BUCKET is required.');
    const repositories = createDynamoDbRepositories();
    runtimeHandler = createProcessorHandler({
      s3: new S3Client({}),
      workOrders: repositories.workOrders,
      errors: repositories.errors,
      expectedBucket: sourceBucket,
    });
  }
  return runtimeHandler(event);
}

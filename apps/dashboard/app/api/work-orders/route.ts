import { demoRepository } from '../../../lib/demo-repository';

export async function GET() {
  const data = await demoRepository.list();
  return Response.json({
    data,
    meta: {
      count: data.length,
      source: 'synthetic-demo-repository',
      generatedAt: new Date().toISOString(),
    },
  });
}

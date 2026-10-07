import { demoWorkOrders } from './demo-data.ts';
import { InMemoryWorkOrderRepository } from './work-order-repository.ts';

const globalRepository = globalThis as typeof globalThis & {
  __materialDemoRepository?: InMemoryWorkOrderRepository;
};

export const demoRepository = globalRepository.__materialDemoRepository ?? new InMemoryWorkOrderRepository(demoWorkOrders);

if (process.env.NODE_ENV !== 'production') {
  globalRepository.__materialDemoRepository = demoRepository;
}

export type TasmeeQueuedChunk<T> = {
  seq: number;
  payload: T;
};

export const enqueueChunk = <T>(
  queue: TasmeeQueuedChunk<T>[],
  payload: T,
  seq: number,
  maxQueueSize: number,
) => {
  if (queue.length > 0 && seq <= queue[queue.length - 1].seq) {
    return queue;
  }

  const nextQueue = [...queue, { seq, payload }];
  if (nextQueue.length <= maxQueueSize) {
    return nextQueue;
  }

  return nextQueue.slice(nextQueue.length - maxQueueSize);
};

export const dequeueChunk = <T>(queue: TasmeeQueuedChunk<T>[]) => {
  if (queue.length === 0) return { nextQueue: queue, item: null };
  const [item, ...rest] = queue;
  return { nextQueue: rest, item };
};

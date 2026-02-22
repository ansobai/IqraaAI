import assert from "node:assert/strict";
import test from "node:test";

import { dequeueChunk, enqueueChunk } from "./tasmeeChunkQueue";

test("enqueue keeps monotonic sequence", () => {
  let queue: { seq: number; payload: string }[] = [];
  queue = enqueueChunk(queue, "a", 1, 4);
  queue = enqueueChunk(queue, "b", 2, 4);
  queue = enqueueChunk(queue, "out-of-order", 2, 4);
  assert.deepEqual(queue.map((item) => item.seq), [1, 2]);
});

test("enqueue drops oldest when max size exceeded", () => {
  let queue: { seq: number; payload: string }[] = [];
  queue = enqueueChunk(queue, "a", 1, 2);
  queue = enqueueChunk(queue, "b", 2, 2);
  queue = enqueueChunk(queue, "c", 3, 2);
  assert.deepEqual(queue.map((item) => item.seq), [2, 3]);
});

test("dequeue returns first item and remaining queue", () => {
  const source = [
    { seq: 4, payload: "x" },
    { seq: 5, payload: "y" },
  ];
  const first = dequeueChunk(source);
  assert.equal(first.item?.seq, 4);
  assert.deepEqual(first.nextQueue.map((item) => item.seq), [5]);
});

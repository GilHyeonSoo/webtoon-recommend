import { parentPort } from 'node:worker_threads';
parentPort.on('message', ({ id, cancel }) => {
  const flag = new Int32Array(cancel);
  if (id === 1) {
    // Emulate CPU work that acknowledges an abort without discarding its index.
    const end = Date.now() + 2000;
    while (!Atomics.load(flag, 0) && Date.now() < end) { /* bounded test loop */ }
  }
  parentPort.postMessage({ id, result: [] });
});
parentPort.postMessage({ ready: true });

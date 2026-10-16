import { parentPort } from 'node:worker_threads';
parentPort.on('message', ({ id }) => setTimeout(() => parentPort.postMessage({ id, result: [] }), 1000));
parentPort.postMessage({ ready: true });

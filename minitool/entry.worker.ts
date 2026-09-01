import { runWorkerGeneration, type WorkerInboundMessage } from '../src/worker-protocol';

let activeRequestId = '';
let cancelled = false;

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    if (message.requestId === activeRequestId) cancelled = true;
    return;
  }
  activeRequestId = message.requestId;
  cancelled = false;
  runWorkerGeneration(
    message,
    undefined,
    (outbound) => self.postMessage(outbound),
    () => performance.now(),
    () => cancelled || activeRequestId !== message.requestId,
  );
};

export {};

import { describe, expect, it } from 'vitest';
import { ALGORITHM_VERSION } from '../src';
import { isWorkerMessageForRequest, runWorkerGeneration, type WorkerOutboundMessage } from '../src/worker-protocol';
import { makeImage } from './helpers';

describe('Worker generation protocol', () => {
  it('propagates request IDs, ordered progress, diagnostics and version', () => {
    const messages: WorkerOutboundMessage[] = [];
    runWorkerGeneration({ type: 'generate', requestId: 'run-1', img: makeImage(1, 1, () => [0, 0, 0, 255]), params: { board: '52x52' } },
      (_img, _params, runtime) => {
        for (const [stage, progress] of [['prepare', 0], ['resample', 20], ['candidates', 40], ['optimize', 65], ['cleanup', 85], ['done', 100]] as const) runtime.onProgress?.({ stage, progress });
        return { grid: { rows: 1, cols: 1, colorCount: 1, cells: [[{ code: 'A1', hex: '000000', external: false }]] }, mode: 'cropped-and-filled', diagnostics: { colorCountBefore: 2, colorCountAfter: 1 } };
      },
      (message) => messages.push(message),
      () => 10,
    );
    expect(messages.map((message) => message.type)).toEqual(['progress', 'progress', 'progress', 'progress', 'progress', 'progress', 'done']);
    expect(messages.every((message) => message.requestId === 'run-1')).toBe(true);
    expect(messages.filter((message) => message.type === 'progress').map((message) => message.progress)).toEqual([0, 20, 40, 65, 85, 100]);
    const done = messages[messages.length - 1];
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.diagnostics.colorCountAfter).toBe(1);
      expect(done.algorithmVersion).toBe(ALGORITHM_VERSION);
    }
    expect(isWorkerMessageForRequest(done!, 'run-1')).toBe(true);
    expect(isWorkerMessageForRequest(done!, 'stale')).toBe(false);
  });

  it('returns a structured error for the active request', () => {
    const messages: WorkerOutboundMessage[] = [];
    runWorkerGeneration({ type: 'generate', requestId: 'run-error', img: makeImage(1, 1, () => [0, 0, 0, 255]), params: { board: '52x52' } },
      () => { throw new Error('boom'); },
      (message) => messages.push(message),
    );
    expect(messages).toEqual([{ type: 'error', requestId: 'run-error', message: 'boom', algorithmVersion: ALGORITHM_VERSION }]);
  });
});

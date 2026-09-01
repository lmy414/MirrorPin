import type { TopLevelOptions, GenerateResult, BoardGenerationRuntime } from './board';
import type { PipelineDiagnostics, RgbaImage } from './core/types';
import type { GenerationStage } from './beadpattern/core';
import { ALGORITHM_VERSION } from './version';
import { generateForBoard } from './board';

export interface WorkerGenerateMessage {
  type: 'generate';
  requestId: string;
  img: RgbaImage;
  params: TopLevelOptions;
}

export interface WorkerCancelMessage { type: 'cancel'; requestId: string }
export type WorkerInboundMessage = WorkerGenerateMessage | WorkerCancelMessage;

export interface WorkerProgressMessage {
  type: 'progress';
  requestId: string;
  stage: GenerationStage;
  progress: number;
  elapsedMs: number;
  algorithmVersion: string;
}
export interface WorkerDoneMessage {
  type: 'done';
  requestId: string;
  grid: GenerateResult['grid'];
  diagnostics: Partial<PipelineDiagnostics>;
  elapsedMs: number;
  algorithmVersion: string;
}
export interface WorkerErrorMessage {
  type: 'error';
  requestId: string;
  message: string;
  algorithmVersion: string;
}
export interface WorkerCancelledMessage {
  type: 'cancelled';
  requestId: string;
  algorithmVersion: string;
}
export type WorkerOutboundMessage = WorkerProgressMessage | WorkerDoneMessage | WorkerErrorMessage | WorkerCancelledMessage;

export type WorkerGenerator = (
  img: RgbaImage,
  params: TopLevelOptions,
  runtime: BoardGenerationRuntime,
) => GenerateResult;

export function isWorkerMessageForRequest(message: WorkerOutboundMessage, requestId: string): boolean {
  return message.requestId === requestId;
}

export function runWorkerGeneration(
  message: WorkerGenerateMessage,
  generate: WorkerGenerator = generateForBoard,
  post: (message: WorkerOutboundMessage) => void,
  now: () => number = () => performance.now(),
  isCancelled: () => boolean = () => false,
): void {
  const started = now();
  const diagnostics: Partial<PipelineDiagnostics> = {};
  try {
    const result = generate(message.img, message.params, {
      diagnostics,
      shouldCancel: isCancelled,
      onProgress: ({ stage, progress }) => post({
        type: 'progress', requestId: message.requestId, stage, progress,
        elapsedMs: Math.max(0, Math.round(now() - started)), algorithmVersion: ALGORITHM_VERSION,
      }),
    });
    if (isCancelled()) {
      post({ type: 'cancelled', requestId: message.requestId, algorithmVersion: ALGORITHM_VERSION });
      return;
    }
    post({
      type: 'done', requestId: message.requestId, grid: result.grid,
      diagnostics: result.diagnostics ?? diagnostics,
      elapsedMs: Math.max(0, Math.round(now() - started)), algorithmVersion: ALGORITHM_VERSION,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isCancelled() || /取消/.test(text)) post({ type: 'cancelled', requestId: message.requestId, algorithmVersion: ALGORITHM_VERSION });
    else post({ type: 'error', requestId: message.requestId, message: text, algorithmVersion: ALGORITHM_VERSION });
  }
}

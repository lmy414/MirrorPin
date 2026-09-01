// L0 梯度最小化平滑（保边压平）。
// 移植自 t-suzuki/l0_gradient_minimization (Public Domain)
//   https://github.com/t-suzuki/l0_gradient_minimization_test
// 论文: "Image Smoothing via L0 Gradient Minimization", Li Xu et al., SIGGRAPH Asia 2011。
// 本实现使用非周期 Neumann 离散梯度及确定性的 PCG，而非周期 FFT 分母。
// 仅处理 RGB，alpha 原样保留；浏览器纯 TypeScript。

import type { RgbaImage } from './types';

const MAX_L0_MEMORY_BYTES = 64 * 1024 * 1024;
// Peak live allocations include input/smooth(6), PCG rhs/residual/direction/operator/
// preconditioned(5), gradient scratch(2), split gradients(6), and the returned RGBA output.
const FLOAT64_ARRAYS_PER_PIXEL = 13;
const FLOAT32_ARRAYS_PER_PIXEL = 6;
const UINT8_ARRAYS_PER_PIXEL = 1;
const UINT8_ELEMENTS_PER_PIXEL = 4;
const UINT8_BYTES_PER_PIXEL = UINT8_ARRAYS_PER_PIXEL * UINT8_ELEMENTS_PER_PIXEL * Uint8ClampedArray.BYTES_PER_ELEMENT;
const FLOAT64_BYTES_PER_PIXEL = FLOAT64_ARRAYS_PER_PIXEL * Float64Array.BYTES_PER_ELEMENT;
const FLOAT32_BYTES_PER_PIXEL = FLOAT32_ARRAYS_PER_PIXEL * Float32Array.BYTES_PER_ELEMENT;
const WORK_BYTES_PER_PIXEL = FLOAT64_BYTES_PER_PIXEL + FLOAT32_BYTES_PER_PIXEL + UINT8_BYTES_PER_PIXEL;
const MAX_L0_PIXELS = Math.floor(MAX_L0_MEMORY_BYTES / WORK_BYTES_PER_PIXEL);

export interface NeumannSolveStats {
  iterations: number;
  residual: number;
  tolerance: number;
}

function checkGrid(width: number, height: number, values: Float64Array): void {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Neumann 网格 width/height 必须为正整数');
  }
  if (values.length !== width * height) throw new Error('Neumann 网格数据长度不匹配');
}

/** 前向 Neumann 梯度：最右/最下边界的导数定义为 0。 */
export function neumannGradient(
  values: Float64Array,
  width: number,
  height: number,
  horizontal: Float64Array,
  vertical: Float64Array,
): void {
  checkGrid(width, height, values);
  if (horizontal.length !== values.length || vertical.length !== values.length) {
    throw new Error('Neumann 梯度工作区长度不匹配');
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      horizontal[i] = x + 1 < width ? values[i + 1]! - values[i]! : 0;
      vertical[i] = y + 1 < height ? values[i + width]! - values[i]! : 0;
    }
  }
}

/** D^T 的一致伴随（即负散度）：外边界没有来自网格外的通量。 */
export function neumannNegativeDivergence(
  horizontal: Float64Array,
  vertical: Float64Array,
  width: number,
  height: number,
  out: Float64Array,
): void {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Neumann 网格 width/height 必须为正整数');
  }
  if (horizontal.length !== width * height || vertical.length !== width * height || out.length !== width * height) {
    throw new Error('Neumann 散度工作区长度不匹配');
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const fromLeft = x > 0 ? horizontal[i - 1]! : 0;
      const fromAbove = y > 0 ? vertical[i - width]! : 0;
      const outgoing = (x + 1 < width ? horizontal[i]! : 0) + (y + 1 < height ? vertical[i]! : 0);
      out[i] = fromLeft + fromAbove - outgoing;
    }
  }
}

/** A = I + beta * D^T D 的非周期 Neumann 线性系统算子。 */
export function applyNeumannSystem(
  values: Float64Array,
  width: number,
  height: number,
  beta: number,
  out: Float64Array,
): void {
  checkGrid(width, height, values);
  if (!Number.isFinite(beta) || beta < 0) throw new Error('Neumann beta 必须为有限非负数');
  if (out.length !== values.length) throw new Error('Neumann 算子工作区长度不匹配');
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      let value = values[i]!;
      if (x > 0) value += beta * (values[i]! - values[i - 1]!);
      if (x + 1 < width) value += beta * (values[i]! - values[i + 1]!);
      if (y > 0) value += beta * (values[i]! - values[i - width]!);
      if (y + 1 < height) value += beta * (values[i]! - values[i + width]!);
      out[i] = value;
    }
  }
}

function neumannDiagonal(width: number, height: number, x: number, y: number, beta: number): number {
  const degree = (x > 0 ? 1 : 0) + (x + 1 < width ? 1 : 0) + (y > 0 ? 1 : 0) + (y + 1 < height ? 1 : 0);
  return 1 + beta * degree;
}

function dot(a: Float64Array, b: Float64Array): number {
  let value = 0;
  for (let i = 0; i < a.length; i++) value += a[i]! * b[i]!;
  return value;
}

/**
 * 确定性 Jacobi-PCG 求解 (I + beta D^T D)x = rhs。
 * solution 既是可选初值也是输出；工作数组由调用方复用，避免按通道重复分配。
 */
export function solveNeumannSystem(
  rhs: Float64Array,
  width: number,
  height: number,
  beta: number,
  solution: Float64Array,
  residualWork: Float64Array,
  directionWork: Float64Array,
  operatorWork: Float64Array,
  preconditionedWork: Float64Array,
  options: { maxIterations?: number; tolerance?: number } = {},
): NeumannSolveStats {
  checkGrid(width, height, rhs);
  if (solution.length !== rhs.length || residualWork.length !== rhs.length || directionWork.length !== rhs.length || operatorWork.length !== rhs.length || preconditionedWork.length !== rhs.length) {
    throw new Error('Neumann PCG 工作区长度不匹配');
  }
  if (!Number.isFinite(beta) || beta < 0) throw new Error('Neumann beta 必须为有限非负数');
  const maxIterations = options.maxIterations ?? 200;
  const relativeTolerance = options.tolerance ?? 1e-8;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new Error('Neumann PCG 最大迭代次数无效');
  if (!Number.isFinite(relativeTolerance) || relativeTolerance <= 0) throw new Error('Neumann PCG 收敛容差无效');

  applyNeumannSystem(solution, width, height, beta, operatorWork);
  for (let i = 0; i < rhs.length; i++) residualWork[i] = rhs[i]! - operatorWork[i]!;
  const rhsNorm = Math.sqrt(dot(rhs, rhs));
  const tolerance = relativeTolerance * Math.max(1, rhsNorm);
  let residualNorm = Math.sqrt(dot(residualWork, residualWork));
  if (!Number.isFinite(residualNorm)) throw new Error('L0 Neumann PCG 初始残差不是有限数');
  if (residualNorm <= tolerance) return { iterations: 0, residual: residualNorm, tolerance };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      preconditionedWork[i] = residualWork[i]! / neumannDiagonal(width, height, x, y, beta);
      directionWork[i] = preconditionedWork[i]!;
    }
  }
  let rz = dot(residualWork, preconditionedWork);
  if (!(rz > 0) || !Number.isFinite(rz)) throw new Error('L0 Neumann PCG 预条件残差无效');

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    applyNeumannSystem(directionWork, width, height, beta, operatorWork);
    const denominator = dot(directionWork, operatorWork);
    if (!(denominator > 0) || !Number.isFinite(denominator)) {
      throw new Error(`L0 Neumann PCG 算子失效（迭代 ${iteration}）`);
    }
    const step = rz / denominator;
    for (let i = 0; i < rhs.length; i++) {
      solution[i] = solution[i]! + step * directionWork[i]!;
      residualWork[i] = residualWork[i]! - step * operatorWork[i]!;
    }
    residualNorm = Math.sqrt(dot(residualWork, residualWork));
    if (!Number.isFinite(residualNorm)) throw new Error(`L0 Neumann PCG 残差不是有限数（迭代 ${iteration}）`);
    if (residualNorm <= tolerance) return { iterations: iteration, residual: residualNorm, tolerance };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        preconditionedWork[i] = residualWork[i]! / neumannDiagonal(width, height, x, y, beta);
      }
    }
    const nextRz = dot(residualWork, preconditionedWork);
    if (!(nextRz > 0) || !Number.isFinite(nextRz)) {
      throw new Error(`L0 Neumann PCG 预条件残差无效（迭代 ${iteration}）`);
    }
    const directionScale = nextRz / rz;
    for (let i = 0; i < rhs.length; i++) directionWork[i] = preconditionedWork[i]! + directionScale * directionWork[i]!;
    rz = nextRz;
  }

  throw new Error(`L0 Neumann PCG 未收敛：残差 ${residualNorm}，容差 ${tolerance}，上限 ${maxIterations} 次`);
}

/**
 * L0 平滑。图像归一化到 0..1；半二次外循环中的线性子问题使用
 * 非周期 Neumann 梯度/伴随散度和 Jacobi-PCG。尺寸不做 2 次幂 padding。
 */
export function l0Smooth(
  img: RgbaImage,
  opts: { lam?: number; betaMax?: number; betaRate?: number } = {},
): RgbaImage {
  const lam = opts.lam ?? 0.02;
  const betaMax = opts.betaMax ?? 1e5;
  const betaRate = opts.betaRate ?? 2.0;
  if (!Number.isFinite(lam) || lam <= 0) throw new Error('lam 必须为有限正数');
  if (!Number.isFinite(betaMax) || betaMax <= 0) throw new Error('betaMax 必须为有限正数');
  if (!Number.isFinite(betaRate) || betaRate <= 1) throw new Error('betaRate 必须为大于 1 的有限数');
  if (!Number.isInteger(img.width) || img.width < 1 || !Number.isInteger(img.height) || img.height < 1) {
    throw new Error('image width/height 必须为正整数');
  }
  if (img.data.length !== img.width * img.height * 4) throw new Error('image data 长度不匹配');

  const width = img.width;
  const height = img.height;
  const pixels = width * height;
  const estimatedBytes = pixels * WORK_BYTES_PER_PIXEL;
  if (estimatedBytes > MAX_L0_MEMORY_BYTES) {
    const estimatedMiB = estimatedBytes / (1024 * 1024);
    const budgetMiB = MAX_L0_MEMORY_BYTES / (1024 * 1024);
    throw new Error(`L0 Neumann 工作区估算 ${estimatedMiB.toFixed(1)} MiB 超过 ${budgetMiB.toFixed(0)} MiB 上限（${pixels} 像素）；请改用 guided`);
  }

  const input = [new Float64Array(pixels), new Float64Array(pixels), new Float64Array(pixels)];
  const smooth = [new Float64Array(pixels), new Float64Array(pixels), new Float64Array(pixels)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const r = img.data[o]! / 255;
      const g = img.data[o + 1]! / 255;
      const b = img.data[o + 2]! / 255;
      input[0]![i] = r; input[1]![i] = g; input[2]![i] = b;
      smooth[0]![i] = r; smooth[1]![i] = g; smooth[2]![i] = b;
    }
  }

  // Float32 足以保存分裂变量（其范围为输入差分的有限倍数），节省大图内存。
  const horizontal = [new Float32Array(pixels), new Float32Array(pixels), new Float32Array(pixels)];
  const vertical = [new Float32Array(pixels), new Float32Array(pixels), new Float32Array(pixels)];
  const rhs = new Float64Array(pixels);
  const residual = new Float64Array(pixels);
  const direction = new Float64Array(pixels);
  const operator = new Float64Array(pixels);
  const preconditioned = new Float64Array(pixels);
  const gradH = new Float64Array(pixels);
  const gradV = new Float64Array(pixels);
  let beta = lam * 2;
  const maxOuterIterations = 30;

  for (let outer = 0; outer < maxOuterIterations; outer++) {
    const threshold = lam / beta;
    for (let c = 0; c < 3; c++) {
      neumannGradient(smooth[c]!, width, height, gradH, gradV);
      horizontal[c]!.set(gradH);
      vertical[c]!.set(gradV);
    }
    for (let i = 0; i < pixels; i++) {
      let magnitudeSquared = 0;
      for (let c = 0; c < 3; c++) magnitudeSquared += horizontal[c]![i]! * horizontal[c]![i]! + vertical[c]![i]! * vertical[c]![i]!;
      if (magnitudeSquared < threshold) {
        for (let c = 0; c < 3; c++) {
          horizontal[c]![i] = 0;
          vertical[c]![i] = 0;
        }
      }
    }

    for (let c = 0; c < 3; c++) {
      const h = horizontal[c]!;
      const v = vertical[c]!;
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const i = row + x;
          const fromLeft = x > 0 ? h[i - 1]! : 0;
          const fromAbove = y > 0 ? v[i - width]! : 0;
          const outgoing = (x + 1 < width ? h[i]! : 0) + (y + 1 < height ? v[i]! : 0);
          rhs[i] = input[c]![i]! + beta * (fromLeft + fromAbove - outgoing);
        }
      }
      solveNeumannSystem(rhs, width, height, beta, smooth[c]!, residual, direction, operator, preconditioned, {
        maxIterations: 200,
        tolerance: 1e-8,
      });
    }

    beta *= betaRate;
    if (beta > betaMax) break;
  }

  const out = new Uint8ClampedArray(img.data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      out[o] = Math.round(Math.min(1, Math.max(0, smooth[0]![i]!)) * 255);
      out[o + 1] = Math.round(Math.min(1, Math.max(0, smooth[1]![i]!)) * 255);
      out[o + 2] = Math.round(Math.min(1, Math.max(0, smooth[2]![i]!)) * 255);
    }
  }
  return { width, height, data: out };
}

export const l0MemoryBudget = {
  maxBytes: MAX_L0_MEMORY_BYTES,
  bytesPerPixel: WORK_BYTES_PER_PIXEL,
  maxPixels: MAX_L0_PIXELS,
  float64ArraysPerPixel: FLOAT64_ARRAYS_PER_PIXEL,
  float32ArraysPerPixel: FLOAT32_ARRAYS_PER_PIXEL,
  uint8ArraysPerPixel: UINT8_ARRAYS_PER_PIXEL,
  uint8ElementsPerPixel: UINT8_ELEMENTS_PER_PIXEL,
  estimatedBytes: WORK_BYTES_PER_PIXEL,
  estimatedMiB: WORK_BYTES_PER_PIXEL / (1024 * 1024),
};

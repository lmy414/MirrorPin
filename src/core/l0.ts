// L0 梯度最小化平滑（保边压平）。
// 移植自 t-suzuki/l0_gradient_minimization (Public Domain)
//   https://github.com/t-suzuki/l0_gradient_minimization_test
// 论文: "Image Smoothing via L0 Gradient Minimization", Li Xu et al., SIGGRAPH Asia 2011。
// FFT 依赖 fft.js (MIT)。仅处理 RGB，alpha 原样保留。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import FFT from 'fft.js';
import type { RgbaImage } from './types';

interface FftJs {
  new (size: number): {
    createComplexArray(): number[];
    transform(out: number[], data: number[]): void;
    inverseTransform(out: number[], data: number[]): void;
  };
}

/** 2D FFT 执行器（W/H 均需为 2 的幂） */
function makeFFT2(W: number, H: number) {
  const Fft = FFT as unknown as FftJs;
  const fRow = new Fft(W);
  const fCol = new Fft(H);
  const rowIn = fRow.createComplexArray();
  const rowOut = fRow.createComplexArray(); // fft.js 要求输入输出缓冲区不同
  const colIn = fCol.createComplexArray();
  const colOut = fCol.createComplexArray();

  function pass2d(re: Float64Array, im: Float64Array, forward: boolean): void {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        rowIn[x * 2] = re[y * W + x]!;
        rowIn[x * 2 + 1] = im[y * W + x]!;
      }
      if (forward) fRow.transform(rowOut, rowIn);
      else fRow.inverseTransform(rowOut, rowIn);
      for (let x = 0; x < W; x++) {
        re[y * W + x] = rowOut[x * 2]!;
        im[y * W + x] = rowOut[x * 2 + 1]!;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        colIn[y * 2] = re[y * W + x]!;
        colIn[y * 2 + 1] = im[y * W + x]!;
      }
      if (forward) fCol.transform(colOut, colIn);
      else fCol.inverseTransform(colOut, colIn);
      for (let y = 0; y < H; y++) {
        re[y * W + x] = colOut[y * 2]!;
        im[y * W + x] = colOut[y * 2 + 1]!;
      }
    }
  }

  return {
    fft2: (re: Float64Array, im: Float64Array) => pass2d(re, im, true),
    ifft2: (re: Float64Array, im: Float64Array) => pass2d(re, im, false),
  };
}

function pow2ceil(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * L0 平滑。图像先归一化到 0..1（与参考实现一致），参数含义相同：
 * lam 梯度稀疏权重（默认 0.02；0.005 为弱档），betaMax 收敛强度（默认 1e5），betaRate 倍率（默认 2）。
 * 非幂尺寸在内部做边缘复制 padding，输出裁回原尺寸。
 */
export function l0Smooth(
  img: RgbaImage,
  opts: { lam?: number; betaMax?: number; betaRate?: number } = {},
): RgbaImage {
  const lam = opts.lam ?? 0.02;
  const betaMax = opts.betaMax ?? 1e5;
  const betaRate = opts.betaRate ?? 2.0;

  const W0 = img.width;
  const H0 = img.height;
  const W = pow2ceil(W0);
  const H = pow2ceil(H0);
  const fft2 = makeFFT2(W, H);
  const N = W * H;

  // 打包 3 通道到 0..1（边缘复制 padding 到 2 的幂）
  const ch = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  for (let y = 0; y < H; y++) {
    const sy = Math.min(y, H0 - 1);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(x, W0 - 1);
      const o = (sy * W0 + sx) * 4;
      ch[0]![y * W + x] = img.data[o]! / 255;
      ch[1]![y * W + x] = img.data[o + 1]! / 255;
      ch[2]![y * W + x] = img.data[o + 2]! / 255;
    }
  }

  // F_denom = |fft2(dx)|² + |fft2(dy)|²（中心差分核，位置与参考实现一致）
  const dxK = new Float64Array(N);
  const dxI = new Float64Array(N);
  const dyK = new Float64Array(N);
  const dyI = new Float64Array(N);
  dxK[(H / 2) * W + (W / 2 - 1)] = -1;
  dxK[(H / 2) * W + W / 2] = 1;
  dyK[((H / 2) - 1) * W + W / 2] = -1;
  dyK[(H / 2) * W + W / 2] = 1;
  fft2.fft2(dxK, dxI);
  fft2.fft2(dyK, dyI);
  const denomRe = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    denomRe[i] = dxK[i]! * dxK[i]! + dxI[i]! * dxI[i]! + dyK[i]! * dyK[i]! + dyI[i]! * dyI[i]!;
  }
  denomRe[0] = 1; // 核的频谱在 [0,0] 处为 0，除法前置 1

  // F_I（每通道一次）
  const FIre = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  const FIim = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  for (let c = 0; c < 3; c++) {
    FIre[c]!.set(ch[c]!);
    fft2.fft2(FIre[c]!, FIim[c]!);
  }

  // 半二次分裂迭代
  let beta = lam * 2.0;
  const hvRe = new Float64Array(N);
  const hvIm = new Float64Array(N);
  const S = ch;
  const maxIter = 30;
  for (let it = 0; it < maxIter; it++) {
    // hp/vp = 循环前向差分；mask: Σ_c(hp²+vp²) < lam/beta → 置零
    const zero = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      const yn = (y + 1) % H;
      for (let x = 0; x < W; x++) {
        const xn = (x + 1) % W;
        const i = y * W + x;
        let sum = 0;
        for (let c = 0; c < 3; c++) {
          const dh = S[c]![y * W + xn]! - S[c]![i]!;
          const dv = S[c]![yn * W + x]! - S[c]![i]!;
          sum += dh * dh + dv * dv;
        }
        if (sum < lam / beta) zero[i] = 1;
      }
    }
    // hv = 循环反向差分的负散度
    for (let c = 0; c < 3; c++) {
      hvRe.fill(0);
      hvIm.fill(0);
      const Sc = S[c]!;
      for (let y = 0; y < H; y++) {
        const yp = (y - 1 + H) % H;
        for (let x = 0; x < W; x++) {
          const xp = (x - 1 + W) % W;
          const i = y * W + x;
          if (zero[i]) continue;
          hvRe[i] = (Sc[y * W + xp]! - Sc[i]!) + (Sc[yp * W + x]! - Sc[i]!);
        }
      }
      fft2.fft2(hvRe, hvIm);
      // S_c = Re(ifft2((F_I + β·fft2(hv)) / (1 + β·denom)))
      const re = FIre[c]!;
      const im = FIim[c]!;
      for (let i = 0; i < N; i++) {
        const d = 1 + beta * denomRe[i]!;
        re[i] = (re[i]! + beta * hvRe[i]!) / d;
        im[i] = (im[i]! + beta * hvIm[i]!) / d;
      }
      fft2.ifft2(re, im);
    }
    beta *= betaRate;
    if (beta > betaMax) break;
  }

  // 写回（裁掉 padding，clamp 到 0..255）
  const out = new Uint8ClampedArray(img.data);
  for (let y = 0; y < H0; y++) {
    for (let x = 0; x < W0; x++) {
      const i = y * W + x;
      const o = (y * W0 + x) * 4;
      out[o] = Math.round(Math.min(1, Math.max(0, S[0]![i]!)) * 255);
      out[o + 1] = Math.round(Math.min(1, Math.max(0, S[1]![i]!)) * 255);
      out[o + 2] = Math.round(Math.min(1, Math.max(0, S[2]![i]!)) * 255);
    }
  }
  return { width: W0, height: H0, data: out };
}

// CIE 色彩科学：sRGB → L*a*b*（D65），以及完整 CIEDE2000 感知色差。
// 忠实复刻 bead-pattern(scripts/generate.py) 的实现，仅将语言改为 TS。

import type { RGB } from '../core/types';

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** 单通道 sRGB(0..255) 解码为线性光 */
function lin(v: number): number {
  const n = v / 255;
  return n > 0.04045 ? Math.pow((n + 0.055) / 1.055, 2.4) : n / 12.92;
}

/** sRGB → CIE L*a*b*（与生成器一致：D65 白点归一化） */
export function srgbToLab(rgb: RGB): Lab {
  const r = lin(rgb.r);
  const g = lin(rgb.g);
  const b = lin(rgb.b);
  // sRGB → XYZ（D65）
  const x0 = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y0 = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z0 = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const d = 6 / 29;
  const f = (t: number): number => (t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29);
  const fx = f(x0);
  const fy = f(y0);
  const fz = f(z0);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

const DEG = Math.PI / 180;

/** 单对 CIEDE2000 感知色差 ΔE00（复制生成器公式，含色相修正 T 与 Rt） */
export function ciede2000(x: Lab, y: Lab): number {
  const L1 = x.L, a1 = x.a, b1 = x.b;
  const L2 = y.L, a2 = y.a, b2 = y.b;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) / DEG + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) / DEG + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = ((h2p - h1p) % 360 + 360) % 360;
  if (dhp > 180) dhp -= 360;
  if (C1p * C2p === 0) dhp = 0;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * DEG) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  const habs = Math.abs(h1p - h2p);
  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (habs <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T =
    1
    - 0.17 * Math.cos((hbarp - 30) * DEG)
    + 0.24 * Math.cos(2 * hbarp * DEG)
    + 0.32 * Math.cos((3 * hbarp + 6) * DEG)
    - 0.2 * Math.cos((4 * hbarp - 63) * DEG);

  const dtheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const c7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(c7 / (c7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dtheta * DEG) * Rc;

  const dE =
    Math.sqrt(
      (dLp / Sl) ** 2
      + (dCp / Sc) ** 2
      + (dHp / Sh) ** 2
      + Rt * (dCp / Sc) * (dHp / Sh),
    );
  return dE;
}
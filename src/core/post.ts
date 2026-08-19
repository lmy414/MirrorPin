// 后处理：连通区域合并（除杂色）+ 边界连通背景移除（保留内部孔洞）。

import type { Cell, RGB } from './types';
import type { Oklab } from './color';
import { hexToRgb, oklabDistance, srgbToOklab } from './color';

const FOUR_NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

function cloneGrid(cells: Cell[][]): Cell[][] {
  return cells.map((row) => row.map((c) => ({ ...c })));
}

/** 建一个按 hex 缓存 Oklab 的取色函数 */
function makeLabCache() {
  const cache = new Map<string, Oklab>();
  return (cell: Cell): Oklab => {
    let lab = cache.get(cell.hex);
    if (!lab) {
      lab = srgbToOklab(hexToRgb(cell.hex));
      cache.set(cell.hex, lab);
    }
    return lab;
  };
}

/**
 * 四邻域 BFS 合并感知相近的区域：相邻格色卡色差 < threshold 并入同一区域，
 * 区域统一为内部出现次数最多的色号，以削减单格杂色。返回副本。
 * @param threshold Oklab 距离（0..1 量级）
 */
export function mergeRegions(cells: Cell[][], threshold: number): Cell[][] {
  const out = cloneGrid(cells);
  const rows = out.length;
  const cols = rows === 0 ? 0 : (out[0] as Cell[]).length;
  const seen = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const labAt = makeLabCache();

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const seed = out[y]?.[x] as Cell;
      if (seen[y]?.[x] || seed.external) continue;
      const seedLab = labAt(seed);

      const queue: Array<[number, number]> = [[y, x]];
      const region: Array<[number, number]> = [];
      const freq = new Map<string, { n: number; hex: string }>();
      seen[y]![x] = true;

      while (queue.length) {
        const [cy, cx] = queue.pop() as [number, number];
        region.push([cy, cx]);
        const cur = out[cy]?.[cx] as Cell;
        const rec = freq.get(cur.code);
        if (rec) rec.n++;
        else freq.set(cur.code, { n: 1, hex: cur.hex });
        for (const [dy, dx] of FOUR_NEIGHBORS) {
          const ny = cy + dy;
          const nx = cx + dx;
          if (ny < 0 || nx < 0 || ny >= rows || nx >= cols) continue;
          if (seen[ny]?.[nx]) continue;
          const nb = out[ny]?.[nx] as Cell;
          if (nb.external) continue;
          if (oklabDistance(seedLab, labAt(nb)) > threshold) continue;
          seen[ny]![nx] = true;
          queue.push([ny, nx]);
        }
      }

      const best = [...freq.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      if (best) {
        const [code, { hex }] = best;
        for (const [ry, rx] of region) {
          const c = out[ry]?.[rx] as Cell;
          c.code = code;
          c.hex = hex;
        }
      }
    }
  }
  return out;
}

/**
 * 移除与边界连通的外部背景：从四周做 flood fill，凡与背景色
 * （默认纯白）Oklab 色差 <= tolerance 且未被标记的格均标为 external。
 * 内部同色孔洞不会入队，得以保留。返回副本。
 * @param tolerance 到背景色的 Oklab 距离阈值
 * @param bg 背景色（RGB），默认白色
 */
export function removeBackground(cells: Cell[][], tolerance: number, bg?: RGB): Cell[][] {
  const out = cloneGrid(cells);
  const rows = out.length;
  const cols = rows === 0 ? 0 : (out[0] as Cell[]).length;
  if (rows === 0 || cols === 0) return out;

  const bgLab = srgbToOklab(bg ?? { r: 255, g: 255, b: 255 });
  const labAt = makeLabCache();

  const queue: Array<[number, number]> = [];
  for (let x = 0; x < cols; x++) {
    queue.push([0, x]);
    queue.push([rows - 1, x]);
  }
  for (let y = 0; y < rows; y++) {
    queue.push([y, 0]);
    queue.push([y, cols - 1]);
  }
  while (queue.length) {
    const [cy, cx] = queue.pop() as [number, number];
    const cell = out[cy]?.[cx] as Cell;
    if (cell.external) continue;
    if (oklabDistance(bgLab, labAt(cell)) > tolerance) continue;
    cell.external = true;
    for (const [dy, dx] of FOUR_NEIGHBORS) {
      const ny = cy + dy;
      const nx = cx + dx;
      if (ny < 0 || nx < 0 || ny >= rows || nx >= cols) continue;
      queue.push([ny, nx]);
    }
  }
  return out;
}
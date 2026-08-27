// 材料统计：纯函数，无 sharp/DOM 依赖，浏览器与 Node 通用。
// 从 render/node.ts 迁出以便浏览器端直接打包使用。

import type { Grid } from './types';

/** 材料清单行：色号 + 色值 + 用量 */
export interface MaterialRow {
  code: string;
  hex: string;
  count: number;
}

/** 统计网格内各色号用量，按用量降序（同量按色号升序） */
export function countGridMaterials(grid: Grid): MaterialRow[] {
  const m = new Map<string, MaterialRow>();
  for (const row of grid.cells) {
    for (const c of row) {
      if (c.external || !c.code) continue;
      const e = m.get(c.code);
      if (e) e.count++;
      else m.set(c.code, { code: c.code, hex: c.hex, count: 1 });
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
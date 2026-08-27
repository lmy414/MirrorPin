import { describe, it, expect } from 'vitest';
import { MARD291, MARD221 } from '../src/palettes/mard291';

describe('MARD221 色卡数据', () => {
  it('共 221 条且全部属于标准系列 A-H/M', () => {
    expect(MARD221).toHaveLength(221);
    for (const s of MARD221) {
      expect(s.code).toMatch(/^[A-HM]\d+$/);
    }
  });

  it('是 MARD291 的子集（色号与色值逐条一致）', () => {
    const map = new Map(MARD291.map((s) => [s.code, s.hex]));
    for (const s of MARD221) {
      expect(map.get(s.code)).toBe(s.hex);
    }
  });

  it('不含任何扩展系列（P/Q/R/T/Y/ZG）', () => {
    for (const s of MARD221) {
      expect(s.code).not.toMatch(/^(P|Q|R|T|Y|ZG)\d+$/);
    }
  });
});

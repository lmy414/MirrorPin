import { describe, it, expect } from 'vitest';
import { MARD291 } from '../src/palettes/mard291';

const SERIES_EXPECT = {
  A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21,
  H: 23, M: 15, P: 23, Q: 5, R: 28, T: 1, Y: 5, ZG: 8,
} as const;

describe('MARD291 色卡数据', () => {
  it('共 291 条', () => {
    expect(MARD291).toHaveLength(291);
  });

  it('色号无重复且格式合法', () => {
    const codes = MARD291.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z]+\d+$/);
    }
  });

  it('hex 均为 6 位十六进制（大写）', () => {
    for (const s of MARD291) {
      expect(s.hex).toMatch(/^[0-9A-F]{6}$/);
    }
  });

  it('各系列数量符合 MARD 291 结构（标准221 A-H/M + 扩展70 P/Q/R/T/Y/ZG）', () => {
    const got: Record<string, number> = {};
    for (const s of MARD291) {
      const key = s.code.replace(/\d+$/, '');
      got[key] = (got[key] ?? 0) + 1;
    }
    expect(got).toEqual(SERIES_EXPECT);
  });

  it('抽查关键色号与公开参考一致', () => {
    const map = new Map(MARD291.map((s) => [s.code, s.hex]));
    expect(map.get('A1')).toBe('F9F0CD');
    expect(map.get('E1')).toBe('FDD3CC');
    expect(map.get('M1')).toBe('BCC6B8');
    expect(map.get('H7')).toBe('000000');
    expect(map.get('H2')).toBe('FFFFFF');
    expect(map.get('ZG8')).toBe('AB91C0');
    expect(map.get('T1')).toBe('E2DFD7');
  });
});
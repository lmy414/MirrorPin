import { describe, expect, it } from 'vitest';
import { generateForBoard, generatePatternBead, MARD221 } from '../src';
import { convert, parseArgs } from '../cli/index';
import { makeImage } from './helpers';

describe('board/core/CLI 接线', () => {
  it('--blur 未指定时不启用兼容别名', () => {
    const args = parseArgs(['in.png', '-o', 'ignored.png']);
    expect(args.blur).toBeUndefined();
  });
  it('generateForBoard 与相同 core 选项输出一致', () => {
    const img = makeImage(16, 10, (x, y) => [x * 12, y * 20, 100, 255]);
    const board = generateForBoard(img, {
      board: '52x52',
      palette: 'mard221',
      cropToSubject: false,
      advanced: { smooth: 'guided', scale: 'dpid', dpidLambda: 1 },
    });
    const core = generatePatternBead(img, {
      fixed: { w: 52, h: 52 },
      fill: true,
      cropToSubject: false,
      palette: MARD221,
      minBeads: 0,
      smooth: 'guided',
      smoothLambda: 0.02,
      smoothSigma: 1,
      smoothRadius: 8,
      smoothEps: 100,
      scale: 'dpid',
      dpidLambda: 1,
      dither: false,
      despeckle: false,
      backgroundTolerance: 12,
      removeBg: 'none',
    });
    expect(board.grid.cells).toEqual(core.cells);
  });

  it('CLI parse/convert 把量化、smooth 与 scale 接入统一 core', async () => {
    const args = parseArgs(['in.png', '-o', 'ignored.png', '--max-side', '8', '--colors', '0', '--smooth', 'guided', '--scale', 'box']);
    args.output = '';
    const img = makeImage(12, 8, (x, y) => [x * 20, y * 30, 90, 255]);
    const actual = await convert(img, args, async () => Buffer.from([1]));
    const expected = generatePatternBead(img, {
      palette: undefined,
      maxSide: 8,
      colorQuantize: { colors: 0 },
      cropToSubject: true,
      removeBg: 'none',
      despeckle: false,
      dither: false,
      minBeads: 0,
      smooth: 'guided',
      smoothEps: 100,
      smoothRadius: 8,
      scale: 'box',
    });
    expect(actual.cells).toEqual(expected.cells);
  });
});

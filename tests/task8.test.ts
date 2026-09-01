import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION_OPTIONS,
  GENERATION_PROFILES,
  generateForBoard,
  generatePatternBead,
  measureSpatialFragmentation,
  MARD221,
} from '../src';
import { makeImage, solidImage } from './helpers';

describe('Task 8 unified generation pipeline', () => {
  const image = makeImage(12, 8, (x, y) => [x < 6 ? 220 : 30, y % 2 ? 40 : 180, x === y ? 220 : 60, 255]);

  it('respects maxColors and minBeads in the spatial main pipeline result', () => {
    const palette = [{ code: 'K', hex: '000000' }, { code: 'W', hex: 'FFFFFF' }, { code: 'R', hex: 'FF0000' }];
    const source = makeImage(9, 1, (x) => x < 3 ? [0, 0, 0, 255] : x < 6 ? [255, 255, 255, 255] : [255, 0, 0, 255]);
    const capped = generatePatternBead(source, { palette, fixed: { w: 9, h: 1 }, cropToSubject: false, smooth: 'none', maxColors: 1 });
    expect(capped.colorCount).toBeLessThanOrEqual(1);
    const minimum = generatePatternBead(source, { palette, fixed: { w: 9, h: 1 }, cropToSubject: false, smooth: 'none', minBeads: 4 });
    const counts = new Map<string, number>();
    for (const cell of minimum.cells[0]!) if (!cell.external) counts.set(cell.code, (counts.get(cell.code) ?? 0) + 1);
    expect([...counts.values()].every((count) => count >= 4)).toBe(true);
  });

  it('uses canonical clean defaults and explicit legacy profile', () => {
    expect(DEFAULT_GENERATION_OPTIONS.smooth).toBe('guided');
    expect(DEFAULT_GENERATION_OPTIONS.scale).toBe('area');
    expect(DEFAULT_GENERATION_OPTIONS.spatial.enabled).toBe(true);
    expect(GENERATION_PROFILES.legacy.spatial.enabled).toBe(false);
    expect(GENERATION_PROFILES.legacy.dither).toBe(false);
  });

  it('reports ordered stages exactly once, one resample, and complete diagnostics', () => {
    const stages: string[] = [];
    const diagnostics: Record<string, unknown> = {};
    const grid = generatePatternBead(image, {
      palette: MARD221,
      fixed: { w: 8, h: 6 },
      fill: true,
      cropToSubject: false,
      onProgress: (event) => stages.push(event.stage),
      diagnostics,
    });
    expect(stages).toEqual(['prepare', 'resample', 'candidates', 'optimize', 'cleanup', 'done']);
    expect(diagnostics.actualResamplePasses).toBe(1);
    expect(diagnostics.stageOrder).toEqual(stages);
    expect(diagnostics.timings).toBeDefined();
    expect(diagnostics.colorCountAfter).toBe(grid.colorCount);
    expect(diagnostics.optimizerIterations).toBeTypeOf('number');
    expect(diagnostics.energyAfter).toBeLessThanOrEqual(diagnostics.energyBefore as number);
  });

  it('diagnostics match independently recomputed fragmentation metrics', () => {
    const diagnostics: Record<string, any> = {};
    const grid = generatePatternBead(image, {
      palette: MARD221,
      fixed: { w: 8, h: 6 },
      cropToSubject: false,
      diagnostics,
    });
    const labels = new Int32Array(grid.cells.flatMap((row) => row.map((cell) => cell.external ? -1 : MARD221.findIndex((swatch) => swatch.code === cell.code))));
    const before = diagnostics.fragmentationBefore;
    const after = measureSpatialFragmentation(labels, grid.cols, grid.rows);
    expect(diagnostics.fragmentationAfter).toEqual(after);
    expect(before).toEqual(measureSpatialFragmentation(Int32Array.from(diagnostics.labelsBefore), grid.cols, grid.rows));
  });

  it('rejects explicit dither with spatial clean mode', () => {
    expect(() => generatePatternBead(image, {
      fixed: { w: 4, h: 4 },
      cropToSubject: false,
      dither: true,
    })).toThrow(/dither|spatial|抖动|空间/);
  });

  it('legacy profile remains available and board uses clean profile', () => {
    const legacy = generatePatternBead(image, {
      ...GENERATION_PROFILES.legacy,
      palette: MARD221,
      fixed: { w: 8, h: 6 },
      cropToSubject: false,
    });
    const board = generateForBoard(image, { board: '78x52', palette: 'mard221', cropToSubject: false });
    expect(legacy.cols).toBe(8);
    expect(board.grid.cols).toBe(78);
    expect(board.grid.rows).toBe(52);
  });

  it('uses area as the canonical clean scale while box remains an equivalent alias', () => {
    expect(DEFAULT_GENERATION_OPTIONS.scale).toBe('area');
    const area = generatePatternBead(image, { palette: MARD221, fixed: { w: 8, h: 6 }, cropToSubject: false, spatial: { enabled: false }, scale: 'area' });
    const box = generatePatternBead(image, { palette: MARD221, fixed: { w: 8, h: 6 }, cropToSubject: false, spatial: { enabled: false }, scale: 'box' });
    expect(box.cells).toEqual(area.cells);
  });

  it('measures only active labels and reports exact small-component and valid-cell metrics', () => {
    const metrics = measureSpatialFragmentation(new Int32Array([-1, 0, 0, 1, -1, 1]), 3, 2);
    expect(metrics.componentCount).toBe(3);
    expect(metrics.singletonComponentCount).toBe(2);
    expect(metrics.smallComponentCount).toBe(3);
    expect(metrics.smallComponentRatio).toBe(1);
    expect(metrics.validCellCount).toBe(4);
    expect(metrics.adjacencyCount).toBe(2);
    expect(metrics.boundaryCount).toBe(1);
  });

  it('treats coverage below one half as external for candidates and final Grid', () => {
    const lowAlpha = makeImage(8, 1, (x) => [x === 3 ? 255 : 0, 0, 0, x === 3 ? 100 : 255]);
    const grid = generatePatternBead(lowAlpha, { palette: [{ code: 'R', hex: 'FF0000' }, { code: 'K', hex: '000000' }], fixed: { w: 8, h: 1 }, cropToSubject: false, smooth: 'none', spatial: { enabled: false } });
    expect(grid.cells[0]![3]!.external).toBe(true);
  });

  it('applies color pre-quantization after mask-aware crop and smooth', () => {
    const source = makeImage(8, 4, (x, y) => x >= 3 && x < 5 && y >= 1 && y < 3 ? [220, 20, 20, 255] : [20, 40, 220, 255]);
    const grid = generatePatternBead(source, {
      palette: [{ code: 'R', hex: 'DC1414' }, { code: 'B', hex: '1428DC' }],
      fixed: { w: 1, h: 1 }, cropToSubject: true, removeBg: 'flood', backgroundTolerance: 8,
      colorQuantize: { colors: 1 }, smooth: 'none', spatial: { enabled: false }, scale: 'area',
    });
    expect(grid.cells[0]![0]).toMatchObject({ code: 'R', external: false });
  });

  it('applies color pre-quantization after the source mask so flood domain cannot change', () => {
    const source = makeImage(12, 12, (x, y) => x >= 4 && x < 8 && y >= 4 && y < 8 ? [220, 20, 20, 255] : [245, 245, 245, 255]);
    const grid = generatePatternBead(source, {
      palette: [{ code: 'R', hex: 'DC1414' }, { code: 'W', hex: 'F5F5F5' }],
      fixed: { w: 12, h: 12 }, cropToSubject: false, removeBg: 'flood', backgroundTolerance: 8,
      colorQuantize: { colors: 1 }, smooth: 'none', spatial: { enabled: false }, scale: 'area',
    });
    expect(grid.cells[0]![0]!.external).toBe(true);
    expect(grid.cells[5]![5]!.external).toBe(false);
  });

  it('filters malformed custom swatches once and keeps candidate/output indices canonical', () => {
    const malformed = [
      { code: 'A', hex: '000000' },
      { code: 'BAD', hex: 'not-a-color' },
      { code: 'W', hex: 'FFFFFF' },
    ] as const;
    const grid = generatePatternBead(solidImage(4, 4, [255, 255, 255]), { palette: malformed, fixed: { w: 4, h: 4 }, cropToSubject: false, smooth: 'none', spatial: { enabled: false } });
    expect(new Set(grid.cells.flat().filter((cell) => !cell.external).map((cell) => cell.code))).toEqual(new Set(['W']));
    expect(grid.cells.flat().every((cell) => cell.external || cell.hex === '000000' || cell.hex === 'FFFFFF')).toBe(true);
  });

  it('records completed and failed stage timings without a done stage', () => {
    const events: string[] = [];
    const diagnostics: Record<string, any> = {};
    expect(() => generatePatternBead(image, {
      fixed: { w: 8, h: 6 }, fill: false, cropToSubject: false, smooth: 'none', diagnostics,
      onProgress: (event) => events.push(event.stage),
      onResample: () => { throw new Error('resample hook failed'); },
    })).toThrow('resample hook failed');
    expect(events).toEqual(['prepare', 'resample']);
    expect(events).not.toContain('done');
    expect(diagnostics.timings.prepare).toBeTypeOf('number');
    expect(diagnostics.timings.resample).toBeTypeOf('number');
    expect(diagnostics.stageOrder).toBeUndefined();
  });

  it('retains completed timings when cancellation occurs at a later stage', () => {
    const diagnostics: Record<string, any> = {};
    const events: string[] = [];
    let calls = 0;
    expect(() => generatePatternBead(image, {
      fixed: { w: 8, h: 6 }, fill: false, cropToSubject: false, smooth: 'none', diagnostics,
      onProgress: (event) => { events.push(event.stage); if (++calls === 3) throw new Error('cancelled'); },
    })).toThrow('cancelled');
    expect(events).toEqual(['prepare', 'resample', 'candidates']);
    expect(diagnostics.timings.prepare).toBeTypeOf('number');
    expect(diagnostics.timings.resample).toBeTypeOf('number');
    expect(diagnostics.timings.candidates).toBeTypeOf('number');
    expect(diagnostics.stageOrder).toBeUndefined();
  });

  it('uses direct resample accounting and reports the actual direct call', () => {
    const resampleEvents: string[] = [];
    generatePatternBead(image, { fixed: { w: 8, h: 6 }, fill: false, cropToSubject: false, smooth: 'none', spatial: { enabled: false }, onResample: (event) => resampleEvents.push(event.phase) });
    expect(resampleEvents).toEqual(['direct']);
  });

  it('exposes one shared operation budget with real cleanup and color counts', () => {
    const diagnostics: Record<string, any> = {};
    generatePatternBead(image, { palette: MARD221, fixed: { w: 8, h: 6 }, cropToSubject: false, maxColors: 2, minBeads: 2, diagnostics, maxOperations: 100000 });
    expect(diagnostics.operationBudget).toBeTypeOf('number');
    expect(diagnostics.cleanupOperationCount + diagnostics.colorBudgetOperationCount).toBeGreaterThan(0);
    expect(diagnostics.cleanupOperationCount + diagnostics.colorBudgetOperationCount).toBeLessThanOrEqual(diagnostics.operationBudget);
  });

  it('fails explicitly when the shared cleanup/color operation budget is too low', () => {
    expect(() => generatePatternBead(image, { palette: MARD221, fixed: { w: 8, h: 6 }, cropToSubject: false, maxColors: 2, minBeads: 2, maxOperations: 1 })).toThrow(/maxOperations|操作/);
  });

  it('reports coherent optimizer, cleanup, and color-budget energy ledgers', () => {
    const diagnostics: Record<string, any> = {};
    generatePatternBead(image, { palette: MARD221, fixed: { w: 8, h: 6 }, cropToSubject: false, maxColors: 2, minBeads: 2, diagnostics, maxOperations: 100000 });
    expect(diagnostics.optimizerEnergyBefore).toBeTypeOf('number');
    expect(diagnostics.optimizerEnergyAfter).toBeTypeOf('number');
    expect(diagnostics.cleanupEnergyBefore).toBeTypeOf('number');
    expect(diagnostics.cleanupEnergyAfter).toBeTypeOf('number');
    expect(diagnostics.colorBudgetEnergyBefore).toBeTypeOf('number');
    expect(diagnostics.colorBudgetEnergyAfter).toBeTypeOf('number');
    expect(diagnostics.totalEnergyBefore).toBe(diagnostics.optimizerEnergyBefore);
    expect(diagnostics.totalEnergyAfter).toBe(diagnostics.colorBudgetEnergyAfter);
  });

  it('enforces maxColors and minBeads in the main pipeline result', () => {
    const palette = [{ code: 'K', hex: '000000' }, { code: 'W', hex: 'FFFFFF' }, { code: 'R', hex: 'FF0000' }];
    const source = makeImage(9, 1, (x) => x < 3 ? [0, 0, 0, 255] : x < 6 ? [255, 255, 255, 255] : [255, 0, 0, 255]);
    const capped = generatePatternBead(source, { palette, fixed: { w: 9, h: 1 }, cropToSubject: false, smooth: 'none', spatial: { enabled: false }, maxColors: 1 });
    expect(capped.colorCount).toBeLessThanOrEqual(1);
    const minimum = generatePatternBead(source, { palette, fixed: { w: 9, h: 1 }, cropToSubject: false, smooth: 'none', spatial: { enabled: false }, minBeads: 4 });
    const counts = new Map<string, number>();
    for (const cell of minimum.cells[0]!) if (!cell.external) counts.set(cell.code, (counts.get(cell.code) ?? 0) + 1);
    expect([...counts.values()].every((count) => count >= 4)).toBe(true);
  });

  it('is deterministic for structural and energy diagnostics when timings are removed', () => {
    const make = () => {
      const diagnostics: Record<string, any> = {};
      generatePatternBead(image, { palette: MARD221, fixed: { w: 8, h: 6 }, cropToSubject: false, diagnostics });
      return diagnostics;
    };
    const stripTiming = (value: any): any => {
      if (Array.isArray(value)) return value.map(stripTiming);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).filter(([key]) => !['timings', 'totalTimeMs'].includes(key)).map(([key, item]) => [key, stripTiming(item)]));
    };
    expect(stripTiming(make())).toEqual(stripTiming(make()));
  });

  it('reduces flat-noise fragmentation while preserving a strong one-cell line', () => {
    const width = 16; const height = 8;
    const source = makeImage(width, height, (x, y) => {
      if (x === 2 && y >= 1 && y <= 6) return [255, 0, 0, 255];
      const noise = (x * 17 + y * 29) % 5;
      return [118 + noise * 3, 118 + noise * 3, 118 + noise * 3, 255];
    });
    const base = { palette: [{ code: 'K', hex: '000000' }, { code: 'G', hex: '787878' }, { code: 'R', hex: 'FF0000' }] as const, fixed: { w: width, h: height }, cropToSubject: false, smooth: 'none' as const };
    const offDiagnostics: Record<string, any> = {};
    const onDiagnostics: Record<string, any> = {};
    const off = generatePatternBead(source, { ...base, spatial: { enabled: false }, diagnostics: offDiagnostics });
    const on = generatePatternBead(source, { ...base, spatial: { enabled: true, topK: 3, smoothness: 2, edgeSigma: 0.5, maxIterations: 4, cleanupMaxSize: 1 }, diagnostics: onDiagnostics });
    expect(onDiagnostics.fragmentationAfter.componentCount).toBeLessThanOrEqual(offDiagnostics.fragmentationAfter.componentCount);
    for (let y = 1; y <= 6; y++) expect(on.cells[y]![2]!.code).toBe('R');
    void off;
  });

  it('validates maxColors and minBeads consistently in clean, spatial-off, and legacy profiles', () => {
    for (const options of [{ maxColors: -1 }, { minBeads: -1 }] as const) {
      for (const profile of ['clean', 'legacy'] as const) {
        expect(() => generatePatternBead(image, { fixed: { w: 8, h: 6 }, cropToSubject: false, profile, spatial: { enabled: profile === 'clean' }, ...options })).toThrow();
      }
      expect(() => generatePatternBead(image, { fixed: { w: 8, h: 6 }, cropToSubject: false, spatial: { enabled: false }, ...options })).toThrow();
    }
  });
});

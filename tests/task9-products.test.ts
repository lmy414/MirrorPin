import { describe, expect, it } from 'vitest';
import { ALGORITHM_VERSION, QUALITY_PROFILES, resolveQualityProfile } from '../src';
import { parseArgs } from '../cli/index';
import packageJson from '../package.json';

describe('Task 9 product contracts', () => {
  it('defines three real quality profiles instead of minBeads-only aliases', () => {
    expect(Object.keys(QUALITY_PROFILES)).toEqual(['standard', 'less', 'minimal']);
    const standard = resolveQualityProfile('standard');
    const less = resolveQualityProfile('less');
    const minimal = resolveQualityProfile('minimal');
    expect(standard.minBeads).toBe(0);
    expect(less.minBeads!).toBeGreaterThan(standard.minBeads!);
    expect(minimal.minBeads!).toBeGreaterThan(less.minBeads!);
    expect(less.advanced!.spatial?.smoothness).toBeGreaterThan(standard.advanced!.spatial?.smoothness ?? 0);
    expect(minimal.advanced!.spatial?.cleanupConfidence).toBeGreaterThan(less.advanced!.spatial?.cleanupConfidence ?? 0);
    expect(minimal.advanced!.maxColors).toBeTypeOf('number');
  });

  it('uses clean CLI defaults and parses spatial controls', () => {
    const defaults = parseArgs(['in.png', '-o', 'out.png']);
    expect(defaults.colors).toBe(0);
    expect(defaults.smooth).toBe('guided');
    expect(defaults.scale).toBe('area');
    expect(defaults.spatial).toBe(true);
    expect(defaults.spatialTopK).toBe(8);

    const custom = parseArgs(['in.png', '-o', 'out.png', '--spatial-strength', '0.6', '--spatial-top-k', '6', '--cleanup-size', '1', '--no-spatial']);
    expect(custom.spatialStrength).toBe(0.6);
    expect(custom.spatialTopK).toBe(6);
    expect(custom.cleanupSize).toBe(1);
    expect(custom.spatial).toBe(false);
  });

  it('keeps source and package algorithm versions synchronized', () => {
    expect(ALGORITHM_VERSION).toBe(packageJson.version);
    expect(ALGORITHM_VERSION).toBe('0.3.0');
  });
});

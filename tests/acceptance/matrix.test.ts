import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalGridString,
  computeAcceptanceMetrics,
  createAcceptanceFixture,
  generatePatternBead,
  MARD221,
  type AcceptanceFixtureId,
  type GenerationDetails,
} from '../../src';

const boards = [[52, 52], [78, 78], [104, 104], [78, 52]] as const;
const fixtureIds: AcceptanceFixtureId[] = ['photo-noise', 'flat-illustration', 'text-lines', 'alpha-edge'];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('acceptance matrix contracts', () => {
  it.each(boards)('is deterministic at %ix%i', (width, height) => {
    const fixture = createAcceptanceFixture('flat-illustration', width, height);
    const options = {
      palette: MARD221,
      fixed: { w: width, h: height },
      cropToSubject: false,
      smooth: 'guided' as const,
      scale: 'area' as const,
      spatial: { enabled: true },
    };
    const first = hash(canonicalGridString(generatePatternBead(fixture.image, options)));
    const second = hash(canonicalGridString(generatePatternBead(fixture.image, options)));
    expect(second).toBe(first);
  }, 60_000);

  it.each(fixtureIds)('provides complete semantic truth for %s', (id) => {
    const fixture = createAcceptanceFixture(id, 16, 12);
    expect(fixture.image.data).toHaveLength(16 * 12 * 4);
    expect(fixture.truth.flatRegion).toHaveLength(16 * 12);
    expect(fixture.truth.edgeX).toHaveLength(16 * 12);
    expect(fixture.truth.edgeY).toHaveLength(16 * 12);
    expect(fixture.truth.thinLineLabels).toHaveLength(16 * 12);
  });

  it('makes the photo-noise fixture exercise fragmentation reduction while preserving its one-cell stroke', () => {
    const fixture = createAcceptanceFixture('photo-noise', 52, 52);
    const run = (enabled: boolean) => {
      let details: GenerationDetails | undefined;
      generatePatternBead(fixture.image, {
        palette: fixture.palette,
        fixed: { w: 52, h: 52 },
        cropToSubject: false,
        smooth: 'none',
        spatial: { enabled },
        onDetailedResult: (value) => { details = value; },
      });
      if (!details) throw new Error('missing details');
      return computeAcceptanceMetrics(details.samples, details.finalLabels, fixture.palette, fixture.truth);
    };
    const baseline = run(false);
    const clean = run(true);
    const reduction = baseline.smallComponentRatio > 0
      ? (baseline.smallComponentRatio - clean.smallComponentRatio) / baseline.smallComponentRatio
      : 0;
    expect(baseline.flatTransitionRate).toBeGreaterThan(0);
    expect(reduction).toBeGreaterThanOrEqual(0.3);
    expect(clean.thinLineRecall).toBe(1);
  }, 30_000);
});

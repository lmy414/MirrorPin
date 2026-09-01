import { describe, expect, it } from 'vitest';
import {
  createAcceptanceFixture,
  generatePatternBead,
  MARD221,
  type GenerationDetails,
} from '../src';

describe('acceptance generation details', () => {
  it('captures target samples plus initial and final labels without changing the public grid', () => {
    const fixture = createAcceptanceFixture('flat-illustration', 12, 8);
    let details: GenerationDetails | undefined;
    const grid = generatePatternBead(fixture.image, {
      palette: MARD221,
      fixed: { w: 12, h: 8 },
      cropToSubject: false,
      smooth: 'none',
      spatial: { enabled: true },
      onDetailedResult: (value) => { details = value; },
    });

    expect(details?.samples.width).toBe(grid.cols);
    expect(details?.samples.height).toBe(grid.rows);
    expect(details?.initialLabels).toHaveLength(grid.cols * grid.rows);
    expect(details?.finalLabels).toHaveLength(grid.cols * grid.rows);
    expect(details?.palette).toEqual(MARD221);
  });

  it('creates deterministic fixture truth arrays matching every target cell', () => {
    const a = createAcceptanceFixture('text-lines', 18, 10);
    const b = createAcceptanceFixture('text-lines', 18, 10);
    expect(a.image.data).toEqual(b.image.data);
    expect(a.truth.flatRegion).toHaveLength(180);
    expect(a.truth.edgeX).toHaveLength(180);
    expect(a.truth.edgeY).toHaveLength(180);
    expect(a.truth.thinLineLabels).toHaveLength(180);
  });
});

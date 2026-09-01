import type { AcceptanceTruth } from './metrics';
import type { RgbaImage, Swatch } from './types';

export type AcceptanceFixtureId = 'photo-noise' | 'flat-illustration' | 'text-lines' | 'alpha-edge';

export interface AcceptanceFixture {
  id: AcceptanceFixtureId;
  image: RgbaImage;
  palette: readonly Swatch[];
  truth: AcceptanceTruth;
}

const FIXTURE_PALETTE = Object.freeze([
  Object.freeze({ code: 'H7', hex: '000000' }),
  Object.freeze({ code: 'H2', hex: 'FFFFFF' }),
  Object.freeze({ code: 'A22', hex: 'FFF3A4' }),
  Object.freeze({ code: 'B8', hex: '029D26' }),
  Object.freeze({ code: 'C7', hex: '0188D3' }),
  Object.freeze({ code: 'D10', hex: '361B50' }),
  Object.freeze({ code: 'E13', hex: 'B6006D' }),
  Object.freeze({ code: 'H3', hex: 'B3B3B3' }),
  Object.freeze({ code: 'H4', hex: '868686' }),
]);

const RGB = FIXTURE_PALETTE.map((swatch) => [
  Number.parseInt(swatch.hex.slice(0, 2), 16),
  Number.parseInt(swatch.hex.slice(2, 4), 16),
  Number.parseInt(swatch.hex.slice(4, 6), 16),
] as const);

export function createAcceptanceFixture(id: AcceptanceFixtureId, width: number, height: number): AcceptanceFixture {
  if (!Number.isInteger(width) || width < 4 || !Number.isInteger(height) || height < 4) {
    throw new Error('acceptance fixture width/height 必须为至少 4 的整数');
  }
  const count = width * height;
  const data = new Uint8ClampedArray(count * 4);
  const expected = new Int32Array(count);
  const flatRegion = new Int32Array(count);
  flatRegion.fill(-1);
  const thinLineLabels = new Int32Array(count);
  thinLineLabels.fill(-1);

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x;
    let label = 1;
    let region = 0;
    let alpha = 255;

    if (id === 'flat-illustration') {
      label = x < width / 2 ? 2 : 4;
      region = label;
      const inset = x > width * 0.2 && x < width * 0.8 && y > height * 0.2 && y < height * 0.8;
      if (inset) { label = y < height / 2 ? 3 : 6; region = label; }
      if (x === Math.floor(width / 2)) { label = 0; region = -1; thinLineLabels[pixel] = label; }
    } else if (id === 'text-lines') {
      label = 1; region = 1;
      const vertical = x === Math.max(1, Math.floor(width * 0.22)) && y >= 1 && y < height - 1;
      const horizontal = y === Math.floor(height / 2) && x >= Math.floor(width * 0.45) && x < width - 1;
      const cross = x === Math.floor(width * 0.65) && y >= 1 && y < height - 1;
      if (vertical || horizontal || cross) { label = 0; region = -1; thinLineLabels[pixel] = label; }
    } else if (id === 'alpha-edge') {
      label = x < width / 2 ? 4 : 6;
      region = label;
      const distance = Math.abs(x + 0.5 - width / 2);
      if (distance < 1.5) alpha = distance < 0.5 ? 255 : 160;
      if (y === Math.floor(height * 0.7) && x > 1 && x < width - 2) { label = 0; region = -1; thinLineLabels[pixel] = label; alpha = 255; }
      if ((x < 2 || x >= width - 2) && (y < 2 || y >= height - 2)) alpha = 0;
    } else {
      const lineX = Math.max(1, Math.floor(width * 0.18));
      if (x === lineX && y >= 1 && y < height - 1) {
        label = 0; region = -1; thinLineLabels[pixel] = label;
      } else {
        const switcher = (x * 37 + y * 61 + x * y * 7) % 9;
        label = switcher < 4 ? 7 : 8;
        region = 7;
      }
    }

    expected[pixel] = label;
    flatRegion[pixel] = region;
    let [baseR, baseG, baseB] = RGB[label]!;
    if (id === 'photo-noise' && thinLineLabels[pixel]! < 0) {
      const neutral = label === 7 ? 154 : 156;
      baseR = neutral; baseG = neutral; baseB = neutral;
    }
    const noise = 0;
    const offset = pixel * 4;
    data[offset] = clamp(baseR + noise);
    data[offset + 1] = clamp(baseG - noise / 2);
    data[offset + 2] = clamp(baseB + noise / 3);
    data[offset + 3] = alpha;
  }

  const edgeClass = (pixel: number): number => thinLineLabels[pixel]! >= 0
    ? -2 - thinLineLabels[pixel]!
    : flatRegion[pixel]!;
  const edgeX = new Uint8Array(count);
  const edgeY = new Uint8Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x;
    if (x + 1 < width) edgeX[pixel] = edgeClass(pixel) !== edgeClass(pixel + 1) ? 1 : 0;
    if (y + 1 < height) edgeY[pixel] = edgeClass(pixel) !== edgeClass(pixel + width) ? 1 : 0;
  }

  return {
    id,
    image: { width, height, data },
    palette: FIXTURE_PALETTE,
    truth: { flatRegion, edgeX, edgeY, thinLineLabels },
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

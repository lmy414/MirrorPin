import { describe, expect, it } from 'vitest';
import {
  PARAMS_SCHEMA_VERSION,
  normalizeSavedFormState,
  parseOptionalPositiveInteger,
} from '../webapp/app/params.mjs';

describe('Webapp parameter persistence', () => {
  it('treats blank and nonpositive max-color sentinels as unlimited', () => {
    expect(parseOptionalPositiveInteger('')).toBeUndefined();
    expect(parseOptionalPositiveInteger('-1')).toBeUndefined();
    expect(parseOptionalPositiveInteger('0')).toBeUndefined();
    expect(parseOptionalPositiveInteger('48')).toBe(48);
    expect(parseOptionalPositiveInteger('2.5')).toBeUndefined();
    expect(parseOptionalPositiveInteger('not-a-number')).toBeUndefined();
  });

  it('migrates legacy advanced values to valid 0.3 defaults while preserving primary choices', () => {
    const state = normalizeSavedFormState({
      board: '104x104',
      palette: 'mard291',
      quality: 'less',
      removeBg: false,
      advanced: {
        smooth: 'guided',
        scale: 'area',
        maxColors: -1,
        renderCell: 41,
        renderBoard: 31,
        backgroundTolerance: 15,
        spatial: { enabled: false, smoothness: 0.5, cleanupMaxSize: 1 },
      },
    });

    expect(state).toMatchObject({
      board: '104x104',
      palette: 'mard291',
      quality: 'less',
      removeBg: false,
      smooth: 'guided',
      scale: 'area',
      maxColors: undefined,
      renderCell: 40,
      renderBoard: 29,
      backgroundTolerance: 15,
      spatialEnabled: false,
      spatialStrength: 0.5,
      cleanupSize: 1,
    });
  });

  it('restores explicit advanced values written by the current parameter schema', () => {
    const state = normalizeSavedFormState({
      paramsSchemaVersion: PARAMS_SCHEMA_VERSION,
      board: '78x52',
      palette: 'mard221',
      quality: 'minimal',
      removeBg: true,
      advanced: {
        smooth: 'l0',
        smoothLambda: 0.005,
        scale: 'dpid',
        maxColors: 36,
        dither: true,
        despeckle: true,
        renderCell: 44,
        renderBoard: 31,
        backgroundTolerance: 18,
        spatial: { enabled: false, smoothness: 0.55, cleanupMaxSize: 1 },
      },
    });

    expect(state).toEqual({
      board: '78x52',
      palette: 'mard221',
      quality: 'minimal',
      removeBg: true,
      smooth: 'weak',
      scale: 'dpid',
      maxColors: 36,
      dither: true,
      despeckle: true,
      renderCell: 44,
      renderBoard: 31,
      backgroundTolerance: 18,
      spatialEnabled: false,
      spatialStrength: 0.55,
      cleanupSize: 1,
    });
  });
});

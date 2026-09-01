export const PARAMS_SCHEMA_VERSION: 1;

export interface SavedWebappParams {
  paramsSchemaVersion?: number;
  board?: string;
  palette?: string;
  quality?: string;
  removeBg?: boolean;
  advanced?: {
    smooth?: string;
    smoothLambda?: number;
    scale?: string;
    maxColors?: number;
    dither?: boolean;
    despeckle?: boolean;
    renderCell?: number;
    renderBoard?: number;
    backgroundTolerance?: number;
    spatial?: {
      enabled?: boolean;
      smoothness?: number;
      cleanupMaxSize?: number;
    };
  };
}

export interface RestoredWebappFormState {
  board: '52x52' | '78x78' | '104x104' | '78x52';
  palette: 'mard221' | 'mard291';
  quality: 'standard' | 'less' | 'minimal';
  removeBg: boolean;
  smooth: 'l0' | 'weak' | 'guided' | 'gaussian' | 'off';
  scale: 'area' | 'dpid';
  maxColors: number | undefined;
  dither: boolean;
  despeckle: boolean;
  renderCell: number;
  renderBoard: number;
  backgroundTolerance: number;
  spatialEnabled: boolean;
  spatialStrength: number;
  cleanupSize: number;
}

export function parseOptionalPositiveInteger(value: unknown): number | undefined;
export function normalizeSavedFormState(saved?: SavedWebappParams): RestoredWebappFormState;

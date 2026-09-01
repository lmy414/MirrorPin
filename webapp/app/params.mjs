export const PARAMS_SCHEMA_VERSION = 1;

const BOARD_IDS = new Set(['52x52', '78x78', '104x104', '78x52']);
const PALETTE_IDS = new Set(['mard221', 'mard291']);
const QUALITY_IDS = new Set(['standard', 'less', 'minimal']);

export function parseOptionalPositiveInteger(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function finiteAtLeast(value, minimum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function inferSmooth(advanced) {
  if (advanced?.smooth === 'l0') return advanced.smoothLambda <= 0.005 ? 'weak' : 'l0';
  if (advanced?.smooth === 'gauss') return 'gaussian';
  if (advanced?.smooth === 'none') return 'off';
  return 'guided';
}

export function normalizeSavedFormState(saved = {}) {
  const advanced = saved?.advanced ?? {};
  const spatial = advanced.spatial ?? {};
  const currentSchema = saved?.paramsSchemaVersion === PARAMS_SCHEMA_VERSION;

  return {
    board: BOARD_IDS.has(saved.board) ? saved.board : '78x78',
    palette: PALETTE_IDS.has(saved.palette) ? saved.palette : 'mard221',
    quality: QUALITY_IDS.has(saved.quality) ? saved.quality : 'standard',
    removeBg: saved.removeBg !== false,
    smooth: inferSmooth(advanced),
    scale: advanced.scale === 'dpid' ? 'dpid' : 'area',
    maxColors: parseOptionalPositiveInteger(advanced.maxColors),
    dither: advanced.dither === true,
    despeckle: advanced.despeckle === true,
    renderCell: currentSchema ? parseOptionalPositiveInteger(advanced.renderCell) ?? 40 : 40,
    renderBoard: currentSchema ? parseOptionalPositiveInteger(advanced.renderBoard) ?? 29 : 29,
    backgroundTolerance: finiteAtLeast(advanced.backgroundTolerance, 0, 12),
    spatialEnabled: spatial.enabled !== false,
    spatialStrength: finiteAtLeast(spatial.smoothness, 0, 0.35),
    cleanupSize: finiteAtLeast(spatial.cleanupMaxSize, 0, 2),
  };
}

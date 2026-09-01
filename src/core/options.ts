import type {
  AlphaPolicy,
  ColorQuantizeOptions,
  ResolvedColorQuantizeOptions,
  SpatialQuantizeOptions,
} from './types';

export const DEFAULT_ALPHA_POLICY: Readonly<Required<AlphaPolicy>> = Object.freeze({ threshold: 128 });
export const DEFAULT_COLOR_QUANTIZE_OPTIONS = Object.freeze({ sampleLimit: 120000, seed: 42 });
export const DEFAULT_SPATIAL_QUANTIZE_OPTIONS: Readonly<Required<SpatialQuantizeOptions>> = Object.freeze({
  enabled: true, topK: 8, smoothness: 0.35, edgeSigma: 0.12, maxIterations: 6, cleanupMaxSize: 2, cleanupConfidence: 0.25,
});

export type GenerationProfile = 'clean' | 'legacy';
export interface CanonicalGenerationOptions {
  smooth: 'none' | 'gauss' | 'guided' | 'l0';
  scale: 'area' | 'dpid' | 'box';
  dither: boolean;
  spatial: Required<SpatialQuantizeOptions>;
  maxColors?: number;
  minBeads: number;
}

export const DEFAULT_GENERATION_OPTIONS: Readonly<CanonicalGenerationOptions> = Object.freeze({
  smooth: 'guided', scale: 'area', dither: false, spatial: DEFAULT_SPATIAL_QUANTIZE_OPTIONS, minBeads: 0,
});
export const GENERATION_PROFILES: Readonly<Record<GenerationProfile, CanonicalGenerationOptions>> = Object.freeze({
  clean: DEFAULT_GENERATION_OPTIONS,
  legacy: Object.freeze({ smooth: 'none', scale: 'area', dither: false, spatial: { ...DEFAULT_SPATIAL_QUANTIZE_OPTIONS, enabled: false }, minBeads: 0 }),
});

export function requireInteger(name: string, value: number): number { if (!Number.isInteger(value)) throw new Error(`${name} 必须为整数`); return value; }
export function requireIntegerInRange(name: string, value: number, min: number, max: number): number { requireInteger(name, value); if (value < min || value > max) throw new Error(`${name} 必须在 ${min}..${max} 范围内`); return value; }
export function requirePositiveInteger(name: string, value: number): number { requireInteger(name, value); if (value < 1) throw new Error(`${name} 必须为正整数`); return value; }
export function resolveAlphaPolicy(policy: AlphaPolicy = {}): Required<AlphaPolicy> { return { threshold: requireIntegerInRange('alpha.threshold', policy.threshold ?? DEFAULT_ALPHA_POLICY.threshold, 0, 255) }; }
export function resolveColorQuantizeOptions(options: ColorQuantizeOptions): ResolvedColorQuantizeOptions { return { colors: requireInteger('colors', options.colors), sampleLimit: requirePositiveInteger('sampleLimit', options.sampleLimit ?? DEFAULT_COLOR_QUANTIZE_OPTIONS.sampleLimit), seed: requireInteger('seed', options.seed ?? DEFAULT_COLOR_QUANTIZE_OPTIONS.seed), alpha: resolveAlphaPolicy(options.alpha) }; }
export function resolveSpatialQuantizeOptions(options: SpatialQuantizeOptions = {}): Required<SpatialQuantizeOptions> {
  const enabled = options.enabled ?? DEFAULT_SPATIAL_QUANTIZE_OPTIONS.enabled;
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须为布尔值');
  const topK = requirePositiveInteger('topK', options.topK ?? DEFAULT_SPATIAL_QUANTIZE_OPTIONS.topK);
  const smoothness = requireFiniteNonNegative('smoothness', options.smoothness ?? DEFAULT_SPATIAL_QUANTIZE_OPTIONS.smoothness);
  const edgeSigma = requireFinitePositive('edgeSigma', options.edgeSigma ?? DEFAULT_SPATIAL_QUANTIZE_OPTIONS.edgeSigma);
  const maxIterations = requireNonNegativeInteger('maxIterations', options.maxIterations ?? DEFAULT_SPATIAL_QUANTIZE_OPTIONS.maxIterations);
  const cleanupMaxSize = requireNonNegativeInteger('cleanupMaxSize', options.cleanupMaxSize ?? DEFAULT_SPATIAL_QUANTIZE_OPTIONS.cleanupMaxSize);
  const cleanupConfidence = options.cleanupConfidence ?? DEFAULT_SPATIAL_QUANTIZE_OPTIONS.cleanupConfidence;
  if (!Number.isFinite(cleanupConfidence) || cleanupConfidence < 0 || cleanupConfidence > 1) throw new Error('cleanupConfidence 必须为 0..1 的有限数');
  return { enabled, topK, smoothness, edgeSigma, maxIterations, cleanupMaxSize, cleanupConfidence };
}
function requireFiniteNonNegative(name: string, value: number): number { if (!Number.isFinite(value) || value < 0) throw new Error(`${name} 必须为有限非负数`); return value; }
function requireFinitePositive(name: string, value: number): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为有限正数`); return value; }
function requireNonNegativeInteger(name: string, value: number): number { requireInteger(name, value); if (value < 0) throw new Error(`${name} 必须为非负整数`); return value; }

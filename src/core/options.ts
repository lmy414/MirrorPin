import type {
  AlphaPolicy,
  ColorQuantizeOptions,
  ResolvedColorQuantizeOptions,
} from './types';

export const DEFAULT_ALPHA_POLICY: Readonly<Required<AlphaPolicy>> = Object.freeze({
  threshold: 128,
});

export const DEFAULT_COLOR_QUANTIZE_OPTIONS = Object.freeze({
  sampleLimit: 120000,
  seed: 42,
});

export function requireInteger(name: string, value: number): number {
  if (!Number.isInteger(value)) throw new Error(`${name} 必须为整数`);
  return value;
}

export function requireIntegerInRange(
  name: string,
  value: number,
  min: number,
  max: number,
): number {
  requireInteger(name, value);
  if (value < min || value > max) {
    throw new Error(`${name} 必须在 ${min}..${max} 范围内`);
  }
  return value;
}

export function requirePositiveInteger(name: string, value: number): number {
  requireInteger(name, value);
  if (value < 1) throw new Error(`${name} 必须为正整数`);
  return value;
}

export function resolveAlphaPolicy(policy: AlphaPolicy = {}): Required<AlphaPolicy> {
  return {
    threshold: requireIntegerInRange(
      'alpha.threshold',
      policy.threshold ?? DEFAULT_ALPHA_POLICY.threshold,
      0,
      255,
    ),
  };
}

export function resolveColorQuantizeOptions(
  options: ColorQuantizeOptions,
): ResolvedColorQuantizeOptions {
  return {
    colors: requireInteger('colors', options.colors),
    sampleLimit: requirePositiveInteger(
      'sampleLimit',
      options.sampleLimit ?? DEFAULT_COLOR_QUANTIZE_OPTIONS.sampleLimit,
    ),
    seed: requireInteger('seed', options.seed ?? DEFAULT_COLOR_QUANTIZE_OPTIONS.seed),
    alpha: resolveAlphaPolicy(options.alpha),
  };
}

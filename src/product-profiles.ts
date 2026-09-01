import type { TopLevelOptions } from './board';

export type QualityProfileId = 'standard' | 'less' | 'minimal';
export type QualityProfileOptions = Pick<TopLevelOptions, 'minBeads' | 'advanced'>;

export const QUALITY_PROFILES: Readonly<Record<QualityProfileId, QualityProfileOptions>> = Object.freeze({
  standard: Object.freeze({
    minBeads: 0,
    advanced: Object.freeze({ spatial: Object.freeze({ smoothness: 0.35, cleanupConfidence: 0.25, cleanupMaxSize: 2 }) }),
  }),
  less: Object.freeze({
    minBeads: 5,
    advanced: Object.freeze({ spatial: Object.freeze({ smoothness: 0.48, cleanupConfidence: 0.32, cleanupMaxSize: 2 }) }),
  }),
  minimal: Object.freeze({
    minBeads: 10,
    advanced: Object.freeze({ maxColors: 48, spatial: Object.freeze({ smoothness: 0.62, cleanupConfidence: 0.42, cleanupMaxSize: 2 }) }),
  }),
});

export function resolveQualityProfile(profile: QualityProfileId): QualityProfileOptions {
  const selected = QUALITY_PROFILES[profile];
  if (!selected) throw new Error(`未知质量档: ${String(profile)}`);
  return {
    minBeads: selected.minBeads,
    advanced: {
      ...selected.advanced,
      spatial: selected.advanced?.spatial ? { ...selected.advanced.spatial } : undefined,
    },
  };
}

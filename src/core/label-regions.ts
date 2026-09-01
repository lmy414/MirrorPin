import type { GridSamples } from './resample';
import type { Swatch } from './types';
import { hexToRgb } from './color';
import { ciede2000, srgbToLab, type Lab } from '../beadpattern/ciede2000';
import { type PaletteCandidates, validCell } from './palette-candidates';

export interface RegionBBox { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
export interface RegionStats {
  id: number; label: number; cells: number[]; area: number; perimeter: number;
  boundaryByLabel: Record<string, number>; boundaryContact: number;
  averageSourceEdge: number; maxSourceEdge: number; currentDataPenalty: number;
  confidence: number; margin: number; bbox: RegionBBox; width: number; height: number;
  aspectRatio: number; compactness: number; isSingleton: boolean; isLongNarrow: boolean;
  isTinyStroke: boolean; hasSourceEdge: boolean; strongEdge: boolean;
}
export interface LabelRegionCleanupOptions {
  maxRegionSize?: number; confidence?: number; smoothness?: number; edgeSigma?: number;
  strongEdgeThreshold?: number; boardWidth?: number; boardHeight?: number; maxPasses?: number; maxOperations?: number;
  operationBudget?: SharedOperationBudget;
}
export interface LabelCleanupDiagnostics {
  changedCells: number; changedRegions: number; regionsBefore: number; regionsAfter: number;
  singletonBefore: number; singletonAfter: number; energyBefore: number; energyAfter: number;
  passes: number; rejectedChanges: number; acceptedEnergyDeltas: number[]; singletonCellsBefore: number[]; singletonCellsAfter: number[]; operationCount: number; attemptedOperations: number; operationBudget: number;
}
export interface SpatialLabelsResult { labels: Uint16Array; diagnostics: LabelCleanupDiagnostics }
export interface SpatialColorBudgetOptions { minBeads?: number; maxColors?: number; smoothness?: number; edgeSigma?: number; maxOperations?: number; operationBudget?: SharedOperationBudget }
export interface SpatialColorDiagnostics {
  energyBefore: number; energyAfter: number; colorsBefore: number; colorsAfter: number;
  removedColors: number[]; changedCells: number; removalEnergyIncreases: number[]; minBeadsProgress: Array<[number, number]>; fallbackReplacements: number; operationCount: number; attemptedOperations: number; operationBudget: number; tieBreakRule: string;
}
export interface SpatialColorResult { labels: Uint16Array; diagnostics: SpatialColorDiagnostics }

interface Context {
  width: number; height: number; labs: Lab[]; targets: Array<Lab | undefined>; dataCosts: Float64Array;
}
interface CleanupPolicy { maxRegionSize: number; confidence: number; area2Confidence: number; smoothness: number; edgeSigma: number; strongEdgeThreshold: number; maxPasses: number }
export interface SharedOperationBudget { limit: number; count: number; attempted: number }
export function createOperationBudget(limit: number): SharedOperationBudget {
  return { limit: integerAtLeast(limit, 1, 'maxOperations'), count: 0, attempted: 0 };
}
interface OperationBudget extends SharedOperationBudget {}
type OperationKind = 'evaluation' | 'commit';
const EPSILON = 1e-9;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function consume(budget: OperationBudget, kind: OperationKind): void {
  if (budget.count >= budget.limit) throw new Error('maxOperations 操作预算超限');
  budget.count++;
  if (kind === 'evaluation') budget.attempted++;
}

function safeBudgetTerm(...terms: number[]): number {
  let result = 1;
  for (const term of terms) {
    if (!Number.isFinite(term) || term <= 0 || result > Math.floor(MAX_SAFE / Math.max(1, Math.floor(term)))) return MAX_SAFE;
    result *= Math.floor(term);
  }
  return Math.min(MAX_SAFE, Math.max(1, result));
}

function deriveOperationBudget(samples: GridSamples, labels: Uint16Array, options: { maxColors?: number; minBeads?: number; maxPasses?: number }): number {
  const n = countValidCells(samples);
  const used = usedLabels(samples, labels).length;
  const colors = Math.max(1, used);
  const colorRounds = options.maxColors !== undefined && options.maxColors > 0
    ? Math.max(1, used - options.maxColors)
    : colors;
  const rareRounds = options.minBeads !== undefined && options.minBeads > 0 ? Math.max(1, n) : 0;
  const cleanupRounds = options.maxPasses !== undefined ? Math.max(1, options.maxPasses) : 0;
  const rounds = Math.max(1, colorRounds, rareRounds, cleanupRounds);
  return safeBudgetTerm(Math.max(1, n), colors + 1, colors + 1, rounds + 1);
}

function countValidCells(samples: GridSamples): number {
  let count = 0;
  for (let pixel = 0; pixel < samples.coverage.length; pixel++) if (validCell(samples, pixel)) count++;
  return count;
}

export function analyzeLabelRegions(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], labels: Uint16Array): RegionStats[] {
  const context = validateInputs(samples, candidates, palette, labels);
  const visited = new Uint8Array(labels.length); const result: RegionStats[] = []; let id = 0;
  for (let start = 0; start < labels.length; start++) {
    if (visited[start] || !validCell(samples, start)) continue;
    const label = labels[start]!; const queue = [start]; visited[start] = 1; const cells: number[] = [];
    const boundaryByLabel: Record<string, number> = {};
    let perimeter = 0; let boundaryContact = 0; let edgeSum = 0; let maxEdge = 0;
    let minX = context.width; let minY = context.height; let maxX = -1; let maxY = -1;
    let confidenceSum = 0; let marginSum = 0; let penaltySum = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const pixel = queue[cursor]!; cells.push(pixel); const x = pixel % context.width; const y = Math.floor(pixel / context.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const score = labelScores(context, palette.length, label, pixel); confidenceSum += score.confidence; marginSum += score.margin; penaltySum += score.penalty;
      const ns = neighbors(context.width, context.height, pixel); perimeter += 4 - ns.length;
      for (const n of ns) {
        if (!validCell(samples, n)) { perimeter++; continue; }
        if (labels[n] === label) { if (!visited[n]) { visited[n] = 1; queue.push(n); } continue; }
        perimeter++; boundaryContact++; const key = String(labels[n]!); boundaryByLabel[key] = (boundaryByLabel[key] ?? 0) + 1;
        const edge = edgeBetween(samples, pixel, n); edgeSum += edge; maxEdge = Math.max(maxEdge, edge);
      }
    }
    const width = maxX - minX + 1; const height = maxY - minY + 1; const area = cells.length;
    const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
    const isLongNarrow = area >= 3 && Math.max(width, height) >= 3 && Math.min(width, height) <= 2 && ratio >= 2;
    const isTinyStroke = (area <= 2 && context.width <= 2 && context.height <= 2) || (area === 2 && (width === 1 || height === 1));
    result.push({ id: id++, label, cells, area, perimeter, boundaryByLabel, boundaryContact,
      averageSourceEdge: boundaryContact ? edgeSum / boundaryContact : 0, maxSourceEdge: maxEdge,
      currentDataPenalty: area ? penaltySum / area : 0, confidence: area ? confidenceSum / area : 0,
      margin: area ? marginSum / area : 0, bbox: { minX, minY, maxX, maxY, width, height }, width, height,
      aspectRatio: ratio, compactness: perimeter ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
      isSingleton: area === 1, isLongNarrow, isTinyStroke, hasSourceEdge: maxEdge > 0, strongEdge: maxEdge >= 1 });
  }
  return result;
}

export function cleanupSpatialLabels(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], inputLabels: Uint16Array, options: LabelRegionCleanupOptions = {}): SpatialLabelsResult {
  const context = validateInputs(samples, candidates, palette, inputLabels); const labels = new Uint16Array(inputLabels); const policy = resolveCleanupOptions(samples, options);
  const beforeRegions = analyzeLabelRegions(samples, candidates, palette, labels); const energyBefore = computeEnergy(samples, context, palette, labels, policy.smoothness, policy.edgeSigma);
  const maxOperations = options.maxOperations === undefined ? deriveOperationBudget(samples, labels, { maxPasses: policy.maxPasses }) : integerAtLeast(options.maxOperations, 1, 'maxOperations');
  if (options.maxOperations !== undefined && options.maxOperations < 2) throw new Error('maxOperations 操作预算过小');
  const budget: OperationBudget = options.operationBudget ?? createOperationBudget(maxOperations);
  const singletonCellsBefore = beforeRegions.filter((r) => r.isSingleton).map((r) => r.cells[0]!); const acceptedEnergyDeltas: number[] = [];
  let passes = 0; let changedRegions = 0; let rejectedChanges = 0;
  for (; passes < policy.maxPasses; passes++) {
    let changed = false;
    for (const region of analyzeLabelRegions(samples, candidates, palette, labels)) {
      if (!eligibleRegion(region, policy)) continue;
      const replacement = chooseAdjacentReplacement(samples, context, palette, labels, region, policy, budget);
      if (replacement === undefined) continue;
      const delta = componentDelta(samples, context, palette, labels, region.cells, replacement, policy.smoothness, policy.edgeSigma, budget);
      if (delta < -EPSILON) {
        const next = new Uint16Array(labels); for (const cell of region.cells) next[cell] = replacement;
        const nextSingletons = singletonSet(samples, next);
        if ([...nextSingletons].some((cell) => !singletonCellsBefore.includes(cell))) { rejectedChanges++; continue; }
        labels.set(next); consume(budget, 'commit'); acceptedEnergyDeltas.push(delta); changed = true; changedRegions++;
        break;
      }
      rejectedChanges++;
    }
    if (!changed) break;
  }
  const afterRegions = analyzeLabelRegions(samples, candidates, palette, labels); const energyAfter = computeEnergy(samples, context, palette, labels, policy.smoothness, policy.edgeSigma);
  const singletonBefore = singletonCellsBefore.length; const singletonAfter = afterRegions.filter((r) => r.isSingleton).length; const singletonCellsAfter = afterRegions.filter((r) => r.isSingleton).map((r) => r.cells[0]!);
  if (energyAfter > energyBefore + EPSILON || singletonAfter > singletonBefore || singletonCellsAfter.some((cell) => !singletonCellsBefore.includes(cell))) {
    return { labels: new Uint16Array(inputLabels), diagnostics: { changedCells: 0, changedRegions: 0, regionsBefore: beforeRegions.length, regionsAfter: beforeRegions.length, singletonBefore, singletonAfter: singletonBefore, energyBefore, energyAfter: energyBefore, passes, rejectedChanges, acceptedEnergyDeltas: [], singletonCellsBefore, singletonCellsAfter: singletonCellsBefore, operationCount: budget.count, attemptedOperations: budget.attempted, operationBudget: budget.limit } };
  }
  return { labels, diagnostics: { changedCells: countChanged(inputLabels, labels), changedRegions, regionsBefore: beforeRegions.length, regionsAfter: afterRegions.length, singletonBefore, singletonAfter, energyBefore, energyAfter, passes, rejectedChanges, acceptedEnergyDeltas, singletonCellsBefore, singletonCellsAfter, operationCount: budget.count, attemptedOperations: budget.attempted, operationBudget: budget.limit } };
}

export function enforceSpatialColorBudget(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], inputLabels: Uint16Array, options: SpatialColorBudgetOptions = {}): SpatialColorResult {
  const context = validateInputs(samples, candidates, palette, inputLabels); const labels = new Uint16Array(inputLabels);
  const smoothness = finiteNonNegative(options.smoothness ?? 0.35, 'smoothness'); const edgeSigma = finitePositive(options.edgeSigma ?? 0.12, 'edgeSigma');
  const minBeads = options.minBeads === undefined ? undefined : integerAtLeast(options.minBeads, 0, 'minBeads');
  const maxColors = options.maxColors === undefined ? undefined : integerAtLeast(options.maxColors, 0, 'maxColors');
  const maxOperations = options.maxOperations === undefined ? deriveOperationBudget(samples, labels, { maxColors, minBeads }) : integerAtLeast(options.maxOperations, 1, 'maxOperations');
  const budget: OperationBudget = options.operationBudget ?? createOperationBudget(maxOperations);
  const energyBefore = computeEnergy(samples, context, palette, labels, smoothness, edgeSigma); const removedColors: number[] = []; const deltas: number[] = [];
  const minBeadsProgress: Array<[number, number]> = []; let fallbackReplacements = 0; let operationCount = 0;
  if (minBeads !== undefined && minBeads > 0) { const rareResult = removeRareDynamically(samples, candidates, palette, labels, minBeads, smoothness, edgeSigma, context, removedColors, deltas, budget); minBeadsProgress.push(...rareResult.progress); fallbackReplacements += rareResult.fallbacks; operationCount += rareResult.operations; }
  if (budget.count > maxOperations) throw new Error('maxOperations 操作预算超限');
  // maxColors=0 explicitly disables the cap; minBeads above still remains active.
  if (maxColors !== undefined && maxColors > 0) {
    while (usedLabels(samples, labels).length > maxColors) {
      const plan = chooseColorRemoval(samples, candidates, palette, labels, smoothness, edgeSigma, context, budget);
      if (!plan) throw new Error('maxColors 无法达到：没有有效的替代方案');
      labels.set(plan.labels); consume(budget, 'commit'); removedColors.push(plan.removed); deltas.push(plan.delta); operationCount = budget.count;
      if (budget.count > maxOperations) throw new Error('maxOperations 操作预算超限');
    }
  }
  if (minBeads !== undefined && minBeads > 0) {
    for (const count of countLabels(samples, labels).values()) if (count < minBeads) throw new Error('minBeads 无法满足：仍有低于阈值的在用色');
  }
  const energyAfter = computeEnergy(samples, context, palette, labels, smoothness, edgeSigma);
  return { labels, diagnostics: { energyBefore, energyAfter, colorsBefore: usedLabels(samples, inputLabels).length, colorsAfter: usedLabels(samples, labels).length, removedColors: uniqueStable(removedColors), changedCells: countChanged(inputLabels, labels), removalEnergyIncreases: deltas, minBeadsProgress, fallbackReplacements, operationCount: budget.count, attemptedOperations: budget.attempted, operationBudget: budget.limit, tieBreakRule: 'delta, boundary contact, global use count, palette code/index' } };
}

export function mergeSpatialRareLabels(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], labels: Uint16Array, minBeads: number, options: Omit<SpatialColorBudgetOptions, 'minBeads'> = {}): SpatialColorResult { return enforceSpatialColorBudget(samples, candidates, palette, labels, { ...options, minBeads }); }
export function computeSpatialLabelEnergy(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], labels: Uint16Array, options: Pick<SpatialColorBudgetOptions, 'smoothness' | 'edgeSigma'> = {}): number {
  const smoothness = finiteNonNegative(options.smoothness ?? 0.35, 'smoothness'); const edgeSigma = finitePositive(options.edgeSigma ?? 0.12, 'edgeSigma');
  const context = validateInputs(samples, candidates, palette, labels); return computeEnergy(samples, context, palette, labels, smoothness, edgeSigma);
}

function resolveCleanupOptions(samples: GridSamples, options: LabelRegionCleanupOptions): CleanupPolicy {
  const board = inferBoardPolicy(samples.width, samples.height, options.boardWidth, options.boardHeight);
  const maxRegionSize = options.maxRegionSize ?? board.maxRegionSize; if (!Number.isInteger(maxRegionSize) || maxRegionSize < 1) throw new Error('maxRegionSize 必须为正整数');
  const confidence = finiteRange(options.confidence ?? board.confidence, 0, 1, 'confidence');
  const smoothness = finiteNonNegative(options.smoothness ?? 0.35, 'smoothness'); const edgeSigma = finitePositive(options.edgeSigma ?? 0.12, 'edgeSigma');
  const strongEdgeThreshold = finiteNonNegative(options.strongEdgeThreshold ?? 1, 'strongEdgeThreshold'); const maxPasses = integerAtLeast(options.maxPasses ?? 3, 1, 'maxPasses');
  const area2Confidence = finiteRange(board.area2Factor * confidence, 0, 1, 'area2Confidence');
  return { maxRegionSize, confidence, area2Confidence, smoothness, edgeSigma, strongEdgeThreshold, maxPasses };
}
function inferBoardPolicy(width: number, height: number, boardWidth?: number, boardHeight?: number) {
  if (boardWidth !== undefined || boardHeight !== undefined) {
    if (!Number.isInteger(boardWidth) || !Number.isInteger(boardHeight) || boardWidth !== width || boardHeight !== height) throw new Error('显式 board 尺寸必须与 samples 一致');
  }
  const max = Math.max(width, height); const min = Math.min(width, height);
  if (max === 52 && min === 52) return { maxRegionSize: 1, confidence: 0.25, area2Factor: 0.7 };
  if (max === 78 && (min === 78 || min === 52)) return { maxRegionSize: 2, confidence: 0.15, area2Factor: 0.5 };
  if (max === 104 && min === 104) return { maxRegionSize: 2, confidence: 0.25, area2Factor: 0.7 };
  return { maxRegionSize: 1, confidence: 0.25, area2Factor: 0.7 };
}
function eligibleRegion(region: RegionStats, policy: CleanupPolicy): boolean {
  const confidenceLimit = region.area === 2 ? policy.area2Confidence : policy.confidence;
  return region.area <= policy.maxRegionSize && !region.isTinyStroke && !region.isLongNarrow && region.maxSourceEdge < policy.strongEdgeThreshold && region.confidence <= confidenceLimit;
}
function chooseAdjacentReplacement(samples: GridSamples, context: Context, palette: readonly Swatch[], labels: Uint16Array, region: RegionStats, policy: CleanupPolicy, budget: OperationBudget): number | undefined {
  const choices = adjacentChoices(samples, labels, region.cells); if (!choices.length) return undefined;
  let best: number | undefined; let bestDelta = Infinity;
  for (const choice of choices) {
    const delta = componentDelta(samples, context, palette, labels, region.cells, choice, policy.smoothness, policy.edgeSigma, budget);
    if (delta < bestDelta - EPSILON || (Math.abs(delta - bestDelta) <= EPSILON && comparePalette(palette, choice, best ?? choice) < 0)) { best = choice; bestDelta = delta; }
  }
  return best;
}

function removeRareDynamically(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], labels: Uint16Array, minBeads: number, smoothness: number, edgeSigma: number, context: Context, removed: number[], deltas: number[], budget: OperationBudget): { progress: Array<[number, number]>; fallbacks: number; operations: number } {
  const seen = new Set<string>(); const progress: Array<[number, number]> = []; let fallbacks = 0; let operations = 0;
  for (;;) {
    const counts = countLabels(samples, labels); const rare = [...counts.keys()].filter((label) => (counts.get(label) ?? 0) < minBeads).sort((a, b) => comparePalette(palette, a, b));
    if (!rare.length) return { progress, fallbacks, operations };
    const before = rareMetric(counts, minBeads);
    let best: { labels: Uint16Array; source: number; delta: number; metric: [number, number]; fallback: boolean } | undefined;
    for (const source of rare) {
      for (const region of analyzeLabelRegions(samples, candidates, palette, labels).filter((r) => r.label === source)) {
        const adjacent = adjacentChoices(samples, labels, region.cells).filter((choice) => choice !== source);
        const adjacentProgress: Array<{ labels: Uint16Array; choice: number; delta: number; metric: [number, number] }> = [];
        for (const choice of adjacent) {
          const delta = componentDelta(samples, context, palette, labels, region.cells, choice, smoothness, edgeSigma, budget);
          operations += 1;
          const next = replaceRegion(labels, region.cells, choice); const metric = rareMetric(countLabels(samples, next), minBeads);
          if (isMetricLess(metric, before) && !seen.has(`${hashLabels(next)}:${source}`)) { adjacentProgress.push({ labels: next, choice, delta, metric }); }
        }
        let choices = adjacentProgress;
        let fallback = false;
        if (!choices.length) {
          const nearest = nearestUsedColor(context, palette, source, counts);
          if (nearest !== undefined) {
            const delta = componentDelta(samples, context, palette, labels, region.cells, nearest, smoothness, edgeSigma, budget);
            operations += 1;
            const next = replaceRegion(labels, region.cells, nearest); const metric = rareMetric(countLabels(samples, next), minBeads);
            if (isMetricLess(metric, before) && !seen.has(`${hashLabels(next)}:${source}`)) {
              choices = [{ labels: next, choice: nearest, delta, metric }];
              fallback = true;
            }
          }
        }
        for (const candidate of choices) {
          if (!best || isMetricLess(candidate.metric, best.metric) || (sameMetric(candidate.metric, best.metric) && (candidate.delta < best.delta - EPSILON || (Math.abs(candidate.delta - best.delta) <= EPSILON && comparePalette(palette, source, best.source) < 0)))) {
            best = { labels: candidate.labels, source, delta: candidate.delta, metric: candidate.metric, fallback };
          }
        }
      }
    }
    if (!best) throw new Error('minBeads 无法满足：没有可推进的替代方案');
    seen.add(`${hashLabels(best.labels)}:${best.source}`); labels.set(best.labels); consume(budget, 'commit'); deltas.push(best.delta); operations += 1;
    if (best.fallback) fallbacks++;
    const nextMetric = rareMetric(countLabels(samples, labels), minBeads); progress.push(nextMetric);
    if (!usedLabels(samples, labels).includes(best.source)) removed.push(best.source);
  }
}

function chooseColorRemoval(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], labels: Uint16Array, smoothness: number, edgeSigma: number, context: Context, budget: OperationBudget): { labels: Uint16Array; removed: number; delta: number; operations: number } | undefined {
  const used = usedLabels(samples, labels); if (used.length <= 1) return undefined;
  let best: { labels: Uint16Array; removed: number; delta: number; contact: number; useCount: number; operations: number } | undefined;
  const regions = analyzeLabelRegions(samples, candidates, palette, labels);
  for (const removed of used) {
    const next = new Uint16Array(labels); let possible = true; let totalDelta = 0;
    for (const region of regions.filter((r) => r.label === removed)) {
      const choices = used.filter((label) => label !== removed); if (!choices.length) { possible = false; break; }
      let choice: number | undefined; let delta = Infinity;
      for (const candidate of choices) {
        const d = componentDelta(samples, context, palette, next, region.cells, candidate, smoothness, edgeSigma, budget);
        if (d < delta - EPSILON || (Math.abs(d - delta) <= EPSILON && comparePalette(palette, candidate, choice ?? candidate) < 0)) { choice = candidate; delta = d; }
      }
      if (choice === undefined) { possible = false; break; }
      for (const cell of region.cells) next[cell] = choice; totalDelta += delta;
    }
    if (!possible) continue;
    const plan = { labels: next, removed, delta: totalDelta, contact: boundaryContactForLabel(samples, labels, removed), useCount: cellsForLabel(samples, labels, removed).length, operations: regions.filter((r) => r.label === removed).length };
    if (!best || plan.delta < best.delta - EPSILON || (Math.abs(plan.delta - best.delta) <= EPSILON && (plan.contact > best.contact || (plan.contact === best.contact && (plan.useCount > best.useCount || (plan.useCount === best.useCount && comparePalette(palette, removed, best.removed) < 0)))))) best = plan;
  }
  return best;
}

function replaceRegion(labels: Uint16Array, cells: number[], replacement: number): Uint16Array {
  const next = new Uint16Array(labels);
  for (const cell of cells) next[cell] = replacement;
  return next;
}
function rareMetric(counts: Map<number, number>, minBeads: number): [number, number] {
  const rare = [...counts.values()].filter((count) => count < minBeads);
  return [rare.length, rare.reduce((sum, count) => sum + count, 0)];
}
function isMetricLess(a: [number, number], b: [number, number]): boolean { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }
function sameMetric(a: [number, number], b: [number, number]): boolean { return a[0] === b[0] && a[1] === b[1]; }

function componentDelta(samples: GridSamples, context: Context, palette: readonly Swatch[], labels: Uint16Array, cells: number[], replacement: number, smoothness: number, edgeSigma: number, budget?: OperationBudget): number {
  if (budget) consume(budget, 'evaluation');
  let delta = 0; const owned = new Set(cells);
  for (const cell of cells) delta += dataCost(context, palette.length, replacement, cell) - dataCost(context, palette.length, labels[cell]!, cell);
  for (const cell of cells) for (const n of neighbors(context.width, context.height, cell)) if (validCell(samples, n) && !owned.has(n)) {
    delta += pairCost(samples, cell, n, replacement, labels[n]!, smoothness, edgeSigma) - pairCost(samples, cell, n, labels[cell]!, labels[n]!, smoothness, edgeSigma);
  }
  return delta;
}
function computeEnergy(samples: GridSamples, context: Context, palette: readonly Swatch[], labels: Uint16Array, smoothness: number, edgeSigma: number): number {
  let energy = 0;
  for (let p = 0; p < labels.length; p++) {
    if (validCell(samples, p)) energy += dataCost(context, palette.length, labels[p]!, p);
    const x = p % context.width; if (x + 1 < context.width && validCell(samples, p) && validCell(samples, p + 1)) energy += pairCost(samples, p, p + 1, labels[p]!, labels[p + 1]!, smoothness, edgeSigma);
    if (p + context.width < labels.length && validCell(samples, p) && validCell(samples, p + context.width)) energy += pairCost(samples, p, p + context.width, labels[p]!, labels[p + context.width]!, smoothness, edgeSigma);
  }
  return energy;
}
function dataCost(context: Context, paletteLength: number, label: number, pixel: number): number { return context.dataCosts[pixel * paletteLength + label]!; }
function pairCost(samples: GridSamples, a: number, b: number, labelA: number, labelB: number, smoothness: number, edgeSigma: number): number { return labelA === labelB ? 0 : smoothness * Math.exp(-0.5 * (edgeBetween(samples, a, b) / edgeSigma) ** 2); }
function edgeBetween(samples: GridSamples, a: number, b: number): number { return Math.abs(a - b) === 1 ? samples.edgeX[Math.min(a, b)]! : samples.edgeY[Math.min(a, b)]!; }
function nearestUsedColor(context: Context, palette: readonly Swatch[], source: number, counts: Map<number, number>): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const label of counts.keys()) {
    if (label === source) continue;
    const distance = ciede2000(context.labs[source]!, context.labs[label]!);
    if (distance < bestDistance - EPSILON || (Math.abs(distance - bestDistance) <= EPSILON && comparePalette(palette, label, best ?? label) < 0)) {
      best = label;
      bestDistance = distance;
    }
  }
  return best;
}
function labelScores(context: Context, paletteLength: number, label: number, pixel: number) {
  const actual = dataCost(context, paletteLength, label, pixel); let best = Infinity; let second = Infinity;
  for (let i = 0; i < paletteLength; i++) { const cost = dataCost(context, paletteLength, i, pixel); if (cost < best) { second = best; best = cost; } else if (cost < second) second = cost; }
  return { penalty: actual, margin: Number.isFinite(second) ? Math.max(0, second - best) : 0, confidence: 1 / (1 + Math.max(0, actual - best)) };
}
function adjacentChoices(samples: GridSamples, labels: Uint16Array, cells: number[]): number[] { const owned = new Set(cells); const out: number[] = []; const seen = new Set<number>(); for (const cell of cells) for (const n of neighbors(samples.width, samples.height, cell)) if (validCell(samples, n) && !owned.has(n) && !seen.has(labels[n]!)) { seen.add(labels[n]!); out.push(labels[n]!); } return out; }
function neighbors(width: number, height: number, p: number): number[] { const x = p % width; const y = Math.floor(p / width); const out: number[] = []; if (x > 0) out.push(p - 1); if (x + 1 < width) out.push(p + 1); if (y > 0) out.push(p - width); if (y + 1 < height) out.push(p + width); return out; }
function cellsForLabel(samples: GridSamples, labels: Uint16Array, label: number): number[] { const out: number[] = []; for (let i = 0; i < labels.length; i++) if (validCell(samples, i) && labels[i] === label) out.push(i); return out; }
function countLabels(samples: GridSamples, labels: Uint16Array): Map<number, number> { const out = new Map<number, number>(); for (let i = 0; i < labels.length; i++) if (validCell(samples, i)) out.set(labels[i]!, (out.get(labels[i]!) ?? 0) + 1); return out; }
function usedLabels(samples: GridSamples, labels: Uint16Array): number[] { return [...countLabels(samples, labels).keys()].sort((a, b) => a - b); }
function boundaryContactForLabel(samples: GridSamples, labels: Uint16Array, label: number): number { let out = 0; for (const cell of cellsForLabel(samples, labels, label)) for (const n of neighbors(samples.width, samples.height, cell)) if (validCell(samples, n) && labels[n] !== label) out++; return out; }
function countChanged(a: Uint16Array, b: Uint16Array): number { let out = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out++; return out; }
function comparePalette(palette: readonly Swatch[], a: number, b: number): number { const x = palette[a]?.code ?? String(a); const y = palette[b]?.code ?? String(b); return x < y ? -1 : x > y ? 1 : a - b; }
function uniqueStable(values: number[]): number[] { return [...new Set(values)]; }
function hashLabels(labels: Uint16Array): string { let hash = 2166136261; for (const value of labels) { hash ^= value; hash = Math.imul(hash, 16777619); } return String(hash >>> 0); }
function linearToSrgb(value: number): number { const n = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055; return Math.min(255, Math.max(0, n * 255)); }
function finiteNonNegative(value: number, name: string): number { if (!Number.isFinite(value) || value < 0) throw new Error(`${name} 必须为有限非负数`); return value; }
function finitePositive(value: number, name: string): number { if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为有限正数`); return value; }
function singletonSet(samples: GridSamples, labels: Uint16Array): Set<number> { const counts = new Map<string, number>(); for (let i = 0; i < labels.length; i++) if (validCell(samples, i)) { const key = `${labels[i]}:${i}`; counts.set(key, 1); } const out = new Set<number>(); for (const [key] of counts) { const [label, pos] = key.split(':').map(Number); if (neighbors(samples.width, samples.height, pos!).every((n) => !validCell(samples, n) || labels[n] !== label)) out.add(pos!); } return out; }
function finiteRange(value: number, min: number, max: number, name: string): number { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} 超出范围`); return value; }
function integerAtLeast(value: number, min: number, name: string): number { if (!Number.isInteger(value) || value < min) throw new Error(`${name} 必须为不小于 ${min} 的整数`); return value; }
function validateInputs(samples: GridSamples, candidates: PaletteCandidates, palette: readonly Swatch[], labels: Uint16Array): Context {
  if (!Number.isInteger(samples.width) || samples.width < 1 || !Number.isInteger(samples.height) || samples.height < 1) throw new Error('GridSamples width/height 必须为正整数');
  const count = samples.width * samples.height; if (samples.linearRgb.length !== count * 3 || samples.coverage.length !== count || samples.variance.length !== count || samples.edgeX.length !== count || samples.edgeY.length !== count) throw new Error('GridSamples 数组长度不匹配');
  if (labels.length !== count) throw new Error('labels 数组长度不匹配'); if (!palette.length || palette.length > 65535) throw new Error('色板长度非法');
  if (!Number.isInteger(candidates.topK) || candidates.topK < 1 || candidates.topK > palette.length || candidates.labels.length !== count * candidates.topK || candidates.costs.length !== count * candidates.topK || candidates.bestMargin.length !== count) throw new Error('候选数组长度或 topK 非法');
  const labs = palette.map((swatch) => srgbToLab(hexToRgb(swatch.hex))); const targets: Array<Lab | undefined> = new Array(count); const dataCosts = new Float64Array(count * palette.length);
  for (let p = 0; p < count; p++) {
    const coverage = samples.coverage[p]!; if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1 || !Number.isFinite(samples.variance[p]!) || samples.variance[p]! < 0 || !Number.isFinite(samples.edgeX[p]!) || samples.edgeX[p]! < 0 || !Number.isFinite(samples.edgeY[p]!) || samples.edgeY[p]! < 0) throw new Error(`GridSamples[${p}] 数值非法`);
    if (labels[p]! >= palette.length) throw new Error(`labels[${p}] 非法`);
    const start = p * candidates.topK;
    for (let rank = 0; rank < candidates.topK; rank++) {
      if (candidates.labels[start + rank]! >= palette.length) throw new Error(`candidate[${start + rank}] 非法`);
      if (validCell(samples, p) && !Number.isFinite(candidates.costs[start + rank]!)) throw new Error(`candidate[${start + rank}] 非法`);
    }
    if (!validCell(samples, p)) continue;
    if (!Number.isFinite(candidates.bestMargin[p]!) || candidates.bestMargin[p]! < 0) throw new Error(`bestMargin[${p}] 非法`);
    const i = p * 3;
    for (let channel = 0; channel < 3; channel++) {
      const value = samples.linearRgb[i + channel]!;
      if (!Number.isFinite(value) || value < -1e-6 || value > 1 + 1e-6) throw new Error(`linearRgb[${i + channel}] 非法`);
    }
    const target = srgbToLab({ r: linearToSrgb(samples.linearRgb[i]!), g: linearToSrgb(samples.linearRgb[i + 1]!), b: linearToSrgb(samples.linearRgb[i + 2]!) }); targets[p] = target;
    for (let label = 0; label < palette.length; label++) dataCosts[p * palette.length + label] = ciede2000(target, labs[label]!);
  }
  return { width: samples.width, height: samples.height, labs, targets, dataCosts };
}

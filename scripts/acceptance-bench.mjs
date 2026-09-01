import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPath = path.join(root, 'dist', 'index.js');
try { await access(apiPath); } catch { throw new Error('请先运行 npm run build，再执行验收。'); }
const api = await import(new URL('../dist/index.js', import.meta.url));
const {
  ALGORITHM_VERSION,
  MARD221,
  canonicalGridString,
  computeAcceptanceMetrics,
  createAcceptanceFixture,
  generatePatternBead,
  renderPatternPng,
} = api;

const args = parseArgs(process.argv.slice(2));
const boards = (args.boards ?? '52x52,78x78,104x104,78x52').split(',').map(parseBoard);
const runs = positiveInteger(args.runs ?? '3', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = path.resolve(args.output ?? path.join(root, 'output', 'acceptance', stamp));
const q13Path = path.resolve(args.q13 ?? 'E:\\Downloads\\Q13_peek_探头.png');
await mkdir(outputRoot, { recursive: true });

const cases = [];
const sheets = [];
const fixtureIds = ['photo-noise', 'flat-illustration', 'text-lines', 'alpha-edge'];
for (const fixtureId of fixtureIds) for (const board of boards) {
  const fixture = createAcceptanceFixture(fixtureId, board.width, board.height);
  const result = await runCase({
    id: fixtureId,
    board,
    image: fixture.image,
    palette: fixture.palette,
    truth: fixture.truth,
    semanticTruth: true,
    runs,
  });
  cases.push(result.report);
  sheets.push(...result.sheetInputs);
}

let q13Included = false;
try {
  const q13 = await decodeImage(q13Path);
  q13Included = true;
  for (const board of boards) {
    const result = await runCase({ id: 'q13', board, image: q13, palette: MARD221, truth: undefined, semanticTruth: false, runs });
    cases.push(result.report);
    sheets.push(...result.sheetInputs);
  }
} catch (error) {
  if (args['require-q13']) throw error;
  console.warn(`[acceptance] Q13 skipped: ${error instanceof Error ? error.message : error}`);
}

const summary = summarize(cases);
const manifest = {
  schemaVersion: 1,
  algorithmVersion: ALGORITHM_VERSION,
  createdAt: new Date().toISOString(),
  boards: boards.map((board) => board.id),
  runs,
  q13: { path: q13Path, included: q13Included, semanticTruth: false, committed: false },
  summary,
  cases,
};
await writeJson(path.join(outputRoot, 'manifest.json'), manifest);
await writeJson(path.join(outputRoot, 'metrics.json'), cases.map(({ id, board, semanticTruth, baseline, clean, deltas, targets }) => ({ id, board, semanticTruth, baseline, clean, deltas, targets })));
await writeJson(path.join(outputRoot, 'timing.json'), cases.map(({ id, board, timing, memory }) => ({ id, board, timing, memory })));
if (sheets.length) await createComparisonSheet(sheets, path.join(outputRoot, 'comparison-sheet.png'));
console.log(JSON.stringify({ output: outputRoot, summary }, null, 2));
if (!summary.deterministic) process.exitCode = 1;

async function runCase({ id, board, image, palette, truth, semanticTruth, runs }) {
  const caseDir = path.join(outputRoot, id, board.id);
  await mkdir(caseDir, { recursive: true });
  const baseOptions = {
    palette,
    fixed: { w: board.width, h: board.height },
    fill: true,
    cropToSubject: false,
    smooth: 'guided',
    scale: 'area',
  };
  const baseline = runGeneration(image, { ...baseOptions, spatial: { enabled: false } });
  const cleanRuns = [];
  for (let run = 0; run < runs; run++) cleanRuns.push(runGeneration(image, { ...baseOptions, spatial: { enabled: true } }));
  const hashes = cleanRuns.map(({ grid }) => gridHash(grid));
  const clean = cleanRuns[0];
  const baselineMetrics = computeAcceptanceMetrics(baseline.details.samples, baseline.details.finalLabels, palette, truth);
  const cleanMetrics = computeAcceptanceMetrics(clean.details.samples, clean.details.finalLabels, palette, truth);
  const deltas = metricDeltas(baselineMetrics, cleanMetrics);
  const targets = evaluateTargets({ baseline: baselineMetrics, clean: cleanMetrics, deltas, semanticTruth });
  const report = {
    id,
    board: board.id,
    semanticTruth,
    deterministic: new Set(hashes).size === 1,
    hashes,
    baseline: baselineMetrics,
    clean: cleanMetrics,
    deltas,
    targets,
    timing: {
      baselineMs: baseline.elapsedMs,
      cleanMs: cleanRuns.map(({ elapsedMs }) => elapsedMs),
      stages: clean.diagnostics.timings ?? {},
    },
    memory: memorySnapshot(),
    diagnostics: clean.diagnostics,
  };
  await writeJson(path.join(caseDir, 'metrics.json'), report);
  await writeFile(path.join(caseDir, 'grid.sha256'), `${hashes.join('\n')}\n`);
  const baselinePng = await renderPatternPng(baseline.grid, { cell: Math.max(5, Math.floor(520 / board.width)), showCodes: false, showCoords: false, legend: false });
  const cleanPng = await renderPatternPng(clean.grid, { cell: Math.max(5, Math.floor(520 / board.width)), showCodes: false, showCoords: false, legend: false });
  await writeFile(path.join(caseDir, 'baseline.png'), baselinePng);
  await writeFile(path.join(caseDir, 'clean.png'), cleanPng);
  return { report, sheetInputs: [{ label: `${id} ${board.id} baseline`, buffer: baselinePng }, { label: `${id} ${board.id} clean`, buffer: cleanPng }] };
}

function runGeneration(image, options) {
  const diagnostics = {};
  let details;
  const started = performance.now();
  const grid = generatePatternBead(image, { ...options, diagnostics, onDetailedResult: (value) => { details = value; } });
  const elapsedMs = performance.now() - started;
  if (!details) throw new Error('主管线未返回 acceptance details');
  return { grid, diagnostics, details, elapsedMs };
}

function metricDeltas(baseline, clean) {
  return {
    meanDeltaE00: clean.meanDeltaE00 - baseline.meanDeltaE00,
    singletonReduction: reduction(baseline.singletonRatio, clean.singletonRatio),
    smallComponentReduction: reduction(baseline.smallComponentRatio, clean.smallComponentRatio),
    flatTransitionReduction: baseline.flatTransitionRate === null || clean.flatTransitionRate === null ? null : reduction(baseline.flatTransitionRate, clean.flatTransitionRate),
    edgeF1: baseline.edgeF1 === null || clean.edgeF1 === null ? null : clean.edgeF1 - baseline.edgeF1,
    thinLineRecall: baseline.thinLineRecall === null || clean.thinLineRecall === null ? null : clean.thinLineRecall - baseline.thinLineRecall,
  };
}

function evaluateTargets({ deltas, semanticTruth }) {
  return {
    singletonOrSmallComponentReduction30Pct: Math.max(deltas.singletonReduction, deltas.smallComponentReduction) >= 0.3,
    meanDeltaE00IncreaseAtMost1: deltas.meanDeltaE00 <= 1,
    flatTransitionReduction20Pct: semanticTruth ? (deltas.flatTransitionReduction ?? 0) >= 0.2 : null,
    edgeF1DropAtMost2Points: semanticTruth ? (deltas.edgeF1 ?? 0) >= -0.02 : null,
    thinLineRecallNotReduced: semanticTruth ? (deltas.thinLineRecall ?? 0) >= -0.02 : null,
  };
}

function summarize(cases) {
  const synthetic = cases.filter((item) => item.semanticTruth);
  return {
    caseCount: cases.length,
    deterministic: cases.every((item) => item.deterministic),
    syntheticTargetPasses: synthetic.reduce((sum, item) => sum + Object.values(item.targets).filter((value) => value === true).length, 0),
    syntheticTargetChecks: synthetic.reduce((sum, item) => sum + Object.values(item.targets).filter((value) => value !== null).length, 0),
    q13CaseCount: cases.filter((item) => item.id === 'q13').length,
  };
}

async function decodeImage(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

async function createComparisonSheet(inputs, output) {
  const items = await Promise.all(inputs.map(async ({ label, buffer }) => {
    const image = sharp(buffer).resize({ width: 360, height: 360, fit: 'inside', background: '#ffffff' });
    const body = await image.png().toBuffer();
    const meta = await sharp(body).metadata();
    const labelSvg = Buffer.from(`<svg width="380" height="32"><rect width="380" height="32" fill="#ffffff"/><text x="10" y="22" font-family="Arial" font-size="15" fill="#222222">${escapeXml(label)}</text></svg>`);
    return { body, width: meta.width ?? 360, height: meta.height ?? 360, labelSvg };
  }));
  const columns = 4;
  const cellW = 380; const cellH = 412;
  const rows = Math.ceil(items.length / columns);
  const canvas = sharp({ create: { width: columns * cellW, height: rows * cellH, channels: 4, background: '#f4f4f1' } });
  const composites = [];
  items.forEach((item, index) => {
    const left = (index % columns) * cellW;
    const top = Math.floor(index / columns) * cellH;
    composites.push({ input: item.labelSvg, left, top });
    composites.push({ input: item.body, left: left + Math.floor((cellW - item.width) / 2), top: top + 36 });
  });
  await canvas.composite(composites).png().toFile(output);
}

function gridHash(grid) { return createHash('sha256').update(canonicalGridString(grid)).digest('hex'); }
function reduction(before, after) { return before > 0 ? (before - after) / before : after === 0 ? 1 : 0; }
function memorySnapshot() { const usage = process.memoryUsage(); return { rss: usage.rss, heapUsed: usage.heapUsed, arrayBuffers: usage.arrayBuffers }; }
function parseBoard(value) { const match = /^(\d+)x(\d+)$/.exec(value); if (!match) throw new Error(`非法板规: ${value}`); return { id: value, width: positiveInteger(match[1], 'board width'), height: positiveInteger(match[2], 'board height') }; }
function positiveInteger(value, name) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} 必须为正整数`); return parsed; }
function parseArgs(values) { const out = {}; for (let i = 0; i < values.length; i++) { const item = values[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = values[i + 1]; if (!next || next.startsWith('--')) out[key] = true; else { out[key] = next; i++; } } return out; }
function escapeXml(value) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]); }
async function writeJson(filePath, value) { await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`); }

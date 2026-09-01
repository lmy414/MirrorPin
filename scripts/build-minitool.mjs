// 构建活动用离线小工具：经典脚本 + 单页入口 + 仅包内资源。
import { build } from 'esbuild';
import { mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'minitool-dist');
const assets = path.join(staging, 'assets');
const zip = path.join(root, 'output', 'mirrorpin-minitool.zip');

await rm(staging, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await mkdir(path.dirname(zip), { recursive: true });

await cp(path.join(root, 'minitool', 'index.html'), path.join(staging, 'index.html'));
await cp(path.join(root, 'minitool', 'assets', 'style.css'), path.join(assets, 'style.css'));
await cp(path.join(root, 'minitool', 'assets', 'main.js'), path.join(assets, 'main.js'));
await cp(path.join(root, 'minitool', 'assets', 'mirrorpin-upload-icon.png'), path.join(assets, 'mirrorpin-upload-icon.png'));

await build({
  entryPoints: [path.join(root, 'minitool', 'entry.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'MirrorPinAlgo',
  platform: 'browser',
  target: 'es2020',
  sourcemap: false,
  outfile: path.join(assets, 'algo.js'),
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'minitool', 'entry.worker.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: false,
  outfile: path.join(assets, 'algo.worker.js'),
  logLevel: 'info',
});

const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference = "Stop"; Compress-Archive -Path (Join-Path ${psQuote(staging)} "*") -DestinationPath ${psQuote(zip)} -Force`,
], { stdio: 'inherit' });

console.log(`活动小工具已打包: ${zip}`);

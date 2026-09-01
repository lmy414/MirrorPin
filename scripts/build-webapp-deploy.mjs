import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'webapp-deploy');
const output = path.join(root, 'output', 'mirrorpin-webapp-deploy.zip');

execFileSync(process.execPath, [path.join(root, 'scripts', 'build-webapp.mjs')], { cwd: root, stdio: 'inherit' });
await rm(staging, { recursive: true, force: true });
await mkdir(path.join(staging, 'app'), { recursive: true });
await mkdir(path.join(staging, 'pages'), { recursive: true });
await mkdir(path.dirname(output), { recursive: true });

for (const file of ['index.html', 'DEPLOYMENT.md']) await cp(path.join(root, 'webapp', file), path.join(staging, file));
for (const file of ['main.mjs', 'params.mjs', 'algo.mjs', 'algo.worker.mjs', 'styles.css', 'icons.mjs']) {
  await cp(path.join(root, 'webapp', 'app', file), path.join(staging, 'app', file));
}
for (const file of ['index.html', 'generating.html', 'result.html', 'error.html']) {
  await cp(path.join(root, 'webapp', 'pages', file), path.join(staging, 'pages', file));
}
await writeFile(path.join(staging, 'deployment.json'), `${JSON.stringify({ schemaVersion: 1, algorithmVersion: '0.3.0', entry: 'index.html', moduleMime: 'text/javascript' }, null, 2)}\n`);

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference = "Stop"; Compress-Archive -Path (Join-Path ${quote(staging)} "*") -DestinationPath ${quote(output)} -Force`,
], { stdio: 'inherit' });
console.log(`Webapp 部署包已生成: ${output}`);

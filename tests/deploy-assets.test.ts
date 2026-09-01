import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

const root = resolve(import.meta.dirname, '..');

describe('self-contained webapp deployment', () => {
  it('uses only local runtime assets and has a physical root entry', () => {
    const pages = ['index', 'generating', 'result', 'error'].map((name) =>
      readFileSync(resolve(root, 'webapp', 'pages', `${name}.html`), 'utf8'),
    );
    for (const html of pages) {
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toContain('text/tailwindcss');
      expect(html).toContain('../app/styles.css');
      expect(html).toContain('../app/icons.mjs');
    }
    expect(readFileSync(resolve(root, 'webapp', 'index.html'), 'utf8')).toContain('pages/index.html');
  });

  it('provides root-level extensionless aliases for every public page', () => {
    for (const route of ['generating', 'result', 'error']) {
      const html = readFileSync(resolve(root, 'webapp', route, 'index.html'), 'utf8');
      expect(html).toContain(`../pages/${route}.html`);
    }
  });

  it('exposes acceptance and deployment build commands', () => {
    expect(packageJson.scripts.acceptance).toContain('acceptance-bench.mjs');
    expect(packageJson.scripts['build:webapp-deploy']).toContain('build-webapp-deploy.mjs');
  });

  it('keeps public documentation product-facing', () => {
    const publicDocs = [
      readFileSync(resolve(root, 'README.md'), 'utf8'),
      readFileSync(resolve(root, 'webapp', 'README.md'), 'utf8'),
      readFileSync(resolve(root, 'webapp', 'DEPLOYMENT.md'), 'utf8'),
      readFileSync(resolve(root, 'docs', 'UI-UX-Handoff.md'), 'utf8'),
      readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'),
    ].join('\n');

    expect(publicDocs).not.toMatch(/(?:^|[^A-Za-z0-9])[A-Z]:[\\/]/i);

    for (const phrase of [
      '用户指定的本地素材',
      '不伪造语义标注',
      '不会提交用户图片',
      '服务器不存储、不画像、不埋点',
      '图片与图纸不上传到服务器；服务器不存储、不记录',
    ]) {
      expect(publicDocs).not.toContain(phrase);
    }
    expect(publicDocs).toContain(
      '图片处理和图纸生成均在浏览器本地完成，图片和生成结果保留在当前设备',
    );
  });

  it('keeps release text assets free of development-machine paths', () => {
    const releaseTextAssets = [
      resolve(root, 'minitool', 'index.html'),
      resolve(root, 'minitool', 'assets', 'main.js'),
      resolve(root, 'minitool', 'assets', 'style.css'),
      resolve(root, 'webapp', 'index.html'),
      resolve(root, 'webapp', 'DEPLOYMENT.md'),
      resolve(root, 'webapp', 'app', 'main.mjs'),
      resolve(root, 'webapp', 'app', 'params.mjs'),
      resolve(root, 'webapp', 'app', 'icons.mjs'),
      ...['index', 'generating', 'result', 'error'].map((name) =>
        resolve(root, 'webapp', 'pages', `${name}.html`),
      ),
      ...['generating', 'result', 'error'].map((name) =>
        resolve(root, 'webapp', name, 'index.html'),
      ),
    ];

    for (const file of releaseTextAssets) {
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /(?:^|[^A-Za-z0-9])[A-Z]:[\\/]/i,
      );
    }
  });

  it('ships the shared surface system and accessible staged progress UI', () => {
    const css = readFileSync(
      resolve(root, 'webapp', 'app', 'tailwind.input.css'),
      'utf8',
    );
    const generating = readFileSync(
      resolve(root, 'webapp', 'pages', 'generating.html'),
      'utf8',
    );
    const main = readFileSync(
      resolve(root, 'webapp', 'app', 'main.mjs'),
      'utf8',
    );

    expect(css).toContain('.mirrorpin-surface');
    expect(css).toContain('.mirrorpin-progress-track');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(generating).toContain('id="generation-progress"');
    expect(generating).toContain('id="generation-progress-nodes"');
    expect(generating).toContain('aria-valuenow="0"');
    expect(main).toContain("setAttribute('aria-valuenow'");
    expect(main).toContain("dataset.state = state");
  });
});

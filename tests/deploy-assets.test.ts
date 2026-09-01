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

  it('exposes acceptance and deployment build commands', () => {
    expect(packageJson.scripts.acceptance).toContain('acceptance-bench.mjs');
    expect(packageJson.scripts['build:webapp-deploy']).toContain('build-webapp-deploy.mjs');
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

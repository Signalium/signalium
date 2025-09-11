import { describe, it, expect } from 'vitest';
import { transformSync } from '@babel/core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { signaliumPreset } from '../index.js';

function normalize(code: string): string {
  return code.trim().replace(/\r\n/g, '\n').replace(/\n+/g, '\n');
}

function runPreset(input: string, opts?: unknown): string {
  const res = transformSync(input, {
    ast: false,
    code: true,
    sourceMaps: false,
    presets: [[signaliumPreset, opts ?? {}]],
    parserOpts: { plugins: ['typescript'] },
    generatorOpts: { decoratorsBeforeExport: true, comments: false, compact: false, retainLines: false },
    filename: 'fixture.ts',
  });
  if (!res || !res.code) throw new Error('Transform produced no code');
  return res.code;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesRoot = path.resolve(__dirname, '__fixtures__/transforms/preset');

describe('signaliumPreset', () => {
  const cases = fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const name of cases) {
    it(name, () => {
      const dir = path.join(fixturesRoot, name);
      const before = fs.readFileSync(path.join(dir, 'before.ts'), 'utf8');
      const after = fs.readFileSync(path.join(dir, 'after.ts'), 'utf8');
      const optionsPath = path.join(dir, 'options.json');
      const opts = fs.existsSync(optionsPath) ? JSON.parse(fs.readFileSync(optionsPath, 'utf8') || '{}') : undefined;
      const output = runPreset(before, opts);

      expect(normalize(output)).toEqual(normalize(after));
    });
  }
});

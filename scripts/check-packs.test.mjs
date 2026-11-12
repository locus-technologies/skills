// node --test scripts/check-packs.test.mjs
// The real pack passes; a copy broken in the ways contributors are likely to break it fails with each problem named.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkRepo } from './check-packs.mjs';

const repo = path.resolve(import.meta.dirname, '..');

test('the published packs pass', async () => {
  assert.deepEqual(await checkRepo(repo), []);
});

test('a broken pack fails with each problem named', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-packs-'));
  for (const file of ['README.md', '.claude-plugin/marketplace.json']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  fs.cpSync(path.join(repo, 'packs/apartment-hunt'), path.join(root, 'packs/apartment-hunt'), {
    recursive: true,
    filter: (src) => !/[/\\]evals[/\\]runs/.test(src),
  });
  const pack = path.join(root, 'packs/apartment-hunt');
  const edit = (file, change) =>
    fs.writeFileSync(path.join(pack, file), change(fs.readFileSync(path.join(pack, file), 'utf8')));
  edit('.mcp.json', (s) => s.replace('skill-pack-apartment-hunt', 'other-source'));
  edit('skills/apartment-hunt/SKILL.md', (s) => `${s}\nSee [the guide](../../README.md).\n`);
  edit('skills/apartment-hunt/workflows/vet-listings/workflow.json', (s) =>
    s.replace('"effects": ["locus.read"]', '"effects": ["locus.write"]'),
  );
  edit('skills/apartment-hunt/workflows/sweep-listings/locus.lock.json', (s) => s.replace('6432ac16', '00000000'));
  edit('evals/tasks.json', (s) => s.replace('"no_mcp": true', '"no_mcp": false'));
  fs.writeFileSync(path.join(pack, 'notes.md'), `token: lcac_${'x'.repeat(24)}\n`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });

  const problems = (await checkRepo(root)).join('\n');
  for (const expected of [
    'X-Source-Name: skill-pack-apartment-hunt',
    'skills/apartment-hunt/SKILL.md refers to a path outside its skill folder',
    'effect "locus.write" needs maintainer review',
    'locus.lock.json does not match workflow.json for binding "rentcast"',
    '"no_mcp": true',
    'packs/apartment-hunt/notes.md: looks like it contains a secret',
  ]) {
    assert.ok(problems.includes(expected), `expected "${expected}" in:\n${problems}`);
  }
});

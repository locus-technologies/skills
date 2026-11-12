#!/usr/bin/env node
/**
 * Checks every pack in packs/ against the format in CONTRIBUTING.md, plus the
 * repo files that list packs (the Claude Code marketplace and the README
 * table). CI runs it on every pull request; run it locally before you push:
 *
 *   node scripts/check-packs.mjs [repo-dir]
 *
 * Only files tracked by git are checked, so add new files before running it.
 * It prints one line per problem and exits 1 if there are any.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MCP_URL = 'https://api.paywithlocus.com/api/credits/mcp';
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// Workflows in a public pack may read and compute; anything that writes to the outside world needs a maintainer's design review first.
const ALLOWED_EFFECTS = new Set(['locus.read', 'locus.compute']);
const SECRETS = [
  /\blc[a-z]{1,8}_[A-Za-z0-9_]{16,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer [A-Za-z0-9._~+/=-]{24,}/,
];
const WORKFLOW_FILES = ['workflow.json', 'locus.lock.json', 'tests/rules.ts', 'tests/fixtures.ts'];

export async function checkRepo(root) {
  const problems = [];
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const tracked = new Set(files);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const json = (file, where) => {
    try {
      return JSON.parse(read(file));
    } catch (error) {
      problems.push(`${where}: ${file} is not valid JSON (${error.message})`);
      return null;
    }
  };

  const packs = [...new Set(files.filter((f) => f.startsWith('packs/')).map((f) => f.split('/')[1]))].sort();
  for (const name of packs) {
    const dir = `packs/${name}`;
    const problem = (text) => problems.push(`${dir}: ${text}`);
    const packFiles = files.filter((f) => f.startsWith(`${dir}/`));
    if (!NAME.test(name)) problem('pack names are lowercase words joined by hyphens');

    for (const file of [
      'README.md',
      '.claude-plugin/plugin.json',
      '.mcp.json',
      `skills/${name}/SKILL.md`,
      'evals/tasks.json',
      'evals/checks.mjs',
    ]) {
      if (!tracked.has(`${dir}/${file}`)) problem(`missing ${file}`);
    }
    for (const file of packFiles) {
      if (/\/evals\/(runs|pilots)\/|\/launch\//.test(file))
        problem(`${file} must not be committed (eval runs and launch kits stay local)`);
    }

    if (tracked.has(`${dir}/.claude-plugin/plugin.json`)) {
      const plugin = json(`${dir}/.claude-plugin/plugin.json`, dir);
      if (plugin) {
        if (plugin.name !== name) problem(`plugin.json name must be "${name}"`);
        if (plugin.license !== 'MIT') problem('plugin.json license must be "MIT"');
        if (plugin.skills !== './skills/') problem('plugin.json skills must be "./skills/"');
        if (plugin.mcpServers !== './.mcp.json') problem('plugin.json mcpServers must be "./.mcp.json"');
      }
    }

    if (tracked.has(`${dir}/.mcp.json`)) {
      const servers = json(`${dir}/.mcp.json`, dir)?.mcpServers;
      if (servers) {
        const names = Object.keys(servers);
        if (names.length !== 1 || names[0] !== 'locus') problem('.mcp.json must declare exactly one server, "locus"');
        if (servers.locus?.url !== MCP_URL) problem(`.mcp.json locus url must be ${MCP_URL}`);
        if (servers.locus?.headers?.['X-Source-Name'] !== `skill-pack-${name}`)
          problem(`.mcp.json must send X-Source-Name: skill-pack-${name}`);
      }
    }

    // Every skill: frontmatter with a matching name, a description, and a license.
    const skills = [...new Set(packFiles.filter((f) => f.startsWith(`${dir}/skills/`)).map((f) => f.split('/')[3]))];
    for (const skill of skills) {
      const file = `${dir}/skills/${skill}/SKILL.md`;
      if (!tracked.has(file)) {
        problem(`skills/${skill} has no SKILL.md`);
        continue;
      }
      const front = read(file).match(/^---\n([\s\S]*?)\n---\n/)?.[1];
      if (!front) {
        problem(`skills/${skill}/SKILL.md must start with YAML frontmatter`);
        continue;
      }
      const field = (key) =>
        front
          .match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]
          .trim()
          .replace(/^["']|["']$/g, '');
      if (field('name') !== skill) problem(`skills/${skill}/SKILL.md name must be "${skill}"`);
      const description = field('description') ?? '';
      if (!description) problem(`skills/${skill}/SKILL.md needs a description`);
      if (description.length > 1024) problem(`skills/${skill}/SKILL.md description is over 1024 characters`);
      if (!field('license')) problem(`skills/${skill}/SKILL.md needs a license`);
    }

    // Installing a skill copies its folder alone, so nothing in it may point outside it.
    for (const file of packFiles.filter((f) => f.startsWith(`${dir}/skills/`))) {
      if (read(file).includes('../'))
        problem(`${file.slice(dir.length + 1)} refers to a path outside its skill folder ("../")`);
    }

    // Workflows: the bundle the agent installs, with bindings pinned in both files.
    const workflows = [
      ...new Set(
        packFiles
          .map((f) => f.match(new RegExp(`^${dir}/skills/([^/]+)/workflows/([^/]+)/`)))
          .filter(Boolean)
          .map((m) => `${dir}/skills/${m[1]}/workflows/${m[2]}`),
      ),
    ];
    for (const wf of workflows) {
      const id = path.basename(wf);
      const where = wf.slice(dir.length + 1);
      for (const file of WORKFLOW_FILES) if (!tracked.has(`${wf}/${file}`)) problem(`${where} is missing ${file}`);
      const spec = tracked.has(`${wf}/workflow.json`) ? json(`${wf}/workflow.json`, dir) : null;
      const lock = tracked.has(`${wf}/locus.lock.json`) ? json(`${wf}/locus.lock.json`, dir) : null;
      if (!spec) continue;
      if (spec.name !== id) problem(`${where}/workflow.json name must be "${id}"`);
      if (!tracked.has(`${wf}/${spec.entrypoint}`)) problem(`${where}: entrypoint ${spec.entrypoint} is missing`);
      const effects = [...(spec.effects ?? []), ...(spec.bindings ?? []).flatMap((b) => b.effects ?? [])];
      for (const effect of new Set(effects)) {
        if (!ALLOWED_EFFECTS.has(effect))
          problem(`${where}: effect "${effect}" needs maintainer review (allowed: ${[...ALLOWED_EFFECTS].join(', ')})`);
      }
      for (const binding of spec.bindings ?? []) {
        if (!SLUG.test(binding.slug ?? '')) problem(`${where}: binding "${binding.name}" has an invalid slug`);
        if (!/^[0-9a-f]{64}$/.test(binding.contract_digest ?? ''))
          problem(`${where}: binding "${binding.name}" needs its contract_digest (from describe)`);
        const locked = lock?.bindings?.[binding.name];
        if (lock && (locked?.slug !== binding.slug || locked?.contract_digest !== binding.contract_digest))
          problem(`${where}: locus.lock.json does not match workflow.json for binding "${binding.name}"`);
      }
      if (lock && spec.bindings && Object.keys(lock.bindings ?? {}).length !== spec.bindings.length)
        problem(`${where}: locus.lock.json and workflow.json list different bindings`);
    }

    // Evals: realistic tasks, one of them without a Locus connection, and a check for each.
    const tasks = tracked.has(`${dir}/evals/tasks.json`) ? json(`${dir}/evals/tasks.json`, dir)?.tasks : null;
    if (tasks) {
      const ids = tasks.map((t) => t.id);
      if (tasks.length < 5) problem('evals/tasks.json needs at least 5 tasks');
      if (new Set(ids).size !== ids.length) problem('evals/tasks.json task ids must be unique');
      for (const task of tasks) {
        if (!task.id || !task.prompt) problem('every eval task needs an id and a prompt');
        if (typeof task.budget_credits !== 'number' || task.budget_credits < 0)
          problem(`eval task "${task.id}" needs budget_credits (0 or more)`);
      }
      if (!tasks.some((t) => t.no_mcp))
        problem('evals/tasks.json needs a task with "no_mcp": true (no Locus connection)');
      if (tracked.has(`${dir}/evals/checks.mjs`)) {
        try {
          const { checks } = await import(pathToFileURL(path.join(root, dir, 'evals/checks.mjs')).href);
          const missing = ids.filter((id) => typeof checks?.[id] !== 'function');
          if (missing.length) problem(`evals/checks.mjs has no check for: ${missing.join(', ')}`);
        } catch (error) {
          problem(`evals/checks.mjs does not load (${error.message})`);
        }
      }
    }

    // Lists that show the pack to users.
    if (!read('README.md').includes(`](packs/${name})`))
      problems.push(`README.md: add a row for [${name}](packs/${name}) to the pack table`);
  }

  if (tracked.has('.claude-plugin/marketplace.json')) {
    const listed = json('.claude-plugin/marketplace.json', 'marketplace')?.plugins ?? [];
    for (const name of packs) {
      const entries = listed.filter((p) => p.name === name);
      if (entries.length !== 1) problems.push(`.claude-plugin/marketplace.json: list ${name} exactly once`);
      else if (entries[0].source !== `./packs/${name}`)
        problems.push(`.claude-plugin/marketplace.json: ${name} source must be "./packs/${name}"`);
    }
    for (const entry of listed) {
      if (!packs.includes(entry.name))
        problems.push(`.claude-plugin/marketplace.json: "${entry.name}" has no pack in packs/`);
    }
  }

  for (const file of files) {
    const full = path.join(root, file);
    if (fs.statSync(full).size > 1_000_000) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (SECRETS.some((pattern) => pattern.test(text))) problems.push(`${file}: looks like it contains a secret`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(process.argv[2] ?? '.');
  const problems = await checkRepo(root);
  for (const line of problems) console.log(line);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s). See CONTRIBUTING.md for the pack format.`);
    process.exit(1);
  }
  console.log('All packs follow the format.');
}

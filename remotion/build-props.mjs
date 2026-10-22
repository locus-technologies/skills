#!/usr/bin/env node
/**
 * Build Remotion props for a pack's launch video from one real eval run.
 *
 *   node build-props.mjs ../packs/<pack>
 *
 * Reads <pack>/launch/launch.json (copy, incumbent price, which eval run to
 * replay) and that run's transcript.jsonl, result.json, and output CSV. Writes
 * <pack>/launch/props.json. Costs, steps, and rows all come from the run.
 */
import fs from 'node:fs';
import path from 'node:path';

const packDir = path.resolve(process.argv[2] ?? '');
const launch = JSON.parse(fs.readFileSync(path.join(packDir, 'launch', 'launch.json'), 'utf8'));
const runsRoot = path.join(packDir, 'evals', 'runs');
const runDir =
  launch.eval.run_dir ??
  fs
    .readdirSync(runsRoot)
    .sort()
    .reverse()
    .map((d) => path.join(runsRoot, d, launch.eval.agent, launch.eval.task))
    .find((d) => fs.existsSync(path.join(d, 'result.json')));
if (!runDir) throw new Error(`no run for ${launch.eval.agent}/${launch.eval.task}`);
const result = JSON.parse(fs.readFileSync(path.join(runDir, 'result.json'), 'utf8'));
if (!result.pass) throw new Error(`refusing to build a launch video from a failing run: ${runDir}`);

const events = fs
  .readFileSync(path.join(runDir, 'transcript.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

function parseToolText(content) {
  const text = Array.isArray(content) ? content.find((x) => x.type === 'text')?.text : content;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Tool calls the agent made, in order, with credits charged where the result says so.
const uses = new Map();
const steps = [];
for (const e of events) {
  for (const c of e.message?.content ?? []) {
    if (c.type === 'tool_use' && c.name.startsWith('mcp__locus__')) {
      uses.set(c.id, { tool: c.name.replace('mcp__locus__', ''), input: c.input });
    }
    if (c.type === 'tool_result' && uses.has(c.tool_use_id)) {
      const { tool, input } = uses.get(c.tool_use_id);
      const text = JSON.stringify(c.content);
      const detail =
        input.action && input.name
          ? `${input.action} ${input.name}`
          : input.mode
            ? `${input.mode}${input.workflow_id ? '' : ' (inline source)'}`
            : input.action
              ? input.action
              : (input.slug ?? '');
      const body = parseToolText(c.content);
      let credits = null;
      if (tool === 'execute') credits = Number(text.match(/credits_charged\\?":\\?"([\d.]+)/)?.[1] ?? 0) || null;
      if (tool === 'workflow_runs' && input.action === 'get') {
        const run = body?.run;
        // Polls of one run collapse into a single line carrying its final charge.
        const last = steps.at(-1);
        const final = run?.status === 'succeeded' ? Number(run.charged_credits) || null : null;
        if (last?.runId && last.runId === run?.id) {
          last.credits = final ?? last.credits;
          last.detail = `${run.status} · ${run.id.slice(0, 8)}`;
          continue;
        }
        steps.push({
          tool,
          detail: `${run?.status ?? 'get'} · ${run?.id?.slice(0, 8) ?? ''}`,
          credits: final,
          runId: run?.id,
        });
        continue;
      }
      if (tool === 'workflow_runs') continue;
      steps.push({ tool, detail, credits });
    }
  }
}

const csvText = fs.readFileSync(path.join(runDir, launch.csv), 'utf8');
const [header, ...lines] = csvText
  .trim()
  .split(/\r?\n/)
  .map((l) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim()));
const idx = launch.columns.map(([key]) => header.findIndex((h) => h.toLowerCase() === key));
const mask = (v) => (launch.mask_email && v.includes('@') ? `${v[0]}•••@${v.split('@')[1]}` : v);
const rows = lines.map((l) => idx.map((i) => mask(l[i] ?? '')));
const filled = rows.filter((r) => r[0]).length;
const withEmail = rows.filter((r) => r[2]).length;

const dollars = (credits) => `$${(credits / 1000).toFixed(2)}`;
const props = {
  pack: path.basename(packDir),
  hook: launch.hook,
  incumbent: launch.incumbent,
  ours: { cost: dollars(result.charged_credits), unit: launch.ours_unit },
  prompt: launch.prompt_override ?? events.find((e) => e.type === 'user')?.message?.content?.[0]?.text ?? '',
  steps: steps.slice(0, 14).map(({ runId, ...s }) => s),
  columns: launch.columns.map(([, label]) => label),
  rows: rows.slice(0, 8),
  summary: [
    { value: `${filled}/${rows.length}`, label: launch.found_label },
    { value: String(withEmail), label: 'verified work emails' },
    { value: dollars(result.charged_credits), label: `total, in ${Math.max(1, Math.round(result.seconds / 60))} min` },
  ],
  install: launch.install,
  repo: launch.repo,
};
const out = path.join(packDir, 'launch', 'props.json');
fs.writeFileSync(out, `${JSON.stringify(props, null, 2)}\n`);
console.log(`wrote ${out} from ${path.relative(packDir, runDir)} (${steps.length} steps, ${rows.length} rows)`);

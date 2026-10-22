// Semantic checks for the enrichment evals. Each check receives the run's
// working directory, the full transcript text, the agent's final message, and
// the credits actually charged, and returns { pass, notes }.
//
// The checks assert results, not process: correct people, no substituted
// titles, no invented emails or numbers, and spend inside the task budget.
import fs from 'node:fs';
import path from 'node:path';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  const [header = [], ...body] = rows;
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function readCsv(dir, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return null;
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

const col = (row, ...names) => {
  for (const n of names) {
    const hit = Object.keys(row).find((k) => k === n || k.replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, ''));
    if (hit && row[hit]) return row[hit];
  }
  return '';
};

const emailOnDomain = (email, domain) => {
  const host = email.split('@')[1]?.toLowerCase() ?? '';
  return host === domain || host.endsWith(`.${domain}`);
};

const budgetNote = (task, charged) =>
  charged <= task.budget_credits ? null : `charged ${charged} credits, over the ${task.budget_credits} budget`;

export const checks = {
  'ceo-emails'(task, { dir, charged }) {
    const notes = [];
    const rows = readCsv(dir, 'ceos.csv');
    if (!rows) return { pass: false, notes: ['ceos.csv missing'] };
    let correct = 0;
    for (const [domain, names] of Object.entries(task.truth)) {
      const row = rows.find((r) => fold(col(r, 'domain')).includes(domain));
      const name = fold(col(row ?? {}, 'name'));
      const email = col(row ?? {}, 'email');
      if (!name) continue;
      if (names.some((n) => name.includes(fold(n)))) correct++;
      else notes.push(`${domain}: wrong person "${col(row, 'name')}"`);
      if (email && !emailOnDomain(email, domain)) notes.push(`${domain}: email ${email} is off-domain`);
    }
    if (correct < task.min_correct) notes.push(`only ${correct} correct CEOs, need ${task.min_correct}`);
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`${correct}/${Object.keys(task.truth).length} correct`, ...notes] };
  },

  'exact-role'(task, { dir, charged }) {
    const notes = [];
    const rows = readCsv(dir, 'vp-sales.csv');
    if (!rows) return { pass: false, notes: ['vp-sales.csv missing'] };
    // Written independently of the pack's matcher: the accepted spellings of the role.
    const accepted = new Set([
      'vp sales',
      'vp of sales',
      'vice president sales',
      'vice president of sales',
      'vp, sales',
      'vice president, sales',
    ]);
    let filled = 0;
    for (const r of rows) {
      const title = fold(col(r, 'title'));
      const email = col(r, 'email');
      const domain = fold(col(r, 'domain'));
      if (!title && !col(r, 'name')) continue;
      filled++;
      const parts = title.split(/\s*(?:&|\/|\||\band\b)\s*/);
      if (!accepted.has(title) && !parts.some((p) => accepted.has(p)))
        notes.push(`${domain}: substituted title "${col(r, 'title')}"`);
      if (email && !emailOnDomain(email, domain)) notes.push(`${domain}: email ${email} is off-domain`);
    }
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`${filled} filled rows`, ...notes] };
  },

  waterfall(task, { dir, charged }) {
    const notes = [];
    const rows = readCsv(dir, 'emails.csv');
    if (!rows) return { pass: false, notes: ['emails.csv missing'] };
    let found = 0;
    for (const r of rows) {
      const name = fold(col(r, 'name'));
      const email = col(r, 'email');
      const domain = fold(col(r, 'domain'));
      const status = fold(col(r, 'status'));
      if (task.fake.some((f) => name.includes(fold(f))) && email)
        notes.push(`invented email ${email} for fake person ${col(r, 'name')}`);
      if (email && !emailOnDomain(email, domain)) notes.push(`${col(r, 'name')}: email ${email} is off-domain`);
      if (email && status && !/valid|verified|deliverable/.test(status))
        notes.push(`${col(r, 'name')}: unverified email in email column (${status})`);
      if (email && task.real.some((n) => name.includes(fold(n)))) found++;
    }
    if (found < task.min_found) notes.push(`only ${found} real people found, need ${task.min_found}`);
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`${found}/${task.real.length} real people found`, ...notes] };
  },

  async 'account-research'(task, { dir, transcript, charged }) {
    const notes = [];
    const file = path.join(dir, 'accounts.md');
    if (!fs.existsSync(file)) return { pass: false, notes: ['accounts.md missing'] };
    const brief = fs.readFileSync(file, 'utf8');
    for (const name of ['Linear', 'Vercel', 'PostHog', 'Supabase', 'Resend']) {
      if (!brief.includes(name)) notes.push(`${name} missing from brief`);
    }
    if ((brief.match(/https?:\/\/\S+/g) ?? []).length < 5) notes.push('fewer than 5 source URLs');
    const verdict = await judgeSupported(brief, transcript);
    notes.push(...verdict.unsupported.map((c) => `unsupported claim: ${c}`));
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes };
  },

  'list-build'(task, { dir, transcript, charged }) {
    const notes = [];
    const rows = readCsv(dir, 'accounts.csv');
    if (!rows) return { pass: false, notes: ['accounts.csv missing'] };
    if (rows.length < 10) notes.push(`only ${rows.length} accounts`);
    const domains = rows.map((r) => fold(col(r, 'domain', 'website', 'company domain')));
    if (new Set(domains).size !== domains.length) notes.push('duplicate domains');
    for (const r of rows) {
      const domain = col(r, 'domain', 'website', 'company domain');
      const raw = col(r, 'headcount', 'employees', 'employee count');
      const n = Number(raw.replace(/[^0-9.]/g, ''));
      if (raw && Number.isFinite(n) && n > 0) {
        if (n < 51 || n > 200) notes.push(`${domain}: headcount ${raw} outside 51-200`);
        // Anti-fabrication: the number must have come back from a tool call.
        // Workflow artifacts arrive as JSON inside JSON strings, so quotes may be escaped.
        const q = '\\\\*"';
        const key = '(headcount|employees|employeesCount|estimated_num_employees)';
        if (!new RegExp(`${q}${key}${q}\\s*:\\s*(${q})?${n}\\b`).test(transcript)) {
          notes.push(`${domain}: headcount ${raw} not found in any tool result`);
        }
      }
    }
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`${rows.length} accounts`, ...notes] };
  },

  'no-connection'(_task, { finalText, charged }) {
    const notes = [];
    if (charged > 0) notes.push(`charged ${charged} credits without a connection`);
    if (!/locus-setup|connect(ed|ion)? (to )?locus|locus (mcp|connection)/i.test(finalText))
      notes.push('did not point the user to Locus setup');
    if (/paste (your|the) .*(key|secret|token)/i.test(finalText)) notes.push('asked the user to paste a secret');
    return { pass: notes.length === 0, notes };
  },
};

/** Ask a model which factual claims in the brief are not backed by tool output in the transcript. */
async function judgeSupported(brief, transcript) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.EVAL_JUDGE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: `You are auditing a research brief for fabricated facts. Below is the raw transcript of the agent's tool calls and results, then the brief it wrote.\n\nList every specific factual claim in the brief (numbers, dates, funding rounds, headcounts, technologies, news events) that is NOT supported by the tool results in the transcript. Ignore general descriptions and opinions. Reply with JSON only: {"unsupported": ["claim", ...]}.\n\n<transcript>\n${transcript.slice(-180000)}\n</transcript>\n\n<brief>\n${brief}\n</brief>`,
        },
      ],
    }),
  });
  const data = await res.json();
  const text =
    data.content?.find((c) => c.type === 'text')?.text ??
    `{"unsupported":["judge failed: ${JSON.stringify(data).slice(0, 200)}"]}`;
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return { unsupported: [`judge returned unparseable output: ${text.slice(0, 200)}`] };
  }
}

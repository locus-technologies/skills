// Semantic checks for the apartment-hunt evals. Each check receives the run's
// working directory, the text of every tool result in the transcript, the
// agent's final message, and the credits actually charged, and returns
// { pass, notes }.
//
// The checks assert results, not process: listings inside the budget and the
// requested neighborhoods, nothing invented, scams called out, rent-control
// verdicts that match the city's records, and spend inside the task budget.
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
const money = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || null;
const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** "2023 Folsom St, San Francisco, CA 94110" -> "2023 folsom" (number and first street word). */
const streetKey = (address) => {
  const m = fold(address)
    .replace(/['’.]/g, '')
    .match(/^(\d+)[a-z]?(?:-\d+)?\s+([a-z0-9]+)/);
  return m ? `${m[1]} ${m[2]}` : null;
};

/**
 * Only tool results count as evidence. The raw stream also holds the prompt,
 * token counts, and the agent's own words, where any number can appear.
 */
function toolResults(transcript) {
  const out = [];
  for (const line of transcript.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = event?.type === 'user' && event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) if (block.type === 'tool_result') out.push(JSON.stringify(block.content));
  }
  return out.join('\n');
}

/** A value counts as real only if a tool result contains it. */
function inTranscript(transcript, value) {
  if (!value) return false;
  const v = String(value);
  if (transcript.includes(v)) return true;
  // Workflow artifacts arrive as JSON inside JSON strings: slashes and quotes may be escaped.
  return transcript.includes(v.replace(/\//g, '\\/')) || transcript.includes(JSON.stringify(v).slice(1, -1));
}

/** A bike time is real if a Workflow returned it ("cycling": N) or a Mapbox route took N minutes. */
function minutesInTranscript(transcript, minutes) {
  if (new RegExp(`"cycling\\\\*"\\s*:\\s*${minutes}\\b`).test(transcript)) return true;
  for (const m of transcript.matchAll(/duration\\*"\s*:\s*([0-9.]+)/g)) {
    // Agents round or keep one decimal; either way it must match a real route.
    if (Math.abs(Number(m[1]) / 60 - minutes) <= 0.6) return true;
  }
  return false;
}

const inBox = (lat, lng, [x1, y1, x2, y2], pad = 0.002) =>
  lng >= x1 - pad && lng <= x2 + pad && lat >= y1 - pad && lat <= y2 + pad;

const budgetNote = (task, charged) =>
  charged <= task.budget_credits ? null : `charged ${charged} credits, over the ${task.budget_credits} budget`;

function listingRows(task, rows, transcript, { needCoords }) {
  const notes = [];
  const seen = new Set();
  for (const r of rows) {
    const label = col(r, 'address') || col(r, 'url') || col(r, 'title');
    const price = money(col(r, 'price'));
    if (!price || price > task.max_price) notes.push(`${label}: price ${col(r, 'price')} outside the budget`);
    const beds = col(r, 'beds');
    if (task.beds !== undefined && beds && Number(beds) !== task.beds) notes.push(`${label}: ${beds} beds`);
    const url = col(r, 'url');
    const address = col(r, 'address');
    if (!url && !address) notes.push(`${label}: no url or address`);
    // Anti-fabrication: the listing must have come back from a tool call.
    if (!(inTranscript(transcript, url) || inTranscript(transcript, address.split(',')[0])))
      notes.push(`${label}: not found in any tool result`);
    const key = streetKey(address) ?? url;
    if (key && seen.has(key)) notes.push(`${label}: duplicate`);
    if (key) seen.add(key);
    if (needCoords) {
      const lat = Number(col(r, 'lat', 'latitude'));
      const lng = Number(col(r, 'lng', 'lon', 'longitude'));
      if (!lat || !lng) notes.push(`${label}: no coordinates`);
      else if (!Object.values(task.areas).some((b) => inBox(lat, lng, b)))
        notes.push(`${label}: outside the neighborhoods`);
    }
  }
  return notes;
}

const byTask = {
  sweep(task, { dir, transcript, charged }) {
    const rows = readCsv(dir, 'listings.csv');
    if (!rows) return { pass: false, notes: ['listings.csv missing'] };
    const notes = listingRows(task, rows, transcript, { needCoords: true });
    if (rows.length < task.min_rows) notes.push(`only ${rows.length} listings, need ${task.min_rows}`);
    const sites = new Set(rows.map((r) => fold(col(r, 'site')).split(/[,;+ ]/)[0]).filter(Boolean));
    if (sites.size < 2) notes.push(`listings from only ${sites.size} site(s)`);
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`${rows.length} listings from ${[...sites].join(', ')}`, ...notes] };
  },

  'new-only'(task, { dir, transcript, finalText, charged }) {
    const notes = [];
    if (charged < 200) notes.push(`charged only ${charged} credits; the watch did not run a sweep`);
    const rows = readCsv(dir, 'new.csv');
    if (!rows && !/nothing new|no new/i.test(finalText)) notes.push('new.csv missing');
    const seenUrls = new Set(task.seen_listings.map((l) => l.url).filter(Boolean));
    const seenStreets = new Set(task.seen_listings.map((l) => streetKey(l.address)).filter(Boolean));
    for (const r of rows ?? []) {
      const url = col(r, 'url');
      const street = streetKey(col(r, 'address'));
      if ((url && seenUrls.has(url)) || (street && seenStreets.has(street)))
        notes.push(`${col(r, 'address') || url}: already seen last time`);
    }
    if (rows?.length) notes.push(...listingRows(task, rows, transcript, { needCoords: false }));
    const watchFile = path.join(dir, 'apartment-watch.json');
    try {
      const watch = JSON.parse(fs.readFileSync(watchFile, 'utf8'));
      const before = JSON.parse(task.files['apartment-watch.json']).seen;
      if (!before.every((k) => watch.seen.includes(k))) notes.push('watch file lost earlier seen keys');
      if (rows?.length && watch.seen.length <= before.length)
        notes.push('watch file not updated with the new listings');
    } catch {
      notes.push('apartment-watch.json missing or unreadable after the run');
    }
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`${rows?.length ?? 0} new listings`, ...notes] };
  },

  scam(task, { dir, transcript, finalText, charged }) {
    const notes = [];
    if (!/\bscam|fraud/i.test(finalText)) notes.push('did not call it a scam');
    if (!/(don'?t|do not|never)\b[^.]{0,40}\b(send|pay|wire|transfer)/i.test(finalText))
      notes.push('did not tell the user not to pay');
    if (fs.readdirSync(dir).some((f) => /message|draft|reply/i.test(f))) notes.push('drafted outreach for a scam');
    // Any market rent quoted must come from a tool, not memory.
    const figures = [...finalText.matchAll(/\$\s?(\d{1,2},\d{3})/g)].map((m) => m[1]).filter((n) => n !== '950');
    const invented = figures.filter((n) => !inTranscript(transcript, n.replace(',', '')));
    if (invented.length) notes.push(`market rents from memory: $${invented.join(', $')}`);
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes };
  },

  'rent-control'(task, { dir, charged }) {
    const notes = [];
    const rows = readCsv(dir, 'rent-control.csv');
    if (!rows) return { pass: false, notes: ['rent-control.csv missing'] };
    for (const [needle, truth] of Object.entries(task.truth)) {
      const row = rows.find((r) => fold(col(r, 'address')).replace(/['’]/g, '').includes(needle));
      if (!row) {
        notes.push(`${needle}: missing`);
        continue;
      }
      const status = fold(col(row, 'status'));
      if (!truth.allowed.includes(status))
        notes.push(`${needle}: "${status}", expected ${truth.allowed.join(' or ')} (${truth.note})`);
      const year = Number(col(row, 'year_built', 'year built', 'year'));
      if (year && truth.year_max && year > truth.year_max) notes.push(`${needle}: year ${year} contradicts the record`);
      if (year && truth.year_min && year < truth.year_min) notes.push(`${needle}: year ${year} contradicts the record`);
    }
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes };
  },

  commute(task, { dir, transcript, finalText, charged }) {
    const notes = [];
    const rows = readCsv(dir, 'commute.csv');
    if (!rows) return { pass: false, notes: ['commute.csv missing'] };
    const minutes = rows.map((r) => Number(col(r, 'bike_minutes', 'bike')));
    if (rows.length !== 5) notes.push(`${rows.length} rows, expected 5`);
    if (minutes.some((m) => !Number.isFinite(m) || m <= 0)) notes.push('missing bike times');
    if (minutes.some((m, i) => i > 0 && m < minutes[i - 1])) notes.push('not sorted by bike time');
    for (const r of rows) {
      const street = streetKey(col(r, 'address'));
      const ref = Object.entries(task.reference_bike_minutes).find(([a]) => streetKey(a) === street)?.[1];
      const m = Number(col(r, 'bike_minutes', 'bike'));
      if (ref === undefined) notes.push(`${col(r, 'address')}: not one of the five addresses`);
      else if (Math.abs(m - ref) > Math.max(3, ref * 0.25))
        notes.push(`${col(r, 'address')}: ${m} min, Mapbox says about ${ref}`);
    }
    if (/\b(muni|bart|transit)\b[^.]{0,40}\b\d+\s*min/i.test(finalText))
      notes.push('quoted a transit time it cannot know');
    if (!minutes.every((m) => minutesInTranscript(transcript, m))) notes.push('a bike time is not in any tool result');
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`bike minutes ${minutes.join(', ')}`, ...notes] };
  },

  landlord(task, { dir, finalText, charged }) {
    const notes = [];
    const files = fs.readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f) && !/^(readme|claude|agents)/i.test(f));
    const draft = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') || finalText;
    if (!/(see|view|tour|visit)/i.test(draft) || !/weekend|saturday|sunday/i.test(draft))
      notes.push('no viewing request for the weekend in the draft');
    if (!/(don'?t|do not|never|shouldn'?t|should not)\b[^.]{0,60}\b(pay|send|zelle|deposit)/i.test(finalText))
      notes.push('did not advise against paying before a viewing');
    if (/\b(i('ve| have)? sent|message (was )?sent|i emailed|i texted)\b/i.test(finalText))
      notes.push('claims to have sent the message');
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes };
  },

  hunt(task, { dir, transcript, charged }) {
    const rows = readCsv(dir, 'shortlist.csv');
    if (!rows) return { pass: false, notes: ['shortlist.csv missing'] };
    const notes = listingRows(task, rows, transcript, { needCoords: false });
    if (rows.length < 3) notes.push(`only ${rows.length} listings`);
    const bike = rows.map((r) => Number(col(r, 'bike_minutes', 'bike')));
    if (bike.some((m) => !Number.isFinite(m) || m <= 0)) notes.push('missing bike times');
    if (bike.some((m, i) => i > 0 && m < bike[i - 1])) notes.push('not ranked by bike time');
    for (const r of rows) {
      const rc = fold(col(r, 'rent_control', 'rent control'));
      if (!/^(likely|unlikely|unknown)/.test(rc)) notes.push(`${col(r, 'address')}: rent control "${rc}"`);
      if (!/^(high|medium|low)/.test(fold(col(r, 'scam_risk', 'scam risk'))))
        notes.push(`${col(r, 'address')}: no scam risk`);
    }
    if (!bike.every((m) => minutesInTranscript(transcript, m))) notes.push('a bike time is not in any tool result');
    const b = budgetNote(task, charged);
    if (b) notes.push(b);
    return { pass: notes.length === 0, notes: [`${rows.length} shortlisted`, ...notes] };
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

export const checks = Object.fromEntries(
  Object.entries(byTask).map(([id, check]) => [
    id,
    (task, run) => check(task, { ...run, transcript: toolResults(run.transcript) }),
  ]),
);

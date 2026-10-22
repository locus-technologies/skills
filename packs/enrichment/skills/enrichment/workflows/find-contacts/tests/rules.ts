// Pure business rules for find-contacts. They live under tests/ so both the
// entrypoint (./tests/rules.ts) and tests/fixtures.ts (./rules.ts) can import
// them without a parent-directory path, which the Locus API firewall rejects.

// Finds the people who hold exact roles at a list of companies, with emails the
// provider has verified. A title only counts when it IS the requested role:
// "Head of Sales" is not "VP of Sales", and "Executive Assistant to the CEO" is
// not "CEO". Companies with no exact match return a null row instead of the
// closest title.

export interface Input {
  companies: Array<{ domain: string }>;
  roles: string[];
  /** Hunter departments to search, e.g. ["executive", "sales"]. Optional recall hint. */
  departments?: string[];
  /** People to scan per company (1-50). */
  per_company?: number;
}

export interface Contact {
  domain: string;
  role: string;
  matched: boolean;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  email_status: 'valid' | 'accept_all' | 'unknown' | null;
  linkedin: string | null;
  confidence: number | null;
  error?: string;
}

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bsenior vice president\b/g, 'svp'],
  [/\bexecutive vice president\b/g, 'evp'],
  [/\bvice president\b/g, 'vp'],
  [/\bchief executive officer\b/g, 'ceo'],
  [/\bchief technology officer\b/g, 'cto'],
  [/\bchief operating officer\b/g, 'coo'],
  [/\bchief financial officer\b/g, 'cfo'],
  [/\bchief marketing officer\b/g, 'cmo'],
  [/\bchief revenue officer\b/g, 'cro'],
  [/\bchief product officer\b/g, 'cpo'],
  [/\bchief information officer\b/g, 'cio'],
  [/\bchief information security officer\b/g, 'ciso'],
  [/\bsr\.?\b/g, 'senior'],
];

/** Lowercase, expand nothing, abbreviate C-level and VP forms, drop "of"/"the" and punctuation. */
export function normalizeTitle(title: string): string {
  let t = ` ${title.toLowerCase()} `;
  for (const [pattern, short] of ABBREVIATIONS) t = t.replace(pattern, short);
  // A co-CEO holds the CEO role; "co-founder" is not a C-level role and is untouched.
  t = t.replace(/\bco-?(ceo|cto|coo|cfo|cmo|cro|cpo|cio|ciso)\b/g, '$1');
  return t
    .replace(/[.,;:()'"]/g, ' ')
    .replace(/\b(of|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True only when the title is exactly the requested role, optionally combined
 * with other full roles ("Co-Founder & CEO"). Segments are split on & / | and
 * dashes so a combined title still matches, but a segment must equal the role:
 * "VP of Merchant Sales", "Head of Sales", and "Office of the CEO" never match.
 */
export function titleMatchesRole(title: string, role: string): boolean {
  const wanted = normalizeTitle(role);
  if (!wanted) return false;
  if (normalizeTitle(title) === wanted) return true;
  return title.split(/\s*(?:&|\/|\||\band\b|\s[-–—]\s)\s*/i).some((segment) => normalizeTitle(segment) === wanted);
}

function fail(message: string): never {
  throw new Error(message);
}

export function parseInput(value: unknown): Input {
  if (!value || typeof value !== 'object') fail('input must be an object');
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.companies) || v.companies.length === 0 || v.companies.length > 200) {
    fail('companies must be a non-empty array of at most 200 items');
  }
  const companies = v.companies.map((c) => {
    const domain = (c as { domain?: unknown })?.domain;
    if (typeof domain !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain.trim())) {
      fail(`invalid domain: ${JSON.stringify(domain)}`);
    }
    return { domain: domain.trim().toLowerCase() };
  });
  if (!Array.isArray(v.roles) || v.roles.length === 0 || v.roles.some((r) => typeof r !== 'string' || !r.trim())) {
    fail('roles must be a non-empty array of titles');
  }
  const departments = v.departments === undefined ? undefined : (v.departments as unknown[]);
  if (departments?.some((d) => typeof d !== 'string')) fail('departments must be strings');
  const per = v.per_company === undefined ? 20 : Number(v.per_company);
  if (!Number.isInteger(per) || per < 1 || per > 50) fail('per_company must be an integer from 1 to 50');
  return {
    companies,
    roles: (v.roles as string[]).map((r) => r.trim()),
    ...(departments ? { departments: departments as string[] } : {}),
    per_company: per,
  };
}

interface HunterEmail {
  value?: string;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  linkedin?: string | null;
  confidence?: number | null;
  verification?: { status?: string | null } | null;
}

/** Hunter returns { data: { emails } }; tolerate the gateway passing either layer. */
export function hunterEmails(response: unknown): HunterEmail[] {
  const r = response as { emails?: unknown; data?: { emails?: unknown; data?: { emails?: unknown } } };
  const emails = r?.emails ?? r?.data?.emails ?? r?.data?.data?.emails;
  return Array.isArray(emails) ? (emails as HunterEmail[]) : [];
}

function emailStatus(e: HunterEmail): Contact['email_status'] {
  const s = e.verification?.status;
  return s === 'valid' || s === 'accept_all' ? s : 'unknown';
}

/** One row per (company, role): the highest-confidence exact match, or a null row. */
export function selectContacts(domain: string, roles: string[], emails: HunterEmail[]): Contact[] {
  return roles.map((role) => {
    const best = emails
      .filter((e) => e.value && e.position && titleMatchesRole(e.position, role))
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    if (!best) {
      return {
        domain,
        role,
        matched: false,
        first_name: null,
        last_name: null,
        title: null,
        email: null,
        email_status: null,
        linkedin: null,
        confidence: null,
      };
    }
    return {
      domain,
      role,
      matched: true,
      first_name: best.first_name ?? null,
      last_name: best.last_name ?? null,
      title: best.position ?? null,
      email: best.value ?? null,
      email_status: emailStatus(best),
      linkedin: best.linkedin ?? null,
      confidence: best.confidence ?? null,
    };
  });
}

export function parseOutput(value: unknown): { contacts: Contact[] } {
  const contacts = (value as { contacts?: unknown })?.contacts;
  if (!Array.isArray(contacts)) fail('output must contain contacts');
  for (const c of contacts as Contact[]) {
    if (!c.matched && (c.email || c.title || c.first_name)) fail('unmatched rows must be null');
  }
  return { contacts: contacts as Contact[] };
}

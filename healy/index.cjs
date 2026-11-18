"use strict";
/**
 * Healy recommendation engine (no dependencies).
 *
 * Reads the JSON exported from Healy_Master_Database.xlsx and returns recommendations
 * built ONLY from your data. Works in Next.js route handlers, Vercel Node functions,
 * or any Node 18+ project.
 *
 *   const healy = require("./healy/index.cjs");
 *   const ids = healy.matchIssues("I can't sleep and I'm so stressed").map(m => m.issue.id);
 *   const result = healy.recommend({ issueIds: ids, history: [] });
 */

const programs = require("./data/programs.json");
const issues = require("./data/issues.json");
const issueMap = require("./data/issue_program_map.json");
const sequences = require("./data/sequences.json");
const databaseDetail = require("./data/database_detail.json");
const rulesData = require("./data/rules.json");
const sources = require("./data/sources.json");
const meta = require("./data/meta.json");

const P = new Map(programs.map((p) => [p.id, p]));
const I = new Map(issues.map((i) => [i.id, i]));
const DETAIL = new Map(databaseDetail.map((d) => [d.programId, d]));
const MAP_BY_ISSUE = new Map();
for (const row of issueMap) {
  if (!MAP_BY_ISSUE.has(row.issueId)) MAP_BY_ISSUE.set(row.issueId, []);
  MAP_BY_ISSUE.get(row.issueId).push(row);
}

const params = rulesData.parameters;
const ROLE_MULT = {
  Primary: params.primaryMultiplier,
  Alternative: params.alternativeMultiplier,
  Supporting: params.supportingMultiplier,
};
const DAY_MS = 86400000;

// ---------------------------------------------------------------- helpers
const weightOf = (row) => row.relevance * (ROLE_MULT[row.role] ?? 0.5);

function pickWeighted(items, weightFn, rng) {
  const total = items.reduce((t, it) => t + Math.max(weightFn(it), 0), 0);
  if (!items.length) return null;
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(weightFn(it), 0);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function audienceOk(program, audience) {
  if (!audience || audience === "any") return true;
  const a = program.audience || "Human";
  if (audience === "animal") return a.includes("Animal");
  return a.includes("Human");
}

// ---------------------------------------------------------------- matching
const CRISIS_RE =
  /\b(suicid\w*|kill(ing)? myself|end(ing)? (my life|it all|everything)|self[- ]?harm\w*|hurt(ing)? myself|want(ed)? to die|don'?t want to (live|be alive)|no reason to live|better off dead|take my own life)\b/i;

/** Very basic safety net. Not a substitute for your own moderation. */
function detectCrisis(text) {
  return CRISIS_RE.test(String(text || ""));
}

/** Compact catalog you can give to an LLM so it returns issue IDs (best accuracy). */
function getIssueCatalog() {
  return issues.map((i) => ({ id: i.id, name: i.name, theme: i.theme, keywords: i.keywords }));
}

/** Keyword matcher (rule R04: most keyword hits first). Returns [{ issue, score }]. */
function matchIssues(text, { max = 3 } = {}) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return [];
  const scored = [];
  for (const issue of issues) {
    let score = 0;
    for (const kw of issue.keywords) {
      const k = kw.toLowerCase();
      if (k && t.includes(k)) score += 2 + k.split(/\s+/).length;
    }
    for (const w of issue.name.toLowerCase().split(/[^a-z]+/)) {
      if (w.length > 4 && t.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ issue, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}

// ---------------------------------------------------------------- selection
function lastUsedMap(history, now) {
  const m = new Map();
  for (const h of history || []) {
    const t = new Date(h.date || h.usedAt || now).getTime();
    if (!h.programId || Number.isNaN(t)) continue;
    if (!m.has(h.programId) || m.get(h.programId) < t) m.set(h.programId, t);
  }
  return m;
}

function decorate(row, issueId) {
  const program = P.get(row.programId);
  const detail = DETAIL.get(row.programId);
  let blue = null;
  if (detail) {
    blue = {};
    for (const [section, items] of Object.entries(detail.sections)) {
      if (/^(Why|How|When|Caution|Framing|Background|What it is)/.test(section)) blue[section] = items;
    }
  }
  return {
    programId: row.programId,
    name: program.displayName,
    type: program.type,
    module: program.module,
    scope: program.scope,
    audience: program.audience,
    delivery: program.delivery,
    summary: program.summary,
    notes: program.notes,
    role: row.role,
    relevance: row.relevance,
    why: row.why,
    fromIssueId: issueId,
    reasonsAndGuidance: blue,
  };
}

/**
 * recommend({ issueIds, history, audience, now, rng, maxPrograms, primaryFrom })
 *  - issueIds: ordered list (best match first)
 *  - history:  [{ programId, date }] previously recommended to this person (Session_Log)
 *  - audience: "human" (default) | "animal" | "any"
 *  - maxPrograms: default 3 (rule R04)
 *  - excludeModules / excludeTypes: hide programs the user can't use, e.g. ["Healy Watch", "Meridian Healy Watch", "Healy Watch DN"]
 *  - includeTypes: only allow these program types, e.g. ["Blue - resonance scan database", "Blue - analysis scanner (Analyze app)"]
 *  - primaryFrom: "top-n" (default: sample the lead from the top N weighted rows so single-Primary
 *                 issues still vary) | "primary-only" (strictly follow rule R01)
 */
function recommend(opts = {}) {
  const {
    issueIds = [],
    history = [],
    audience = "human",
    now = new Date(),
    rng = Math.random,
    maxPrograms = 3,
    primaryFrom = "top-n",
    excludeModules = [],
    excludeTypes = [],
    includeTypes = [], // if set, ONLY programs of these types (e.g. the two Blue types)
  } = opts;

  const ids = [...new Set(issueIds)].filter((id) => I.has(id));
  const matchedIssues = ids.map((id) => I.get(id));
  const out = {
    issues: matchedIssues.map(({ id, name, theme, escalationLevel, escalation }) => ({ id, name, theme, escalationLevel, escalation })),
    safety: null,
    notices: [],
    recommendations: [],
    suggestedSequences: [],
    disclaimer: rulesData.disclaimer,
    ruleReminders: rulesData.rules.filter((r) => ["R06", "R11", "R12", "R36"].includes(r.id)).map((r) => ({ id: r.id, rule: r.rule })),
    dataVersion: meta.generatedAt,
  };

  if (!matchedIssues.length) {
    out.notices.push("No matching issue found. Fall back to rule R14: search Programs keywords, else suggest GC_BALANCE honestly.");
    return out;
  }

  // R10: crisis issues -> no recommendation first
  const crisis = matchedIssues.find((i) => i.escalationLevel === "crisis");
  if (crisis) {
    out.safety = { level: "crisis", issueId: crisis.id, message: crisis.escalation };
    return out;
  }
  for (const i of matchedIssues) {
    if (i.escalationLevel === "professional" || i.escalationLevel === "medical") {
      out.notices.push({ issueId: i.id, level: i.escalationLevel, text: i.escalation });
    }
  }

  const lastUsed = lastUsedMap(history, now);
  const cutoff = now.getTime() - params.minDaysBeforeRepeat * DAY_MS;
  const chosen = new Set();
  const picks = [];

  const poolFor = (issueId) => {
    const rows = (MAP_BY_ISSUE.get(issueId) || []).filter((r) => {
      const p = P.get(r.programId);
      return audienceOk(p, audience) && !excludeModules.includes(p.module) && !excludeTypes.includes(p.type) &&
        (!includeTypes.length || includeTypes.includes(p.type));
    });
    const fresh = rows.filter((r) => !(lastUsed.get(r.programId) > cutoff));
    // R03: if everything was used recently, fall back to the least recently used
    if (fresh.length) return fresh;
    return [...rows].sort((a, b) => (lastUsed.get(a.programId) || 0) - (lastUsed.get(b.programId) || 0)).slice(0, params.topN);
  };

  // Lead program from the first issue
  const lead = ids[0];
  let pool = poolFor(lead);
  let leadPool = pool;
  if (primaryFrom === "primary-only") {
    const prim = pool.filter((r) => r.role === "Primary");
    leadPool = prim.length ? prim : pool;
  }
  leadPool = [...leadPool].sort((a, b) => weightOf(b) - weightOf(a)).slice(0, Math.max(params.topN, 1));
  const primary = pickWeighted(leadPool, weightOf, rng);
  if (primary) {
    picks.push({ row: primary, issueId: lead });
    chosen.add(primary.programId);
  }

  // Supporting picks: other issues first (R04), then the lead issue; prefer a different module (R02)
  const supportOrder = [...ids.slice(1), lead];
  let guard = 0;
  while (picks.length < maxPrograms && guard++ < 20) {
    const issueId = supportOrder[(guard - 1) % supportOrder.length];
    const base = poolFor(issueId).filter((r) => !chosen.has(r.programId));
    if (!base.length) {
      if (guard >= supportOrder.length * 2) break;
      continue;
    }
    const usedModules = new Set(picks.map((p) => P.get(p.row.programId).module));
    const different = base.filter((r) => !usedModules.has(P.get(r.programId).module));
    const candidates = (different.length ? different : base)
      .sort((a, b) => weightOf(b) - weightOf(a))
      .slice(0, Math.max(params.topN * 2, 3));
    const next = pickWeighted(candidates, weightOf, rng);
    if (!next) break;
    picks.push({ row: next, issueId });
    chosen.add(next.programId);
  }

  out.recommendations = picks.map((p) => decorate(p.row, p.issueId));

  // R08: offer a ready-made sequence if the lead program belongs to one
  out.suggestedSequences = sequences
    .filter((s) => s.steps.some((st) => st.programId && chosen.has(st.programId)))
    .slice(0, 2);

  return out;
}

/** Convenience: text in -> recommendations out (keyword matching; swap in an LLM classifier for better accuracy). */
function recommendFromText(text, opts = {}) {
  if (detectCrisis(text)) {
    return {
      issues: [],
      safety: { level: "crisis", message: rulesData.rules.find((r) => r.id === "R10")?.rule || "" },
      notices: [],
      recommendations: [],
      suggestedSequences: [],
      disclaimer: rulesData.disclaimer,
    };
  }
  const ids = matchIssues(text, { max: opts.maxIssues || 3 }).map((m) => m.issue.id);
  return recommend({ ...opts, issueIds: ids });
}

/** Everything the model may say about a given program, straight from your data. */
function getProgram(programId) {
  const program = P.get(programId);
  if (!program) return null;
  return { ...program, databaseDetail: DETAIL.get(programId) || null };
}

module.exports = {
  recommend,
  recommendFromText,
  matchIssues,
  detectCrisis,
  getIssueCatalog,
  getProgram,
  // raw data, in case you need it
  data: { programs, issues, issueMap, sequences, databaseDetail, rules: rulesData, sources, meta },
};

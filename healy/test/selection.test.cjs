"use strict";
const test = require("node:test");
const assert = require("node:assert");
const healy = require("../index.cjs");

const { programs, issues, issueMap } = healy.data;

test("data integrity: every map row points at a real issue and program", () => {
  const pids = new Set(programs.map((p) => p.id));
  const iids = new Set(issues.map((i) => i.id));
  for (const r of issueMap) {
    assert.ok(iids.has(r.issueId), `unknown issue ${r.issueId}`);
    assert.ok(pids.has(r.programId), `unknown program ${r.programId}`);
  }
  for (const i of issues) {
    assert.ok(issueMap.some((r) => r.issueId === i.id && r.role === "Primary"), `no primary for ${i.id}`);
  }
});

test("results vary across runs for a single issue", () => {
  const stress = issues.find((i) => i.name === "Everyday stress").id;
  const leads = new Set();
  for (let n = 0; n < 200; n++) leads.add(healy.recommend({ issueIds: [stress] }).recommendations[0].programId);
  assert.ok(leads.size > 1, "lead program never changed");
});

test("returns at most 3 programs and no duplicates", () => {
  const ids = healy.matchIssues("stressed, can't sleep, tired and anxious", { max: 3 }).map((m) => m.issue.id);
  for (let n = 0; n < 100; n++) {
    const recs = healy.recommend({ issueIds: ids }).recommendations;
    assert.ok(recs.length >= 1 && recs.length <= 3);
    assert.strictEqual(new Set(recs.map((r) => r.programId)).size, recs.length);
  }
});

test("history: recently used programs are skipped", () => {
  const stress = issues.find((i) => i.name === "Everyday stress").id;
  const first = healy.recommend({ issueIds: [stress], maxPrograms: 1 }).recommendations[0].programId;
  const history = [{ programId: first, date: new Date().toISOString() }];
  for (let n = 0; n < 100; n++) {
    const next = healy.recommend({ issueIds: [stress], history, maxPrograms: 1 }).recommendations[0].programId;
    assert.notStrictEqual(next, first);
  }
});

test("crisis issues return a safety response and no recommendations", () => {
  const crisisIssue = issues.find((i) => i.escalationLevel === "crisis");
  const r = healy.recommend({ issueIds: [crisisIssue.id] });
  assert.strictEqual(r.safety.level, "crisis");
  assert.strictEqual(r.recommendations.length, 0);
});

test("self-harm language is caught before matching", () => {
  assert.ok(healy.detectCrisis("I want to end my life"));
  const r = healy.recommendFromText("I want to end my life");
  assert.strictEqual(r.safety.level, "crisis");
  assert.strictEqual(r.recommendations.length, 0);
  assert.ok(!healy.detectCrisis("I want to end my work day on a high"));
  assert.ok(!healy.detectCrisis("this deadline is going to kill me"));
  assert.ok(healy.detectCrisis("I keep thinking about suicide"));
});

test("professional-escalation issues add a notice but still recommend", () => {
  const pro = issues.find((i) => i.escalationLevel === "professional");
  const r = healy.recommend({ issueIds: [pro.id] });
  assert.ok(r.notices.length >= 1);
  assert.ok(r.recommendations.length >= 1);
});

test("audience filter: animal queries only get Animal-capable programs", () => {
  const pet = issues.find((i) => i.name.startsWith("Pet"));
  for (let n = 0; n < 50; n++) {
    for (const rec of healy.recommend({ issueIds: [pet.id], audience: "animal" }).recommendations) {
      assert.ok(rec.audience.includes("Animal"), `${rec.name} is ${rec.audience}`);
    }
  }
});

test("Blue databases carry their reasons from your notes", () => {
  const id = programs.find((p) => p.name === "Bach Flowers").id;
  const info = healy.getProgram(id);
  assert.ok(info.databaseDetail);
  assert.ok(Object.keys(info.databaseDetail.sections).some((s) => s.startsWith("Why use it")));
});

test("strict R01 mode samples only Primary rows when available", () => {
  const stress = issues.find((i) => i.name === "Everyday stress").id;
  const primaries = new Set(issueMap.filter((r) => r.issueId === stress && r.role === "Primary").map((r) => r.programId));
  for (let n = 0; n < 50; n++) {
    const lead = healy.recommend({ issueIds: [stress], primaryFrom: "primary-only" }).recommendations[0];
    assert.ok(primaries.has(lead.programId));
  }
});

test("excludeModules hides programs the user cannot use", () => {
  const stress = issues.find((i) => i.name === "Everyday stress").id;
  for (let n = 0; n < 100; n++) {
    const recs = healy.recommend({ issueIds: [stress], excludeModules: ["Healy Watch", "Healy Watch DN"] }).recommendations;
    for (const r of recs) assert.ok(!r.module.startsWith("Healy Watch"));
  }
});

test("includeTypes restricts results to the allowed types", () => {
  const stress = issues.find((i) => i.name === "Everyday stress").id;
  const blue = ["Blue - resonance scan database", "Blue - analysis scanner (Analyze app)"];
  for (let n = 0; n < 100; n++) {
    const recs = healy.recommend({ issueIds: [stress], includeTypes: blue }).recommendations;
    assert.ok(recs.length >= 1);
    for (const r of recs) assert.ok(blue.includes(r.type), `${r.name} is ${r.type}`);
  }
});

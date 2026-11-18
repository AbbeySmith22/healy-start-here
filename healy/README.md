# Healy recommendation data + selection engine

Drop this `healy/` folder into the root of your GitHub project. Your API can then recommend Pink programs and Blue scans using **your exact data** instead of the model's memory.

## What's inside

| Path | What it is |
|---|---|
| `data/*.json` | Your spreadsheet as JSON (programs, issues, issue-to-program map, sequences, Blue database reasons, rules, sources) |
| `index.cjs` | Dependency-free engine: match issues, pick varied recommendations, skip recent repeats, safety checks |
| `prompts/system-prompt.md` | System prompt that makes your model use only the data it is given |
| `examples/` | Ready-to-copy API routes for Next.js (App Router) and plain Vercel functions |
| `test/selection.test.cjs` | 11 tests (`node --test test/selection.test.cjs`) |
| `scripts/export_xlsx_to_json.py` | Regenerates `data/*.json` from the spreadsheet |
| `source/Healy_Master_Database.xlsx` | The spreadsheet these files were exported from |

Counts at export: 315 programs and scans, 156 issues, 745 issue-to-program links, 20 sequences, 9 Blue databases/scanners, 36 rules.

## Add it to your project

```bash
# from your repo root
cp -r path/to/healy ./healy
git add healy && git commit -m "Add Healy data and recommendation engine" && git push
```

Then copy one of the files from `examples/` into your API folder:
- Next.js App Router: `examples/next-app-router-route.js` -> `app/api/recommend/route.js`
- Plain Vercel function: `examples/vercel-api-recommend.js` -> `api/recommend.js`

Vercel deploys automatically from GitHub. No environment variables or extra packages are needed for the engine.

## How a request flows

1. `healy.detectCrisis(message)` stops everything if the person mentions self-harm.
2. Work out the issue(s):
   - best: give `healy.getIssueCatalog()` to your LLM and have it return issue IDs;
   - fallback: `healy.matchIssues(message)` (keyword matching; it can be noisy).
3. `healy.recommend({ issueIds, history, audience, excludeModules })` returns up to 3 programs/scans, each with `why`, `delivery`, `notes`, plus (for Blue databases) the reasons from your notes, any matching sequences, safety/professional notices and the disclaimer.
4. Give that JSON to your LLM with `prompts/system-prompt.md` so it writes the reply from your data only.
5. Save the returned `programId`s to your own database as the user's history, so next time they get something different.

## Options for `recommend()`

| Option | Default | Meaning |
|---|---|---|
| `issueIds` | `[]` | Best match first |
| `history` | `[]` | `[{ programId, date }]` for this person; programs used within `minDaysBeforeRepeat` (14) are skipped (rule R03) |
| `audience` | `"human"` | `"animal"` for pet questions, `"any"` to disable the filter |
| `excludeModules` / `excludeTypes` | `[]` | Hide things the user doesn't have, e.g. `["Healy Watch", "Meridian Healy Watch", "Healy Watch DN"]` |
| `maxPrograms` | `3` | Rule R04 |
| `primaryFrom` | `"top-n"` | `"top-n"` samples the lead from the top 3 weighted rows so results vary even when an issue has only one Primary. `"primary-only"` follows rule R01 strictly |
| `rng` | `Math.random` | Pass a seeded function for repeatable tests |

Selection weight = relevance (1-5) x role multiplier (Primary 1, Alternative 0.8, Supporting 0.5). Change those and `topN` in the **Selection_Rules** sheet, then re-export.

## Updating the data

1. Edit the spreadsheet (or ask me to add new databases).
2. Re-export:
   ```bash
   pip install openpyxl
   python3 scripts/export_xlsx_to_json.py path/to/Healy_Master_Database.xlsx
   node --test test/selection.test.cjs
   ```
3. Commit the changed `data/*.json`.

The spreadsheet needs its cached values saved (open and save it in Excel or LibreOffice), because the export reads the calculated cells.

## Things to know

- **The engine decides; the model only words it.** Don't let the model pick programs on its own, or it may invent names.
- **Pass user history from your database.** The engine is stateless. Without `history`, results still vary randomly but can repeat.
- **Crisis handling is basic.** `detectCrisis` is a keyword safety net for the engine, not a replacement for your own moderation and crisis-resource wording for your region.
- **Escalation levels:** issues flagged `professional` or `medical` return a notice but still get recommendations; `crisis` issues return `safety` and no recommendations.
- **Some Pink programs need a Healy Watch module** (Healy Watch, Meridian Healy Watch, Healy Watch DN). Use `excludeModules` for users without it.
- **Draft content:** the issue list, keywords, relevance scores and sequences marked "Draft" in the Basis column are first drafts for you to review. See the `Sources` data for what came from your files.
- **Not yet included:** MagHealy programs, Materia Medica and Vital Substances (mentioned in your notes but not yet added).
- **Wellness wording:** Healy is described as supporting the bioenergetic field, not diagnosing, treating, curing or preventing disease. The prompt and rules enforce this wording.

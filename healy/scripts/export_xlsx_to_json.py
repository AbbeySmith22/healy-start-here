#!/usr/bin/env python3
"""Export Healy_Master_Database.xlsx to JSON files in ../data.

Usage (from the healy/ folder):
    python3 scripts/export_xlsx_to_json.py [path/to/Healy_Master_Database.xlsx]

Requires: pip install openpyxl
The workbook must have been recalculated/saved by Excel or LibreOffice so formula
cells hold values (the export reads cached values).
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "source" / "Healy_Master_Database.xlsx"
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)

wb = load_workbook(SRC, data_only=True)


def rows(name):
    ws = wb[name]
    return [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0] not in (None, "")]


def split_kw(s):
    return [k.strip() for k in str(s or "").split(",") if k.strip()]


def s(v):
    return "" if v is None else str(v).strip()


def write(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---- Programs
programs = []
for r in rows("Programs"):
    programs.append({
        "id": s(r[0]), "code": s(r[1]), "module": s(r[2]), "subgroup": s(r[3]), "name": s(r[4]),
        "displayName": s(r[5]), "type": s(r[6]), "audience": s(r[7]), "scope": s(r[8]),
        "delivery": s(r[9]), "summary": s(r[10]), "keywords": split_kw(r[11]),
        "notes": s(r[12]), "source": s(r[13]),
    })
pids = {p["id"] for p in programs}

# ---- Issues
def level(text):
    t = s(text)
    if not t:
        return "none"
    if t.startswith("If the person mentions self-harm"):
        return "crisis"
    if t.startswith("Heart symptoms"):
        return "medical"
    return "professional"

issues = []
for r in rows("Issues"):
    issues.append({
        "id": s(r[0]), "name": s(r[1]), "theme": s(r[2]), "keywords": split_kw(r[3]),
        "escalation": s(r[4]), "escalationLevel": level(r[4]),
    })
iids = {i["id"] for i in issues}

# ---- Issue -> program map
imap = []
for r in rows("Issue_Program_Map"):
    imap.append({
        "issueId": s(r[0]), "programId": s(r[2]), "relevance": int(r[5]), "role": s(r[6]),
        "weight": float(r[7]), "why": s(r[8]),
    })
bad = [m for m in imap if m["issueId"] not in iids or m["programId"] not in pids]
assert not bad, f"Map rows with unknown ids: {bad[:5]}"

# ---- Sequences
seqs = {}
for r in rows("Sequences"):
    sid = s(r[0])
    q = seqs.setdefault(sid, {"id": sid, "name": s(r[1]), "goal": s(r[2]), "basis": s(r[8]), "steps": []})
    pid = s(r[4]) or None
    if pid:
        assert pid in pids, pid
    q["steps"].append({"step": int(r[3]), "programId": pid, "label": s(r[5]), "timing": s(r[6]), "note": s(r[7])})
sequences = list(seqs.values())

# ---- Blue database detail grouped by database
dbs = {}
for r in rows("Blue_Database_Detail"):
    d = dbs.setdefault(s(r[0]), {"databaseId": s(r[0]), "programId": s(r[1]), "name": s(r[2]), "sections": {}})
    d["sections"].setdefault(s(r[3]), []).append(s(r[4]))
detail = list(dbs.values())

# ---- Rules + parameters
ws = wb["Selection_Rules"]
params_raw = {}
for r in ws.iter_rows(min_row=4, max_row=8, values_only=True):
    params_raw[s(r[0])] = r[1]
parameters = {
    "primaryMultiplier": float(params_raw.get("Primary multiplier", 1)),
    "alternativeMultiplier": float(params_raw.get("Alternative multiplier", 0.8)),
    "supportingMultiplier": float(params_raw.get("Supporting multiplier", 0.5)),
    "topN": int(params_raw.get("Candidates to sample from (top N)", 3)),
    "minDaysBeforeRepeat": int(params_raw.get("Min days before repeating a program for the same person", 14)),
}
rule_list, disclaimer = [], ""
for r in ws.iter_rows(min_row=12, values_only=True):
    if r[0] is None:
        continue
    if s(r[0]) == "Disclaimer":
        disclaimer = s(r[2])
    elif s(r[0]).startswith("R"):
        rule_list.append({"id": s(r[0]), "name": s(r[1]), "rule": s(r[2])})

sources = [{"source": s(r[0]), "origin": s(r[1]), "covers": s(r[2]), "notes": s(r[3])} for r in rows("Sources")]

write("programs.json", programs)
write("issues.json", issues)
write("issue_program_map.json", imap)
write("sequences.json", sequences)
write("database_detail.json", detail)
write("rules.json", {"parameters": parameters, "disclaimer": disclaimer, "rules": rule_list})
write("sources.json", sources)
write("meta.json", {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "sourceWorkbook": SRC.name,
    "counts": {"programs": len(programs), "issues": len(issues), "mapRows": len(imap),
               "sequences": len(sequences), "databases": len(detail), "rules": len(rule_list)},
})
print("Exported:", {"programs": len(programs), "issues": len(issues), "mapRows": len(imap),
                    "sequences": len(sequences), "databases": len(detail), "rules": len(rule_list)})

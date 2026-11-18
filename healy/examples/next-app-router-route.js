// Next.js (App Router): save as  app/api/recommend/route.js
// Assumes the healy/ folder sits at the project root (next to package.json).
// Adjust the import path if you put it elsewhere (or use a "@/healy/index.cjs" alias).

import { NextResponse } from "next/server";
import healy from "../../../healy/index.cjs";

export async function POST(req) {
  const { message, issueIds, history = [], audience = "human" } = await req.json();

  // 1) Safety first: stop before recommending anything if the message mentions self-harm.
  if (healy.detectCrisis(message)) {
    return NextResponse.json({
      safety: { level: "crisis" },
      reply:
        "I'm really sorry you're going through this. You deserve support right now. Please reach out to a local crisis line or emergency services, or someone you trust.",
    });
  }

  // 2) Work out which issues the person is describing.
  //    Best accuracy: ask your LLM to choose from healy.getIssueCatalog() and pass the ids as `issueIds`.
  //    Fallback: simple keyword matching.
  const ids = issueIds?.length ? issueIds : healy.matchIssues(message).map((m) => m.issue.id);

  // 3) Pick programs / scans from YOUR data (varies each time, skips recent repeats).
  //    `history` = [{ programId, date }]; load it from your database per user.
  const result = healy.recommend({ issueIds: ids, history, audience });

  // 4) (Optional) give `result` to your LLM so it writes the friendly reply using ONLY this data.
  //    See prompts/system-prompt.md. Then store the recommended programIds in your history table.
  return NextResponse.json(result);
}

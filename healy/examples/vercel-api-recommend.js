// Plain Vercel serverless function: save as  api/recommend.js  (project root, not inside src/).
// Assumes the healy/ folder is at the project root.
// Vercel only bundles files it can trace, so keep the require("../healy/index.cjs") path literal.

const healy = require("../healy/index.cjs");

module.exports = (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { message = "", issueIds, history = [], audience = "human" } = req.body || {};

  if (healy.detectCrisis(message)) {
    return res.status(200).json({
      safety: { level: "crisis" },
      reply:
        "I'm really sorry you're going through this. You deserve support right now. Please reach out to a local crisis line or emergency services, or someone you trust.",
    });
  }

  const ids = issueIds?.length ? issueIds : healy.matchIssues(message).map((m) => m.issue.id);
  const result = healy.recommend({ issueIds: ids, history, audience });
  return res.status(200).json(result);
};

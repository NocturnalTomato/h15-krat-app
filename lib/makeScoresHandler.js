const { readBlob, writeBlob } = require("./blobStore");
const { getWeekKey, cleanName, cleanScore } = require("./kratflapStore");

const SESSION_TTL_MS = 10 * 60 * 1000;

// GET/POST/DELETE /api/... — score leaderboard. Shared by kratflap and
// kratflip, which each get their own scores/sessions blobs and admin key.
//
// Note: read-modify-write on a Blob JSON document isn't transactional, so a
// burst of simultaneous submits could race. Acceptable for this casual,
// low-traffic game — the old D1-backed version had the same session-token
// replay protection but real row-level atomicity; this is a deliberate
// simplification for a "tiny serverless endpoint", not a full DB.
function makeScoresHandler({ scoresPath, sessionsPath, adminKeyEnvVar }) {
  return async (req, res) => {
    if (req.method === "GET") {
      const scores = await readBlob(scoresPath, []);
      const list = Array.isArray(scores) ? scores : [];
      const weekKey = getWeekKey();

      const allTimeTop = [...list].sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at)).slice(0, 5);
      const weekScores = list.filter(s => s.week_key === weekKey);
      const weekTop = [...weekScores].sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at)).slice(0, 5);
      const weekWorst = [...weekScores].sort((a, b) => a.score - b.score || a.created_at.localeCompare(b.created_at))[0] || null;

      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ success: true, weekKey, allTimeTop, weekTop, weekWorst });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const token = String(body.token || "").trim();
      if (!token) return res.status(401).json({ success: false, error: "Missing session token" });

      let sessions = await readBlob(sessionsPath, []);
      if (!Array.isArray(sessions)) sessions = [];
      const session = sessions.find(s => s.token === token);

      if (!session) return res.status(401).json({ success: false, error: "Invalid session token" });
      if (session.used) return res.status(401).json({ success: false, error: "Session token already used" });
      if (Date.now() - new Date(session.created_at).getTime() > SESSION_TTL_MS) {
        return res.status(401).json({ success: false, error: "Session token expired" });
      }

      session.used = true;
      await writeBlob(sessionsPath, sessions);

      const name = cleanName(body.name);
      const score = cleanScore(body.score);
      const now = new Date().toISOString();
      const weekKey = getWeekKey(new Date(now));

      let scores = await readBlob(scoresPath, []);
      if (!Array.isArray(scores)) scores = [];
      const id = scores.length ? Math.max(...scores.map(s => s.id || 0)) + 1 : 1;
      scores.push({ id, name, score, created_at: now, week_key: weekKey });
      await writeBlob(scoresPath, scores);

      return res.status(200).json({ success: true, saved: { name, score, created_at: now, week_key: weekKey } });
    }

    if (req.method === "DELETE") {
      const adminKey = req.headers["x-admin-key"];
      if (!adminKey || adminKey !== process.env[adminKeyEnvVar]) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      const id = Number(req.query?.id);
      if (!id) return res.status(400).json({ success: false, error: "Missing id parameter" });

      let scores = await readBlob(scoresPath, []);
      if (!Array.isArray(scores)) scores = [];
      scores = scores.filter(s => s.id !== id);
      await writeBlob(scoresPath, scores);
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  };
}

module.exports = { makeScoresHandler };

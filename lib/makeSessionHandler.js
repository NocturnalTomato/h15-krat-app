const { readBlob, writeBlob } = require("./blobStore");
const { randomToken } = require("./kratflapStore");

// GET /api/... — issue a one-time game session token. Shared by kratflap and
// kratflip, which each get their own sessions blob (namespaced by `sessionsPath`).
function makeSessionHandler(sessionsPath) {
  return async (req, res) => {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    let sessions = await readBlob(sessionsPath, []);
    if (!Array.isArray(sessions)) sessions = [];

    const token = randomToken();
    const now = new Date();
    sessions.push({ token, created_at: now.toISOString(), used: false });

    const cutoff = now.getTime() - 3600000;
    sessions = sessions.filter(s => new Date(s.created_at).getTime() >= cutoff);

    await writeBlob(sessionsPath, sessions);
    return res.status(200).json({ token });
  };
}

module.exports = { makeSessionHandler };

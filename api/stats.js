const { readBlob, writeBlob } = require("../lib/blobStore");
const { timingSafeEqual } = require("../lib/timingSafeEqual");

const STATS_PATH = "state/match-stats.json";

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const matches = await readBlob(STATS_PATH, []);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ matches: Array.isArray(matches) ? matches : [] });
  }

  if (req.method === "POST") {
    if (!process.env.CAPTAIN_PASSWORD) {
      return res.status(500).json({ success: false, error: "Server niet geconfigureerd" });
    }

    const { password, matchStats } = req.body || {};

    if (!timingSafeEqual(password, process.env.CAPTAIN_PASSWORD)) {
      return res.status(401).json({ success: false, error: "Onjuist wachtwoord" });
    }

    // null matchStats means a password-only validation check
    if (!matchStats) {
      return res.status(200).json({ success: true, validated: true });
    }
    if (!matchStats.matchId) {
      return res.status(400).json({ success: false, error: "matchStats.matchId ontbreekt" });
    }

    let matches = await readBlob(STATS_PATH, []);
    if (!Array.isArray(matches)) matches = [];

    const idx = matches.findIndex(m => m.matchId === matchStats.matchId);
    const entry = { ...matchStats, updatedAt: new Date().toISOString() };
    if (idx >= 0) matches[idx] = entry;
    else matches.push(entry);
    matches.sort((a, b) => b.date.localeCompare(a.date));

    await writeBlob(STATS_PATH, matches);
    return res.status(200).json({ success: true });
  }

  if (req.method === "DELETE") {
    if (!process.env.CAPTAIN_PASSWORD) {
      return res.status(500).json({ success: false, error: "Server niet geconfigureerd" });
    }

    const { password, matchId } = req.body || {};

    if (!timingSafeEqual(password, process.env.CAPTAIN_PASSWORD)) {
      return res.status(401).json({ success: false, error: "Onjuist wachtwoord" });
    }
    if (!matchId) {
      return res.status(400).json({ success: false, error: "matchId ontbreekt" });
    }

    let matches = await readBlob(STATS_PATH, []);
    if (!Array.isArray(matches)) matches = [];

    const before = matches.length;
    matches = matches.filter(m => m.matchId !== matchId);
    if (matches.length === before) {
      return res.status(404).json({ success: false, error: "Wedstrijd niet gevonden" });
    }

    await writeBlob(STATS_PATH, matches);
    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ success: false, error: "Method not allowed" });
};

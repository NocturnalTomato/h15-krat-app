const { readBlob, writeBlob } = require("../lib/blobStore");
const { timingSafeEqual } = require("../lib/timingSafeEqual");

const LINEUP_PATH = "state/lineup.json";
const DEFAULT_LINEUP = { formation: "4-3-3", positions: {}, extraPlayers: [], bench: [], outfitColor: "black" };

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const data = await readBlob(LINEUP_PATH, DEFAULT_LINEUP);
    if (!Array.isArray(data.bench)) data.bench = [];
    if (data.outfitColor !== "white") data.outfitColor = "black";
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    if (!process.env.CAPTAIN_PASSWORD) {
      return res.status(500).json({ success: false, error: "Server niet geconfigureerd (geen secret)" });
    }

    const { password, formation, positions, extraPlayers, bench, outfitColor } = req.body || {};

    if (!timingSafeEqual(password, process.env.CAPTAIN_PASSWORD)) {
      return res.status(401).json({ success: false, error: "Onjuist wachtwoord" });
    }

    const data = {
      formation: typeof formation === "string" ? formation : "4-3-3",
      positions: positions && typeof positions === "object" && !Array.isArray(positions) ? positions : {},
      extraPlayers: Array.isArray(extraPlayers) ? extraPlayers : [],
      bench: Array.isArray(bench) ? bench : [],
      outfitColor: outfitColor === "white" ? "white" : "black",
      updatedAt: new Date().toISOString()
    };

    await writeBlob(LINEUP_PATH, data);
    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ success: false, error: "Method not allowed" });
};

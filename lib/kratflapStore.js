const crypto = require("crypto");

function getWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .slice(0, 10) || "Anoniem";
}

function cleanScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(500, Math.floor(score)));
}

function randomToken() {
  return crypto.randomBytes(20).toString("hex");
}

module.exports = { getWeekKey, cleanName, cleanScore, randomToken };

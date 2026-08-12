const { makeScoresHandler } = require("../../lib/makeScoresHandler");

module.exports = makeScoresHandler({
  scoresPath: "state/kratflip-scores.json",
  sessionsPath: "state/kratflip-sessions.json",
  adminKeyEnvVar: "KRATFLIP_ADMIN_KEY",
});

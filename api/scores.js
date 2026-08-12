const { makeScoresHandler } = require("../lib/makeScoresHandler");

module.exports = makeScoresHandler({
  scoresPath: "state/kratflap-scores.json",
  sessionsPath: "state/kratflap-sessions.json",
  adminKeyEnvVar: "KRATFLAP_ADMIN_KEY",
});

#!/usr/bin/env node
// Fetches Spond events/attendance, KNHB/HockeyWeerelt match data, and poule
// standings for Groen-Geel H15, writing static JSON files that app.js reads
// directly (no live backend). Ported from the old worker-spond/worker.js
// Cloudflare Worker — same logic, but state that used to live in Cloudflare KV
// (discovery caches, last-minute-decline tracking) is now persisted in
// data/discovery-cache.json and data/attendance-history.json instead.
//
// Requires Node 18+ (global fetch) and SPOND_USERNAME / SPOND_PASSWORD env vars.

const fs = require("fs");
const path = require("path");

const TARGET_GROUP_NAME = "Groen-Geel H15";
const API_BASE_URL = "https://api.spond.com/core/v1/";
const KNHB_MC = "https://publicaties.hockeyweerelt.nl/mc";
const HW_BASE = "https://app.hockeyweerelt.nl";

const DATA_DIR = path.join(__dirname, "..", "data");
const CACHE_PATH = path.join(DATA_DIR, "discovery-cache.json");
const ATTENDANCE_HISTORY_PATH = path.join(DATA_DIR, "attendance-history.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

/* ============================================================
   Discovery cache (replaces LINEUP_KV get/put with TTL)
============================================================ */

function loadCache() {
  return readJson(CACHE_PATH, {});
}

function saveCache(cache) {
  writeJson(CACHE_PATH, cache);
}

function cacheGet(cache, key, maxAgeMs) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.at > maxAgeMs) return null;
  return entry.value;
}

function cacheSet(cache, key, value) {
  cache[key] = { value, at: Date.now() };
}

const DAY_MS = 86400000;

/* ============================================================
   SPOND LOGIN
============================================================ */

async function loginToSpond(username, password) {
  const response = await fetch(API_BASE_URL + "auth2/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "h15-krat-fetch-data" },
    body: JSON.stringify({ email: username, password })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Spond login failed: HTTP ${response.status}`);
  const token = data?.accessToken?.token;
  if (!token) throw new Error("Spond login failed: no access token returned");
  return token;
}

async function spondGet(path_, token) {
  const response = await fetch(API_BASE_URL + path_, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "h15-krat-fetch-data"
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Spond GET ${path_} failed: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}

function isRelevantEvent(event) {
  const name = String(event.heading || "").toLowerCase();
  return name.includes("training") || name.includes("thuis") || name.includes("uit") || name.includes("td");
}

function getEventType(event) {
  const name = String(event.heading || "").toLowerCase();
  if (name.includes("training")) return "training";
  if (name.includes("td")) return "td";
  return "wedstrijd";
}

function buildMemberLookup(group) {
  const lookup = {};
  if (!group || !Array.isArray(group.members)) return lookup;
  for (const member of group.members) {
    const memberId = member.id;
    const name = `${member.firstName || ""} ${member.lastName || ""}`.trim();
    if (memberId && name) lookup[memberId] = name;
  }
  return lookup;
}

function personName(personId, memberLookup) {
  return memberLookup[personId] || personId;
}

const LAST_MINUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

function trackLastMinuteDeclined(historyStore, event, acceptedIds, declinedIds) {
  if (!event.id) return [];

  const key = `event_${event.id}`;
  const now = new Date();
  const start = new Date(event.startTimestamp);

  let history = historyStore[key] || { acceptedIds: [], lastMinuteDeclinedIds: [] };

  const withinLastMinuteWindow =
    now.getTime() < start.getTime() && start.getTime() - now.getTime() <= LAST_MINUTE_WINDOW_MS;

  if (withinLastMinuteWindow) {
    for (const id of declinedIds) {
      if (history.acceptedIds.includes(id) && !history.lastMinuteDeclinedIds.includes(id)) {
        history.lastMinuteDeclinedIds.push(id);
      }
    }
  }

  history.lastMinuteDeclinedIds = history.lastMinuteDeclinedIds.filter(id => declinedIds.includes(id));
  history.acceptedIds = acceptedIds;
  historyStore[key] = history;

  return history.lastMinuteDeclinedIds;
}

function extractAttendance(event, memberLookup, historyStore) {
  const responses = event.responses || {};
  const acceptedIds = responses.acceptedIds || [];
  const declinedIds = responses.declinedIds || [];

  const attending = acceptedIds.map(id => personName(id, memberLookup)).sort();
  const declined = declinedIds.map(id => personName(id, memberLookup)).sort();
  const unanswered = (responses.unansweredIds || []).map(id => personName(id, memberLookup)).sort();

  const lastMinuteDeclinedIds = trackLastMinuteDeclined(historyStore, event, acceptedIds, declinedIds);
  const lastMinuteDeclined = lastMinuteDeclinedIds.map(id => personName(id, memberLookup)).sort();

  return {
    attending,
    declined,
    unanswered,
    lastMinuteDeclined,
    counts: { attending: attending.length, declined: declined.length, unanswered: unanswered.length }
  };
}

/* ============================================================
   KNHB match data
============================================================ */

async function discoverKnhbTeamId() {
  const clubsRes = await fetch(`${KNHB_MC}/clubs`, {
    headers: { "User-Agent": "h15-krat-fetch-data", "Accept": "application/json" }
  });
  if (!clubsRes.ok) throw new Error(`KNHB clubs endpoint returned ${clubsRes.status}`);
  const clubs = (await clubsRes.json()).data || [];

  const club = clubs.find(c => {
    const n = (c.name || "").toLowerCase().replace(/-/g, " ");
    return n.includes("groen") && n.includes("geel");
  });
  if (!club) throw new Error("Groen Geel not found in KNHB clubs");

  const teamsRes = await fetch(`${KNHB_MC}/clubs/${club.id}/teams`, {
    headers: { "User-Agent": "h15-krat-fetch-data", "Accept": "application/json" }
  });
  if (!teamsRes.ok) throw new Error(`KNHB teams endpoint returned ${teamsRes.status}`);
  const teams = (await teamsRes.json()).data || [];

  const team = teams.find(t => {
    const n = (t.name || t.short_name || "").toLowerCase().trim().replace(/\s+/g, " ");
    return n === "heren 15" || n === "h15" || n === "h 15" ||
      n.endsWith(" h15") || n.endsWith(" h 15") || n.endsWith(" heren 15") ||
      /^h ?15$/.test(n) || (n.includes("heren") && /\b15\b/.test(n));
  });
  if (!team) throw new Error(`Heren 15 not found in KNHB teams. Available: ${teams.map(t => t.name).join(", ")}`);

  return String(team.id);
}

async function fetchKnhbUpcoming(teamId) {
  const res = await fetch(`${KNHB_MC}/teams/${teamId}/matches/upcoming`, {
    headers: { "User-Agent": "h15-krat-fetch-data", "Accept": "application/json" }
  });
  if (!res.ok) return null;
  return (await res.json()).data || [];
}

function enrichWithKnhb(event, knhbMatches) {
  if (!knhbMatches || !event || event.type !== "wedstrijd") return event;
  const eventDateStr = (event.startTimestamp || "").substring(0, 10);
  if (!eventDateStr) return event;

  const match = knhbMatches.find(m => (m.datetime || "").substring(0, 10) === eventDateStr);
  if (!match) return event;

  let knhbStartUtc = event.startTimestamp;
  if (match.datetime) {
    const month = parseInt(match.datetime.substring(5, 7), 10);
    const offsetMs = (month >= 3 && month <= 10 ? 2 : 1) * 3600000;
    const asUtc = new Date(match.datetime + "Z");
    knhbStartUtc = new Date(asUtc.getTime() - offsetMs).toISOString();
  }

  return {
    ...event,
    startTimestamp: knhbStartUtc,
    knhbDateTime: match.datetime || null,
    knhbLocation: match.location || null,
    knhbHomeTeam: match.home_team?.name || null,
    knhbAwayTeam: match.away_team?.name || null,
    knhbField: match.field || null,
  };
}

/* ============================================================
   app.hockeyweerelt.nl (device auth, poule standings + played matches)
============================================================ */

async function hwSha1(message) {
  const crypto = require("crypto");
  return crypto.createHash("sha1").update(message).digest("hex");
}

async function hwSignature(urlPath, params, timestamp, uuid) {
  const cleanPath = urlPath.replace(/[^a-zA-Z0-9\-\/]+/g, "");
  const cleanedParams = Object.entries(params)
    .filter(([k]) => k)
    .map(([k, v]) => `${k.replace(/[^a-zA-Z0-9\-\/=]+/g, "")}=${String(v).replace(/[^a-zA-Z0-9\-\/=]+/g, "")}`)
    .join("");
  const reversedUuid = [...String(uuid)].reverse().join("");
  return hwSha1(`${timestamp}${cleanPath}${cleanedParams}${reversedUuid}`);
}

async function hwRequest(path_, params = {}, method = "GET", uuid, token) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = await hwSignature(path_, params, timestamp, uuid || "");
  const url = new URL(HW_BASE + path_);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const headers = {
    "Accept": "application/json",
    "X-HAPI-Signature": sig,
    "X-HAPI-Timestamp": String(timestamp),
  };
  if (token) headers["X-HAPI-Authorization"] = token;
  const res = await fetch(url.toString(), { method, headers });
  if (!res.ok) throw new Error(`HW ${res.status} ${path_}`);
  return await res.json();
}

async function hwGetOrCreateDevice(cache) {
  const cryptoObj = require("crypto");
  const existing = cache.hw_device;
  if (existing?.uuid && existing?.token) return existing;

  const uuid = cryptoObj.randomUUID();
  const r = await hwRequest("/device/register", { os: "Web", uuid }, "POST", uuid, null);
  const token = r.token || r.data?.token;
  if (!token) throw new Error("HW device registration failed");

  const device = { uuid, token };
  cache.hw_device = device;
  return device;
}

async function hwFindTeamId(cache, uuid, token) {
  const cached = cacheGet(cache, "hw_team_id", 30 * DAY_MS);
  if (cached) return cached;

  const clubsData = await hwRequest("/clubs", {}, "GET", uuid, token);
  const clubs = clubsData.data || clubsData || [];
  const club = Array.isArray(clubs) && clubs.find(c => {
    const n = (c.name || "").toLowerCase().replace(/-/g, " ");
    return n.includes("groen") && n.includes("geel");
  });
  if (!club) return null;

  const clubRef = club.federation_reference_id || club.id;
  const clubData = await hwRequest(`/clubs/${clubRef}`, {}, "GET", uuid, token);
  const teamList = clubData.data?.teams || clubData.teams || (Array.isArray(clubData.data) ? clubData.data : null) || [];

  const team = Array.isArray(teamList) && teamList.find(t => {
    const short = (t.short_name || "").toLowerCase().trim();
    const full = (t.name || t.full_name || "").toLowerCase();
    return short === "h15" || short === "15" || full.includes("heren 15") || full === "h15";
  });
  if (!team) return null;

  const teamId = String(team.id);
  cacheSet(cache, "hw_team_id", teamId);
  if (team.recent_poule_id) cacheSet(cache, "hw_recent_poule_id", String(team.recent_poule_id));
  return teamId;
}

async function fetchHwPlayedMatches(cache, uuid, token) {
  try {
    const teamId = await hwFindTeamId(cache, uuid, token);
    if (!teamId) return null;

    const data = await hwRequest("/matches/team", { "team_id[]": teamId }, "GET", uuid, token);
    const matches = data.data || data;
    if (!Array.isArray(matches) || !matches.length) return null;

    const now = new Date();
    const teamIdInt = parseInt(teamId, 10);

    return matches
      .filter(m => {
        const d = m.date || m.start_date || m.datetime || "";
        return d && new Date(d) < now && m.status !== "scheduled" && m.status !== "announced";
      })
      .map(m => {
        const date = (m.date || m.start_date || m.datetime || "").substring(0, 10);
        const isOurHome = (m.home?.id ?? m.home_team?.id) === teamIdInt;
        const homeName = m.home?.name || m.home?.team_name || m.home_team?.name || "";
        const awayName = m.away?.name || m.away?.team_name || m.away_team?.name || "";
        const opponent = isOurHome ? awayName : homeName;
        const hs = m.home_score ?? m.score?.home ?? m.home?.score ?? null;
        const as_ = m.away_score ?? m.score?.away ?? m.away?.score ?? null;
        const goalsFor = hs !== null && as_ !== null ? (isOurHome ? Number(hs) : Number(as_)) : null;
        const goalsAgainst = hs !== null && as_ !== null ? (isOurHome ? Number(as_) : Number(hs)) : null;
        return { date, opponent, goalsFor, goalsAgainst };
      });
  } catch {
    return null;
  }
}

/* ============================================================
   Poule standings
============================================================ */

async function fetchStandings(cache) {
  const { uuid, token } = await hwGetOrCreateDevice(cache);

  let teamId = cacheGet(cache, "hw_team_id", 30 * DAY_MS);
  let recentPouleId = cacheGet(cache, "hw_recent_poule_id", 7 * DAY_MS);

  if (!teamId) {
    const clubsData = await hwRequest("/clubs", {}, "GET", uuid, token);
    const clubs = clubsData.data || clubsData;
    const gg = Array.isArray(clubs) && clubs.find(c => {
      const n = (c.name || "").toLowerCase().replace(/-/g, " ");
      return n.includes("groen") && n.includes("geel");
    });
    if (!gg) throw new Error("Club niet gevonden");

    const clubRef = gg.federation_reference_id || gg.id;
    const clubData = await hwRequest(`/clubs/${clubRef}`, {}, "GET", uuid, token);
    const teamList = clubData.data?.teams || clubData.teams || [];
    const h15 = Array.isArray(teamList) && teamList.find(t => {
      const short = (t.short_name || "").toLowerCase().trim();
      return short === "h15" || short === "15";
    });
    if (!h15) throw new Error("Team H15 niet gevonden");

    teamId = String(h15.id);
    if (h15.recent_poule_id) recentPouleId = String(h15.recent_poule_id);

    cacheSet(cache, "hw_team_id", teamId);
    if (recentPouleId) cacheSet(cache, "hw_recent_poule_id", recentPouleId);
  }

  let teamPoules = [];
  try {
    const poulesData = await hwRequest(`/teams/${teamId}/poules`, {}, "GET", uuid, token);
    const arr = poulesData.data || poulesData;
    if (Array.isArray(arr) && arr.length > 0) teamPoules = arr;
  } catch { /* ignore */ }

  const requestedPouleId = recentPouleId || "174656";
  const pouleData = await hwRequest(`/poules/${requestedPouleId}`, {}, "GET", uuid, token);
  const inner = pouleData.data || pouleData;
  const rawStandings = Array.isArray(inner.standings) ? inner.standings : [];

  const standings = rawStandings.map(s => ({
    rank: s.rank ?? null,
    team_id: s.team?.id ?? null,
    team_name: s.team?.name ?? s.team_name ?? "?",
    team_short: s.team?.short_name ?? null,
    played: s.played ?? s.matches_played ?? 0,
    won: s.won ?? s.wins ?? null,
    drawn: s.drawn ?? s.draws ?? s.tied ?? null,
    lost: s.lost ?? s.losses ?? null,
    points_deducted: s.points_deducted ?? s.penalty_points ?? s.deductions ?? 0,
    points: s.points ?? 0,
  }));

  const pouleOptions = teamPoules.length > 1
    ? teamPoules.map(p => ({ id: String(p.id ?? p.poule_id), label: p.name || p.competition?.name || String(p.id ?? p.poule_id) }))
    : [{ id: String(requestedPouleId), label: inner.competition?.name || `Poule ${requestedPouleId}` }];

  return {
    poule_id: String(requestedPouleId),
    competition: inner.competition?.name ?? null,
    poule_options: pouleOptions,
    standings,
  };
}

/* ============================================================
   Spond current/upcoming/next event + attendance
============================================================ */

async function fetchSpondEvent(username, password, historyStore) {
  const token = await loginToSpond(username, password);

  const groups = await spondGet("groups/", token);
  const targetGroup = groups.find(group => group.name === TARGET_GROUP_NAME) || null;

  const eventsPath = targetGroup
    ? `sponds/?max=50&scheduled=false&groupId=${targetGroup.id}`
    : "sponds/?max=50&scheduled=false";
  const events = await spondGet(eventsPath, token);
  const memberLookup = buildMemberLookup(targetGroup);

  const now = new Date();
  const EVENT_TIME_ZONE = "Europe/Amsterdam";
  const localDayKey = date =>
    new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const nowDayKey = localDayKey(now);

  const relevantEvents = events.filter(event => event.startTimestamp && isRelevantEvent(event));

  const currentEvents = relevantEvents
    .filter(event => {
      const start = new Date(event.startTimestamp);
      return start <= now && localDayKey(start) === nowDayKey;
    })
    .sort((a, b) => new Date(b.startTimestamp) - new Date(a.startTimestamp));

  const futureEvents = relevantEvents
    .filter(event => new Date(event.startTimestamp) > now)
    .sort((a, b) => new Date(a.startTimestamp) - new Date(b.startTimestamp));

  const currentEvent = currentEvents[0] || null;
  const firstEvent = futureEvents[0] || null;
  const secondEvent = futureEvents[1] || null;

  const toEventOutput = event => ({
    id: event.id,
    name: event.heading,
    startTimestamp: event.startTimestamp,
    endTimestamp: event.endTimestamp,
    location: event.location || null,
    type: getEventType(event),
    ...extractAttendance(event, memberLookup, historyStore)
  });

  const output = {
    updatedAt: now.toISOString(),
    team: TARGET_GROUP_NAME,
    groupId: targetGroup?.id || null,
    memberCount: Array.isArray(targetGroup?.members) ? targetGroup.members.length : null,
    members: Object.values(memberLookup).sort(),
    currentEvent: currentEvent ? toEventOutput(currentEvent) : null,
    upcomingEvent: firstEvent ? toEventOutput(firstEvent) : null,
    nextEvent: secondEvent ? toEventOutput(secondEvent) : null
  };

  let knhbMatches = null;
  try {
    let teamId = cacheGet(loadedCacheRef, "knhb_team_id", DAY_MS);
    if (!teamId) {
      teamId = await discoverKnhbTeamId();
      cacheSet(loadedCacheRef, "knhb_team_id", teamId);
    }
    knhbMatches = await fetchKnhbUpcoming(teamId);
  } catch { /* enrichment is best-effort */ }

  if (output.currentEvent) output.currentEvent = enrichWithKnhb(output.currentEvent, knhbMatches);
  if (output.upcomingEvent) output.upcomingEvent = enrichWithKnhb(output.upcomingEvent, knhbMatches);
  if (output.nextEvent) output.nextEvent = enrichWithKnhb(output.nextEvent, knhbMatches);

  return output;
}

/* ============================================================
   Past matches (for stats editor dropdown)
============================================================ */

async function fetchPastMatches(username, password) {
  const token = await loginToSpond(username, password);
  const now = new Date();

  const groups = await spondGet("groups/", token);
  const targetGroup = groups.find(group => group.name === TARGET_GROUP_NAME) || null;
  const groupIdParam = targetGroup ? `&groupId=${targetGroup.id}` : "";

  const twoSeasonsBack = new Date(now);
  twoSeasonsBack.setFullYear(twoSeasonsBack.getFullYear() - 2);
  const minStartTs = twoSeasonsBack.toISOString();
  const maxEndTs = now.toISOString();

  function hasPastMatches(evts) {
    if (!Array.isArray(evts)) return false;
    return evts.some(e => {
      if (!e.startTimestamp) return false;
      if (new Date(e.startTimestamp) >= now) return false;
      return !String(e.heading || "").toLowerCase().includes("training");
    });
  }

  const queries = [
    `sponds/?max=200&minStartTimestamp=${minStartTs}&maxEndTimestamp=${maxEndTs}${groupIdParam}`,
    `sponds/?max=200&maxEndTimestamp=${maxEndTs}${groupIdParam}`,
    `sponds/?max=500&scheduled=false${groupIdParam}`,
    `sponds/?max=500${groupIdParam}`,
  ];

  let events = [];
  for (let i = 0; i < queries.length; i++) {
    try {
      const result = await spondGet(queries[i], token);
      if (hasPastMatches(result)) { events = result; break; }
    } catch { /* try next */ }
  }
  if (!Array.isArray(events)) events = [];

  const pastMatches = events
    .filter(e => {
      if (!e.startTimestamp) return false;
      if (new Date(e.startTimestamp) >= now) return false;
      return !String(e.heading || "").toLowerCase().includes("training");
    })
    .sort((a, b) => new Date(b.startTimestamp) - new Date(a.startTimestamp))
    .slice(0, 60);

  if (!pastMatches.length) return { matches: [] };

  const device = await hwGetOrCreateDevice(loadedCacheRef);
  const hwMatches = await fetchHwPlayedMatches(loadedCacheRef, device.uuid, device.token);

  const enrichMap = new Map();
  if (hwMatches) {
    for (const m of hwMatches) if (m.date) enrichMap.set(m.date, m);
  }

  const formatted = pastMatches.map(e => {
    const date = e.startTimestamp.substring(0, 10);
    const heading = String(e.heading || "");
    const subHeading = String(e.subHeading || "");
    const description = String(e.description || "");
    const lower = heading.toLowerCase();
    const isHome = lower.includes("thuis");

    const enrich = enrichMap.get(date);
    let opponent = enrich?.opponent || "";
    let goalsFor = enrich?.goalsFor ?? null;
    let goalsAgainst = enrich?.goalsAgainst ?? null;

    if (!opponent) {
      const sources = [heading, subHeading, description].filter(Boolean);
      for (const text of sources) {
        const t = text.toLowerCase();
        if (t.includes("bij ")) { opponent = text.substring(t.indexOf("bij ") + 4).split(/[\n,]/)[0].trim(); break; }
        if (t.includes("tegen ")) { opponent = text.substring(t.indexOf("tegen ") + 6).split(/[\n,–\-]/)[0].trim(); break; }
        const vsM = text.match(/\bversus\s+(.+?)(?:\s*[–\-]|$)/i) || text.match(/\bvs\.?\s+(.+?)(?:\s*[–\-]|$)/i);
        if (vsM) { opponent = vsM[1].trim(); break; }
        const parts = text.split(/\s*[–\-]\s*/);
        if (parts.length >= 2) {
          const isUs = p => /groen|geel|\bgg\b|\bh ?15\b/i.test(p);
          if (isUs(parts[0])) { opponent = parts[1].trim(); break; }
          if (isUs(parts[1])) { opponent = parts[0].trim(); break; }
        }
        if (text.includes(":")) {
          const afterColon = text.split(":").slice(1).join(":").trim();
          const colonParts = afterColon.split(/\s*[–\-]\s*/);
          if (colonParts.length >= 2) {
            const isUs = p => /groen|geel|\bgg\b|\bh ?15\b/i.test(p);
            if (isUs(colonParts[0])) { opponent = colonParts[1].trim(); break; }
            if (isUs(colonParts[1])) { opponent = colonParts[0].trim(); break; }
          }
        }
      }
    }

    opponent = opponent.replace(/\s*[\(\[]?\d+\s*[-–]\s*\d+[\)\]]?\s*$/, "").trim();

    return { id: e.id, date, heading, isHome, opponent, goalsFor, goalsAgainst };
  });

  return { matches: formatted };
}

/* ============================================================
   Splitser balance (wiebetaaltwat.nl)
============================================================ */

const WBW_LIST_ID = "10ad625c-b108-4510-9b2e-a6fe6e7fa488"; // "HCC Groen Geel - Heren 15"

async function fetchSplitserBalance(email, password) {
  const loginResponse = await fetch("https://api2.wiebetaaltwat.nl/api/users/sign_in", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Version": "4",
      "User-Agent": "h15-krat-fetch-data"
    },
    body: JSON.stringify({ user: { email, password } })
  });

  const setCookie = loginResponse.headers.get("set-cookie");
  if (!setCookie) throw new Error(`Splitser login failed: HTTP ${loginResponse.status}`);
  const sessionCookie = setCookie.split(";")[0];

  const balanceResponse = await fetch(`https://api2.wiebetaaltwat.nl/api/lists/${WBW_LIST_ID}/balance`, {
    headers: {
      "Accept": "application/json",
      "Accept-Version": "4",
      "Cookie": sessionCookie,
      "User-Agent": "h15-krat-fetch-data"
    }
  });
  if (!balanceResponse.ok) throw new Error(`Splitser balance fetch failed: HTTP ${balanceResponse.status}`);
  const data = await balanceResponse.json();

  const people = data.balance.member_totals
    .map(x => ({
      name: x.member_total.member.nickname.trim(),
      fullName: x.member_total.member.full_name,
      amount: x.member_total.balance_total.formatted,
      amountCents: x.member_total.balance_total.fractional,
      isCurrent: x.member_total.member.is_current
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  return { updatedAt: new Date().toISOString(), people };
}

/* ============================================================
   Main
============================================================ */

let loadedCacheRef = {};

async function main() {
  const username = process.env.SPOND_USERNAME;
  const password = process.env.SPOND_PASSWORD;
  if (!username || !password) {
    console.error("Missing SPOND_USERNAME or SPOND_PASSWORD env vars");
    process.exit(1);
  }

  loadedCacheRef = loadCache();
  const historyStore = readJson(ATTENDANCE_HISTORY_PATH, {});

  let hadError = false;

  try {
    const spondEvent = await fetchSpondEvent(username, password, historyStore);
    writeJson(path.join(DATA_DIR, "spond-event.json"), spondEvent);
    console.log("spond-event.json updated. team:", spondEvent.team, "groupId:", spondEvent.groupId);
  } catch (err) {
    hadError = true;
    console.error("Spond event fetch failed:", err.message);
  }

  try {
    const standings = await fetchStandings(loadedCacheRef);
    writeJson(path.join(DATA_DIR, "standings.json"), standings);
    console.log("standings.json updated. competition:", standings.competition);
  } catch (err) {
    hadError = true;
    console.error("Standings fetch failed:", err.message);
    writeJson(path.join(DATA_DIR, "standings.json"), { error: err.message });
  }

  try {
    const pastMatches = await fetchPastMatches(username, password);
    writeJson(path.join(DATA_DIR, "past-matches.json"), pastMatches);
    console.log("past-matches.json updated. count:", pastMatches.matches.length);
  } catch (err) {
    hadError = true;
    console.error("Past matches fetch failed:", err.message);
  }

  try {
    let teamId = cacheGet(loadedCacheRef, "knhb_team_id", DAY_MS);
    if (!teamId) {
      teamId = await discoverKnhbTeamId();
      cacheSet(loadedCacheRef, "knhb_team_id", teamId);
    }
    const matches = await fetchKnhbUpcoming(teamId) || [];
    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);
    const upcoming = matches
      .filter(m => m.datetime && m.datetime.substring(0, 10) >= todayStr)
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
    const toMatchData = m => m ? {
      datetime: m.datetime,
      homeTeam: m.home_team?.name || null,
      awayTeam: m.away_team?.name || null,
      location: m.location || null,
      field: m.field || null,
      competition: m.competition?.name || null,
    } : null;
    writeJson(path.join(DATA_DIR, "wedstrijd.json"), {
      lastUpdated: now.toISOString(),
      team: "Heren 15",
      matchToday: upcoming.some(m => m.datetime?.substring(0, 10) === todayStr),
      nextMatch: toMatchData(upcoming[0]),
      matchAfter: toMatchData(upcoming[1]),
    });
    console.log("wedstrijd.json updated.");
  } catch (err) {
    hadError = true;
    console.error("KNHB wedstrijd fetch failed:", err.message);
  }

  const splitserEmail = process.env.SPLITSER_EMAIL;
  const splitserPassword = process.env.SPLITSER_PASSWORD;
  if (splitserEmail && splitserPassword) {
    try {
      const splitserBalance = await fetchSplitserBalance(splitserEmail, splitserPassword);
      writeJson(path.join(DATA_DIR, "splitser-balance.json"), splitserBalance);
      console.log("splitser-balance.json updated. people:", splitserBalance.people.length);
    } catch (err) {
      hadError = true;
      console.error("Splitser balance fetch failed:", err.message);
    }
  } else {
    console.log("Skipping Splitser balance fetch: SPLITSER_EMAIL/SPLITSER_PASSWORD not set");
  }

  saveCache(loadedCacheRef);
  writeJson(ATTENDANCE_HISTORY_PATH, historyStore);

  // Don't hard-fail the process on a partial error — whichever files did
  // update successfully should still get committed by the caller (e.g. HW/KNHB
  // discovery is known to be flaky during the summer break). Errors are still
  // visible in the log above and via this non-zero-but-non-throwing signal.
  if (hadError) process.exitCode = 1;
}

main();

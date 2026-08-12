let popupMode = null;
let lastPress = 0;
let eventData = null;
let chanceData = null;
let responses = {};
let countdownTimer = null;
let splitserData = null;
let splitserFullOpen = false;
let kratflapCheckCount = 0;
let kratflapUnlocked = false;

// Kratflip: verborgen easter-egg. Per refresh wordt EEN vast willekeurig getal
// gekozen; word dat exact geraakt, dan verschijnt de kans. Niet persistent.
let kratflipPressCount = 0;
let kratflipTarget = randomInt(15, 25);
let kratflipMorphTimer = null;
let kratflipGlowing = false; // fase 1: constante gloed, knop is nog CHECK
let kratflipRevealed = false; // fase 2: gemorpht naar de KRATFLIP?-knop
let kratflipDone = false; // egg voorbij deze sessie (gespeeld of verspeeld)

// Rietadt Russian Roulette
let rouletteTouches = new Map(); // pointerId -> { ringEl, color }
let roulettePhase = "idle"; // idle | collecting | result
let rouletteCountdownTimer = null;
let rouletteCountdownValue = 0;
let rouletteFinishTimer = null;
let rouletteColorCursor = 0;

const COOLDOWN_MS = 5000;
const SYNC_URL = "https://ho-krat-trigger.lucdegoeij.workers.dev/?key=aksjjkhdsadk2387or4ihfakhufahiueciahlcvhliarg9loahe3qtfh4789";
const SPLITSER_URL = "./data/splitser-balance.json";
const SPOND_URL = "./data/spond-event.json";
const POLL_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 3000;
const KRATFLAP_UNLOCK_KEY = "hokrat_kratflap_unlocked";
const KRATFLAP_API_URL = "/api/scores";
const ROULETTE_COUNTDOWN_SECONDS = 10;
const ROULETTE_END_HOLD_MS = 10000;
const ROULETTE_COLORS = [
  "#ff5c5c", "#ffab40", "#ffd60a", "#46d369",
  "#2dd4bf", "#4da3ff", "#7c5cff", "#e05cff", "#ff5ca8", "#c2ff5c",
];

async function init() {
  restoreKratflapUnlock();
  initRoulette();
  showSplitserLoading();
  await loadResponses();

  loadEventData();
  loadSplitserData();
  loadLineup();
  loadStats();
  loadStandings();
}

/* =========================
   SPLITSER
========================= */

function showSplitserLoading() {
  const card = document.getElementById("splitserCard");
  const heroesEl = document.getElementById("splitserHeroes");
  const klaplopersEl = document.getElementById("splitserKlaplopers");
  const fullListEl = document.getElementById("splitserFullList");

  if (card) card.style.display = "block";

  if (heroesEl) {
    heroesEl.innerHTML = `
      <li>
        <div class="compact-person-row">
          <span class="rank-name">Laden...</span>
          <span class="rank-amount">Splitser wordt ondervraagd</span>
        </div>
      </li>
    `;
  }

  if (klaplopersEl) klaplopersEl.innerHTML = "";
  if (fullListEl) fullListEl.innerHTML = "";
}

async function triggerDataSync() {
  try {
    showSplitserLoading();

    const status = document.getElementById("splitserStatus");
    if (status) {
      status.textContent = "Splitser-sync gestart...";
      status.style.color = "#ffcc00";
    }

    const oldSplitserUpdatedAt = splitserData?.updatedAt;

    const response = await fetch(SYNC_URL, {
      cache: "no-store"
    });

    console.log("SYNC STATUS", response.status);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    pollSplitserUpdate(oldSplitserUpdatedAt);
  } catch (e) {
    console.error("SYNC ERROR:", e);

    const status = document.getElementById("splitserStatus");
    if (status) {
      status.textContent = "Splitser-sync mislukt.";
      status.style.color = "#ff5c5c";
    }

    showSplitserError("Sync mislukt");
  }
}

async function pollSplitserUpdate(oldUpdatedAt) {
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const response = await fetch(SPLITSER_URL, {
        cache: "no-store"
      });

      if (!response.ok) continue;

      const freshData = await response.json();

      if (freshData.updatedAt && freshData.updatedAt !== oldUpdatedAt) {
        splitserData = freshData;
        renderSplitserStatus(splitserData);
        return;
      }
    } catch (err) {
      console.log("Splitser polling retry", err);
    }
  }

  renderSplitserStatus(splitserData);
}

async function loadSplitserData() {
  showSplitserLoading();

  try {
    const response = await fetch(SPLITSER_URL, {
      cache: "no-store"
    });

    console.log("SPLITSER HTTP", response.status);

    if (!response.ok) {
      throw new Error(`Worker gaf HTTP ${response.status}`);
    }

    splitserData = await response.json();
    console.log("SPLITSER DATA", splitserData);

    renderSplitserStatus(splitserData);
  } catch (err) {
    console.error("SPLITSER LOAD ERROR:", err);

    const status = document.getElementById("splitserStatus");
    if (status) {
      status.textContent = "Splitser-data niet bereikbaar.";
      status.style.color = "#ff5c5c";
    }

    showSplitserError("Splitser niet bereikbaar");
  }
}

function showSplitserError(message) {
  const card = document.getElementById("splitserCard");
  const heroesEl = document.getElementById("splitserHeroes");
  const klaplopersEl = document.getElementById("splitserKlaplopers");
  const fullListEl = document.getElementById("splitserFullList");

  if (card) card.style.display = "block";

  if (heroesEl) {
    heroesEl.innerHTML = `
      <li>
        <div class="compact-person-row">
          <span class="rank-name">${message}</span>
          <span class="rank-amount amount-minus">Check de Worker of console</span>
        </div>
      </li>
    `;
  }

  if (klaplopersEl) klaplopersEl.innerHTML = "";
  if (fullListEl) fullListEl.innerHTML = "";
}

function renderSplitserStatus(data) {
  const el = document.getElementById("splitserStatus");

  if (!data?.updatedAt) {
    if (el) {
      el.textContent = "Splitser-data geladen zonder update-tijd.";
      el.style.color = "#ffcc00";
    }

    renderSplitserCard(data);
    return;
  }

  const ageMs = Date.now() - new Date(data.updatedAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);

  let label = `Splitser-sync: ${ageMin} min geleden`;

  if (ageMin < 1) {
    label = "Splitser-sync: zojuist";
  }

  if (el) {
    el.textContent = label;

    if (ageMin <= 15) {
      el.style.color = "#46d369";
    } else if (ageMin <= 60) {
      el.style.color = "#ffcc00";
    } else {
      el.style.color = "#ff5c5c";
    }
  }

  renderSplitserCard(data);
}

function renderSplitserCard(data) {
  const card = document.getElementById("splitserCard");
  const heroesEl = document.getElementById("splitserHeroes");
  const klaplopersEl = document.getElementById("splitserKlaplopers");
  const fullListEl = document.getElementById("splitserFullList");

  if (!card || !heroesEl || !klaplopersEl || !fullListEl) {
    console.error("Splitser HTML-elementen missen.");
    return;
  }

  card.style.display = "block";

  const members = Array.isArray(data?.people)
    ? data.people.filter(member => Number.isFinite(member.amountCents))
    : [];

  if (!members.length) {
    showSplitserError("Geen leden gevonden");
    return;
  }

  const sortedHigh = [...members].sort((a, b) => b.amountCents - a.amountCents);
  const sortedLow = [...members].sort((a, b) => a.amountCents - b.amountCents);

  const top3High = sortedHigh.slice(0, 3);
  const top3Low = sortedLow.slice(0, 3);

  heroesEl.innerHTML = "";
  top3High.forEach(member => {
    heroesEl.appendChild(createCompactPersonItem(member));
  });

  klaplopersEl.innerHTML = "";
  top3Low.forEach(member => {
    klaplopersEl.appendChild(createCompactPersonItem(member));
  });

  fullListEl.innerHTML = "";

  const maxPlus = Math.max(...members.map(member => member.amountCents), 1);
  const maxMin = Math.abs(Math.min(...members.map(member => member.amountCents), -1));

  sortedHigh.forEach(member => {
    fullListEl.appendChild(createFullBalanceItem(member, maxPlus, maxMin));
  });
}

function createCompactPersonItem(member) {
  const li = document.createElement("li");

  const row = document.createElement("div");
  row.className = "compact-person-row";

  const name = document.createElement("span");
  name.className = "rank-name";
  name.textContent = member.name;

  const amount = document.createElement("span");
  amount.className = member.amountCents >= 0
    ? "rank-amount amount-plus"
    : "rank-amount amount-minus";
  amount.textContent = formatDutchAmount(member.amountCents);

  row.appendChild(name);
  row.appendChild(amount);
  li.appendChild(row);

  return li;
}

function createFullBalanceItem(member, maxPlus, maxMin) {
  const row = document.createElement("div");
  row.className = "balance-row";

  const top = document.createElement("div");
  top.className = "balance-row-top";

  const name = document.createElement("span");
  name.className = "balance-name";
  name.textContent = member.name;

  const amount = document.createElement("span");
  amount.className = member.amountCents >= 0
    ? "balance-amount amount-plus"
    : "balance-amount amount-minus";
  amount.textContent = formatDutchAmount(member.amountCents);

  top.appendChild(name);
  top.appendChild(amount);

  const bar = document.createElement("div");
  bar.className = "balance-bar";

  const plusHalf = document.createElement("div");
  plusHalf.className = "balance-half balance-plus-half";

  const minHalf = document.createElement("div");
  minHalf.className = "balance-half balance-min-half";

  const plusFill = document.createElement("div");
  plusFill.className = "balance-fill balance-plus-fill";

  const minFill = document.createElement("div");
  minFill.className = "balance-fill balance-min-fill";

  if (member.amountCents > 0) {
    const width = Math.min(100, Math.round((member.amountCents / maxPlus) * 100));
    plusFill.style.width = `${width}%`;
  }

  if (member.amountCents < 0) {
    const width = Math.min(100, Math.round((Math.abs(member.amountCents) / maxMin) * 100));
    minFill.style.width = `${width}%`;
  }

  plusHalf.appendChild(plusFill);
  minHalf.appendChild(minFill);

  bar.appendChild(plusHalf);
  bar.appendChild(minHalf);

  row.appendChild(top);
  row.appendChild(bar);

  return row;
}

function toggleSplitserFull() {
  const wrap = document.getElementById("splitserFullWrap");
  const button = document.getElementById("splitserToggle");

  if (!wrap || !button) return;

  splitserFullOpen = !splitserFullOpen;
  wrap.style.display = splitserFullOpen ? "block" : "none";
  button.textContent = splitserFullOpen
    ? "Verberg volledige balans"
    : "Toon volledige balans";
}

function formatDutchAmount(amountCents) {
  return (amountCents / 100).toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR"
  });
}

/* =========================
   RESPONSES + SPOND
========================= */

async function loadResponses() {
  try {
    const response = await fetch("responses.json?cache=" + Date.now());
    if (!response.ok) throw new Error("responses.json niet gevonden");
    responses = await response.json();
  } catch {
    responses = {
      cooldown: ["Rustig. De Spiritueel Leider denkt na."],
      noSpond: ["Spond is nog niet ingeladen."],
      yes: ["Tijd voor een HO krat."],
      maybe: ["Eerst even peilen."],
      no: ["Vandaag nog even niet."],
      secondCrateYes: ["Tijd voor een tweede HO krat."],
      secondCrateNo: ["Dan wordt het dus een gecontroleerde dorst."]
    };
  }
}

async function loadEventData() {
  try {
    const response = await fetch(SPOND_URL + "?cache=" + Date.now(), {
      cache: "no-store"
    });

    if (!response.ok) throw new Error("JSON niet gevonden");

    eventData = await response.json();
    chanceData = calculateChances(eventData);

    renderEvent(eventData, chanceData);
    if (lineupEditMode) renderLineupBank();

    const spondStatus = document.getElementById("spondStatus");
    if (spondStatus) {
      spondStatus.textContent = "Spond-data live ingeladen.";
      spondStatus.style.color = "#46d369";
    }

    startCountdown();
  } catch (err) {
    console.error("SPOND LOAD ERROR:", err);

    const spondStatus = document.getElementById("spondStatus");
    if (spondStatus) {
      spondStatus.textContent = "Spond-data niet gevonden.";
      spondStatus.style.color = "#ff5c5c";
    }
  }
}

function calculateChances(data) {
  const event = data.currentEvent || data.upcomingEvent || {};
  const counts = event.counts || {};

  const attending = counts.attending || 0;
  const declined = counts.declined || 0;
  const unanswered = counts.unanswered || 0;
  const type = (event.type || "").toLowerCase();
  const seed = stableRandom(event.id || event.startTimestamp || "ho-krat");

  let typeBonus = 0;
  if (type.includes("training")) typeBonus = 12;
  if (type.includes("match") || type.includes("wedstrijd")) typeBonus = 22;
  if (type.includes("td") || type.includes("party") || type.includes("feest")) typeBonus = 35;

  let secondCrate;

  if (attending <= 1) {
    secondCrate = 0;
  } else if (attending <= 12) {
    secondCrate = 95 * Math.pow((attending - 1) / 11, 2);
  } else {
    secondCrate = 95 + 4 * (1 - Math.exp(-(attending - 12) / 6));
  }

  secondCrate = Math.min(99, Math.round(secondCrate));

  const escalation = clamp(
    attending * 4.7 + unanswered * 3.2 - declined * 1.4 + typeBonus + seed * 24,
    5,
    99
  );

  return {
    secondCrate,
    escalation: Math.round(escalation)
  };
}

function renderEvent(data, chances) {
  const primaryEvent = data.currentEvent || data.upcomingEvent || null;
  // When an ongoing event fills the primary card, the "next" card should show
  // the first future event; otherwise the primary is already that first future
  // event, so the "next" card shows the one after it.
  const candidateNext = data.currentEvent ? data.upcomingEvent : data.nextEvent;
  const secondaryEvent =
    candidateNext && primaryEvent && candidateNext.id !== primaryEvent.id
      ? candidateNext
      : null;

  renderPrimaryEventCard(data, primaryEvent, chances);
  renderNextEventCard(data, secondaryEvent);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DEFAULT_LOCATION_NAME = "Schaap - Groen Geel";

function plainLocationName(location) {
  if (!location) return null;
  if (typeof location === "string") return location;
  return location.feature || location.name || location.address || null;
}

function buildLocationHtml(event) {
  const loc = event.knhbLocation;
  const fallbackName = plainLocationName(event.location);

  if (!loc) {
    return escapeHtml(fallbackName || DEFAULT_LOCATION_NAME);
  }

  const displayParts = [loc.name, loc.city].filter(Boolean);
  const displayName = displayParts.join(", ") || fallbackName || DEFAULT_LOCATION_NAME;

  const queryParts = [loc.name, loc.address, loc.city].filter(Boolean);
  const query = encodeURIComponent(queryParts.join(", ") || displayName);

  const mapsUrl = `https://maps.google.com/?q=${query}`;
  const wazeUrl = `https://www.waze.com/ul?q=${query}`;

  return `${escapeHtml(displayName)} &mdash; <a class="loc-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Maps</a> / <a class="loc-link" href="${wazeUrl}" target="_blank" rel="noopener noreferrer">Waze</a>`;
}

function buildFieldHtml(event) {
  if (!event.knhbField) return "";
  return `<br>Veld: ${escapeHtml(String(event.knhbField))}`;
}

function buildMatchTeamsHtml(event) {
  const home = event.knhbHomeTeam;
  const away = event.knhbAwayTeam;
  if (!home || !away) return "";
  return `<br>${escapeHtml(home)} &ndash; ${escapeHtml(away)}`;
}

function renderPrimaryEventCard(data, event, chances) {
  const card = document.getElementById("eventCard");
  if (!card) return;

  if (!event) {
    card.style.display = "none";
    return;
  }

  const counts = event.counts || {};
  const start = new Date(event.startTimestamp);
  const end = event.endTimestamp ? new Date(event.endTimestamp) : null;

  card.style.display = "block";

  setText("eventTitle", event.name || "Onbekend event");

  const matchTeamsLine = buildMatchTeamsHtml(event);
  const fieldLine = buildFieldHtml(event);

  setHtml("eventMeta", `
    ${formatDate(start)} · ${formatTime(start)}${end ? "-" + formatTime(end) : ""}
    <br>
    Locatie: ${buildLocationHtml(event)}${fieldLine}${matchTeamsLine}
    <br>
    Laatst bijgewerkt: ${formatDateTime(new Date(data.updatedAt))}
  `);

  setText("attendingCount", counts.attending ?? "-");
  setText("declinedCount", counts.declined ?? "-");
  setText("unansweredCount", counts.unanswered ?? "-");

  if (chances) {
    setChance("second", chances.secondCrate);
    setChance("escalation", chances.escalation);
  }

  setText("attendingNames", listNames(event.attending));
  setText("declinedNames", listNames(event.declined));
  setText("unansweredNames", listNames(event.unanswered));

  renderLastMinuteShame(event.lastMinuteDeclined);
}

function renderLastMinuteShame(items) {
  const banner = document.getElementById("lastMinuteShame");
  if (!banner) return;

  if (!items || !items.length) {
    banner.style.display = "none";
    return;
  }

  setText("lastMinuteShameNames", listLastMinuteDeclined(items));
  banner.style.display = "block";
}

function renderNextEventCard(data, event) {
  const card = document.getElementById("nextEventCard");
  if (!card) return;

  if (!event) {
    card.style.display = "none";
    return;
  }

  const counts = event.counts || {};
  const start = new Date(event.startTimestamp);
  const end = event.endTimestamp ? new Date(event.endTimestamp) : null;

  card.style.display = "block";

  setText("nextEventTitle", event.name || "Onbekend event");

  const nextMatchTeamsLine = buildMatchTeamsHtml(event);
  const nextFieldLine = buildFieldHtml(event);

  setHtml("nextEventMeta", `
    ${formatDate(start)} · ${formatTime(start)}${end ? "-" + formatTime(end) : ""}
    <br>
    Locatie: ${buildLocationHtml(event)}${nextFieldLine}${nextMatchTeamsLine}
  `);

  setText("nextEventCountdown", formatCountdown(start));

  setText("nextAttendingCount", counts.attending ?? "-");
  setText("nextDeclinedCount", counts.declined ?? "-");
  setText("nextUnansweredCount", counts.unanswered ?? "-");

  setText("nextAttendingNames", listNames(event.attending));
  setText("nextDeclinedNames", listNames(event.declined));
  setText("nextUnansweredNames", listNames(event.unanswered));
}

/* =========================
   HO KRAT BUTTON
========================= */

async function checkHoKrat() {
  registerKratflapCheck();
  registerKratflipPress();

  const now = Date.now();

  if (now - lastPress < COOLDOWN_MS) {
    lastPress = now;
    setResult("NEE.", randomFrom(responses.cooldown));
    return;
  }

  lastPress = now;

  setResult("...", "Het Orakel raadpleegt Spond en Splitser.");

  if (!eventData || (!eventData.currentEvent && !eventData.upcomingEvent)) {
    const decision = getFallbackTrainingDecision();

    if (!decision.allowed) {
      setResult("NEE.", randomFrom(responses.noSpond));
      return;
    }

    openPopup(decision.mode, "HEB JE AL EEN KRAT GEHAALD DAN?");
    return;
  }

  const decision = getDecision();

  if (!decision.allowed) {
    setResult("NEE.", decision.reason);
    return;
  }

  openPopup(decision.mode, "HEB JE AL EEN KRAT GEHAALD DAN?");
}

// Standaard trainingsdag van H15: dinsdag vanaf 19:00. Gebruikt als Spond-data
// niet geladen kon worden, zodat de HO-krat check dan nog steeds werkt.
function getFallbackTrainingDecision() {
  const now = new Date();
  const isTuesday = now.getDay() === 2;
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (!isTuesday || minutes < 19 * 60) {
    return { allowed: false };
  }

  return {
    allowed: true,
    mode: "firstCrateOnly"
  };
}

function getDecision() {
  const event = eventData.currentEvent || eventData.upcomingEvent || {};
  const type = (event.type || "").toLowerCase();
  const attending = event.counts?.attending || 0;

  const eventDate = new Date(event.startTimestamp);
  const now = new Date();

  const isToday =
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate();

  if (!isToday) {
    return {
      allowed: false,
      reason: "Vandaag is er geen training of wedstrijd."
    };
  }

  const isTraining = type.includes("training");
  const isMatch = type.includes("match") || type.includes("wedstrijd");

  if (!isTraining && !isMatch) {
    return {
      allowed: false,
      reason: "Dit event is geen training of wedstrijd."
    };
  }

  const minutes = now.getHours() * 60 + now.getMinutes();

  if (isMatch) {
    if (minutes < 8 * 60) {
      return {
        allowed: false,
        reason: "Wedstrijd-HO mag pas vanaf 08:00."
      };
    }

    return {
      allowed: true,
      mode: "firstCrateOnly"
    };
  }

  if (isTraining) {
    if (minutes < 19 * 60 + 15) {
      return {
        allowed: false,
        reason: "Training-HO mag pas vanaf 19:15."
      };
    }

    if (attending >= 12) {
      return {
        allowed: true,
        mode: "trainingTwoCratesPossible"
      };
    }

    return {
      allowed: true,
      mode: "firstCrateOnly"
    };
  }

  return {
    allowed: false,
    reason: "Het Orakel snapt dit event niet."
  };
}

function popupYes() {
  if (popupMode === "firstCrateOnly") {
    closePopup();
    setResult("NEE.", "Dan is het kratwerk al gedaan.");
    return;
  }

  if (popupMode === "trainingTwoCratesPossible") {
    openPopup("secondCrateCheck", "HEB JE OOK EEN 2E KRAT GEHAALD?");
    return;
  }

  if (popupMode === "secondCrateCheck") {
    closePopup();
    setResult("NEE.", "Twee kratten is genoeg. Gedraag je.");
  }
}

function popupNo() {
  if (popupMode === "firstCrateOnly") {
    closePopup();
    setResult("JA MAN.", randomFrom(responses.yes));
    vibratePositive();
    return;
  }

  if (popupMode === "trainingTwoCratesPossible") {
    closePopup();
    setResult("JA MAN.", randomFrom(responses.yes));
    vibratePositive();
    return;
  }

  if (popupMode === "secondCrateCheck") {
    closePopup();
    setResult("JA MAN.", randomFrom(responses.secondCrateYes));
    vibratePositive();
  }
}

/* =========================
   KRATFLAP GAME
========================= */

function restoreKratflapUnlock() {
  kratflapUnlocked = localStorage.getItem(KRATFLAP_UNLOCK_KEY) === "1";

  if (kratflapUnlocked) {
    showKratflapTeaser();
  }
}

function registerKratflapCheck() {
  if (kratflapUnlocked) return;

  kratflapCheckCount += 1;

  if (kratflapCheckCount >= 5) {
    kratflapUnlocked = true;
    localStorage.setItem(KRATFLAP_UNLOCK_KEY, "1");
    showKratflapTeaser();
  }
}

function showKratflapTeaser() {
  const teaser = document.getElementById("kratflapTeaser");
  if (!teaser) return;

  teaser.style.display = "block";
  loadKratflapHighscore();
}

async function loadKratflapHighscore() {
  try {
    const res = await fetch(KRATFLAP_API_URL);
    if (!res.ok) return;
    const data = await res.json();
    const top = data.weekTop && data.weekTop[0];
    if (!top) return;

    document.getElementById("kratflapHighscoreName").textContent = top.name;
    document.getElementById("kratflapHighscoreValue").textContent = top.score;
    document.getElementById("kratflapHighscore").style.display = "block";
  } catch {
    // silently ignore network errors
  }
}

function openKratflap() {
  const sheet = document.getElementById("kratflapSheet");
  if (!sheet) return;

  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeKratflap() {
  const sheet = document.getElementById("kratflapSheet");
  if (!sheet) return;

  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

/* =========================
   KRATFLIP GAME (verborgen)
========================= */

// Word het vaste getal EXACT geraakt, dan lichten de randen van de knop op.
// Herken je de gloed en STOP je met tikken, dan zwelt hij ~5s langzaam aan en
// morpht de knop met een "holy" bloom naar de klikbare KRATFLIP?-knop. Tik je
// toch door, dan is de kans weg -- maar ~20-30 drukken later een nieuwe kans.
function registerKratflipPress() {
  if (kratflipDone || kratflipRevealed) return;

  // Gloed loopt en je tikt toch door -> gemist. Her-arm een nieuw geheim getal.
  if (kratflipGlowing) {
    missKratflip();
    return;
  }

  kratflipPressCount += 1;

  if (kratflipPressCount === kratflipTarget) {
    startKratflipGlow();
  }
}

function startKratflipGlow() {
  const checkBtn = document.getElementById("checkButton");
  if (!checkBtn) return;

  kratflipGlowing = true;
  checkBtn.classList.add("kratflip-glow"); // rand-gloed die langzaam aanzwelt

  clearTimeout(kratflipMorphTimer);
  kratflipMorphTimer = setTimeout(morphKratflipButton, 5000);
}

// Doorheen getikt: gloed weg en pas over 20-30 drukken een nieuwe kans.
function missKratflip() {
  const checkBtn = document.getElementById("checkButton");
  if (checkBtn) checkBtn.classList.remove("kratflip-glow");

  clearTimeout(kratflipMorphTimer);
  kratflipGlowing = false;
  kratflipTarget = kratflipPressCount + randomInt(20, 30);
}

function morphKratflipButton() {
  const checkBtn = document.getElementById("checkButton");
  const flipBtn = document.getElementById("kratflipButton");
  if (!checkBtn || !flipBtn) return;

  kratflipGlowing = false;
  kratflipRevealed = true;
  checkBtn.classList.remove("kratflip-glow");
  checkBtn.style.display = "none";
  flipBtn.style.display = "";
}

function startKratflip() {
  openKratflip();

  // Knop terug naar normaal; Kratflip is klaar voor deze sessie.
  const checkBtn = document.getElementById("checkButton");
  const flipBtn = document.getElementById("kratflipButton");
  if (flipBtn) flipBtn.style.display = "none";
  if (checkBtn) {
    checkBtn.style.display = "";
    checkBtn.classList.remove("kratflip-glow");
  }

  clearTimeout(kratflipMorphTimer);
  kratflipGlowing = false;
  kratflipRevealed = false;
  kratflipDone = true;
}

function openKratflip() {
  const sheet = document.getElementById("kratflipSheet");
  if (!sheet) return;

  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeKratflip() {
  const sheet = document.getElementById("kratflipSheet");
  if (!sheet) return;

  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

/* =========================
   HELPERS
========================= */

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHtml(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function setChance(id, value) {
  setText(id + "Chance", value + "%");
  const bar = document.getElementById(id + "Bar");
  if (bar) bar.style.width = value + "%";
}

function listLastMinuteDeclined(items) {
  if (!items || !items.length) return "-";
  return items.map(item => (item.name || item)).join(", ");
}

function formatCountdown(start) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return "-";

  const diffMs = start.getTime() - Date.now();
  if (diffMs <= 0) return "Bezig / vandaag";

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Nog ${days}d ${hours}u`;
  if (hours > 0) return `Nog ${hours}u ${minutes}m`;
  return `Nog ${minutes}m`;
}

function startCountdown() {
  updateCountdown();

  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  countdownTimer = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const primary = eventData && (eventData.currentEvent || eventData.upcomingEvent);
  if (!primary) return;

  const start = new Date(primary.startTimestamp).getTime();
  const diff = start - Date.now();

  if (diff <= 0) {
    document.getElementById("countdown").textContent = "NU.";
    return;
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff / 3600000) % 24);
  const minutes = Math.floor((diff / 60000) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  document.getElementById("countdown").textContent =
    days > 0
      ? `${days}d ${hours}u ${minutes}m`
      : `${hours}u ${minutes}m ${seconds}s`;
}

function stableRandom(text) {
  let hash = 0;

  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash % 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomFrom(list) {
  if (!list || !list.length) return "";
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function setResult(answer, sub) {
  document.getElementById("answer").textContent = answer;
  document.getElementById("sub").textContent = sub;
}

function openPopup(mode, title) {
  popupMode = mode;
  document.getElementById("popup-title").textContent = title;
  document.getElementById("popup").style.display = "flex";
}

function closePopup() {
  document.getElementById("popup").style.display = "none";
  popupMode = null;
}

function vibratePositive() {
  if (navigator.vibrate) {
    navigator.vibrate([80, 60, 120]);
  }
}

function listNames(names) {
  if (!names || !names.length) return "-";
  return names.join(", ");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date) {
  return date.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
}

function formatTime(date) {
  return date.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTime(date) {
  return date.toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* =========================
   LINEUP OPSTELLING
========================= */

const STATS_URL = "/api/stats";
const PAST_MATCHES_URL = "./data/past-matches.json";
const LINEUP_URL = "/api/lineup";

let statsData = { matches: [] };
let statsPassword = null;
let statsEditorMatchId = null;
let statsViewingSeason = null;
let expandedStatsCharts = [];
let pastSpondMatches = null; // cached from /past-matches

let lineupData = { formation: "4-3-3", positions: {}, extraPlayers: [], outfitColor: "black" };
let lineupEditMode = false;
let lineupPassword = null;
let lineupSelectedPlayer = null;
let lineupExtraPlayers = [];

// Slotdefinities per formatie: x/y in % van het SVG-viewBox (400×520)
const LINEUP_FORMATIONS = {
  "4-3-3": [
    { id: "gk",    type: "gk",  x: 50,     y: 88.5,  label: "GK" },
    { id: "def-1", type: "def", x: 15,     y: 71.7,  label: "V"  },
    { id: "def-2", type: "def", x: 33.75,  y: 71.7,  label: "V"  },
    { id: "def-3", type: "def", x: 66.25,  y: 71.7,  label: "V"  },
    { id: "def-4", type: "def", x: 85,     y: 71.7,  label: "V"  },
    { id: "mid-1", type: "mid", x: 20,     y: 50,    label: "M"  },
    { id: "mid-2", type: "mid", x: 50,     y: 50,    label: "M"  },
    { id: "mid-3", type: "mid", x: 80,     y: 50,    label: "M"  },
    { id: "att-1", type: "att", x: 20,     y: 28.3,  label: "A"  },
    { id: "att-2", type: "att", x: 50,     y: 28.3,  label: "A"  },
    { id: "att-3", type: "att", x: 80,     y: 28.3,  label: "A"  },
  ],
  "4-4-2": [
    { id: "gk",    type: "gk",  x: 50,     y: 88.5,  label: "GK" },
    { id: "def-1", type: "def", x: 15,     y: 71.7,  label: "V"  },
    { id: "def-2", type: "def", x: 33.75,  y: 71.7,  label: "V"  },
    { id: "def-3", type: "def", x: 66.25,  y: 71.7,  label: "V"  },
    { id: "def-4", type: "def", x: 85,     y: 71.7,  label: "V"  },
    { id: "mid-1", type: "mid", x: 15,     y: 50,    label: "M"  },
    { id: "mid-2", type: "mid", x: 37.5,   y: 50,    label: "M"  },
    { id: "mid-3", type: "mid", x: 62.5,   y: 50,    label: "M"  },
    { id: "mid-4", type: "mid", x: 85,     y: 50,    label: "M"  },
    { id: "att-1", type: "att", x: 37.5,   y: 28.3,  label: "A"  },
    { id: "att-2", type: "att", x: 62.5,   y: 28.3,  label: "A"  },
  ],
  "3-4-3": [
    { id: "gk",    type: "gk",  x: 50,     y: 88.5,  label: "GK" },
    { id: "def-1", type: "def", x: 20,     y: 71.7,  label: "V"  },
    { id: "def-2", type: "def", x: 50,     y: 71.7,  label: "V"  },
    { id: "def-3", type: "def", x: 80,     y: 71.7,  label: "V"  },
    { id: "mid-1", type: "mid", x: 15,     y: 50,    label: "M"  },
    { id: "mid-2", type: "mid", x: 37.5,   y: 50,    label: "M"  },
    { id: "mid-3", type: "mid", x: 62.5,   y: 50,    label: "M"  },
    { id: "mid-4", type: "mid", x: 85,     y: 50,    label: "M"  },
    { id: "att-1", type: "att", x: 20,     y: 28.3,  label: "A"  },
    { id: "att-2", type: "att", x: 50,     y: 28.3,  label: "A"  },
    { id: "att-3", type: "att", x: 80,     y: 28.3,  label: "A"  },
  ],
  "3-5-2": [
    { id: "gk",    type: "gk",  x: 50,     y: 88.5,  label: "GK" },
    { id: "def-1", type: "def", x: 20,     y: 71.7,  label: "V"  },
    { id: "def-2", type: "def", x: 50,     y: 71.7,  label: "V"  },
    { id: "def-3", type: "def", x: 80,     y: 71.7,  label: "V"  },
    { id: "mid-1", type: "mid", x: 10,     y: 50,    label: "M"  },
    { id: "mid-2", type: "mid", x: 30,     y: 50,    label: "M"  },
    { id: "mid-3", type: "mid", x: 50,     y: 50,    label: "M"  },
    { id: "mid-4", type: "mid", x: 70,     y: 50,    label: "M"  },
    { id: "mid-5", type: "mid", x: 90,     y: 50,    label: "M"  },
    { id: "att-1", type: "att", x: 37.5,   y: 28.3,  label: "A"  },
    { id: "att-2", type: "att", x: 62.5,   y: 28.3,  label: "A"  },
  ],
};

async function loadLineup() {
  try {
    const response = await fetch(LINEUP_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    lineupData = {
      formation: data.formation || "4-3-3",
      positions: data.positions || {},
      extraPlayers: Array.isArray(data.extraPlayers) ? data.extraPlayers : [],
      bench: Array.isArray(data.bench) ? data.bench : [],
      outfitColor: data.outfitColor === "white" ? "white" : "black",
      updatedAt: data.updatedAt || null
    };
    lineupExtraPlayers = [...lineupData.extraPlayers];
  } catch (err) {
    console.error("LINEUP LOAD ERROR:", err);
  }

  renderLineupField(lineupData, false);
  renderLineupBench();
  renderLineupMeta();
  renderLineupOutfitBanner();
}

function renderLineupField(data, editable) {
  const wrap = document.getElementById("lineupFieldWrap");
  if (!wrap) return;

  wrap.querySelectorAll(".lineup-chip-slot").forEach(el => el.remove());

  const formation = data.formation || "4-3-3";
  const slots = LINEUP_FORMATIONS[formation] || LINEUP_FORMATIONS["4-3-3"];
  const positions = data.positions || {};

  for (const slot of slots) {
    const playerName = positions[slot.id] || null;
    const chip = document.createElement("div");

    chip.className = [
      "lineup-chip-slot",
      playerName ? "" : "empty",
      playerName && data.outfitColor === "white" ? "outfit-white" : "",
      editable ? "editable" : ""
    ].filter(Boolean).join(" ");

    chip.style.left = slot.x + "%";
    chip.style.top = slot.y + "%";
    chip.title = playerName || slot.label;
    chip.textContent = playerName ? lineupChipLabel(playerName) : slot.label;

    if (editable) {
      const capturedSlotId = slot.id;
      const capturedPlayer = playerName;
      chip.addEventListener("click", () => lineupSlotClick(capturedSlotId, capturedPlayer));
    }

    wrap.appendChild(chip);
  }
}

function lineupChipLabel(fullName) {
  const first = String(fullName || "").trim().split(/\s+/)[0];
  return first.length <= 7 ? first : first.slice(0, 6) + "…";
}

function renderLineupMeta() {
  const el = document.getElementById("lineupMeta");
  if (!el) return;

  const formation = lineupData.formation || "4-3-3";
  const placed = Object.values(lineupData.positions || {}).length;
  const total = (LINEUP_FORMATIONS[formation] || []).length;

  let text = `Formatie: ${formation} · ${placed}/${total} posities bezet`;

  if (lineupData.updatedAt) {
    text += ` · bijgewerkt ${formatDateTime(new Date(lineupData.updatedAt))}`;
  }

  el.textContent = text;
}

function lineupEditBtnClick() {
  if (lineupEditMode) {
    lineupDisableEditMode();
  } else {
    lineupOpenPasswordPopup();
  }
}

function lineupOpenPasswordPopup() {
  const popup = document.getElementById("lineupPasswordPopup");
  if (!popup) return;
  document.getElementById("lineupPasswordInput").value = "";
  document.getElementById("lineupPasswordError").textContent = "";
  popup.style.display = "flex";
  setTimeout(() => document.getElementById("lineupPasswordInput").focus(), 80);
}

function lineupPasswordCancel() {
  document.getElementById("lineupPasswordPopup").style.display = "none";
}

async function lineupPasswordSubmit() {
  const pw = document.getElementById("lineupPasswordInput").value;
  const errorEl = document.getElementById("lineupPasswordError");

  if (!pw) {
    errorEl.textContent = "Vul een wachtwoord in.";
    return;
  }

  errorEl.textContent = "Controleren…";

  try {
    const response = await fetch(LINEUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        password: pw,
        formation: lineupData.formation,
        positions: lineupData.positions,
        extraPlayers: lineupExtraPlayers,
        bench: lineupData.bench || [],
        outfitColor: lineupData.outfitColor || "black"
      })
    });

    const result = await response.json();

    if (!response.ok) {
      errorEl.textContent = result.error || "Onjuist wachtwoord.";
      return;
    }

    lineupPassword = pw;
    document.getElementById("lineupPasswordPopup").style.display = "none";
    lineupEnableEditMode();
  } catch (err) {
    errorEl.textContent = "Fout: " + err.message;
  }
}

function lineupEnableEditMode() {
  lineupEditMode = true;
  lineupSelectedPlayer = null;

  document.getElementById("lineupEditBtn").textContent = "Sluiten";
  document.getElementById("lineupFormationRow").style.display = "flex";
  document.getElementById("lineupOutfitRow").style.display = "flex";
  document.getElementById("lineupBankWrap").style.display = "block";
  document.getElementById("lineupSaveRow").style.display = "block";

  lineupUpdateFormationButtons();
  lineupUpdateOutfitButtons();
  renderLineupField(lineupData, true);
  renderLineupBank();
  renderLineupBench();

  const meta = document.getElementById("lineupMeta");
  if (meta) meta.textContent = "Selecteer een speler in de bank en tik dan een positie op het veld.";
}

function lineupDisableEditMode() {
  lineupEditMode = false;
  lineupSelectedPlayer = null;

  document.getElementById("lineupEditBtn").textContent = "Bewerken";
  document.getElementById("lineupFormationRow").style.display = "none";
  document.getElementById("lineupOutfitRow").style.display = "none";
  document.getElementById("lineupBankWrap").style.display = "none";
  document.getElementById("lineupSaveRow").style.display = "none";
  document.getElementById("lineupStatus").textContent = "";
  document.getElementById("lineupStatus").style.color = "";

  renderLineupField(lineupData, false);
  renderLineupBench();
  renderLineupMeta();
}

function lineupUpdateFormationButtons() {
  document.querySelectorAll(".lineup-form-btn[data-formation]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.formation === lineupData.formation);
  });
}

function lineupUpdateOutfitButtons() {
  document.querySelectorAll(".lineup-outfit-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.outfit === (lineupData.outfitColor || "black"));
  });
}

function lineupSetOutfitColor(color) {
  lineupData.outfitColor = color === "white" ? "white" : "black";
  lineupUpdateOutfitButtons();
  renderLineupField(lineupData, lineupEditMode);
  renderLineupOutfitBanner();
}

function renderLineupOutfitBanner() {
  const banner = document.getElementById("lineupOutfitBanner");
  if (!banner) return;
  banner.style.display = lineupData.outfitColor === "white" ? "block" : "none";
}

function lineupSetFormation(formation) {
  if (lineupData.formation === formation) return;

  const oldPositions = { ...lineupData.positions };
  const newSlotIds = new Set((LINEUP_FORMATIONS[formation] || []).map(s => s.id));

  const newPositions = {};
  for (const [slotId, playerName] of Object.entries(oldPositions)) {
    if (newSlotIds.has(slotId)) newPositions[slotId] = playerName;
  }

  lineupData.formation = formation;
  lineupData.positions = newPositions;
  lineupSelectedPlayer = null;

  lineupUpdateFormationButtons();
  renderLineupField(lineupData, true);
  renderLineupBank();
}

function lineupFindNextMatch() {
  const candidates = [
    eventData?.currentEvent,
    eventData?.upcomingEvent,
    eventData?.nextEvent
  ];
  return candidates.find(event => event?.type === "wedstrijd") || null;
}

function lineupGetAllPlayers() {
  const match = lineupFindNextMatch();
  let players;

  if (match) {
    const attending = (match.attending || []).map(name => ({ name, status: "attending" }));
    const unanswered = (match.unanswered || []).map(name => ({ name, status: "unanswered" }));
    const declined = (match.declined || []).map(name => ({ name, status: "declined" }));
    players = [...attending, ...unanswered, ...declined];
  } else {
    const allMembers = eventData?.members || [];
    players = allMembers.map(name => ({ name, status: "unknown" }));
  }

  const seenNames = new Set(players.map(p => p.name));
  for (const name of lineupExtraPlayers) {
    if (!seenNames.has(name)) {
      players.push({ name, status: "extra" });
      seenNames.add(name);
    }
  }

  return players;
}

function lineupGetAvailablePlayers() {
  const placed = new Set(Object.values(lineupData.positions));
  const benched = new Set(lineupData.bench || []);
  return lineupGetAllPlayers().filter(p => !placed.has(p.name) && !benched.has(p.name));
}

function renderLineupBank() {
  const bank = document.getElementById("lineupBank");
  if (!bank) return;

  bank.innerHTML = "";
  const available = lineupGetAvailablePlayers();

  if (!available.length) {
    const empty = document.createElement("span");
    empty.className = "lineup-bank-empty";
    empty.textContent = "Alle spelers zijn opgesteld of op de bank.";
    bank.appendChild(empty);
  } else {
    for (const { name, status } of available) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lineup-bank-chip " + status + (name === lineupSelectedPlayer ? " selected" : "");
      chip.textContent = lineupChipLabel(name);
      const statusLabel = status === "attending" ? " ✓" : status === "unanswered" ? " ?" : status === "declined" ? " ✗" : "";
      chip.title = name + statusLabel;
      chip.addEventListener("click", () => lineupBankChipClick(name));
      bank.appendChild(chip);
    }
  }

  const toBenchBtn = document.getElementById("lineupToBenchBtn");
  if (toBenchBtn) {
    toBenchBtn.style.display = lineupSelectedPlayer ? "inline-block" : "none";
  }
}

function renderLineupBench() {
  const section = document.getElementById("lineupBenchSection");
  const benchEl = document.getElementById("lineupBench");
  if (!section || !benchEl) return;

  const bench = lineupData.bench || [];

  if (!lineupEditMode && bench.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  benchEl.innerHTML = "";

  if (bench.length === 0) {
    const empty = document.createElement("span");
    empty.className = "lineup-bank-empty";
    empty.textContent = "Nog niemand op de bank.";
    benchEl.appendChild(empty);
    return;
  }

  const statusMap = Object.fromEntries(lineupGetAllPlayers().map(p => [p.name, p.status]));

  for (const name of bench) {
    const status = statusMap[name] || "extra";
    const chip = document.createElement(lineupEditMode ? "button" : "div");
    if (lineupEditMode) chip.type = "button";
    chip.className = "lineup-bank-chip " + status;
    chip.textContent = lineupChipLabel(name);
    chip.title = name + (lineupEditMode ? " (tik om te verwijderen)" : "");
    if (lineupEditMode) {
      chip.addEventListener("click", () => lineupRemoveFromBench(name));
    }
    benchEl.appendChild(chip);
  }
}

function lineupMoveToBench() {
  if (!lineupSelectedPlayer) return;

  const bench = lineupData.bench || [];
  if (!bench.includes(lineupSelectedPlayer)) {
    bench.push(lineupSelectedPlayer);
    lineupData.bench = bench;
  }

  lineupSelectedPlayer = null;
  renderLineupBank();
  renderLineupBench();

  const wrap = document.getElementById("lineupFieldWrap");
  wrap.querySelectorAll(".lineup-chip-slot.empty.editable").forEach(el => {
    el.classList.remove("target-highlight");
  });
}

function lineupRemoveFromBench(name) {
  lineupData.bench = (lineupData.bench || []).filter(n => n !== name);
  renderLineupBank();
  renderLineupBench();
}

function lineupBankChipClick(playerName) {
  lineupSelectedPlayer = lineupSelectedPlayer === playerName ? null : playerName;
  renderLineupBank();

  const wrap = document.getElementById("lineupFieldWrap");
  wrap.querySelectorAll(".lineup-chip-slot.empty.editable").forEach(el => {
    el.classList.toggle("target-highlight", lineupSelectedPlayer !== null);
  });
}

function lineupSlotClick(slotId, currentPlayer) {
  if (currentPlayer) {
    delete lineupData.positions[slotId];
    lineupSelectedPlayer = null;
    renderLineupField(lineupData, true);
    renderLineupBank();
    return;
  }

  if (!lineupSelectedPlayer) return;

  // Verwijder de speler uit een eventueel bestaand slot
  for (const [key, val] of Object.entries(lineupData.positions)) {
    if (val === lineupSelectedPlayer) delete lineupData.positions[key];
  }

  lineupData.positions[slotId] = lineupSelectedPlayer;
  lineupSelectedPlayer = null;
  renderLineupField(lineupData, true);
  renderLineupBank();
}

function lineupAddPlayer() {
  const popup = document.getElementById("lineupAddPlayerPopup");
  if (!popup) return;
  document.getElementById("lineupAddPlayerInput").value = "";
  popup.style.display = "flex";
  setTimeout(() => document.getElementById("lineupAddPlayerInput").focus(), 80);
}

function lineupAddPlayerCancel() {
  document.getElementById("lineupAddPlayerPopup").style.display = "none";
}

function lineupAddPlayerConfirm() {
  const input = document.getElementById("lineupAddPlayerInput");
  const name = input.value.trim();
  if (!name) return;

  if (!lineupExtraPlayers.includes(name)) lineupExtraPlayers.push(name);

  document.getElementById("lineupAddPlayerPopup").style.display = "none";
  renderLineupBank();
}

async function lineupSave() {
  const statusEl = document.getElementById("lineupStatus");

  try {
    statusEl.textContent = "Opslaan…";
    statusEl.style.color = "#ffcc00";

    const response = await fetch(LINEUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        password: lineupPassword,
        formation: lineupData.formation,
        positions: lineupData.positions,
        extraPlayers: lineupExtraPlayers,
        bench: lineupData.bench || [],
        outfitColor: lineupData.outfitColor || "black"
      })
    });

    const result = await response.json();

    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

    lineupData.updatedAt = new Date().toISOString();
    statusEl.textContent = "Opstelling opgeslagen!";
    statusEl.style.color = "#46d369";
    setTimeout(() => { statusEl.textContent = ""; statusEl.style.color = ""; }, 3500);
  } catch (err) {
    statusEl.textContent = "Opslaan mislukt: " + err.message;
    statusEl.style.color = "#ff5c5c";
  }
}

/* =========================
   MATCH STATISTICS
========================= */

function getSeasonYear(dateStr) {
  const d = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return (m > 7 || (m === 7 && day >= 15)) ? y : y - 1;
}

function seasonLabel(year) {
  return `${year}–${year + 1}`;
}

function getAvailableSeasons() {
  const years = new Set(statsData.matches.map(m => m.seasonYear));
  years.add(getSeasonYear());
  return [...years].sort((a, b) => b - a);
}

function getMatchesForSeason(year) {
  return statsData.matches.filter(m => m.seasonYear === year);
}

function aggregateSeasonStats(matches) {
  const players = {};

  function ensure(name) {
    if (!name) return null;
    if (!players[name]) {
      players[name] = { name, goals: 0, ownGoals: 0, assists: 0, geleKaart: 0, groeneKaart: 0, motm: 0, matchIds: [] };
    }
    return players[name];
  }

  for (const match of matches) {
    const touched = new Set();

    if (match.motm) { const p = ensure(match.motm); if (p) { p.motm++; touched.add(match.motm); } }

    for (const g of (match.goals || [])) {
      const p = ensure(g.player);
      if (p) { p.goals += (g.count || 1); touched.add(g.player); }
    }
    for (const g of (match.ownGoals || [])) {
      const p = ensure(g.player);
      if (p) { p.ownGoals += (g.count || 1); touched.add(g.player); }
    }
    for (const a of (match.assists || [])) {
      const p = ensure(a.player);
      if (p) { p.assists += (a.count || 1); touched.add(a.player); }
    }
    for (const name of (match.geleKaart || [])) {
      const p = ensure(name);
      if (p) { p.geleKaart++; touched.add(name); }
    }
    for (const name of (match.groeneKaart || [])) {
      const p = ensure(name);
      if (p) { p.groeneKaart++; touched.add(name); }
    }

    for (const name of touched) {
      const p = players[name];
      if (p && !p.matchIds.includes(match.matchId)) p.matchIds.push(match.matchId);
    }
  }

  return Object.values(players).sort((a, b) => {
    if (b.goals !== a.goals) return b.goals - a.goals;
    if (b.assists !== a.assists) return b.assists - a.assists;
    return a.name.localeCompare(b.name);
  });
}

async function loadStats() {
  try {
    const res = await fetch(STATS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    statsData = await res.json();
    if (!Array.isArray(statsData.matches)) statsData.matches = [];
  } catch (err) {
    console.error("STATS LOAD ERROR:", err);
    statsData = { matches: [] };
  }
  renderStatsCard();
}

function renderStatsCard() {
  const seasons = getAvailableSeasons();
  const selectEl = document.getElementById("statsSeasonSelect");
  if (selectEl) {
    const prev = selectEl.value;
    selectEl.innerHTML = "";
    for (const y of seasons) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = seasonLabel(y);
      selectEl.appendChild(opt);
    }
    if (prev && seasons.includes(Number(prev))) selectEl.value = prev;
  }

  if (statsViewingSeason === null) statsViewingSeason = seasons[0] || getSeasonYear();
  if (selectEl) selectEl.value = statsViewingSeason;

  const matches = getMatchesForSeason(statsViewingSeason);
  const players = aggregateSeasonStats(matches);
  const body = document.getElementById("statsSeasonBody");
  if (!body) return;

  if (matches.length === 0) {
    body.innerHTML = `<div class="lineup-meta" style="text-align:center;padding:16px 0;">
      Nog geen statistieken voor ${seasonLabel(statsViewingSeason)}.<br>
      Klik op <strong>Aanpassen</strong> om de eerste wedstrijd in te voeren.
    </div>`;
    return;
  }

  let html = `<div class="stats-table">`;
  html += `<div class="stats-table-head">
    <span>Speler</span><span title="Doelpunten">⚽</span><span title="Assists">🎯</span><span title="Man of the Match">⭐</span><span title="Gele kaart">🟨</span><span title="Groene kaart">🟩</span>
  </div>`;

  for (const p of players) {
    const hasStats = p.goals || p.assists || p.motm || p.geleKaart || p.groeneKaart || p.ownGoals;
    if (!hasStats) continue;
    html += `<div class="stats-table-row" onclick="openExpandedStats('${escapeHtml(p.name)}')">
      <span class="stats-player-name">${escapeHtml(p.name)}</span>
      <span class="stats-cell">${p.goals || "-"}</span>
      <span class="stats-cell">${p.assists || "-"}</span>
      <span class="stats-cell">${p.motm || "-"}</span>
      <span class="stats-cell">${p.geleKaart || "-"}</span>
      <span class="stats-cell">${p.groeneKaart || "-"}</span>
    </div>`;
  }

  html += `</div>`;
  html += `<div class="stats-matches-count">${matches.length} wedstrijd${matches.length !== 1 ? "en" : ""} · Tik een speler voor uitgebreide stats</div>`;

  body.innerHTML = html;
}

function statsSeasonChanged() {
  const sel = document.getElementById("statsSeasonSelect");
  if (sel) statsViewingSeason = Number(sel.value);
  renderStatsCard();
}

/* --- Stats password --- */

function statsOpenEditor() {
  if (statsPassword) {
    openStatsEditorSheet();
  } else if (lineupPassword) {
    // reuse lineup password if already authenticated this session
    statsPassword = lineupPassword;
    openStatsEditorSheet();
  } else {
    const popup = document.getElementById("statsPasswordPopup");
    if (!popup) return;
    document.getElementById("statsPasswordInput").value = "";
    document.getElementById("statsPasswordError").textContent = "";
    popup.style.display = "flex";
    setTimeout(() => document.getElementById("statsPasswordInput").focus(), 80);
  }
}

function statsPasswordCancel() {
  document.getElementById("statsPasswordPopup").style.display = "none";
}

async function statsPasswordSubmit() {
  const pw = document.getElementById("statsPasswordInput").value;
  const errorEl = document.getElementById("statsPasswordError");
  if (!pw) { errorEl.textContent = "Vul een wachtwoord in."; return; }
  errorEl.textContent = "Controleren…";

  try {
    const res = await fetch(STATS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ password: pw, matchStats: null })
    });
    const result = await res.json();
    if (!res.ok) {
      errorEl.textContent = result.error || "Onjuist wachtwoord.";
      return;
    }
    statsPassword = pw;
    document.getElementById("statsPasswordPopup").style.display = "none";
    openStatsEditorSheet();
  } catch (err) {
    errorEl.textContent = "Fout: " + err.message;
  }
}

/* --- Stats editor sheet --- */

async function openStatsEditorSheet() {
  const sheet = document.getElementById("statsEditorSheet");
  if (!sheet) return;

  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  // Show loading state while we fetch past matches from Spond
  const body = document.getElementById("statsEditorBody");
  if (body) {
    body.innerHTML = `<div class="stats-editor-inner" style="text-align:center;padding:32px 0;">
      <div class="lineup-meta">Wedstrijden ophalen uit Spond...</div>
    </div>`;
  }

  if (!pastSpondMatches) {
    try {
      const res = await fetch(PAST_MATCHES_URL, { cache: "no-store" });
      const data = await res.json();
      pastSpondMatches = Array.isArray(data.matches) ? data.matches : [];
    } catch {
      pastSpondMatches = [];
    }
  }

  // Default selection: most recent Spond match, or most recent saved match, or new
  if (!statsEditorMatchId) {
    if (pastSpondMatches.length > 0) {
      statsEditorMatchId = "spond_" + pastSpondMatches[0].id;
    } else if (statsData.matches.length > 0) {
      statsEditorMatchId = statsData.matches[0].matchId;
    } else {
      statsEditorMatchId = "__new__";
    }
  }

  renderStatsEditor();
}

function closeStatsEditor() {
  const sheet = document.getElementById("statsEditorSheet");
  if (!sheet) return;
  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  statsEditorMatchId = null; // reset so next open defaults to most recent
}

function statsGetAllPlayers() {
  const fromSpond = eventData?.members || [];
  const seenNames = new Set(fromSpond);
  const extra = [];
  for (const m of statsData.matches) {
    const names = [
      m.motm,
      ...(m.goals || []).map(g => g.player),
      ...(m.ownGoals || []).map(g => g.player),
      ...(m.assists || []).map(a => a.player),
      ...(m.geleKaart || []),
      ...(m.groeneKaart || [])
    ].filter(Boolean);
    for (const n of names) {
      if (!seenNames.has(n)) { extra.push(n); seenNames.add(n); }
    }
  }
  return [...fromSpond, ...extra].sort();
}

function renderStatsEditor() {
  const body = document.getElementById("statsEditorBody");
  if (!body) return;

  const allPlayers = statsGetAllPlayers();
  const spondMatches = pastSpondMatches || [];

  // Resolve current match data from either Spond source or saved stats
  const { date: resolvedDate, opponent: resolvedOpponent, goalsFor: resolvedGoalsFor, goalsAgainst: resolvedGoalsAgainst, savedMatch } = statsResolveCurrentMatch();

  // Build <option> groups for the match selector
  // Group 1: Spond matches (from /past-matches)
  const spondOptions = spondMatches.map(m => {
    const val = "spond_" + m.id;
    const d = new Date(m.date + "T12:00:00");
    const dateStr = d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    const homeAway = m.isHome ? "thuis" : "uit";
    const label = m.opponent ? `${dateStr} – ${m.opponent} ${homeAway}` : `${dateStr} – ${homeAway}`;
    return `<option value="${escapeHtml(val)}" ${statsEditorMatchId === val ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");

  // Group 2: saved stats matches not in Spond list (manually added)
  const spondDates = new Set(spondMatches.map(m => m.date));
  const savedOnlyMatches = statsData.matches.filter(m => !spondDates.has(m.date));
  const savedOptions = savedOnlyMatches.map(m =>
    `<option value="${escapeHtml(m.matchId)}" ${statsEditorMatchId === m.matchId ? "selected" : ""}>
      ${escapeHtml(m.date)} – ${escapeHtml(m.opponent || "Handmatig")}
    </option>`
  ).join("");

  const playerDatalist = `<datalist id="statsPlayerList">${allPlayers.map(n => `<option value="${escapeHtml(n)}">`).join("")}</datalist>`;

  function playerChipsHtml(label, fieldId, multi = false) {
    return `
      <div class="stats-field-section">
        <div class="stats-field-label">${label}</div>
        <div class="stats-chips-wrap" id="chips_${fieldId}"></div>
        <div class="stats-add-row">
          <input class="stats-player-input" type="text" list="statsPlayerList" placeholder="Speler toevoegen…" id="input_${fieldId}" autocomplete="off"
            onkeydown="if(event.key==='Enter'){event.preventDefault();statsAddChip('${fieldId}',${multi})}" />
          ${multi ? `<input class="stats-count-input" type="number" min="1" max="20" value="1" id="count_${fieldId}" />` : ""}
          <button class="mini-button" type="button" onclick="statsAddChip('${fieldId}', ${multi})">+</button>
        </div>
      </div>`;
  }

  const hasSaved = !!savedMatch;

  body.innerHTML = `
    ${playerDatalist}
    <div class="stats-editor-inner">
      <div class="stats-field-section">
        <div class="stats-field-label">Wedstrijd</div>
        <select class="stats-match-select" id="statsMatchSelect" onchange="statsSelectMatch(this.value)">
          <option value="__new__" ${statsEditorMatchId === "__new__" ? "selected" : ""}>+ Handmatig / nieuw</option>
          ${spondOptions ? `<optgroup label="Wedstrijden uit Spond">${spondOptions}</optgroup>` : ""}
          ${savedOptions ? `<optgroup label="Eerder opgeslagen">${savedOptions}</optgroup>` : ""}
        </select>
        ${hasSaved ? `<div class="stats-saved-indicator">✓ Stats al opgeslagen voor deze wedstrijd</div>` : ""}
      </div>

      <div class="stats-field-section" id="statsMatchMeta">
        <div class="stats-meta-grid">
          <div>
            <div class="stats-field-label">Datum</div>
            <input class="lineup-popup-input stats-date-input" type="date" id="statsMatchDate" value="${escapeHtml(resolvedDate)}" />
          </div>
          <div>
            <div class="stats-field-label">Tegenstander</div>
            <input class="lineup-popup-input stats-text-input" type="text" id="statsMatchOpponent" value="${escapeHtml(resolvedOpponent)}" placeholder="bv. Kampong Heren 7" autocomplete="off" />
          </div>
        </div>
        <div class="stats-score-row">
          <div class="stats-score-label">GG –</div>
          <input class="stats-score-input" type="number" min="0" max="99" id="statsGoalsFor"
            value="${resolvedGoalsFor !== null ? resolvedGoalsFor : ""}" placeholder="?" />
          <div class="stats-score-sep">–</div>
          <input class="stats-score-input" type="number" min="0" max="99" id="statsGoalsAgainst"
            value="${resolvedGoalsAgainst !== null ? resolvedGoalsAgainst : ""}" placeholder="?" />
          ${resolvedGoalsFor !== null && !savedMatch ? `<span class="stats-score-knhb-badge">KNHB</span>` : ""}
        </div>
      </div>

      <div class="stats-field-section">
        <div class="stats-field-label">Man of the Match ⭐</div>
        <div class="stats-chips-wrap" id="chips_motm"></div>
        <div class="stats-add-row">
          <input class="stats-player-input" type="text" list="statsPlayerList" placeholder="Speler…" id="input_motm" autocomplete="off"
            onkeydown="if(event.key==='Enter'){event.preventDefault();statsSetMotm()}" />
          <button class="mini-button" type="button" onclick="statsSetMotm()">Stel in</button>
        </div>
      </div>

      ${playerChipsHtml("Doelpunten ⚽", "goals", true)}
      ${playerChipsHtml("Eigen doelpunten 😬", "ownGoals", true)}
      ${playerChipsHtml("Assists 🎯", "assists", true)}
      ${playerChipsHtml("Gele kaart 🟨", "geleKaart", false)}
      ${playerChipsHtml("Groene kaart 🟩", "groeneKaart", false)}

      <div class="stats-action-row">
        <button class="lineup-save-btn stats-save-btn" type="button" onclick="statsSaveMatch()">Opslaan</button>
        ${hasSaved ? `<button class="stats-delete-btn" type="button" onclick="statsDeleteMatch()">Wis wedstrijd</button>` : ""}
      </div>
      <div class="lineup-status" id="statsEditorStatus"></div>
    </div>
  `;

  // Populate chips from saved match data if it exists
  statsRenderMotmChip(savedMatch?.motm || "");
  statsRenderCountChips("goals", savedMatch?.goals || []);
  statsRenderCountChips("ownGoals", savedMatch?.ownGoals || []);
  statsRenderCountChips("assists", savedMatch?.assists || []);
  statsRenderNameChips("geleKaart", savedMatch?.geleKaart || []);
  statsRenderNameChips("groeneKaart", savedMatch?.groeneKaart || []);
}

function statsResolveCurrentMatch() {
  const spondMatches = pastSpondMatches || [];

  if (!statsEditorMatchId || statsEditorMatchId === "__new__") {
    return { date: new Date().toISOString().slice(0, 10), opponent: "", goalsFor: null, goalsAgainst: null, savedMatch: null };
  }

  if (statsEditorMatchId.startsWith("spond_")) {
    const spondId = statsEditorMatchId.slice(6);
    const spond = spondMatches.find(m => m.id === spondId);
    const savedMatch = spond ? statsData.matches.find(m => m.date === spond.date) : null;
    return {
      date: spond?.date || new Date().toISOString().slice(0, 10),
      opponent: savedMatch?.opponent || spond?.opponent || "",
      goalsFor: savedMatch?.goalsFor ?? spond?.goalsFor ?? null,
      goalsAgainst: savedMatch?.goalsAgainst ?? spond?.goalsAgainst ?? null,
      savedMatch
    };
  }

  const savedMatch = statsData.matches.find(m => m.matchId === statsEditorMatchId);
  return {
    date: savedMatch?.date || new Date().toISOString().slice(0, 10),
    opponent: savedMatch?.opponent || "",
    goalsFor: savedMatch?.goalsFor ?? null,
    goalsAgainst: savedMatch?.goalsAgainst ?? null,
    savedMatch
  };
}

function statsSelectMatch(val) {
  statsEditorMatchId = val;
  renderStatsEditor();
  // Scroll editor to top so stat fields are visible
  const body = document.getElementById("statsEditorBody");
  if (body) body.scrollTop = 0;
}

function statsRenderMotmChip(name) {
  const wrap = document.getElementById("chips_motm");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!name) return;
  const chip = document.createElement("div");
  chip.className = "stats-chip motm-chip";
  chip.textContent = name + " ⭐";
  chip.onclick = () => { statsRenderMotmChip(null); };
  wrap.appendChild(chip);
  const input = document.getElementById("input_motm");
  if (input) input.value = "";
}

function statsSetMotm() {
  const input = document.getElementById("input_motm");
  if (!input || !input.value.trim()) return;
  statsRenderMotmChip(input.value.trim());
}

function statsRenderCountChips(fieldId, items) {
  const wrap = document.getElementById("chips_" + fieldId);
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const item of items) {
    statsAddCountChipEl(wrap, fieldId, item.player, item.count || 1);
  }
}

function statsAddCountChipEl(wrap, fieldId, player, count) {
  const chip = document.createElement("div");
  chip.className = "stats-chip";
  chip.dataset.player = player;
  chip.dataset.count = count;
  chip.innerHTML = `<span>${escapeHtml(player)}</span><span class="stats-chip-count">${count}x</span><span class="stats-chip-remove">×</span>`;
  chip.querySelector(".stats-chip-remove").onclick = () => chip.remove();
  chip.querySelector(".stats-chip-count").onclick = () => {
    const cur = parseInt(chip.dataset.count) || 1;
    const next = cur < 20 ? cur + 1 : 1;
    chip.dataset.count = next;
    chip.querySelector(".stats-chip-count").textContent = next + "x";
  };
  wrap.appendChild(chip);
}

function statsAddChip(fieldId, withCount) {
  const input = document.getElementById("input_" + fieldId);
  const wrap = document.getElementById("chips_" + fieldId);
  if (!input || !wrap) return;
  const name = input.value.trim();
  if (!name) return;

  if (withCount) {
    const countInput = document.getElementById("count_" + fieldId);
    const count = parseInt(countInput?.value) || 1;
    // Check if player already exists — update count instead
    const existing = wrap.querySelector(`[data-player="${CSS.escape(name)}"]`);
    if (existing) {
      const cur = parseInt(existing.dataset.count) || 1;
      const next = Math.min(20, cur + count);
      existing.dataset.count = next;
      existing.querySelector(".stats-chip-count").textContent = next + "x";
    } else {
      statsAddCountChipEl(wrap, fieldId, name, count);
    }
  } else {
    // Toggle (no duplicates)
    const existing = [...wrap.querySelectorAll(".stats-chip")].find(c => c.dataset.player === name);
    if (existing) { existing.remove(); }
    else {
      const chip = document.createElement("div");
      chip.className = "stats-chip";
      chip.dataset.player = name;
      chip.textContent = name;
      const rem = document.createElement("span");
      rem.className = "stats-chip-remove";
      rem.textContent = " ×";
      rem.onclick = () => chip.remove();
      chip.appendChild(rem);
      wrap.appendChild(chip);
    }
  }

  input.value = "";
  const countInput = document.getElementById("count_" + fieldId);
  if (countInput) countInput.value = 1;
}

function statsRenderNameChips(fieldId, names) {
  const wrap = document.getElementById("chips_" + fieldId);
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const name of names) {
    const chip = document.createElement("div");
    chip.className = "stats-chip";
    chip.dataset.player = name;
    chip.textContent = name;
    const rem = document.createElement("span");
    rem.className = "stats-chip-remove";
    rem.textContent = " ×";
    rem.onclick = () => chip.remove();
    chip.appendChild(rem);
    wrap.appendChild(chip);
  }
}

function statsReadChipsCount(fieldId) {
  const wrap = document.getElementById("chips_" + fieldId);
  if (!wrap) return [];
  return [...wrap.querySelectorAll(".stats-chip")].map(c => ({
    player: c.dataset.player,
    count: parseInt(c.dataset.count) || 1
  })).filter(x => x.player);
}

function statsReadChipsNames(fieldId) {
  const wrap = document.getElementById("chips_" + fieldId);
  if (!wrap) return [];
  return [...wrap.querySelectorAll(".stats-chip")].map(c => c.dataset.player).filter(Boolean);
}

function statsReadMotm() {
  const wrap = document.getElementById("chips_motm");
  if (!wrap) return "";
  const chip = wrap.querySelector(".stats-chip");
  return chip ? (chip.dataset.player || chip.textContent.replace(" ⭐", "").trim()) : "";
}

async function statsSaveMatch() {
  const statusEl = document.getElementById("statsEditorStatus");
  const dateInput = document.getElementById("statsMatchDate");
  const opponentInput = document.getElementById("statsMatchOpponent");
  const date = dateInput?.value;
  const opponent = opponentInput?.value?.trim() || "";

  if (!date) { statusEl.textContent = "Kies een datum."; statusEl.style.color = "#ff5c5c"; return; }

  // Determine spondId if this is a Spond-sourced match
  let spondId = null;
  if (statsEditorMatchId && statsEditorMatchId.startsWith("spond_")) {
    spondId = statsEditorMatchId.slice(6);
  }

  const matchId = date; // always use date as stable ID
  const seasonYear = getSeasonYear(date);
  const motm = statsReadMotm();
  const goals = statsReadChipsCount("goals");
  const ownGoals = statsReadChipsCount("ownGoals");
  const assists = statsReadChipsCount("assists");
  const geleKaart = statsReadChipsNames("geleKaart");
  const groeneKaart = statsReadChipsNames("groeneKaart");

  const goalsForRaw = document.getElementById("statsGoalsFor")?.value;
  const goalsAgainstRaw = document.getElementById("statsGoalsAgainst")?.value;
  const goalsFor = goalsForRaw !== "" && goalsForRaw !== undefined ? Number(goalsForRaw) : null;
  const goalsAgainst = goalsAgainstRaw !== "" && goalsAgainstRaw !== undefined ? Number(goalsAgainstRaw) : null;

  const matchStats = { matchId, date, opponent, seasonYear, spondId, goalsFor, goalsAgainst, motm, goals, ownGoals, assists, geleKaart, groeneKaart };

  statusEl.textContent = "Opslaan…";
  statusEl.style.color = "#ffcc00";

  try {
    const res = await fetch(STATS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ password: statsPassword, matchStats })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

    statusEl.textContent = "Opgeslagen! ✓";
    statusEl.style.color = "#46d369";

    // Update local data
    const idx = statsData.matches.findIndex(m => m.matchId === matchId);
    const entry = { ...matchStats, updatedAt: new Date().toISOString() };
    if (idx >= 0) statsData.matches[idx] = entry; else statsData.matches.push(entry);
    statsData.matches.sort((a, b) => b.date.localeCompare(a.date));

    // Switch selector to saved-match view so "stats al opgeslagen" indicator shows
    statsEditorMatchId = matchId;
    statsViewingSeason = seasonYear;
    renderStatsCard();
    renderStatsEditor();

    setTimeout(() => {
      const s = document.getElementById("statsEditorStatus");
      if (s) { s.textContent = ""; s.style.color = ""; }
    }, 3000);
  } catch (err) {
    statusEl.textContent = "Fout: " + err.message;
    statusEl.style.color = "#ff5c5c";
    if (err.message.includes("wachtwoord") || err.message.includes("401")) statsPassword = null;
  }
}

async function statsDeleteMatch() {
  const { savedMatch } = statsResolveCurrentMatch();
  if (!savedMatch) return;

  const matchId = savedMatch.matchId;
  const label = savedMatch.date + (savedMatch.opponent ? " – " + savedMatch.opponent : "");

  if (!confirm(`Statistieken wissen voor ${label}? Dit kan niet ongedaan worden gemaakt.`)) return;

  const statusEl = document.getElementById("statsEditorStatus");
  if (statusEl) { statusEl.textContent = "Wissen…"; statusEl.style.color = "#ffcc00"; }

  try {
    const res = await fetch(STATS_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ password: statsPassword, matchId })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

    // Remove from local data
    statsData.matches = statsData.matches.filter(m => m.matchId !== matchId);

    // Stay on the same Spond entry (just no saved data now), or switch to new
    if (statsEditorMatchId === matchId) {
      // Find corresponding Spond entry if exists
      const spondEntry = (pastSpondMatches || []).find(m => m.date === matchId);
      if (spondEntry) {
        statsEditorMatchId = "spond_" + spondEntry.id;
      } else {
        statsEditorMatchId = "__new__";
      }
    }

    statsViewingSeason = getSeasonYear(matchId);
    renderStatsCard();
    renderStatsEditor();
  } catch (err) {
    if (statusEl) { statusEl.textContent = "Wissen mislukt: " + err.message; statusEl.style.color = "#ff5c5c"; }
    if (err.message.includes("wachtwoord") || err.message.includes("401")) statsPassword = null;
  }
}

/* --- Expanded stats --- */

function openExpandedStats(playerName) {
  const sheet = document.getElementById("statsExpandedSheet");
  if (!sheet) return;

  document.getElementById("expandedStatsTitle").textContent = playerName;

  renderExpandedStats(playerName);

  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeExpandedStats() {
  const sheet = document.getElementById("statsExpandedSheet");
  if (!sheet) return;
  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";

  for (const ch of expandedStatsCharts) {
    try { ch.destroy(); } catch {}
  }
  expandedStatsCharts = [];
}

function renderExpandedStats(playerName) {
  const body = document.getElementById("statsExpandedBody");
  if (!body) return;

  const currentSeason = statsViewingSeason || getSeasonYear();
  const seasons = getAvailableSeasons();

  const seasonMatches = getMatchesForSeason(currentSeason);
  const allMatches = [...statsData.matches].sort((a, b) => a.date.localeCompare(b.date));

  function playerGoals(m) { return (m.goals || []).filter(g => g.player === playerName).reduce((s, g) => s + (g.count || 1), 0); }
  function playerAssists(m) { return (m.assists || []).filter(a => a.player === playerName).reduce((s, a) => s + (a.count || 1), 0); }
  function playerOwnGoals(m) { return (m.ownGoals || []).filter(g => g.player === playerName).reduce((s, g) => s + (g.count || 1), 0); }
  function playerGeel(m) { return (m.geleKaart || []).includes(playerName) ? 1 : 0; }
  function playerGroen(m) { return (m.groeneKaart || []).includes(playerName) ? 1 : 0; }
  function playerMotm(m) { return m.motm === playerName ? 1 : 0; }
  function playerInMatch(m) {
    return playerGoals(m) + playerAssists(m) + playerOwnGoals(m) + playerGeel(m) + playerGroen(m) + playerMotm(m) > 0;
  }

  const seasonGoals = seasonMatches.reduce((s, m) => s + playerGoals(m), 0);
  const seasonAssists = seasonMatches.reduce((s, m) => s + playerAssists(m), 0);
  const seasonMotm = seasonMatches.reduce((s, m) => s + playerMotm(m), 0);
  const seasonGeel = seasonMatches.reduce((s, m) => s + playerGeel(m), 0);
  const seasonGroen = seasonMatches.reduce((s, m) => s + playerGroen(m), 0);
  const seasonOwnGoals = seasonMatches.reduce((s, m) => s + playerOwnGoals(m), 0);
  const seasonGames = seasonMatches.filter(m => playerInMatch(m)).length;

  // All-time stats
  const allGoals = allMatches.reduce((s, m) => s + playerGoals(m), 0);
  const allAssists = allMatches.reduce((s, m) => s + playerAssists(m), 0);
  const allMotm = allMatches.reduce((s, m) => s + playerMotm(m), 0);

  // Per-match arrays for charts (current season, sorted by date)
  const smSorted = [...seasonMatches].sort((a, b) => a.date.localeCompare(b.date));
  const matchLabels = smSorted.map(m => {
    const d = new Date(m.date + "T12:00:00");
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  });
  const goalsPerMatch = smSorted.map(m => playerGoals(m));
  const assistsPerMatch = smSorted.map(m => playerAssists(m));
  const cumulativeGoals = goalsPerMatch.reduce((acc, v) => { acc.push((acc.at(-1) || 0) + v); return acc; }, []);
  const cumulativeAssists = assistsPerMatch.reduce((acc, v) => { acc.push((acc.at(-1) || 0) + v); return acc; }, []);

  // Season-by-season for all-time chart
  const seasonGoalsHistory = seasons.map(y => {
    const ms = getMatchesForSeason(y);
    return { season: seasonLabel(y), goals: ms.reduce((s, m) => s + playerGoals(m), 0), assists: ms.reduce((s, m) => s + playerAssists(m), 0) };
  }).reverse();

  const formMatches = smSorted.slice(-5);
  const formHtml = formMatches.length === 0 ? '<span style="color:#a1a1a6">Geen data</span>' : formMatches.map(m => {
    const g = playerGoals(m);
    const a = playerAssists(m);
    const motm = playerMotm(m);
    let icon = "⬜";
    if (motm) icon = "⭐";
    else if (g > 0 && a > 0) icon = "🔥";
    else if (g > 0) icon = "⚽";
    else if (a > 0) icon = "🎯";
    else if (playerGeel(m)) icon = "🟨";
    else if (playerGroen(m)) icon = "🟩";
    else if (playerInMatch(m)) icon = "🏑";
    const label = new Date(m.date + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    return `<div class="form-dot" title="${label}: ${g}G ${a}A">${icon}</div>`;
  }).join("");

  body.innerHTML = `
    <div class="expanded-stats-body">
      <div class="expanded-season-label">${seasonLabel(currentSeason)}</div>

      <div class="expanded-big-stats">
        <div class="expanded-big-stat"><div class="expanded-big-num">${seasonGoals}</div><div class="expanded-big-label">GOALS</div></div>
        <div class="expanded-big-stat"><div class="expanded-big-num">${seasonAssists}</div><div class="expanded-big-label">ASSISTS</div></div>
        <div class="expanded-big-stat"><div class="expanded-big-num">${seasonMotm}</div><div class="expanded-big-label">MOTM ⭐</div></div>
        <div class="expanded-big-stat"><div class="expanded-big-num">${seasonGames}</div><div class="expanded-big-label">WEDSTR.</div></div>
      </div>

      ${(() => {
        const wdl = seasonMatches.filter(m => m.goalsFor !== null && m.goalsAgainst !== null);
        if (!wdl.length) return "";
        const W = wdl.filter(m => m.goalsFor > m.goalsAgainst).length;
        const D = wdl.filter(m => m.goalsFor === m.goalsAgainst).length;
        const L = wdl.filter(m => m.goalsFor < m.goalsAgainst).length;
        const gf = wdl.reduce((s, m) => s + m.goalsFor, 0);
        const ga = wdl.reduce((s, m) => s + m.goalsAgainst, 0);
        return `<div class="expanded-record-row">
          <span class="record-w">${W}W</span>
          <span class="record-sep">·</span>
          <span class="record-d">${D}G</span>
          <span class="record-sep">·</span>
          <span class="record-l">${L}V</span>
          <span class="record-sep">·</span>
          <span class="record-gd">${gf}–${ga}</span>
        </div>`;
      })()}

      ${(seasonGeel || seasonGroen || seasonOwnGoals) ? `<div class="expanded-cards-row">
        ${seasonGeel ? `<span class="expanded-card-badge yellow">🟨 ${seasonGeel}×</span>` : ""}
        ${seasonGroen ? `<span class="expanded-card-badge green">🟩 ${seasonGroen}×</span>` : ""}
        ${seasonOwnGoals ? `<span class="expanded-card-badge own">😬 ${seasonOwnGoals} EG</span>` : ""}
      </div>` : ""}

      <div class="expanded-section-title">Vorm (laatste 5)</div>
      <div class="form-row">${formHtml}</div>

      ${smSorted.length >= 2 ? `
      <div class="expanded-section-title">Goals & Assists — ${seasonLabel(currentSeason)}</div>
      <div class="expanded-chart-wrap"><canvas id="chartGoalsAssists"></canvas></div>

      <div class="expanded-section-title">Cumulatief dit seizoen</div>
      <div class="expanded-chart-wrap"><canvas id="chartCumulative"></canvas></div>
      ` : ""}

      ${seasonGoals > 0 && seasonMatches.length > 0 ? `
      <div class="expanded-section-title">Doelpunten per wedstrijd</div>
      <div class="expanded-chart-wrap"><canvas id="chartGoalBar"></canvas></div>
      ` : ""}

      ${seasons.length > 1 ? `
      <div class="expanded-section-title">All-time per seizoen</div>
      <div class="expanded-chart-wrap"><canvas id="chartAllTime"></canvas></div>
      ` : ""}

      <div class="expanded-section-title">All-time totaal</div>
      <div class="expanded-alltime-grid">
        <div class="expanded-alltime-item"><span class="expanded-alltime-num">${allGoals}</span><span class="expanded-alltime-label">goals</span></div>
        <div class="expanded-alltime-item"><span class="expanded-alltime-num">${allAssists}</span><span class="expanded-alltime-label">assists</span></div>
        <div class="expanded-alltime-item"><span class="expanded-alltime-num">${allMotm}</span><span class="expanded-alltime-label">MOTM</span></div>
      </div>

      <div class="expanded-match-log">
        <div class="expanded-section-title">Wedstrijdlog</div>
        ${smSorted.slice().reverse().map(m => {
          const g = playerGoals(m);
          const a = playerAssists(m);
          const og = playerOwnGoals(m);
          const geel = playerGeel(m);
          const groen = playerGroen(m);
          const motm = playerMotm(m);
          if (!playerInMatch(m)) return "";
          const bits = [];
          if (g) bits.push(`${g} ⚽`);
          if (a) bits.push(`${a} 🎯`);
          if (og) bits.push(`${og} 😬`);
          if (geel) bits.push("🟨");
          if (groen) bits.push("🟩");
          if (motm) bits.push("⭐ MOTM");
          const d = new Date(m.date + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
          const scoreStr = (m.goalsFor !== null && m.goalsAgainst !== null)
            ? `${m.goalsFor}–${m.goalsAgainst}` : "";
          const scoreClass = scoreStr
            ? (m.goalsFor > m.goalsAgainst ? "match-log-score win"
               : m.goalsFor < m.goalsAgainst ? "match-log-score loss"
               : "match-log-score draw")
            : "";
          return `<div class="match-log-row">
            <span class="match-log-date">${d}</span>
            <span class="match-log-opp">${escapeHtml(m.opponent || "?")}</span>
            ${scoreStr ? `<span class="${scoreClass}">${scoreStr}</span>` : ""}
            <span class="match-log-stats">${bits.join(" · ")}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;

  // Render charts after DOM is painted
  setTimeout(() => {
    const chartDefaults = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#d8d8dc", font: { weight: "bold", size: 11 } } } },
      scales: {
        x: { ticks: { color: "#a1a1a6", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.07)" } },
        y: { ticks: { color: "#a1a1a6", font: { size: 10 }, stepSize: 1 }, grid: { color: "rgba(255,255,255,0.07)" }, beginAtZero: true }
      }
    };

    if (smSorted.length >= 2) {
      const ctx1 = document.getElementById("chartGoalsAssists");
      if (ctx1) {
        expandedStatsCharts.push(new Chart(ctx1, {
          type: "bar",
          data: {
            labels: matchLabels,
            datasets: [
              { label: "Goals", data: goalsPerMatch, backgroundColor: "rgba(70,211,105,0.75)", borderRadius: 4 },
              { label: "Assists", data: assistsPerMatch, backgroundColor: "rgba(255,204,0,0.65)", borderRadius: 4 }
            ]
          },
          options: { ...chartDefaults }
        }));
      }

      const ctx2 = document.getElementById("chartCumulative");
      if (ctx2) {
        expandedStatsCharts.push(new Chart(ctx2, {
          type: "line",
          data: {
            labels: matchLabels,
            datasets: [
              { label: "Goals", data: cumulativeGoals, borderColor: "#46d369", backgroundColor: "rgba(70,211,105,0.12)", fill: true, tension: 0.3, pointRadius: 4 },
              { label: "Assists", data: cumulativeAssists, borderColor: "#ffcc00", backgroundColor: "rgba(255,204,0,0.08)", fill: true, tension: 0.3, pointRadius: 4 }
            ]
          },
          options: { ...chartDefaults }
        }));
      }

      if (seasonGoals > 0) {
        const ctx3 = document.getElementById("chartGoalBar");
        if (ctx3) {
          expandedStatsCharts.push(new Chart(ctx3, {
            type: "bar",
            data: {
              labels: matchLabels,
              datasets: [
                { label: "Doelpunten", data: goalsPerMatch, backgroundColor: goalsPerMatch.map(v => v > 0 ? "rgba(70,211,105,0.8)" : "rgba(255,255,255,0.1)"), borderRadius: 4 }
              ]
            },
            options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } } }
          }));
        }
      }
    }

    if (seasons.length > 1) {
      const ctx4 = document.getElementById("chartAllTime");
      if (ctx4) {
        expandedStatsCharts.push(new Chart(ctx4, {
          type: "bar",
          data: {
            labels: seasonGoalsHistory.map(s => s.season),
            datasets: [
              { label: "Goals", data: seasonGoalsHistory.map(s => s.goals), backgroundColor: "rgba(70,211,105,0.75)", borderRadius: 4 },
              { label: "Assists", data: seasonGoalsHistory.map(s => s.assists), backgroundColor: "rgba(255,204,0,0.65)", borderRadius: 4 }
            ]
          },
          options: { ...chartDefaults }
        }));
      }
    }
  }, 50);
}

init();

/* =========================
   POULESTAND
========================= */

const STANDINGS_URL = "./data/standings.json";

async function loadStandings() {
  const body = document.getElementById("standingsBody");
  if (!body) return;

  try {
    const res = await fetch(STANDINGS_URL, { cache: "no-store" });
    const data = await res.json();

    if (data.error) {
      body.innerHTML = `<div class="lineup-meta">Kon poulestand niet laden: ${escapeHtml(data.error)}</div>`;
      return;
    }

    // Season selector removed — standings.json is a static snapshot of the
    // current poule only (generated periodically by scripts/fetch-data.js),
    // there's no live backend left to fetch a different season on demand.
    const sel = document.getElementById("standingsSeasonSelect");
    if (sel) sel.style.display = "none";

    if (!data.standings || data.standings.length === 0) {
      body.innerHTML = `<div class="lineup-meta">Geen stand beschikbaar.</div>`;
      return;
    }

    const compLabel = data.competition
      ? `<div class="standings-competition">${escapeHtml(data.competition)}</div>`
      : "";

    const fmt = v => (v !== null && v !== undefined) ? v : "-";

    let html = compLabel + `
      <table class="standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th class="standings-team-col">Team</th>
            <th title="Gespeeld">GS</th>
            <th title="Gewonnen">GW</th>
            <th title="Gelijk">GL</th>
            <th title="Verloren">VL</th>
            <th title="Punten in mindering">PIM</th>
            <th title="Punten">PT</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const s of data.standings) {
      const isGG = s.team_id === 3781 ||
        (s.team_name || "").toLowerCase().includes("h15");
      const rowClass = isGG ? ' class="standings-gg"' : "";
      const pim = s.points_deducted > 0 ? s.points_deducted : "-";
      html += `
        <tr${rowClass}>
          <td>${fmt(s.rank)}</td>
          <td class="standings-team-name">${escapeHtml(s.team_name || "?")}</td>
          <td>${fmt(s.played)}</td>
          <td>${fmt(s.won)}</td>
          <td>${fmt(s.drawn)}</td>
          <td>${fmt(s.lost)}</td>
          <td>${pim}</td>
          <td class="standings-pt">${fmt(s.points)}</td>
        </tr>
      `;
    }

    html += `</tbody></table>`;
    body.innerHTML = html;

  } catch (e) {
    body.innerHTML = `<div class="lineup-meta">Fout bij laden van poulestand.</div>`;
  }
}

/* =========================
   RIETADT RUSSIAN ROULETTE
========================= */

function initRoulette() {
  const button = document.getElementById("rouletteButton");
  const arena = document.getElementById("rouletteArena");
  if (!button || !arena) return;

  button.addEventListener("pointerdown", handleRouletteButtonDown);
  arena.addEventListener("pointerdown", handleRouletteArenaPointerDown);
  arena.addEventListener("pointermove", handleRouletteArenaPointerMove);
  arena.addEventListener("pointerup", handleRouletteArenaPointerUp);
  arena.addEventListener("pointercancel", handleRouletteArenaPointerUp);
}

function openRoulette() {
  const sheet = document.getElementById("rouletteSheet");
  if (!sheet) return;

  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeRoulette() {
  const sheet = document.getElementById("rouletteSheet");
  if (!sheet) return;

  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  resetRoulette();
}

function handleRouletteButtonDown(e) {
  if (roulettePhase !== "idle") return;
  e.preventDefault();

  startRouletteCountdown();
  registerRoulettePointer(e);
}

function handleRouletteArenaPointerDown(e) {
  if (roulettePhase !== "collecting") return;
  if (rouletteTouches.has(e.pointerId)) return;

  registerRoulettePointer(e);
}

function handleRouletteArenaPointerMove(e) {
  const touch = rouletteTouches.get(e.pointerId);
  if (!touch) return;

  const arena = document.getElementById("rouletteArena");
  const rect = arena.getBoundingClientRect();
  touch.ringEl.style.left = `${e.clientX - rect.left}px`;
  touch.ringEl.style.top = `${e.clientY - rect.top}px`;
}

function handleRouletteArenaPointerUp(e) {
  const touch = rouletteTouches.get(e.pointerId);
  if (!touch) return;

  removeRouletteRing(e.pointerId, touch);

  if (roulettePhase === "result" && rouletteTouches.size === 0) {
    finishRoulette();
  }
}

function registerRoulettePointer(e) {
  const arena = document.getElementById("rouletteArena");
  if (!arena) return;

  const color = ROULETTE_COLORS[rouletteColorCursor % ROULETTE_COLORS.length];
  rouletteColorCursor += 1;

  const rect = arena.getBoundingClientRect();
  const ring = document.createElement("div");
  ring.className = "roulette-finger-ring";
  ring.style.borderColor = color;
  ring.style.boxShadow = `0 0 16px ${color}`;
  ring.style.left = `${e.clientX - rect.left}px`;
  ring.style.top = `${e.clientY - rect.top}px`;
  arena.appendChild(ring);

  rouletteTouches.set(e.pointerId, { ringEl: ring, color });
}

function removeRouletteRing(pointerId, touch) {
  rouletteTouches.delete(pointerId);

  touch.ringEl.classList.add("roulette-fading");
  setTimeout(() => touch.ringEl.remove(), 350);
}

function startRouletteCountdown() {
  roulettePhase = "collecting";

  const instructions = document.getElementById("rouletteInstructions");
  const button = document.getElementById("rouletteButton");
  const label = document.getElementById("rouletteButtonLabel");
  if (instructions) instructions.classList.add("roulette-hidden");
  if (button) button.classList.add("roulette-counting");

  rouletteCountdownValue = ROULETTE_COUNTDOWN_SECONDS;
  if (label) label.textContent = String(rouletteCountdownValue);

  clearInterval(rouletteCountdownTimer);
  rouletteCountdownTimer = setInterval(() => {
    rouletteCountdownValue -= 1;

    if (rouletteCountdownValue <= 0) {
      clearInterval(rouletteCountdownTimer);
      resolveRouletteWinner();
      return;
    }

    if (label) label.textContent = String(rouletteCountdownValue);
  }, 1000);
}

function resolveRouletteWinner() {
  roulettePhase = "result";

  const entries = Array.from(rouletteTouches.entries());
  if (entries.length === 0) {
    resetRoulette();
    return;
  }

  const winnerIndex = randomInt(0, entries.length - 1);
  const [winnerId, winnerTouch] = entries[winnerIndex];

  entries.forEach(([pointerId, touch]) => {
    if (pointerId === winnerId) return;
    removeRouletteRing(pointerId, touch);
  });

  winnerTouch.ringEl.classList.add("roulette-winner");

  const button = document.getElementById("rouletteButton");
  if (button) button.classList.add("roulette-result-active");

  const result = document.getElementById("rouletteResult");
  const swatch = document.getElementById("rouletteResultSwatch");
  if (swatch) {
    swatch.style.background = winnerTouch.color;
    swatch.style.color = winnerTouch.color;
  }
  if (result) result.style.display = "flex";

  const arena = document.getElementById("rouletteArena");
  const rect = arena.getBoundingClientRect();
  const winnerX = parseFloat(winnerTouch.ringEl.style.left) || rect.width / 2;
  const winnerY = parseFloat(winnerTouch.ringEl.style.top) || rect.height / 2;
  fireRouletteConfetti(winnerX, winnerY, winnerTouch.color);

  clearTimeout(rouletteFinishTimer);
  rouletteFinishTimer = setTimeout(finishRoulette, ROULETTE_END_HOLD_MS);
}

function finishRoulette() {
  clearTimeout(rouletteFinishTimer);
  clearInterval(rouletteCountdownTimer);

  rouletteTouches.forEach((touch) => touch.ringEl.remove());
  rouletteTouches.clear();

  const instructions = document.getElementById("rouletteInstructions");
  const button = document.getElementById("rouletteButton");
  const label = document.getElementById("rouletteButtonLabel");
  const result = document.getElementById("rouletteResult");
  if (instructions) instructions.classList.remove("roulette-hidden");
  if (button) button.classList.remove("roulette-counting", "roulette-result-active");
  if (label) label.textContent = "DRUK";
  if (result) result.style.display = "none";

  roulettePhase = "idle";
}

function resetRoulette() {
  finishRoulette();
}

function fireRouletteConfetti(x, y, color) {
  const canvas = document.getElementById("rouletteConfettiCanvas");
  const arena = document.getElementById("rouletteArena");
  if (!canvas || !arena) return;

  const rect = arena.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");

  const confettiColors = [color, "#ffd60a", "#46d369", "#4da3ff", "#e05cff", "#ffffff"];
  const particles = [];
  for (let i = 0; i < 70; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 4 + Math.random() * 5,
      color: confettiColors[randomInt(0, confettiColors.length - 1)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.4,
      life: 1,
    });
  }

  const gravity = 0.15;
  const startTime = performance.now();
  const duration = 1500;

  function step(now) {
    const elapsed = now - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach((p) => {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      p.life = Math.max(0, 1 - elapsed / duration);

      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });

    if (elapsed < duration) {
      requestAnimationFrame(step);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  requestAnimationFrame(step);
}

let data = window.KUNTULIZATOR_DATA;
let refreshTimerId = null;
let currentReviewPayload = null;
let currentSubmitRoundKey = data.settings.defaultSubmitRoundKey || data.settings.rounds?.[0]?.key || "r1";
let currentMatchesRoundKey = null;
let currentPredictionRoundKey = null;

const byId = (id) => document.getElementById(id);
const e = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
const fmt = (n) => Number(n || 0).toFixed(data.settings.decimalPlaces || 2);
const pct = (part, total) => total ? `${Math.round((part / total) * 100)}%` : "—";
const outcome = (h, a) => h > a ? "home" : h < a ? "away" : "draw";

function clean(value) { return String(value ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim(); }
function normName(value) { return clean(value).toLowerCase(); }
function parseScore(value) {
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.replace(/[—–]/g, "-").replace(/[.:,]/g, "-").replace(/\s+/g, "");
  const match = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ""; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch === '\r') {}
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function splitTeams(title) {
  const normalized = clean(title);
  const parts = normalized.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) return { home: parts[0].trim(), away: parts.slice(1).join(" — ").trim() };
  return { home: normalized, away: "" };
}
function roundByKey(key) { return (data.settings.rounds || []).find(r => r.key === key) || null; }
function roundOrder(key) { return Number(roundByKey(key)?.order || 999); }
function getRoundDeadline(roundKey) {
  const value = roundByKey(roundKey)?.deadline;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}
function isRoundRevealed(roundKey) {
  if (!data.settings.hidePredictionsUntilDeadline) return true;
  const deadline = getRoundDeadline(roundKey);
  if (!deadline) return true;
  return Date.now() >= deadline.getTime();
}
function formatDeadline(roundKey) {
  const d = getRoundDeadline(roundKey);
  if (!d) return "дедлайн не задан";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function getDefaultViewRoundKey() {
  const rounds = (data.settings.rounds || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  if (!rounds.length) return "r1";
  const revealed = rounds.filter(r => isRoundRevealed(r.key));
  return (revealed[revealed.length - 1] || rounds[0]).key;
}
function getSafeRoundKey(value) {
  return (data.settings.rounds || []).some(r => r.key === value) ? value : getDefaultViewRoundKey();
}
function renderRoundSelect(select, value) {
  if (!select) return getSafeRoundKey(value);
  const selected = getSafeRoundKey(value);
  select.innerHTML = (data.settings.rounds || []).map(r => `<option value="${e(r.key)}">${e(r.title)}</option>`).join("");
  select.value = selected;
  return selected;
}
function matchTitle(match) { return `${match.home} — ${match.away}`; }
function participantName(id) { return data.participants.find(p => p.id === id)?.name || id; }
function participantIdByName(name) { return data.participants.find(p => normName(p.name) === normName(name))?.id || null; }
function getRoundMatches(roundKey) { return data.matches.filter(m => m.roundKey === roundKey); }
function getPredictions(matchId) { return data.predictions.filter(p => p.matchId === matchId); }
function getParticipantPredictionsInRound(participantId, roundKey) { return data.predictions.filter(p => p.participantId === participantId && p.roundKey === roundKey); }
function getParticipantMeta(name) { return data.settings.participantMeta?.[name] || {}; }
function getActiveFromRoundKey(name) { return getParticipantMeta(name).activeFromRoundKey || data.settings.rounds?.[0]?.key || "r1"; }
function getActiveFromMatchTitle(name) { return getParticipantMeta(name).activeFromMatchTitle || null; }
function isParticipantActiveInRound(name, roundKey) { return roundOrder(getActiveFromRoundKey(name)) <= roundOrder(roundKey); }
function findMatchIndexByTitle(roundKey, title) {
  if (!title) return -1;
  const target = normName(title);
  return getRoundMatches(roundKey).findIndex(m => normName(matchTitle(m)) === target);
}
function isParticipantActiveForMatch(name, match) {
  if (!match) return false;
  const fromRound = getActiveFromRoundKey(name);
  const fromOrder = roundOrder(fromRound);
  const matchRoundOrder = roundOrder(match.roundKey);
  if (fromOrder < matchRoundOrder) return true;
  if (fromOrder > matchRoundOrder) return false;
  const fromMatchTitle = getActiveFromMatchTitle(name);
  if (!fromMatchTitle) return true;
  const joinIndex = findMatchIndexByTitle(match.roundKey, fromMatchTitle);
  if (joinIndex === -1) return true;
  const matchIndex = getRoundMatches(match.roundKey).findIndex(m => m.id === match.id);
  return matchIndex >= joinIndex;
}
function getActiveParticipants(roundKey) {
  return data.participants.filter(p => {
    if (!isParticipantActiveInRound(p.name, roundKey)) return false;
    const fromRound = getActiveFromRoundKey(p.name);
    if (roundOrder(fromRound) !== roundOrder(roundKey)) return true;
    // Если участник вошёл внутри тура, он всё равно показывается в форме тура,
    // но заполняет только матчи начиная с момента входа.
    return true;
  });
}
function getActiveParticipantsForMatch(match) { return data.participants.filter(p => isParticipantActiveForMatch(p.name, match)); }
function getSubmissionMatchesForParticipant(name, roundKey) { return getRoundMatches(roundKey).filter(m => isParticipantActiveForMatch(name, m)); }
function getMatchById(matchId) { return data.matches.find(m => m.id === matchId) || null; }
function hasCompleteRoundSubmission(participantId, roundKey) {
  const name = participantName(participantId);
  const expected = getSubmissionMatchesForParticipant(name, roundKey).length;
  if (!expected) return false;
  const actual = getParticipantPredictionsInRound(participantId, roundKey)
    .filter(p => isParticipantActiveForMatch(name, getMatchById(p.matchId))).length;
  return actual >= expected;
}
function getTopPlaces() {
  const fallback = Number(data.settings.topPlaces || 7);
  const when15 = Number(data.settings.topPlacesWhen15Plus || 0);
  return data.participants.length >= 15 && when15 ? when15 : fallback;
}
function outcomeLabel(code, match) { if (code === "home") return `Победа: ${match.home}`; if (code === "away") return `Победа: ${match.away}`; return "Ничья"; }
function getRoundBank(roundKey) {
  const active = getActiveParticipants(roundKey).length || data.participants.length || 0;
  const resultBank = data.settings.dynamicBank ? active * (data.settings.resultStakePerActiveParticipant || 100) : (data.settings.resultBank || 1400);
  const exactBank = data.settings.dynamicBank ? active * (data.settings.exactStakePerActiveParticipant || 50) : (data.settings.exactScoreBank || 700);
  return { active, resultBank, exactBank, matchBank: resultBank + exactBank };
}
function getMatchBank(match) {
  const active = getActiveParticipantsForMatch(match).length || data.participants.length || 0;
  const resultBank = data.settings.dynamicBank ? active * (data.settings.resultStakePerActiveParticipant || 100) : (data.settings.resultBank || 1400);
  const exactBank = data.settings.dynamicBank ? active * (data.settings.exactStakePerActiveParticipant || 50) : (data.settings.exactScoreBank || 700);
  return { active, resultBank, exactBank, matchBank: resultBank + exactBank };
}

function buildRoundDataFromSheet(csvText, round) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex(row => clean(row[0]).toLowerCase().includes("участник") && clean(row[0]).toLowerCase().includes("матч"));
  if (headerIndex === -1) throw new Error(`Не найдена строка с заголовком на листе ${round.title}`);
  const resultIndex = rows.findIndex((row, index) => index > headerIndex && clean(row[0]).toUpperCase().includes("РЕЗУЛЬТАТ"));
  if (resultIndex === -1) throw new Error(`Не найдена строка РЕЗУЛЬТАТ на листе ${round.title}`);

  const headerRow = rows[headerIndex];
  const resultRow = rows[resultIndex] || [];
  const matchCols = [];
  for (let col = 1; col < headerRow.length; col += 1) {
    const title = clean(headerRow[col]);
    if (!title) continue;
    const { home, away } = splitTeams(title);
    if (!home || !away) continue;
    const score = parseScore(resultRow[col]);
    matchCols.push({ col, sheetColumn: col + 1, title, home, away, score });
  }

  const participantRows = rows.slice(headerIndex + 1, resultIndex).filter(row => clean(row[0]));
  const participants = participantRows.map(row => ({ name: clean(row[0]) }));
  const matches = matchCols.map((m, index) => ({
    id: `${round.key}_m${index + 1}`,
    roundKey: round.key,
    round: round.title,
    roundOrder: round.order,
    title: m.title,
    home: m.home,
    away: m.away,
    sheetColumn: m.sheetColumn,
    homeScore: m.score ? m.score.home : null,
    awayScore: m.score ? m.score.away : null,
    status: m.score ? "finished" : "upcoming"
  }));

  const predictions = [];
  participantRows.forEach((row) => {
    const name = clean(row[0]);
    matchCols.forEach((m, matchIndex) => {
      const score = parseScore(row[m.col]);
      if (!score) return;
      predictions.push({
        matchId: `${round.key}_m${matchIndex + 1}`,
        participantName: name,
        roundKey: round.key,
        home: score.home,
        away: score.away
      });
    });
  });
  return { participants, matches, predictions };
}

function mergeRoundData(roundResults) {
  const participantNames = [];
  const seen = new Set();
  for (const result of roundResults) {
    for (const p of result.participants) {
      const key = normName(p.name);
      if (!seen.has(key)) { seen.add(key); participantNames.push(p.name); }
    }
  }
  const participants = participantNames.map((name, index) => ({ id: `p${index + 1}`, name }));
  const idByName = Object.fromEntries(participants.map(p => [normName(p.name), p.id]));
  const matches = roundResults.flatMap(r => r.matches);
  const predictions = roundResults.flatMap(r => r.predictions.map(p => ({ ...p, participantId: idByName[normName(p.participantName)] })));
  return { ...data, participants, matches, predictions };
}

function setStatus(message, kind = "") {
  const el = byId("dataStatus");
  if (!el) return;
  el.classList.remove("is-ok", "is-error");
  if (kind) el.classList.add(kind);
  if (kind === "is-error") { el.hidden = false; el.textContent = message; }
  else { el.hidden = true; el.textContent = ""; }
}

function calculateMatchBreakdowns() {
  return data.matches.filter(match => match.homeScore !== null && match.awayScore !== null).map(match => {
    const fact = outcome(match.homeScore, match.awayScore);
    const activeIds = new Set(getActiveParticipantsForMatch(match).map(p => p.id));
    const preds = getPredictions(match.id).filter(p => activeIds.has(p.participantId));
    const resultWinners = preds.filter(p => outcome(p.home, p.away) === fact);
    const exactWinners = preds.filter(p => p.home === match.homeScore && p.away === match.awayScore);
    const bank = getMatchBank(match);
    const resultPoints = resultWinners.length ? bank.resultBank / resultWinners.length : 0;
    const exactPoints = exactWinners.length ? bank.exactBank / exactWinners.length : 0;
    const rows = preds.map(p => {
      const gotResult = resultWinners.includes(p);
      const gotExact = exactWinners.includes(p);
      return {
        participantId: p.participantId,
        participantName: participantName(p.participantId),
        prediction: `${p.home}-${p.away}`,
        resultPoints: gotResult ? resultPoints : 0,
        exactPoints: gotExact ? exactPoints : 0,
        total: (gotResult ? resultPoints : 0) + (gotExact ? exactPoints : 0),
        gotResult,
        gotExact
      };
    });
    return { match, fact, preds, resultWinners, exactWinners, resultPoints, exactPoints, rows, bank };
  }).sort((a, b) => a.match.roundOrder - b.match.roundOrder || a.match.id.localeCompare(b.match.id));
}

function calculateStandings() {
  const rows = data.participants.map((p, seed) => ({
    id: p.id, name: p.name, seed, total: 0, resultPoints: 0, exactScorePoints: 0,
    resultHits: 0, exactHits: 0, misses: 0, played: 0, bestMatchPoints: 0, bestMatchTitle: "—",
    _joined: false
  }));
  const index = Object.fromEntries(rows.map(r => [r.id, r]));
  const breakdowns = calculateMatchBreakdowns();
  const roundsSorted = [...(data.settings.rounds || [])].sort((a,b) => a.order - b.order);

  function applyJoinBonusesBefore(roundKey) {
    const order = roundOrder(roundKey);
    for (const r of rows) {
      if (r._joined) continue;
      const meta = data.settings.participantMeta?.[r.name] || {};
      const joinKey = meta.activeFromRoundKey || roundsSorted[0]?.key;
      if (roundOrder(joinKey) !== order) continue;
      const explicit = Number(meta.initialPoints || 0);
      if (explicit) r.total += explicit;
      if (meta.initialPointsMode === "lastBeforeJoin") {
        const previousActive = rows.filter(x => x.id !== r.id && roundOrder(getActiveFromRoundKey(x.name)) < order);
        if (previousActive.length) r.total += Math.min(...previousActive.map(x => x.total));
      }
      r._joined = true;
    }
  }

  for (const round of roundsSorted) applyJoinBonusesBefore(round.key);

  for (const b of breakdowns) {
    applyJoinBonusesBefore(b.match.roundKey);
    for (const p of b.rows) {
      const row = index[p.participantId];
      if (!row) continue;
      row.played += 1;
      row.total += p.total;
      row.resultPoints += p.resultPoints;
      row.exactScorePoints += p.exactPoints;
      if (p.gotResult) row.resultHits += 1;
      if (p.gotExact) row.exactHits += 1;
      if (!p.gotResult) row.misses += 1;
      if (p.total > row.bestMatchPoints) { row.bestMatchPoints = p.total; row.bestMatchTitle = matchTitle(b.match); }
    }
  }
  rows.forEach(r => delete r._joined);
  return rows.sort((a, b) => b.total - a.total || b.exactHits - a.exactHits || b.resultHits - a.resultHits || a.seed - b.seed);
}

function calculateSnapshotAfterBreakdowns(breakdownsPrefix) {
  const rows = data.participants.map((p, seed) => ({
    id: p.id,
    name: p.name,
    seed,
    total: 0,
    resultHits: 0,
    exactHits: 0,
    played: 0,
    _joined: false
  }));
  const index = Object.fromEntries(rows.map(r => [r.id, r]));

  function isJoinReached(row, match) {
    const meta = data.settings.participantMeta?.[row.name] || {};
    const firstRound = data.settings.rounds?.[0]?.key || match.roundKey;
    const joinKey = meta.activeFromRoundKey || firstRound;
    const joinOrder = roundOrder(joinKey);
    const matchOrder = roundOrder(match.roundKey);
    if (joinOrder < matchOrder) return true;
    if (joinOrder > matchOrder) return false;
    const fromMatchTitle = meta.activeFromMatchTitle || null;
    if (!fromMatchTitle) return true;
    const joinIndex = findMatchIndexByTitle(match.roundKey, fromMatchTitle);
    if (joinIndex === -1) return true;
    const matchIndex = getRoundMatches(match.roundKey).findIndex(m => m.id === match.id);
    return matchIndex >= joinIndex;
  }

  function applyJoinBonuses(match) {
    for (const row of rows) {
      if (row._joined || !isJoinReached(row, match)) continue;
      const meta = data.settings.participantMeta?.[row.name] || {};
      const explicit = Number(meta.initialPoints || 0);
      if (explicit) row.total += explicit;
      if (meta.initialPointsMode === "lastBeforeJoin") {
        const previousActive = rows.filter(x => x.id !== row.id && x._joined);
        if (previousActive.length) row.total += Math.min(...previousActive.map(x => x.total));
      }
      row._joined = true;
    }
  }

  for (const b of breakdownsPrefix) {
    applyJoinBonuses(b.match);
    for (const pointRow of b.rows) {
      const row = index[pointRow.participantId];
      if (!row || !row._joined) continue;
      row.played += 1;
      row.total += pointRow.total;
      if (pointRow.gotResult) row.resultHits += 1;
      if (pointRow.gotExact) row.exactHits += 1;
    }
  }

  return rows
    .filter(r => r._joined)
    .slice()
    .sort((a, b) => b.total - a.total || b.exactHits - a.exactHits || b.resultHits - a.resultHits || a.seed - b.seed);
}

function calculateHistoricalPositionStats() {
  const breakdowns = calculateMatchBreakdowns();
  const topLimit = getTopPlaces();
  const byId = Object.fromEntries(data.participants.map(p => [p.id, { participantId: p.id, name: p.name, leaderCount: 0, topZoneCount: 0, riskZoneCount: 0, lastPlaceCount: 0 }]));
  const checkpoints = [];

  for (let i = 0; i < breakdowns.length; i += 1) {
    const b = breakdowns[i];
    const snapshot = calculateSnapshotAfterBreakdowns(breakdowns.slice(0, i + 1));
    if (!snapshot.length) continue;

    const leaderTotal = snapshot[0].total;
    const leaders = snapshot.filter(r => Math.abs(r.total - leaderTotal) < 0.000001);
    leaders.forEach(r => byId[r.id].leaderCount += 1);

    const topZone = snapshot.slice(0, topLimit);
    const riskZone = snapshot.slice(topLimit);
    topZone.forEach(r => byId[r.id].topZoneCount += 1);
    riskZone.forEach(r => byId[r.id].riskZoneCount += 1);

    const lastTotal = snapshot[snapshot.length - 1].total;
    const lastPlace = snapshot.filter(r => Math.abs(r.total - lastTotal) < 0.000001);
    lastPlace.forEach(r => byId[r.id].lastPlaceCount += 1);

    checkpoints.push({
      number: checkpoints.length + 1,
      roundTitle: roundByKey(b.match.roundKey)?.title || b.match.round || "—",
      matchTitle: matchTitle(b.match),
      result: `${b.match.homeScore}-${b.match.awayScore}`,
      leaders: leaders.map(r => ({ id: r.id, name: r.name, total: r.total })),
      lastPlace: lastPlace.map(r => ({ id: r.id, name: r.name, total: r.total })),
      topZone: topZone.map(r => r.name),
      riskZone: riskZone.map(r => r.name),
      snapshot: snapshot.map((r, index) => ({ place: index + 1, id: r.id, name: r.name, total: r.total, resultHits: r.resultHits, exactHits: r.exactHits })),
      fullTableText: snapshot.map((r, index) => `${index + 1}. ${r.name} — ${fmt(r.total)}`).join("; ")
    });
  }

  const roundSummaryRows = [];
  const roundsSorted = [...(data.settings.rounds || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  for (const round of roundsSorted) {
    const indexes = [];
    breakdowns.forEach((b, index) => { if (b.match.roundKey === round.key) indexes.push(index); });
    if (!indexes.length) continue;

    const lastIndex = indexes[indexes.length - 1];
    const snapshot = calculateSnapshotAfterBreakdowns(breakdowns.slice(0, lastIndex + 1));
    if (!snapshot.length) continue;

    const leaderTotal = snapshot[0].total;
    const leaders = snapshot.filter(r => Math.abs(r.total - leaderTotal) < 0.000001);
    const topZone = snapshot.slice(0, topLimit);
    const riskZone = snapshot.slice(topLimit);
    const lastTotal = snapshot[snapshot.length - 1].total;
    const lastPlace = snapshot.filter(r => Math.abs(r.total - lastTotal) < 0.000001);
    const totalRoundMatches = getRoundMatches(round.key).length;

    roundSummaryRows.push({
      roundKey: round.key,
      roundTitle: round.title,
      completedInRound: indexes.length,
      totalRoundMatches,
      leaders: leaders.map(r => ({ id: r.id, name: r.name, total: r.total })),
      lastPlace: lastPlace.map(r => ({ id: r.id, name: r.name, total: r.total })),
      topZone: topZone.map(r => r.name),
      riskZone: riskZone.map(r => r.name),
      snapshot: snapshot.map((r, index) => ({ place: index + 1, id: r.id, name: r.name, total: r.total, resultHits: r.resultHits, exactHits: r.exactHits })),
      fullTableText: snapshot.map((r, index) => `${index + 1}. ${r.name} — ${fmt(r.total)}`).join("; ")
    });
  }

  const rowsStats = Object.values(byId);
  const sortBy = (field) => rowsStats.slice().sort((a, b) => b[field] - a[field] || participantName(a.participantId).localeCompare(participantName(b.participantId), "ru"));
  return {
    checkpoints: breakdowns.length,
    byId,
    leaderRows: sortBy("leaderCount"),
    topZoneRows: sortBy("topZoneCount"),
    riskZoneRows: sortBy("riskZoneCount"),
    lastPlaceRows: sortBy("lastPlaceCount"),
    checkpointRows: checkpoints,
    roundSummaryRows
  };
}

function getAnalytics() {
  const standings = calculateStandings();
  const breakdowns = calculateMatchBreakdowns();
  const completed = breakdowns.length;
  const leader = standings[0] || null;
  const border = standings[getTopPlaces() - 1] || null;
  const firstRisk = standings[getTopPlaces()] || null;
  const topResult = [...standings].sort((a, b) => b.resultHits - a.resultHits || b.total - a.total || a.seed - b.seed)[0] || null;
  const topExact = [...standings].sort((a, b) => b.exactHits - a.exactHits || b.total - a.total || a.seed - b.seed)[0] || null;
  const bestAverage = [...standings].filter(r => r.played > 0).sort((a, b) => (b.total / b.played) - (a.total / a.played) || a.seed - b.seed)[0] || null;
  let bestSingle = null;
  for (const b of breakdowns) for (const row of b.rows) if (!bestSingle || row.total > bestSingle.total) bestSingle = { ...row, matchTitle: matchTitle(b.match), score: `${b.match.homeScore}-${b.match.awayScore}` };
  const totalExactHits = standings.reduce((sum, r) => sum + r.exactHits, 0);
  const totalResultHits = standings.reduce((sum, r) => sum + r.resultHits, 0);
  const hardestByResult = [...breakdowns].sort((a, b) => a.resultWinners.length - b.resultWinners.length || a.exactWinners.length - b.exactWinners.length)[0] || null;
  const easiestByResult = [...breakdowns].sort((a, b) => b.resultWinners.length - a.resultWinners.length || b.exactWinners.length - a.exactWinners.length)[0] || null;
  const bestExactMatch = [...breakdowns].sort((a, b) => b.exactWinners.length - a.exactWinners.length || b.resultWinners.length - a.resultWinners.length)[0] || null;
  const positionHistory = calculateHistoricalPositionStats();
  return { standings, breakdowns, completed, leader, border, firstRisk, topResult, topExact, bestAverage, bestSingle, totalExactHits, totalResultHits, hardestByResult, easiestByResult, bestExactMatch, positionHistory };
}

function renderHeroMeta() {
  const top = getTopPlaces();
  const topLabel = byId("topPlacesLabel");
  if (topLabel) topLabel.textContent = `Топ-${top}`;
  const bank = getRoundBank(currentSubmitRoundKey);
  const subtitle = byId("heroSubtitle");
  if (subtitle) subtitle.textContent = `${data.participants.length} участников, ${data.matches.length} матчей группового этапа. Банк матча считается по активным участникам.`;
  const zoneCaption = byId("zoneCaption");
  if (zoneCaption) zoneCaption.textContent = `Места 1–${top} — победная зона. Остальные — ебездалы.`;
}
function renderLoserBanner() {
  const el = byId("loserBanner");
  if (!el) return;
  const a = getAnalytics();
  const last = a.standings[a.standings.length - 1] || null;
  const name = a.completed && last ? last.name : "пока не определён";
  el.innerHTML = `<span>Лох ебаный:</span><strong>${e(name)}</strong>`;
}
function renderStats() {
  const a = getAnalytics();
  const gap = a.border && a.firstRisk ? Math.max(0, a.border.total - a.firstRisk.total) : 0;
  const active = getActiveParticipants(currentSubmitRoundKey);
  const submitted = active.filter(p => hasCompleteRoundSubmission(p.id, currentSubmitRoundKey)).length;
  const currentRound = roundByKey(currentSubmitRoundKey)?.title || "текущий тур";
  const stats = [
    ["Лидер", a.leader && a.completed ? `${a.leader.name} · ${fmt(a.leader.total)}` : "—"],
    ["Сыграно", `${a.completed} / ${data.matches.length}`],
    [`Граница топ-${getTopPlaces()}`, a.completed ? `${fmt(a.border?.total || 0)} · отрыв ${fmt(gap)}` : "—"],
    [`Сдали ${currentRound}`, `${submitted} / ${active.length}`],
  ];
  byId("stats").innerHTML = stats.map(([label, value]) => `<div class="stat"><span>${e(label)}</span><strong>${e(value)}</strong></div>`).join("");
}
function renderZonePreview() {
  const standings = calculateStandings();
  byId("zonePreview").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Место</th><th>Участник</th><th>Очки</th><th>Зона</th></tr></thead><tbody>${standings.map((r, i) => {
    const good = i < getTopPlaces();
    return `<tr><td class="rank">${i + 1}</td><td>${e(r.name)}</td><td>${fmt(r.total)}</td><td class="${good ? "zone-good" : "zone-bad"}">${good ? `Топ-${getTopPlaces()}` : "Ебездалы"}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}
function renderUpcoming() {
  const upcoming = data.matches.filter(m => m.homeScore === null || m.awayScore === null);
  const list = (upcoming.length ? upcoming : data.matches).slice(0, 6);
  byId("upcomingMatches").innerHTML = list.map(m => `<div class="match-card"><h3>${e(matchTitle(m))}</h3><p class="muted">${e(m.round)}</p><div class="score">${m.homeScore === null ? "результат пока не введён" : `${m.homeScore}-${m.awayScore}`}</div></div>`).join("");
}
function renderStandings() {
  const standings = calculateStandings();
  byId("standingsTable").innerHTML = `<thead><tr><th>Место</th><th>Участник</th><th>Очки</th><th>Исходы</th><th>Точные</th><th>Лучший матч</th><th>Зона</th></tr></thead><tbody>${standings.map((r, i) => {
    const good = i < getTopPlaces();
    const best = r.bestMatchPoints ? `${fmt(r.bestMatchPoints)} · ${r.bestMatchTitle}` : "—";
    return `<tr><td class="rank">${i + 1}</td><td>${e(r.name)}</td><td>${fmt(r.total)}</td><td>${r.resultHits}</td><td>${r.exactHits}</td><td>${e(best)}</td><td class="${good ? "zone-good" : "zone-bad"}">${good ? "Победная" : "Ебездалы"}</td></tr>`;
  }).join("")}</tbody>`;
}
function renderMatches() {
  const roundSelect = byId("matchesRoundFilter");
  currentMatchesRoundKey = renderRoundSelect(roundSelect, currentMatchesRoundKey);
  if (roundSelect) {
    roundSelect.onchange = () => { currentMatchesRoundKey = roundSelect.value; renderMatches(); };
  }
  const visibleMatches = getRoundMatches(currentMatchesRoundKey);
  const breakdownByMatch = Object.fromEntries(calculateMatchBreakdowns().map(b => [b.match.id, b]));
  byId("matchCards").innerHTML = visibleMatches.map((m, index) => {
    const b = breakdownByMatch[m.id];
    const active = getActiveParticipants(m.roundKey).length;
    const meta = b ? `<div class="mini-meta">Исход: ${b.resultWinners.length}/${active} · точный: ${b.exactWinners.length}/${active}</div>` : `<div class="mini-meta">${e(m.round)} · ожидается</div>`;
    return `<div class="match-card"><h3>${index + 1}. ${e(matchTitle(m))}</h3><p class="muted">${e(m.round)}</p><div class="score">${m.homeScore === null ? "—" : `${m.homeScore}-${m.awayScore}`}</div>${meta}</div>`;
  }).join("") || `<p class="muted">Матчи этого тура пока не найдены.</p>`;
}
function renderPredictionControls() {
  const roundSelect = byId("predictionRoundFilter");
  const matchSelect = byId("matchSelect");
  currentPredictionRoundKey = renderRoundSelect(roundSelect, currentPredictionRoundKey);

  if (roundSelect) {
    roundSelect.onchange = () => {
      currentPredictionRoundKey = roundSelect.value;
      renderPredictionControls();
    };
  }

  const roundMatches = getRoundMatches(currentPredictionRoundKey);
  const previousMatch = matchSelect.value;
  matchSelect.innerHTML = roundMatches.map((m, i) => `<option value="${e(m.id)}">${i + 1}. ${e(matchTitle(m))}</option>`).join("");
  const nextMatch = roundMatches.some(m => m.id === previousMatch) ? previousMatch : roundMatches[0]?.id;
  if (nextMatch) matchSelect.value = nextMatch;
  matchSelect.onchange = () => renderPredictions(matchSelect.value);
  if (matchSelect.value) renderPredictions(matchSelect.value);
  else {
    byId("predictionSummary").innerHTML = `<p class="muted">Выберите тур и матч.</p>`;
    byId("predictionsTable").innerHTML = "";
  }
}
function renderHiddenPredictionStatus(match) {
  const active = getActiveParticipants(match.roundKey);
  const submitted = active.filter(p => hasCompleteRoundSubmission(p.id, match.roundKey)).length;
  byId("predictionSummary").innerHTML = `<div class="lock-note"><strong>Прогнозы скрыты до начала первого матча тура.</strong><br>${e(match.round)}: видно только, кто сдал тур. Дедлайн: ${e(formatDeadline(match.roundKey))}. Сдали: ${submitted}/${active.length}.</div>`;
  byId("predictionsTable").innerHTML = `<thead><tr><th>Участник</th><th>Статус</th></tr></thead><tbody>${active.map(p => {
    const ok = hasCompleteRoundSubmission(p.id, match.roundKey);
    return `<tr><td>${e(p.name)}</td><td class="${ok ? "zone-good" : "zone-bad"}">${ok ? "Сдал" : "Не сдал"}</td></tr>`;
  }).join("")}</tbody>`;
}
function renderPredictions(matchId) {
  const match = data.matches.find(m => m.id === matchId);
  if (!match) return;
  if (!isRoundRevealed(match.roundKey)) { renderHiddenPredictionStatus(match); return; }
  const active = getActiveParticipants(match.roundKey);
  const preds = getPredictions(matchId).map(p => ({ ...p, name: participantName(p.participantId) }));
  const breakdown = calculateMatchBreakdowns().find(b => b.match.id === matchId);
  const pointsByParticipant = breakdown ? Object.fromEntries(breakdown.rows.map(r => [r.participantId, r])) : {};
  const homeCount = preds.filter(p => outcome(p.home, p.away) === "home").length;
  const drawCount = preds.filter(p => outcome(p.home, p.away) === "draw").length;
  const awayCount = preds.filter(p => outcome(p.home, p.away) === "away").length;
  byId("predictionSummary").innerHTML = `<div class="summary-pill"><span>${e(match.home)}</span><strong>${homeCount}</strong><small>прогнозов на победу</small></div><div class="summary-pill"><span>Ничья</span><strong>${drawCount}</strong><small>прогнозов</small></div><div class="summary-pill"><span>${e(match.away)}</span><strong>${awayCount}</strong><small>прогнозов на победу</small></div>`;
  byId("predictionsTable").innerHTML = `<thead><tr><th>Участник</th><th>Прогноз</th><th>Исход прогноза</th><th>Очки за матч</th></tr></thead><tbody>${active.map(participant => {
    const p = preds.find(x => x.participantId === participant.id);
    if (!p) return `<tr><td>${e(participant.name)}</td><td>—</td><td>не сдал</td><td>—</td></tr>`;
    const o = outcome(p.home, p.away);
    const points = pointsByParticipant[p.participantId]?.total;
    return `<tr><td>${e(p.name)}</td><td>${p.home}-${p.away}</td><td>${e(outcomeLabel(o, match))}</td><td>${points === undefined ? "—" : fmt(points)}</td></tr>`;
  }).join("")}</tbody>`;
}
function renderAnalytics() {
  const a = getAnalytics();
  const gap = a.border && a.firstRisk ? Math.max(0, a.border.total - a.firstRisk.total) : 0;
  const last = a.standings[a.standings.length - 1] || null;
  const loserName = a.completed && last ? last.name : "—";
  byId("analyticsStats").innerHTML = [["Точных счетов", a.completed ? a.totalExactHits : "—"], ["Угаданных исходов", a.completed ? a.totalResultHits : "—"], [`Отрыв ${getTopPlaces()}-го от ${getTopPlaces()+1}-го`, a.completed ? fmt(gap) : "—"], ["Лох ебаный", loserName]].map(([label, value]) => `<div class="stat"><span>${e(label)}</span><strong>${e(value)}</strong></div>`).join("");
  const empty = `<p class="muted">Статистика появится после первого введённого результата.</p>`;
  const formatHistoryWinner = (rows, field) => {
    const best = rows.find(r => r[field] > 0);
    return best ? `${e(best.name)} · ${best[field]} раз` : "—";
  };
  if (!a.completed) { byId("topAnalytics").innerHTML = empty; byId("matchAnalytics").innerHTML = empty; byId("historicalAnalytics").innerHTML = empty; }
  else {
    byId("topAnalytics").innerHTML = `<div class="insight-list"><div class="insight"><span>Лидер</span><strong>${e(a.leader?.name || "—")} · ${fmt(a.leader?.total || 0)}</strong></div><div class="insight"><span>Лучший по исходам</span><strong>${e(a.topResult?.name || "—")} · ${a.topResult?.resultHits ?? 0}</strong></div><div class="insight"><span>Лучший по точным счетам</span><strong>${e(a.topExact?.name || "—")} · ${a.topExact?.exactHits ?? 0}</strong></div><div class="insight"><span>Лучший разовый матч</span><strong>${a.bestSingle ? `${e(a.bestSingle.participantName)} · ${fmt(a.bestSingle.total)} · ${e(a.bestSingle.matchTitle)}` : "—"}</strong></div><div class="insight"><span>Лучший средний темп</span><strong>${a.bestAverage ? `${e(a.bestAverage.name)} · ${fmt(a.bestAverage.total / a.bestAverage.played)} за матч` : "—"}</strong></div></div>`;
    byId("matchAnalytics").innerHTML = `<div class="insight-list"><div class="insight"><span>Сложнейший матч по исходу</span><strong>${a.hardestByResult ? `${e(matchTitle(a.hardestByResult.match))} · ${a.hardestByResult.resultWinners.length}/${getActiveParticipantsForMatch(a.hardestByResult.match).length}` : "—"}</strong></div><div class="insight"><span>Самый понятный матч</span><strong>${a.easiestByResult ? `${e(matchTitle(a.easiestByResult.match))} · ${a.easiestByResult.resultWinners.length}/${getActiveParticipantsForMatch(a.easiestByResult.match).length}` : "—"}</strong></div><div class="insight"><span>Лучший матч по точным счетам</span><strong>${a.bestExactMatch ? `${e(matchTitle(a.bestExactMatch.match))} · ${a.bestExactMatch.exactWinners.length}/${getActiveParticipantsForMatch(a.bestExactMatch.match).length}` : "—"}</strong></div><div class="insight"><span>Самый дорогой прогноз</span><strong>${a.bestSingle ? `${e(a.bestSingle.participantName)} · ${fmt(a.bestSingle.total)} очков` : "—"}</strong></div></div>`;
    byId("historicalAnalytics").innerHTML = `<div class="insight-list"><div class="insight"><span>Чаще всех был лидером</span><strong>${formatHistoryWinner(a.positionHistory.leaderRows, "leaderCount")}</strong></div><div class="insight"><span>Чаще всех был в топ-${getTopPlaces()}</span><strong>${formatHistoryWinner(a.positionHistory.topZoneRows, "topZoneCount")}</strong></div><div class="insight"><span>Чаще всех был в ебездалах</span><strong>${formatHistoryWinner(a.positionHistory.riskZoneRows, "riskZoneCount")}</strong></div><div class="insight"><span>Чаще всех был лохом ебаным</span><strong>${formatHistoryWinner(a.positionHistory.lastPlaceRows, "lastPlaceCount")}</strong></div><div class="insight"><span>Контрольных точек</span><strong>${a.positionHistory.checkpoints} матчей</strong></div></div>`;
  }
  const participantRows = calculateStandings();
  const historyById = a.positionHistory.byId || {};
  byId("participantStatsTable").innerHTML = `<thead><tr><th>Участник</th><th>Очки</th><th>Лидер</th><th>Топ-${getTopPlaces()}</th><th>Ебездалы</th><th>Лох ебаный</th><th>Исходы</th><th>Точные</th><th>Мимо</th><th>Средние очки</th><th>Точность исходов</th></tr></thead><tbody>${participantRows.map(r => { const h = historyById[r.id] || {}; return `<tr><td>${e(r.name)}</td><td>${fmt(r.total)}</td><td>${h.leaderCount || 0}</td><td>${h.topZoneCount || 0}</td><td>${h.riskZoneCount || 0}</td><td>${h.lastPlaceCount || 0}</td><td>${r.resultHits}</td><td>${r.exactHits}</td><td>${r.misses}</td><td>${r.played ? fmt(r.total / r.played) : "—"}</td><td>${pct(r.resultHits, r.played)}</td></tr>`; }).join("")}</tbody>`;
  const roundRows = a.positionHistory.roundSummaryRows || [];
  const roundAuditEl = byId("roundAuditTable");
  if (roundAuditEl) {
    roundAuditEl.innerHTML = roundRows.length
      ? `<thead><tr><th>Тур</th><th>Сыграно матчей</th><th>Лидер после тура</th><th>Лох ебаный после тура</th><th>Ебездалы после тура</th><th>Полная таблица после тура</th></tr></thead><tbody>${roundRows.map(row => `<tr><td>${e(row.roundTitle)}</td><td>${row.completedInRound}/${row.totalRoundMatches}</td><td>${row.leaders.map(x => `${e(x.name)} (${fmt(x.total)})`).join(", ")}</td><td>${row.lastPlace.map(x => `${e(x.name)} (${fmt(x.total)})`).join(", ")}</td><td>${row.riskZone.length ? row.riskZone.map(e).join(", ") : "—"}</td><td class="audit-full-table">${e(row.fullTableText || "—")}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td>Итоги по турам появятся после первого введённого результата.</td></tr></tbody>`;
  }

  const auditRows = a.positionHistory.checkpointRows || [];
  const auditEl = byId("positionAuditTable");
  if (auditEl) {
    auditEl.innerHTML = auditRows.length
      ? `<thead><tr><th>#</th><th>Тур</th><th>Матч</th><th>Результат</th><th>Лидер после матча</th><th>Лох ебаный после матча</th><th>Ебездалы после матча</th><th>Полная таблица после матча</th></tr></thead><tbody>${auditRows.map(row => `<tr><td>${row.number}</td><td>${e(row.roundTitle)}</td><td>${e(row.matchTitle)}</td><td>${e(row.result)}</td><td>${row.leaders.map(x => `${e(x.name)} (${fmt(x.total)})`).join(", ")}</td><td>${row.lastPlace.map(x => `${e(x.name)} (${fmt(x.total)})`).join(", ")}</td><td>${row.riskZone.length ? row.riskZone.map(e).join(", ") : "—"}</td><td class="audit-full-table">${e(row.fullTableText || "—")}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td>История появится после первого введённого результата.</td></tr></tbody>`;
  }
}

function renderSubmitMatchRowsForParticipant(participantNameValue) {
  const container = byId("submitMatches");
  if (!container) return;
  const matches = getSubmissionMatchesForParticipant(participantNameValue, currentSubmitRoundKey);
  if (!matches.length) {
    container.innerHTML = `<div class="lock-note"><strong>Нет доступных матчей для этого участника в выбранном туре.</strong></div>`;
    return;
  }
  const allRoundMatches = getRoundMatches(currentSubmitRoundKey);
  container.innerHTML = matches.map((m) => {
    const index = allRoundMatches.findIndex(x => x.id === m.id);
    const displayIndex = index >= 0 ? index + 1 : "";
    return `<div class="submit-match-row" data-round-key="${e(currentSubmitRoundKey)}" data-match-id="${e(m.id)}" data-sheet-column="${e(m.sheetColumn || index + 2)}" data-match-title="${e(matchTitle(m))}"><div class="submit-match-title">${displayIndex}. ${e(matchTitle(m))}</div><input class="score-input home-score" type="number" inputmode="numeric" min="0" max="20" value="0"><span class="score-separator">-</span><input class="score-input away-score" type="number" inputmode="numeric" min="0" max="20" value="0"></div>`;
  }).join("");
}

function renderSubmitForm() {
  const roundSelect = byId("submitRound");
  if (roundSelect) {
    const previous = currentSubmitRoundKey;
    roundSelect.innerHTML = (data.settings.rounds || []).map(r => `<option value="${e(r.key)}">${e(r.title)}</option>`).join("");
    roundSelect.value = roundByKey(previous) ? previous : data.settings.rounds?.[0]?.key;
    currentSubmitRoundKey = roundSelect.value;
    roundSelect.onchange = () => { currentSubmitRoundKey = roundSelect.value; renderSubmitForm(); renderHeroMeta(); renderStats(); };
  }
  const round = roundByKey(currentSubmitRoundKey) || data.settings.rounds?.[0];
  const activeParticipants = getActiveParticipants(currentSubmitRoundKey);
  const closed = isRoundRevealed(currentSubmitRoundKey);
  const submitted = activeParticipants.filter(p => hasCompleteRoundSubmission(p.id, currentSubmitRoundKey)).length;
  const deadlineBox = byId("submitDeadlineBox");
  deadlineBox.innerHTML = `<strong>${closed ? "Приём прогнозов закрыт" : "Приём прогнозов открыт"}</strong><span>Тур: ${e(round?.title || "—")} · дедлайн: ${e(formatDeadline(currentSubmitRoundKey))} · сдали: ${submitted}/${activeParticipants.length}</span>`;

  const formArea = byId("submitFormArea");
  const reviewArea = byId("reviewArea");
  const message = byId("submitMessage");
  if (reviewArea) reviewArea.hidden = true;
  if (formArea) formArea.hidden = false;
  if (message) { message.textContent = ""; message.className = "submit-message"; }

  const participantSelect = byId("submitParticipant");
  const pinInput = byId("submitPin");
  const loadButton = byId("loadMyPredictionsButton");
  const reviewButton = byId("reviewPredictionsButton");
  const topActions = document.querySelector(".top-actions");

  if (participantSelect) {
    const previousName = participantSelect.value;
    participantSelect.innerHTML = activeParticipants.map(p => `<option value="${e(p.name)}">${e(p.name)}</option>`).join("");
    if (previousName && activeParticipants.some(p => p.name === previousName)) participantSelect.value = previousName;
    participantSelect.onchange = () => { setSubmitMessage(""); renderSubmitMatchRowsForParticipant(participantSelect.value); };
  }

  if (closed) {
    if (participantSelect) participantSelect.disabled = true;
    if (pinInput) { pinInput.disabled = true; pinInput.value = ""; }
    if (loadButton) loadButton.disabled = true;
    if (reviewButton) reviewButton.disabled = true;
    if (topActions) topActions.style.display = "none";
    const matchesBox = byId("submitMatches");
    if (matchesBox) {
      matchesBox.innerHTML = `<div class="lock-note"><strong>Тур уже начался.</strong><br>Отправка и редактирование прогнозов закрыты. Если участник не сдал прогноз до старта первого матча тура, по этому туру у него остаётся пусто.<br><br><strong>Выбери 2 тур или 3 тур выше, чтобы сдать прогноз на следующий тур.</strong></div>`;
    }
    return;
  }

  if (participantSelect) participantSelect.disabled = false;
  if (pinInput) pinInput.disabled = false;
  if (loadButton) loadButton.disabled = false;
  if (reviewButton) reviewButton.disabled = false;
  if (topActions) topActions.style.display = "flex";
  if (participantSelect) renderSubmitMatchRowsForParticipant(participantSelect.value || activeParticipants[0]?.name || "");
}
function setSubmitMessage(text, kind = "") {
  const el = byId("submitMessage");
  if (!el) return;
  el.textContent = text;
  el.className = `submit-message ${kind}`.trim();
}
function collectPredictionsForReview() {
  const participantNameValue = clean(byId("submitParticipant")?.value);
  const pin = clean(byId("submitPin")?.value);
  if (!participantNameValue) throw new Error("Выбери участника.");
  if (!pin) throw new Error("Введи PIN-код.");
  if (isRoundRevealed(currentSubmitRoundKey)) throw new Error("Приём прогнозов на этот тур уже закрыт.");
  const rows = Array.from(document.querySelectorAll(".submit-match-row"));
  const predictions = rows.map(row => {
    const homeRaw = row.querySelector(".home-score")?.value;
    const awayRaw = row.querySelector(".away-score")?.value;
    const home = homeRaw === "" ? 0 : Number(homeRaw);
    const away = awayRaw === "" ? 0 : Number(awayRaw);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 20 || away > 20) throw new Error("Счёт должен быть целым числом от 0 до 20.");
    return { matchId: row.dataset.matchId, matchTitle: row.dataset.matchTitle, sheetColumn: Number(row.dataset.sheetColumn), home, away };
  });
  if (predictions.length !== getSubmissionMatchesForParticipant(participantNameValue, currentSubmitRoundKey).length) throw new Error("Нужно заполнить все доступные матчи тура целиком.");
  return { roundKey: currentSubmitRoundKey, roundTitle: roundByKey(currentSubmitRoundKey)?.title, participantName: participantNameValue, pin, predictions };
}
function showReview(payload) {
  currentReviewPayload = payload;
  byId("submitFormArea").hidden = true;
  byId("reviewArea").hidden = false;
  byId("reviewList").innerHTML = payload.predictions.map((p, i) => `<div class="review-item"><span>${i + 1}. ${e(p.matchTitle)}</span><strong>${p.home}-${p.away}</strong></div>`).join("");
  const checkbox = byId("confirmPredictions"), sendButton = byId("sendPredictionsButton");
  checkbox.checked = false;
  sendButton.disabled = true;
}
function callSubmissionApi(action, payload) {
  const url = data.settings.submissionWebAppUrl;
  if (!url || url.includes("PASTE_GOOGLE_APPS_SCRIPT")) return Promise.reject(new Error("Сначала нужно вставить ссылку Google Apps Script Web App в data-v13.js."));
  return new Promise((resolve, reject) => {
    const callbackName = `kuntulizator_submit_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const cleanup = () => { delete window[callbackName]; script.remove(); };
    window[callbackName] = (response) => { cleanup(); response && response.ok ? resolve(response) : reject(new Error(response?.message || "Не удалось выполнить действие.")); };
    script.onerror = () => { cleanup(); reject(new Error("Не удалось связаться с Google Apps Script.")); };
    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}action=${encodeURIComponent(action)}&callback=${encodeURIComponent(callbackName)}&payload=${encodeURIComponent(JSON.stringify(payload || {}))}&_=${Date.now()}`;
    document.body.appendChild(script);
  });
}
function sendViaJsonp(payload) { return callSubmissionApi("submitPredictions", payload); }
function applyLoadedPredictions(predictions) {
  const byColumn = Object.fromEntries((predictions || []).filter(p => p.home !== null && p.away !== null).map(p => [Number(p.sheetColumn), p]));
  let loaded = 0;
  document.querySelectorAll(".submit-match-row").forEach(row => {
    row.classList.remove("is-loaded");
    const p = byColumn[Number(row.dataset.sheetColumn)];
    if (!p) return;
    const homeInput = row.querySelector(".home-score"), awayInput = row.querySelector(".away-score");
    if (homeInput && awayInput) { homeInput.value = p.home; awayInput.value = p.away; row.classList.add("is-loaded"); loaded += 1; }
  });
  return loaded;
}
async function loadMyPredictions() {
  const participantNameValue = clean(byId("submitParticipant")?.value);
  const pin = clean(byId("submitPin")?.value);
  if (!participantNameValue) throw new Error("Выбери участника.");
  if (!pin) throw new Error("Введи PIN-код.");
  const response = await callSubmissionApi("getMyPredictions", { roundKey: currentSubmitRoundKey, participantName: participantNameValue, pin });
  const loaded = applyLoadedPredictions(response.predictions || []);
  return { ...response, loaded };
}

function isSmallMobileViewport() {
  return window.matchMedia("(max-width: 720px)").matches;
}
function releaseMobileInputFocus(targetSelector = ".submit-card") {
  const active = document.activeElement;
  if (active && typeof active.blur === "function") active.blur();
  if (!isSmallMobileViewport()) return;
  window.setTimeout(() => {
    const target = document.querySelector(targetSelector);
    if (target) target.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
    window.scrollBy({ top: -8, left: 0, behavior: "smooth" });
  }, 180);
}
function initMobileInputZoomFix() {
  const pinInput = byId("submitPin");
  if (pinInput) {
    pinInput.addEventListener("input", () => {
      const onlyDigits = pinInput.value.replace(/\D/g, "").slice(0, 4);
      if (pinInput.value !== onlyDigits) pinInput.value = onlyDigits;
      if (onlyDigits.length >= 4 && isSmallMobileViewport()) {
        window.setTimeout(() => releaseMobileInputFocus("#submitFormArea"), 80);
      }
    });
    pinInput.addEventListener("change", () => releaseMobileInputFocus("#submitFormArea"));
  }
  document.addEventListener("focusin", (event) => {
    const el = event.target;
    if (el && el.matches && el.matches("#submit input, #submit select, #submit textarea")) {
      document.body.classList.add("submit-input-focused");
    }
  });
  document.addEventListener("focusout", (event) => {
    const el = event.target;
    if (el && el.matches && el.matches("#submit input, #submit select, #submit textarea")) {
      window.setTimeout(() => document.body.classList.remove("submit-input-focused"), 120);
    }
  });
}

function initSubmitHandlers() {
  const reviewButton = byId("reviewPredictionsButton");
  if (reviewButton) reviewButton.addEventListener("click", () => { try { releaseMobileInputFocus("#submitFormArea"); setSubmitMessage(""); showReview(collectPredictionsForReview()); window.setTimeout(() => releaseMobileInputFocus("#reviewArea"), 120); } catch (error) { setSubmitMessage(error.message, "is-error"); releaseMobileInputFocus("#submitFormArea"); } });
  const checkbox = byId("confirmPredictions");
  if (checkbox) checkbox.addEventListener("change", () => { byId("sendPredictionsButton").disabled = !checkbox.checked; });
  const backButton = byId("backToEditButton");
  if (backButton) backButton.addEventListener("click", () => { releaseMobileInputFocus("#reviewArea"); byId("reviewArea").hidden = true; byId("submitFormArea").hidden = false; setSubmitMessage(""); window.setTimeout(() => releaseMobileInputFocus("#submitFormArea"), 120); });
  const sendButton = byId("sendPredictionsButton");
  if (sendButton) sendButton.addEventListener("click", async () => {
    try {
      releaseMobileInputFocus("#reviewArea");
      if (!currentReviewPayload) throw new Error("Сначала перейди к проверке прогнозов.");
      sendButton.disabled = true; sendButton.textContent = "Отправляю…";
      const response = await sendViaJsonp(currentReviewPayload);
      byId("reviewArea").hidden = true; byId("submitFormArea").hidden = false;
      await loadSheetData(true);
      setSubmitMessage(response.message || "Прогнозы сохранены.", "is-ok");
    } catch (error) { setSubmitMessage(error.message, "is-error"); }
    finally { sendButton.textContent = "Отправить прогнозы"; sendButton.disabled = !byId("confirmPredictions")?.checked; }
  });
  const loadButton = byId("loadMyPredictionsButton");
  if (loadButton) loadButton.addEventListener("click", async () => {
    try {
      releaseMobileInputFocus("#submitFormArea");
      setSubmitMessage(""); loadButton.disabled = true; loadButton.classList.add("is-loading"); loadButton.textContent = "Открываю…";
      const response = await loadMyPredictions();
      if (response.loaded) setSubmitMessage(`Загружен сохранённый прогноз: ${response.loaded}/${getRoundMatches(currentSubmitRoundKey).length} матчей. Можно исправить и отправить заново до дедлайна.`, "is-ok");
      else setSubmitMessage("Для этого участника пока нет сохранённого прогноза.", "is-error");
    } catch (error) { setSubmitMessage(error.message, "is-error"); }
    finally { loadButton.disabled = false; loadButton.classList.remove("is-loading"); loadButton.textContent = "Посмотреть мой прогноз"; }
  });
}

function isSubmitPageActive() {
  return !!byId("submit")?.classList.contains("is-active");
}
function isSubmitFormBeingEdited() {
  if (!isSubmitPageActive()) return false;
  const active = document.activeElement;
  if (active && byId("submit")?.contains(active)) return true;
  const rows = Array.from(document.querySelectorAll(".submit-match-row"));
  return rows.some(row => {
    const home = row.querySelector(".home-score")?.value;
    const away = row.querySelector(".away-score")?.value;
    return home !== "" || away !== "";
  });
}

function renderAll() {
  renderHeroMeta(); renderLoserBanner(); renderStats(); renderZonePreview(); renderUpcoming(); renderStandings(); renderMatches(); renderPredictionControls(); renderAnalytics(); if (byId("submit")?.classList.contains("is-active")) renderSubmitForm();
}
async function loadSheetData(manual = false) {
  // Фоновое автообновление не должно сбрасывать форму сдачи прогноза.
  // Если участник находится на вкладке "Сдать прогноз" и уже вводит счёт,
  // пропускаем только автоматическое обновление. Ручная кнопка и обновление после отправки работают.
  if (!manual && isSubmitFormBeingEdited()) return;

  const button = byId("refreshButton");
  const rounds = data.settings.rounds || [];
  try {
    if (button) { button.disabled = true; if (manual) button.textContent = "Обновляю…"; }
    const roundResults = await Promise.all(rounds.map(async (round) => {
      const separator = round.csvUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${round.csvUrl}${separator}_=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${round.title}: HTTP ${response.status}`);
      const csvText = await response.text();
      return buildRoundDataFromSheet(csvText, round);
    }));
    data = mergeRoundData(roundResults);
    renderAll(); setStatus("", "is-ok");
  } catch (error) { console.error(error); setStatus("Не удалось обновить данные", "is-error"); }
  finally { if (button) { button.disabled = false; button.textContent = "↻ Обновить данные"; } }
}
function initTabs() {
  document.querySelectorAll(".tab[data-tab]").forEach(button => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.tab, targetPage = byId(targetId);
      if (!targetPage) return;
      document.querySelectorAll(".tab[data-tab]").forEach(b => b.classList.remove("is-active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("is-active"));
      button.classList.add("is-active"); targetPage.classList.add("is-active");
      if (targetId === "analytics") renderAnalytics();
      if (targetId === "submit") renderSubmitForm();
      if (targetId === "predictions") renderPredictionControls();
    });
  });
}
function init() {
  initTabs(); initSubmitHandlers(); initAdminChat(); initMobileInputZoomFix(); renderAll();
  const button = byId("refreshButton");
  if (button) button.addEventListener("click", () => loadSheetData(true));
  loadSheetData();
  const interval = data.settings.autoRefreshMs || 60000;
  refreshTimerId = window.setInterval(() => loadSheetData(false), interval);
}
init();

/* v22 — телевизор + фикс мобильного зума при PIN/формах */
function initAdminChat() {
  const launcher = byId("adminChatLauncher");
  const overlay = byId("adminChatOverlay");
  const closeButton = byId("adminChatClose");
  const form = byId("adminChatForm");
  const input = byId("adminChatInput");
  const messages = byId("adminChatMessages");
  if (!launcher || !overlay || !form || !input || !messages) return;

  const replies = [
    "Ебездал, тебе делать нечего что ли? Иди о прогнозах думай. Али вас скоро нагнет.",
    "Админ получил твой плач. Если вопрос реально важный — напиши в общий чат, ебездал."
  ];
  let replyIndex = Number(localStorage.getItem("kuntulizatorAdminReplyIndexV21") || "0") || 0;
  let typingTimer = null;
  let powerTimer = null;

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }
  function addBubble(text, type) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble chat-bubble--${type}`;
    bubble.textContent = text;
    messages.appendChild(bubble);
    scrollDown();
    return bubble;
  }
  function isMobileChatView() {
    return window.matchMedia("(max-width: 720px)").matches;
  }
  function openChat() {
    const tv = overlay.querySelector(".tv-chat__set");
    overlay.classList.add("is-open");
    overlay.classList.remove("keyboard-open");
    overlay.setAttribute("aria-hidden", "false");
    if (tv) {
      tv.classList.remove("tv-chat__set--on");
      tv.classList.add("tv-chat__set--off");
      if (powerTimer) window.clearTimeout(powerTimer);
      powerTimer = window.setTimeout(() => {
        tv.classList.remove("tv-chat__set--off");
        tv.classList.add("tv-chat__set--on");
      }, 520);
    }
    if (!isMobileChatView()) {
      window.setTimeout(() => input.focus(), 1150);
    }
  }
  function closeChat() {
    const tv = overlay.querySelector(".tv-chat__set");
    overlay.classList.remove("is-open");
    overlay.classList.remove("keyboard-open");
    overlay.setAttribute("aria-hidden", "true");
    if (tv) {
      tv.classList.remove("tv-chat__set--on");
      tv.classList.add("tv-chat__set--off");
    }
    input.blur();
    if (typingTimer) window.clearTimeout(typingTimer);
    if (powerTimer) window.clearTimeout(powerTimer);
  }

  launcher.addEventListener("click", openChat);
  if (closeButton) closeButton.addEventListener("click", closeChat);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeChat();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("is-open")) closeChat();
  });

  input.addEventListener("focus", () => {
    overlay.classList.add("keyboard-open");
    if (isMobileChatView()) {
      window.setTimeout(() => {
        const dialog = overlay.querySelector(".tv-chat");
        if (dialog) dialog.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }, 220);
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => overlay.classList.remove("keyboard-open"), 160);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addBubble(text, "user");
    if (isMobileChatView()) {
      input.blur();
      overlay.classList.remove("keyboard-open");
    } else {
      input.focus();
    }
    const typing = addBubble("Админ печатает", "typing");
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
      typing.remove();
      addBubble(replies[replyIndex % replies.length], "admin");
      replyIndex += 1;
      localStorage.setItem("kuntulizatorAdminReplyIndexV21", String(replyIndex));
    }, 1050);
  });
}

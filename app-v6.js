let data = window.KUNTULIZATOR_DATA;
let refreshTimerId = null;
let currentReviewPayload = null;

const byId = (id) => document.getElementById(id);
const e = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
const fmt = (n) => Number(n || 0).toFixed(data.settings.decimalPlaces || 2);
const pct = (part, total) => total ? `${Math.round((part / total) * 100)}%` : "—";
const outcome = (h, a) => h > a ? "home" : h < a ? "away" : "draw";

function clean(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

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
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

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

function buildDataFromSheet(csvText) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex(row => clean(row[0]).toLowerCase().includes("участник"));
  if (headerIndex === -1) throw new Error("Не найдена строка с заголовком 'Участники / Матч'");

  const resultIndex = rows.findIndex((row, index) => index > headerIndex && clean(row[0]).toUpperCase().includes("РЕЗУЛЬТАТ"));
  if (resultIndex === -1) throw new Error("Не найдена строка 'РЕЗУЛЬТАТ'");

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
  const participants = participantRows.map((row, index) => ({ id: `p${index + 1}`, name: clean(row[0]) }));

  const matches = matchCols.map((m, index) => ({
    id: `m${index + 1}`,
    round: data.settings.roundLabel,
    title: m.title,
    home: m.home,
    away: m.away,
    sheetColumn: m.sheetColumn,
    homeScore: m.score ? m.score.home : null,
    awayScore: m.score ? m.score.away : null,
    status: m.score ? "finished" : "upcoming"
  }));

  const predictions = [];
  participantRows.forEach((row, participantIndex) => {
    matchCols.forEach((m, matchIndex) => {
      const score = parseScore(row[m.col]);
      if (!score) return;
      predictions.push({
        matchId: `m${matchIndex + 1}`,
        participantId: `p${participantIndex + 1}`,
        home: score.home,
        away: score.away
      });
    });
  });

  return { ...data, participants, matches, predictions };
}

function getDeadlineDate() {
  const value = data.settings.roundDeadline;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function isRoundRevealed() {
  if (!data.settings.hidePredictionsUntilDeadline) return true;
  const deadline = getDeadlineDate();
  if (!deadline) return true;
  return Date.now() >= deadline.getTime();
}

function formatDeadline() {
  const d = getDeadlineDate();
  if (!d) return "дедлайн не задан";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function setStatus(message, kind = "") {
  const el = byId("dataStatus");
  if (!el) return;
  el.classList.remove("is-ok", "is-error");
  if (kind) el.classList.add(kind);
  if (kind === "is-error") { el.hidden = false; el.textContent = message; }
  else { el.hidden = true; el.textContent = ""; }
}

function participantName(id) { return data.participants.find(p => p.id === id)?.name || id; }
function matchTitle(match) { return `${match.home} — ${match.away}`; }
function getPredictions(matchId) { return data.predictions.filter(p => p.matchId === matchId); }
function getParticipantPredictions(participantId) { return data.predictions.filter(p => p.participantId === participantId); }
function hasCompleteRoundSubmission(participantId) { return getParticipantPredictions(participantId).length >= data.matches.length; }
function getTopPlaces() {
  const fallback = Number(data.settings.topPlaces || 7);
  const when15 = Number(data.settings.topPlacesWhen15Plus || 0);
  return data.participants.length >= 15 && when15 ? when15 : fallback;
}
function outcomeLabel(code, match) { if (code === "home") return `Победа: ${match.home}`; if (code === "away") return `Победа: ${match.away}`; return "Ничья"; }

function calculateMatchBreakdowns() {
  return data.matches.filter(match => match.homeScore !== null && match.awayScore !== null).map(match => {
    const fact = outcome(match.homeScore, match.awayScore);
    const preds = getPredictions(match.id);
    const resultWinners = preds.filter(p => outcome(p.home, p.away) === fact);
    const exactWinners = preds.filter(p => p.home === match.homeScore && p.away === match.awayScore);
    const resultBank = data.settings.dynamicBank ? data.participants.length * 100 : data.settings.resultBank;
    const exactBank = data.settings.dynamicBank ? data.participants.length * 50 : data.settings.exactScoreBank;
    const resultPoints = resultWinners.length ? resultBank / resultWinners.length : 0;
    const exactPoints = exactWinners.length ? exactBank / exactWinners.length : 0;

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

    return { match, fact, preds, resultWinners, exactWinners, resultPoints, exactPoints, rows };
  });
}

function calculateStandings() {
  const rows = data.participants.map((p, seed) => ({
    id: p.id, name: p.name, seed, total: 0, resultPoints: 0, exactScorePoints: 0,
    resultHits: 0, exactHits: 0, misses: 0, played: 0, bestMatchPoints: 0, bestMatchTitle: "—"
  }));
  const index = Object.fromEntries(rows.map(r => [r.id, r]));
  const breakdowns = calculateMatchBreakdowns();

  for (const b of breakdowns) {
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

  return rows.sort((a, b) => b.total - a.total || b.exactHits - a.exactHits || b.resultHits - a.resultHits || a.seed - b.seed);
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
  return { standings, breakdowns, completed, leader, border, firstRisk, topResult, topExact, bestAverage, bestSingle, totalExactHits, totalResultHits, hardestByResult, easiestByResult, bestExactMatch };
}

function renderHeroMeta() {
  const top = getTopPlaces();
  const topLabel = byId("topPlacesLabel");
  if (topLabel) topLabel.textContent = `Топ-${top}`;
  const subtitle = byId("heroSubtitle");
  if (subtitle) subtitle.textContent = `${data.participants.length} участников, ${data.matches.length} матчей первого тура, банк ${data.settings.matchBank || 2100} очков в каждом матче.`;
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
  const submitted = data.participants.filter(p => hasCompleteRoundSubmission(p.id)).length;
  const stats = [
    ["Лидер", a.leader && a.completed ? `${a.leader.name} · ${fmt(a.leader.total)}` : "—"],
    ["Сыграно", `${a.completed} / ${data.matches.length}`],
    [`Граница топ-${getTopPlaces()}`, a.completed ? `${fmt(a.border?.total || 0)} · отрыв ${fmt(gap)}` : "—"],
    ["Сдали тур", `${submitted} / ${data.participants.length}`],
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
  byId("upcomingMatches").innerHTML = list.map(m => `<div class="match-card"><h3>${e(matchTitle(m))}</h3><div class="score">${m.homeScore === null ? "результат пока не введён" : `${m.homeScore}-${m.awayScore}`}</div></div>`).join("");
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
  const breakdownByMatch = Object.fromEntries(calculateMatchBreakdowns().map(b => [b.match.id, b]));
  byId("matchCards").innerHTML = data.matches.map((m, index) => {
    const b = breakdownByMatch[m.id];
    const meta = b ? `<div class="mini-meta">Исход: ${b.resultWinners.length}/${data.participants.length} · точный: ${b.exactWinners.length}/${data.participants.length}</div>` : `<div class="mini-meta">ожидается</div>`;
    return `<div class="match-card"><h3>${index + 1}. ${e(matchTitle(m))}</h3><p class="muted">${e(m.round)}</p><div class="score">${m.homeScore === null ? "—" : `${m.homeScore}-${m.awayScore}`}</div>${meta}</div>`;
  }).join("");
}

function renderPredictionControls() {
  const revealed = isRoundRevealed();
  const select = byId("matchSelect");
  if (!revealed) {
    if (select) select.style.display = "none";
    renderHiddenPredictionStatus();
    return;
  }
  if (select) select.style.display = "";
  const previousValue = select.value;
  select.innerHTML = data.matches.map(m => `<option value="${e(m.id)}">${e(matchTitle(m))}</option>`).join("");
  const nextValue = data.matches.some(m => m.id === previousValue) ? previousValue : data.matches[0]?.id;
  if (nextValue) select.value = nextValue;
  select.onchange = () => renderPredictions(select.value);
  if (select.value) renderPredictions(select.value);
}

function renderHiddenPredictionStatus() {
  const submitted = data.participants.filter(p => hasCompleteRoundSubmission(p.id)).length;
  byId("predictionSummary").innerHTML = `<div class="lock-note"><strong>Прогнозы скрыты до начала первого матча тура.</strong><br>Сейчас видно только, кто сдал тур. Дедлайн: ${e(formatDeadline())}. Сдали: ${submitted}/${data.participants.length}.</div>`;
  byId("predictionsTable").innerHTML = `<thead><tr><th>Участник</th><th>Статус</th></tr></thead><tbody>${data.participants.map(p => {
    const ok = hasCompleteRoundSubmission(p.id);
    return `<tr><td>${e(p.name)}</td><td class="${ok ? "zone-good" : "zone-bad"}">${ok ? "Сдал" : "Не сдал"}</td></tr>`;
  }).join("")}</tbody>`;
}

function renderPredictions(matchId) {
  const match = data.matches.find(m => m.id === matchId);
  if (!match) return;
  const preds = getPredictions(matchId).map(p => ({ ...p, name: participantName(p.participantId) }));
  const breakdown = calculateMatchBreakdowns().find(b => b.match.id === matchId);
  const pointsByParticipant = breakdown ? Object.fromEntries(breakdown.rows.map(r => [r.participantId, r])) : {};
  const homeCount = preds.filter(p => outcome(p.home, p.away) === "home").length;
  const drawCount = preds.filter(p => outcome(p.home, p.away) === "draw").length;
  const awayCount = preds.filter(p => outcome(p.home, p.away) === "away").length;

  byId("predictionSummary").innerHTML = `<div class="summary-pill"><span>${e(match.home)}</span><strong>${homeCount}</strong><small>прогнозов на победу</small></div><div class="summary-pill"><span>Ничья</span><strong>${drawCount}</strong><small>прогнозов</small></div><div class="summary-pill"><span>${e(match.away)}</span><strong>${awayCount}</strong><small>прогнозов на победу</small></div>`;
  byId("predictionsTable").innerHTML = `<thead><tr><th>Участник</th><th>Прогноз</th><th>Исход прогноза</th><th>Очки за матч</th></tr></thead><tbody>${data.participants.map(participant => {
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
  byId("analyticsStats").innerHTML = [["Точных счетов", a.completed ? a.totalExactHits : "—"], ["Угаданных исходов", a.completed ? a.totalResultHits : "—"], ["Отрыв 7-го от 8-го", a.completed ? fmt(gap) : "—"], ["Лох ебаный", loserName]].map(([label, value]) => `<div class="stat"><span>${e(label)}</span><strong>${e(value)}</strong></div>`).join("");
  const empty = `<p class="muted">Статистика появится после первого введённого результата.</p>`;
  if (!a.completed) { byId("topAnalytics").innerHTML = empty; byId("matchAnalytics").innerHTML = empty; }
  else {
    byId("topAnalytics").innerHTML = `<div class="insight-list"><div class="insight"><span>Лидер</span><strong>${e(a.leader?.name || "—")} · ${fmt(a.leader?.total || 0)}</strong></div><div class="insight"><span>Лучший по исходам</span><strong>${e(a.topResult?.name || "—")} · ${a.topResult?.resultHits ?? 0}</strong></div><div class="insight"><span>Лучший по точным счетам</span><strong>${e(a.topExact?.name || "—")} · ${a.topExact?.exactHits ?? 0}</strong></div><div class="insight"><span>Лучший разовый матч</span><strong>${a.bestSingle ? `${e(a.bestSingle.participantName)} · ${fmt(a.bestSingle.total)} · ${e(a.bestSingle.matchTitle)}` : "—"}</strong></div><div class="insight"><span>Лучший средний темп</span><strong>${a.bestAverage ? `${e(a.bestAverage.name)} · ${fmt(a.bestAverage.total / a.bestAverage.played)} за матч` : "—"}</strong></div></div>`;
    byId("matchAnalytics").innerHTML = `<div class="insight-list"><div class="insight"><span>Сложнейший матч по исходу</span><strong>${a.hardestByResult ? `${e(matchTitle(a.hardestByResult.match))} · ${a.hardestByResult.resultWinners.length}/${data.participants.length}` : "—"}</strong></div><div class="insight"><span>Самый понятный матч</span><strong>${a.easiestByResult ? `${e(matchTitle(a.easiestByResult.match))} · ${a.easiestByResult.resultWinners.length}/${data.participants.length}` : "—"}</strong></div><div class="insight"><span>Лучший матч по точным счетам</span><strong>${a.bestExactMatch ? `${e(matchTitle(a.bestExactMatch.match))} · ${a.bestExactMatch.exactWinners.length}/${data.participants.length}` : "—"}</strong></div><div class="insight"><span>Самый дорогой прогноз</span><strong>${a.bestSingle ? `${e(a.bestSingle.participantName)} · ${fmt(a.bestSingle.total)} очков` : "—"}</strong></div></div>`;
  }
  const participantRows = calculateStandings();
  byId("participantStatsTable").innerHTML = `<thead><tr><th>Участник</th><th>Очки</th><th>Исходы</th><th>Точные</th><th>Мимо</th><th>Средние очки</th><th>Точность исходов</th></tr></thead><tbody>${participantRows.map(r => `<tr><td>${e(r.name)}</td><td>${fmt(r.total)}</td><td>${r.resultHits}</td><td>${r.exactHits}</td><td>${r.misses}</td><td>${r.played ? fmt(r.total / r.played) : "—"}</td><td>${pct(r.resultHits, r.played)}</td></tr>`).join("")}</tbody>`;
}

function renderSubmitForm() {
  const deadlineBox = byId("submitDeadlineBox");
  const closed = isRoundRevealed();
  const submitted = data.participants.filter(p => hasCompleteRoundSubmission(p.id)).length;
  deadlineBox.innerHTML = `<strong>${closed ? "Приём прогнозов закрыт" : "Приём прогнозов открыт"}</strong><span>Тур: ${e(data.settings.submitRoundTitle || data.settings.roundLabel)} · дедлайн: ${e(formatDeadline())} · сдали: ${submitted}/${data.participants.length}</span>`;

  const formArea = byId("submitFormArea");
  const reviewArea = byId("reviewArea");
  const message = byId("submitMessage");
  if (reviewArea) reviewArea.hidden = true;
  if (message) { message.textContent = ""; message.className = "submit-message"; }

  if (closed) {
    formArea.innerHTML = `<div class="lock-note"><strong>Тур уже начался.</strong><br>Отправка и редактирование прогнозов закрыты. Если участник не сдал прогноз до старта первого матча тура, по этому туру у него остаётся пусто.</div>`;
    return;
  }

  const participantSelect = byId("submitParticipant");
  if (participantSelect) participantSelect.innerHTML = data.participants.map(p => `<option value="${e(p.name)}">${e(p.name)}</option>`).join("");

  const container = byId("submitMatches");
  if (container) {
    container.innerHTML = data.matches.map((m, index) => `<div class="submit-match-row" data-match-id="${e(m.id)}" data-sheet-column="${e(m.sheetColumn || index + 2)}" data-match-title="${e(matchTitle(m))}"><div class="submit-match-title">${index + 1}. ${e(matchTitle(m))}</div><input class="score-input home-score" type="number" inputmode="numeric" min="0" max="20" placeholder="0"><span class="score-separator">-</span><input class="score-input away-score" type="number" inputmode="numeric" min="0" max="20" placeholder="0"></div>`).join("");
  }
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
  if (isRoundRevealed()) throw new Error("Приём прогнозов на этот тур уже закрыт.");

  const rows = Array.from(document.querySelectorAll(".submit-match-row"));
  const predictions = rows.map(row => {
    const homeRaw = row.querySelector(".home-score")?.value;
    const awayRaw = row.querySelector(".away-score")?.value;
    if (homeRaw === "" || awayRaw === "") throw new Error("Заполни все матчи тура. Прогноз сдаётся только на весь тур целиком.");
    const home = Number(homeRaw);
    const away = Number(awayRaw);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 20 || away > 20) throw new Error("Счёт должен быть целым числом от 0 до 20.");
    return { matchId: row.dataset.matchId, matchTitle: row.dataset.matchTitle, sheetColumn: Number(row.dataset.sheetColumn), home, away };
  });

  if (predictions.length !== data.matches.length) throw new Error("Нужно заполнить весь тур целиком.");
  return { roundTitle: data.settings.submitRoundTitle || data.settings.roundLabel, participantName: participantNameValue, pin, predictions };
}

function showReview(payload) {
  currentReviewPayload = payload;
  byId("submitFormArea").hidden = true;
  byId("reviewArea").hidden = false;
  byId("reviewList").innerHTML = payload.predictions.map((p, i) => `<div class="review-item"><span>${i + 1}. ${e(p.matchTitle)}</span><strong>${p.home}-${p.away}</strong></div>`).join("");
  const checkbox = byId("confirmPredictions");
  const sendButton = byId("sendPredictionsButton");
  checkbox.checked = false;
  sendButton.disabled = true;
}

function callSubmissionApi(action, payload) {
  const url = data.settings.submissionWebAppUrl;
  if (!url || url.includes("PASTE_GOOGLE_APPS_SCRIPT")) {
    return Promise.reject(new Error("Сначала нужно вставить ссылку Google Apps Script Web App в data-v6.js."));
  }

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

function sendViaJsonp(payload) {
  return callSubmissionApi("submitPredictions", payload);
}

function applyLoadedPredictions(predictions) {
  const byColumn = Object.fromEntries((predictions || []).filter(p => p.home !== null && p.away !== null).map(p => [Number(p.sheetColumn), p]));
  let loaded = 0;
  document.querySelectorAll(".submit-match-row").forEach(row => {
    row.classList.remove("is-loaded");
    const p = byColumn[Number(row.dataset.sheetColumn)];
    if (!p) return;
    const homeInput = row.querySelector(".home-score");
    const awayInput = row.querySelector(".away-score");
    if (homeInput && awayInput) {
      homeInput.value = p.home;
      awayInput.value = p.away;
      row.classList.add("is-loaded");
      loaded += 1;
    }
  });
  return loaded;
}

async function loadMyPredictions() {
  const participantNameValue = clean(byId("submitParticipant")?.value);
  const pin = clean(byId("submitPin")?.value);
  if (!participantNameValue) throw new Error("Выбери участника.");
  if (!pin) throw new Error("Введи PIN-код.");
  const response = await callSubmissionApi("getMyPredictions", { participantName: participantNameValue, pin });
  const loaded = applyLoadedPredictions(response.predictions || []);
  return { ...response, loaded };
}

function initSubmitHandlers() {
  const reviewButton = byId("reviewPredictionsButton");
  if (reviewButton) reviewButton.addEventListener("click", () => {
    try { setSubmitMessage(""); showReview(collectPredictionsForReview()); }
    catch (error) { setSubmitMessage(error.message, "is-error"); }
  });

  const checkbox = byId("confirmPredictions");
  if (checkbox) checkbox.addEventListener("change", () => { byId("sendPredictionsButton").disabled = !checkbox.checked; });

  const backButton = byId("backToEditButton");
  if (backButton) backButton.addEventListener("click", () => { byId("reviewArea").hidden = true; byId("submitFormArea").hidden = false; setSubmitMessage(""); });

  const sendButton = byId("sendPredictionsButton");
  if (sendButton) sendButton.addEventListener("click", async () => {
    try {
      if (!currentReviewPayload) throw new Error("Сначала проверь прогнозы.");
      sendButton.disabled = true;
      sendButton.textContent = "Отправляю…";
      const response = await sendViaJsonp(currentReviewPayload);
      byId("reviewArea").hidden = true;
      byId("submitFormArea").hidden = false;
      await loadSheetData(true);
      setSubmitMessage(response.message || "Прогнозы сохранены.", "is-ok");
    } catch (error) {
      setSubmitMessage(error.message, "is-error");
    } finally {
      sendButton.textContent = "Отправить прогнозы";
      sendButton.disabled = !byId("confirmPredictions")?.checked;
    }
  });

  const loadButton = byId("loadMyPredictionsButton");
  if (loadButton) loadButton.addEventListener("click", async () => {
    try {
      setSubmitMessage("");
      loadButton.disabled = true;
      loadButton.classList.add("is-loading");
      loadButton.textContent = "Загружаю…";
      const response = await loadMyPredictions();
      if (response.loaded) setSubmitMessage(`Загружен сохранённый прогноз: ${response.loaded}/${data.matches.length} матчей. Можно исправить и отправить заново до дедлайна.`, "is-ok");
      else setSubmitMessage("Для этого участника пока нет сохранённого прогноза.", "is-error");
    } catch (error) {
      setSubmitMessage(error.message, "is-error");
    } finally {
      loadButton.disabled = false;
      loadButton.classList.remove("is-loading");
      loadButton.textContent = "Загрузить мой прогноз";
    }
  });
}

function renderAll() {
  renderHeroMeta();
  renderLoserBanner();
  renderStats();
  renderZonePreview();
  renderUpcoming();
  renderStandings();
  renderMatches();
  renderPredictionControls();
  renderAnalytics();
  if (byId("submit")?.classList.contains("is-active")) renderSubmitForm();
}

async function loadSheetData(manual = false) {
  const button = byId("refreshButton");
  const url = data.settings.sheetCsvUrl;
  if (!url) return;
  try {
    if (button) { button.disabled = true; if (manual) button.textContent = "Обновляю…"; }
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    data = buildDataFromSheet(csvText);
    renderAll();
    setStatus("", "is-ok");
  } catch (error) {
    console.error(error);
    setStatus("Не удалось обновить данные", "is-error");
  } finally {
    if (button) { button.disabled = false; button.textContent = "↻ Обновить данные"; }
  }
}

function initTabs() {
  document.querySelectorAll(".tab[data-tab]").forEach(button => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.tab;
      const targetPage = byId(targetId);
      if (!targetPage) return;
      document.querySelectorAll(".tab[data-tab]").forEach(b => b.classList.remove("is-active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("is-active"));
      button.classList.add("is-active");
      targetPage.classList.add("is-active");
      if (targetId === "analytics") renderAnalytics();
      if (targetId === "submit") renderSubmitForm();
      if (targetId === "predictions") renderPredictionControls();
    });
  });
}

function init() {
  initTabs();
  initSubmitHandlers();
  renderAll();
  const button = byId("refreshButton");
  if (button) button.addEventListener("click", () => loadSheetData(true));
  loadSheetData();
  const interval = data.settings.autoRefreshMs || 60000;
  refreshTimerId = window.setInterval(() => loadSheetData(false), interval);
}

init();

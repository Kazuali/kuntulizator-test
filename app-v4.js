let data = window.KUNTULIZATOR_DATA;
let refreshTimerId = null;

const byId = (id) => document.getElementById(id);
const e = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
const fmt = (n) => Number(n || 0).toFixed(data.settings.decimalPlaces);
const pct = (part, total) => total ? `${Math.round((part / total) * 100)}%` : "—";
const outcome = (h, a) => h > a ? "home" : h < a ? "away" : "draw";

function clean(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function parseScore(value) {
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw
    .replace(/[—–]/g, "-")
    .replace(/[.:,]/g, "-")
    .replace(/\s+/g, "");
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
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = "";
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === '\r') {
      // ignore CR; LF will close the row
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function splitTeams(title) {
  const normalized = clean(title);
  const parts = normalized.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) {
    return { home: parts[0].trim(), away: parts.slice(1).join(" — ").trim() };
  }
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
    matchCols.push({ col, title, home, away, score });
  }

  const participantRows = rows
    .slice(headerIndex + 1, resultIndex)
    .filter(row => clean(row[0]));

  const participants = participantRows.map((row, index) => ({
    id: `p${index + 1}`,
    name: clean(row[0])
  }));

  const matches = matchCols.map((m, index) => ({
    id: `m${index + 1}`,
    round: data.settings.roundLabel,
    title: m.title,
    home: m.home,
    away: m.away,
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

  return {
    ...data,
    participants,
    matches,
    predictions
  };
}

function setStatus(message, kind = "") {
  const el = byId("dataStatus");
  if (!el) return;
  el.classList.remove("is-ok", "is-error");
  if (kind) el.classList.add(kind);

  // Не показываем технический статус при нормальной работе.
  // Показываем только ошибку, чтобы не засорять главный экран.
  if (kind === "is-error") {
    el.hidden = false;
    el.textContent = message;
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

function participantName(id) {
  return data.participants.find(p => p.id === id)?.name || id;
}

function matchTitle(match) {
  return `${match.home} — ${match.away}`;
}

function getPredictions(matchId) {
  return data.predictions.filter(p => p.matchId === matchId);
}

function outcomeLabel(code, match) {
  if (code === "home") return `Победа: ${match.home}`;
  if (code === "away") return `Победа: ${match.away}`;
  return "Ничья";
}

function calculateMatchBreakdowns() {
  return data.matches
    .filter(match => match.homeScore !== null && match.awayScore !== null)
    .map(match => {
      const fact = outcome(match.homeScore, match.awayScore);
      const preds = getPredictions(match.id);
      const resultWinners = preds.filter(p => outcome(p.home, p.away) === fact);
      const exactWinners = preds.filter(p => p.home === match.homeScore && p.away === match.awayScore);
      const resultPoints = resultWinners.length ? data.settings.resultBank / resultWinners.length : 0;
      const exactPoints = exactWinners.length ? data.settings.exactScoreBank / exactWinners.length : 0;

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

      return {
        match,
        fact,
        preds,
        resultWinners,
        exactWinners,
        resultPoints,
        exactPoints,
        burnedResultBank: resultWinners.length ? 0 : data.settings.resultBank,
        burnedExactScoreBank: exactWinners.length ? 0 : data.settings.exactScoreBank,
        rows
      };
    });
}

function calculateStandings() {
  const rows = data.participants.map((p, seed) => ({
    id: p.id,
    name: p.name,
    seed,
    total: 0,
    resultPoints: 0,
    exactScorePoints: 0,
    resultHits: 0,
    exactHits: 0,
    misses: 0,
    played: 0,
    bestMatchPoints: 0,
    bestMatchTitle: "—"
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
      if (p.total > row.bestMatchPoints) {
        row.bestMatchPoints = p.total;
        row.bestMatchTitle = matchTitle(b.match);
      }
    }
  }

  return rows.sort((a, b) =>
    b.total - a.total ||
    b.exactHits - a.exactHits ||
    b.resultHits - a.resultHits ||
    a.seed - b.seed
  );
}

function getAnalytics() {
  const standings = calculateStandings();
  const breakdowns = calculateMatchBreakdowns();
  const completed = breakdowns.length;
  const leader = standings[0] || null;
  const border = standings[data.settings.topPlaces - 1] || null;
  const firstRisk = standings[data.settings.topPlaces] || null;
  const topResult = [...standings].sort((a, b) => b.resultHits - a.resultHits || b.total - a.total || a.seed - b.seed)[0] || null;
  const topExact = [...standings].sort((a, b) => b.exactHits - a.exactHits || b.total - a.total || a.seed - b.seed)[0] || null;
  const bestAverage = [...standings].filter(r => r.played > 0).sort((a, b) => (b.total / b.played) - (a.total / a.played) || a.seed - b.seed)[0] || null;

  let bestSingle = null;
  for (const b of breakdowns) {
    for (const row of b.rows) {
      if (!bestSingle || row.total > bestSingle.total) {
        bestSingle = { ...row, matchTitle: matchTitle(b.match), score: `${b.match.homeScore}-${b.match.awayScore}` };
      }
    }
  }

  const totalBurnedResult = breakdowns.reduce((sum, b) => sum + b.burnedResultBank, 0);
  const totalBurnedExact = breakdowns.reduce((sum, b) => sum + b.burnedExactScoreBank, 0);
  const totalBurned = totalBurnedResult + totalBurnedExact;
  const totalExactHits = standings.reduce((sum, r) => sum + r.exactHits, 0);
  const totalResultHits = standings.reduce((sum, r) => sum + r.resultHits, 0);

  const hardestByResult = [...breakdowns].sort((a, b) => a.resultWinners.length - b.resultWinners.length || a.exactWinners.length - b.exactWinners.length)[0] || null;
  const easiestByResult = [...breakdowns].sort((a, b) => b.resultWinners.length - a.resultWinners.length || b.exactWinners.length - a.exactWinners.length)[0] || null;
  const bestExactMatch = [...breakdowns].sort((a, b) => b.exactWinners.length - a.exactWinners.length || b.resultWinners.length - a.resultWinners.length)[0] || null;

  return {
    standings,
    breakdowns,
    completed,
    leader,
    border,
    firstRisk,
    topResult,
    topExact,
    bestAverage,
    bestSingle,
    totalBurned,
    totalBurnedResult,
    totalBurnedExact,
    totalExactHits,
    totalResultHits,
    hardestByResult,
    easiestByResult,
    bestExactMatch
  };
}


function renderLoserBanner() {
  const el = byId("loserBanner");
  if (!el) return;
  const a = getAnalytics();
  const standings = a.standings || [];
  const last = standings[standings.length - 1] || null;
  const name = a.completed && last ? last.name : "пока не определён";
  el.innerHTML = `<span>Лох ебаный:</span><strong>${e(name)}</strong>`;
}

function renderStats() {
  const a = getAnalytics();
  const gap = a.border && a.firstRisk ? Math.max(0, a.border.total - a.firstRisk.total) : 0;
  const stats = [
    ["Лидер", a.leader && a.completed ? `${a.leader.name} · ${fmt(a.leader.total)}` : "—"],
    ["Сыграно", `${a.completed} / ${data.matches.length}`],
    [`Граница топ-${data.settings.topPlaces}`, a.completed ? `${fmt(a.border?.total || 0)} · отрыв ${fmt(gap)}` : "—"],
    ["Точных счетов", a.completed ? a.totalExactHits : "—"],
  ];

  byId("stats").innerHTML = stats.map(([label, value]) => `
    <div class="stat"><span>${e(label)}</span><strong>${e(value)}</strong></div>
  `).join("");
}

function renderZonePreview() {
  const standings = calculateStandings();
  byId("zonePreview").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Место</th><th>Участник</th><th>Очки</th><th>Зона</th></tr></thead>
        <tbody>
          ${standings.map((r, i) => {
            const good = i < data.settings.topPlaces;
            return `<tr>
              <td class="rank">${i + 1}</td>
              <td>${e(r.name)}</td>
              <td>${fmt(r.total)}</td>
              <td class="${good ? "zone-good" : "zone-bad"}">${good ? `Топ-${data.settings.topPlaces}` : "Ебездалы"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderUpcoming() {
  const upcoming = data.matches.filter(m => m.homeScore === null || m.awayScore === null);
  const list = (upcoming.length ? upcoming : data.matches).slice(0, 6);
  byId("upcomingMatches").innerHTML = list.map(m => `
    <div class="match-card">
      <h3>${e(matchTitle(m))}</h3>
      <div class="score">${m.homeScore === null ? "результат пока не введён" : `${m.homeScore}-${m.awayScore}`}</div>
    </div>
  `).join("");
}

function renderStandings() {
  const standings = calculateStandings();
  byId("standingsTable").innerHTML = `
    <thead>
      <tr>
        <th>Место</th><th>Участник</th><th>Очки</th><th>Исходы</th><th>Точные</th><th>Лучший матч</th><th>Зона</th>
      </tr>
    </thead>
    <tbody>
      ${standings.map((r, i) => {
        const good = i < data.settings.topPlaces;
        const best = r.bestMatchPoints ? `${fmt(r.bestMatchPoints)} · ${r.bestMatchTitle}` : "—";
        return `<tr>
          <td class="rank">${i + 1}</td>
          <td>${e(r.name)}</td>
          <td>${fmt(r.total)}</td>
          <td>${r.resultHits}</td>
          <td>${r.exactHits}</td>
          <td>${e(best)}</td>
          <td class="${good ? "zone-good" : "zone-bad"}">${good ? "Победная" : "Ебездалы"}</td>
        </tr>`;
      }).join("")}
    </tbody>
  `;
}

function renderMatches() {
  const breakdownByMatch = Object.fromEntries(calculateMatchBreakdowns().map(b => [b.match.id, b]));
  byId("matchCards").innerHTML = data.matches.map((m, index) => {
    const b = breakdownByMatch[m.id];
    const meta = b
      ? `<div class="mini-meta">Исход: ${b.resultWinners.length}/${data.participants.length} · точный: ${b.exactWinners.length}/${data.participants.length}</div>`
      : `<div class="mini-meta">ожидается</div>`;
    return `
      <div class="match-card">
        <h3>${index + 1}. ${e(matchTitle(m))}</h3>
        <p class="muted">${e(m.round)}</p>
        <div class="score">${m.homeScore === null ? "—" : `${m.homeScore}-${m.awayScore}`}</div>
        ${meta}
      </div>
    `;
  }).join("");
}

function renderPredictionControls() {
  const select = byId("matchSelect");
  const previousValue = select.value;
  select.innerHTML = data.matches.map(m => `<option value="${e(m.id)}">${e(matchTitle(m))}</option>`).join("");
  const nextValue = data.matches.some(m => m.id === previousValue) ? previousValue : data.matches[0]?.id;
  if (nextValue) select.value = nextValue;
  select.onchange = () => renderPredictions(select.value);
  if (select.value) renderPredictions(select.value);
}

function renderPredictions(matchId) {
  const match = data.matches.find(m => m.id === matchId);
  if (!match) return;
  const preds = getPredictions(matchId).map(p => ({...p, name: participantName(p.participantId)}));
  const breakdown = calculateMatchBreakdowns().find(b => b.match.id === matchId);
  const pointsByParticipant = breakdown ? Object.fromEntries(breakdown.rows.map(r => [r.participantId, r])) : {};

  const homeCount = preds.filter(p => outcome(p.home, p.away) === "home").length;
  const drawCount = preds.filter(p => outcome(p.home, p.away) === "draw").length;
  const awayCount = preds.filter(p => outcome(p.home, p.away) === "away").length;

  byId("predictionSummary").innerHTML = `
    <div class="summary-pill"><span>${e(match.home)}</span><strong>${homeCount}</strong><small>прогнозов на победу</small></div>
    <div class="summary-pill"><span>Ничья</span><strong>${drawCount}</strong><small>прогнозов</small></div>
    <div class="summary-pill"><span>${e(match.away)}</span><strong>${awayCount}</strong><small>прогнозов на победу</small></div>
  `;

  byId("predictionsTable").innerHTML = `
    <thead>
      <tr><th>Участник</th><th>Прогноз</th><th>Исход прогноза</th><th>Очки за матч</th></tr>
    </thead>
    <tbody>
      ${preds.map(p => {
        const o = outcome(p.home, p.away);
        const points = pointsByParticipant[p.participantId]?.total;
        return `<tr>
          <td>${e(p.name)}</td>
          <td>${p.home}-${p.away}</td>
          <td>${e(outcomeLabel(o, match))}</td>
          <td>${points === undefined ? "—" : fmt(points)}</td>
        </tr>`;
      }).join("")}
    </tbody>
  `;
}

function renderAnalytics() {
  const a = getAnalytics();
  const gap = a.border && a.firstRisk ? Math.max(0, a.border.total - a.firstRisk.total) : 0;
  const last = a.standings[a.standings.length - 1] || null;
  const loserName = a.completed && last ? last.name : "—";

  const analyticsStats = [
    ["Точных счетов", a.completed ? a.totalExactHits : "—"],
    ["Угаданных исходов", a.completed ? a.totalResultHits : "—"],
    ["Отрыв 7-го от 8-го", a.completed ? fmt(gap) : "—"],
    ["Лох ебаный", loserName]
  ];

  byId("analyticsStats").innerHTML = analyticsStats.map(([label, value]) => `
    <div class="stat"><span>${e(label)}</span><strong>${e(value)}</strong></div>
  `).join("");

  const empty = `<p class="muted">Статистика появится после первого введённого результата.</p>`;
  if (!a.completed) {
    byId("topAnalytics").innerHTML = empty;
    byId("matchAnalytics").innerHTML = empty;
  } else {
    byId("topAnalytics").innerHTML = `
      <div class="insight-list">
        <div class="insight"><span>Лидер</span><strong>${e(a.leader?.name || "—")} · ${fmt(a.leader?.total || 0)}</strong></div>
        <div class="insight"><span>Лучший по исходам</span><strong>${e(a.topResult?.name || "—")} · ${a.topResult?.resultHits ?? 0}</strong></div>
        <div class="insight"><span>Лучший по точным счетам</span><strong>${e(a.topExact?.name || "—")} · ${a.topExact?.exactHits ?? 0}</strong></div>
        <div class="insight"><span>Лучший разовый матч</span><strong>${a.bestSingle ? `${e(a.bestSingle.participantName)} · ${fmt(a.bestSingle.total)} · ${e(a.bestSingle.matchTitle)}` : "—"}</strong></div>
        <div class="insight"><span>Лучший средний темп</span><strong>${a.bestAverage ? `${e(a.bestAverage.name)} · ${fmt(a.bestAverage.total / a.bestAverage.played)} за матч` : "—"}</strong></div>
      </div>
    `;

    byId("matchAnalytics").innerHTML = `
      <div class="insight-list">
        <div class="insight"><span>Сложнейший матч по исходу</span><strong>${a.hardestByResult ? `${e(matchTitle(a.hardestByResult.match))} · ${a.hardestByResult.resultWinners.length}/${data.participants.length}` : "—"}</strong></div>
        <div class="insight"><span>Самый понятный матч</span><strong>${a.easiestByResult ? `${e(matchTitle(a.easiestByResult.match))} · ${a.easiestByResult.resultWinners.length}/${data.participants.length}` : "—"}</strong></div>
        <div class="insight"><span>Лучший матч по точным счетам</span><strong>${a.bestExactMatch ? `${e(matchTitle(a.bestExactMatch.match))} · ${a.bestExactMatch.exactWinners.length}/${data.participants.length}` : "—"}</strong></div>
        <div class="insight"><span>Самый дорогой прогноз</span><strong>${a.bestSingle ? `${e(a.bestSingle.participantName)} · ${fmt(a.bestSingle.total)} очков` : "—"}</strong></div>
      </div>
    `;
  }

  const participantRows = calculateStandings();
  byId("participantStatsTable").innerHTML = `
    <thead>
      <tr><th>Участник</th><th>Очки</th><th>Исходы</th><th>Точные</th><th>Мимо</th><th>Средние очки</th><th>Точность исходов</th></tr>
    </thead>
    <tbody>
      ${participantRows.map(r => `
        <tr>
          <td>${e(r.name)}</td>
          <td>${fmt(r.total)}</td>
          <td>${r.resultHits}</td>
          <td>${r.exactHits}</td>
          <td>${r.misses}</td>
          <td>${r.played ? fmt(r.total / r.played) : "—"}</td>
          <td>${pct(r.resultHits, r.played)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

function renderAll() {
  renderLoserBanner();
  renderStats();
  renderZonePreview();
  renderUpcoming();
  renderStandings();
  renderMatches();
  renderPredictionControls();
  renderAnalytics();
}

async function loadSheetData(manual = false) {
  const button = byId("refreshButton");
  const url = data.settings.sheetCsvUrl;
  if (!url) {
    setStatus("Локальные данные", "");
    return;
  }

  try {
    if (button) {
      button.disabled = true;
      if (manual) button.textContent = "Обновляю…";
    }
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    data = buildDataFromSheet(csvText);
    renderAll();
    const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStatus(`Обновлено: ${time}`, "is-ok");
  } catch (error) {
    console.error(error);
    setStatus("Не удалось обновить данные", "is-error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "↻ Обновить данные";
    }
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
    });
  });
}

function init() {
  initTabs();
  renderAll();
  const button = byId("refreshButton");
  if (button) button.addEventListener("click", () => loadSheetData(true));
  loadSheetData();

  const interval = data.settings.autoRefreshMs || 60000;
  refreshTimerId = window.setInterval(() => loadSheetData(false), interval);
}

init();

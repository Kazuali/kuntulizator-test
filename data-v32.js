window.KUNTULIZATOR_DATA = {
  settings: {
    title: "Кунтулизатор",
    subtitle: "Закрытая лига прогнозов на ЧМ-2026",
    decimalPlaces: 2,
    topPlaces: 8,
    topPlacesWhen15Plus: 8,
    banksBurnIfNoWinner: true,
    dynamicBank: true,
    resultStakePerActiveParticipant: 100,
    exactStakePerActiveParticipant: 50,
    playoffPolicy: "Плей-офф: прогноз = счёт + команда, которая проходит дальше. При ничье команда обязательна.",
    autoRefreshMs: 60000,
    hidePredictionsUntilDeadline: true,
    defaultSubmitRoundKey: "r4",
    submissionApiVersion: "v7",
    submissionWebAppUrl: "https://script.google.com/macros/s/AKfycbwWBwl2c6Hv7IbTOXpLjh_bn1_osOt0dKl13PoE4mSA-1FpXnYZB-BtfW60W4_-KNOU/exec",
    participantMeta: {
      "Лакец": {
        activeFromRoundKey: "r1",
        activeFromMatchTitle: "Гаити — Шотландия",
        initialPoints: 125.00
      }
    },
    rounds: [
      {
        key: "r1",
        title: "1 тур",
        sheetName: "1-тур",
        order: 1,
        deadline: "2026-06-11T22:00:00+03:00",
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpyPbcc20eeE0khQNgK5xBDvhUmJMdLClNhl0YgH31GMriyF2-yeMyw1WNzENB7efQZUP-5PNeSAtd/pub?gid=0&single=true&output=csv"
      },
      {
        key: "r2",
        title: "2 тур",
        sheetName: "2-тур",
        order: 2,
        deadline: "2026-06-18T19:00:00+03:00",
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpyPbcc20eeE0khQNgK5xBDvhUmJMdLClNhl0YgH31GMriyF2-yeMyw1WNzENB7efQZUP-5PNeSAtd/pub?gid=1607398482&single=true&output=csv"
      },
      {
        key: "r3",
        title: "3 тур",
        sheetName: "3-тур",
        order: 3,
        deadline: "2026-06-24T22:00:00+03:00",
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpyPbcc20eeE0khQNgK5xBDvhUmJMdLClNhl0YgH31GMriyF2-yeMyw1WNzENB7efQZUP-5PNeSAtd/pub?gid=825373529&single=true&output=csv"
      },
      {
        key: "r4",
        title: "1/16 финала",
        sheetName: "1-16",
        order: 4,
        type: "playoff",
        deadline: "2026-06-29T20:00:00+03:00",
        resultStakePerActiveParticipant: 100,
        exactStakePerActiveParticipant: 100,
        submissionStartMatchIndex: 2,
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpyPbcc20eeE0khQNgK5xBDvhUmJMdLClNhl0YgH31GMriyF2-yeMyw1WNzENB7efQZUP-5PNeSAtd/pub?gid=256656047&single=true&output=csv"
      }
    ]
  },
  participants: [],
  matches: [],
  predictions: []
};

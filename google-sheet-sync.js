/**
 * Загрузка графика из Google Таблицы (кнопка админа).
 * Парсер: B — объект (аббр.), C — полное имя, D — ТН, E — ФИО, F+ — дни (строка 1 — месяцы).
 */
(function (global) {
  const SHEET_SCHEDULE_YEAR = 2026;
  const COL_OBJECT_ABBR = 1;
  const COL_OBJECT_FULL = 2;
  const COL_TN = 3;
  const COL_FIO = 4;
  const COL_DAY_START = 5;

  const SHIFT_CODES_FOR_DAYS = new Set(["СПГ", "СПГ.", "ИНК", "УР", "ГАЛС", "М", "АПК", "ЗЛ"]);

  const MONTH_HINTS = [
    ["январ", 0],
    ["феврал", 1],
    ["март", 2],
    ["апрел", 3],
    ["мая", 4],
    ["май", 4],
    ["июн", 5],
    ["июл", 6],
    ["август", 7],
    ["сентябр", 8],
    ["октябр", 9],
    ["ноябр", 10],
    ["декабр", 11],
  ];

  const OBJECT_ABBREV_TO_SECTION = new Map([
    ["всм", "ust"],
    ["ул", "ust"],
    ["усть-луга", "ust"],
    ["усть луга", "ust"],
    ["vsm", "ust"],
    ["пп", "pilot"],
    ["пил", "pilot"],
    ["пилот", "pilot"],
    ["пилотные", "pilot"],
    ["пилотные проекты", "pilot"],
  ]);

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];
      if (c === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && (c === "\n" || (c === "\r" && next === "\n"))) {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        if (c === "\r") i++;
        continue;
      }
      if (!inQuotes && c === ",") {
        row.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    if (cur.length || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
  }

  function dim(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function monthKey(year, monthIndex) {
    return `${year}-${monthIndex + 1}`;
  }

  function normalizeCell(raw) {
    if (raw == null) return "";
    let s = String(raw).trim().replace(/\uFEFF/g, "");
    if (!s) return "";
    if (s === "—") return "";
    if (s === "-" || s === "−" || s === "–") return "-";
    const t = s.replace(/−/g, "-");
    if (/^СПГ\s*[-–—]\s*$/i.test(t)) return "СПГ-";
    if (/^СПГ\.\s*$/i.test(t)) return "СПГ.";
    if (/^ТСБ\.\s*$/i.test(t)) return "ТСБ.";
    if (/^СПГ\s*$/i.test(t)) return "СПГ";
    if (/^ТСБ\s*$/i.test(t)) return "ТСБ";
    if (/^ЛЕГ\s*$/i.test(t)) return "ЛЕГ";
    if (/^OT$/i.test(t)) return "ОТ";
    if (/^BX$/i.test(t)) return "ВХ";
    const map = new Map([
      ["ОТ", "ОТ"],
      ["ВХ", "ВХ"],
      ["Б", "Б"],
      ["БЛ", "БЛ"],
      ["ВП", "ВП"],
      ["О", "О"],
      ["УР", "УР"],
      ["ИНК", "ИНК"],
      ["ГАЛС", "ГАЛС"],
      ["М", "М"],
      ["АПК", "АПК"],
      ["ЗЛ", "ЗЛ"],
      ["ЛЕГ", "ЛЕГ"],
      ["СПГ-", "СПГ-"],
    ]);
    if (map.has(t)) return map.get(t);
    return t;
  }

  function monthIndexFromMonthLabel(text) {
    const low = String(text || "").trim().toLowerCase();
    if (!low) return null;
    for (const [hint, idx] of MONTH_HINTS) {
      if (low.includes(hint)) return idx;
    }
    return null;
  }

  function isDayNumberHeaderRow(row) {
    if (!row) return false;
    let hits = 0;
    for (let c = COL_DAY_START; c < row.length && c < COL_DAY_START + 8; c++) {
      const n = Number(String(row[c] || "").trim(), 10);
      if (Number.isFinite(n) && n === c - COL_DAY_START + 1) hits++;
    }
    return hits >= 4;
  }

  function countMonthLabels(row) {
    if (!row) return 0;
    let n = 0;
    for (let c = COL_DAY_START; c < row.length; c++) {
      if (monthIndexFromMonthLabel(row[c]) != null) n++;
    }
    return n;
  }

  function findMaxDataCol(rows) {
    let max = COL_DAY_START;
    for (const row of rows) {
      if (row && row.length - 1 > max) max = row.length - 1;
    }
    while (max > COL_DAY_START) {
      let any = false;
      for (const row of rows) {
        if (String(row[max] || "").trim()) {
          any = true;
          break;
        }
      }
      if (any) break;
      max--;
    }
    return max;
  }

  function resolveSheetLayout(rows) {
    let monthRowIdx = 0;
    let bestLabels = 0;
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const n = countMonthLabels(rows[r]);
      if (n > bestLabels) {
        bestLabels = n;
        monthRowIdx = r;
      }
    }
    let dataStartRow = 1;
    for (let r = 0; r < Math.min(12, rows.length); r++) {
      if (String(rows[r][COL_FIO] || "").trim() === "ФИО") {
        dataStartRow = r + 1;
        break;
      }
    }
    if (bestLabels < 2) {
      for (let r = 0; r < Math.min(6, rows.length); r++) {
        if (isDayNumberHeaderRow(rows[r])) {
          dataStartRow = Math.max(dataStartRow, r + 1);
          break;
        }
      }
      return { monthRowIdx: -1, dataStartRow, useSequential: true };
    }
    dataStartRow = Math.max(dataStartRow, monthRowIdx + 1);
    return { monthRowIdx, dataStartRow, useSequential: false };
  }

  function sequentialMonthSpans(year, maxCol) {
    const spans = [];
    let col = COL_DAY_START;
    for (let m = 0; m < 12 && col <= maxCol; m++) {
      const dmax = dim(year, m);
      spans.push({ monthKey: monthKey(year, m), startCol: col, dim: dmax });
      col += dmax;
    }
    return spans;
  }

  function detectMonthSpans(headerRow, year, allRows, useSequential) {
    const maxCol = findMaxDataCol(allRows);
    if (useSequential || !headerRow) {
      return sequentialMonthSpans(year, maxCol);
    }

    const spans = [];
    for (let c = COL_DAY_START; c <= maxCol; c++) {
      const mIdx = monthIndexFromMonthLabel(headerRow[c]);
      if (mIdx == null) continue;
      const last = spans[spans.length - 1];
      if (last && last.monthIndex === mIdx) continue;
      spans.push({
        monthKey: monthKey(year, mIdx),
        monthIndex: mIdx,
        startCol: c,
        dim: dim(year, mIdx),
      });
    }

    if (spans.length >= 2) {
      for (let i = 0; i < spans.length; i++) {
        const next = spans[i + 1];
        if (next) spans[i].dim = Math.max(1, next.startCol - spans[i].startCol);
        else spans[i].dim = Math.max(1, maxCol - spans[i].startCol + 1);
        spans[i].dim = Math.min(spans[i].dim, dim(year, spans[i].monthIndex));
      }
      return spans;
    }

    return sequentialMonthSpans(year, maxCol);
  }

  function isEmployeeRow(cols) {
    const fio = (cols[COL_FIO] || "").trim();
    const tn = (cols[COL_TN] || "").trim();
    if (!fio) return false;
    if (/кол-во|итого|сотрудников|нехватка|^\s*спг\s*:/i.test(fio)) return false;
    if (/^Итого|^СПГ:|^ТСБ/i.test(fio)) return false;
    if (tn && /^\d+$/.test(tn)) return true;
    if (/^[А-ЯЁ][а-яё\-]+\s+[А-ЯЁ][а-яё\-]+/.test(fio)) return true;
    return false;
  }

  function extractSchedule(cols, span) {
    const schedule = {};
    for (let d = 1; d <= span.dim; d++) {
      schedule[d] = normalizeCell(cols[span.startCol + d - 1]);
    }
    return schedule;
  }

  function daysOnShiftFromSchedule(schedule, dmax) {
    let n = 0;
    for (let d = 1; d <= dmax; d++) {
      if (SHIFT_CODES_FOR_DAYS.has(schedule[d])) n++;
    }
    return n;
  }

  function mapObjectToSection(abbr, fullName) {
    const a = String(abbr || "").trim().toLowerCase();
    const f = String(fullName || "").trim().toLowerCase();
    if (OBJECT_ABBREV_TO_SECTION.has(a)) return OBJECT_ABBREV_TO_SECTION.get(a);
    if (/пилот/i.test(f) || /пилот/i.test(a)) return "pilot";
    if (/усть|всм|ул/i.test(f) || /усть|всм|ул/i.test(a)) return "ust";
    return null;
  }

  function parseGoogleSheetCsv(csvText, year) {
    const rows = parseCSV(csvText);
    if (rows.length < 2) {
      throw new Error("Таблица слишком короткая — проверьте лист и выгрузку.");
    }
    const layout = resolveSheetLayout(rows);
    const headerRow = layout.useSequential ? null : rows[layout.monthRowIdx];
    const spans = detectMonthSpans(headerRow, year, rows, layout.useSequential);
    if (!spans.length) {
      throw new Error("Не удалось определить месяцы (колонки с F).");
    }

    const byMonth = new Map();
    for (const span of spans) {
      byMonth.set(span.monthKey, []);
    }

    for (let r = layout.dataStartRow; r < rows.length; r++) {
      const cols = rows[r];
      if (!isEmployeeRow(cols)) continue;
      const name = String(cols[COL_FIO] || "").trim();
      const tn = String(cols[COL_TN] || "").trim() || "—";
      const objectAbbr = String(cols[COL_OBJECT_ABBR] || "").trim();
      const objectFull = String(cols[COL_OBJECT_FULL] || "").trim();
      const sectionId = mapObjectToSection(objectAbbr, objectFull);

      for (const span of spans) {
        const schedule = extractSchedule(cols, span);
        byMonth.get(span.monthKey).push({
          name,
          tn,
          objectAbbr,
          objectFull,
          sectionId,
          schedule,
          daysOnShift: daysOnShiftFromSchedule(schedule, span.dim),
          dim: span.dim,
        });
      }
    }

    return {
      year,
      spans,
      layout,
      months: [...byMonth.entries()].map(([monthKey, employees]) => ({
        monthKey,
        employees,
      })),
      rowCount: rows.length,
    };
  }

  function normalizeName(name) {
    return String(name || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  global.WorkWatchGoogleSync = {
    SHEET_SCHEDULE_YEAR,
    parseGoogleSheetCsv,
    normalizeName,
    mapObjectToSection,
  };
})(typeof window !== "undefined" ? window : globalThis);

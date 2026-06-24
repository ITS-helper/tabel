(function (global) {
  const INDEX_URL = "data/damage-reports/index.json";
  const REPORT_BASE = "data/damage-reports";

  const state = {
    index: null,
    activeDate: null,
    activeReport: null,
    loading: false,
    initialized: false,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function formatDateLabel(isoDate) {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-");
    return `${day}.${month}.${year}`;
  }

  function setStatus(message) {
    const node = document.getElementById("damageReportsStatus");
    if (node) node.textContent = message;
  }

  function getDates() {
    return state.index?.dates || [];
  }

  function renderDateSelect() {
    const select = document.getElementById("damageReportsDateSelect");
    if (!select) return;
    const dates = getDates();
    select.innerHTML = dates
      .map((item) => {
        const selected = item.date === state.activeDate ? " selected" : "";
        const counts = item.counts || {};
        const label = `${formatDateLabel(item.date)} | \u041f: ${counts.telegram ?? 0} | \u0410: ${counts.site ?? 0} | \u0418\u0442\u043e\u0433\u043e: ${counts.total_devices ?? 0}`;
        return `<option value="${escapeHtml(item.date)}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function bindControls() {
    const select = document.getElementById("damageReportsDateSelect");
    if (select && !select.dataset.bound) {
      select.dataset.bound = "1";
      select.addEventListener("change", () => {
        void loadReport(select.value);
      });
    }

    const copyBtn = document.getElementById("damageReportsCopyBtn");
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = "1";
      copyBtn.addEventListener("click", async () => {
        await copyCurrentReport();
      });
    }

    const exportBtn = document.getElementById("damageReportsExportBtn");
    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.dataset.bound = "1";
      exportBtn.addEventListener("click", async () => {
        await exportAllReports();
      });
    }

    const repeatBtn = document.getElementById("damageReportsRepeatBtn");
    if (repeatBtn && !repeatBtn.dataset.bound) {
      repeatBtn.dataset.bound = "1";
      repeatBtn.addEventListener("click", async () => {
        await exportRepeatDevicesReport();
      });
    }
  }

  function renderIncidentList(items, emptyLabel) {
    if (!items.length) {
      return `<p class="damage-reports__empty">${escapeHtml(emptyLabel)}</p>`;
    }
    return `
      <ul class="damage-reports__list">
        ${items
          .map((item) => {
            const label = `- | ${item.issue_type} | ${item.uid_short}`;
            const text = escapeHtml(label);
            const href = escapeHtml(item.source_url || "#");
            return `
              <li class="damage-reports__item">
                <a class="damage-reports__link" href="${href}" target="_blank" rel="noreferrer">
                  ${text}
                </a>
                <span class="damage-reports__time">${escapeHtml(item.time)}</span>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  function formatEmployeeNumber(item) {
    const value = String(item?.employee_number || "").trim();
    return value ? ` | ТН ${value}` : "";
  }

  function buildClipboardText(report) {
    if (!report) return "";
    const telegram = report.telegram || [];
    const site = report.site || [];
    const lines = [
      report.title,
      "",
      `\u041f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u043d\u044b\u0435: ${report.counts.telegram}`,
      `\u0410\u043f\u043f\u0430\u0440\u0430\u0442\u043d\u044b\u0435: ${report.counts.site}`,
      `\u0418\u0442\u043e\u0433\u043e \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432: ${report.counts.total_devices}`,
      "",
      "\u041f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u043d\u044b\u0435:",
    ];

    if (telegram.length) {
      for (const item of telegram) {
        lines.push(
          `- | ${item.issue_type} | ${item.uid_short}${formatEmployeeNumber(item)} | ${item.source_url || ""}`.trim()
        );
      }
    } else {
      lines.push("- \u043d\u0435\u0442");
    }

    lines.push("");
    lines.push("\u0410\u043f\u043f\u0430\u0440\u0430\u0442\u043d\u044b\u0435:");
    if (site.length) {
      for (const item of site) {
        lines.push(
          `- | ${item.issue_type} | ${item.uid_short}${formatEmployeeNumber(item)} | ${item.source_url || ""}`.trim()
        );
      }
    } else {
      lines.push("- \u043d\u0435\u0442");
    }

    return lines.join("\n");
  }

  function selfCheckClipboardTextEmployeeNumber() {
    const text = buildClipboardText({
      title: "Повреждения от 24.06.2026",
      counts: { telegram: 1, site: 1, total_devices: 2 },
      telegram: [
        { issue_type: "Падение", uid_short: "1234", employee_number: "5678", source_url: "https://t.me/c/1/2" },
      ],
      site: [{ issue_type: "Батарея", uid_short: "abcd", source_url: "https://device.workwatch.pro/x" }],
    });
    console.assert(text.includes("| 1234 | ТН 5678 |"), "clipboard self-check failed: employee number");
    console.assert(!text.includes("| abcd | ТН"), "clipboard self-check failed: optional employee number");
  }

  async function copyCurrentReport() {
    if (!state.activeReport) {
      setStatus("\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043e\u0442\u0447\u0435\u0442 \u0434\u043b\u044f \u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f.");
      return;
    }
    const text = buildClipboardText(state.activeReport);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("\u041e\u0442\u0447\u0435\u0442 \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d \u0432 \u0431\u0443\u0444\u0435\u0440.");
    } catch (error) {
      console.error(error);
      setStatus("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043e\u0442\u0447\u0435\u0442 \u0432 \u0431\u0443\u0444\u0435\u0440.");
    }
  }

  async function fetchReport(dateValue) {
    const response = await fetch(`${REPORT_BASE}/${dateValue}.json`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Report request failed: ${response.status}`);
    }
    return response.json();
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  async function exportAllReports() {
    const dates = getDates();
    if (!dates.length) {
      setStatus("\u041d\u0435\u0442 \u043e\u0442\u0447\u0435\u0442\u043e\u0432 \u0434\u043b\u044f \u0432\u044b\u0433\u0440\u0443\u0437\u043a\u0438.");
      return;
    }

    setStatus("\u0421\u043e\u0431\u0438\u0440\u0430\u044e \u043f\u043e\u043b\u043d\u0443\u044e \u0431\u0430\u0437\u0443 \u043e\u0442\u0447\u0435\u0442\u043e\u0432...");
    try {
      const reports = await Promise.all(
        dates.map(async ({ date }) => {
          const report = await fetchReport(date);
          return buildClipboardText(report);
        })
      );
      const text = reports.join("\n\n====================\n\n");
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`damage-reports-all-${stamp}.txt`, text);
      setStatus("\u041f\u043e\u043b\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u043e\u0442\u0447\u0435\u0442\u043e\u0432 \u0432\u044b\u0433\u0440\u0443\u0436\u0435\u043d\u0430.");
    } catch (error) {
      console.error(error);
      setStatus("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u044b\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u043e\u043b\u043d\u0443\u044e \u0431\u0430\u0437\u0443 \u043e\u0442\u0447\u0435\u0442\u043e\u0432.");
    }
  }

  function buildRepeatDeviceEntries(reports) {
    const devices = new Map();
    for (const report of reports) {
      const date = report?.date || "";
      for (const item of [...(report?.telegram || []), ...(report?.site || [])]) {
        if (!item?.uid) continue;
        let entry = devices.get(item.uid);
        if (!entry) {
          entry = {
            uid: item.uid,
            uid_short: item.uid_short || item.uid.slice(0, 4),
            incidents: [],
          };
          devices.set(item.uid, entry);
        }
        entry.incidents.push({
          date,
          time: item.time || "",
          source: item.source || "",
          issue_type: item.issue_type || "",
          source_url: item.source_url || "",
        });
      }
    }

    return [...devices.values()]
      .filter((entry) => entry.incidents.length >= 2)
      .map((entry) => {
        const dates = [...new Set(entry.incidents.map((item) => item.date).filter(Boolean))];
        return {
          ...entry,
          occurrences: entry.incidents.length,
          unique_dates: dates.length,
          dates,
        };
      })
      .sort((left, right) => {
        if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
        return left.uid_short.localeCompare(right.uid_short, "ru");
      });
  }

  function buildRepeatDevicesText(entries) {
    const lines = [
      "Устройства, встречавшиеся в отчетах 2+ раза",
      "",
      `Всего устройств: ${entries.length}`,
      "",
    ];

    if (!entries.length) {
      lines.push("Повторов не найдено.");
      return lines.join("\n");
    }

    for (const entry of entries) {
      lines.push(
        `${entry.uid_short} | ${entry.uid} | инцидентов: ${entry.occurrences} | дат: ${entry.unique_dates}`
      );
      for (const incident of entry.incidents) {
        lines.push(
          `- ${incident.date} ${incident.time} | ${incident.source} | ${incident.issue_type} | ${incident.source_url}`.trim()
        );
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  }

  async function exportRepeatDevicesReport() {
    const dates = getDates();
    if (!dates.length) {
      setStatus("Нет отчетов для поиска повторов.");
      return;
    }

    setStatus("Собираю повторные устройства по всем отчетам...");
    try {
      const reports = await Promise.all(dates.map(({ date }) => fetchReport(date)));
      const entries = buildRepeatDeviceEntries(reports);
      const text = buildRepeatDevicesText(entries);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`damage-repeat-devices-${stamp}.txt`, text);
      setStatus(
        entries.length
          ? `Повторные устройства выгружены: ${entries.length}.`
          : "Повторные устройства не найдены."
      );
    } catch (error) {
      console.error(error);
      setStatus("Не удалось собрать повторные устройства.");
    }
  }

  function selfCheckRepeatDeviceEntries() {
    const result = buildRepeatDeviceEntries([
      {
        date: "2026-06-01",
        telegram: [{ uid: "abc", uid_short: "abc", source: "telegram", issue_type: "Падение" }],
        site: [{ uid: "xyz", uid_short: "xyz", source: "site", issue_type: "Батарея" }],
      },
      {
        date: "2026-06-02",
        telegram: [{ uid: "abc", uid_short: "abc", source: "telegram", issue_type: "Падение" }],
        site: [],
      },
    ]);
    console.assert(result.length === 1, "repeat-device self-check failed: count");
    console.assert(result[0].uid === "abc", "repeat-device self-check failed: uid");
    console.assert(result[0].occurrences === 2, "repeat-device self-check failed: occurrences");
  }

  function renderReport() {
    const mount = document.getElementById("damageReportsMount");
    const title = document.getElementById("damageReportsTitle");
    const updated = document.getElementById("damageReportsUpdated");
    if (!mount || !title || !updated) return;

    if (!state.activeReport) {
      title.textContent = "\u041f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u044f";
      updated.textContent = "";
      mount.innerHTML = `<p class="damage-reports__empty">\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445 \u0434\u043b\u044f \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f.</p>`;
      return;
    }

    const report = state.activeReport;
    title.textContent = report.title;
    updated.textContent = report.generated_at
      ? `\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e: ${new Date(report.generated_at).toLocaleString("ru-RU")}`
      : "";

    mount.innerHTML = `
      <section class="damage-reports__summary surface-card">
        <div class="damage-reports__summary-grid">
          <article class="damage-reports__stat damage-reports__stat--software">
            <span class="damage-reports__stat-label">\u041f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u043d\u044b\u0435</span>
            <strong class="damage-reports__stat-value">${report.counts.telegram}</strong>
          </article>
          <article class="damage-reports__stat damage-reports__stat--hardware">
            <span class="damage-reports__stat-label">\u0410\u043f\u043f\u0430\u0440\u0430\u0442\u043d\u044b\u0435</span>
            <strong class="damage-reports__stat-value">${report.counts.site}</strong>
          </article>
          <article class="damage-reports__stat damage-reports__stat--total">
            <span class="damage-reports__stat-label">\u0418\u0442\u043e\u0433\u043e \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432</span>
            <strong class="damage-reports__stat-value">${report.counts.total_devices}</strong>
          </article>
        </div>
      </section>
      <section class="damage-reports__columns">
        <article class="damage-reports__panel surface-card">
          <header class="damage-reports__panel-head">
            <h3 class="damage-reports__panel-title">\u041f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u043d\u044b\u0435</h3>
            <span class="damage-reports__panel-count">${report.counts.telegram}</span>
          </header>
          ${renderIncidentList(report.telegram || [], "\u0417\u0430 \u044d\u0442\u043e\u0442 \u0434\u0435\u043d\u044c Telegram-\u0438\u043d\u0446\u0438\u0434\u0435\u043d\u0442\u043e\u0432 \u043d\u0435\u0442.")}
        </article>
        <article class="damage-reports__panel surface-card">
          <header class="damage-reports__panel-head">
            <h3 class="damage-reports__panel-title">\u0410\u043f\u043f\u0430\u0440\u0430\u0442\u043d\u044b\u0435</h3>
            <span class="damage-reports__panel-count">${report.counts.site}</span>
          </header>
          ${renderIncidentList(report.site || [], "\u0417\u0430 \u044d\u0442\u043e\u0442 \u0434\u0435\u043d\u044c \u0437\u0430\u044f\u0432\u043e\u043a Device.ww \u043d\u0435\u0442.")}
        </article>
      </section>
    `;
  }

  async function loadIndex() {
    const response = await fetch(INDEX_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Index request failed: ${response.status}`);
    }
    state.index = await response.json();
    state.activeDate = state.index.latest_date || state.index.dates?.[0]?.date || null;
    renderDateSelect();
    bindControls();
  }

  async function loadReport(dateValue) {
    if (!dateValue) return;
    state.loading = true;
    state.activeDate = dateValue;
    renderDateSelect();
    setStatus("\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044e \u043e\u0442\u0447\u0435\u0442...");
    try {
      state.activeReport = await fetchReport(dateValue);
      renderReport();
      setStatus("");
    } catch (error) {
      console.error(error);
      state.activeReport = null;
      renderReport();
      setStatus("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0442\u0447\u0435\u0442.");
    } finally {
      state.loading = false;
    }
  }

  async function initDamageReports() {
    bindControls();
    if (state.initialized) return;
    state.initialized = true;
    setStatus("\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044e \u0441\u043f\u0438\u0441\u043e\u043a \u043e\u0442\u0447\u0435\u0442\u043e\u0432...");
    try {
      await loadIndex();
      if (state.activeDate) {
        await loadReport(state.activeDate);
      } else {
        setStatus("\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0432\u044b\u0433\u0440\u0443\u0436\u0435\u043d\u043d\u044b\u0445 \u043e\u0442\u0447\u0435\u0442\u043e\u0432.");
        renderReport();
      }
    } catch (error) {
      console.error(error);
      setStatus("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0441\u043f\u0438\u0441\u043e\u043a \u043e\u0442\u0447\u0435\u0442\u043e\u0432.");
      renderReport();
    }
  }

  global.WorkWatchDamageReports = {
    init: initDamageReports,
    refresh: () => {
      state.initialized = false;
      return initDamageReports();
    },
  };

  selfCheckRepeatDeviceEntries();
  selfCheckClipboardTextEmployeeNumber();
})(typeof window !== "undefined" ? window : globalThis);

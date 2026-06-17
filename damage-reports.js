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
        lines.push(`- | ${item.issue_type} | ${item.uid_short} | ${item.source_url || ""}`.trim());
      }
    } else {
      lines.push("- \u043d\u0435\u0442");
    }

    lines.push("");
    lines.push("\u0410\u043f\u043f\u0430\u0440\u0430\u0442\u043d\u044b\u0435:");
    if (site.length) {
      for (const item of site) {
        lines.push(`- | ${item.issue_type} | ${item.uid_short} | ${item.source_url || ""}`.trim());
      }
    } else {
      lines.push("- \u043d\u0435\u0442");
    }

    return lines.join("\n");
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
      const response = await fetch(`${REPORT_BASE}/${dateValue}.json`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Report request failed: ${response.status}`);
      }
      state.activeReport = await response.json();
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
})(typeof window !== "undefined" ? window : globalThis);

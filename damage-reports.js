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
      .replace(/"/g, "&quot;");
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

  function renderDateTabs() {
    const mount = document.getElementById("damageReportsDateTabs");
    if (!mount) return;
    const dates = state.index?.dates || [];
    mount.innerHTML = dates
      .map((item) => {
        const isActive = item.date === state.activeDate;
        return `
          <button
            type="button"
            class="damage-reports__date-tab${isActive ? " is-active" : ""}"
            data-damage-date="${escapeHtml(item.date)}"
          >
            ${escapeHtml(formatDateLabel(item.date))}
          </button>
        `;
      })
      .join("");
    mount.querySelectorAll("[data-damage-date]").forEach((button) => {
      button.addEventListener("click", () => {
        void loadReport(button.getAttribute("data-damage-date"));
      });
    });
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

  function renderReport() {
    const mount = document.getElementById("damageReportsMount");
    const title = document.getElementById("damageReportsTitle");
    const updated = document.getElementById("damageReportsUpdated");
    if (!mount || !title || !updated) return;

    if (!state.activeReport) {
      title.textContent = "Повреждения";
      updated.textContent = "";
      mount.innerHTML = `<p class="damage-reports__empty">Нет данных для отображения.</p>`;
      return;
    }

    const report = state.activeReport;
    title.textContent = report.title;
    updated.textContent = report.generated_at
      ? `Обновлено: ${new Date(report.generated_at).toLocaleString("ru-RU")}`
      : "";

    mount.innerHTML = `
      <section class="damage-reports__summary surface-card">
        <div class="damage-reports__summary-grid">
          <article class="damage-reports__stat damage-reports__stat--software">
            <span class="damage-reports__stat-label">Программные</span>
            <strong class="damage-reports__stat-value">${report.counts.telegram}</strong>
          </article>
          <article class="damage-reports__stat damage-reports__stat--hardware">
            <span class="damage-reports__stat-label">Аппаратные</span>
            <strong class="damage-reports__stat-value">${report.counts.site}</strong>
          </article>
          <article class="damage-reports__stat damage-reports__stat--total">
            <span class="damage-reports__stat-label">Итого устройств</span>
            <strong class="damage-reports__stat-value">${report.counts.total_devices}</strong>
          </article>
        </div>
      </section>
      <section class="damage-reports__columns">
        <article class="damage-reports__panel surface-card">
          <header class="damage-reports__panel-head">
            <h3 class="damage-reports__panel-title">Программные</h3>
            <span class="damage-reports__panel-count">${report.counts.telegram}</span>
          </header>
          ${renderIncidentList(report.telegram || [], "За этот день Telegram-инцидентов нет.")}
        </article>
        <article class="damage-reports__panel surface-card">
          <header class="damage-reports__panel-head">
            <h3 class="damage-reports__panel-title">Аппаратные</h3>
            <span class="damage-reports__panel-count">${report.counts.site}</span>
          </header>
          ${renderIncidentList(report.site || [], "За этот день заявок Device.ww нет.")}
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
    renderDateTabs();
  }

  async function loadReport(dateValue) {
    if (!dateValue) return;
    state.loading = true;
    state.activeDate = dateValue;
    renderDateTabs();
    setStatus("Загружаю отчет...");
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
      setStatus("Не удалось загрузить отчет.");
    } finally {
      state.loading = false;
    }
  }

  async function initDamageReports() {
    if (state.initialized) return;
    state.initialized = true;
    setStatus("Загружаю список отчетов...");
    try {
      await loadIndex();
      if (state.activeDate) {
        await loadReport(state.activeDate);
      } else {
        setStatus("Пока нет выгруженных отчетов.");
        renderReport();
      }
    } catch (error) {
      console.error(error);
      setStatus("Не удалось загрузить список отчетов.");
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

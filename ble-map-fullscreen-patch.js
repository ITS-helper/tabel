/**
 * ================================================
 *  ПАТЧ: Компактный полноэкранный режим карты
 * ================================================
 *
 *  Подключение: добавь <script src="map-fullscreen-patch.js"></script>
 *  ПОСЛЕ основных скриптов портала, перед </body>
 *
 *  Что делает:
 *  1. Прячет топнав портала при открытии полноэкранной карты
 *  2. Убирает синюю шапку «КАРТА BLE-МЕТОК»
 *  3. Объединяет фильтры, слои и поиск в одну компактную полоску
 *  4. Кнопка «Закрыть» — маленькая, в углу поверх карты
 */

(function () {
  'use strict';

  // Инжектим стили
  const css = document.createElement('style');
  css.textContent = `
    /* === ПРЯЧЕМ ТОПНАВ ПРИ FULLSCREEN === */
    body.map-fullscreen .topnav {
      display: none !important;
    }

    /* === ПЕРЕДЕЛЫВАЕМ FULLSCREEN OVERLAY === */
    .map-fullscreen-overlay.patched .map-fullscreen-header {
      display: none !important;
    }

    .map-fullscreen-overlay.patched .map-fullscreen-controls {
      display: flex !important;
      padding: 6px 8px !important;
      gap: 3px !important;
      background: rgba(255,255,255,0.95) !important;
      backdrop-filter: blur(8px) !important;
      border-bottom: 1px solid rgba(0,0,0,0.08) !important;
      flex-wrap: nowrap !important;
      align-items: center !important;
      min-height: 0 !important;
    }

    .map-fullscreen-overlay.patched .map-fullscreen-controls .map-filter-btn {
      font-size: 0.62em !important;
      padding: 3px 6px !important;
      color: #546E7A !important;
      border-color: #E0E0E0 !important;
      background: #fff !important;
      flex: 0 1 auto !important;
    }
    .map-fullscreen-overlay.patched .map-fullscreen-controls .map-filter-btn.active.filter-all { background: var(--primary, #1565C0) !important; color: #fff !important; border-color: transparent !important; }
    .map-fullscreen-overlay.patched .map-fullscreen-controls .map-filter-btn.active.filter-ok { background: var(--success, #43A047) !important; color: #fff !important; border-color: transparent !important; }
    .map-fullscreen-overlay.patched .map-fullscreen-controls .map-filter-btn.active.filter-battery { background: #FFA726 !important; color: #fff !important; border-color: transparent !important; }
    .map-fullscreen-overlay.patched .map-fullscreen-controls .map-filter-btn.active.filter-inspection { background: var(--warning, #FFA726) !important; color: #78350F !important; border-color: transparent !important; }

    /* Убираем отдельный блок слоёв — встраиваем в ту же строку */
    .map-fullscreen-overlay.patched .map-fullscreen-layer {
      display: none !important;
    }

    /* Поиск — встроен в контролы, компактный */
    .map-fullscreen-overlay.patched .map-fullscreen-search {
      display: none !important;
    }

    /* Компактная строка: фильтры + слои + поиск + закрыть */
    .fs-compact-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(0,0,0,0.08);
      flex-shrink: 0;
      z-index: 10;
    }

    .fs-compact-bar .fs-filters {
      display: flex;
      gap: 3px;
      flex-shrink: 0;
    }

    .fs-compact-bar .fs-sep {
      width: 1px;
      height: 20px;
      background: #E0E0E0;
      flex-shrink: 0;
      margin: 0 2px;
    }

    .fs-compact-bar .fs-layers {
      display: flex;
      gap: 3px;
      flex-shrink: 0;
    }

    .fs-compact-bar .fs-search {
      flex: 1;
      min-width: 60px;
      position: relative;
    }

    .fs-compact-bar .fs-search input {
      width: 100%;
      padding: 4px 24px 4px 8px;
      border: 1.5px solid #E0E0E0;
      border-radius: 6px;
      font-size: 13px;
      font-family: 'Source Sans 3', sans-serif;
      background: #fff;
      color: #37474F;
      outline: none;
      transition: border-color 0.2s;
    }
    .fs-compact-bar .fs-search input:focus {
      border-color: var(--accent, #2196F3);
    }
    .fs-compact-bar .fs-search input::placeholder {
      color: #b0bec5;
    }

    .fs-compact-bar .fs-search-clear {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: #90A4AE;
      font-size: 14px;
      line-height: 1;
      padding: 2px;
      display: none;
    }
    .fs-compact-bar .fs-search-clear:hover {
      color: #EF5350;
    }

    .fs-close-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: rgba(0,0,0,0.06);
      color: #546E7A;
      font-size: 15px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.15s;
      line-height: 1;
      padding: 0;
    }
    .fs-close-btn:hover {
      background: #FFEBEE;
      color: #E53935;
    }

    /* Chip-кнопка для фильтров и слоёв */
    .fs-chip {
      font-family: 'Oswald', sans-serif;
      font-size: 0.62em;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 600;
      padding: 3px 7px;
      border-radius: 999px;
      border: 1px solid #E0E0E0;
      background: #fff;
      color: #78909C;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .fs-chip:hover {
      background: #E3F2FD;
      border-color: #90CAF9;
      color: #1565C0;
    }
    .fs-chip.active {
      color: #fff;
      border-color: transparent;
      box-shadow: 0 1px 4px rgba(0,0,0,0.12);
    }
    .fs-chip.f-all.active { background: #1565C0; }
    .fs-chip.f-ok.active { background: #43A047; }
    .fs-chip.f-bat.active { background: #FFA726; }
    .fs-chip.f-insp.active { background: #FFA726; color: #78350F; }
    .fs-chip.l-active { background: #1565C0 !important; color: #fff !important; border-color: #1565C0 !important; }

    .fs-chip .fc {
      font-size: 0.88em;
      background: rgba(255,255,255,0.25);
      border-radius: 999px;
      padding: 0 5px;
      min-width: 16px;
      text-align: center;
    }
    .fs-chip:not(.active) .fc {
      background: rgba(33,150,243,0.1);
      color: #2196F3;
    }

    /* Карта занимает всё оставшееся */
    .map-fullscreen-overlay.patched #bleMapFS {
      flex: 1 !important;
      width: 100% !important;
    }

    /* Скрываем дефолтные контролы fullscreen overlay */
    .map-fullscreen-overlay.patched > .map-fullscreen-header,
    .map-fullscreen-overlay.patched > .map-fullscreen-controls,
    .map-fullscreen-overlay.patched > .map-fullscreen-layer,
    .map-fullscreen-overlay.patched > .map-fullscreen-search {
      display: none !important;
    }
  `;
  document.head.appendChild(css);

  // Ждём DOM
  function patchFullscreen() {
    const overlay = document.getElementById('mapFullscreenOverlay');
    if (!overlay) return;

    // Помечаем как пропатченный
    overlay.classList.add('patched');

    // Создаём компактную панель
    const bar = document.createElement('div');
    bar.className = 'fs-compact-bar';
    bar.id = 'fsCompactBar';
    bar.innerHTML = `
      <div class="fs-filters">
        <button class="fs-chip f-all active" data-pf="all">Все <span class="fc" id="pf-all">0</span></button>
        <button class="fs-chip f-ok" data-pf="ok">ОК <span class="fc" id="pf-ok">0</span></button>
        <button class="fs-chip f-bat" data-pf="battery">Бат <span class="fc" id="pf-bat">0</span></button>
        <button class="fs-chip f-insp" data-pf="inspection">Н/п <span class="fc" id="pf-insp">0</span></button>
      </div>
      <div class="fs-sep"></div>
      <div class="fs-layers">
        <button class="fs-chip" data-pl="satellite" id="pl-sat">Спут</button>
        <button class="fs-chip l-active" data-pl="street" id="pl-str">Схема</button>
      </div>
      <div class="fs-sep"></div>
      <div class="fs-search">
        <input type="text" id="pf-search" placeholder="№" inputmode="numeric">
        <button class="fs-search-clear" id="pf-search-clear">✕</button>
      </div>
      <button class="fs-close-btn" id="pf-close" title="Закрыть">✕</button>
    `;

    // Вставляем перед картой
    const mapEl = document.getElementById('bleMapFS');
    if (mapEl) {
      overlay.insertBefore(bar, mapEl);
    }

    // --- Обработчики ---

    // Закрыть
    bar.querySelector('#pf-close').addEventListener('click', () => {
      if (typeof closeFullscreenMap === 'function') closeFullscreenMap();
    });

    // Фильтры
    bar.querySelectorAll('[data-pf]').forEach(btn => {
      btn.addEventListener('click', () => {
        bar.querySelectorAll('[data-pf]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Используем глобальную переменную
        if (typeof bleMapFSFilter !== 'undefined') {
          window.bleMapFSFilter = btn.dataset.pf;
        }
        if (typeof renderFsMarkers === 'function') renderFsMarkers();

        // Синхронизируем со старыми кнопками (на случай если логика завязана)
        document.querySelectorAll('[data-fsfilter]').forEach(b => b.classList.remove('active'));
        const oldBtn = document.querySelector(`[data-fsfilter="${btn.dataset.pf}"]`);
        if (oldBtn) oldBtn.classList.add('active');
      });
    });

    // Слои
    bar.querySelectorAll('[data-pl]').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = btn.dataset.pl;
        bar.querySelectorAll('[data-pl]').forEach(b => b.classList.remove('l-active'));
        btn.classList.add('l-active');
        // Кликаем по оригинальной кнопке
        const orig = document.querySelector(`[data-fslayer="${layer}"]`);
        if (orig) orig.click();
      });
    });

    // Поиск
    const searchInput = bar.querySelector('#pf-search');
    const searchClear = bar.querySelector('#pf-search-clear');

    searchInput.addEventListener('input', () => {
      searchClear.style.display = searchInput.value ? 'block' : 'none';
      // Синхронизируем с оригинальным поиском
      const origSearch = document.getElementById('mapFsSearch');
      if (origSearch) {
        origSearch.value = searchInput.value;
        origSearch.dispatchEvent(new Event('input'));
      }
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.style.display = 'none';
      const origSearch = document.getElementById('mapFsSearch');
      if (origSearch) {
        origSearch.value = '';
        origSearch.dispatchEvent(new Event('input'));
      }
      searchInput.focus();
    });

    // Синхронизация счётчиков
    function syncStats() {
      const pAll = document.getElementById('pf-all');
      const pOk = document.getElementById('pf-ok');
      const pBat = document.getElementById('pf-bat');
      const pInsp = document.getElementById('pf-insp');
      if (pAll) pAll.textContent = document.getElementById('fcFsAll')?.textContent || '0';
      if (pOk) pOk.textContent = document.getElementById('fcFsOk')?.textContent || '0';
      if (pBat) pBat.textContent = document.getElementById('fcFsBat')?.textContent || '0';
      if (pInsp) pInsp.textContent = document.getElementById('fcFsInsp')?.textContent || '0';
    }

    // Перехватываем открытие fullscreen
    const origOpen = window.openFullscreenMap;
    window.openFullscreenMap = function () {
      document.body.classList.add('map-fullscreen');
      origOpen.apply(this, arguments);
      setTimeout(syncStats, 500);
      setTimeout(syncStats, 1500);
    };

    const origClose = window.closeFullscreenMap;
    window.closeFullscreenMap = function () {
      document.body.classList.remove('map-fullscreen');
      origClose.apply(this, arguments);
    };

    // Обновляем stats при загрузке данных карты
    const origSyncFsStats = window.syncFsStats;
    if (typeof origSyncFsStats === 'function') {
      window.syncFsStats = function () {
        origSyncFsStats.apply(this, arguments);
        setTimeout(syncStats, 100);
      };
    }

    // Наблюдаем за изменениями счётчиков
    const observer = new MutationObserver(syncStats);
    ['fcFsAll', 'fcFsOk', 'fcFsBat', 'fcFsInsp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(patchFullscreen, 500));
  } else {
    setTimeout(patchFullscreen, 500);
  }
})();

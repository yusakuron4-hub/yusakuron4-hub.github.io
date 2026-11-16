/* 線上踩地雷（極速踩地雷網頁版）
 * 規則、首點保護、免猜（純邏輯）產生器與 App 版（Dart）相同。 */
(() => {
  'use strict';

  // 子語系頁（/minesweeper/en/ 等）也共用同一份 game.js 與 sw.js
  const SCRIPT_SRC = document.currentScript ? document.currentScript.src : location.href;

  // 各語系頁面在 window.MS_I18N 提供文字；沒有時用繁中
  const T = window.MS_I18N || {
    levels: { beginner: '初級', intermediate: '中級', expert: '高級' },
    boardAria: '{level}踩地雷盤面，{rows} 列 {cols} 行，{mines} 顆地雷',
    best: '最佳 {t}', noRecord: '尚無紀錄',
    themeClean: '主題：極簡現代', themeRetro: '主題：經典懷舊', dark: '🌙 深色', light: '☀️ 淺色',
    win: '🎉 過關！', lose: '💥 踩到地雷了', bestRecord: '{level}最佳紀錄 {t}',
    ctaWin: '你用了 {s} 秒！下載 App，和全世界比速度。', ctaLose: '下載 App：100 關冒險、每日競速、全球排行榜。',
  };
  const fmt = (str, vars) => str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ''));

  const LEVELS = {
    beginner: { name: T.levels.beginner, rows: 9, cols: 9, mines: 10 },
    intermediate: { name: T.levels.intermediate, rows: 16, cols: 16, mines: 40 },
    expert: { name: T.levels.expert, rows: 16, cols: 30, mines: 99 },
  };

  // ---------- 本機儲存（無痕模式、被封鎖時也要能玩） ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('ms_' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('ms_' + key, JSON.stringify(value));
      } catch (_) { /* 忽略 */ }
    },
  };

  // ---------- 盤面工具 ----------
  function buildNeighbors(rows, cols) {
    const list = new Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      const r = (i / cols) | 0;
      const c = i % cols;
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
        }
      }
      list[i] = out;
    }
    return list;
  }

  function countAdjacent(mines, nb) {
    const adj = new Uint8Array(mines.length);
    for (let i = 0; i < mines.length; i++) {
      let n = 0;
      for (const j of nb[i]) if (mines[j]) n++;
      adj[i] = n;
    }
    return adj;
  }

  // ---------- Solver：模擬玩家「只靠推理」能否解完（與 App 的 MinesweeperSolver 相同） ----------
  function solve(rows, cols, mines, nb, start) {
    const total = rows * cols;
    const adj = countAdjacent(mines, nb);
    let mineTotal = 0;
    for (const m of mines) if (m) mineTotal++;
    const totalSafe = total - mineTotal;
    if (mines[start]) return { solved: false, progress: 0 };

    const revealed = new Uint8Array(total);
    const knownMine = new Uint8Array(total);
    let revealedCount = 0;
    let knownMineCount = 0;

    const open = (s) => {
      const stack = [s];
      while (stack.length) {
        const i = stack.pop();
        if (revealed[i] || mines[i]) continue;
        revealed[i] = 1;
        revealedCount++;
        if (adj[i] === 0) for (const n of nb[i]) stack.push(n);
      }
    };
    open(start);

    while (revealedCount < totalSafe) {
      const safe = new Set();
      const found = new Set();
      const constraints = [];

      // 1. 單點約束
      for (let i = 0; i < total; i++) {
        if (!revealed[i] || adj[i] === 0) continue;
        const unknown = new Set();
        let flagged = 0;
        for (const n of nb[i]) {
          if (knownMine[n]) flagged++;
          else if (!revealed[n]) unknown.add(n);
        }
        if (!unknown.size) continue;
        const remaining = adj[i] - flagged;
        if (remaining === 0) unknown.forEach((u) => safe.add(u));
        else if (remaining === unknown.size) unknown.forEach((u) => found.add(u));
        else constraints.push({ cells: unknown, mines: remaining });
      }

      // 2. 集合相減
      if (!safe.size && !found.size) applySubsetRule(constraints, safe, found);

      // 3. 全域雷數
      if (!safe.size && !found.size) {
        const unknownAll = [];
        for (let i = 0; i < total; i++) if (!revealed[i] && !knownMine[i]) unknownAll.push(i);
        const remainingMines = mineTotal - knownMineCount;
        if (remainingMines === 0) unknownAll.forEach((u) => safe.add(u));
        else if (remainingMines === unknownAll.length) unknownAll.forEach((u) => found.add(u));
      }

      if (!safe.size && !found.size) break; // 需要猜測

      found.forEach((m) => {
        if (!knownMine[m]) {
          knownMine[m] = 1;
          knownMineCount++;
        }
      });
      safe.forEach((s) => {
        if (!mines[s]) open(s);
      });
    }
    return { solved: revealedCount === totalSafe, progress: totalSafe ? revealedCount / totalSafe : 1 };
  }

  function applySubsetRule(constraints, safe, found) {
    const byCell = new Map();
    for (const c of constraints) {
      for (const cell of c.cells) {
        if (!byCell.has(cell)) byCell.set(cell, []);
        byCell.get(cell).push(c);
      }
    }
    for (const a of constraints) {
      const visited = new Set();
      for (const cell of a.cells) {
        for (const b of byCell.get(cell)) {
          if (a === b || visited.has(b)) continue;
          visited.add(b);
          const bOnly = [...b.cells].filter((x) => !a.cells.has(x));
          if (!bOnly.length) continue;
          const aOnly = [...a.cells].filter((x) => !b.cells.has(x));
          const diff = b.mines - a.mines;
          if (diff === bOnly.length) {
            bOnly.forEach((x) => found.add(x));
            aOnly.forEach((x) => safe.add(x));
          } else if (!aOnly.length && diff === 0) {
            bOnly.forEach((x) => safe.add(x));
          }
        }
      }
    }
  }

  // ---------- 產生器：首點與周圍 8 格不放雷；免猜模式反覆生成直到可純推理解完 ----------
  function placeMines(rows, cols, count, safeIndex, nb) {
    const total = rows * cols;
    let excluded = new Set([safeIndex, ...nb[safeIndex]]);
    if (total - excluded.size < count) excluded = new Set([safeIndex]);
    const candidates = [];
    for (let i = 0; i < total; i++) if (!excluded.has(i)) candidates.push(i);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const mask = new Uint8Array(total);
    for (let i = 0; i < Math.min(count, candidates.length); i++) mask[candidates[i]] = 1;
    return mask;
  }

  function generate(rows, cols, count, safeIndex, noGuess, nb) {
    if (!noGuess) return placeMines(rows, cols, count, safeIndex, nb);
    const deadline = performance.now() + 1500;
    let best = null;
    let bestProgress = -1;
    for (let attempt = 0; attempt < 5000 && performance.now() < deadline; attempt++) {
      const mask = placeMines(rows, cols, count, safeIndex, nb);
      const result = solve(rows, cols, mask, nb, safeIndex);
      if (result.solved) return mask;
      if (result.progress > bestProgress) {
        bestProgress = result.progress;
        best = mask;
      }
    }
    return best || placeMines(rows, cols, count, safeIndex, nb);
  }

  // ---------- 畫面 ----------
  const $ = (sel) => document.querySelector(sel);
  const boardEl = $('#board');
  const wrapEl = $('#board-wrap');
  const mineCounterEl = $('#mine-counter');
  const timerEl = $('#timer');
  const resetBtn = $('#reset');
  const bestEl = $('#best');
  const dialog = $('#result');
  const gameEl = $('#game');

  const FLAG_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="pole" d="M7 3.5v17" /><path class="cloth" d="M8 4l10 4.2L8 12.4z" /><path class="pole" d="M4.5 20.5h6" /></svg>';
  const MINE_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="spikes"><path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3L5.3 18.7"/></g><circle class="body" cx="12" cy="12" r="6.2"/><circle class="shine" cx="9.8" cy="9.8" r="1.7"/></svg>';

  const settings = {
    level: store.get('level', 'beginner'),
    noGuess: store.get('noGuess', true),
    theme: store.get('theme', 'clean'),
    dark: store.get('dark', window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches),
    mode: 'dig',
  };
  if (!LEVELS[settings.level]) settings.level = 'beginner';

  let g = null; // 目前這局
  let cells = []; // DOM
  let rafId = 0;

  function formatTime(ms) {
    const total = Math.floor(ms / 10);
    const cs = total % 100;
    const s = Math.floor(total / 100) % 60;
    const m = Math.floor(total / 6000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  function newGame() {
    const level = LEVELS[settings.level];
    // 高級：寬螢幕 16×30，手機直向改 30×16（與 App 相同方向）
    const portrait = settings.level === 'expert' && wrapEl.clientWidth < 640;
    const rows = portrait ? level.cols : level.rows;
    const cols = portrait ? level.rows : level.cols;
    cancelAnimationFrame(rafId);
    g = {
      rows,
      cols,
      count: level.mines,
      nb: buildNeighbors(rows, cols),
      mines: null,
      adj: null,
      state: new Uint8Array(rows * cols), // 0 未開 1 已開 2 旗
      status: 'ready',
      startedAt: 0,
      elapsed: 0,
      exploded: -1,
      flags: 0,
      revealed: 0,
      noGuess: settings.noGuess,
    };
    dialog.hidden = true;
    buildBoard();
    updateHud();
    renderAll();
  }

  function buildBoard() {
    boardEl.style.setProperty('--cols', g.cols);
    boardEl.setAttribute('aria-label', fmt(T.boardAria, { level: LEVELS[settings.level].name, rows: g.rows, cols: g.cols, mines: g.count }));
    const frag = document.createDocumentFragment();
    cells = new Array(g.rows * g.cols);
    for (let i = 0; i < cells.length; i++) {
      const el = document.createElement('div');
      el.className = 'c h';
      el.dataset.i = i;
      cells[i] = el;
      frag.appendChild(el);
    }
    boardEl.replaceChildren(frag);
    fitBoard();
  }

  function fitBoard() {
    if (!g) return;
    // 可用寬度扣掉盤面內距（8px×2）與格子間距；大盤面間距縮小，讓格子大一點
    const avail = wrapEl.clientWidth - 16;
    const retro = settings.theme === 'retro';
    let gap = retro ? 0 : 3;
    let size = Math.floor((avail - gap * (g.cols - 1)) / g.cols);
    if (!retro && size < 26) {
      gap = 2;
      size = Math.floor((avail - gap * (g.cols - 1)) / g.cols);
    }
    size = Math.max(16, Math.min(40, size));
    boardEl.style.setProperty('--size', size + 'px');
    boardEl.style.setProperty('--gap', gap + 'px');
    boardEl.style.setProperty('--radius', Math.max(3, Math.round(size / 6)) + 'px');
  }

  function renderCell(i) {
    const el = cells[i];
    const st = g.state[i];
    const over = g.status === 'won' || g.status === 'lost';
    let cls = 'c';
    let html = '';
    if (st === 1) {
      const n = g.adj[i];
      cls += ' r';
      if (n) {
        cls += ' n' + n;
        html = String(n);
      }
    } else if (over && g.status === 'lost' && g.mines[i] && st !== 2) {
      cls += ' r m' + (i === g.exploded ? ' x' : '');
      html = MINE_SVG;
    } else if (st === 2) {
      cls += ' h f';
      html = FLAG_SVG;
      if (over && g.status === 'lost' && !g.mines[i]) cls += ' w';
    } else {
      cls += ' h';
    }
    if (el.className !== cls) el.className = cls;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderAll() {
    for (let i = 0; i < cells.length; i++) renderCell(i);
  }

  function updateHud() {
    mineCounterEl.textContent = String(g.count - g.flags);
    timerEl.textContent = formatTime(g.elapsed);
    resetBtn.dataset.face = g.status === 'won' ? 'win' : g.status === 'lost' ? 'lose' : 'play';
    const best = store.get('best_' + settings.level, null);
    bestEl.textContent = best != null ? fmt(T.best, { t: formatTime(best) }) : T.noRecord;
    gameEl.dataset.status = g.status;
  }

  function tick() {
    if (g.status !== 'playing') return;
    g.elapsed = performance.now() - g.startedAt;
    timerEl.textContent = formatTime(g.elapsed);
    rafId = requestAnimationFrame(tick);
  }

  // ---------- 規則 ----------
  function startIfNeeded(i) {
    if (g.status !== 'ready') return;
    g.mines = generate(g.rows, g.cols, g.count, i, g.noGuess, g.nb);
    g.adj = countAdjacent(g.mines, g.nb);
    g.status = 'playing';
    g.startedAt = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function flood(start) {
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      if (g.state[i] !== 0 || g.mines[i]) continue;
      g.state[i] = 1;
      g.revealed++;
      if (g.adj[i] === 0) for (const n of g.nb[i]) stack.push(n);
    }
  }

  function reveal(i) {
    if (g.status === 'won' || g.status === 'lost') return;
    if (g.state[i] !== 0) return;
    startIfNeeded(i);
    if (g.mines[i]) return explode(i);
    flood(i);
    settle();
  }

  function chord(i) {
    if (g.status !== 'playing' || g.state[i] !== 1 || !g.adj[i]) return;
    let flags = 0;
    const targets = [];
    for (const n of g.nb[i]) {
      if (g.state[n] === 2) flags++;
      else if (g.state[n] === 0) targets.push(n);
    }
    if (flags !== g.adj[i] || !targets.length) return;
    let boom = -1;
    for (const n of targets) {
      if (g.mines[n]) {
        if (boom < 0) boom = n;
      } else flood(n);
    }
    if (boom >= 0) return explode(boom);
    settle();
  }

  function toggleFlag(i) {
    if (g.status === 'won' || g.status === 'lost') return;
    if (g.state[i] === 1) return;
    g.state[i] = g.state[i] === 2 ? 0 : 2;
    g.flags += g.state[i] === 2 ? 1 : -1;
    renderCell(i);
    updateHud();
    vibrate(10);
  }

  function explode(i) {
    g.status = 'lost';
    g.exploded = i;
    g.elapsed = performance.now() - g.startedAt;
    cancelAnimationFrame(rafId);
    renderAll();
    updateHud();
    vibrate([40, 40, 80]);
    setTimeout(() => showResult(false), 650);
  }

  function settle() {
    if (g.revealed === g.rows * g.cols - g.count) {
      g.status = 'won';
      g.elapsed = performance.now() - g.startedAt;
      cancelAnimationFrame(rafId);
      for (let i = 0; i < g.state.length; i++) if (g.mines[i]) g.state[i] = 2;
      g.flags = g.count;
      renderAll();
      updateHud();
      vibrate([20, 30, 20]);
      setTimeout(() => showResult(true), 350);
      return;
    }
    renderAll();
  }

  function vibrate(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch (_) { /* 忽略 */ }
  }

  // ---------- 結果視窗 ----------
  function showResult(won) {
    const key = 'best_' + settings.level;
    const prev = store.get(key, null);
    let isRecord = false;
    if (won) {
      // 以畫面顯示的精度（0.01 秒）比較與保存，避免紀錄和通關時間差 0.01
      const shown = Math.floor(g.elapsed / 10) * 10;
      isRecord = prev == null || shown < prev;
      if (isRecord) store.set(key, shown);
      store.set('wins', store.get('wins', 0) + 1);
    }
    $('#result-title').textContent = won ? T.win : T.lose;
    $('#result-time').textContent = won ? formatTime(g.elapsed) : '';
    $('#result-time-label').hidden = !won;
    $('#result-time').hidden = !won;
    $('#result-record').hidden = !isRecord;
    const best = store.get(key, null);
    $('#result-best').textContent = best != null ? fmt(T.bestRecord, { level: LEVELS[settings.level].name, t: formatTime(best) }) : '';
    $('#result-cta-text').textContent = won
      ? fmt(T.ctaWin, { s: (Math.floor(g.elapsed / 10) / 100).toFixed(2) })
      : T.ctaLose;
    $('#result-view').hidden = won;
    dialog.hidden = false;
    $('#result-again').focus({ preventScroll: true });
    updateHud();
  }

  // ---------- 操作：滑鼠左鍵挖／右鍵插旗；手機點擊依模式、長按插旗；點數字快速打開周圍 ----------
  const LONG_PRESS_MS = 320;
  let press = null;

  function act(i, flagIntent) {
    if (g.state[i] === 1) return chord(i);
    if (flagIntent) return toggleFlag(i);
    if (g.state[i] === 2) return;
    reveal(i);
  }

  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

  boardEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.c');
    if (!el) return;
    const i = Number(el.dataset.i);
    if (e.pointerType === 'mouse') {
      if (e.button === 2) {
        e.preventDefault();
        if (g.state[i] === 1) chord(i);
        else toggleFlag(i);
      } else if (e.button === 1) {
        e.preventDefault();
        chord(i);
      } else if (e.button === 0) {
        el.classList.add('p');
        press = { i, el, mouse: true };
      }
      return;
    }
    // 觸控：長按＝與目前模式相反的動作
    el.classList.add('p');
    press = {
      i,
      el,
      x: e.clientX,
      y: e.clientY,
      done: false,
      timer: setTimeout(() => {
        if (!press) return;
        press.done = true;
        el.classList.remove('p');
        act(i, settings.mode === 'dig');
      }, LONG_PRESS_MS),
    };
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (!press || press.mouse) return;
    if (Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10) cancelPress();
  });

  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.el.classList.remove('p');
    press = null;
  }

  boardEl.addEventListener('pointerup', (e) => {
    if (!press) return;
    const p = press;
    cancelPress();
    if (p.mouse) {
      const el = e.target.closest('.c');
      if (el && Number(el.dataset.i) === p.i) act(p.i, settings.mode === 'flag');
      return;
    }
    if (!p.done) act(p.i, settings.mode === 'flag');
  });
  boardEl.addEventListener('pointercancel', cancelPress);
  boardEl.addEventListener('pointerleave', (e) => {
    if (press && press.mouse) cancelPress();
  });

  // ---------- 控制列 ----------
  function syncControls() {
    document.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === settings.level)));
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode)));
    $('#noguess').checked = settings.noGuess;
    $('#theme-btn').textContent = settings.theme === 'retro' ? T.themeRetro : T.themeClean;
    $('#dark-btn').textContent = settings.dark ? T.light : T.dark;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.dark = settings.dark ? '1' : '0';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = settings.dark ? '#1C1F24' : '#F3F0EB';
  }

  document.querySelectorAll('[data-level]').forEach((b) =>
    b.addEventListener('click', () => {
      settings.level = b.dataset.level;
      store.set('level', settings.level);
      syncControls();
      newGame();
    }));
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode;
      syncControls();
    }));
  $('#noguess').addEventListener('change', (e) => {
    settings.noGuess = e.target.checked;
    store.set('noGuess', settings.noGuess);
    if (g.status === 'ready') g.noGuess = settings.noGuess;
    else newGame();
  });
  $('#theme-btn').addEventListener('click', () => {
    settings.theme = settings.theme === 'retro' ? 'clean' : 'retro';
    store.set('theme', settings.theme);
    syncControls();
    fitBoard();
  });
  $('#dark-btn').addEventListener('click', () => {
    settings.dark = !settings.dark;
    store.set('dark', settings.dark);
    syncControls();
  });
  resetBtn.addEventListener('click', newGame);
  $('#result-again').addEventListener('click', newGame);
  $('#result-view').addEventListener('click', () => {
    dialog.hidden = true;
  });
  $('#result-close').addEventListener('click', () => {
    dialog.hidden = true;
  });

  // 語系：右上角選單與頁尾連結都要記住選擇，否則下次會被自動轉回瀏覽器語言
  const langSelect = $('#lang');
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      const opt = langSelect.selectedOptions[0];
      store.set('lang', opt.value);
      location.href = opt.dataset.href;
    });
  }
  document.querySelectorAll('a[data-lang]').forEach((a) =>
    a.addEventListener('click', () => store.set('lang', a.dataset.lang)));

  // 鍵盤：F2 / N 開新局
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2' || ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA/.test(document.activeElement.tagName))) {
      e.preventDefault();
      newGame();
    } else if (e.key === 'Escape' && !dialog.hidden) {
      dialog.hidden = true;
    }
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitBoard, 100);
  });

  syncControls();
  newGame();

  // 供自動測試使用
  window.__ms = { get game() { return g; }, solve, generate, buildNeighbors, newGame, reveal, toggleFlag, chord };

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(new URL('sw.js', SCRIPT_SRC)).catch(() => {});
  }
})();

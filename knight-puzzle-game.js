(() => {
    "use strict";

    const PALETTE = [
        "#F5B041", "#5B8DEF", "#F48FB1", "#9575CD", "#E05A4E",
        "#81D4FA", "#FDD835", "#AED581", "#4DB6AC", "#CE93D8"
    ];
    const MAX_HP = 3;
    const CLICK_DELAY = 260; // ms，区分单击与双击
    const PRESET_COUNT = {easy: 2, medium: 1, hard: 0}; // 各难度默认标注的小马数

    const boardEl = document.getElementById ("board");
    const rowNumsEl = document.getElementById ("rowNums");
    const colNumsEl = document.getElementById ("colNums");
    const heartsEl = document.getElementById ("hearts");
    const progressEl = document.getElementById ("progress");
    const messageEl = document.getElementById ("message");
    const orderEl = document.getElementById ("order");
    const gameIdEl = document.getElementById ("gameId");
    const difficultyEl = document.getElementById ("difficulty");
    const timerEl = document.getElementById ("timer");
    const overlayEl = document.getElementById ("overlay");
    const dialogIconEl = document.getElementById ("dialogIcon");
    const dialogTitleEl = document.getElementById ("dialogTitle");
    const dialogTextEl = document.getElementById ("dialogText");
    const retryBtnEl = document.getElementById ("retryBtn");
    const newGameBtnEl = document.getElementById ("newGameBtn");
    const cancelBtnEl = document.getElementById ("cancelBtn");
    const answerBtnEl = document.getElementById ("answerBtn");
    const answerPanelEl = document.getElementById ("answerPanel");
    const answerGridEl = document.getElementById ("answerGrid");
    const answerIdEl = document.getElementById ("answerId");
    const answerCloseEl = document.getElementById ("answerClose");
    const exportBtnEl = document.getElementById ("exportBtn");
    const langSelectEl = document.getElementById ("langSelect");
    const I18N = window.I18N;

    let rand = Math.random;    // 由局号派生的确定性随机源
    let gameId = "";
    let N = 0;
    let hp = MAX_HP;
    let colorMap = [];      // colorMap[r][c] => 颜色索引
    let solution = new Set (); // "r,c" 正确小马位置
    let placed = new Set (); // 已正确放置
    let disabled = new Set (); // 答错被锁定的格子
    let gameOver = false;
    let clickTimer = null, clickCell = null;
    let prevClickCell = null, lastClickCell = null; // 最近两次 click 的目标格，用于校验原生 dblclick
    let timerStarted = false, timerRunning = false;
    let timerStart = 0, timerElapsed = 0, timerId = null;
    let dragState = null, ignoreClickUntil = 0, answerVisible = false;
    let generating = false, generationToken = 0;
    let lastMessage = null, lastDialogType = null;

    const key = (r, c) => r + "," + c;

    // ---------- 计时器：从第一次单击/双击开始 ----------

    function formatTime (ms) {
        const t = Math.floor (ms / 1000);
        const h = Math.floor (t / 3600), m = Math.floor (t / 60) % 60, s = t % 60;
        const pad = v => String (v).padStart (2, "0");
        return (h ? h + ":" : "") + pad (m) + ":" + pad (s);
    }

    function elapsedMs () {
        return timerRunning ? Date.now () - timerStart : timerElapsed;
    }

    function updateTimer () {
        timerEl.textContent = I18N.t ("timerPrefix") + formatTime (elapsedMs ());
    }

    function startTimer () {
        if (timerStarted || gameOver) return;
        timerStarted = true;
        timerRunning = true;
        timerStart = Date.now ();
        timerId = setInterval (updateTimer, 250);
        updateTimer ();
    }

    function stopTimer () {
        if (!timerRunning) return;
        timerElapsed = Date.now () - timerStart;
        timerRunning = false;
        clearInterval (timerId);
        timerId = null;
        updateTimer ();
    }

    function resetTimer () {
        if (timerId) clearInterval (timerId);
        timerId = null;
        timerRunning = false;
        timerStarted = false;
        timerElapsed = 0;
        updateTimer ();
    }

    // 依据视口宽高（横屏/竖屏）与布局模式计算格子尺寸
    function fitBoard () {
        const vw = typeof window !== "undefined" ? window.innerWidth : 800;
        const vh = typeof window !== "undefined" ? window.innerHeight : 600;
        const landscape = vw > vh;
        const split = typeof window !== "undefined" && window.matchMedia
            && window.matchMedia ("(min-width: 1024px)").matches;
        // 左右分栏后顶部内容移到左列，纵向空间可多给棋盘；横向需为左列留出宽度
        const chromeH = Math.min (split ? 120 : (landscape ? 340 : 400), vh * .45);
        const sideW = split ? Math.min (540, Math.max (360, vw * .38)) : (landscape ? 90 : 64);
        const size = Math.max (24, Math.floor (Math.min (
            (vw - sideW) / N - 4,
            (vh - chromeH) / N - 4,
            72
        )));
        document.documentElement.style.setProperty ("--cell", size + "px");
    }

    // ---------- 局号与确定性随机源 ----------

    // 解析并规范化局号：阶数 4-10，序列号 1-1000，序列号补足 3 位
    function parseGameId (raw) {
        const m = /^\s*(\d{1,2})\s*-\s*(\d{1,4})\s*$/.exec (raw);
        if (!m) return null;
        const n = Number (m[1]), serial = Number (m[2]);
        if (n < 4 || n > 10 || serial < 1 || serial > 1000) return null;
        return {n, id: n + "-" + String (serial).padStart (3, "0")};
    }

    // FNV-1a：把局号字符串映射成 32 位种子
    function seedFromString (str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt (i);
            h = Math.imul (h, 16777619);
        }
        return h >>> 0;
    }

    // mulberry32：同一种子必然产生同一随机序列
    function makeRng (seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul (t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul (t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---------- 谜题生成 ----------

    // 为每一行选择一列：列不重复（每列仅 1 匹），且相邻两行列差 >= 2（九宫格内不相邻）
    function generateKnights (n) {
        const cols = [];
        for (let i = 0; i < n; i++) cols.push (i);
        const used = Array (n).fill (false);

        function backtrack (row, chosen) {
            if (row === n) return true;
            const candidates = cols.slice ();
            // 按局号派生的随机顺序打乱候选列
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = Math.floor (rand () * (i + 1));
                [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            }
            for (const c of candidates) {
                if (used[c]) continue;
                const prev = chosen[chosen.length - 1];
                if (row > 0 && Math.abs (c - prev) < 2) continue;
                used[c] = true;
                chosen.push (c);
                if (backtrack (row + 1, chosen)) return true;
                chosen.pop ();
                used[c] = false;
            }
            return false;
        }

        const chosen = [];
        if (!backtrack (0, chosen)) throw new Error (I18N.t ("errorNoLayout"));
        return chosen; // chosen[r] = 第 r 行小马所在列
    }

    // 多源 BFS 随机生长：以小马为种子生成 N 个连通（行列相邻）颜色区域，覆盖全棋盘
    function generateColors (n, knightCols) {
        const map = Array.from ({length: n}, () => Array (n).fill (-1));
        const frontiers = Array.from ({length: n}, () => []);

        const seedColor = knightCols.map ((_, i) => i);
        // 打乱颜色与行的对应，让颜色分布更随机
        for (let i = seedColor.length - 1; i > 0; i--) {
            const j = Math.floor (rand () * (i + 1));
            [seedColor[i], seedColor[j]] = [seedColor[j], seedColor[i]];
        }

        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let r = 0; r < n; r++) {
            const color = seedColor[r];
            map[r][knightCols[r]] = color;
            for (const [dr, dc] of dirs) {
                const nr = r + dr, nc = knightCols[r] + dc;
                if (nr >= 0 && nr < n && nc >= 0 && nc < n) frontiers[color].push ([nr, nc, color]);
            }
        }

        let remaining = n * n - n;
        const active = () => frontiers.filter (f => f.length > 0);
        while (remaining > 0) {
            const lists = active ();
            // 随机挑一个颜色，再随机挑其边界上一个未分配格子
            const list = lists[Math.floor (rand () * lists.length)];
            const idx = Math.floor (rand () * list.length);
            const [r, c, color] = list.splice (idx, 1)[0];
            if (map[r][c] !== -1) continue;
            map[r][c] = color;
            remaining--;
            for (const [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < n && nc >= 0 && nc < n && map[nr][nc] === -1) {
                    frontiers[color].push ([nr, nc, color]);
                }
            }
        }
        return map;
    }

    // ---------- 解空间：计数、可完成性、唯一解生成 ----------

    const BITS = Array.from ({length: 11}, (_, i) => Math.pow (2, i));

    // 统计满足全部规则的小马布局数；fixed 为 Map<行, 列>（已放置的小马）
    function countSolutions (n, map, fixed) {
        const memo = new Map ();
        let cm0 = 0, km0 = 0;
        if (fixed) {
            for (const [r, c] of fixed) {
                cm0 += BITS[c];
                km0 += BITS[map[r][c]];
            }
        }

        function dfs (r, cm, km, prev) {
            if (r === n) return 1;
            const code = ((r * 1024 + cm) * 1024 + km) * 32 + (prev + 9);
            if (memo.has (code)) return memo.get (code);
            let total = 0;
            if (fixed && fixed.has (r)) {
                const c = fixed.get (r);
                if (!(r > 0 && Math.abs (c - prev) < 2)) total = dfs (r + 1, cm, km, c);
            } else {
                for (let c = 0; c < n; c++) {
                    if (cm % BITS[c + 1] >= BITS[c]) continue;
                    if (r > 0 && Math.abs (c - prev) < 2) continue;
                    const k = map[r][c];
                    if (km % BITS[k + 1] >= BITS[k]) continue;
                    total += dfs (r + 1, cm + BITS[c], km + BITS[k], c);
                }
            }
            memo.set (code, total);
            return total;
        }

        return dfs (0, cm0, km0, -9);
    }

    // 双击判定：这些小马能否补全成一个完整合法布局
    function hasExtension (cells) {
        const fixed = new Map ();
        const cols = new Set (), colors = new Set ();
        const list = Array.from (cells);
        for (const k of list) {
            const [r, c] = k.split (",").map (Number);
            if (fixed.has (r) || cols.has (c)) return false;
            const col = colorMap[r][c];
            if (colors.has (col)) return false;
            fixed.set (r, c);
            cols.add (c);
            colors.add (col);
        }
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const [r1, c1] = list[i].split (",").map (Number);
                const [r2, c2] = list[j].split (",").map (Number);
                if (Math.abs (r1 - r2) <= 1 && Math.abs (c1 - c2) <= 1) return false;
            }
        }
        return countSolutions (N, colorMap, fixed) > 0;
    }

    // 某颜色区域是否正交连通
    function colorRegionConnected (map, color, n) {
        const cells = [];
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            if (map[r][c] === color) cells.push (r + "," + c);
        }
        if (cells.length === 0) return false;
        const seen = new Set ([cells[0]]), queue = [cells[0]];
        while (queue.length) {
            const [r, c] = queue.pop ().split (",").map (Number);
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nr = r + dr, nc = c + dc, k = nr + "," + nc;
                if (nr >= 0 && nr < n && nc >= 0 && nc < n &&
                    map[nr][nc] === color && !seen.has (k)) {
                    seen.add (k);
                    queue.push (k);
                }
            }
        }
        return seen.size === cells.length;
    }

    // 在保持「颜色连通 + 原小马仍是解」的前提下，找一个能减少解数的改色
    function pickBestMove (n, map, knightCols, cnt) {
        const cand = [];
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (c === knightCols[r]) continue;
                for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < n && nc >= 0 && nc < n && map[nr][nc] !== map[r][c]) {
                        cand.push ([r, c, map[nr][nc]]);
                    }
                }
            }
        }
        for (let i = cand.length - 1; i > 0; i--) {
            const j = Math.floor (rand () * (i + 1));
            [cand[i], cand[j]] = [cand[j], cand[i]];
        }
        let fallback = null;
        for (let t = 0; t < Math.min (6, cand.length); t++) {
            const [r, c, B] = cand[t], A = map[r][c];
            const m2 = map.map (row => row.slice ());
            m2[r][c] = B;
            if (!colorRegionConnected (m2, A, n) || !colorRegionConnected (m2, B, n)) continue;
            const c2 = countSolutions (n, m2, null);
            if (!fallback) fallback = {map: m2, count: c2};
            if (c2 < cnt) return {map: m2, count: c2};
        }
        return fallback;
    }

    // 局部调整颜色分区，直到只剩一个解；优先得到「纯逻辑可解」的分区
    function refineToUnique (n, map, knightCols, wantLogical) {
        let cnt = countSolutions (n, map, null), fallback = null, kicks = 0;
        for (let step = 0; step < 300; step++) {
            if (cnt === 1) {
                if (!wantLogical) return {map, count: 1, logical: false};
                if (isLogicallySolvable (n, map)) return {map, count: 1, logical: true};
                if (!fallback) fallback = {map, count: 1, logical: false};
                if (++kicks > 5) return fallback;
                // 唯一解但推理规则不足：扰动一下，换一个唯一解分区再试
                const kick = pickBestMove (n, map, knightCols, cnt);
                if (!kick) break;
                map = kick.map;
                cnt = kick.count;
                continue;
            }
            const move = pickBestMove (n, map, knightCols, cnt);
            if (!move) break;
            if (move.count <= cnt || rand () < 0.02) {
                map = move.map;
                cnt = move.count;
            }
        }
        if (cnt === 1) return {map, count: 1, logical: isLogicallySolvable (n, map)};
        return fallback || {map, count: cnt, logical: false};
    }

    // 纯逻辑可解性：仅用「排除 + 单候选 + 锁定」规则能否推出全部小马
    function isLogicallySolvable (n, m) {
        const av = Array.from ({length: n}, () => Array (n).fill (true));
        const rd = Array (n).fill (false), cd = Array (n).fill (false), kd = Array (n).fill (false);
        let placed = 0;
        const okCell = (r, c) => !rd[r] && !cd[c] && !kd[m[r][c]] && av[r][c];

        function put (r, c) {
            placed++;
            rd[r] = true;
            cd[c] = true;
            kd[m[r][c]] = true;
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
                if (i === r || j === c || m[i][j] === m[r][c] ||
                    (Math.abs (i - r) <= 1 && Math.abs (j - c) <= 1)) av[i][j] = false;
            }
        }

        let progress = true;
        while (placed < n && progress) {
            progress = false;
            for (let r = 0; r < n && !progress; r++) if (!rd[r]) {
                let cnt = 0, col = -1;
                for (let c = 0; c < n; c++) if (okCell (r, c)) {
                    cnt++;
                    col = c;
                }
                if (cnt === 1) {
                    put (r, col);
                    progress = true;
                }
            }
            if (progress) continue;
            for (let c = 0; c < n && !progress; c++) if (!cd[c]) {
                let cnt = 0, row = -1;
                for (let r = 0; r < n; r++) if (okCell (r, c)) {
                    cnt++;
                    row = r;
                }
                if (cnt === 1) {
                    put (row, c);
                    progress = true;
                }
            }
            if (progress) continue;
            for (let k = 0; k < n && !progress; k++) if (!kd[k]) {
                let cnt = 0, cell = null;
                for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
                    if (m[r][c] === k && okCell (r, c)) {
                        cnt++;
                        cell = [r, c];
                    }
                }
                if (cnt === 1) {
                    put (cell[0], cell[1]);
                    progress = true;
                }
            }
            if (progress) continue;
            for (let k = 0; k < n && !progress; k++) if (!kd[k]) {
                const cells = [];
                for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
                    if (m[r][c] === k && okCell (r, c)) cells.push ([r, c]);
                }
                if (!cells.length) continue;
                const rows = new Set (cells.map (x => x[0])), cols = new Set (cells.map (x => x[1]));
                if (rows.size === 1) {
                    const r = cells[0][0];
                    for (let c = 0; c < n; c++) {
                        if (okCell (r, c) && m[r][c] !== k) {
                            av[r][c] = false;
                            progress = true;
                        }
                    }
                } else if (cols.size === 1) {
                    const c = cells[0][1];
                    for (let r = 0; r < n; r++) {
                        if (okCell (r, c) && m[r][c] !== k) {
                            av[r][c] = false;
                            progress = true;
                        }
                    }
                }
            }
            if (progress) continue;
            for (let r = 0; r < n && !progress; r++) if (!rd[r]) {
                const ks = new Set ();
                for (let c = 0; c < n; c++) if (okCell (r, c)) ks.add (m[r][c]);
                if (ks.size === 1) {
                    const k = Array.from (ks)[0];
                    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
                        if (i !== r && m[i][j] === k && okCell (i, j)) {
                            av[i][j] = false;
                            progress = true;
                        }
                    }
                }
            }
            if (progress) continue;
            for (let c = 0; c < n && !progress; c++) if (!cd[c]) {
                const ks = new Set ();
                for (let r = 0; r < n; r++) if (okCell (r, c)) ks.add (m[r][c]);
                if (ks.size === 1) {
                    const k = Array.from (ks)[0];
                    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
                        if (j !== c && m[i][j] === k && okCell (i, j)) {
                            av[i][j] = false;
                            progress = true;
                        }
                    }
                }
            }
        }
        return placed === n;
    }

    function makeUnique (n, wantLogical) {
        const knightCols = generateKnights (n);
        const res = refineToUnique (n, generateColors (n, knightCols), knightCols, wantLogical);
        return res.count === 1 ? {knightCols, map: res.map, logical: res.logical} : null;
    }

    // 局号决定随机流 => 生成过程完全确定
    // 4-8 阶优先找「唯一解且纯逻辑可解」；9-10 阶只保证唯一解（规则判定已保证公平）
    function generatePuzzle (n) {
        const wantLogical = n <= 8;
        let fallback = null;
        for (let attempt = 0; attempt < 6; attempt++) {
            const board = makeUnique (n, wantLogical);
            if (!board) continue;
            if (board.logical || !wantLogical) return board;
            if (!fallback) fallback = board;
            if (attempt >= 1 && fallback) break;
        }
        if (fallback) return fallback;
        for (let i = 0; i < 20; i++) {
            const board = makeUnique (n, false);
            if (board) return board;
        }
        throw new Error (I18N.t ("errorNoUnique"));
    }

    // ---------- 渲染与交互 ----------

    function render () {
        boardEl.innerHTML = "";
        rowNumsEl.innerHTML = "";
        colNumsEl.innerHTML = "";
        boardEl.style.gridTemplateColumns = `repeat(${N}, var(--cell))`;
        boardEl.style.gridTemplateRows = `repeat(${N}, var(--cell))`;
        rowNumsEl.style.gridTemplateRows = `repeat(${N}, var(--cell))`;
        colNumsEl.style.gridTemplateColumns = `repeat(${N}, var(--cell))`;
        fitBoard ();

        // 行号自上而下 N..1（与图片一致）
        for (let i = N; i >= 1; i--) {
            const d = document.createElement ("div");
            d.textContent = String (i);
            rowNumsEl.appendChild (d);
        }
        for (let c = 1; c <= N; c++) {
            const d = document.createElement ("div");
            d.textContent = String (c);
            colNumsEl.appendChild (d);
        }

        for (let dr = 0; dr < N; dr++) {
            const r = N - 1 - dr; // 顶行是第 N 行
            for (let c = 0; c < N; c++) {
                const cell = document.createElement ("div");
                cell.className = "cell";
                cell.style.background = PALETTE[colorMap[r][c]];
                cell.dataset.r = String (r);
                cell.dataset.c = String (c);
                cell.addEventListener ("pointerdown", onPointerDown);
                cell.addEventListener ("click", onCellClick);
                cell.addEventListener ("dblclick", onCellDblClick);
                boardEl.appendChild (cell);
            }
        }
    }

    function getCell (r, c) {
        return boardEl.children[(N - 1 - r) * N + c];
    }

    function onCellClick (e) {
        if (generating || Date.now () < ignoreClickUntil) return; // 生成中 / 忽略拖动结束后附带的 click
        const cell = e.currentTarget;
        startTimer ();             // 第一次单击即开始计时
        const r = +cell.dataset.r, c = +cell.dataset.c;
        if (gameOver || placed.has (key (r, c)) || disabled.has (key (r, c))) return;

        prevClickCell = lastClickCell;
        lastClickCell = cell;

        if (clickTimer && clickCell === cell) {
            // 同一格快速第二次点击 = 双击放马（兼容平板不触发 dblclick 的情况）
            clearTimeout (clickTimer);
            clickTimer = null;
            clickCell = null;
            cell._handledAt = Date.now ();
            placeKnight (cell, r, c);
            return;
        }
        if (clickTimer) {
            clearTimeout (clickTimer);
            clickTimer = null;
            toggleMark (clickCell); // 先把上一格的单击标注落地
            clickCell = null;
        }
        clickCell = cell;
        clickTimer = setTimeout (() => {
            clickTimer = null;
            clickCell = null;
            toggleMark (cell);         // 单击：标注 / 清除白色 ✕
        }, CLICK_DELAY);
    }

    function onCellDblClick (e) {
        if (generating || Date.now () < ignoreClickUntil) return;
        const cell = e.currentTarget;
        if (cell._handledAt && Date.now () - cell._handledAt < 600) return; // 已由第二次 click 处理
        // 原生 dblclick 可能由「点 a 后很快点 b」触发并落在 b 上；
        // 只有最近两次 click 都在同一格时才是真正的双击
        if (prevClickCell !== cell || lastClickCell !== cell) return;
        startTimer ();
        if (clickTimer) {
            clearTimeout (clickTimer);
            clickTimer = null;
            clickCell = null;
        }
        const r = +cell.dataset.r, c = +cell.dataset.c;
        if (gameOver || placed.has (key (r, c)) || disabled.has (key (r, c))) return;
        cell._handledAt = Date.now ();
        placeKnight (cell, r, c);
    }

    function setMark (cell, on) {
        const mark = cell.querySelector (".mark");
        if (on && !mark) {
            const s = document.createElement ("span");
            s.className = "mark";
            s.textContent = "✕";
            cell.appendChild (s);
        } else if (!on && mark) {
            mark.remove ();
        }
    }

    function toggleMark (cell) {
        setMark (cell, !cell.querySelector (".mark"));
    }

    // ---------- 拖动标注：路径上每格执行与起点格相同的动作 ----------

    function applyDragMark (cell, action) {
        const r = +cell.dataset.r, c = +cell.dataset.c;
        const k = key (r, c);
        if (gameOver || placed.has (k) || disabled.has (k)) return;
        setMark (cell, action === "mark");
    }

    function onPointerDown (e) {
        if (generating) return;
        ignoreClickUntil = 0;      // 新一轮按下，解除上次的点击抑制
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const cell = e.currentTarget;
        const r = +cell.dataset.r, c = +cell.dataset.c;
        if (gameOver || placed.has (key (r, c)) || disabled.has (key (r, c))) return;
        dragState = {
            id: e.pointerId,
            startCell: cell,
            startX: e.clientX, startY: e.clientY,
            lastX: e.clientX, lastY: e.clientY,
            action: cell.querySelector (".mark") ? "clear" : "mark",
            visited: new Set (),
            moved: false
        };
    }

    function markCellAt (x, y) {
        if (!dragState || typeof document.elementFromPoint !== "function") return;
        const el = document.elementFromPoint (x, y);
        const cell = el && el.closest ? el.closest (".cell") : null;
        if (!cell || cell.dataset.r === undefined) return;
        const k = key (+cell.dataset.r, +cell.dataset.c);
        if (dragState.visited.has (k)) return;
        dragState.visited.add (k);
        applyDragMark (cell, dragState.action);
    }

    function onPointerMove (e) {
        const st = dragState;
        if (!st || e.pointerId !== st.id) return;
        if (!st.moved) {
            if (Math.abs (e.clientX - st.startX) + Math.abs (e.clientY - st.startY) < 8) return;
            st.moved = true;
            st.visited.add (key (+st.startCell.dataset.r, +st.startCell.dataset.c));
            applyDragMark (st.startCell, st.action);
            startTimer ();         // 拖动也算第一次操作
        }
        const dx = e.clientX - st.lastX, dy = e.clientY - st.lastY;
        const steps = Math.max (1, Math.ceil (Math.hypot (dx, dy) / 8));
        for (let i = 1; i <= steps; i++) {
            markCellAt (st.lastX + dx * i / steps, st.lastY + dy * i / steps);
        }
        st.lastX = e.clientX;
        st.lastY = e.clientY;
    }

    function onPointerUp (e) {
        if (!dragState || e.pointerId !== dragState.id) return;
        if (dragState.moved) ignoreClickUntil = Date.now () + 500;
        dragState = null;
    }

    function placeKnight (cell, r, c) {
        const k = key (r, c);
        if (gameOver || placed.has (k) || disabled.has (k)) return;
        cell.innerHTML = "";   // 清除可能存在的白色 ✕ 标注
        const trial = new Set (placed);
        trial.add (k);
        // 不再比对单个预存解：只要这里放马后仍能补全成完整合法布局，就算正确
        if (hasExtension (trial)) {
            placed.add (k);
            cell.classList.add ("used", "done");
            cell.innerHTML = "🐴";
            updateProgress ();
            if (placed.size === N) {
                gameOver = true;
                stopTimer ();
                showMessage ("msgWin", "win");
                showDialog ("win");
            }
        } else {
            hp--;
            disabled.add (k);
            cell.classList.add ("wrong");
            updateHearts ();
            if (hp <= 0) {
                gameOver = true;
                stopTimer ();
                showMessage ("msgLose", "lose");
                revealSolution ();
                showDialog ("lose");
            } else {
                showMessage ("msgWrong", "lose");
            }
        }
    }

    function renderDialog () {
        if (!lastDialogType) return;
        const win = lastDialogType === "win";
        dialogIconEl.textContent = win ? "🏆" : "💔";
        dialogTitleEl.textContent = I18N.t (win ? "dialogWinTitle" : "dialogLoseTitle");
        dialogTextEl.textContent = I18N.t ("dialogMeta", {
            id: gameId,
            time: formatTime (elapsedMs ()),
            result: I18N.t (win ? "dialogWinText" : "dialogLoseText")
        });
    }

    function showDialog (type) {
        lastDialogType = type;
        renderDialog ();
        retryBtnEl.hidden = type === "win";   // 通关时不显示「重新开始」
        overlayEl.hidden = false;
    }

    function closeDialog () {
        overlayEl.hidden = true;
    }

    function revealSolution () {
        for (const k of solution) {
            const [r, c] = k.split (",").map (Number);
            const cell = getCell (r, c);
            if (!cell.classList.contains ("used")) {
                cell.classList.add ("used");
                cell.innerHTML = "🐴";
            }
        }
    }

    function updateHearts () {
        heartsEl.textContent = "❤️".repeat (Math.max (hp, 0)) + "🖤".repeat (MAX_HP - Math.max (hp, 0));
    }

    function updateProgress () {
        progressEl.textContent = I18N.t ("progress", {id: gameId, placed: placed.size, total: N});
    }

    // key 可为字符串，或 [{key, vars}, ...] 组成的分段消息
    function showMessage (key, cls, vars) {
        lastMessage = {key: key, cls: cls, vars: vars};
        renderMessage ();
    }

    function renderMessage () {
        if (!lastMessage) return;
        const parts = Array.isArray (lastMessage.key)
            ? lastMessage.key
            : [{key: lastMessage.key, vars: lastMessage.vars}];
        messageEl.textContent = parts.map (p => I18N.t (p.key, p.vars)).join (" · ");
        messageEl.className = "message" + (lastMessage.cls ? " " + lastMessage.cls : "");
    }

    // 右下角答案缩略图：同色块 + 正确小马位置
    function renderAnswer () {
        const maxW = typeof window !== "undefined" ? Math.min (150, window.innerWidth * .3) : 150;
        const size = Math.max (8, Math.floor (maxW / N));
        answerGridEl.innerHTML = "";
        answerGridEl.style.gridTemplateColumns = `repeat(${N}, ${size}px)`;
        answerGridEl.style.gridTemplateRows = `repeat(${N}, ${size}px)`;
        answerIdEl.textContent = gameId;
        for (let dr = 0; dr < N; dr++) {
            const r = N - 1 - dr;
            for (let c = 0; c < N; c++) {
                const cell = document.createElement ("div");
                cell.className = "answer-cell";
                cell.style.width = size + "px";
                cell.style.height = size + "px";
                cell.style.background = PALETTE[colorMap[r][c]];
                cell.style.fontSize = Math.max (8, Math.floor (size * .75)) + "px";
                if (solution.has (key (r, c))) cell.textContent = "🐴";
                answerGridEl.appendChild (cell);
            }
        }
    }

    function setAnswerVisible (visible) {
        answerVisible = visible;
        answerPanelEl.hidden = !visible;
        answerBtnEl.textContent = I18N.t (visible ? "hideAnswer" : "showAnswer");
    }

    // ---------- 导出当前棋盘为 PNG 图片 ----------

    function roundRectPath (ctx, x, y, w, h, r) {
        const rr = Math.min (r, w / 2, h / 2);
        ctx.beginPath ();
        ctx.moveTo (x + rr, y);
        ctx.arcTo (x + w, y, x + w, y + h, rr);
        ctx.arcTo (x + w, y + h, x, y + h, rr);
        ctx.arcTo (x, y + h, x, y, rr);
        ctx.arcTo (x, y, x + w, y, rr);
        ctx.closePath ();
    }

    // 不依赖第三方库：直接按棋盘状态重绘，2 倍分辨率输出
    function exportBoardImage () {
        if (generating || !N || !colorMap.length) {
            showMessage ("exportNotReady", "lose");
            return;
        }
        const id = gameId;   // 生成图片期间可能重新开局，先固定局号

        const cell = 80, gap = 5, radius = 10;
        const rowLabelW = 44, colLabelH = 36, labelGap = 8;
        const pad = 32, footerH = 56, scale = 2;
        const size = N * cell + (N - 1) * gap;
        const W = pad * 2 + rowLabelW + labelGap + size;
        const H = pad * 2 + size + labelGap + colLabelH + footerH;
        const boardX = pad + rowLabelW + labelGap, boardY = pad;

        const canvas = document.createElement ("canvas");
        canvas.width = Math.round (W * scale);
        canvas.height = Math.round (H * scale);
        const ctx = canvas.getContext ("2d");
        ctx.scale (scale, scale);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const font = '"Segoe UI", "Microsoft YaHei", sans-serif';
        const emojiFont = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

        ctx.fillStyle = "#f2f0fa";
        ctx.fillRect (0, 0, W, H);
        roundRectPath (ctx, 10, 10, W - 20, H - 20, 20);
        ctx.fillStyle = "#fff";
        ctx.fill ();

        // 行号（自上而下 N..1）与列号（1..N）
        ctx.fillStyle = "#3b3b58";
        ctx.font = `600 22px ${font}`;
        for (let dr = 0; dr < N; dr++) {
            ctx.textAlign = "right";
            ctx.fillText (String (N - dr), boardX - labelGap,
                boardY + dr * (cell + gap) + cell / 2);
        }
        ctx.textAlign = "center";
        for (let c = 0; c < N; c++) {
            ctx.fillText (String (c + 1), boardX + c * (cell + gap) + cell / 2,
                boardY + size + labelGap + colLabelH / 2);
        }

        const drawX = (cx, cy, color) => {
            ctx.font = `800 ${Math.round (cell * .5)}px ${font}`;
            ctx.fillStyle = color;
            ctx.shadowColor = "rgba(0, 0, 0, .35)";
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
            ctx.fillText ("✕", cx, cy);
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
        };

        // 逐格还原当前显示：颜色、小马、金色预置边框、判错遮罩、✕ 标注
        for (let dr = 0; dr < N; dr++) {
            const r = N - 1 - dr;
            for (let c = 0; c < N; c++) {
                const x = boardX + c * (cell + gap), y = boardY + dr * (cell + gap);
                const cx = x + cell / 2, cy = y + cell / 2;
                const el = getCell (r, c);
                const cls = el ? el.classList : null;

                roundRectPath (ctx, x, y, cell, cell, radius);
                ctx.fillStyle = PALETTE[colorMap[r][c]];
                ctx.fill ();

                if (cls && cls.contains ("wrong")) {
                    roundRectPath (ctx, x, y, cell, cell, radius);
                    ctx.fillStyle = "rgba(25, 25, 40, .38)";
                    ctx.fill ();
                    drawX (cx, cy, "#ff3b30");   // 系统判错：红色
                } else if (cls && (cls.contains ("used") || cls.contains ("preset"))) {
                    roundRectPath (ctx, x + 2, y + 2, cell - 4, cell - 4, radius - 2);
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = cls.contains ("preset")
                        ? "rgba(255, 215, 90, .95)" : "rgba(255, 255, 255, .8)";
                    ctx.stroke ();
                    ctx.font = `${Math.round (cell * .55)}px ${emojiFont}`;
                    ctx.fillStyle = "#3b3b58";
                    ctx.fillText ("🐴", cx, cy + 2);
                } else if (el && el.querySelector (".mark")) {
                    drawX (cx, cy, "#fff");   // 用户标注：白色
                }
            }
        }

        // 下方居中：局号
        ctx.fillStyle = "#3b3b58";
        ctx.font = `700 26px ${font}`;
        ctx.fillText (I18N.t ("exportIdLabel") + id, W / 2,
            boardY + size + labelGap + colLabelH + footerH / 2);

        canvas.toBlob (blob => {
            if (!blob) {
                showMessage ("exportFailed", "lose");
                return;
            }
            const fileName = I18N.t ("exportFileName", {id: id});
            const url = URL.createObjectURL (blob);
            const a = document.createElement ("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild (a);
            a.click ();
            a.remove ();
            setTimeout (() => URL.revokeObjectURL (url), 1000);
            showMessage ("exportSuccess", "", {file: fileName});
        }, "image/png");
    }

    // 按难度随机预置若干小马：计入已放置数量，格子不可再被点击
    function presetKnights (count) {
        const positions = Array.from (solution);
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor (rand () * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        positions.slice (0, Math.min (count, positions.length)).forEach (k => {
            const [r, c] = k.split (",").map (Number);
            const cell = getCell (r, c);
            placed.add (k);
            cell.classList.add ("used", "preset");
            cell.innerHTML = "🐴";
        });
    }

    // 按指定阶数生成随机局号（序列号 1-1000）
    function randomGameId (n) {
        const serial = 1 + Math.floor (Math.random () * 1000);
        return n + "-" + String (serial).padStart (3, "0");
    }

    // opts.reuse：复用当前局号重建棋盘（例如仅切换难度时）
    function startGame (opts = {}) {
        let id, randomPicked = false;
        if (opts.reuse && gameId) {
            id = gameId;
        } else {
            const raw = gameIdEl.value.trim ();
            if (raw === "") {
                // 仅选择阶数、局号留空：在该阶数随机挑一局，输入框保持留空
                id = randomGameId (Number (orderEl.value));
                randomPicked = true;
            } else {
                const parsed = parseGameId (raw);
                if (!parsed) {
                    showMessage ("msgInvalidId", "lose");
                    gameIdEl.focus ();
                    gameIdEl.select ();
                    return;
                }
                id = parsed.id;
                orderEl.value = String (parsed.n); // 局号自带阶数，以下拉框同步显示
                gameIdEl.value = id;               // 规范化，例如 10-56 -> 10-056
            }
        }

        gameId = id;
        N = Number (id.split ("-")[0]);
        rand = makeRng (seedFromString (gameId)); // 同一局号 => 同一随机序列 => 同一棋盘
        hp = MAX_HP;
        placed = new Set ();
        disabled = new Set ();
        gameOver = false;
        if (clickTimer) {
            clearTimeout (clickTimer);
            clickTimer = null;
        }
        clickCell = null;
        prevClickCell = lastClickCell = null;
        dragState = null;
        ignoreClickUntil = 0;
        resetTimer ();
        closeDialog ();

        // 高阶棋盘生成需搜索唯一解，异步执行以便先显示提示，界面不假死
        generating = true;
        const token = ++generationToken;
        showMessage ("msgGenerating");
        setTimeout (() => {
            if (token !== generationToken) return;
            buildBoard (randomPicked);
        }, 0);
    }

    function buildBoard (randomPicked) {
        const puzzle = generatePuzzle (N);
        solution = new Set (puzzle.knightCols.map ((c, r) => key (r, c)));
        colorMap = puzzle.map;

        render ();
        renderAnswer ();

        const preset = PRESET_COUNT[difficultyEl.value] ?? 0;
        presetKnights (preset);

        updateHearts ();
        updateProgress ();
        const tips = [];
        if (randomPicked) tips.push ({key: "msgRandomTips", vars: {id: gameId}});
        if (preset > 0) tips.push ({key: "msgPresetTips", vars: {count: preset}});
        showMessage (tips);
        generating = false;
    }

    document.getElementById ("startBtn").addEventListener ("click", () => startGame ());
    orderEl.addEventListener ("change", () => {
        gameIdEl.value = "";   // 只选阶数：清空局号，随机开局
        startGame ();
    });
    document.getElementById ("randomBtn").addEventListener ("click", () => {
        gameIdEl.value = randomGameId (Number (orderEl.value));
        startGame ();
    });
    gameIdEl.addEventListener ("keydown", e => {
        if (e.key === "Enter") startGame ();
    });
    difficultyEl.addEventListener ("change", () => startGame ({reuse: true}));

    retryBtnEl.addEventListener ("click", () => {
        closeDialog ();
        startGame ({reuse: true});   // 同一局号重玩
    });
    newGameBtnEl.addEventListener ("click", () => {
        closeDialog ();
        gameIdEl.value = "";        // 局号留空 => 按当前阶数随机开新局
        startGame ();
    });
    cancelBtnEl.addEventListener ("click", closeDialog);
    overlayEl.addEventListener ("click", e => {
        if (e.target === overlayEl) closeDialog ();
    });

    document.addEventListener ("pointermove", onPointerMove);
    document.addEventListener ("pointerup", onPointerUp);
    document.addEventListener ("pointercancel", onPointerUp);

    answerBtnEl.addEventListener ("click", () => setAnswerVisible (!answerVisible));
    answerCloseEl.addEventListener ("click", () => setAnswerVisible (false));
    exportBtnEl.addEventListener ("click", exportBoardImage);

    function handleResize () {
        fitBoard ();
        if (answerVisible) renderAnswer ();
    }

    if (typeof window !== "undefined") {
        window.addEventListener ("resize", handleResize);
        window.addEventListener ("orientationchange", () => setTimeout (handleResize, 120));
    }

    langSelectEl.addEventListener ("change", () => I18N.setLanguage (langSelectEl.value));

    function applyLanguageToDynamicUI () {
        document.documentElement.lang = I18N.getLanguage ().replace ("_", "-");
        langSelectEl.value = I18N.getLanguage ();
        updateTimer ();
        if (gameId) updateProgress ();
        answerBtnEl.textContent = I18N.t (answerVisible ? "hideAnswer" : "showAnswer");
        renderMessage ();
        if (!overlayEl.hidden) renderDialog ();
    }

    I18N.onReady (() => {
        I18N.applyStatic (document);
        applyLanguageToDynamicUI ();
        startGame ();
    });
    I18N.onChange (applyLanguageToDynamicUI);
}) ();

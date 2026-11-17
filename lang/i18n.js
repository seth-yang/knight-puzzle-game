(() => {
    "use strict";

    const SUPPORTED = ["zh_CN", "en_US"];
    const FALLBACK = "en_US";
    const PACKS = {};
    let currentLang = null;
    let ready = false;
    const readyQueue = [];
    const changeListeners = [];

    // 按浏览器语言优先级匹配：精确匹配 > 语言前缀匹配 > 回退 en_US
    function detectLang () {
        const list = (navigator.languages && navigator.languages.length)
            ? navigator.languages
            : [navigator.language || ""];
        for (const raw of list) {
            const code = String (raw).toLowerCase ().replace (/-/g, "_");
            if (SUPPORTED.indexOf (code) !== -1) return code;
            if (code === "zh" || code.indexOf ("zh_") === 0) return "zh_CN";
            if (code === "en" || code.indexOf ("en_") === 0) return "en_US";
        }
        return FALLBACK;
    }

    function loadPack (lang, done) {
        if (PACKS[lang]) { done (true); return; }
        const s = document.createElement ("script");
        s.src = 'lang/' + lang + ".js";
        s.onload = () => {
            const pack = (window.KNIGHT_I18N_PACKS || {})[lang];
            if (pack) { PACKS[lang] = pack; done (true); }
            else done (false);
        };
        s.onerror = () => done (false);
        document.head.appendChild (s);
    }

    function parseVars (raw) {
        if (!raw) return null;
        const out = {};
        raw.split (",").forEach (pair => {
            const i = pair.indexOf ("=");
            if (i > 0) out[pair.slice (0, i).trim ()] = pair.slice (i + 1).trim ();
        });
        return out;
    }

    function t (key, vars) {
        const pack = PACKS[currentLang] || PACKS[FALLBACK] || {};
        let str = pack[key];
        if (typeof str !== "string") str = key;
        if (vars) {
            str = str.replace (/\{(\w+)\}/g, (m, k) =>
                Object.prototype.hasOwnProperty.call (vars, k) ? String (vars[k]) : m);
        }
        return str;
    }

    function applyStatic (root) {
        const r = root || document;
        const nodes = r.querySelectorAll (
            "[data-i18n], [data-i18n-html], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]");
        nodes.forEach (el => {
            const vars = parseVars (el.getAttribute ("data-i18n-vars"));
            if (el.hasAttribute ("data-i18n")) el.textContent = t (el.getAttribute ("data-i18n"), vars);
            if (el.hasAttribute ("data-i18n-html")) el.innerHTML = t (el.getAttribute ("data-i18n-html"), vars);
            if (el.hasAttribute ("data-i18n-placeholder")) el.placeholder = t (el.getAttribute ("data-i18n-placeholder"), vars);
            if (el.hasAttribute ("data-i18n-title")) el.title = t (el.getAttribute ("data-i18n-title"), vars);
            if (el.hasAttribute ("data-i18n-aria-label")) el.setAttribute ("aria-label", t (el.getAttribute ("data-i18n-aria-label"), vars));
        });
    }

    function setLanguage (lang, done) {
        if (SUPPORTED.indexOf (lang) === -1) lang = FALLBACK;
        loadPack (lang, ok => {
            if (!ok && lang !== FALLBACK) { setLanguage (FALLBACK, done); return; }
            const changed = currentLang !== lang;
            currentLang = lang;
            applyStatic (document);
            if (changed) {
                changeListeners.forEach (fn => fn (lang));
                if (!ready) {
                    ready = true;
                    readyQueue.splice (0).forEach (fn => fn (lang));
                }
            }
            if (done) done (true);
        });
    }

    setLanguage (detectLang ());

    window.I18N = {
        t: t,
        applyStatic: applyStatic,
        getLanguage: () => currentLang,
        supported: SUPPORTED.slice (),
        onReady: fn => { if (ready) fn (currentLang); else readyQueue.push (fn); },
        onChange: fn => changeListeners.push (fn),
        setLanguage: setLanguage
    };
}) ();

// ==UserScript==
// @name         虎牙直播优化器 | HuyaLiveOptimizer
// @namespace    https://github.com/mks155
// @homepageURL  https://github.com/mks155/HuyaLiveOptimizer
// @icon         https://raw.githubusercontent.com/mks155/HuyaLiveOptimizer/main/docs/icon.svg
// @version      2.5.2
// @description  进直播间自动解锁画质扫码限制、秒切最高/指定清晰度、一键进入观影模式；画面弹幕悬停可 +1 复读，发送框 ↑↓ 翻历史。设置全站生效，安装即用 | Auto unlock quality, switch to 4K/50M, theater mode, screen-danmaku +1, send history
// @author       mks155
// @copyright    2025, mks155 (https://github.com/mks155)
// @match        *://*.huya.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @license      Apache-2.0
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const NS = 'HuyaLiveOptimizer';
    const VERSION = (() => {
        try {
            const script = (typeof GM_info !== 'undefined' && GM_info.script) || null;
            if (script && script.version) return String(script.version);
            const meta = (typeof GM_info !== 'undefined' && (GM_info.scriptMeta || script?.meta)) || null;
            const v = meta?.version || meta?.json?.version;
            if (v) return String(v);
            const src = script?.code || document.currentScript?.textContent || '';
            const m = String(src).match(/@version\s+(\S+)/);
            if (m) return m[1];
        } catch (e) {
            console.warn(`[${NS}]`, '解析版本号失败，回退 0.0.0', e);
        }
        return '0.0.0';
    })();
    const STORAGE_KEY = 'huya_optimizer';
    const MAX_HISTORY = 20;

    /** 全站画质档位（高 → 低）。默认最高；用户选的档房间没有则回退最高。 */
    const STANDARD_QUALITIES = [
        '4K',
        '2K',
        '蓝光50M',
        '蓝光30M',
        '蓝光20M',
        '蓝光15M',
        '蓝光10M',
        '蓝光8M',
        '蓝光4M',
        '超清',
        '流畅'
    ];
    const QUALITY_AUTO = '';

    // 全局重试次数：所有需要重试的地方都用这一个值
    const MAX_TRIES = 3;

    const FANS_BADGE_DELAY = 15000;
    const FANS_CHECKIN_DELAY = 30000;
    const FANS_BADGE_RETRY = 6000;

    // 播放器起播可能很慢，一轮 attempt 自己就要十几秒，
    // 所以除了 MAX_TRIES 还留一个墙钟兜底，不靠 watchdog 的 tick 数算
    const PLAYER_RETRY_BUDGET = 60000;
    const PLAYER_RETRY_GAP = 2500;
    // 落定后在这两个时间点复核画质：站侧可能在起播过程中改回默认档。
    // 实测影院切换不再重建播放器（进出各 3 次画质都没掉），所以复核只看画质。
    const PLAYER_SETTLE_DELAYS = [4000, 12000];
    // 落定复核最多补几轮，防止「复核→重跑→再复核」无限循环
    const PLAYER_SETTLE_MAX_FIX = 2;

    const THEME_MODES = ['auto', 'light', 'dark'];
    const THEME_LABEL = { auto: '跟随浏览器', light: '白天', dark: '夜晚' };
    const THEME_ICON = {
        auto: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 20.5h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 13.5V8.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.5" fill="currentColor"/></svg>',
        light: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
        dark: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7z" fill="currentColor"/></svg>'
    };

    const DEFAULT_SETTINGS = {
        targetQuality: QUALITY_AUTO,
        autoTheater: true,
        enableScreenPlusOne: true,
        enableDanmakuHistory: true,
        enableFansBadge: true,
        enableFansCheckIn: true,
        // auto=跟随浏览器 / light=白天 / dark=夜晚
        themeMode: 'auto'
    };

    const SEL = {
        theaterBtn: '#player-fullpage-btn',
        theaterOn: 'player-narrowpage',
        qualityList: '.player-videotype-list li',
        qualityCurrent: '.player-videotype-cur',
        giftRightUl: '.player-gift-right ul',
        nobleBtn: '#player-noble-btn',
        danmuWrap: '#danmuwrap, #player-danmu-wrap, .danmu-wrap',
        danmuItem: ['.danmu-item', '.player-danmu-item'],
        sendBtn: '#msg_send_bt',
        // 弹幕颜色面板有两套并存：
        // 粉丝团房间是 React portal（标题「粉丝弹幕」，靠 onMouseEnter 触发）；
        // 赛事房间没有粉丝团，走普通 DOM 的 #J-room-club-color（标题「彩色弹幕」，靠 jQuery mouseover 触发）。
        fansBarragePortal: '.J_PortalChatPanelRoot',
        fansBarrageHead: '[class*="PanelHd--"]',
        fansBarrageItem: '[class*="item--"]',
        fansClubColorPanel: '#J-room-club-color',
        fansClubColorList: '#J-color-list-club > li',
        // 触发按钮：两套实现监听的事件不同，mouseover 和 mouseenter 都要派
        fansBarrageTrigger: '#J-room-chat-color',
        inputCandidates: [
            '#pub_msg_input',
            '.chat-room__input input[type="text"]',
            '.chat-room__input input:not([type="button"]):not([type="submit"])',
            '.chat-room__input textarea',
            '.chat-room__input [contenteditable="true"]',
            '.chat-speaker input',
            '.chat-speaker [contenteditable="true"]',
            '#chatRoom input[type="text"]',
            '#chatRoom [contenteditable="true"]'
        ]
    };

    // ---------- storage ----------
    const store = {
        get(key, fallback) {
            try {
                const raw = GM_getValue(key, null);
                if (raw == null) return fallback;
                return raw;
            } catch (e) {
                warn('store.get 失败', e);
                return fallback;
            }
        },
        set(key, value) {
            try {
                GM_setValue(key, value);
                return true;
            } catch (e) {
                warn('store.set 失败', e);
                return false;
            }
        }
    };

    function loadStore() {
        const saved = store.get(STORAGE_KEY, null);
        return saved && typeof saved === 'object' ? saved : {};
    }

    function saveStore(patch) {
        const next = Object.assign(loadStore(), patch);
        store.set(STORAGE_KEY, next);
        return next;
    }

    function loadSettings() {
        const data = loadStore();
        return {
            targetQuality: data.targetQuality ?? DEFAULT_SETTINGS.targetQuality,
            autoTheater: data.autoTheater ?? DEFAULT_SETTINGS.autoTheater,
            enableScreenPlusOne: data.enableScreenPlusOne ?? DEFAULT_SETTINGS.enableScreenPlusOne,
            enableDanmakuHistory: data.enableDanmakuHistory ?? DEFAULT_SETTINGS.enableDanmakuHistory,
            enableFansBadge: data.enableFansBadge ?? DEFAULT_SETTINGS.enableFansBadge,
            enableFansCheckIn: data.enableFansCheckIn ?? DEFAULT_SETTINGS.enableFansCheckIn,
            themeMode: THEME_MODES.includes(data.themeMode) ? data.themeMode : DEFAULT_SETTINGS.themeMode
        };
    }

    function saveSettings(s) {
        saveStore({
            targetQuality: s.targetQuality,
            autoTheater: s.autoTheater,
            enableScreenPlusOne: s.enableScreenPlusOne,
            enableDanmakuHistory: s.enableDanmakuHistory,
            enableFansBadge: s.enableFansBadge,
            enableFansCheckIn: s.enableFansCheckIn,
            themeMode: s.themeMode
        });
    }

    function loadHistory() {
        const list = loadStore().danmakuHistory;
        return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()) : [];
    }

    function saveHistory(list) {
        saveStore({ danmakuHistory: list.slice(-MAX_HISTORY) });
    }

    // ---------- utils ----------
    const log = (...a) => console.log(`[${NS}]`, ...a);
    const warn = (...a) => console.warn(`[${NS}]`, ...a);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function copyText(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        let ok;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        ta.remove();
        if (!ok) {
            try {
                navigator.clipboard.writeText(text);
                ok = true;
            } catch (e) {
                ok = false;
            }
        }
        return ok;
    }

    // ---------- 举报：走官方视频弹幕黑条 ----------
    // 官方在 #danmudiv 上用 jQuery 委托监听 mousedown 且 which===3（右键，不是 contextmenu），
    // 命中后弹 #player-danmu-report 黑条（复制/举报）；uid/nick/msg 都存在元素的 jQuery data 上，
    // 点黑条里的「举报」才 trigger('reportMessage', {uid,nick,msg})。
    // 所以不自造 payload，只把官方黑条唤出来点它那一项 —— uid 是真的，弹窗也是官方的。
    // 黑条定位读的是元素的 css('top') 与 transform，不看事件坐标，弹幕飘走也不影响。
    const DANMU_BAR = '#player-danmu-report';

    // 黑条只对这三类节点生效
    function isOfficialDanmu(el) {
        return !!el.closest('#danmudiv, #danmudiv2') &&
            !!el.closest('.danmu-item, .danmu-tv-item-big, .danmu-tv-item-small');
    }

    // 页面 realm 直接 new MouseEvent 并冒泡，官方是 jQuery 委托监听才能收到。
    // 不复用 fireMouse：它兜底分支会把 bubbles/cancelable 写死成 false，失败还是静默的。
    function pageMouse(el, type, init) {
        const view = el.ownerDocument.defaultView;
        const ev = new view.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view,
            clientX: 0,
            clientY: 0,
            ...init,
        });
        el.dispatchEvent(ev);
        return ev;
    }

    function centerOf(el) {
        const b = el.getBoundingClientRect();
        return {
            clientX: Math.round(b.left + b.width / 2),
            clientY: Math.round(b.top + b.height / 2),
        };
    }

    async function reportDanmu(item) {
        const bar = queryOne(DANMU_BAR);
        if (!bar) return { ok: false, reason: '官方黑条不存在' };
        if (!item || !isOfficialDanmu(item)) return { ok: false, reason: '这不是官方弹幕节点' };
        // 右键由官方按 which===3 判定，button:2 会被 jQuery 归一化成 3
        pageMouse(item, 'mousedown', { ...centerOf(item), button: 2, buttons: 2 });
        await sleep(120);
        if (getComputedStyle(bar).display === 'none') return { ok: false, reason: '黑条没弹出' };
        const label = ((bar.querySelector('span') || {}).textContent || '').trim();
        const btn = [...bar.querySelectorAll('span')].find((e) => (e.textContent || '').trim() === '举报');
        if (!btn) {
            bar.style.display = 'none';
            // 房管看到的是「禁言」，官方没给举报
            return { ok: false, reason: label === '禁言' ? '你是房管，官方只给禁言' : '黑条里没有举报' };
        }
        const at = centerOf(btn);
        pageMouse(btn, 'mousedown', { ...at, button: 0, buttons: 1 });
        pageMouse(btn, 'mouseup', { ...at, button: 0, buttons: 0 });
        pageMouse(btn, 'click', { ...at, button: 0, detail: 1 });
        await sleep(150);
        return { ok: true, via: 'danmu-bar' };
    }

    function waitFor(fn, { timeout = 15000, interval = 250, label = 'cond' } = {}) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                let ok;
                try {
                    ok = !!fn();
                } catch (e) {
                    ok = false;
                }
                if (ok) return resolve(true);
                if (Date.now() - start >= timeout) return reject(new Error(`timeout: ${label}`));
                setTimeout(tick, interval);
            };
            tick();
        });
    }

    function queryOne(selectors, root = document) {
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of list) {
            try {
                const el = root.querySelector(sel);
                if (el) return el;
            } catch (e) {
            }
        }
        return null;
    }

    function queryAll(selector, root = document) {
        try {
            return Array.from(root.querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }

    const page$ = () => unsafeWindow.$ || unsafeWindow.jQuery || null;

    function waitForJQuery(timeout = 10000) {
        return waitFor(() => page$(), { timeout, interval: 200, label: 'jQuery' });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setNativeValue(el, value) {
        if (!el) return false;
        if (el.isContentEditable) {
            el.focus();
            el.textContent = value;
            el.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: value
                })
            );
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        const desc =
            Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value') ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (desc?.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function readInputValue(el) {
        if (!el) return '';
        if (el.isContentEditable) return (el.textContent || '').trim();
        return (el.value || '').trim();
    }

    function findDanmakuInput() {
        return queryOne(SEL.inputCandidates);
    }

    function findSendBtn() {
        return queryOne([SEL.sendBtn, '.btn-sendMsg', '.chat-room__input .btn-sendMsg']);
    }

    function scheduleIdle(fn, timeout = 4000) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => fn(), { timeout });
        } else {
            setTimeout(fn, Math.min(timeout, 2500));
        }
    }

    /* ---------- 整站暗色 ----------
       虎牙没有内置主题（实测 html 上没有主题 class、CSS 里也没有 dark/night/skin 约定），
       所以只能由这里覆盖。样式单独一张 <style>，只在需要暗色时才挂上，
       白天模式下不占样式表；开/关只切 html 上的 hlo-dark class。
       选择器刻意压低特异性：虎牙的 class 名多为 hash 化的（Panel--xxx 那种），
       撞名的概率低；配合 html.hlo-dark 前缀已足够压过普通类规则。 */
    const SITE_DARK_CSS = `
html.hlo-dark{scrollbar-color:#4a4d57 #1b1d22;scrollbar-width:thin}
html.hlo-dark body{background:#15161a!important;color:#ddd!important}
html.hlo-dark ::selection{background:#f80;color:#111}

/* 顶部导航 + 房间信息条 */
html.hlo-dark .duya-header-wrap,
html.hlo-dark #J_roomHeader,
html.hlo-dark .room-hd{background:#1e2026!important;color:#ddd!important}
html.hlo-dark .duya-header-wrap *[class*="nav"],
html.hlo-dark .duya-header-wrap a{color:#c8ccd4!important}
html.hlo-dark #search-bar-input{background:#282a31!important;color:#ddd!important;border-color:#3a3d46!important}

/* 侧栏容器与聊天区 */
html.hlo-dark .room-sidebar-box,
html.hlo-dark .room-sidebar-chat,
html.hlo-dark #chatRoom,
html.hlo-dark .chat-room__ft,
html.hlo-dark #tipsOrchat{background:#1b1d22!important;color:#ddd!important}
html.hlo-dark .chat-room__input,
html.hlo-dark .chat-room__input input,
html.hlo-dark #pub_msg_input{background:#23262d!important;color:#ddd!important;border-color:#3a3d46!important}

/* 播放器下方礼物条 / 公屏 */
html.hlo-dark #player-gift-wrap,
html.hlo-dark .player-gift-right,
html.hlo-dark .room-player-gift{background:#1b1d22!important;color:#ccc!important}

/* 各类面板与弹层（粉丝团、勋章、设置等 React portal 与普通 DOM 都算） */
html.hlo-dark [class*="Panel--"]{background:#1e2026!important;color:#ddd!important}
html.hlo-dark [class*="PanelBd--"],
html.hlo-dark [class*="PanelFt--"]{background:#1b1d22!important;color:#ccc!important}
html.hlo-dark [class*="Modal--"],
html.hlo-dark .dlg{background:#22242b!important;color:#ddd!important}
html.hlo-dark .dlg-bd,
html.hlo-dark .dlg-ft{background:#22242b!important;color:#ddd!important}
html.hlo-dark .dlg-btn-gray{background:#343740!important;color:#ddd!important}
html.hlo-dark .common-panel-tips,
html.hlo-dark [class*="Pop--"]{background:#2a2d36!important;color:#eee!important}

/* 通用：卡片、次级块、分隔线
       这些 [class*="xxx--"] 是给 hash 化的类名用的（Panel--a1b2c3 这种），
       抗改名。实测过稳态开销：全量样式重算 0.003ms，插入 200 个节点 4.6ms
       （无规则基线 3.7ms），差异可忽略，所以保留。 */
html.hlo-dark [class*="item--"],
html.hlo-dark [class*="card" i],
html.hlo-dark .box-noble-level-1,
html.hlo-dark .box-noble-level-2,
html.hlo-dark .box-noble-level-3{background:#23262d!important}
html.hlo-dark hr,
html.hlo-dark [class*="separator"],
html.hlo-dark [class*="line--"]{background:#33363f!important;border-color:#33363f!important}
html.hlo-dark .subscribe-hd{background:#23262d!important;color:#ddd!important}

/* 房间信息条上的徽标与进度块（实测这些是浅灰底 rgb(242,242,242)，白底很扎眼）
       类名是 hash 化的（sub--tU0ZNetSBi7UM4Wvhac1），必须用属性通配，写精确 class 一条都命不中 */
html.hlo-dark [class*="sub--"],
html.hlo-dark [class*="rankItem--"],
html.hlo-dark [class*="bannerItem--"]{background:#2a2d36!important;color:#c8ccd4!important}

/* 侧栏头部、周榜/超粉榜等 tab 页 */
html.hlo-dark #J_roomSideHd,
html.hlo-dark .room-sidebar-hd,
html.hlo-dark #J_roomWeeklyRankListRoot,
html.hlo-dark .room-weeklyRankList-content,
html.hlo-dark [class*="tabPane--"]{background:#1e2026!important;color:#ddd!important}
html.hlo-dark [class*="rankTab"],
html.hlo-dark .room-weeklyRankList-nav-item{background:#23262d!important;color:#ccc!important}

/* 播放器下方占位条与侧栏广告位 */
html.hlo-dark .room-player-gift-placeholder,
html.hlo-dark #ab-banner{background:#1b1d22!important}

/* 播放器左侧的活动图标列（实测是白底方块，落在房间信息条下方） */
html.hlo-dark .player-gift-left,
html.hlo-dark [class*="diy-activity-icon"],
html.hlo-dark [class*="activity-icon-box"]{background:#2a2d36!important}

/* 输入控件与链接 */
html.hlo-dark input,
html.hlo-dark textarea,
html.hlo-dark select{background:#23262d!important;color:#ddd!important;border-color:#3a3d46!important;color-scheme:dark}
html.hlo-dark a{color:#7fb2ff!important}
html.hlo-dark a:hover{color:#a5c8ff!important}
    `;

    function ensureSiteDarkStyle(on) {
        const id = 'hlo-site-dark';
        let el = document.getElementById(id);
        if (!on) {
            el?.remove();
            return;
        }
        if (el) return;
        el = document.createElement('style');
        el.id = id;
        el.textContent = SITE_DARK_CSS;
        (document.head || document.documentElement).appendChild(el);
    }

    // ---------- styles ----------
    function injectStyles() {
        if (document.getElementById('hlo-styles')) return;
        const style = document.createElement('style');
        style.id = 'hlo-styles';
        style.textContent = `
ul.player-gift-right{width:max-content!important;min-width:228px;display:flex!important;flex-wrap:nowrap!important;align-items:flex-start}
ul.player-gift-right>li{float:none!important;flex:0 0 auto!important}
#hlo-settings-btn{cursor:pointer!important;user-select:none;color:#f80!important}
#hlo-settings-btn:hover{color:#ffaa33!important}
#hlo-settings-btn i{width:24px;height:24px;display:inline-block;margin-top:8px;background:none!important;line-height:0;transition:filter .15s ease}
#hlo-settings-btn:hover i{filter:brightness(1.18)}
#hlo-settings-btn i svg{display:block;width:24px;height:24px;border-radius:5px;overflow:hidden}
#hlo-settings-btn p{margin:0;font-size:12px;line-height:18px;text-align:center;color:inherit;white-space:nowrap}

#hlo-settings-backdrop{position:fixed;inset:0;z-index:2147483645;background:transparent}
#hlo-settings-panel{
  --hlo-bg:#1f1f23;--hlo-fg:#eee;--hlo-title:#fff;--hlo-border:#3a3a40;--hlo-muted:#bbb;--hlo-faint:#888;
  --hlo-sep:#34343a;--hlo-weak:#6e6e78;--hlo-sel-bg:#2a2a30;--hlo-sel-fg:#eee;--hlo-sel-br:#444;
  --hlo-ghost-bg:#333;--hlo-ghost-fg:#ddd;--hlo-shadow:0 8px 28px rgba(0,0,0,.55);--hlo-btn:#f80;
  position:fixed;z-index:2147483646;width:280px;box-sizing:border-box;
  background:var(--hlo-bg);color:var(--hlo-fg);border:1px solid var(--hlo-border);border-radius:8px;
  box-shadow:var(--hlo-shadow);padding:12px 14px 14px;
  font:13px/1.5 inherit;pointer-events:auto!important
}
#hlo-settings-panel[data-theme="light"]{
  --hlo-bg:#fff;--hlo-fg:#222;--hlo-title:#111;--hlo-border:#d8d8dc;--hlo-muted:#555;--hlo-faint:#888;
  --hlo-sep:#e6e6ea;--hlo-weak:#9a9aa2;--hlo-sel-bg:#f2f2f5;--hlo-sel-fg:#222;--hlo-sel-br:#ccc;
  --hlo-ghost-bg:#ececf0;--hlo-ghost-fg:#333;--hlo-shadow:0 8px 28px rgba(0,0,0,.18);--hlo-btn:#f80;
}

#hlo-settings-panel *{pointer-events:auto!important}
#hlo-settings-panel .hlo-head{display:flex;align-items:flex-start;gap:8px;margin:0 0 10px}
#hlo-settings-panel h3{flex:1;min-width:0;margin:0;font-size:14px;font-weight:600;color:var(--hlo-title)}
#hlo-settings-panel .hlo-head-right{display:flex;align-items:center;gap:2px;flex:0 0 auto}
#hlo-settings-panel .ver{font-size:10px;color:var(--hlo-weak);white-space:nowrap}
#hlo-settings-panel #hlo-theme{
  flex:0 0 auto;width:22px;height:22px;padding:0;border:0;background:none!important;border-radius:4px;
  color:var(--hlo-muted);cursor:pointer;line-height:0;transition:color .15s,background .15s
}
#hlo-settings-panel #hlo-theme:hover{color:var(--hlo-title);background:var(--hlo-ghost-bg)}
#hlo-settings-panel #hlo-theme svg[data-mode]{display:none}
#hlo-settings-panel #hlo-theme svg[data-active="1"]{display:block}
#hlo-settings-panel label.row{display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer}
#hlo-settings-panel select{
  width:100%;box-sizing:border-box;margin-top:4px;padding:6px 8px;
  border-radius:4px;border:1px solid var(--hlo-sel-br);background:var(--hlo-sel-bg);color:var(--hlo-sel-fg);font-size:13px
}
#hlo-settings-panel .field{margin-bottom:8px}
#hlo-settings-panel .field-label{color:var(--hlo-muted);font-size:12px}
#hlo-settings-panel .actions{display:flex;gap:8px;margin-top:12px}
#hlo-settings-panel button{flex:1;padding:7px 0;border:none;border-radius:4px;cursor:pointer;font-size:13px}
#hlo-settings-panel .btn-primary{background:var(--hlo-btn);color:#111;font-weight:600}
#hlo-settings-panel .btn-ghost{background:var(--hlo-ghost-bg);color:var(--hlo-ghost-fg)}
#hlo-settings-panel .hint{margin-top:8px;color:var(--hlo-faint);font-size:11px}
#hlo-settings-panel .credits{margin:10px 0 -6px;padding-top:8px;border-top:1px solid var(--hlo-sep);color:var(--hlo-weak);font-size:11px;text-align:center}
#hlo-settings-panel .credits .ver{margin-bottom:3px}
#hlo-settings-panel .credits a{color:var(--hlo-btn);text-decoration:underline}
#hlo-settings-panel .credits a:hover{color:#ffc45c}

#hlo-danmu-freeze{
  position:fixed;z-index:2147483001;display:flex;align-items:center;gap:8px;
  pointer-events:auto!important;max-width:min(90vw,640px);
  padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.55);
  user-select:none;-webkit-user-select:none
}
#hlo-danmu-freeze .hlo-freeze-text{
  color:#fff;font-size:16px;font-weight:700;line-height:24px;
  text-shadow:#222 1px 0 1px,#222 0 1px 1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px;
  pointer-events:none;user-select:none
}
#hlo-danmu-freeze .hlo-plus1{
  flex:0 0 auto;min-width:40px;height:26px;padding:0 10px;border:none;border-radius:13px;
  background:linear-gradient(180deg,#ff9a1f,#f80);color:#111;font-size:12px;font-weight:700;
  line-height:26px;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.4);white-space:nowrap
}
#hlo-danmu-freeze .hlo-plus1:hover{filter:brightness(1.08)}
#hlo-danmu-freeze .hlo-dmbtn{
  flex:0 0 auto;min-width:40px;height:26px;padding:0 10px;border:none;border-radius:13px;
  background:#4a4a52;color:#eee;font-size:12px;font-weight:700;
  line-height:26px;cursor:pointer;white-space:nowrap;
  box-shadow:0 1px 6px rgba(0,0,0,.4)
}
#hlo-danmu-freeze .hlo-dmbtn:hover{filter:brightness(1.12)}
#hlo-danmu-freeze .hlo-dmbtn-report{background:linear-gradient(180deg,#ff9a1f,#f80);color:#111}
#hlo-danmu-freeze .hlo-dmbtn[disabled]{opacity:.55;cursor:default;filter:none}
`;
        document.head.appendChild(style);
    }

    function optimizerIconSvg() {
        return (
            '<svg viewBox="0 0 512 512" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<defs>' +
            '<linearGradient id="hloIcoBg" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="#12121A"/><stop offset="100%" stop-color="#1C1C2A"/>' +
            '</linearGradient>' +
            '<linearGradient id="hloIcoYlw" x1="0%" y1="0%" x2="0%" y2="100%">' +
            '<stop offset="0%" stop-color="#FFE033"/><stop offset="100%" stop-color="#FFA500"/>' +
            '</linearGradient>' +
            '<linearGradient id="hloIcoCyn" x1="0%" y1="100%" x2="100%" y2="0%">' +
            '<stop offset="0%" stop-color="#00E5FF"/><stop offset="100%" stop-color="#00FF88"/>' +
            '</linearGradient>' +
            '<filter id="hloIcoShd" x="-20%" y="-20%" width="140%" height="140%">' +
            '<feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.5"/>' +
            '</filter>' +
            '</defs>' +
            '<rect width="512" height="512" rx="115" fill="url(#hloIcoBg)"/>' +
            '<g opacity="0.92">' +
            '<circle cx="256" cy="256" r="205" fill="none" stroke="url(#hloIcoCyn)" stroke-width="12" stroke-dasharray="26 18" opacity="0.55"/>' +
            '<circle cx="256" cy="256" r="186" fill="none" stroke="#00E5FF" stroke-width="3" opacity="0.35"/>' +
            '<g transform="translate(402 108) rotate(18) scale(1.18)">' +
            '<g fill="url(#hloIcoCyn)">' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5"/>' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5" transform="rotate(45)"/>' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5" transform="rotate(90)"/>' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5" transform="rotate(135)"/>' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5" transform="rotate(180)"/>' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5" transform="rotate(225)"/>' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5" transform="rotate(270)"/>' +
            '<rect x="-7" y="-37" width="14" height="17" rx="5" transform="rotate(315)"/>' +
            '<circle cx="0" cy="0" r="23"/>' +
            '</g>' +
            '<circle cx="0" cy="0" r="9.5" fill="#141420"/>' +
            '<circle cx="0" cy="0" r="9.5" fill="none" stroke="#86FFF4" stroke-opacity="0.35" stroke-width="3"/>' +
            '</g>' +
            '<g transform="translate(115 405) rotate(45) scale(1.25)">' +
            '<path d="M -10 42 L -10 -4 C -21 -7 -28 -17 -28 -30 L -28 -52 L -12 -35 L 12 -35 L 28 -52 L 28 -30 C 28 -17 21 -7 10 -4 L 10 42 A 10 10 0 0 1 -10 42 Z" ' +
            'fill="url(#hloIcoCyn)" stroke="#00323B" stroke-opacity="0.4" stroke-width="2" stroke-linejoin="round"/>' +
            '<circle cx="0" cy="32" r="4.5" fill="#141420" stroke="#86FFF4" stroke-opacity="0.3" stroke-width="2"/>' +
            '<path d="M -3.5 -26 L -3.5 24" fill="none" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="4" stroke-linecap="round"/>' +
            '</g>' +
            '</g>' +
            '<g filter="url(#hloIcoShd)">' +
            '<path d="M 186 182 C 186 122, 326 122, 326 182 C 326 268, 296 342, 256 424 C 216 342, 186 268, 186 182 Z" ' +
            'fill="url(#hloIcoYlw)" stroke="#4A2E15" stroke-width="14" stroke-linejoin="round"/>' +
            '<path d="M 216 196 Q 214 268, 242 346" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" opacity="0.45"/>' +
            '<path d="M 234 226 L 292 262 L 234 298 Z" fill="#4A2E15" stroke="#4A2E15" stroke-width="17" stroke-linejoin="round"/>' +
            '</g>' +
            '<g>' +
            '<rect x="156" y="452" width="200" height="38" rx="19" fill="#00E5FF" opacity="0.16"/>' +
            '<rect x="156" y="452" width="200" height="38" rx="19" fill="none" stroke="#00E5FF" stroke-width="2" opacity="0.55"/>' +
            '<text x="256" y="479" font-family="Arial, sans-serif" font-weight="900" font-size="22" fill="#FFFFFF" text-anchor="middle" letter-spacing="3">OPTIMIZER</text>' +
            '</g>' +
            '</svg>'
        );
    }

    function extractDanmuText(item) {
        if (!item) return '';
        const spans = item.getElementsByTagName('span');
        for (let i = 0; i < spans.length; i++) {
            const t = (spans[i].textContent || '').trim();
            if (t && t.length <= 60) return t;
        }
        return (item.textContent || '').trim().slice(0, 60);
    }

    function closestDanmuItem(el) {
        if (!el || typeof el.closest !== 'function') return null;
        for (const sel of SEL.danmuItem) {
            const found = el.closest(sel);
            if (found) return found;
        }
        return null;
    }

    // ---------- player optimizer ----------
    class PlayerOptimizer {
        constructor(settings) {
            this.settings = settings;
            this.theaterDone = false;
            this.qualityDone = false;
            this.running = false;
            this.targetText = '';
            this.settleTimers = [];
            this.settleFixes = 0;
            this.warnedNoVideo = false;
        }

        isValidQuality(q) {
            return !!(q && q !== 'null' && q !== 'undefined' && q !== 'false' && String(q).trim());
        }

        // 这一档到底有没有流可播。
        // 占位列表（起播前那份）没有 sDisplayName/status 之外的字段，先当不可用。
        // 解锁本身不靠这个判断 —— unlockQuality() 是无差别把所有档的 status 置 0，
        // 扫码即享的档也一起解锁，这样点它时站侧才会真去换流。
        static isStreamable(data) {
            if (!data) return false;
            if (data.sDisplayName == null) return false;
            return true;
        }

        // 站侧已按码率排好序（iSortValue：20000 > 8000 > 4000 > 2000 > 500），
        // 比维护一张画质名数组可靠 —— 档位名随房间变（蓝光15M/10M 都有）。
        static sortOf($, li) {
            const d = (li && $(li).data('data')) || {};
            const v = Number(d.iSortValue);
            if (Number.isFinite(v) && v > 0) return v;
            const r = Number(d.iBitRate);
            return Number.isFinite(r) && r > 0 ? r : 0;
        }

        // 免扫码高画质：把画质列表里所有档的 status 置 0，扫码即享的档也一起解锁。
        // 必须无差别解锁 —— 之前按 iEnable 过滤，结果扫码档没解锁，点下去必然黑屏。
        unlockQuality() {
            const $ = page$();
            if (!$) {
                warn('jQuery missing, skip unlock');
                return false;
            }
            try {
                const $list = $(SEL.qualityList);
                if (!$list.length) return false;
                let changed = 0;
                $list.each((_, li) => {
                    const data = $(li).data('data');
                    if (data && data.status !== 0) {
                        data.status = 0;
                        changed += 1;
                    }
                });
                // 解锁后把「扫码即享」「请先登录」这些角标去掉，UI 上不再误导
                this.stripQualityTags($list);
                log(`unlock items=${$list.length} changed=${changed}`);
                return true;
            } catch (e) {
                warn('unlock failed', e);
                return false;
            }
        }

        // 站侧给锁定档渲染的角标（实测三种后缀：「请先登录」「请先登陆」「扫码即享」，
        // 赛事/蓝光档用后者，是 <div class="bitrate-right-btn common-enjoy-btn">）。
        // 解锁后直接移除节点：只设 display:none 的话 textContent 里还留着这几个字，
        // 列表看着仍像没解锁（站侧自己也会把它设成 display:none，但节点还在）。
        stripQualityTags($list) {
            try {
                $list.each((_, li) => {
                    for (const el of queryAll('*', li)) {
                        if (el.children.length) continue;
                        if (!/^(请先登录|请先登陆|扫码即享)$/.test((el.textContent || '').trim())) continue;
                        el.remove();
                    }
                });
            } catch (e) {
                /* 角标清理失败不影响主流程 */
            }
        }

        currentQualityText() {
            const el = queryOne(SEL.qualityCurrent);
            return el ? (el.textContent || '').trim() : '';
        }

        // 列表上带 on 的那项才是真选中的；标签 .player-videotype-cur 在播放器没起播时会滞后
        selectedQualityText() {
            const on = queryOne('.player-videotype-list li.on');
            if (!on) return '';
            const $ = page$();
            if ($) {
                try {
                    const d = $(on).data('data') || {};
                    if (d.sDisplayName) return String(d.sDisplayName).trim();
                } catch (e) {
                }
            }
            // 后缀实测有三种：「请先登录」「请先登陆」「扫码即享」（赛事/蓝光档用后者）。
// 正常都靠 sDisplayName 绕开，这里兜底也要剥干净，否则和标签比不上就算成没切上去。
            return (on.textContent || '')
                .replace(/请先登录|请先登陆|扫码即享/g, '')
                .trim();
        }

        // 起播前清晰度列表是占位的（只有「超清|高清」这种），点了也不生效，必须等 video 真的有数据
        isPlayerReady() {
            const v = queryOne(['#player-container video', '#player-vdieobox video', 'video']);
            return !!v && (v.readyState >= 2 || v.videoWidth > 0);
        }

        // 页面里一个 video 都没有，说明是电台之类不推视频的房间，
        // 再等多久都没用，必须认出来直接跳过，否则每轮白等 15s
        hasVideoElement() {
            return !!queryOne(['#player-container video', '#player-vdieobox video', 'video']);
        }

        // 占位列表的每一项都没有站侧数据（实测 data('data') 是 {}），
        // 真实列表每项都带 sDisplayName / status。拿占位列表去解析目标只会选到「超清」，
        // 所以在拿到真实列表之前一律视为不可用。
        realQualityList() {
            const $ = page$();
            if (!$) return null;
            const $list = $(SEL.qualityList);
            if (!$list.length) return null;
            let real = false;
            $list.each((_, li) => {
                const d = $(li).data('data');
                if (d && (d.sDisplayName != null || d.status != null)) real = true;
            });
            return real ? $list : null;
        }

        // 标签文本只是 UI 的自说自话：实测点到扫码档后标签会变成「蓝光20M」，
        // 但 video 立刻变 0x0/readyState=0，画面全黑。所以判成功必须看 video 有没有帧。
        videoAlive() {
            const v = queryOne(['#player-container video', '#player-vdieobox video', 'video']);
            if (!v) return false;
            return v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2;
        }

        // 两个信号打架（标签=高清 而 li.on=超清）就是起播前的占位状态，
        // 这时任何一边都不能当准 —— 之前用 || 合并会在这里误判成「已经是超清了」，
        // 于是连点都不点就收工，最高画质永远上不去。
        isCurrentQuality(target) {
            const n = PlayerOptimizer.normalize(target);
            const label = PlayerOptimizer.normalize(this.currentQualityText());
            const selected = PlayerOptimizer.normalize(this.selectedQualityText());
            const uiAgrees = (label && selected && label !== selected)
                ? false
                : label === n || selected === n;
            if (!uiAgrees) return false;
            // UI 说切上了，还得确认真有画面；黑屏不算切成功
            return this.videoAlive();
        }

        static nameOf($, li) {
            // 未解锁时渲染文本会带「请先登录」后缀，sDisplayName 才是干净的档位名
            const d = (li && $(li).data('data')) || {};
            if (d.sDisplayName) return String(d.sDisplayName).trim();
            const $span = $(li).find('span').first();
            return ($span.length ? $span.text() : $(li).text()).trim();
        }

        static normalize(name) {
            return String(name == null ? '' : name)
                .replace(/[\s\u00a0\u3000]/g, '')
                .toUpperCase();
        }

        resolveTarget($, $list) {
            const nameOf = (li) => PlayerOptimizer.nameOf($, li);
            const pick = (name) => {
                const want = PlayerOptimizer.normalize(name);
                if (!want) return null;
                let hit = null;
                $list.each((_, li) => {
                    if (!hit && PlayerOptimizer.normalize(nameOf(li)) === want) hit = li;
                });
                return hit;
            };

            // 用户指定的档：照点。点名要哪档就是哪档，不做可用性过滤。
            if (this.isValidQuality(this.settings.targetQuality)) {
                const el = pick(this.settings.targetQuality);
                if (el) return { el, text: this.settings.targetQuality };
                warn(`quality "${this.settings.targetQuality}" not in room → highest`);
            }

            // 自动最高：解锁之后按 iSortValue 取最大的那个。
            // iSortValue 是站侧给的码率权重（蓝光50M=50000 > 蓝光20M=20000 > 蓝光8M=8000 …），
            // 比维护一张画质名数组可靠 —— 档位名随房间变（蓝光30M/15M/10M 都有）。
            let best = null;
            let bestKey = -1;
            $list.each((_, li) => {
                if (!PlayerOptimizer.isStreamable($(li).data('data'))) return;
                const key = PlayerOptimizer.sortOf($, li);
                if (!best || key > bestKey) {
                    best = li;
                    bestKey = key;
                }
            });
            if (best) return { el: best, text: nameOf(best) };

            // 全都没有可用字段（异常列表），退回首项让上层报「切不动」
            const first = $list.get(0);
            return { el: first, text: first ? nameOf(first) : '' };
        }

        async waitForQuality(target, timeout = 8000) {
            try {
                await waitFor(() => this.isCurrentQuality(target), {
                    timeout,
                    interval: 250,
                    label: `quality ${target}`
                });
                return true;
            } catch (e) {
                warn(`quality timeout cur=${this.selectedQualityText() || '-'} label=${this.currentQualityText() || '-'} want=${target}`);
                return false;
            }
        }

        async switchQuality() {
            const $ = page$();
            if (!$) throw new Error('jQuery not ready');

            // 只认真实列表：占位列表里没有蓝光/4K，解析出来的目标必然是「超清」
            const $list = this.realQualityList();
            if (!$list) throw new Error('quality list not ready');

            this.unlockQuality();

            const { el, text } = this.resolveTarget($, $list);
            if (!el || !text) throw new Error('target quality missing');
            // 记下目标：站点若把画质改回去，落定复核要拿它跟当前实际档位比，
            // 而不是信 qualityDone 这个标志位（标志位不会自己变回 false）
            this.targetText = text;

            if (this.isCurrentQuality(text)) {
                this.qualityDone = true;
                return true;
            }

            $(el).click();
            this.qualityDone = await this.waitForQuality(this.targetText, 6000);

            // 兜底只看「有没有画面」：UI 标签认了不算数，黑屏时它是照样变的。
            // 这里不做「降档再试」—— 实测黑屏之后点任何一档都恢复不了
            // （连 iEnable=1 的蓝光8M 也起不来），连点只会浪费时间并刷一堆警告。
            if (this.videoAlive()) {
                this.qualityDone = true;
                return true;
            }
            this.qualityDone = false;
            warn(
                `quality：切到「${this.targetText}」之后还没有画面（可能仍在重抓流）。` +
                    '若这一档是「扫码即享」而你未扫码，站侧不会下发流，需要刷新或先扫码解锁。'
            );
            return false;
        }

        

        // body 上的 mode-page-theater 与按钮 class 是同步的（实测进出各 3 次都一致），
        // 两个信号交叉验证，任一成立即认为影院开着
        isTheaterOn() {
            if (/mode-page-theater/.test(document.body.className || '')) return true;
            const $ = page$();
            if ($) {
                const $btn = $(SEL.theaterBtn);
                if ($btn.length && $btn.hasClass(SEL.theaterOn)) return true;
            }
            const btn = queryOne(SEL.theaterBtn);
            return !!(btn && btn.classList.contains(SEL.theaterOn));
        }

        async enterTheater() {
            if (!this.settings.autoTheater) return true;
            // 自动进观影只在进入页面的最初几秒负责一次：进成就置 theaterDone，
            // 之后（落定复核 / 换画质补跑）都不再点它，用户手动退出也就不会被拽回去
            if (this.theaterDone) return true;
            if (this.isTheaterOn()) {
                this.theaterDone = true;
                return true;
            }
            const $ = page$();
            if (!$) return false;

            const btn = await waitFor(() => queryOne(SEL.theaterBtn), {
                timeout: 4000,
                interval: 300,
                label: 'theater btn'
            })
                .then(() => queryOne(SEL.theaterBtn))
                .catch(() => null);
            if (!btn) return false;
            if (this.isTheaterOn()) {
                this.theaterDone = true;
                return true;
            }

            if ($) $(btn).click();
            else btn.click();
            // 切影院要重建播放器，等固定 350ms 常常判成没切上，这里等真生效
            this.theaterDone = await waitFor(() => this.isTheaterOn(), {
                timeout: 6000,
                interval: 250,
                label: 'theater on'
            })
                .then(() => true)
                .catch(() => false);
            if (this.theaterDone) log('theater ok');
            else warn('theater click did not stick');
            return this.theaterDone;
        }

        // 两样是否真的都到位了。画质要比当前实际档位，不能只看 qualityDone 标志位，
        // 站点把画质改回去时那个标志位仍是 true。
        settled() {
            // 观影只看 theaterDone：进过一次就算完成，之后不再维持；画质要比当前实际档位
            // 两样是否真的都到位了。画质要比当前实际档位，不能只看 qualityDone 标志位，
            // 站点把画质改回去时那个标志位仍是 true。
            const theaterOk = !this.settings.autoTheater || this.theaterDone;
            const qualityOk = this.targetText ? this.isCurrentQuality(this.targetText) : this.qualityDone;
            return theaterOk && qualityOk;
        }

        // 一轮尝试：等就绪 → 解锁 → 切清晰度 → 进影院
        async attempt() {
            if (!page$()) return false;
            // 没起播就切清晰度必然失败，起播前清晰度列表只是占位的
            if (!this.isPlayerReady()) {
                if (this.hasVideoElement()) {
                    await waitFor(() => this.isPlayerReady(), {
                        timeout: 15000,
                        interval: 500,
                        label: 'player ready'
                    }).catch(() => null);
                } else if (!this.warnedNoVideo) {
                    this.warnedNoVideo = true;
                    warn('player not streaming：页面里没有 video 元素，可能不是视频直播间，跳过清晰度与影院');
                }
            }
            // 等真实清晰度列表：起播前那份只有「超清|高清」，拿去解析目标只会锁死在超清
            await waitFor(() => this.realQualityList(), {
                timeout: 8000,
                interval: 400,
                label: 'quality list'
            }).catch(() => null);

            this.unlockQuality();
            try {
                await this.switchQuality();
            } catch (e) {
                warn('switchQuality', e);
            }
            await sleep(600);
            await this.enterTheater();
            return this.settled();
        }

        async run() {
            if (this.running) return;
            this.running = true;
            try {
                // 超时不该把整个 run 带走，交给下面的循环继续重试
                await waitForJQuery(15000).catch(() => warn('jQuery not ready, 继续重试'));

                // 重试必须收在 run 内部。之前是靠 watchdog 的 20 个 tick，
                // 而一轮 attempt 自己就要十几秒，tick 在真正重试之前就被耗光了：
                // 播放器起得慢时第一轮还在跑，定时器就已经 clearInterval 放弃。
                // 次数用 MAX_TRIES，墙钟只是兜底（单轮太长时提前收手）。
                const until = Date.now() + PLAYER_RETRY_BUDGET;
                let rounds = 0;
                while (rounds < MAX_TRIES) {
                    rounds += 1;
                    if (await this.attempt()) break;
                    if (Date.now() >= until) break;
                    await sleep(PLAYER_RETRY_GAP);
                }

                log('done', {
                    轮数: rounds,
                    quality: this.selectedQualityText() || this.currentQualityText(),
                    theater: this.theaterDone,
                    qualityDone: this.qualityDone
                });
                this.scheduleSettleCheck();
            } catch (e) {
                warn('run error', e);
            } finally {
                this.running = false;
            }
        }

        // 起播后站侧可能把画质改回默认，落定后再核几轮，掉了就补一轮。
        // run() 结尾还会再排一次复核，不封顶就变成「复核→重跑→再复核」的无限链。
        scheduleSettleCheck() {
            this.clearSettleTimers();
            if (this.settleFixes >= PLAYER_SETTLE_MAX_FIX) return;
            for (const d of PLAYER_SETTLE_DELAYS) {
                const id = setTimeout(() => {
                    this.settleTimers.splice(this.settleTimers.indexOf(id), 1);
                    if (this.running) return;
                    if (!this.settled()) {
                        this.settleFixes += 1;
                        warn(
                            `settle check：画质或影院没保住，补一轮（${this.settleFixes}/${PLAYER_SETTLE_MAX_FIX}）`,
                            {
                                当前画质: this.selectedQualityText() || this.currentQualityText(),
                                目标画质: this.targetText || '-',
                                影院: this.isTheaterOn()
                            }
                        );
                        this.run();
                    }
                }, d);
                this.settleTimers.push(id);
            }
        }

        clearSettleTimers() {
            this.settleTimers.forEach((id) => clearTimeout(id));
            this.settleTimers = [];
        }

        startWatchdog() {
            setTimeout(() => this.run(), 800);

            // 只负责换房间后重来；轮询式重试已经收进 run() 内部按墙钟时间做了
            const onNav = () => {
                this.theaterDone = false;
                this.qualityDone = false;
                this.targetText = '';
                this.settleFixes = 0;
                this.warnedNoVideo = false;
                this.clearSettleTimers();
                setTimeout(() => this.run(), 900);
            };
            window.addEventListener('popstate', onNav);

            let href = location.href;
            let p = 0;
            const nav = setInterval(() => {
                p += 1;
                if (p > 75) {
                    clearInterval(nav);
                    return;
                }
                if (location.href !== href) {
                    href = location.href;
                    onNav();
                }
            }, 4000);
        }

        updateSettings(s) {
            this.settings = s;
        }
    }

    // ---------- settings UI ----------
    class SettingsUI {
        constructor(optimizer, settings, onChange) {
            this.optimizer = optimizer;
            this.settings = settings;
            this.onChange = onChange;
            this.panel = null;
            this.backdrop = null;
        }

        injectButton() {
            if (document.getElementById('hlo-settings-btn')) return true;
            const noble = queryOne(SEL.nobleBtn);
            const ul = noble?.closest('ul') || queryOne(SEL.giftRightUl);
            if (!ul) return false;

            const btn = document.createElement('li');
            btn.id = 'hlo-settings-btn';
            btn.title = '虎牙直播优化器 设置（全站）';
            btn.innerHTML = `<i>${optimizerIconSvg()}</i><p>设置</p>`;
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggle(btn);
            });
            if (noble && noble.parentElement === ul) noble.insertAdjacentElement('afterend', btn);
            else ul.appendChild(btn);
            return true;
        }

        watchButton() {
            if (this.injectButton()) return;
            let n = 0;
            const t = setInterval(() => {
                n += 1;
                if (this.injectButton() || n > 25) clearInterval(t);
            }, 1800);
        }

        close() {
            if (this.themeMq && this.themeMqHandler) {
                try {
                    if (typeof this.themeMq.removeEventListener === 'function') {
                        this.themeMq.removeEventListener('change', this.themeMqHandler);
                    } else if (typeof this.themeMq.removeListener === 'function') {
                        this.themeMq.removeListener(this.themeMqHandler);
                    }
                } catch (e) {
                }
            }
            this.themeMq = null;
            this.themeMqHandler = null;
            this.panel?.remove();
            this.backdrop?.remove();
            this.panel = null;
            this.backdrop = null;
        }

        toggle(anchor) {
            if (this.panel) this.close();
            else this.open(anchor);
        }

        open(anchor) {
            this.close();

            const backdrop = document.createElement('div');
            backdrop.id = 'hlo-settings-backdrop';
            backdrop.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            });
            document.body.appendChild(backdrop);
            this.backdrop = backdrop;

            const panel = document.createElement('div');
            panel.id = 'hlo-settings-panel';
            panel.innerHTML = this.formHtml();
            ['mousedown', 'mouseup', 'click', 'contextmenu', 'wheel'].forEach((type) => {
                panel.addEventListener(type, (e) => e.stopPropagation());
            });
            document.body.appendChild(panel);
            this.panel = panel;
            this.applyTheme(panel, this.settings.themeMode);

            const rect = anchor?.getBoundingClientRect?.() || {
                left: window.innerWidth - 320,
                top: window.innerHeight - 160
            };
            const w = 280;
            const h = panel.offsetHeight || 280;
            const left = Math.min(Math.max(8, rect.left - w + 40), window.innerWidth - w - 8);
            let top = Math.max(8, (rect.top || 0) - h - 12);
            if (top < 8) top = Math.min((rect.bottom || 100) + 12, window.innerHeight - h - 8);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;

            this.bind(panel);
        }

        formHtml() {
            const current = this.settings.targetQuality || QUALITY_AUTO;
            const opts = [QUALITY_AUTO, ...STANDARD_QUALITIES]
                .map((q) => {
                    const label = q === QUALITY_AUTO ? '最高画质（默认）' : q;
                    const sel = q === current ? ' selected' : '';
                    return `<option value="${escapeHtml(q)}"${sel}>${escapeHtml(label)}</option>`;
                })
                .join('');
            const mode = THEME_MODES.includes(this.settings.themeMode) ? this.settings.themeMode : 'auto';
            const icons = THEME_MODES.map((m) =>
                `<svg data-mode="${m}" data-active="${m === mode ? '1' : '0'}" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">${THEME_ICON[m].replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`
            ).join('');
            return `
                <div class="hlo-head">
                    <h3>虎牙直播优化器</h3>
                    <div class="hlo-head-right">
                        <button type="button" id="hlo-theme" title="整站配色：${THEME_LABEL[mode]}（点击切换，影响整个虎牙页面）">${icons}</button>
                    </div>
                </div>
                <div class="field">
                    <div class="field-label">默认画质（全站生效）</div>
                    <select id="hlo-quality-select">${opts}</select>
                    <div class="hint">自动解锁画质列表里所有「扫码即享」的档位，再切到所选画质；房间没有该档时回落到最高可用档。</div>
                </div>
                <label class="row"><input type="checkbox" id="hlo-theater" ${this.settings.autoTheater ? 'checked' : ''}/> 自动进入观影模式</label>
                <label class="row"><input type="checkbox" id="hlo-plus1" ${this.settings.enableScreenPlusOne !== false ? 'checked' : ''}/> 画面弹幕悬浮 +1 复读</label>
                <label class="row"><input type="checkbox" id="hlo-history" ${this.settings.enableDanmakuHistory !== false ? 'checked' : ''}/> 弹幕输入框上下键翻历史</label>
                <label class="row"><input type="checkbox" id="hlo-fans-badge" ${this.settings.enableFansBadge !== false ? 'checked' : ''}/> 自动切最高档弹幕颜色</label>
                <label class="row"><input type="checkbox" id="hlo-fans-checkin" ${this.settings.enableFansCheckIn !== false ? 'checked' : ''}/> 自动打卡名下全部粉丝团</label>
                <div class="actions">
                    <button type="button" class="btn-ghost" id="hlo-close">关闭</button>
                    <button type="button" class="btn-primary" id="hlo-save">保存并应用</button>
                </div>
                <div class="credits">
                    <div class="ver">v${escapeHtml(VERSION)}</div>
                    <div>Powered by <a href="https://mks155.github.io" target="_blank" rel="noopener noreferrer">mks155</a></div>
                </div>
            `;
        }

        resolveTheme(mode) {
            if (mode === 'light' || mode === 'dark') return mode;
            try {
                return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            } catch (e) {
                return 'dark';
            }
        }

        applyTheme(panel, mode) {
            const resolved = this.resolveTheme(mode);
            // 整站生效：在 html 上挂/摘 class，样式表随之增删
            const root = document.documentElement;
            if (root) root.classList.toggle('hlo-dark', resolved === 'dark');
            ensureSiteDarkStyle(resolved === 'dark');
            // 面板自身也跟着走（面板是 body 直系子节点，会被整站规则扫到，
            // 这里显式同步一份，保证它在任何模式下都一致）
            if (panel) panel.dataset.theme = resolved;
            if (mode !== 'auto' || this.themeMq) return;
            try {
                this.themeMq = window.matchMedia('(prefers-color-scheme: dark)');
                this.themeMqHandler = () => this.applyTheme(panel, 'auto');
                if (typeof this.themeMq.addEventListener === 'function') {
                    this.themeMq.addEventListener('change', this.themeMqHandler);
                } else if (typeof this.themeMq.addListener === 'function') {
                    this.themeMq.addListener(this.themeMqHandler);
                }
            } catch (e) {
            }
        }

        /** 切主题：立即生效并落盘（配色是纯显示偏好，不等「保存并应用」） */
        cycleTheme(panel) {
            const cur = THEME_MODES.includes(this.settings.themeMode) ? this.settings.themeMode : 'auto';
            const next = THEME_MODES[(THEME_MODES.indexOf(cur) + 1) % THEME_MODES.length];
            this.settings.themeMode = next;
            saveSettings(this.settings);
            panel.querySelectorAll('#hlo-theme svg[data-mode]').forEach((svg) => {
                svg.dataset.active = svg.dataset.mode === next ? '1' : '0';
            });
            const btn = panel.querySelector('#hlo-theme');
            if (btn) btn.title = `整站配色：${THEME_LABEL[next]}（点击切换，影响整个虎牙页面）`;
            this.applyTheme(panel, next);
            log('theme ->', next);
        }

        bind(panel) {
            panel.querySelector('#hlo-close')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });

            panel.querySelector('#hlo-theme')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.cycleTheme(panel);
            });

            panel.querySelector('#hlo-save')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                this.settings = {
                    targetQuality: panel.querySelector('#hlo-quality-select')?.value ?? QUALITY_AUTO,
                    autoTheater: !!panel.querySelector('#hlo-theater')?.checked,
                    enableScreenPlusOne: !!panel.querySelector('#hlo-plus1')?.checked,
                    enableDanmakuHistory: !!panel.querySelector('#hlo-history')?.checked,
                    enableFansBadge: !!panel.querySelector('#hlo-fans-badge')?.checked,
                    enableFansCheckIn: !!panel.querySelector('#hlo-fans-checkin')?.checked,
                    themeMode: THEME_MODES.includes(this.settings.themeMode) ? this.settings.themeMode : 'auto'
                };
                saveSettings(this.settings);
                this.onChange(this.settings);
                this.optimizer.updateSettings(this.settings);
                try {
                    this.optimizer.unlockQuality();
                    await this.optimizer.switchQuality();
                    if (this.settings.autoTheater && !this.optimizer.isTheaterOn()) {
                        this.optimizer.theaterDone = false;
                        await this.optimizer.enterTheater();
                    }
                } catch (err) {
                    warn('apply', err);
                }
                this.close();
                log('settings saved', this.settings);
            });
        }
    }

    // ---------- 画面弹幕 +1：轻量文本冻结层 ----------
    class ScreenPlusOne {
        constructor(settings) {
            this.settings = settings;
            this.overlay = null;
            this.ghost = null;
            this.bound = false;
            this.wrap = null;
            this.lastShow = 0;
            this.pendingItem = null;
            this.throttleTimer = 0;
            this.watchTimer = 0;
            this.lastPoint = null;
            this.barRect = null;
            this.holdUntil = 0;
        }

        update(settings) {
            this.settings = settings;
            if (settings.enableScreenPlusOne === false) this.clear();
        }

        enabled() {
            // 举报时官方黑条接管，短时间内别再弹冻结条去盖它
            return this.settings.enableScreenPlusOne !== false && Date.now() >= this.holdUntil;
        }

        inBar(p) {
            const r = this.barRect;
            return !!p && !!r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
        }

        clear() {
            if (this.watchTimer) {
                clearInterval(this.watchTimer);
                this.watchTimer = 0;
            }
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
            }
            if (this.ghost) {
                this.ghost.style.visibility = '';
                delete this.ghost.dataset.hloGhost;
                this.ghost = null;
            }
            this.barRect = null;
            this.lastPoint = null;
            this.pendingItem = null;
        }

        show(item, pt) {
            if (!this.enabled()) return;
            if (this.ghost === item) return;

            const now = Date.now();
            if (now - this.lastShow < 80) {
                this.pendingItem = { item, pt };
                if (!this.throttleTimer) {
                    this.throttleTimer = setTimeout(() => {
                        this.throttleTimer = 0;
                        const p = this.pendingItem;
                        if (p && document.body.contains(p.item)) this.show(p.item, p.pt);
                    }, 80);
                }
                return;
            }
            this.lastShow = now;
            this.clear();

            const text = extractDanmuText(item);
            if (!text) return;

            const rect = item.getBoundingClientRect();
            if (rect.width < 4 || rect.height < 4) return;

            const wrap = document.createElement('div');
            wrap.id = 'hlo-danmu-freeze';

            const label = document.createElement('div');
            label.className = 'hlo-freeze-text';
            label.textContent = text;
            wrap.appendChild(label);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hlo-plus1';
            btn.textContent = '+1';
            btn.title = '我也发一条（可连点）';
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const value = extractDanmuText(this.ghost) || text;
                if (this.enabled()) sendDanmaku(value);
            });
            wrap.appendChild(btn);

            // 原始文案只认一次：连点时若拿当前文字当「原文」，
                // 第二个定时器会把「已复制」还原回去，按钮就永久卡在提示语上。
                const flash = (el, txt, ms) => {
                    const origin = el.dataset.hloLabel || el.textContent;
                    el.dataset.hloLabel = origin;
                    el.textContent = txt;
                    el.disabled = true;
                    clearTimeout(el._hloFlash);
                    el._hloFlash = setTimeout(() => {
                        el.textContent = origin;
                        el.disabled = false;
                    }, ms);
                };

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'hlo-dmbtn';
            copyBtn.textContent = '复制';
            copyBtn.title = '复制这条弹幕';
            copyBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            copyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                flash(copyBtn, copyText(extractDanmuText(this.ghost) || text) ? '已复制' : '复制失败', 1200);
            });
            wrap.appendChild(copyBtn);

            const reportBtn = document.createElement('button');
            reportBtn.type = 'button';
            reportBtn.className = 'hlo-dmbtn hlo-dmbtn-report';
            reportBtn.textContent = '举报';
            reportBtn.title = '举报这条弹幕';
            reportBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            reportBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                reportBtn.disabled = true;
                const item = this.ghost;
                const r = await reportDanmu(item);
                if (r.ok) {
                    // 官方黑条已经接管，撤掉冻结条免得盖住它，并按住别马上又冒出来
                    log('举报入口已交给官方', r.via);
                    this.clear();
                    this.holdUntil = Date.now() + 2000;
                } else {
                    warn('举报失败：' + r.reason);
                    flash(reportBtn, '举报失败', 1400);
                }
            });
            wrap.appendChild(reportBtn);

            document.body.appendChild(wrap);

            const bw = wrap.offsetWidth || 120;
            const bh = wrap.offsetHeight || 28;
            let left = rect.left;
            let top = rect.top + rect.height / 2 - bh / 2;
            if (left + bw > window.innerWidth - 8) {
                left = Math.max(8, window.innerWidth - bw - 8);
            }
            top = Math.min(Math.max(8, top), window.innerHeight - bh - 8);
            wrap.style.left = `${left}px`;
            wrap.style.top = `${top}px`;

            item.style.visibility = 'hidden';
            item.dataset.hloGhost = '1';
            this.ghost = item;
            this.overlay = wrap;
            this.lastPoint = pt || null;
            this.barRect = { left, top, right: left + bw, bottom: top + bh };

            wrap.addEventListener('mouseleave', () => {
                setTimeout(() => {
                    if (this.overlay !== wrap || wrap.matches(':hover')) return;
                    this.clear();
                }, 100);
            });

            this.watch();
        }

        watch() {
            if (this.watchTimer) return;
            this.watchTimer = setInterval(() => {
                if (!this.overlay) {
                    clearInterval(this.watchTimer);
                    this.watchTimer = 0;
                    return;
                }
                if (!this.ghost || !this.ghost.isConnected) {
                    this.clear();
                    return;
                }
                if (this.lastPoint && !this.inBar(this.lastPoint)) this.clear();
            }, 400);
        }

        bind() {
            if (this.bound) return;
            this.bound = true;

            this.onOver = (e) => {
                if (!this.enabled()) return;
                const t = e.target;
                if (!t || t.nodeType !== 1) return;
                if (t.closest?.('#hlo-danmu-freeze')) return;
                const item = closestDanmuItem(t);
                if (!item || item === this.ghost || item.dataset.hloGhost) return;
                const pt = { x: e.clientX, y: e.clientY };
                if (this.inBar(pt)) return;
                this.show(item, pt);
            };

            const attach = () => {
                const wrap = queryOne(SEL.danmuWrap);
                if (!wrap) return false;
                if (this.wrap === wrap) return true;
                if (this.wrap) this.wrap.removeEventListener('mouseover', this.onOver, true);
                this.wrap = wrap;
                wrap.addEventListener('mouseover', this.onOver, { capture: true, passive: true });
                return true;
            };

            if (!attach()) {
                let n = 0;
                const t = setInterval(() => {
                    n += 1;
                    if (attach() || n > 60) clearInterval(t);
                }, 1000);
            }

            // 指针坐标离开冻结条矩形就复原（隐藏的原弹幕不再派发事件）
            document.addEventListener(
                'mousemove',
                (e) => {
                    if (!this.overlay) return;
                    this.lastPoint = { x: e.clientX, y: e.clientY };
                    if (!this.inBar(this.lastPoint)) this.clear();
                },
                { capture: true, passive: true }
            );

            document.addEventListener(
                'mouseout',
                (e) => {
                    if (this.overlay && !e.relatedTarget) this.clear();
                },
                { capture: true, passive: true }
            );
            document.documentElement.addEventListener('mouseleave', () => this.clear());
            window.addEventListener('blur', () => this.clear());
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this.clear();
            });

            window.addEventListener(
                'scroll',
                () => {
                    if (this.overlay) this.clear();
                },
                { passive: true }
            );
        }
    }

    // ---------- 发送 / 历史 ----------
    const historyStore = {
        list: loadHistory(),
        index: -1,
        draft: '',
        push(text) {
            const v = (text || '').trim();
            if (!v) return;
            if (this.list[this.list.length - 1] === v) {
                this.index = -1;
                this.draft = '';
                return;
            }
            this.list.push(v);
            if (this.list.length > MAX_HISTORY) this.list = this.list.slice(-MAX_HISTORY);
            saveHistory(this.list);
            this.index = -1;
            this.draft = '';
        }
    };

    function sendDanmaku(text) {
        const value = (text || '').trim();
        if (!value) return false;
        const input = findDanmakuInput();
        if (!input) {
            warn('input not found');
            return false;
        }
        input.focus();
        setNativeValue(input, value);
        setTimeout(() => {
            const btn = findSendBtn();
            const $ = page$();
            if (btn) {
                if ($) $(btn).click();
                else btn.click();
            } else {
                input.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })
                );
            }
            historyStore.push(value);
        }, 40);
        return true;
    }

    class DanmakuHistory {
        constructor(settings) {
            this.settings = settings;
            this.bound = false;
        }

        update(s) {
            this.settings = s;
        }

        isInput(el) {
            if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable)) {
                return false;
            }
            if (
                el.closest('.chat-room__input') ||
                el.closest('.chat-speaker') ||
                el.id === 'pub_msg_input'
            ) {
                return true;
            }
            return findDanmakuInput() === el;
        }

        caretEnd(el) {
            try {
                if (el.isContentEditable) {
                    const r = document.createRange();
                    r.selectNodeContents(el);
                    r.collapse(false);
                    const s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(r);
                } else if (el.setSelectionRange) {
                    const n = el.value.length;
                    el.setSelectionRange(n, n);
                }
                el.focus();
            } catch (e) {
            }
        }

        bind() {
            if (this.bound) return;
            this.bound = true;

            document.addEventListener(
                'keydown',
                (e) => {
                    if (this.settings.enableDanmakuHistory === false) return;
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    const input = e.target;
                    if (!this.isInput(input) || e.isComposing || input.composing) return;
                    if (!historyStore.list.length) return;

                    e.preventDefault();
                    e.stopPropagation();

                    if (e.key === 'ArrowUp') {
                        if (historyStore.index === -1) {
                            historyStore.draft = readInputValue(input);
                            historyStore.index = historyStore.list.length - 1;
                        } else if (historyStore.index > 0) {
                            historyStore.index -= 1;
                        }
                    } else {
                        if (historyStore.index === -1) return;
                        if (historyStore.index < historyStore.list.length - 1) {
                            historyStore.index += 1;
                        } else {
                            historyStore.index = -1;
                            setNativeValue(input, historyStore.draft);
                            this.caretEnd(input);
                            return;
                        }
                    }
                    setNativeValue(input, historyStore.list[historyStore.index] || '');
                    this.caretEnd(input);
                },
                true
            );

            const capture = () => {
                if (this.settings.enableDanmakuHistory === false) return;
                historyStore.push(readInputValue(findDanmakuInput()));
            };
            document.addEventListener(
                'click',
                (e) => {
                    if (e.target.closest?.('#msg_send_bt, .btn-sendMsg')) capture();
                },
                true
            );
            document.addEventListener(
                'keydown',
                (e) => {
                    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
                    if (this.isInput(e.target)) capture();
                },
                true
            );
        }
    }

// ---------- 粉丝团：弹幕颜色 + 打卡 ----------
    // 打卡直接走站侧 WUP，不开面板、不点界面：
    //   读 wupui/getFansSign  → FansSignInfo{iPos, lPosTime, lSignInFlag}
    //   写 wupui/setFansSign  → iCode===0 成功，否则 sMsg 是站侧原因（如「请勿重复打卡」）
    // 当天是否已打卡是位掩码：1 << (iPos - 1) & lSignInFlag
    // 记「今天已经扫过一遍粉丝团」，避免刷新页面就重来一轮
    const SWEEP_DAY_KEY = NS + ':fansSweepDay';

    // TTP.ready 的回调里才有 taf 结构体和 userId；sendWup2 第 4 参是回调不是 Rsp 构造器
    function wupCall(module, action, buildReq, timeout = 8000) {
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn, v) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                fn(v);
            };
            const timer = setTimeout(
                () => finish(reject, new Error(action + ' 超时')),
                timeout
            );
            try {
                const TTP = unsafeWindow.TTP || window.TTP;
                if (!TTP || typeof TTP.ready !== 'function') {
                    return finish(reject, new Error('TTP 不可用'));
                }
                TTP.ready((t) => {
                    try {
                        const req = buildReq(t);
                        t.sendWup2(module, action, req, (rsp) => {
                            if (!rsp) return finish(reject, new Error('无响应'));
                            // 不是每个 Rsp 都带 iCode（如 queryBadgeInfoList 只有 vBadgeInfo），
                            // 只有带了才校验，否则会把成功响应误判成失败
                            if ('iCode' in rsp && rsp.iCode !== 0) {
                                return finish(reject, new Error(rsp.sMsg || 'iCode ' + rsp.iCode));
                            }
                            finish(resolve, rsp);
                        });
                    } catch (e) {
                        finish(reject, e);
                    }
                });
            } catch (e) {
                finish(reject, e);
            }
        });
    }

    function fansSignApi(action, ReqName, pid, timeout = 8000) {
        return wupCall(
            'wupui',
            action,
            (t) => {
                const Req = t?.taf?.HUYA?.[ReqName];
                if (!Req) throw new Error('结构体缺失 ' + ReqName);
                const req = new Req();
                req.tId = t.userId;
                req.lPid = pid;
                return req;
            },
            timeout
        );
    }

    // 「我的全部粉丝团」：BadgeInfoListRsp.vBadgeInfo.value 是 Vector，
    // 真实数组在 .value 上（数 Object.keys 会恒等于 2）。
    // 每条的 lBadgeId 就是主播 uid，正好是 setFansSign 要的 lPid。
    function myFansClubs(timeout = 10000) {
        return wupCall(
            'liveui',
            'queryBadgeInfoList',
            (t) => {
                const Req = t?.taf?.HUYA?.BadgeInfoListReq;
                if (!Req) throw new Error('结构体缺失 BadgeInfoListReq');
                const req = new Req();
                req.tUserId = t.userId;
                return req;
            },
            timeout
        ).then((rsp) => {
            const v = rsp.vBadgeInfo;
            const arr = v && Array.isArray(v.value) ? v.value : [];
            return arr
                .map((b) => ({
                    pid: Number(b.lBadgeId),
                    name: b.sBadgeName || '',
                    nick: b.sPresenterNickName || '',
                    level: Number(b.iBadgeLevel) || 0,
                    rank: Number(b.iRank) || 0
                }))
                .filter((b) => b.pid > 0);
        });
    }

    // 单个粉丝团打卡，返回 'done' | 'ok' | 错误文案
    async function checkInOne(pid) {
        const state = await fansSignApi('getFansSign', 'GetFansSignReq', pid);
        const sign = state && state.tSign;
        if (!sign) throw new Error('拿不到打卡状态');
        if (1 << (sign.iPos - 1) & sign.lSignInFlag) return 'done';
        await fansSignApi('setFansSign', 'FansSignReq', pid);
        return 'ok';
    }

    // 必须用页面 realm 的 MouseEvent：沙箱构造器页面收不到且失败静默
    function fireMouse(el, type, init = {}) {
        if (!el) return false;
        const doc = el.ownerDocument || document;
        const view = doc.defaultView || unsafeWindow;
        const Ctor = (view && view.MouseEvent) || MouseEvent;
        let ev;
        try {
            ev = new Ctor(type, { bubbles: false, cancelable: false, view, ...init });
        } catch (e) {
            ev = doc.createEvent('MouseEvents');
            ev.initMouseEvent(type, false, false, view, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
        }
        el.dispatchEvent(ev);
        return true;
    }

    // 官方弹幕颜色条目的 handler。两套实现的字段名不一样：
    //   粉丝团 RoomFanBarrageColor → onClick
    //   赛事   barrageColorClub     → onPick
    // 都是零参数、直接写 barrageColor.customColor.set，不吃 React 合成事件对象，
    // 所以不能复用 reactClick 造的事件。找不到 fiber 就返回 false 让调用方退回 DOM click。
    function callOfficialBarrageHandler(el) {
        if (!el) return false;
        const key = Object.keys(el).find((k) => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$'));
        if (!key) return false;
        let fiber = el[key];
        let depth = 0;
        while (fiber && depth < 5) {
            const props = fiber.memoizedProps || {};
            const fn = props.onPick || props.onClick;
            // fn.length === 0：带参数的是 React 的合成事件包装，说明找错了层
            if (typeof fn === 'function' && fn.length === 0) {
                try {
                    fn();
                    return true;
                } catch (e) {
                    warn('官方弹幕颜色 handler 调用出错', e);
                    return false;
                }
            }
            fiber = fiber.return;
            depth += 1;
        }
        return false;
    }

    /** 直接调用元素 React fiber 上的 onClick（派发鼠标事件无效，只能这么走） */
    function reactClick(el) {
        if (!el) return false;
        const key = Object.keys(el).find((k) => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$'));
        if (!key) return false;
        let fiber = el[key];
        let depth = 0;
        while (fiber && depth < 6) {
            const props = fiber.memoizedProps || {};
            const fn = props.onClick || props.onMouseDown || props.onPointerDown;
            if (typeof fn === 'function') {
                try {
                    fn({
                        type: 'click',
                        preventDefault() {},
                        stopPropagation() {},
                        isDefaultPrevented: () => false,
                        isPropagationStopped: () => false,
                        bubbles: true,
                        cancelable: true,
                        currentTarget: el,
                        target: el,
                        nativeEvent: { isTrusted: true, stopPropagation() {}, preventDefault() {} }
                    });
                    return true;
                } catch (e) {
                    warn('reactClick 调用出错', e);
                    return false;
                }
            }
            fiber = fiber.return;
            depth += 1;
        }
        return false;
    }

    // ---------- 弹幕颜色 ----------
    // 官方档位是写死的常量表（chat/barrageColor.js）：
    //   六档按徽章等级 T=[1,3,6,10,14,18]，颜色固定 66FF99/CCFF66/22CECE/FF706E/FF66FF/FFCC00；
    //   另有「粉丝打卡」(85C4FF)、「超粉」(FF6699)、「超粉Plus」(AA68FF)。
    // 只按徽章等级挑档：「粉丝打卡」档不进表（barrageColorRank 查不到 → rank -1 → 被过滤），
    // 它靠今天打过卡才解锁，不是等级档位，不该由脚本替用户挑。
    const BARRAGE_RANKS = {
        超粉Plus: 100,
        超粉: 90,
        Lv18: 70,
        Lv14: 60,
        Lv10: 50,
        Lv6: 40,
        Lv3: 30,
        Lv1: 20
        // 官方第一档是「不染色」(colorDefault)，rank 0，不参与挑最高档
    };

    function barrageColorRank(label) {
        const key = String(label || '').trim();
        return Object.prototype.hasOwnProperty.call(BARRAGE_RANKS, key) ? BARRAGE_RANKS[key] : -1;
    }

    // 锁定档的 innerText 形如「Lv1414级粉丝福」「Lv1818级粉丝福」
    // 「超粉超粉福利该弹幕颜」，前缀就是 BARRAGE_RANKS 的键，取最长匹配的那个
    function stripBarrageHint(label) {
        const text = String(label || '').trim();
        let best = '';
        for (const key of Object.keys(BARRAGE_RANKS)) {
            if (text.startsWith(key) && key.length > best.length) best = key;
        }
        return best || text;
    }

    class FansBadge {
        constructor(settings) {
            this.settings = settings;
            this.bound = false;
            this.timers = [];
            this.lastRoom = null;
            this.busy = false;
            this.sweeping = false;
            // 有些房间（如赛事官方直播间）没有粉丝团，只有勋章/VIP 的彩色弹幕。
            // 这里按房间记忆能力：null=未知，探明为 false 后本房间不再尝试也不刷警告。
            this.capRoom = null;
            this.cap = { barrage: null, clubPanel: null };
            this.capMiss = { barrage: 0, clubPanel: 0 };
        }

        caps() {
            const room = this.roomUid();
            if (this.capRoom !== room) {
                this.capRoom = room;
                this.cap = { barrage: null, clubPanel: null };
                this.capMiss = { barrage: 0, clubPanel: 0 };
            }
            return this.cap;
        }

        hasCap(key) {
            return this.caps()[key] !== false;
        }

        // 返回 true = 本房间没这个功能，调用方应安静收手；false = 还会再试
        capFailed(key, warnMsg, giveUpMsg) {
            const c = this.caps();
            if (c[key] === false) return true;
            this.capMiss[key] = (this.capMiss[key] || 0) + 1;
            if (this.capMiss[key] < MAX_TRIES) {
                // 只在第一次提醒，之后安静重试，否则会刷屏
                if (this.capMiss[key] === 1) warn(warnMsg);
                return false;
            }
            c[key] = false;
            log(giveUpMsg, this.capSummary());
            return true;
        }

        capOk(key) {
            this.caps()[key] = true;
            this.capMiss[key] = 0;
        }

        capSummary() {
            const c = this.caps();
            const s = (v) => (v === false ? '无' : v ? '有' : '未知');
            return { 弹幕颜色: s(c.barrage), 粉丝团面板: s(c.clubPanel) };
        }

        update(s) {
            const wasOff = this.settings.enableFansBadge === false && this.settings.enableFansCheckIn === false;
            this.settings = s;
            const nowOff = s.enableFansBadge === false && s.enableFansCheckIn === false;
            if (nowOff) {
                this.clearTimers();
            } else if (wasOff && this.bound) {
                // 之前全关掉了、timer 已被清空，重新勾上必须重新排程，否则要刷新页面才恢复
                this.arm();
            }
        }

        clearTimers() {
            this.timers.forEach((t) => clearTimeout(t));
            this.timers = [];
        }

        roomUid() {
            const a = queryOne('#J_roomHeader a.host-pic, a.host-pic, a[href*="/video/u/"]');
            const m = (a?.getAttribute?.('href') || '').match(/\/video\/u\/(\d+)/);
            if (m) return m[1];
            try {
                const rd = unsafeWindow.TT_ROOM_DATA || {};
                const v = rd.id || rd.channel || rd.profileRoom;
                return v ? String(v) : '';
            } catch (e) {
                return '';
            }
        }

        arm() {
            this.clearTimers();
            this.lastRoom = this.roomUid();
            if (!this.lastRoom) {
                warn('fansbadge: 识别不到当前主播，跳过本轮');
                return;
            }
            const room = this.lastRoom;
            if (this.settings.enableFansBadge !== false) {
                let tries = 0;
                const attempt = async () => {
                    if (this.roomUid() !== room) return;
                    if (!this.hasCap('barrage')) {
                        log('fansbadge: 本房间没有弹幕颜色功能，跳过', this.capSummary());
                        return;
                    }
                    tries += 1;
                    // 达成就收手，不重跑 —— 之前每轮都重切一次，用户看到颜色被反复设置
                    if (await this.applyBarrageColor()) {
                        log('fansbadge: 弹幕颜色已就绪', { 尝试次数: tries, ...this.capSummary() });
                        return;
                    }
                    if (tries >= MAX_TRIES) {
                        warn('fansbadge: 重试到上限仍未就绪', { 尝试次数: tries, ...this.capSummary() });
                        return;
                    }
                    this.timers.push(setTimeout(attempt, FANS_BADGE_RETRY));
                };
                this.timers.push(setTimeout(attempt, FANS_BADGE_DELAY));
            }
            if (this.settings.enableFansCheckIn !== false) {
                this.timers.push(
                    setTimeout(() => {
                        if (this.roomUid() !== room) return;
                        // 打卡走接口，不再需要 FAN_CLUB_OPEN，
                        // 所以赛事房间也不会被顶出「赛事VIP」广告面板；
                        // 是不是真粉丝团由服务端 iCode/sMsg 说话
                        this.checkIn();
                    }, FANS_CHECKIN_DELAY)
                );
            }
            log('fansbadge: 已排程', {
                room,
                badge: this.settings.enableFansBadge,
                checkin: this.settings.enableFansCheckIn
            });
        }

        bind() {
            if (this.bound) return;
            this.bound = true;
            this.arm();

            let n = 0;
            const poll = setInterval(() => {
                n += 1;
                if (n > 90) return clearInterval(poll);
                const k = this.roomUid();
                if (k && k !== this.lastRoom) this.arm();
            }, 4000);
        }

        async checkIn() {
            if (this.busy) {
                // 不出声就等于今天的打卡悄悄没了，要留痕
                warn('fansbadge: 打卡与其它操作撞上了，本次跳过');
                return;
            }
            this.busy = true;
            try {
                const pid = Number(this.roomUid());
                if (!pid) {
                    warn('fansbadge: 拿不到主播 uid，跳过打卡');
                    return;
                }
                await checkInOne(pid)
                    .then((r) =>
                        log(r === 'done' ? 'fansbadge: 今日已打卡，跳过' : 'fansbadge: 打卡成功', {
                            pid
                        })
                    )
                    .catch((e) => warn('fansbadge: 打卡失败：' + e.message));
            } catch (e) {
                warn('fansbadge: checkIn 出错', e);
            } finally {
                this.busy = false;
            }
            // 本房间打完后，后台把名下所有粉丝团过一遍
            this.sweepAllClubs();
        }

        // 遍历「我的全部粉丝团」逐个打卡，每个之间 1~3s 随机抖动，
        // 免得连着打被站侧当成刷接口。一天只扫一轮，刷新页面不再重来。
        async sweepAllClubs() {
            if (this.sweeping) return;
            const today = new Date().toDateString();
            if (store.get(SWEEP_DAY_KEY, '') === today) return;
            this.sweeping = true;
            store.set(SWEEP_DAY_KEY, today);
            try {
                const clubs = await myFansClubs().catch((e) => {
                    warn('fansbadge: 取粉丝团列表失败：' + e.message);
                    return [];
                });
                if (!clubs.length) return;
                log('fansbadge: 开始遍历粉丝团', {
                    数量: clubs.length,
                    名单: clubs.map((c) => c.name || c.pid)
                });
                const tally = { ok: 0, done: 0, fail: 0 };
                const failed = [];
                for (let i = 0; i < clubs.length; i++) {
                    const c = clubs[i];
                    // 抖动放在每次之后，最后一个后面不必再等
                    if (i > 0) await sleep(1000 + Math.random() * 2000);
                    try {
                        const r = await checkInOne(c.pid);
                        tally[r === 'done' ? 'done' : 'ok'] += 1;
                    } catch (e) {
                        tally.fail += 1;
                        failed.push(`${c.name || c.pid}: ${e.message}`);
                    }
                }
                log('fansbadge: 遍历完成', tally);
                if (failed.length) warn('fansbadge: 部分粉丝团打卡失败', failed);
            } catch (e) {
                warn('fansbadge: sweepAllClubs 出错', e);
            } finally {
                this.sweeping = false;
            }
        }

        // 两套面板都认，返回「真能读到内容」的那个。
        //
        // 为什么不能靠 TT_ROOM_DATA.type：实测 shenqiangxiaozi 是 type='MATCH'
        // 但它其实是粉丝团房间（开了 PEL 赛事，type 跟着变了），而它开出的是粉丝弹幕；
        // 反过来 lpl / vctcn 才是真赛事。官方自己的判据是
        // match.huya.com/match/teambadge/queryTeamMedalConfig 返回的 matchId（lpl=1、vctcn=47、
        // shenqiangxiaozi=0），那是异步接口，脚本为了判个类型去发请求不划算。
        //
        // #J-room-club-color 是 HTML 模板里的静态节点，所有房间都有，display:none 时
        // rect 为 0x0；粉丝团那套是 React portal，收起时高度 0 但条目已在 DOM 里。
        // 所以两边各按自己的「内容已就绪」特征认，不靠先后顺序 ——
        // 早期版本先试赛事再试粉丝团，赛事房间若面板还没撑开就会掉到粉丝团分支去。
        barragePanel() {
            const plain = queryOne(SEL.fansClubColorPanel);
            if (plain) {
                const b = plain.getBoundingClientRect();
                if (b.width > 20 && b.height > 20) return plain;
            }
            for (const root of queryAll(SEL.fansBarragePortal)) {
                const head = root.querySelector(SEL.fansBarrageHead);
                if (head && /粉丝弹幕/.test(head.textContent || '')) return root;
            }
            return null;
        }

        // 赛事房间那套是 <li class="color-item[ locked][ current]">，没有文案，
        // 档位高低只能靠 DOM 顺序 —— 官方正是按 colourLevelInfo 等级升序渲染的。
        readBarrageColors(panel) {
            if (panel.id === SEL.fansClubColorPanel.slice(1)) {
                // 赛事房间这套由 barrageColorClub.js 渲染：档位表来自接口
                // match.huya.com/match/teambadge/queryTeamMedalConfig 的 colourLevelInfo
                //（{十进制色值: 等级}），官方按等级升序渲染，所以 DOM 顺序就是由低到高。
                // 白档（color-item1）是「不染色」，恒排第一且不算档位。
                return queryAll(SEL.fansClubColorList, panel).map((el, i) => {
                    const cls = String(el.className || '');
                    const rgb = ((el.getAttribute('style') || '').match(
                        /background-color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/
                    ) || [])
                        .slice(1, 4)
                        .map((v) => Number(v));
                    const hex =
                        rgb.length === 3
                            ? rgb
                                  .map((v) => v.toString(16).padStart(2, '0'))
                                  .join('')
                                  .toUpperCase()
                            : '';
                    const isDefault = /color-item1/.test(cls);
                    return {
                        el,
                        span: el,
                        label: hex,
                        isDefault,
                        locked: /(^|\s)locked(\s|$)/.test(cls),
                        selected: /(^|\s)current(\s|$)/.test(cls),
                        // 白档 rank 0 不参与挑最高档；其余按 DOM 序（= 官方等级序）
                        rank: isDefault ? 0 : i
                    };
                });
            }
            return queryAll(SEL.fansBarrageItem, panel)
                .map((el) => {
                    const span = el.firstElementChild;
                    if (!span) return null;
                    const cls = String(span.className || '');
                    const label = (span.textContent || '').trim();
                    const clean = stripBarrageHint(label);
                    return {
                        el,
                        span,
                        label,
                        // 锁定时官方渲染的是「Lv14」+ 悬浮卡「14级粉丝福利」，
                        // innerText 会粘成「Lv1414级粉丝福」，所以取 rank 前先剥掉后半截
                        isDefault: /colorDefault--/.test(cls),
                        locked: /lock--/.test(cls),
                        selected: /selected--/.test(cls),
                        // 粉丝打卡不在 BARRAGE_RANKS 表里 → rank -1 → 下面 rank>0 直接过滤掉，不参与挑档
                        rank: barrageColorRank(clean)
                    };
                })
                .filter(Boolean);
        }

        // 面板只在可见时渲染。两套实现监听的事件不一样：
        // React 的 onMouseEnter 只认真实 mouseenter，赛事房间 jQuery 绑的只认真实 mouseover，
        // 所以两个都派，谁都不落下。
        pokeBarrageTrigger(trigger) {
            const b = trigger.getBoundingClientRect();
            const at = {
                bubbles: true,
                cancelable: true,
                clientX: Math.round(b.left + b.width / 2),
                clientY: Math.round(b.top + b.height / 2)
            };
            fireMouse(trigger, 'mouseover', at);
            fireMouse(trigger, 'mouseenter', at);
        }

        // 有些房间压根没有这功能，所以只探一下就够，别反复派发刷警告。
        // 面板「打开」的标准是能读出颜色条目：赛事那套收起时 ul 是空的，
        // React 那套收起时高度是 0 但条目已挂上，两种都得等条目真的在。
        async openBarragePanel(timeout = 2000) {
            const trigger = queryOne(SEL.fansBarrageTrigger);
            if (!trigger) return { panel: null, fired: 0, err: 'no-trigger' };
            let fired = 0;
            let err = null;
            const ready = () => {
                const p = this.barragePanel();
                return p && this.readBarrageColors(p).length ? p : null;
            };
            const hit = await waitFor(
                () => {
                    if (!ready()) {
                        fired += 1;
                        try {
                            this.pokeBarrageTrigger(trigger);
                        } catch (e) {
                            err = e;
                        }
                    }
                    return ready();
                },
                { timeout, interval: 200, label: '弹幕颜色面板' }
            )
                .then(ready)
                .catch(() => null);
            return { panel: hit, fired, err: err ? String(err.message || err) : null };
        }

        closeBarragePanel(panel) {
            const trigger = queryOne(SEL.fansBarrageTrigger);
            panel?.style.removeProperty('opacity');
            panel?.style.removeProperty('pointer-events');
            // 赛事那套是自己把 display 置成 block 的，站侧的 mouseleave 收不干净就手动收
            if (panel && panel.id === SEL.fansClubColorPanel.slice(1)) {
                panel.style.display = 'none';
            }
            try {
                const b = trigger && trigger.getBoundingClientRect();
                const at = b
                    ? {
                          bubbles: true,
                          cancelable: true,
                          clientX: Math.round(b.left + b.width / 2),
                          clientY: Math.round(b.top + b.height / 2)
                      }
                    : {};
                fireMouse(trigger, 'mouseout', at);
                fireMouse(trigger, 'mouseleave', at);
            } catch (e) {
            }
        }

        // 排除未解锁(lock--)；站侧customColor 是内存态，刷新即失效
        async applyBarrageColor() {
            let panel = null;
            let ok = false;
            try {
                const probe = await this.openBarragePanel();
                panel = probe.panel;
                if (!panel) {
                    // 这里不能反推「有没有粉丝团」：实测 chuhe（普通粉丝团房间）
                    // 在面板未打开时同样开不出粉丝弹幕标题，而静态彩色面板节点
                    // 又在所有房间都存在，两条都成立，推不出结论。
                    // clubPanel 保持未知，等面板真开出来时再定。
                    return this.capFailed(
                        'barrage',
                        `fansbadge: 打不开弹幕颜色面板（已派发 ${probe.fired} 次${
                            probe.err ? '，异常 ' + probe.err : ''
                        }）`,
                        'fansbadge: 本房间没有弹幕颜色功能，跳过弹幕颜色'
                    );
                }
                this.capOk('barrage');
                // 面板类型就是「本房间有没有粉丝团」的判据：
                // 粉丝团房间是 React 的「粉丝弹幕」（barrageColorClub 之外那套，走粉丝牌）；
                // 赛事房间是 #J-room-club-color（走战队勋章 barrageColorClub），那种房间
                // 没有粉丝团，再发 FAN_CLUB_OPEN 只会把「赛事VIP」广告面板顶出来。
                this.caps().clubPanel = panel.id === 'J-room-club-color' ? false : null;
                if (this.caps().clubPanel === null) this.capOk('clubPanel');
                // 面板会真弹到屏幕上（实测 340x213，居中），期间必须藏好
                panel.style.setProperty('opacity', '0', 'important');
                panel.style.setProperty('pointer-events', 'none', 'important');

                const rows = this.readBarrageColors(panel);
                if (!rows.length) {
                    warn('fansbadge: 弹幕颜色面板里没有颜色条目');
                    return false;
                }
                log(
                    'fansbadge: 弹幕颜色列表',
                    rows.map((r) => ({ label: r.label || '(不染色)', locked: r.locked, selected: r.selected }))
                );

                const usable = rows.filter((r) => r.rank > 0 && !r.locked);
                const best = usable.reduce((acc, r) => (!acc || r.rank > acc.rank ? r : acc), null);
                if (!best) {
                    const lockedRows = rows.filter((r) => r.locked);
                    // 赛事房间全锁说明没佩戴战队勋章（官方 locked 判据是
                    // usingTeamMedalId===0 || level < 门槛），值得说明白
                    log(
                        lockedRows.length
                            ? 'fansbadge: 本房间没有可用的弹幕颜色档（全部锁定）'
                            : 'fansbadge: 本房间没有弹幕颜色档位',
                        {
                            锁定档数: lockedRows.length,
                            锁定档: lockedRows.map((r) => r.label),
                            赛事房间: !!lockedRows.length
                        }
                    );
                    return true;
                }
                if (best.selected) {
                    log('fansbadge: 弹幕颜色已是最高档', best.label || `第${best.rank}档`);
                    return true;
                }
                // 两套都是 React，都能在 fiber 上拿到官方 handler：
                //   粉丝团 RoomFanBarrageColor → onClick
                //   赛事   barrageColorClub     → onPick
                // 都是零参数、直接写 barrageColor.customColor。
                //
                // 官方的 li 上真正执行的是 onClick: function(){ n || r || a(t) }，
                // 即 locked(n) 与 selected(r) 两道拦截都在 onClick 里，
                // onPick 本身不拦。所以直调 onPick 会绕过这两道 —— 上面已经
                // 过滤掉 locked、并且 best.selected 时提前返回，这里只做兜底。
                if (!best.locked && !best.selected && callOfficialBarrageHandler(best.span)) {
                    // 命中官方 handler
                } else if (!reactClick(best.span)) {
                    best.span.click();
                }
                await sleep(600);
                // 必须在关面板之前校验：mouseout 会把内容卸载掉。
                // 比 rank 不比 label：赛事那套同色可能重复。
                // best.rank > 0：白档（rank 0）在上面的 best.selected 分支就返回了，
                // 走不到这里 —— 官方对已选中的档也是 no-op（onClick 里 r 拦截）。
                const after = this.readBarrageColors(panel).find((r) => r.selected);
                if (after && after.rank === best.rank && best.rank > 0) {
                    log('fansbadge: 已切到最高档弹幕颜色', best.label || `第${best.rank}档`);
                    ok = true;
                } else {
                    warn('fansbadge: 点了颜色但选中态没落到目标档位', {
                        想要: best.label || `第${best.rank}档`,
                        现在: after ? after.label || '(不染色)' : null
                    });
                }
            } catch (e) {
                warn('fansbadge: applyBarrageColor 出错', e);
            } finally {
                this.closeBarragePanel(panel);
            }
            return ok;
        }
    }
    // 整站配色：必须在页面开始渲染前就挂上。
    // 之前放在 main()（document-idle 附近）里做，实测进房卡 2~5 秒 ——
    // 那时 video 正在起播、React 正在挂载，在 documentElement 上切 class 会触发
    // 整页样式失效与重排，把进行中的渲染全打断重来。
    // 提前到 document-start 做，等于在首帧之前就把样式备好，渲染时无需返工。
    function applyThemeEarly() {
        let dark = false;
        try {
            // 必须用 STORAGE_KEY，键名错了就读不到用户选的主题
            const raw = store.get(STORAGE_KEY, null);
            const saved = raw && typeof raw === 'object' ? raw.themeMode : null;
            const mode = THEME_MODES.includes(saved) ? saved : DEFAULT_SETTINGS.themeMode;
            dark =
                mode !== 'auto'
                    ? mode === 'dark'
                    : window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch (e) {
            dark = false;
        }
        if (!dark) return;
        try {
            document.documentElement.classList.add('hlo-dark');
            // head 可能还没建好，先塞进 documentElement，解析器会自动搬到 head
            ensureSiteDarkStyle(true);
        } catch (e) {
        }
    }

    // ---------- bootstrap（分层延迟，减轻进房头几秒卡顿） ----------
    function main() {
        injectStyles();
        const settings = loadSettings();

        // 面板本身跟随整站（早期已在 documentElement 挂好，这里只同步面板自己的 data-theme）
        const optimizer = new PlayerOptimizer(settings);
        const plusOne = new ScreenPlusOne(settings);
        const history = new DanmakuHistory(settings);
        const fansBadge = new FansBadge(settings);

        const ui = new SettingsUI(optimizer, settings, (next) => {
            plusOne.update(next);
            history.update(next);
            optimizer.updateSettings(next);
            fansBadge.update(next);
        });

        optimizer.startWatchdog();
        scheduleIdle(() => ui.watchButton(), 1200);
        scheduleIdle(() => history.bind(), 3500);
        scheduleIdle(() => plusOne.bind(), 4000);
        scheduleIdle(() => fansBadge.bind(), 5000);

        log('initialized', settings);
    }

    // 配色先走：这一步只读一次 GM 存储 + 挂个 class。
    // 放在 main() 之前（但仍是 document-idle），这样其余功能开始跑之前
    // 样式已经就位，不会等设置面板第一次打开才生效。
    applyThemeEarly();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(main, 150));
    } else {
        setTimeout(main, 150);
    }
})();

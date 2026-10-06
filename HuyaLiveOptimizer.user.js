// ==UserScript==
// @name         虎牙直播优化器 | HuyaLiveOptimizer
// @namespace    https://github.com/mks155
// @homepageURL  https://github.com/mks155/HuyaLiveOptimizer
// @icon         https://raw.githubusercontent.com/mks155/HuyaLiveOptimizer/main/docs/icon.svg
// @version      2.3.1
// @description  进直播间自动解锁画质扫码限制、秒切最高/指定清晰度、一键进入观影模式；画面弹幕悬停可 +1 复读，发送框 ↑↓ 翻历史。设置全站生效，安装即用 | Auto unlock quality, switch to 4K/50M, theater mode, screen-danmaku +1, send history
// @author       mks155
// @copyright    2025, mks155 (https://github.com/mks155)
// @match        *://*.huya.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const NS = 'HuyaLiveOptimizer';
    const VERSION = (() => {
        try {
            const meta = (typeof GM_info !== 'undefined' && (GM_info.scriptMeta || GM_info.script?.meta)) || null;
            const v = meta?.version || meta?.json?.version;
            if (v) return String(v);
            const src = (typeof GM_info !== 'undefined' && GM_info.script?.code) || document.currentScript?.textContent || '';
            const m = String(src).match(/@version\s+(\S+)/);
            if (m) return m[1];
        } catch (e) {
        }
        return '0.0.0';
    })();
    const STORAGE_KEY = 'huya_optimizer';
    const MAX_HISTORY = 50;

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

    const FANS_BADGE_DELAY = 15000;
    const FANS_CHECKIN_DELAY = 30000;
    const FANS_BADGE_RETRY = 6000;
    const FANS_BADGE_MAX_TRIES = 12;
    const FANS_CAP_MISS_LIMIT = 3;

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
        // 粉丝团面板：靠 TT.event.emit('FAN_CLUB_OPEN', tab, host) 打开，不是点出来的
        fansPanel: '[class*="FanClubBd--"]',
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
        let ok = false;
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
        }

        isValidQuality(q) {
            return !!(q && q !== 'null' && q !== 'undefined' && q !== 'false' && String(q).trim());
        }

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
                log(`unlock items=${$list.length} changed=${changed}`);
                return true;
            } catch (e) {
                warn('unlock failed', e);
                return false;
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
            return (on.textContent || '').replace(/请先登录|请先登陆/g, '').trim();
        }

        // 起播前清晰度列表是占位的（只有「超清|高清」这种），点了也不生效，必须等 video 真的有数据
        isPlayerReady() {
            const v = queryOne(['#player-container video', '#player-vdieobox video', 'video']);
            return !!v && (v.readyState >= 2 || v.videoWidth > 0);
        }

        isCurrentQuality(target) {
            const n = PlayerOptimizer.normalize(target);
            return PlayerOptimizer.normalize(this.currentQualityText()) === n ||
                PlayerOptimizer.normalize(this.selectedQualityText()) === n;
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

            if (this.isValidQuality(this.settings.targetQuality)) {
                const el = pick(this.settings.targetQuality);
                if (el) return { el, text: this.settings.targetQuality };
                warn(`quality "${this.settings.targetQuality}" not in room → highest`);
            }

            for (const q of STANDARD_QUALITIES) {
                const el = pick(q);
                if (el) return { el, text: q };
            }
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

            const $list = $(SEL.qualityList);
            if (!$list.length) throw new Error('quality list missing');

            this.unlockQuality();

            const { el, text } = this.resolveTarget($, $list);
            if (!el || !text) throw new Error('target quality missing');

            if (this.isCurrentQuality(text)) {
                this.qualityDone = true;
                return true;
            }

            $(el).click();
            this.qualityDone = await this.waitForQuality(text, 5000);
            return this.qualityDone;
        }

        isTheaterOn() {
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
            if (this.isTheaterOn()) {
                this.theaterDone = true;
                return true;
            }
            const $ = page$();
            if (!$) return false;

            const $btn = $(SEL.theaterBtn);
            if (!$btn.length) return false;
            if ($btn.hasClass(SEL.theaterOn)) {
                this.theaterDone = true;
                return true;
            }

            $btn.click();
            await sleep(350);
            this.theaterDone = this.isTheaterOn();
            if (this.theaterDone) log('theater ok');
            else warn('theater click did not stick');
            return this.theaterDone;
        }

        async run() {
            if (this.running) return;
            this.running = true;
            try {
                await waitForJQuery(15000);

                await waitFor(() => queryOne(SEL.theaterBtn), {
                    timeout: 15000,
                    interval: 500,
                    label: 'theater btn'
                });
                // 没起播就切清晰度必然失败，占位列表点了也不认
                await waitFor(() => this.isPlayerReady(), {
                    timeout: 20000,
                    interval: 500,
                    label: 'player ready'
                }).catch(() => warn('player not streaming, still trying'));
                await waitFor(() => queryAll(SEL.qualityList).length > 0, {
                    timeout: 5000,
                    interval: 500,
                    label: 'quality list'
                }).catch(() => null);

                this.unlockQuality();

                try {
                    await this.switchQuality();
                } catch (e) {
                    warn('switchQuality', e);
                }

                await sleep(800);
                await this.enterTheater();

                log('done', {
                    quality: this.selectedQualityText() || this.currentQualityText(),
                    theater: this.theaterDone,
                    qualityDone: this.qualityDone
                });
            } catch (e) {
                warn('run error', e);
            } finally {
                this.running = false;
            }
        }

        startWatchdog() {
            setTimeout(() => this.run(), 1000);

            let n = 0;
            const t = setInterval(() => {
                n += 1;
                // 播放器起播可能要十几秒，重试窗口给到 ~40s，别 3 下就放弃
                if (n > 20) {
                    clearInterval(t);
                    return;
                }
                if (this.running) return;
                const theaterOk = !this.settings.autoTheater || this.theaterDone || this.isTheaterOn();
                if (theaterOk && this.qualityDone) {
                    clearInterval(t);
                    return;
                }
                this.run();
            }, 2000);

            const onNav = () => {
                this.theaterDone = false;
                this.qualityDone = false;
                setTimeout(() => this.run(), 900);
            };
            window.addEventListener('popstate', onNav);

            let href = location.href;
            let p = 0;
            const nav = setInterval(() => {
                p += 1;
                if (p > 40) {
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
                        <button type="button" id="hlo-theme" title="界面配色：${THEME_LABEL[mode]}（点击切换）">${icons}</button>
                    </div>
                </div>
                <div class="field">
                    <div class="field-label">清晰度（全站生效）</div>
                    <select id="hlo-quality-select">${opts}</select>
                </div>
                <label class="row"><input type="checkbox" id="hlo-theater" ${this.settings.autoTheater ? 'checked' : ''}/> 自动进入观影模式</label>
                <label class="row"><input type="checkbox" id="hlo-plus1" ${this.settings.enableScreenPlusOne !== false ? 'checked' : ''}/> 画面弹幕悬浮 +1</label>
                <label class="row"><input type="checkbox" id="hlo-history" ${this.settings.enableDanmakuHistory !== false ? 'checked' : ''}/> 弹幕输入框上下键历史</label>
                <label class="row"><input type="checkbox" id="hlo-fans-badge" ${this.settings.enableFansBadge !== false ? 'checked' : ''}/> 自动切最高档弹幕颜色（15 秒）</label>
                <label class="row"><input type="checkbox" id="hlo-fans-checkin" ${this.settings.enableFansCheckIn !== false ? 'checked' : ''}/> 有粉丝团则自动打卡（30 秒）</label>
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
            if (!panel) return;
            panel.dataset.theme = this.resolveTheme(mode);
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
            if (btn) btn.title = `界面配色：${THEME_LABEL[next]}（点击切换）`;
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

// ---------- 粉丝牌：自动佩戴 + 自动打卡 ----------
    const FANS_TAB_CLUB = 0;

    function openFanClub(tab, host) {
        try {
            const tt = unsafeWindow.TT || window.TT;
            if (!tt || !tt.event || typeof tt.event.emit !== 'function') return false;
            tt.event.emit('FAN_CLUB_OPEN', tab, host);
            return true;
        } catch (e) {
            warn('openFanClub 失败', e);
            return false;
        }
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
    const BARRAGE_RANKS = {
        超粉Plus: 100,
        超粉: 90,
        Lv18: 80,
        Lv14: 70,
        Lv10: 60,
        Lv6: 50,
        Lv3: 40,
        Lv1: 30
    };

    function barrageColorRank(label) {
        const key = String(label || '').trim();
        return Object.prototype.hasOwnProperty.call(BARRAGE_RANKS, key) ? BARRAGE_RANKS[key] : -1;
    }

    class FansBadge {
        constructor(settings) {
            this.settings = settings;
            this.bound = false;
            this.timers = [];
            this.lastRoom = null;
            this.host = null;
            this.busy = false;
            this.silentStyle = null;
            this.hoverBound = false;
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
            if (this.capMiss[key] < FANS_CAP_MISS_LIMIT) {
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
                this.silenceOff();
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

        hostInfo() {
            if (this.host) return this.host;
            const img = queryOne('#J_roomHeader a.host-pic img, a.host-pic img');
            const name =
                (img && img.getAttribute('alt')) ||
                ((queryOne('.host-detail, .host-title')?.innerText || '').trim()) ||
                '';
            const avatar = img ? img.getAttribute('src') || '' : '';
            const uid = this.roomUid();
            this.host = uid ? { uid, nick: name, avatar } : null;
            return this.host;
        }

        panel() {
            return queryOne(SEL.fansPanel);
        }

        arm() {
            this.clearTimers();
            this.host = null;
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
                    if (tries >= FANS_BADGE_MAX_TRIES) {
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
                        // 打卡按钮在粉丝团面板里。赛事房间没有粉丝团，
                        // 而 FAN_CLUB_OPEN 在那种房间会把「赛事VIP」广告面板顶出来，
                        // 所以只在确认过是粉丝团房间时才发这个事件。
                        if (this.caps().clubPanel === false) {
                            log('fansbadge: 本房间没有粉丝团面板，跳过打卡（不发 FAN_CLUB_OPEN）');
                            return;
                        }
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
            this.bindHoverBridge();
            this.silenceOn();
            this.arm();

            let n = 0;
            const poll = setInterval(() => {
                n += 1;
                if (n > 90) return clearInterval(poll);
                const k = this.roomUid();
                if (k && k !== this.lastRoom) this.arm();
            }, 4000);
        }

        waitPanel(timeout = 4000) {
            return waitFor(() => this.panel(), { timeout, interval: 120, label: 'fanclub panel' })
                .then(() => this.panel())
                .catch(() => null);
        }

        // 面板默认就开着，找不到才算失败；挂 pointer-events:none 禁止交互
        silenceOn() {
            if (this.silentStyle) return;
            const style = document.createElement('style');
            style.id = 'hlo-fans-silent';
            style.textContent =
                '[class*="FanClubBd--"],[class*="FanClubBd"] > *' +
                '{opacity:0 !important;pointer-events:none !important}';
            (document.head || document.documentElement).appendChild(style);
            this.silentStyle = style;
        }

        silenceOff() {
            this.silentStyle?.remove();
            this.silentStyle = null;
        }

        bindHoverBridge() {
            if (this.hoverBound) return;
            this.hoverBound = true;
            const area = () => queryOne('.chat-host-pic') || queryOne('.chat-room__ft__chat');
            document.addEventListener(
                'mouseover',
                (e) => {
                    const a = area();
                    if (a && (a === e.target || a.contains(e.target))) this.silenceOff();
                },
                true
            );
            document.addEventListener(
                'mouseout',
                (e) => {
                    const a = area();
                    if (!a || a.contains(e.relatedTarget)) return;
                    this.silenceOn();
                },
                true
            );
        }

        // 「打卡」/「已完成」直接对应站侧 lSignInFlag
        findCheckinBtn() {
            const hits = queryAll('a,button').filter((el) => {
                const t = (el.innerText || '').trim();
                if (!/^(打卡|已完成|已打卡)$/.test(t)) return false;
                const r = el.getBoundingClientRect();
                return r.width > 16 && r.height > 8 && r.height < 60;
            });
            return hits[0] || null;
        }

        async checkIn() {
            if (this.busy) {
                // 不出声就等于今天的打卡悄悄没了，要留痕
                warn('fansbadge: 打卡与其它操作撞上了，本次跳过');
                return;
            }
            this.busy = true;
            this.silenceOn();
            try {
                // 赛事房间没有粉丝团，FAN_CLUB_OPEN 在那里会把「赛事VIP」广告面板顶出来，
                // 所以只在弹幕颜色那步已经确认是粉丝团房间时才发
                if (this.caps().clubPanel === false) {
                    log('fansbadge: 本房间没有粉丝团面板，跳过打卡（不发 FAN_CLUB_OPEN）');
                    return;
                }
                const host = this.hostInfo();
                if (!host) {
                    warn('fansbadge: 拿不到主播信息');
                    return;
                }
                if (!openFanClub(FANS_TAB_CLUB, host)) {
                    warn('fansbadge: TT.event 不可用，无法打开粉丝团面板');
                    return;
                }
                const panel = await this.waitPanel();
                if (!panel) {
                    this.capFailed(
                        'clubPanel',
                        'fansbadge: 粉丝团面板没打开，跳过打卡',
                        'fansbadge: 本房间打不开粉丝团面板，跳过打卡'
                    );
                    return;
                }
                this.capOk('clubPanel');
                const btn = await waitFor(() => this.findCheckinBtn(), {
                    timeout: 4000,
                    interval: 150,
                    label: 'checkin btn'
                })
                    .then(() => this.findCheckinBtn())
                    .catch(() => null);

                if (!btn) {
                    // 面板里没有打卡按钮 = 站侧没给本房间粉丝牌能力 = 没有粉丝牌
                    warn('fansbadge: 面板里没有打卡按钮，跳过（本房间应无粉丝牌）');
                    return;
                }
                const before = (btn.innerText || '').trim();
                if (before !== '打卡') {
                    log('fansbadge: 今日已打卡，跳过（站侧 lSignInFlag 已置位）', before);
                    return;
                }
                if (!reactClick(btn)) {
                    warn('fansbadge: 打卡按钮上没找到 React onClick，改用原生 click');
                    btn.click();
                }
                await sleep(1200);
                // 用 includes：按钮里包着图标，innerText 可能夹不可见字符
                const after = (btn.innerText || '').trim();
                if (/已完成|已打卡/.test(after)) log('fansbadge: 打卡成功', after);
                else warn(`fansbadge: 点了打卡但按钮仍是「${after}」`);
            } catch (e) {
                warn('fansbadge: checkIn 出错', e);
            } finally {
                this.silenceOn();
                this.busy = false;
            }
        }

        // 两套面板都认。React portal 那个收起时高度是 0 但内容还挂在 DOM 里，
        // 所以不能按尺寸过滤（加了会把正常房间判成没有）；普通 DOM 那套要按尺寸认。
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
        // 只能按 DOM 顺序定档位（白=不染色排第一，后面由弱到强），锁定看 locked。
        readBarrageColors(panel) {
            if (panel.id === 'J-room-club-color') {
                return queryAll(SEL.fansClubColorList, panel).map((el, i) => {
                    const cls = String(el.className || '');
                    const hex = ((el.getAttribute('style') || '').match(/background-color:\s*([^;]+)/i) || [])[1];
                    return {
                        el,
                        span: el,
                        label: (hex || '').trim(),
                        isDefault: /color-item1/.test(cls),
                        locked: /(^|\s)locked(\s|$)/.test(cls),
                        selected: /(^|\s)current(\s|$)/.test(cls),
                        rank: /color-item1/.test(cls) ? 0 : i
                    };
                });
            }
            return queryAll(SEL.fansBarrageItem, panel)
                .map((el) => {
                    const span = el.firstElementChild;
                    if (!span) return null;
                    const cls = String(span.className || '');
                    const label = (span.textContent || '').trim();
                    return {
                        el,
                        span,
                        label,
                        isDefault: /colorDefault--/.test(cls),
                        locked: /lock--/.test(cls),
                        selected: /selected--/.test(cls),
                        rank: barrageColorRank(label)
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

        // 排除未解锁(lock--)；站侧 customColor 是内存态，刷新即失效
        async applyBarrageColor() {
            let panel = null;
            let ok = false;
            try {
                const probe = await this.openBarragePanel();
                panel = probe.panel;
                if (!panel) {
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
                // React 的「粉丝弹幕」面板只有粉丝团房间才有；赛事房间是普通 DOM 的「彩色弹幕」，
                // 那种房间没有粉丝团，去了只会把赛事VIP广告面板顶出来。
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
                    log('fansbadge: 本房间没有可用的弹幕颜色档', {
                        锁定: rows.filter((r) => r.locked).map((r) => r.label)
                    });
                    return true;
                }
                if (best.selected) {
                    log('fansbadge: 弹幕颜色已是最高档', best.label || `第${best.rank}档`);
                    return true;
                }
                // 赛事那套是普通 DOM，本来就没有 React fiber，走原生 click 属正常
                if (!reactClick(best.span)) best.span.click();
                await sleep(1000);
                // 必须在关面板之前校验：mouseout 会把内容卸载掉
                const after = this.readBarrageColors(panel).find((r) => r.selected);
                // 比 rank 不比 label：赛事那套的 label 是色值，可能重复
                if (after && after.rank === best.rank) {
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
    // ---------- bootstrap（分层延迟，减轻进房头几秒卡顿） ----------
    function main() {
        injectStyles();
        const settings = loadSettings();

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(main, 150));
    } else {
        setTimeout(main, 150);
    }
})();

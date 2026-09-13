// ==UserScript==
// @name         HuyaLiveOptimizer | 虎牙直播优化器
// @namespace    https://github.com/mks155
// @homepageURL  https://github.com/mks155/HuyaLiveOptimizer
// @icon         https://www.huya.com/favicon.ico
// @version      2.0.0
// @description  进直播间自动解锁画质扫码限制、秒切最高/指定清晰度（最高 4K/蓝光50M）、一键进入观影模式；画面弹幕悬停可 +1 复读，发送框 ↑↓ 翻历史。设置全站生效，安装即用 | Auto unlock quality, switch to 4K/50M, theater mode, screen-danmaku +1, send history
// @author       mks155
// @copyright 2025, mks155 (https://github.com/mks155)
// @match        *://*.huya.com/*
// @grant        unsafeWindow
// @license      MIT
// @noframes
// @run-at       document-idle
// @downloadURL https://openuserjs.org/install/mks155/HuyaLiveOptimizer_%E8%99%8E%E7%89%99%E7%9B%B4%E6%92%AD%E4%BC%98%E5%8C%96%E5%99%A8.user.js
// @updateURL https://openuserjs.org/meta/mks155/HuyaLiveOptimizer_%E8%99%8E%E7%89%99%E7%9B%B4%E6%92%AD%E4%BC%98%E5%8C%96%E5%99%A8.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const NS = 'HuyaLiveOptimizer';
    /** 统一本地存储键：设置 + 弹幕历史 */
    const STORAGE_KEY = 'huya_optimizer';
    const MAX_HISTORY = 50;

    /** 全站画质档位（高 → 低）。默认最高；用户选的档房间没有则回退最高。 */
    const STANDARD_QUALITIES = [
        '4K',
        '2K',
        '蓝光50M',
        '蓝光30M',
        '蓝光20M',
        '蓝光10M',
        '蓝光8M',
        '蓝光4M',
        '超清',
        '流畅'
    ];
    const QUALITY_AUTO = '';

    const DEFAULT_SETTINGS = {
        targetQuality: QUALITY_AUTO,
        autoTheater: true,
        enableScreenPlusOne: true,
        enableDanmakuHistory: true
    };

    const SEL = {
        theaterBtn: '#player-fullpage-btn',
        theaterOn: 'player-narrowpage',
        qualityList: '.player-videotype-list li',
        qualityCurrent: '.player-videotype-cur',
        giftRightUl: '.player-gift-right ul',
        nobleBtn: '#player-noble-btn',
        danmuWrap: '#danmuwrap, #player-danmu-wrap, .danmu-wrap',
        danmuItem: '.danmu-item',
        sendBtn: '#msg_send_bt',
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
        ls() {
            try {
                return unsafeWindow.localStorage || window.localStorage;
            } catch (e) {
                return null;
            }
        },
        get(key, fallback) {
            try {
                const raw = this.ls()?.getItem(key);
                if (raw == null) return fallback;
                const parsed = JSON.parse(raw);
                return parsed == null ? fallback : parsed;
            } catch (e) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                this.ls()?.setItem(key, JSON.stringify(value));
            } catch (e) {
                /* quota / private mode */
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
            enableDanmakuHistory: data.enableDanmakuHistory ?? DEFAULT_SETTINGS.enableDanmakuHistory
        };
    }

    function saveSettings(s) {
        saveStore({
            targetQuality: s.targetQuality,
            autoTheater: s.autoTheater,
            enableScreenPlusOne: s.enableScreenPlusOne,
            enableDanmakuHistory: s.enableDanmakuHistory
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

    function waitFor(fn, { timeout = 15000, interval = 250, label = 'cond' } = {}) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                let ok = false;
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
                /* invalid */
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

    /** 空闲/延迟调度，避免进房头几秒抢主线程 */
    function scheduleIdle(fn, timeout = 4000) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => fn(), { timeout });
        } else {
            setTimeout(fn, Math.min(timeout, 2500));
        }
    }

    function clickEl(el) {
        if (!el) return false;
        try {
            const $ = page$();
            if ($) $(el).click();
            else el.click();
            return true;
        } catch (e) {
            warn('click failed', e);
            return false;
        }
    }

    // ---------- styles ----------
    function injectStyles() {
        if (document.getElementById('hlo-styles')) return;
        const style = document.createElement('style');
        style.id = 'hlo-styles';
        style.textContent = `
#hlo-settings-btn{cursor:pointer!important;user-select:none;color:#f80!important}
#hlo-settings-btn:hover{color:#ffaa33!important}
#hlo-settings-btn i{width:24px;height:24px;display:inline-block;margin-top:8px;background:none!important;line-height:0}
#hlo-settings-btn i svg{display:block;width:24px;height:24px}
#hlo-settings-btn p{margin-top:-1px;font-size:12px;line-height:14px;text-align:center;color:inherit}

#hlo-settings-backdrop{position:fixed;inset:0;z-index:2147483645;background:transparent}
#hlo-settings-panel{
  position:fixed;z-index:2147483646;width:280px;box-sizing:border-box;
  background:#1f1f23;color:#eee;border:1px solid #3a3a40;border-radius:8px;
  box-shadow:0 8px 28px rgba(0,0,0,.55);padding:12px 14px 14px;
  font:13px/1.5 inherit;pointer-events:auto!important
}
#hlo-settings-panel *{pointer-events:auto!important}
#hlo-settings-panel h3{margin:0 0 10px;font-size:14px;font-weight:600;color:#fff}
#hlo-settings-panel label.row{display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer}
#hlo-settings-panel select{
  width:100%;box-sizing:border-box;margin-top:4px;padding:6px 8px;
  border-radius:4px;border:1px solid #444;background:#2a2a30;color:#eee;font-size:13px
}
#hlo-settings-panel .field{margin-bottom:8px}
#hlo-settings-panel .field-label{color:#bbb;font-size:12px}
#hlo-settings-panel .actions{display:flex;gap:8px;margin-top:12px}
#hlo-settings-panel button{flex:1;padding:7px 0;border:none;border-radius:4px;cursor:pointer;font-size:13px}
#hlo-settings-panel .btn-primary{background:#f80;color:#111;font-weight:600}
#hlo-settings-panel .btn-ghost{background:#333;color:#ddd}
#hlo-settings-panel .hint{margin-top:8px;color:#888;font-size:11px}

/* 轻量冻结条：只画文字 + 按钮，禁止 cloneNode */
#hlo-danmu-freeze{
  position:fixed;z-index:2147483001;display:flex;align-items:center;gap:8px;
  pointer-events:auto!important;max-width:min(90vw,640px);
  padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.55)
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
body.hlo-plus1-on .danmu-item[data-hlo-ghost]{visibility:hidden!important}
`;
        document.head.appendChild(style);
    }

    function hexScrewSvg() {
        return (
            '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<polygon points="12,1.5 21,6.5 21,17.5 12,22.5 3,17.5 3,6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
            '<rect x="6.5" y="10.5" width="11" height="3" rx="1.2" fill="currentColor"/>' +
            '<circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
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

        /** li 内可能有「扫码即享」等附加 span，只取第一个 span 文本 */
        static nameOf($, li) {
            const $span = $(li).find('span').first();
            return ($span.length ? $span.text() : $(li).text()).trim();
        }

        resolveTarget($, $list) {
            const nameOf = (li) => PlayerOptimizer.nameOf($, li);
            const pick = (name) => {
                let hit = null;
                $list.each((_, li) => {
                    if (!hit && nameOf(li) === name) hit = li;
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
                await waitFor(() => this.currentQualityText() === target, {
                    timeout,
                    interval: 250,
                    label: `quality ${target}`
                });
                return true;
            } catch (e) {
                warn(`quality timeout cur=${this.currentQualityText()} want=${target}`);
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

            if (this.currentQualityText() === text) {
                this.qualityDone = true;
                return true;
            }

            // 与 1.0.1 相同：只 jQuery 点一次，不二次补点 span
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

        /** 对齐 1.0.1：只点一次；已开则不动，避免校验失败后再点把观影关掉 */
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
                // 对齐 1.0.1：等 jQuery + 控件，不等 video
                await waitForJQuery(15000);

                await waitFor(() => queryOne(SEL.theaterBtn), {
                    timeout: 15000,
                    interval: 500,
                    label: 'theater btn'
                });
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

                // 1.0.1：切完画质等 800ms 再进观影
                await sleep(800);
                await this.enterTheater();

                log('done', {
                    quality: this.currentQualityText(),
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
            // 1.0.1：页面稳定约 1s 后执行一次
            setTimeout(() => this.run(), 1000);

            // 仅失败时有限重试（等价 RETRY_TIMES=3），成功即停
            let n = 0;
            const t = setInterval(() => {
                n += 1;
                if (n > 3) {
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
            btn.title = 'HuyaLiveOptimizer 设置（全站）';
            btn.innerHTML = `<i>${hexScrewSvg()}</i><p>设置</p>`;
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
            return `
                <h3>HuyaLiveOptimizer</h3>
                <div class="field">
                    <div class="field-label">清晰度（全站生效）</div>
                    <select id="hlo-quality-select">${opts}</select>
                </div>
                <label class="row"><input type="checkbox" id="hlo-theater" ${this.settings.autoTheater ? 'checked' : ''}/> 自动进入观影模式</label>
                <label class="row"><input type="checkbox" id="hlo-plus1" ${this.settings.enableScreenPlusOne !== false ? 'checked' : ''}/> 画面弹幕悬浮 +1</label>
                <label class="row"><input type="checkbox" id="hlo-history" ${this.settings.enableDanmakuHistory !== false ? 'checked' : ''}/> 弹幕输入框上下键历史</label>
                <div class="actions">
                    <button type="button" class="btn-ghost" id="hlo-close">关闭</button>
                    <button type="button" class="btn-primary" id="hlo-save">保存并应用</button>
                </div>
            `;
        }

        bind(panel) {
            panel.querySelector('#hlo-close')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });

            panel.querySelector('#hlo-save')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                this.settings = {
                    targetQuality: panel.querySelector('#hlo-quality-select')?.value ?? QUALITY_AUTO,
                    autoTheater: !!panel.querySelector('#hlo-theater')?.checked,
                    enableScreenPlusOne: !!panel.querySelector('#hlo-plus1')?.checked,
                    enableDanmakuHistory: !!panel.querySelector('#hlo-history')?.checked
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
    // 禁止 cloneNode（复杂弹幕会触发明显卡顿）；只隐藏原节点 + 绘制文字条。
    class ScreenPlusOne {
        constructor(settings) {
            this.settings = settings;
            this.overlay = null;
            this.ghost = null;
            this.bound = false;
            this.lastShow = 0;
            this.pendingItem = null;
            this.throttleTimer = 0;
        }

        update(settings) {
            this.settings = settings;
            if (settings.enableScreenPlusOne === false) this.clear();
        }

        clear() {
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
            }
            if (this.ghost) {
                this.ghost.style.visibility = '';
                delete this.ghost.dataset.hloGhost;
                this.ghost = null;
            }
        }

        show(item) {
            if (this.settings.enableScreenPlusOne === false) return;
            if (this.ghost === item) return;

            const now = Date.now();
            // 节流：弹幕密集时避免高频建删 DOM
            if (now - this.lastShow < 80) {
                this.pendingItem = item;
                if (!this.throttleTimer) {
                    this.throttleTimer = setTimeout(() => {
                        this.throttleTimer = 0;
                        const el = this.pendingItem;
                        this.pendingItem = null;
                        if (el && document.body.contains(el)) this.show(el);
                    }, 80);
                }
                return;
            }
            this.lastShow = now;
            this.clear();

            const text = extractDanmuText(item);
            if (!text) return;

            // 先读 rect，再一次性写样式，减少 layout thrash
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
            btn.title = '我也发一条';
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.settings.enableScreenPlusOne !== false) sendDanmaku(text);
                this.clear();
            });
            wrap.appendChild(btn);

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

            wrap.addEventListener('mouseleave', () => {
                setTimeout(() => {
                    if (this.overlay === wrap && !wrap.matches(':hover')) this.clear();
                }, 120);
            });
        }

        bind() {
            if (this.bound) return;
            this.bound = true;

            const onOver = (e) => {
                if (this.settings.enableScreenPlusOne === false) return;
                // 快速路径：不是元素或明显无关节点直接返回
                const t = e.target;
                if (!t || t.nodeType !== 1) return;
                if (t.id === 'hlo-danmu-freeze' || t.closest?.('#hlo-danmu-freeze')) return;
                const item = t.closest?.(SEL.danmuItem);
                if (!item || item.dataset.hloGhost) return;
                this.show(item);
            };

            const attach = () => {
                const wrap = queryOne(SEL.danmuWrap);
                if (!wrap) return false;
                wrap.addEventListener('mouseover', onOver, { capture: true, passive: true });
                return true;
            };

            if (!attach()) {
                // 只等弹幕容器，不挂 document 全页 mouseover（进房时会加重主线程）
                let n = 0;
                const t = setInterval(() => {
                    n += 1;
                    if (attach() || n > 40) clearInterval(t);
                }, 1000);
            }

            // 低优先级清理，避免 scroll 捕获在弹幕层高频触发
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
                /* ignore */
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

    function applyFlags(s) {
        document.body?.classList.toggle('hlo-plus1-on', s.enableScreenPlusOne !== false);
    }

    // ---------- bootstrap（分层延迟，减轻进房头几秒卡顿） ----------
    function main() {
        // 样式与设置很轻，立即做
        injectStyles();
        const settings = loadSettings();

        const optimizer = new PlayerOptimizer(settings);
        const plusOne = new ScreenPlusOne(settings);
        const history = new DanmakuHistory(settings);

        const ui = new SettingsUI(optimizer, settings, (next) => {
            plusOne.update(next);
            history.update(next);
            optimizer.updateSettings(next);
            applyFlags(next);
        });

        applyFlags(settings);

        // 核心路径尽快；次要功能仍 idle
        optimizer.startWatchdog();
        scheduleIdle(() => ui.watchButton(), 1200);
        scheduleIdle(() => history.bind(), 3500);
        scheduleIdle(() => plusOne.bind(), 4000);

        log('initialized', settings);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(main, 150));
    } else {
        setTimeout(main, 150);
    }
})();

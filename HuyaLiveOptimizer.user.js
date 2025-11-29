// ==UserScript==
// @name         HuyaLiveOptimizer | 虎牙直播优化器
// @namespace    https://github.com/mks155
// @homepageURL  https://github.com/mks155/HuyaLiveOptimizer
// @icon         https://www.huya.com/favicon.ico
// @version      1.0.1
// @description  Automatically unlock quality restrictions, switch to highest/specified quality, and enter theater mode for Huya Live | 自动解锁画质限制、切换最高/指定画质、进入观影模式
// @author       mks155
// @copyright 2025, mks155 (https://github.com/mks155)
// @match        *://*.huya.com/*
// @grant        unsafeWindow
// @license      MIT
// @noframes
// @downloadURL https://openuserjs.org/install/mks155/HuyaLiveOptimizer_虎牙直播优化器.user.js
// @updateURL https://openuserjs.org/meta/mks155/HuyaLiveOptimizer_虎牙直播优化器.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // 配置项
    const CONFIG = {
        TARGET_QUALITY: "蓝光8M", // 目标画质，删除""中的文字，例如设置为""，则自动选择最高画质
        RETRY_TIMES: 3,           // 重试次数
        RETRY_DELAY: 1000,        // 重试间隔(ms)
        QUALITY_SWITCH_DELAY: 800 // 画质切换后等待时间(ms)
    };

    class HuyaQualitySwitcher {
        constructor() {
            this.$ = unsafeWindow.$;
            this.initialized = false;
            this.retryCount = 0;
            this.executionStarted = false; // 防止重复执行
        }

        // 等待jQuery加载
        async waitForJQuery() {
            return new Promise((resolve) => {
                const checkJQuery = () => {
                    if (typeof unsafeWindow.$ !== 'undefined') {
                        this.$ = unsafeWindow.$;
                        resolve(true);
                    } else {
                        setTimeout(checkJQuery, 100);
                    }
                };
                checkJQuery();
            });
        }

        // 等待元素加载
        async waitForElement(selector, timeout = 10000) {
            return new Promise((resolve, reject) => {
                const startTime = Date.now();

                const checkElement = () => {
                    const element = this.$(selector);
                    if (element.length > 0) {
                        resolve(element);
                    } else if (Date.now() - startTime > timeout) {
                        reject(new Error(`等待元素超时: ${selector}`));
                    } else {
                        setTimeout(checkElement, 500);
                    }
                };

                checkElement();
            });
        }

        // 解除扫码限制
        async removeQRCodeRestriction() {
            try {
                const $qualityList = this.$(".player-videotype-list li");
                if ($qualityList.length === 0) {
                    throw new Error("画质列表未找到");
                }

                let restrictionRemoved = false;
                $qualityList.each((_, li) => {
                    const $li = this.$(li);
                    const dataObj = $li.data("data");
                    if (dataObj && dataObj.status !== 0) {
                        dataObj.status = 0;
                        restrictionRemoved = true;
                    }
                });

                return true;
            } catch (error) {
                console.error("解除扫码限制失败:", error);
                throw error;
            }
        }

        // 验证配置值的工具函数
        isValidQuality(quality) {
            return quality &&
                   quality !== "null" &&
                   quality !== "undefined" &&
                   quality !== "false" &&
                   quality.trim() !== "";
        }

        // 切换画质
        async switchQuality() {
            try {
                const $qualityList = this.$(".player-videotype-list li");
                const $currentQuality = this.$(".player-videotype-cur");

                if ($qualityList.length === 0 || $currentQuality.length === 0) {
                    throw new Error("画质列表未找到");
                }

                let targetQuality = null;
                let $targetElement = null;
                const currentQualityText = $currentQuality.text().trim();

                // 优先切换到指定画质
                if (this.isValidQuality(CONFIG.TARGET_QUALITY)) {
                    $targetElement = $qualityList.filter((_, el) =>
                        this.$(el).text().trim() === CONFIG.TARGET_QUALITY
                    );

                    if ($targetElement.length > 0 && currentQualityText !== CONFIG.TARGET_QUALITY) {
                        targetQuality = CONFIG.TARGET_QUALITY;
                        $targetElement.click();
                    } else if ($targetElement.length === 0) {
                        console.warn(`指定画质 "${CONFIG.TARGET_QUALITY}" 未找到，将使用最高画质`);
                    } else {
                        return true;
                    }
                }

                // 如果没有指定画质或指定画质未找到，切换到最高画质
                if (!targetQuality) {
                    $targetElement = $qualityList.first();
                    targetQuality = $targetElement.text().trim();

                    if (currentQualityText !== targetQuality) {
                        $targetElement.click();
                    } else {
                        return true;
                    }
                }

                // 等待画质切换完成
                const switchSuccess = await this.waitForQualitySwitch(targetQuality);
                return switchSuccess;

            } catch (error) {
                console.error("切换画质失败:", error);
                throw error;
            }
        }

        // 等待画质切换完成
        async waitForQualitySwitch(targetQuality) {
            return new Promise((resolve) => {
                const startTime = Date.now();
                const maxWaitTime = 5000;

                const checkQuality = () => {
                    const $currentQuality = this.$(".player-videotype-cur");
                    const currentQualityText = $currentQuality.text().trim();

                    if (currentQualityText === targetQuality) {
                        resolve(true);
                    } else if (Date.now() - startTime > maxWaitTime) {
                        console.warn(`画质切换超时，当前画质: ${currentQualityText}`);
                        resolve(false);
                    } else {
                        setTimeout(checkQuality, 200);
                    }
                };

                checkQuality();
            });
        }

        // 进入观影模式
        async enterTheaterMode() {
            try {
                const $theaterBtn = this.$("#player-fullpage-btn");
                if ($theaterBtn.length === 0) {
                    throw new Error("观影模式按钮未找到");
                }

                // 检查是否已经在观影模式
                if (!$theaterBtn.hasClass("player-narrowpage")) {
                    $theaterBtn.click();
                }
                return true;

            } catch (error) {
                console.error("进入观影模式失败:", error);
                throw error;
            }
        }

        // 初始化播放器 - 按顺序执行所有步骤
        async initPlayer() {
            // 防止重复执行
            if (this.executionStarted) {
                return;
            }
            this.executionStarted = true;

            try {
                // 等待页面完全稳定后再执行
                await new Promise(resolve => setTimeout(resolve, 2000));

                // 等待播放器加载完成
                await this.waitForElement("#player-fullpage-btn", 15000);
                await this.waitForElement(".player-videotype-list li", 5000);

                // 解除扫码限制
                await this.removeQRCodeRestriction();

                // 切换画质
                await this.switchQuality();

                // 等待画质切换稳定
                await new Promise(resolve => setTimeout(resolve, CONFIG.QUALITY_SWITCH_DELAY));

                // 进入观影模式
                await this.enterTheaterMode();

                this.initialized = true;
                console.log("虎牙画质切换完成");

            } catch (error) {
                console.error("播放器初始化失败:", error);
                // 重置执行标志，允许重试
                this.executionStarted = false;

                // 重试机制
                if (this.retryCount < CONFIG.RETRY_TIMES) {
                    this.retryCount++;
                    setTimeout(() => this.initPlayer(), CONFIG.RETRY_DELAY);
                }
            }
        }

        // 主入口
        async initialize() {
            try {
                await this.waitForJQuery();

                // 等待页面完全加载后再开始
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        // 额外等待页面稳定
                        setTimeout(() => this.initPlayer(), 1000);
                    });
                } else {
                    // 页面已加载，等待稳定
                    setTimeout(() => this.initPlayer(), 1000);
                }

            } catch (error) {
                console.error("脚本初始化失败:", error);
            }
        }
    }

    // 启动脚本
    new HuyaQualitySwitcher().initialize();

})();
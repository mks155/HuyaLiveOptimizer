<div align="center">
  <img src="https://raw.githubusercontent.com/mks155/HuyaLiveOptimizer/main/docs/icon.svg" alt="虎牙直播优化器" width="76" height="76">
  <h1>虎牙直播优化器 | HuyaLiveOptimizer</h1>
  <p>进直播间自动优化清晰度、弹幕、粉丝牌，进房即生效，无需每次手动点</p>
  <p><sub>Auto-optimize Huya live rooms (quality, danmaku, fan badges) so the right setup is ready the moment the room opens.</sub></p>
  <p>
    <a href="https://scriptcat.org/"><img src="https://img.shields.io/badge/ScriptCat-2f6fed?label=%E9%A6%96%E9%80%89" alt="脚本猫 ScriptCat（首选）"></a>
    <a href="https://www.tampermonkey.net/"><img src="https://img.shields.io/badge/Tampermonkey-42a5f5" alt="Tampermonkey"></a>
    <a href="https://violentmonkey.github.io/"><img src="https://img.shields.io/badge/Violentmonkey-185ABD" alt="Violentmonkey"></a>
  </p>
  <p>
    <a href="https://github.com/mks155/HuyaLiveOptimizer"><img src="https://img.shields.io/github/stars/mks155/HuyaLiveOptimizer?style=social" alt="GitHub Stars"></a>
    <a href="https://github.com/mks155/HuyaLiveOptimizer/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mks155/HuyaLiveOptimizer" alt="MIT License"></a>
  </p>
</div>

---

## 链接

- [作者主页](https://mks155.github.io) — 查看作者其他脚本
- [GitHub 仓库](https://github.com/mks155/HuyaLiveOptimizer) — 欢迎 [Star](https://github.com/mks155/HuyaLiveOptimizer)，反馈请提 [Issue](https://github.com/mks155/HuyaLiveOptimizer/issues)
- **[脚本猫 ScriptCat](https://scriptcat.org/zh-CN/script-show-page/8254)** — 首选推荐
- [Greasy Fork 安装页](https://greasyfork.org/zh-CN/scripts/595617-huyaliveoptimizer-%E8%99%8E%E7%89%99%E7%9B%B4%E6%92%AD%E4%BC%98%E5%8C%96%E5%99%A8)
- [OpenUserJS 安装页](https://openuserjs.org/scripts/mks155/HuyaLiveOptimizer_%E8%99%8E%E7%89%99%E7%9B%B4%E6%92%AD%E4%BC%98%E5%8C%96%E5%99%A8)

## 功能清单

- **免扫码高画质**：自动解锁画质列表里的扫码限制
- **自动切清晰度**：默认最高（可到 4K / 蓝光 50M），也可在设置里固定某一档
- **自动观影模式**：进房自动进入，画面更大更沉浸
- **画面弹幕 +1**：鼠标移到视频弹幕上，一键发同款（鼠标移开自动复原）
- **发送历史**：弹幕输入框按 <kbd>↑</kbd> / <kbd>↓</kbd> 快速找回刚才发过的内容
- **自动切弹幕颜色**：进房 15 秒后，自动把**弹幕颜色**切到能用的最高档
- **自动打卡**：进房 30 秒后，若本房间有粉丝牌则自动签到

## 效果

![设置面板](https://raw.githubusercontent.com/mks155/HuyaLiveOptimizer/main/docs/settings.png)

## 安装

1. 装一个脚本管理器，**首选 [脚本猫 ScriptCat](https://scriptcat.org/)**，也兼容 [Tampermonkey](https://www.tampermonkey.net/) 和 [Violentmonkey](https://violentmonkey.github.io/)
2. 从[脚本猫安装页](https://scriptcat.org/zh-CN/script-show-page/8254)一键装，或手动导入本仓库的 `HuyaLiveOptimizer.user.js`
3. 打开任意 `huya.com` 直播间，进房后一切自动生效

## 怎么设置

播放器下方礼物栏，「贵族」旁边的 **设置**（虎牙优化器图标）：

| 选项 | 说明 |
|------|------|
| 清晰度 | 最高画质，或固定 4K / 2K / 蓝光50M / 30M / 20M / 15M / 10M / 8M / 4M / 超清 / 流畅 |
| 自动进入观影模式 | 默认开启 |
| 画面弹幕悬浮 +1 | 默认开启 |
| 弹幕输入框上下键历史 | 默认开启 |
| 自动佩戴粉丝牌和弹幕颜色 | 默认开启，进房 15 秒后执行 |
| 有粉丝牌则自动打卡 | 默认开启，进房 30 秒后执行 |
| 界面配色 | 默认跟随浏览器，点面板**右上角**的图标切换 |

改完点右侧 **保存并应用** 即可。

> 房间没有你选的那一档时，会自动用当前能用的最高画质。

## 使用小提示

- 弹幕 +1：悬停**视频画面里**滚动的弹幕会定格并出现 +1，点一下发送；鼠标移开即恢复原弹幕
- 历史：焦点在发送框时，<kbd>↑</kbd> 更早、<kbd>↓</kbd> 更新

## License

[MIT](https://raw.githubusercontent.com/mks155/HuyaLiveOptimizer/main/LICENSE) © 2026 [mks155](https://mks155.github.io)
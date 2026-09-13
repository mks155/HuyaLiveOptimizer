# HuyaLiveOptimizer | 虎牙直播优化器

进直播间自动优化画质与观影体验的用户脚本。装好刷新即可，无需每次手动点。

## 链接

- [作者主页](https://mks155.github.io)
- [GitHub 仓库](https://github.com/mks155/HuyaLiveOptimizer) — 欢迎 Star，反馈请提 [Issue](https://github.com/mks155/HuyaLiveOptimizer/issues)
- [Greasy Fork 安装页](https://greasyfork.org/zh-CN/scripts/595617-huyaliveoptimizer-%E8%99%8E%E7%89%99%E7%9B%B4%E6%92%AD%E4%BC%98%E5%8C%96%E5%99%A8)
- [OpenUserJS 安装页](https://openuserjs.org/scripts/mks155/HuyaLiveOptimizer_%E8%99%8E%E7%89%99%E7%9B%B4%E6%92%AD%E4%BC%98%E5%8C%96%E5%99%A8)

## 功能清单

- **免扫码高画质**：自动解锁画质列表里的扫码限制  
- **自动切清晰度**：默认最高（可到 4K / 蓝光 50M），也可在设置里固定某一档  
- **自动观影模式**：进房自动进入，画面更大更沉浸  
- **画面弹幕 +1**：鼠标移到视频弹幕上，一键发同款  
- **发送历史**：弹幕输入框里按 ↑ / ↓ 快速找回刚才发过的内容  

设置对**整个虎牙站**生效，换直播间不用重配。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey  
2. 导入本仓库的 `HuyaLiveOptimizer.user.js`  
3. 打开任意 `huya.com` 直播间  

## 怎么设置

播放器下方礼物栏，「贵族」旁边的 **设置**（六边形螺丝图标）：

| 选项 | 说明 |
|------|------|
| 清晰度 | 最高画质，或固定 4K / 2K / 蓝光50M / 30M / 20M / 10M / 8M / 4M / 超清 / 流畅 |
| 自动进入观影模式 | 默认开启 |
| 画面弹幕悬浮 +1 | 默认开启 |
| 弹幕输入框上下键历史 | 默认开启 |

改完点右侧 **保存并应用** 即可。

> 房间没有你选的那一档时，会自动用当前能用的最高画质。

## 使用小提示

- 弹幕 +1：悬停**视频画面里**滚动的弹幕，右侧出现 +1，点一下发送  
- 历史：焦点在发送框时，↑ 更早、↓ 更新  
- 设置存在本机浏览器里，不上传账号信息  

## License

MIT

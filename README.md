# FreeMedium — Smart Paywall Unlocker (Chrome Extension)

基于 [`inulute/freedium-app`](https://github.com/inulute/freedium-app) 深度改造的个人专属 **Manifest V3 Chrome 浏览器插件**。彻底告别“打开中转网站 → 手动粘贴链接 → 被迫看广告/打赏弹窗”的繁琐流程。

## 核心特性

1. **智能付费墙探测 + 悬浮胶囊按钮 (`content/publisher-detector.js`)**
   - 当你在 Medium（及 Towards Data Science、Better Programming 等子刊）或其余 6 大外媒（NYT、华盛顿邮报、彭博社、路透社、经济学人、金融时报）阅读文章时：
   - **自动解锁**：一旦检测到 `Member-only story` 或订阅付费墙，自动无缝跳转至解锁镜像站。
   - **悬浮胶囊**：页面右下角提供 Shadow DOM 隔离的 `Unlock with FreeMedium` 悬浮按钮，随时一键解锁。
   - **多样触发**：支持右上角插件弹窗、页面/链接右键菜单 (`Unlock with FreeMedium`)、以及快捷键 `Alt+U`。

2. **镜像站去弹窗与广告净化 (`content/mirror-purifier.css`)**
   - 在 `document_start` 阶段自动注入净化样式，屏蔽 `freedium.cfd` / `freedium-mirror.cfd` 等镜像站的 Sonner 公告弹窗、BuyMeACoffee / Ko-fi / Patreon 打赏悬浮框及横幅，以及 `Support Freedium` 打赏模态框（同时解除它造成的页面滚动与点击锁定）。

3. **5 大镜像源自动故障切换 (`service-worker.js` + `content/mirror-enhancer.js`)**
   - 内置 5 个解锁源：`Freedium Mirror`、`Freedium`、`Freedium Web (Vercel)`、`Archive.is (Newest)`、`Archive.is (Oldest)`。
   - 当首选镜像站超过 30 秒未响应，或返回 `Reconnect to read new articles` / `Could not load this article` / `502/404` 错误时，自动切换到下一个可用镜像源（并自动识别非 Medium 域名跳过仅支持 Medium 的 Web 镜像）。

4. **一键复制为 Markdown + 阅读进度记忆 (`content/mirror-enhancer.js`)**
   - 完整移植并增强原项目 Android 端的 DOM-to-Markdown 解析引擎，在镜像阅读页右下角提供悬浮工具栏（或按 `Alt+M` / 右键菜单），一键将文章（含各级标题、代码块语言标识、表格、列表、图片与原文链接）复制为干净的 Markdown。
   - 自动记忆每篇文章的滚动阅读位置，再次打开自动平滑滚动至上次阅读处。

---

## 安装方法（Chrome 开发者模式加载）

1. 打开 Chrome 浏览器，在地址栏输入并访问：`chrome://extensions/`
2. 打开右上角的 **开发者模式 (Developer mode)** 开关。
3. 点击左上角的 **加载已解压的扩展程序 (Load unpacked)**。
4. 选择本项目所在的文件夹 `/Users/jonathan/Antigravity/FreeMedium` 即可生效！

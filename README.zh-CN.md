<p align="center"><img src="icon.svg" width="88" height="88" alt="dsh-trackpad-zoom"></p>

<h1 align="center">dsh-trackpad-zoom</h1>

<p align="center"><b>一个 DeepSeek Harness 客户端插件：用触摸板双指捏合缩放对话区与 Markdown 预览，手感与浏览器一致。</b></p>

<div align="center">

[English](README.md) · [GitHub](https://github.com/Sunshine334419520/dsh-trackpad-zoom) · [安装](#安装) · [设置](#设置)

[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-0f766e.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> DeepSeek Harness 社区插件，非官方产品。

## 特性

- **在哪儿读就在哪儿捏。** 手指放在对话内容上，或放在右栏的 Markdown 预览上，捏合即可。Chromium 会把触摸板捏合映射成 `Ctrl` + 滚轮，本插件只监听这一个手势。
- **放大的是布局，不是重新排版。** 三行还是三行：被缩放的盒子保持每行字符数不变、同时等比变宽，所以 200% 就是 100% 的布局整体放大，而不是一条更窄的栏。
- **以指针为锚点。** 捏合时光标下的内容始终停在光标下，手感与浏览器/Edge 的缩放一致。
- **100%–400%。** 默认渲染就是最小值，手势只会放大；捏回 100% 即复位。
- **各区域分别记忆。** 对话区与 Markdown 预览各自记住比例，刷新页面、切换会话后依然生效。

## 它改变什么

对话区的消息盒子被缩放；底部输入框保持自己的大小，并固定在左缘。右栏里只有 Markdown 预览的正文被缩放——tab 标题、预览工具行和面板框架都保持 100%。

超过 100% 后，被缩放的画布比视口宽，于是它在自己的滚动容器里横向平移，而不是把周围 UI 顶开。

它不碰：

- 图片和 PDF 预览：它们本来就有自己的指针锚定缩放，手势原样交给它们；
- HTML 预览：iframe，不在范围内；
- 输入框、窗口框架和整页缩放。

## 安装

### 插件市场

尚未上架。请走下面的源码路径。

### 命令行

```bash
dsh plugin --profile desktop add "$PWD"
```

在克隆下来的插件目录里执行。

### 源码

```bash
git clone https://github.com/Sunshine334419520/dsh-trackpad-zoom.git
cd dsh-trackpad-zoom
dsh plugin --profile desktop add "$PWD"
```

## 使用

1. 安装后刷新一次 Harness 窗口。
2. 手指放在对话内容上捏合外张，对话会以光标为中心放大。
3. 在右栏打开一个 `.md` 文件，在正文上捏合；它和对话区的比例互不影响。
4. 捏回 100% 即复位任一区域。

> 双指上下滑动仍然是滚动。只有捏合手势（Chromium 报成 `Ctrl` + 滚轮）才会改变比例，阅读位置和滚动都不受影响。

## 设置

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `dsh-trackpad-zoom:chat` | `1` | 对话区比例，`1`–`4`。 |
| `dsh-trackpad-zoom:preview` | `1` | Markdown 预览比例，`1`–`4`。 |

两个键都在渲染进程的 `localStorage` 里，手势停下 200 ms 后写入。删掉某个键（或把该区域捏回 100%）即恢复默认。旧名 `dsh-chat-zoom` 存下的对话比例会在首次加载时继承一次。

## 兼容与限制

- **DeepSeek Harness：** 桌面版，渲染内核为 Chromium 128+（第一个实现标准 CSS `zoom` 的版本）。已在当前桌面版 Chromium 152 上验证。
- **macOS：** 触摸板捏合原生映射为 `Ctrl` + 滚轮，无需配置。
- **Windows / Linux：** 同样走 `Ctrl` + 滚轮路径，按住 `Ctrl` 滚鼠标滚轮也生效。
- **浏览器里的 Web 版：** 手势可用，但浏览器级的缩放快捷键仍归浏览器所有。
- **已知限制：** 缩放会改变布局，所以贴在最新消息上的对话会继续贴底。HTML 预览、纯文本/代码预览不在范围内；本插件只缩放对话区与 Markdown 这两个区域。

## 排错

| 症状 | 修法 |
| --- | --- |
| 对话区捏合没反应 | 在 DevTools 里输入 `window.__dshTrackpadZoom`：`undefined` 说明客户端半边没加载，重装 bundle 后刷新；对象存在且 `chat` 随捏合变化，说明比例生效、问题在命中判定。 |
| Markdown 预览不缩放 | 确认打开的是 `.md` tab，且指针在正文上而不是工具行上；预览比例与对话比例是两个键。 |
| 输入框也跟着缩小 | 那是 0.4 之前的行为，更新到当前版本。 |
| 放大时文字重新折行 | 版本不是 0.4+；早期版本只放大字号、没有同时加宽盒子。 |

## 开发

```bash
git clone https://github.com/Sunshine334419520/dsh-trackpad-zoom.git
dsh plugin --profile desktop add "$PWD"
```

没有构建步骤：`client.js` 是一个通过 `window.__ModuleLoader__` 注册的 ES module，`index.js` 是空的宿主半边。profile 以 link 方式引用该目录，改完刷新页面即生效。模块遵守的规则：工厂函数无副作用，监听器与 observer 都在 `ctx.effect` 内注册并返回清理函数，不在被缩放的盒子之外写 DOM。

## 许可证

MIT © Sunshine334419520，见 [LICENSE](https://github.com/Sunshine334419520/dsh-trackpad-zoom/blob/main/LICENSE)。
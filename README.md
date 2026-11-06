# 洛谷 Markdown → PDF

一个面向洛谷题面与文章的 Markdown → PDF 工具。

项目主要包含两部分：

- **Python 转换器**：读取使用洛谷特有 Markdown 语法的 `.md` 文件，解析成 HTML，使用 KaTeX 渲染公式，最后调用 Edge / Chrome 的无头模式生成 PDF。
- **洛谷 Userscript**：在洛谷题目页、文章页增加「下载 PDF」按钮，整理页面中的正文后直接调用浏览器打印，选择「另存为 PDF」即可保存。

项目的目标不是简单地“把网页打印下来”，而是尽可能保留洛谷题面常见的排版习惯，包括公式、代码块、表格、`::cute-table{tuack}`、折叠框、引言和对齐容器等。

---

## 功能

### 1. Markdown 转 PDF

Python 脚本支持：

- `.md` 文件直接转换为 PDF；
- 传入目录，递归处理目录中的所有 `.md`；
- 支持文件通配符；
- 可指定输出文件或输出目录；
- 可指定 A4 等页面尺寸；
- 自动检测 Microsoft Edge / Google Chrome；
- 支持本地 KaTeX 目录，便于离线渲染公式；
- 可选择保留中间生成的 HTML。

### 2. 洛谷 Markdown 语法

目前重点支持以下语法：

- LaTeX：`$...$` 与 `$$...$$`；
- GFM 风格表格；
- 洛谷表格合并标记：`^`、`<`；
- `::cute-table{tuack}`；
- `:::align{center}` / `:::align{right}`；
- `:::epigraph[署名]`；
- `:::info[...]`、`:::success[...]`、`:::warning[...]`、`:::error[...]`；
- `{open}` 折叠框标记；
- 带语言标记、行号与高亮区间的代码块，例如：

~~~markdown
```cpp line-numbers lines=6-7
#include<bits/stdc++.h>
using namespace std;
int main(){
    return 0;
}
```
~~~

同时支持常见的标题、粗体、斜体、删除线、链接、图片、列表、任务列表、引用和水平分隔线等 Markdown 基础语法。

### 3. 洛谷页面一键打印

Userscript 支持：

- 洛谷题目页；
- 洛谷文章页；
- 单页应用切换题目 / 文章后的重新注入；
- 自动寻找正文区域；
- 自动隐藏导航栏、侧边栏、评论区等无关内容；
- 自动隐藏「复制」等界面按钮；
- 自动展开折叠框，避免打印后正文消失；
- 自动添加题目名 / 文章名；
- A4 页面与合适页边距；
- 尽量避免代码块、表格、图片、样例被分页截断；
- 打印结束后恢复页面原状。

---

## 环境要求

### Python 转换器

- Windows 10 / 11；
- Python 3.8 及以上；
- Microsoft Edge 或 Google Chrome；
- 首次运行需要联网下载 KaTeX，之后会缓存到本地。

**不需要安装第三方 Python 包。**

### Userscript

推荐使用支持 Userscript 的浏览器扩展，例如 Tampermonkey、Violentmonkey 等。

脚本本身使用 `@grant none`，不需要额外权限。

---

## 使用方法

### 一、Python 转换器

假设仓库目录下有 `example.md`。

### 转换单个文件

```bash
python main.py "example.md"
```

默认生成：

```text
example.pdf
```

### 指定输出文件

```bash
python main.py "example.md" -o "out.pdf"
```

### 批量转换一个目录

```bash
python main.py . -o output
```

程序会递归寻找其中的 `.md` 文件，并将 PDF 写入 `output/`。

### 转换多个文件

```bash
python main.py a.md b.md c.md -o output
```

### 保留中间 HTML

```bash
python main.py example.md --keep-html
```

这样可以同时得到 `example.html`，便于调试排版问题。

### 指定浏览器

如果程序没有找到 Edge / Chrome，可以手动指定：

```bash
python main.py example.md --browser "C:\\path\\to\\msedge.exe"
```

### 指定本地 KaTeX

已经准备好 KaTeX `dist` 目录时，可以：

```bash
python main.py example.md --katex-dir "C:\\path\\to\\katex\\dist"
```

此时不需要再从网络下载 KaTeX。

### 调整渲染时间

默认时间预算为 15 秒：

```bash
python main.py example.md --timeout 30
```

---

### 二、洛谷 Userscript

安装 `luogu-download-pdf.user.js` 后：

1. 打开任意洛谷题目或文章；
2. 等页面加载完成；
3. 在题目页的「复制 Markdown」附近，或文章标题附近，可以看到「下载 PDF」；
4. 点击按钮；
5. 浏览器弹出打印窗口；
6. 将目标 / 打印机选择为「另存为 PDF」并保存。

Userscript 的特点是**不修改文章正文**。打印前只会临时调整 DOM 和样式，打印完成后会恢复原状态。

---

## 实现原理

整体流程可以概括为：

```text
                ┌──────────────────────┐
                │   洛谷 Markdown 文件   │
                └──────────┬───────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │   自定义 Markdown 解析  │
                │  标题/表格/代码/容器等  │
                └──────────┬───────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │         HTML         │
                │   + KaTeX 公式渲染    │
                └──────────┬───────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │    Edge / Chrome     │
                │     Headless Print   │
                └──────────┬───────────┘
                           │
                           ▼
                     ┌──────────┐
                     │   PDF    │
                     └──────────┘
```

### Markdown 解析

项目没有依赖完整的 Markdown 第三方库，而是直接用 Python 标准库实现了一套针对洛谷语法的轻量解析器。

解析器先处理块级结构，例如：

- 标题；
- 围栏代码块；
- 行间公式；
- 洛谷容器；
- 引用；
- 列表；
- 表格；
- 普通段落。

之后再在段落、表格单元格和容器内部进行行内解析。

为了避免公式、代码、图片等内容被后续的强调语法误伤，解析过程中使用了占位符临时保护已经生成的 HTML 片段，最后再统一恢复。

### 表格合并

洛谷的部分表格会使用：

- `^` 表示向上合并；
- `<` 表示向左合并。

程序会将其转换成 HTML 的 `rowspan` 与 `colspan`。

`::cute-table{tuack}` 只是改变紧随其后的一个表格的输出样式，使其更接近洛谷常见的 Tuack 三线表风格。

### 公式

项目固定使用 KaTeX `0.16.11` 的资源进行公式渲染，并允许使用本地 KaTeX `dist` 目录覆盖网络资源。

PDF 生成前，HTML 中的公式会在浏览器里完成渲染，因此不会把公式简单地截图成位图。

### PDF 生成

HTML 准备完成后，程序会调用 Edge / Chrome 的 headless 模式，并使用浏览器内置的打印能力输出 PDF。

这种方式可以直接复用浏览器的字体、分页和打印排版能力，同时避免依赖额外的 PDF 生成库。

---

## Userscript 的实现

洛谷是前端渲染的单页应用，因此脚本不能只在页面加载时执行一次。

脚本主要做了三件事：

### 1. 找到正文

题目页优先寻找题目卡片；文章页则根据正文块计算公共祖先，必要时再退回到 `main`、`#app` 或 `body`。

### 2. 打印前清理页面

打印前会临时：

- 隐藏正文根节点祖先链上的无关兄弟节点；
- 隐藏复制按钮等 UI 元素；
- 展开所有 `<details>` 折叠框；
- 在正文顶部插入题目 / 文章标题；
- 注入专门的 `@media print` 样式。

这样可以避免常见的“网页本身很好看，但打印出来导航栏、侧边栏和按钮全混进 PDF”的问题。

### 3. 打印结束后还原

脚本监听 `afterprint` 等事件，并保存所有临时修改，在打印结束后尽量恢复页面状态。

另外，脚本使用 `MutationObserver` 监听 DOM 变化，同时监听路由变化，从而适应洛谷的 SPA 页面切换。

---

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `main.py` | Python Markdown → HTML → PDF 主程序 |
| `luogu-download-pdf.user.js` | 洛谷题目 / 文章一键打印 PDF 的 Userscript |
| `example.md` | 洛谷 Markdown 扩展语法示例 |
| `example.html` | `example.md` 对应的 HTML 输出示例 |
| `example.pdf` | `example.md` 对应的 PDF 输出示例 |

---

## 已知限制

这是一个针对**洛谷题面 / 文章场景**编写的转换器，不以完整实现所有 Markdown 方言为目标。

因此遇到洛谷尚未覆盖、语法结构非常特殊，或依赖网页端特定组件行为的 Markdown 时，可能仍需要调整解析器。

Userscript 也依赖洛谷当前页面的 DOM 结构。洛谷网站前端结构发生较大变化后，按钮定位和正文识别规则可能需要更新。

另外，Python 版本的 PDF 生成依赖本机 Edge / Chrome；如果系统没有可用的 Chromium 系浏览器，则无法完成最后的打印步骤。

---

## 示例

仓库中的 `example.md` 刻意覆盖了项目支持的多种语法，包括：

- Markdown 基础格式；
- 代码行号和代码高亮；
- 普通表格与单元格合并；
- `::cute-table{tuack}`；
- LaTeX 公式；
- 居中 / 居右容器；
- 引言；
- 多种折叠框。

可以直接运行：

```bash
python main.py example.md --keep-html
```

然后对照 `example.html` 与 `example.pdf` 检查渲染结果。

---

## 致谢

- [洛谷](https://www.luogu.com.cn/)：项目所针对的题面与文章环境；
- [KaTeX](https://katex.org/)：LaTeX 公式渲染；
- Microsoft Edge / Google Chrome：HTML 无头打印与 PDF 生成。

## 讨饭

这个项目消耗了我大量的 token。

点击 [这里](https://cdn.luogu.com.cn/upload/image_hosting/uissxqga.webp) 以鼓励我持续产出项目。

不愿意就算啦，谢谢你喵。
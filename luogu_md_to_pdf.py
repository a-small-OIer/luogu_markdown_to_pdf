#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
luogu_md_to_pdf.py —— 将使用「洛谷特有 Markdown 语法」的 .md 文件转换为 PDF。

原理
----
1. 用纯 Python 标准库把洛谷 Markdown 解析成 HTML（不依赖 pip 包）。
2. 用 KaTeX 在无头浏览器里渲染 LaTeX 公式（支持 $...$ 与 $$...$$）。
3. 用 Windows 自带的 Edge / Chrome 无头模式把 HTML 打印成 PDF。

运行环境要求
------------
- Windows 10 / 11（自带 Microsoft Edge）。
- Python 3.8+（无需安装任何第三方库）。
- 首次运行需要联网（用于下载 KaTeX；之后会缓存到本地，离线也可用）。

用法示例
--------
    python luogu_md_to_pdf.py "P14362 [CSP-S 2025] 道路修复.md"
    python luogu_md_to_pdf.py "学习笔记：从 0 到 Pólya 原理.md" -o out.pdf
    python luogu_md_to_pdf.py .                 # 转换目录下所有 .md
    python luogu_md_to_pdf.py *.md              # 转换多个文件
    python luogu_md_to_pdf.py a.md --keep-html  # 保留中间 HTML 文件

支持的洛谷扩展语法
------------------
- LaTeX 公式：$...$（行内）、$$...$$（行间），支持 \\color、\\text、
  \\operatorname、\\begin{pmatrix} 等（由 KaTeX 渲染）。
- 表格：GFM 表格 + 洛谷「^ 向上合并 / < 向左合并」。
- ::cute-table{tuack}：渲染成仿 Tuack 的表格（内部竖线 + 横线，表头与上下边线加粗，无底色）。
- :::align{center} / :::align{right}：居中 / 居右排版。
- :::epigraph[署名]：引言。
- :::info / :::success / :::warning / :::error[标题]{open}：折叠框（PDF 中始终展开）。
- 代码块：```lang、line-numbers、lines=起-止 高亮参数。
- 其余 CommonMark / GFM 基础语法。
"""

import argparse
import glob
import html
import os
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

KATEX_VERSION = "0.16.11"
KATEX_CDN_BASE = "https://cdn.jsdelivr.net/npm/katex@" + KATEX_VERSION + "/dist"

# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def esc(text):
    """转义 HTML 文本中的 & < >（用于普通文本节点）。"""
    return html.escape(text, quote=False)


def attr_esc(text):
    """转义属性值（URL 等）。"""
    return html.escape(text, quote=True)


class _Placeholder:
    """用不可见占位符保护一段已处理好的 HTML，避免被后续正则误伤。"""

    def __init__(self):
        self.store = []

    def protect(self, raw_html):
        self.store.append(raw_html)
        return "\x00%d\x00" % (len(self.store) - 1)

    def restore(self, text):
        def rep(m):
            return self.store[int(m.group(1))]

        return re.sub(r"\x00(\d+)\x00", rep, text)


# ---------------------------------------------------------------------------
# 行内解析
# ---------------------------------------------------------------------------

_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
# 行内公式：$...$，排除 $$，支持内容里的转义（如 \$）。
_INLINE_MATH_RE = re.compile(r"\$(?!\$)((?:[^$\\\n]|\\.)+?)\$")
# 反斜杠转义（洛谷手册列出的可转义符号，外加 >）。
_ESCAPE_RE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!>])")
# 图片：![alt](url "title")
_IMAGE_RE = re.compile(r"!\[([^\[\]\n]*)\]\(([^)\s]+)(?:[ \t]+['\"]([^'\"]*)['\"])?\)")
# 自动链接：<http(s)://...>、<mailto:...>、<邮箱>
_AUTOLINK_RE = re.compile(
    r"<((?:https?|ftp)://[^>\s]+|mailto:[^>\s]+|"
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})>"
)
# 链接：[text](url "title")，text 允许嵌套一层方括号（如 [[AHOI2002] 黑白瓷砖]）。
_LINK_RE = re.compile(
    r"\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]"
    r"\(([^)\s]+)(?:[ \t]+['\"]([^'\"]*)['\"])?\)"
)


def render_emphasis(text):
    """处理粗体 / 斜体 / 删除线。代码、公式等已被占位符保护。"""
    text = re.sub(r"\*\*\*([^*]+)\*\*\*", r"<strong><em>\1</em></strong>", text)
    text = re.sub(r"(?<!\w)___([^_]+)___(?!\w)", r"<strong><em>\1</em></strong>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\w)__([^_]+)__(?!\w)", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"(?<![A-Za-z0-9])_([^_]+?)_(?![A-Za-z0-9])", r"<em>\1</em>", text)
    text = re.sub(r"~~([^~]+?)~~", r"<del>\1</del>", text)
    return text


def _title_attr(m):
    return (' title="%s"' % esc(m.group(3))) if m.group(3) else ""


def _link_inner(text):
    """链接文字：先渲染强调，再转义残留的 & < >。"""
    text = render_emphasis(text)
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_inline(text, ph=None):
    if ph is None:
        ph = _Placeholder()

    # 1) 行内代码（优先，保护其中内容）
    text = _INLINE_CODE_RE.sub(
        lambda m: ph.protect("<code>%s</code>" % esc(m.group(1))), text
    )
    # 2) 行内公式（保护，避免 _ * 等被强调规则误伤）
    text = _INLINE_MATH_RE.sub(
        lambda m: ph.protect("$%s$" % esc(m.group(1))), text
    )
    # 3) 换行：行末两个空格或反斜杠 → 硬换行 <br>；普通换行 → 空格
    text = re.sub(r"[ \t]{2,}\n", lambda m: ph.protect("<br>"), text)
    text = re.sub(r"\\\n", lambda m: ph.protect("<br>"), text)
    text = re.sub(r"\n", " ", text)
    # 4) 反斜杠转义
    text = _ESCAPE_RE.sub(lambda m: ph.protect(esc(m.group(1))), text)
    # 5) 图片、自动链接、链接
    text = _IMAGE_RE.sub(
        lambda m: ph.protect(
            '<img src="%s" alt="%s"%s>'
            % (attr_esc(m.group(2)), esc(m.group(1)), _title_attr(m))
        ),
        text,
    )
    text = _AUTOLINK_RE.sub(
        lambda m: ph.protect(
            '<a href="%s">%s</a>' % (attr_esc(m.group(1)), esc(m.group(1)))
        ),
        text,
    )
    text = _LINK_RE.sub(
        lambda m: ph.protect(
            '<a href="%s"%s>%s</a>'
            % (attr_esc(m.group(2)), _title_attr(m), _link_inner(m.group(1)))
        ),
        text,
    )
    # 6) 转义残留的裸 & < >（此时 URL、代码、公式都已被保护）
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # 7) 强调
    text = render_emphasis(text)
    # 8) 还原占位符
    return ph.restore(text)


# ---------------------------------------------------------------------------
# 块级解析
# ---------------------------------------------------------------------------

_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})(?:[ \t]+|$)(.*)$")
_FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
_HR_RE = re.compile(r"^\s{0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$")
_DIRECTIVE_RE = re.compile(
    r"^\s{0,3}(:{2,})([A-Za-z0-9_-]+)(\[[^\]]*\])?(\{[^}]*\})?\s*$"
)
_LIST_UL_RE = re.compile(r"^([ \t]*)([-+*])([ \t]+)(.*)$")
_LIST_OL_RE = re.compile(r"^([ \t]*)(\d{1,9})([.)])([ \t]+)(.*)$")


def _indent_width(s):
    w = 0
    for ch in s:
        if ch == " ":
            w += 1
        elif ch == "\t":
            w += 4 - (w % 4)
        else:
            break
    return w


def _looks_like_block(lines, j, end):
    ln = lines[j]
    if _HEADING_RE.match(ln):
        return True
    if _FENCE_RE.match(ln):
        return True
    if _HR_RE.match(ln):
        return True
    if ln.lstrip().startswith("$$"):
        return True
    if _DIRECTIVE_RE.match(ln):
        return True
    if re.match(r"^\s{0,3}>", ln):
        return True
    if _LIST_UL_RE.match(ln) or _LIST_OL_RE.match(ln):
        return True
    if _is_table_start(lines, j, end):
        return True
    return False


def _parse(lines, start, end):
    out = []
    i = start
    cute = False  # 是否处于 ::cute-table{tuack} 标记之后（下一个表格用 Tuack 三线表样式）
    while i < end:
        line = lines[i]

        # 空行
        if not line.strip():
            i += 1
            continue

        # 标题
        hm = _HEADING_RE.match(line)
        if hm:
            level = len(hm.group(1))
            text = hm.group(2).strip()
            text = re.sub(r"[ \t]+#+[ \t]*$", "", text)  # 去掉可选的结尾 #
            out.append("<h%d>%s</h%d>" % (level, render_inline(text), level))
            i += 1
            continue

        # 围栏代码块
        fm = _FENCE_RE.match(line)
        if fm:
            fence = fm.group(1)
            ch = fence[0]
            length = len(fence)
            info = fm.group(2).strip()
            j = i + 1
            code_lines = []
            close_re = re.compile(
                r"^\s{0,3}(%s{%d,}|%s{%d,})\s*$" % (ch, length, ch, length)
            )
            while j < end:
                if close_re.match(lines[j]):
                    break
                code_lines.append(lines[j])
                j += 1
            out.append(render_code_block(info, "\n".join(code_lines)))
            i = j + 1
            continue

        # 行间公式 $$
        if line.lstrip().startswith("$$"):
            single = re.match(r"^\s*\$\$(.*?)\$\$\s*$", line)
            if single:
                out.append(
                    '<div class="math-display">$$%s$$</div>' % esc(single.group(1))
                )
                i += 1
            else:
                j = i + 1
                content = []
                while j < end and lines[j].strip() != "$$":
                    content.append(lines[j])
                    j += 1
                j += 1  # 跳过结尾的 $$
                out.append(
                    '<div class="math-display">$$%s$$</div>'
                    % esc("\n".join(content))
                )
                i = j
            continue

        # 洛谷容器 / 指令（:::align、::::info、::cute-table 等）
        if _DIRECTIVE_RE.match(line):
            res = _parse_directive(lines, i, end)
            if res is not None:
                frag, j, name = res
                if name == "cute-table":
                    cute = True
                if frag:
                    out.append(frag)
                i = j
                continue

        # 引用块
        if re.match(r"^\s{0,3}>", line):
            j = i
            buf = []
            while j < end and re.match(r"^\s{0,3}>", lines[j]):
                buf.append(re.sub(r"^\s{0,3}>\s?", "", lines[j]))
                j += 1
            out.append("<blockquote>\n%s\n</blockquote>" % _parse(buf, 0, len(buf)))
            i = j
            continue

        # 列表
        if _LIST_UL_RE.match(line) or _LIST_OL_RE.match(line):
            lst_html, j = _parse_list(lines, i, end)
            out.append(lst_html)
            i = j
            continue

        # 水平分隔线
        if _HR_RE.match(line):
            out.append("<hr>")
            i += 1
            continue

        # 表格
        if _is_table_start(lines, i, end):
            tbl_html, j = _parse_table(lines, i, end, cute)
            cute = False
            out.append(tbl_html)
            i = j
            continue

        # 普通段落
        buf = [line]
        j = i + 1
        while j < end:
            ln = lines[j]
            if not ln.strip():
                break
            if _looks_like_block(lines, j, end):
                break
            buf.append(ln)
            j += 1
        out.append("<p>%s</p>" % render_inline("\n".join(buf)))
        i = j

    return "\n".join(out)


# ---------------------------------------------------------------------------
# 代码块
# ---------------------------------------------------------------------------


def render_code_block(info, code):
    tokens = info.split()
    lang = tokens[0] if tokens else ""
    options = tokens[1:]
    show_ln = "line-numbers" in options
    highlight = set()
    for opt in options:
        m = re.match(r"^lines=(\d+)(?:-(\d+))?$", opt)
        if m:
            a = int(m.group(1))
            b = int(m.group(2) or a)
            highlight.update(range(a, b + 1))

    lines = code.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]

    parts = []
    for idx, ln in enumerate(lines, 1):
        cls = "cl"
        if idx in highlight:
            cls += " hl"
        content = esc(ln) if ln else "&#8203;"
        if show_ln:
            parts.append(
                '<span class="%s"><span class="ln">%d</span>%s</span>'
                % (cls, idx, content)
            )
        else:
            parts.append('<span class="%s">%s</span>' % (cls, content))

    classes = "code-block"
    if show_ln:
        classes += " line-numbers"
    lang_class = 'class="language-%s"' % (lang or "cpp")
    return '<pre class="%s"><code %s>%s</code></pre>' % (
        classes,
        lang_class,
        "".join(parts),
    )


# ---------------------------------------------------------------------------
# 表格
# ---------------------------------------------------------------------------


def _is_table_start(lines, i, end):
    if i + 1 >= end:
        return False
    if "|" not in lines[i]:
        return False
    d = lines[i + 1].strip()
    # 洛谷（markdown-it）允许分隔行单元格只有 1 个以上连字符（如 :--:），比 GFM 更宽松。
    return bool(re.match(r"^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$", d))


def _split_table_row(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    cells = []
    cur = []
    k = 0
    while k < len(s):
        c = s[k]
        if c == "\\" and k + 1 < len(s) and s[k + 1] == "|":
            cur.append("|")
            k += 2
            continue
        if c == "|":
            cells.append("".join(cur).strip())
            cur = []
            k += 1
            continue
        cur.append(c)
        k += 1
    cells.append("".join(cur).strip())
    return cells


def _align_of(cell):
    cell = cell.strip()
    left = cell.startswith(":")
    right = cell.endswith(":")
    if left and right:
        return "center"
    if right:
        return "right"
    return "left"


def _parse_table(lines, i, end, cute=False):
    header = _split_table_row(lines[i])
    delim = _split_table_row(lines[i + 1])
    aligns = [_align_of(c) for c in delim]
    body = []
    j = i + 2
    while j < end:
        ln = lines[j]
        if not ln.strip() or "|" not in ln:
            break
        body.append(_split_table_row(ln))
        j += 1
    return _render_table(header, body, aligns, cute), j


def _render_table(header, body, aligns, cute=False):
    rows = [header] + body
    ncols = max(len(r) for r in rows)
    nrows = len(rows)
    grid = [[r[c] if c < len(r) else "" for c in range(ncols)] for r in rows]
    skip = [[False] * ncols for _ in range(nrows)]

    out = []
    for r in range(nrows):
        tds = []
        c = 0
        while c < ncols:
            if skip[r][c]:
                c += 1
                continue
            raw = grid[r][c].strip()
            if raw in ("^", "<"):
                # 孤立合并标记（如第一行就出现），忽略
                c += 1
                continue
            colspan = 1
            cc = c + 1
            while cc < ncols and grid[r][cc].strip() == "<":
                skip[r][cc] = True
                colspan += 1
                cc += 1
            rowspan = 1
            rr = r + 1
            while rr < nrows and grid[rr][c].strip() == "^":
                skip[rr][c] = True
                rowspan += 1
                rr += 1
            align = aligns[c] if c < len(aligns) else "left"
            tag = "th" if r == 0 else "td"
            attrs = ""
            if colspan > 1:
                attrs += ' colspan="%d"' % colspan
            if rowspan > 1:
                attrs += ' rowspan="%d"' % rowspan
            if align != "left":
                attrs += ' style="text-align:%s"' % align
            tds.append("<%s%s>%s</%s>" % (tag, attrs, render_inline(raw), tag))
            c += colspan
        out.append("<tr>%s</tr>" % "".join(tds))

    cls = "markdown-table cute-table" if cute else "markdown-table"
    return (
        '<table class="%s"><thead>%s</thead><tbody>%s</tbody></table>'
        % (cls, out[0], "".join(out[1:]))
    )


# ---------------------------------------------------------------------------
# 列表
# ---------------------------------------------------------------------------


def _parse_list(lines, start, end):
    ordered = _LIST_OL_RE.match(lines[start]) is not None
    items = []
    j = start
    while j < end:
        ul = _LIST_UL_RE.match(lines[j])
        ol = _LIST_OL_RE.match(lines[j])
        if not ul and not ol:
            break
        if bool(ol) != ordered:
            break  # 类型切换，交给外层重新识别

        if ul:
            content = ul.group(4)
            marker_len = len(ul.group(0)) - len(ul.group(4))
        else:
            content = ol.group(5)
            marker_len = len(ol.group(0)) - len(ol.group(5))
        content_col = marker_len  # 相对缩进，首行已去掉缩进

        item_lines = [content]
        j += 1
        while j < end:
            ln = lines[j]
            if ln.strip() == "":
                k = j
                while k < end and lines[k].strip() == "":
                    k += 1
                if k < end and _indent_width(lines[k]) >= content_col:
                    item_lines.extend(lines[j:k])
                    j = k
                    continue
                break
            if _indent_width(ln) >= content_col:
                item_lines.append(ln)
                j += 1
                continue
            break

        # 任务列表：- [ ] / - [x]
        task_checked = None
        if not ordered:
            tm = re.match(r"^\[([ xX])\][ \t]+(.*)$", content)
            if tm:
                task_checked = tm.group(1).lower() == "x"
                content = tm.group(2)
                item_lines[0] = content

        inner = _parse(item_lines, 0, len(item_lines))
        if task_checked is not None:
            box = "&#9745;" if task_checked else "&#9744;"
            inner = '<span class="task-check">%s</span>%s' % (box, inner)
        items.append("<li>%s</li>" % inner)

    tag = "ol" if ordered else "ul"
    return "<%s>\n%s\n</%s>" % (tag, "\n".join(items), tag), j


# ---------------------------------------------------------------------------
# 洛谷容器 / 指令
# ---------------------------------------------------------------------------


def _parse_directive(lines, i, end):
    m = _DIRECTIVE_RE.match(lines[i])
    if not m:
        return None
    colons = len(m.group(1))
    name = m.group(2)
    title = m.group(3)[1:-1] if m.group(3) else ""
    params = m.group(4)[1:-1] if m.group(4) else ""

    # 两个冒号的指令是单行标记（如 ::cute-table{tuack}），返回指令名供外层处理。
    if colons == 2:
        return ("", i + 1, name)

    close_re = re.compile(r"^\s{0,3}:{%d}\s*$" % colons)
    j = i + 1
    while j < end:
        if close_re.match(lines[j]):
            break
        j += 1
    if j >= end:
        return None  # 未闭合，交给段落处理

    inner = _parse(lines, i + 1, j)
    return (_render_container(name, title, params, inner), j + 1, name)


_CALLOUT_DEFAULT_TITLE = {
    "info": "提示",
    "success": "成功",
    "warning": "警告",
    "error": "错误",
}


def _render_container(name, title, params, inner):
    if name == "align":
        a = "center"
        if "right" in params:
            a = "right"
        elif "left" in params:
            a = "left"
        return '<div style="text-align:%s">\n%s\n</div>' % (a, inner)

    if name == "epigraph":
        title_html = render_inline(title) if title else ""
        attr = (
            '<div class="epigraph-attr">%s</div>' % title_html if title_html else ""
        )
        return '<blockquote class="epigraph">\n%s\n%s\n</blockquote>' % (inner, attr)

    if name in _CALLOUT_DEFAULT_TITLE:
        title_html = render_inline(title) if title else _CALLOUT_DEFAULT_TITLE[name]
        return (
            '<div class="callout callout-%s">\n'
            '<div class="callout-title">%s</div>\n'
            '<div class="callout-body">%s</div>\n</div>'
            % (name, title_html, inner)
        )

    return '<div class="container-%s">\n%s\n</div>' % (name, inner)


# ---------------------------------------------------------------------------
# KaTeX 资源（优先本地缓存，失败回退 CDN）
# ---------------------------------------------------------------------------


def _cdn_urls():
    return {
        "css": KATEX_CDN_BASE + "/katex.min.css",
        "js": KATEX_CDN_BASE + "/katex.min.js",
        "autorender": KATEX_CDN_BASE + "/contrib/auto-render.min.js",
    }


def _fetch_katex(cache_dir):
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        tgz = cache_dir / ("katex-%s.tgz" % KATEX_VERSION)
        url = "https://registry.npmjs.org/katex/-/katex-%s.tgz" % KATEX_VERSION
        req = urllib.request.Request(url, headers={"User-Agent": "luogu-md2pdf/1.0"})
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp, open(
            tgz, "wb"
        ) as fh:
            shutil.copyfileobj(resp, fh)
        with tarfile.open(tgz, "r:gz") as tf:
            tf.extractall(cache_dir)
        tgz.unlink(missing_ok=True)
        return (cache_dir / "package" / "dist" / "katex.min.css").is_file()
    except Exception as exc:  # noqa: BLE001
        print("警告：下载 KaTeX 失败（%s），将改用 CDN。" % exc, file=sys.stderr)
        return False


def katex_urls(katex_dir_override):
    if katex_dir_override:
        base = Path(katex_dir_override).resolve()
        return {
            "css": (base / "katex.min.css").as_uri(),
            "js": (base / "katex.min.js").as_uri(),
            "autorender": (base / "contrib" / "auto-render.min.js").as_uri(),
        }

    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home())))
    cache = local / "luogu-md2pdf" / ("katex-" + KATEX_VERSION)
    dist = cache / "package" / "dist"
    if not (dist / "katex.min.css").is_file():
        if not _fetch_katex(cache):
            return _cdn_urls()
    return {
        "css": (dist / "katex.min.css").as_uri(),
        "js": (dist / "katex.min.js").as_uri(),
        "autorender": (dist / "contrib" / "auto-render.min.js").as_uri(),
    }


# ---------------------------------------------------------------------------
# HTML 模板与 CSS
# ---------------------------------------------------------------------------

_CSS = """
@page {{ size: {page_size}; margin: 20mm 18mm; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; }}
body {{
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC",
               "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.7;
  color: #1f2328;
}}
h1, h2, h3, h4, h5, h6 {{
  color: #111; line-height: 1.35; margin: 1.15em 0 0.55em; font-weight: 600;
}}
h1 {{ font-size: 1.65em; border-bottom: 2px solid #eaecef; padding-bottom: 0.25em; }}
h2 {{ font-size: 1.4em; border-bottom: 1px solid #eaecef; padding-bottom: 0.2em; }}
h3 {{ font-size: 1.2em; }}
h4 {{ font-size: 1.05em; }}
h5 {{ font-size: 1em; }}
h6 {{ font-size: 0.92em; color: #555; }}
p {{ margin: 0.6em 0; }}
a {{ color: #0b66c3; text-decoration: none; }}
code {{
  font-family: Consolas, "SF Mono", Menlo, "Courier New", monospace;
  background: rgba(27,31,35,0.07); padding: 0.1em 0.35em;
  border-radius: 3px; font-size: 0.9em;
}}
pre {{ margin: 0.85em 0; page-break-inside: avoid; }}
pre.code-block {{
  background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px;
  padding: 10px 14px; overflow-x: hidden;
}}
pre.code-block code {{
  background: transparent; padding: 0; font-size: 0.85em; line-height: 1.5;
  color: #24292f; white-space: normal;
}}
pre.code-block .cl {{ display: block; white-space: pre; }}
pre.code-block .ln {{
  display: inline-block; min-width: 2.2em; margin-right: 0.9em;
  text-align: right; color: #9aa0a6; user-select: none;
}}
pre.code-block .cl.hl {{ background: #fff3cd; }}
blockquote {{
  margin: 0.85em 0; padding: 0.4em 1em; border-left: 4px solid #d0d7de;
  color: #57606a; background: #f6f8fa;
}}
blockquote p {{ margin: 0.3em 0; }}
hr {{ border: none; border-top: 1px solid #d0d7de; margin: 1.4em 0; }}
ul, ol {{ margin: 0.6em 0; padding-left: 1.6em; }}
li {{ margin: 0.25em 0; }}
li > ul, li > ol {{ margin: 0.2em 0; }}
table.markdown-table {{
  border-collapse: collapse; margin: 0.9em 0; width: 100%; font-size: 0.95em;
}}
table.markdown-table th, table.markdown-table td {{
  border: 1px solid #d0d7de; padding: 6px 10px;
}}
table.markdown-table th {{ background: #f6f8fa; font-weight: 600; }}
table.markdown-table tr {{ page-break-inside: avoid; }}
table.markdown-table tbody tr:nth-child(even) td {{ background: #fafbfc; }}
/* ::cute-table 标记：仿 Tuack 的表格（内部竖线 + 横线，表头分隔线与上下边线加粗，无底色，
   且不画左右外框 —— 与洛谷网页渲染一致）。 */
table.cute-table {{
  border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em;
  border-top: 3px solid #000; border-bottom: 3px solid #000;
}}
table.cute-table th, table.cute-table td {{
  border: none; border-bottom: 1px solid #000; border-left: 1px solid #000;
  padding: 6px 12px; background: transparent;
}}
table.cute-table th:first-child, table.cute-table td:first-child {{ border-left: none; }}
table.cute-table th {{ background: transparent; font-weight: normal; }}
table.cute-table thead th {{ border-bottom: 2px solid #000; }}
table.cute-table tbody tr:nth-child(even) td {{ background: transparent; }}
.math-display {{ margin: 0.9em 0; text-align: center; overflow-x: auto; }}
img {{ max-width: 100%; }}
.callout {{
  border: 1px solid; border-radius: 6px; margin: 0.9em 0; page-break-inside: avoid;
}}
.callout-title {{
  font-weight: 600; padding: 7px 12px; border-bottom: 1px solid rgba(0,0,0,0.07);
}}
.callout-body {{ padding: 8px 12px; }}
.callout-info {{ border-color: #b6d4fe; background: #f0f7ff; }}
.callout-info .callout-title {{ color: #0b5cab; }}
.callout-success {{ border-color: #b7e1b8; background: #f2fbf2; }}
.callout-success .callout-title {{ color: #1a7f37; }}
.callout-warning {{ border-color: #ffe0a3; background: #fffaf0; }}
.callout-warning .callout-title {{ color: #9a6700; }}
.callout-error {{ border-color: #f5b7b1; background: #fff5f4; }}
.callout-error .callout-title {{ color: #c0392b; }}
.epigraph {{ border-left: 4px solid #9a6700; background: #fffaf0; }}
.epigraph-attr {{
  text-align: right; font-style: italic; color: #6a737d; margin-top: 0.4em;
}}
.task-check {{ margin-right: 0.3em; }}
del {{ color: #6a737d; }}
""".format


_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="{css}">
<script defer src="{js}"></script>
<script defer src="{autorender}" onload="renderMathInElement(document.body,{{
  delimiters: [
    {{left: '$$', right: '$$', display: true}},
    {{left: '$', right: '$', display: false}}
  ],
  throwOnError: false,
  strict: false
}});"></script>
<style>{style}</style>
</head>
<body>
{body}
</body>
</html>
"""


def build_html(body, katex, page_size="A4"):
    return _HTML_TEMPLATE.format(
        css=katex["css"],
        js=katex["js"],
        autorender=katex["autorender"],
        style=_CSS(page_size=page_size),
        body=body,
    )


# ---------------------------------------------------------------------------
# 浏览器与 PDF
# ---------------------------------------------------------------------------


def find_browser(explicit=None):
    if explicit:
        p = Path(explicit)
        if p.is_file():
            return str(p)
        print("错误：找不到浏览器 %s" % explicit, file=sys.stderr)
        return None
    candidates = [
        os.environ.get("LUGUO_MD2PDF_BROWSER"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    return None


def html_to_pdf(html_path, pdf_path, browser, budget_ms):
    url = Path(html_path).resolve().as_uri()
    tmp_profile = tempfile.mkdtemp(prefix="luogu-md2pdf-profile-")
    cmd = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=%d" % budget_ms,
        "--no-pdf-header-footer",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--user-data-dir=%s" % tmp_profile,
        "--print-to-pdf=%s" % str(Path(pdf_path).resolve()),
        url,
    ]
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=(budget_ms // 1000 + 120),
        )
        ok = proc.returncode == 0 and Path(pdf_path).is_file() and Path(pdf_path).stat().st_size > 0
    except subprocess.TimeoutExpired:
        ok = False
    finally:
        shutil.rmtree(tmp_profile, ignore_errors=True)
    return ok


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def _add_files(files, paths):
    for p in paths:
        p = Path(p)
        if p.is_dir():
            files.extend(sorted(p.rglob("*.md")))
        elif p.is_file() and p.suffix.lower() == ".md":
            files.append(p)
    return files


def collect_md(inputs):
    files = []
    for inp in inputs:
        p = Path(inp)
        if p.is_dir() or p.is_file():
            # 优先按字面路径处理（文件名里可能含 [ ] 等通配符字符）
            _add_files(files, [p])
        elif any(ch in inp for ch in "*?["):
            # 用 glob 模块以支持绝对路径通配符（含递归 **）
            _add_files(files, glob.glob(inp, recursive=True))
        else:
            print("跳过不存在的输入：%s" % inp, file=sys.stderr)
    seen = set()
    result = []
    for f in files:
        r = f.resolve()
        if r not in seen:
            seen.add(r)
            result.append(r)
    return result


def determine_outputs(md_files, output):
    if output:
        out = Path(output)
        if len(md_files) == 1 and out.suffix.lower() == ".pdf":
            return [out]
        out.mkdir(parents=True, exist_ok=True)
        return [out / (f.stem + ".pdf") for f in md_files]
    return [f.with_suffix(".pdf") for f in md_files]


def luogu_to_html(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    return _parse(lines, 0, len(lines))


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="将使用洛谷特有 Markdown 语法的 .md 文件转换为 PDF。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例：\n"
        '  python luogu_md_to_pdf.py "题目.md"\n'
        '  python luogu_md_to_pdf.py . -o 输出目录\n'
        "  python luogu_md_to_pdf.py a.md --browser \"C:\\\\path\\\\chrome.exe\"\n"
        "  python luogu_md_to_pdf.py a.md --katex-dir C:\\\\katex\\\\dist  # 离线",
    )
    ap.add_argument(
        "inputs", nargs="+", metavar="INPUT", help=".md 文件、目录（递归所有 .md）或通配符"
    )
    ap.add_argument("-o", "--output", help="输出 PDF 路径（单个输入）或输出目录（多个输入）")
    ap.add_argument("--page-size", default="A4", help="页面尺寸，默认 A4")
    ap.add_argument("--browser", help="Edge / Chrome 可执行文件路径（默认自动探测）")
    ap.add_argument("--katex-dir", help="本地 KaTeX dist 目录（离线渲染公式）")
    ap.add_argument("--keep-html", action="store_true", help="保留中间生成的 .html 文件")
    ap.add_argument("--timeout", type=int, default=15, help="渲染时间预算（秒），默认 15")
    args = ap.parse_args(argv)

    md_files = collect_md(args.inputs)
    if not md_files:
        print("未找到任何 .md 文件。", file=sys.stderr)
        return 1

    browser = find_browser(args.browser)
    if not browser:
        print(
            "错误：未找到 Edge / Chrome。请用 --browser 指定浏览器路径。",
            file=sys.stderr,
        )
        return 2

    katex = katex_urls(args.katex_dir)
    outputs = determine_outputs(md_files, args.output)
    budget_ms = max(5000, args.timeout * 1000)

    failed = 0
    for md, pdf in zip(md_files, outputs):
        print("转换：%s  ->  %s" % (md, pdf))
        try:
            text = md.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = md.read_text(encoding="gbk", errors="replace")

        body = luogu_to_html(text)
        html_doc = build_html(body, katex, args.page_size)

        html_path = None
        tmpdir = None
        try:
            if args.keep_html:
                html_path = pdf.with_suffix(".html")
                html_path.write_text(html_doc, encoding="utf-8")
            else:
                tmpdir = tempfile.mkdtemp(prefix="luogu-md2pdf-")
                html_path = Path(tmpdir) / "page.html"
                html_path.write_text(html_doc, encoding="utf-8")

            if html_to_pdf(str(html_path), str(pdf), browser, budget_ms):
                print("  完成（%d 字节）。" % pdf.stat().st_size)
            else:
                print("  失败：浏览器未能生成 PDF。", file=sys.stderr)
                failed += 1
        finally:
            if tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)

    if failed:
        print("有 %d 个文件转换失败。" % failed, file=sys.stderr)
        return 1
    print("全部完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

// ==UserScript==
// @name         洛谷 Markdown → PDF (内置 KaTeX)
// @namespace    https://www.luogu.com.cn/
// @version      1.3.2
// @description  在洛谷题目 / 专栏页把「洛谷扩展 Markdown」渲染成单栏排版并调起浏览器打印，另存为 PDF
// @author       you
// @match        https://www.luogu.com.cn/problem/*
// @match        https://www.luogu.com.cn/article/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ======================================================================
   * 0. 常量
   * ==================================================================== */

  // 与洛谷一致的版本：洛谷 KaTeX CSS 里写着 .katex-version::after{content:"0.18.7"}。
  // 0.17 起 KaTeX 重写了 HTML 输出（base→katex-base、去掉 MathML 层、strut/行内对齐都变了），
  // 版本不一致公式看起来就和洛谷不一样。
  // CSS / JS / 字体全部打包在本文件末尾（gzip + base64），运行时不需要任何网络请求。
  const KATEX_VERSION = '0.18.7';

  const SCRIPT_VERSION = '1.3.2';
  const BTN_ATTR = 'data-lgpdf-btn';
  const BTN_STYLE_ID = 'lgpdf-ui-style';
  const BTN_TITLE =
    'v' + SCRIPT_VERSION + ' · KaTeX ' + KATEX_VERSION + ' 内置 · ' +
    '抓取页面 Markdown，用与本地 Python 脚本一致的解析器渲染成单栏排版后调起打印；' +
    '在打印对话框里把「目标 / 打印机」选为「另存为 PDF」即可保存。';

  /* ======================================================================
   * 1. 小工具
   * ==================================================================== */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function attrEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function titleAttr(t) {
    return t ? ' title="' + esc(t) + '"' : '';
  }

  class Placeholder {
    constructor() {
      this.store = [];
    }
    protect(html) {
      this.store.push(html);
      return '\x00' + (this.store.length - 1) + '\x00';
    }
    restore(text) {
      return text.replace(/\x00(\d+)\x00/g, (_, n) => this.store[+n]);
    }
  }

  /* ======================================================================
   * 2. 行内解析
   * ==================================================================== */

  const INLINE_CODE_RE = /`([^`\n]+)`/g;
  const INLINE_MATH_RE = /\$(?!\$)((?:[^$\\\n]|\\.)+?)\$/g;
  const ESCAPE_RE = /\\([\\`*_{}\[\]()#+\-.!>])/g;
  const IMAGE_RE = /!\[([^\[\]\n]*)\]\(([^)\s]+)(?:[ \t]+['"]([^'"]*)['"])?\)/g;
  const AUTOLINK_RE =
    /<((?:https?|ftp):\/\/[^>\s]+|mailto:[^>\s]+|[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})>/g;
  const LINK_RE =
    /\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(([^)\s]+)(?:[ \t]+['"]([^'"]*)['"])?\)/g;

  function renderEmphasis(text) {
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/(?<!\w)___([^_]+)___(?!\w)/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\w)__([^_]+)__(?!\w)/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/(?<![A-Za-z0-9])_([^_]+?)_(?![A-Za-z0-9])/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
    return text;
  }

  function linkInner(text) {
    const t = renderEmphasis(text);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderInline(text, ph) {
    if (!ph) ph = new Placeholder();

    // 1) 行内代码
    text = text.replace(INLINE_CODE_RE, (m, g1) => ph.protect('<code>' + esc(g1) + '</code>'));

    // 2) 行内公式（保留 $ 供 KaTeX auto-render 识别）
    text = text.replace(INLINE_MATH_RE, (m, g1) => ph.protect('$' + esc(g1) + '$'));

    // 3) 换行：行末两空格 / 反斜杠 → <br>，其余换行 → 空格
    text = text.replace(/[ \t]{2,}\n/g, () => ph.protect('<br>'));
    text = text.replace(/\\\n/g, () => ph.protect('<br>'));
    text = text.replace(/\n/g, ' ');

    // 4) 反斜杠转义
    text = text.replace(ESCAPE_RE, (m, g1) => ph.protect(esc(g1)));

    // 5) 图片 / 自动链接 / 链接
    text = text.replace(IMAGE_RE, (m, alt, url, title) =>
      ph.protect('<img src="' + attrEsc(url) + '" alt="' + esc(alt) + '"' + titleAttr(title) + '>')
    );
    text = text.replace(AUTOLINK_RE, (m, g1) =>
      ph.protect('<a href="' + attrEsc(g1) + '">' + esc(g1) + '</a>')
    );
    text = text.replace(LINK_RE, (m, txt, url, title) =>
      ph.protect(
        '<a href="' + attrEsc(url) + '"' + titleAttr(title) + '>' + linkInner(txt) + '</a>'
      )
    );

    // 6) 转义残留的裸 & < >
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 7) 强调
    text = renderEmphasis(text);

    // 8) 还原占位符
    return ph.restore(text);
  }

  /* ======================================================================
   * 3. 块级解析
   * ==================================================================== */

  // 标题：允许 "## 标题" 也允许 "##标题"（洛谷实际写法两者都有）
  const HEADING_RE = /^\s{0,3}(#{1,6})[ \t]*(.*?)[ \t]*$/;
  const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
  const HR_RE = /^\s{0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
  const DIRECTIVE_RE = /^\s{0,3}(:{2,})([A-Za-z0-9_-]+)(\[[^\]]*\])?(\{[^}]*\})?\s*$/;
  const LIST_UL_RE = /^([ \t]*)([-+*])([ \t]+)(.*)$/;
  const LIST_OL_RE = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(.*)$/;
  const QUOTE_RE = /^\s{0,3}>/;

  function indentWidth(s) {
    let w = 0;
    for (const ch of s) {
      if (ch === ' ') w += 1;
      else if (ch === '\t') w += 4 - (w % 4);
      else break;
    }
    return w;
  }

  // 判断是否是「真标题」：形如 #~###### 且后面不是纯 '#'（避免把 "####" 当标题）
  function isHeading(line) {
    const m = HEADING_RE.exec(line);
    if (!m) return null;
    if (/^#+$/.test(m[2].trim())) return null;
    return m;
  }

  function looksLikeBlock(lines, j, end) {
    const ln = lines[j];
    if (isHeading(ln)) return true;
    if (FENCE_RE.test(ln)) return true;
    if (HR_RE.test(ln)) return true;
    if (ln.trimStart().startsWith('$$')) return true;
    if (DIRECTIVE_RE.test(ln)) return true;
    if (QUOTE_RE.test(ln)) return true;
    if (LIST_UL_RE.test(ln) || LIST_OL_RE.test(ln)) return true;
    if (isTableStart(lines, j, end)) return true;
    return false;
  }

  function parseBlocks(lines, start, end) {
    const out = [];
    let i = start;
    let cute = false;

    while (i < end) {
      const line = lines[i];

      if (!line.trim()) {
        i++;
        continue;
      }

      let m;

      // ---- 标题 ----
      m = isHeading(line);
      if (m) {
        const level = m[1].length;
        let text = m[2].trim();
        text = text.replace(/[ \t]+#+[ \t]*$/, '');
        out.push('<' + 'h' + level + '>' + renderInline(text) + '</' + 'h' + level + '>');
        i++;
        continue;
      }

      // ---- 围栏代码块 ----
      m = FENCE_RE.exec(line);
      if (m) {
        const fence = m[1];
        const ch = fence[0];
        const length = fence.length;
        const info = m[2].trim();
        let j = i + 1;
        const codeLines = [];
        const closeRe = new RegExp(
          '^\\s{0,3}' + (ch === '`' ? '`' : '~') + '{' + length + ',}\\s*$'
        );
        while (j < end) {
          if (closeRe.test(lines[j])) break;
          codeLines.push(lines[j]);
          j++;
        }
        out.push(renderCodeBlock(info, codeLines.join('\n')));
        i = j + 1;
        continue;
      }

      // ---- 行间公式 $$ ----
      if (line.trimStart().startsWith('$$')) {
        const single = /^\s*\$\$(.*?)\$\$\s*$/.exec(line);
        if (single) {
          out.push('<div class="math-display">$$' + esc(single[1]) + '$$</div>');
          i++;
        } else {
          let j = i + 1;
          const content = [];
          while (j < end && lines[j].trim() !== '$$') {
            content.push(lines[j]);
            j++;
          }
          j++; // 跳过结尾的 $$
          out.push('<div class="math-display">$$' + esc(content.join('\n')) + '$$</div>');
          i = j;
        }
        continue;
      }

      // ---- 洛谷容器 / 指令 ----
      if (DIRECTIVE_RE.test(line)) {
        const res = parseDirective(lines, i, end);
        if (res) {
          if (res.name === 'cute-table') cute = true;
          if (res.html) out.push(res.html);
          i = res.next;
          continue;
        }
      }

      // ---- 引用块 ----
      if (QUOTE_RE.test(line)) {
        let j = i;
        const buf = [];
        while (j < end && QUOTE_RE.test(lines[j])) {
          buf.push(lines[j].replace(/^\s{0,3}>\s?/, ''));
          j++;
        }
        out.push('<blockquote>\n' + parseBlocks(buf, 0, buf.length) + '\n</blockquote>');
        i = j;
        continue;
      }

      // ---- 列表 ----
      if (LIST_UL_RE.test(line) || LIST_OL_RE.test(line)) {
        const r = parseList(lines, i, end);
        out.push(r.html);
        i = r.next;
        continue;
      }

      // ---- 水平分隔线 ----
      if (HR_RE.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // ---- 表格 ----
      if (isTableStart(lines, i, end)) {
        const r = parseTable(lines, i, end, cute);
        cute = false;
        out.push(r.html);
        i = r.next;
        continue;
      }

      // ---- 普通段落 ----
      const buf = [line];
      let j = i + 1;
      while (j < end) {
        const ln = lines[j];
        if (!ln.trim()) break;
        if (looksLikeBlock(lines, j, end)) break;
        buf.push(ln);
        j++;
      }
      out.push('<p>' + renderInline(buf.join('\n')) + '</p>');
      i = j;
    }

    return out.join('\n');
  }

  /* ======================================================================
   * 4. 代码块
   * ==================================================================== */

  function renderCodeBlock(info, code) {
    const tokens = info.split(/\s+/).filter(Boolean);
    const lang = tokens.length ? tokens[0] : '';
    const options = tokens.slice(1);
    const showLn = options.indexOf('line-numbers') !== -1;

    const highlight = new Set();
    for (const opt of options) {
      const m = /^lines=(\d+)(?:-(\d+))?$/.exec(opt);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = m[2] ? parseInt(m[2], 10) : a;
        for (let k = a; k <= b; k++) highlight.add(k);
      }
    }

    let lines = code.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    const parts = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const ln = lines[idx];
      const no = idx + 1;
      // 用 <div> 而非 <span>，避免某些打印引擎 / PDF 抽取工具把多行合并成一行
      let cls = 'cl';
      if (highlight.has(no)) cls += ' hl';
      const content = ln ? esc(ln) : '&#8203;';
      parts.push(
        '<div class="' + cls + '">' +
          (showLn ? '<span class="ln">' + no + '</span>' : '') +
          content +
        '</div>'
      );
    }

    let classes = 'code-block';
    if (showLn) classes += ' line-numbers';
    const langClass = 'class="language-' + (lang || 'cpp') + '"';
    return '<pre class="' + classes + '"><code ' + langClass + '>' + parts.join('') + '</code></pre>';
  }

  /* ======================================================================
   * 5. 表格
   * ==================================================================== */

  function isTableStart(lines, i, end) {
    if (i + 1 >= end) return false;
    if (lines[i].indexOf('|') === -1) return false;
    const d = lines[i + 1].trim();
    return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(d);
  }

  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    let k = 0;
    while (k < s.length) {
      const c = s[k];
      if (c === '\\' && k + 1 < s.length && s[k + 1] === '|') {
        cur += '|';
        k += 2;
        continue;
      }
      if (c === '|') {
        cells.push(cur.trim());
        cur = '';
        k++;
        continue;
      }
      cur += c;
      k++;
    }
    cells.push(cur.trim());
    return cells;
  }

  function alignOf(cell) {
    const c = cell.trim();
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  }

  function parseTable(lines, i, end, cute) {
    const header = splitTableRow(lines[i]);
    const delim = splitTableRow(lines[i + 1]);
    const aligns = delim.map(alignOf);
    const body = [];
    let j = i + 2;
    while (j < end) {
      const ln = lines[j];
      if (!ln.trim() || ln.indexOf('|') === -1) break;
      body.push(splitTableRow(ln));
      j++;
    }
    return { html: renderTable(header, body, aligns, cute), next: j };
  }

  function renderTable(header, body, aligns, cute) {
    const rows = [header].concat(body);
    const ncols = rows.reduce((a, r) => Math.max(a, r.length), 0);
    const nrows = rows.length;
    const grid = rows.map((r) => {
      const a = [];
      for (let c = 0; c < ncols; c++) a.push(c < r.length ? r[c] : '');
      return a;
    });
    const skip = [];
    for (let r = 0; r < nrows; r++) skip.push(new Array(ncols).fill(false));

    const out = [];
    for (let r = 0; r < nrows; r++) {
      const tds = [];
      let c = 0;
      while (c < ncols) {
        if (skip[r][c]) {
          c++;
          continue;
        }
        const raw = grid[r][c].trim();
        if (raw === '^' || raw === '<') {
          c++;
          continue;
        }
        let colspan = 1;
        let cc = c + 1;
        while (cc < ncols && grid[r][cc].trim() === '<') {
          skip[r][cc] = true;
          colspan++;
          cc++;
        }
        let rowspan = 1;
        let rr = r + 1;
        while (rr < nrows && grid[rr][c].trim() === '^') {
          skip[rr][c] = true;
          rowspan++;
          rr++;
        }
        const align = c < aligns.length ? aligns[c] : 'left';
        const tag = r === 0 ? 'th' : 'td';
        let attrs = '';
        if (colspan > 1) attrs += ' colspan="' + colspan + '"';
        if (rowspan > 1) attrs += ' rowspan="' + rowspan + '"';
        if (align !== 'left') attrs += ' style="text-align:' + align + '"';
        tds.push('<' + tag + attrs + '>' + renderInline(raw) + '</' + tag + '>');
        c += colspan;
      }
      out.push('<tr>' + tds.join('') + '</tr>');
    }

    const cls = cute ? 'markdown-table cute-table' : 'markdown-table';
    return (
      '<table class="' + cls + '"><thead>' + out[0] + '</thead><tbody>' +
      out.slice(1).join('') + '</tbody></table>'
    );
  }

  /* ======================================================================
   * 6. 列表
   * ==================================================================== */

  function parseList(lines, start, end) {
    const ordered = LIST_OL_RE.test(lines[start]);
    const items = [];
    let j = start;

    while (j < end) {
      const ul = LIST_UL_RE.exec(lines[j]);
      const ol = LIST_OL_RE.exec(lines[j]);
      if (!ul && !ol) break;
      if (Boolean(ol) !== ordered) break;

      let content, markerLen;
      if (ul) {
        content = ul[4];
        markerLen = ul[0].length - ul[4].length;
      } else {
        content = ol[5];
        markerLen = ol[0].length - ol[5].length;
      }
      const contentCol = markerLen;

      const itemLines = [content];
      j++;
      while (j < end) {
        const ln = lines[j];
        if (!ln.trim()) {
          let k = j;
          while (k < end && !lines[k].trim()) k++;
          if (k < end && indentWidth(lines[k]) >= contentCol) {
            for (let t = j; t < k; t++) itemLines.push(lines[t]);
            j = k;
            continue;
          }
          break;
        }
        if (indentWidth(ln) >= contentCol) {
          itemLines.push(ln);
          j++;
          continue;
        }
        break;
      }

      // 任务列表
      let taskChecked = null;
      if (!ordered) {
        const tm = /^\[([ xX])\][ \t]+(.*)$/.exec(content);
        if (tm) {
          taskChecked = tm[1].toLowerCase() === 'x';
          content = tm[2];
          itemLines[0] = content;
        }
      }

      let inner = parseBlocks(itemLines, 0, itemLines.length);
      let clsAttr = '';
      if (taskChecked !== null) {
        const checked = taskChecked ? ' checked' : '';
        const inp =
          '<input type="checkbox" class="task-list-item-checkbox"' + checked + ' disabled> ';
        if (inner.startsWith('<p>')) inner = '<p>' + inp + inner.slice(3);
        else inner = inp + inner;
        clsAttr = ' class="task-list-item"';
      }
      items.push('<li' + clsAttr + '>' + inner + '</li>');
    }

    const tag = ordered ? 'ol' : 'ul';
    let listCls = '';
    if (items.some((it) => it.indexOf('class="task-list-item"') !== -1)) {
      listCls = ' class="contains-task-list"';
    }

    return {
      html: '<' + tag + listCls + '>\n' + items.join('\n') + '\n</' + tag + '>',
      next: j,
    };
  }

  /* ======================================================================
   * 7. 洛谷容器 / 指令
   * ==================================================================== */

  const CALLOUT_DEFAULT_TITLE = {
    info: '提示',
    success: '成功',
    warning: '警告',
    error: '错误',
  };

  function parseDirective(lines, i, end) {
    const m = DIRECTIVE_RE.exec(lines[i]);
    if (!m) return null;

    const colons = m[1].length;
    const name = m[2];
    const title = m[3] ? m[3].slice(1, -1) : '';
    const params = m[4] ? m[4].slice(1, -1) : '';

    // 两个冒号的指令是单行标记（如 ::cute-table{tuack}）
    if (colons === 2) {
      return { html: '', next: i + 1, name: name };
    }

    const closeRe = new RegExp('^\\s{0,3}:' + '{' + colons + '}\\s*$');
    let j = i + 1;
    while (j < end) {
      if (closeRe.test(lines[j])) break;
      j++;
    }
    if (j >= end) return null; // 未闭合

    const inner = parseBlocks(lines, i + 1, j);
    return { html: renderContainer(name, title, params, inner), next: j + 1, name: name };
  }

  function renderContainer(name, title, params, inner) {
    if (name === 'align') {
      let a = 'center';
      if (params.indexOf('right') !== -1) a = 'right';
      else if (params.indexOf('left') !== -1) a = 'left';
      return '<div style="text-align:' + a + '">\n' + inner + '\n</div>';
    }

    if (name === 'epigraph') {
      const titleHtml = title ? renderInline(title) : '';
      const attr = titleHtml ? '<div class="epigraph-attr">' + titleHtml + '</div>' : '';
      return '<blockquote class="epigraph">\n' + inner + '\n' + attr + '\n</blockquote>';
    }

    if (Object.prototype.hasOwnProperty.call(CALLOUT_DEFAULT_TITLE, name)) {
      const titleHtml = title ? renderInline(title) : CALLOUT_DEFAULT_TITLE[name];
      return (
        '<div class="callout callout-' + name + '">\n' +
        '<div class="callout-title">' + titleHtml + '</div>\n' +
        '<div class="callout-body">' + inner + '</div>\n</div>'
      );
    }

    return '<div class="container-' + name + '">\n' + inner + '\n</div>';
  }

  /* ======================================================================
   * 8. CSS（与 Python 版一致，页面尺寸固定 A4）
   * ==================================================================== */

  const CSS = `
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC",
               "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.7;
  color: #1f2328;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, h3, h4, h5, h6 {
  color: #111; line-height: 1.35; margin: 1.15em 0 0.55em; font-weight: 600;
}
h1 { font-size: 1.65em; border-bottom: 2px solid #eaecef; padding-bottom: 0.25em; }
h2 { font-size: 1.4em; border-bottom: 1px solid #eaecef; padding-bottom: 0.2em; }
h3 { font-size: 1.2em; }
h4 { font-size: 1.05em; }
h5 { font-size: 1em; }
h6 { font-size: 0.92em; color: #555; }
p { margin: 0.6em 0; }
a { color: #0b66c3; text-decoration: none; }
code {
  font-family: Consolas, "SF Mono", Menlo, "Courier New", monospace;
  background: rgba(27,31,35,0.07); padding: 0.1em 0.35em;
  border-radius: 3px; font-size: 0.9em;
}
pre { margin: 0.85em 0; page-break-inside: avoid; }
pre.code-block {
  background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px;
  padding: 10px 14px; overflow-x: hidden;
}
pre.code-block code {
  background: transparent; padding: 0; font-size: 0.85em; line-height: 1.5;
  color: #24292f; white-space: normal;
  display: block;
}
pre.code-block .cl { display: block; white-space: pre; }
pre.code-block .ln {
  display: inline-block; min-width: 2.2em; margin-right: 0.9em;
  text-align: right; color: #9aa0a6; user-select: none;
}
pre.code-block .cl.hl { background: #fff3cd; }
blockquote {
  margin: 0.85em 0; padding: 0.4em 1em; border-left: 4px solid #d0d7de;
  color: #57606a; background: #f6f8fa;
}
blockquote p { margin: 0.3em 0; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 1.4em 0; }
ul, ol { margin: 0.6em 0; padding-left: 1.6em; }
li { margin: 0.25em 0; }
li > ul, li > ol { margin: 0.2em 0; }
ul.contains-task-list { list-style: none; padding-left: 1.2em; }
li.task-list-item { list-style: none; }
li.task-list-item > p:first-child { margin: 0.25em 0; }
li.task-list-item input[type="checkbox"] {
  vertical-align: middle;
  margin: 0 0.4em 0 0;
  width: 0.95em;
  height: 0.95em;
  accent-color: #0969da;
}
table.markdown-table {
  border-collapse: collapse; margin: 0.9em 0; width: 100%; font-size: 0.95em;
}
table.markdown-table th, table.markdown-table td {
  border: 1px solid #d0d7de; padding: 6px 10px;
}
table.markdown-table th { background: #f6f8fa; font-weight: 600; }
table.markdown-table tr { page-break-inside: avoid; }
table.markdown-table tbody tr:nth-child(even) td { background: #fafbfc; }
table.cute-table {
  border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em;
  border-top: 3px solid #000; border-bottom: 3px solid #000;
}
table.cute-table th, table.cute-table td {
  border: none; border-bottom: 1px solid #000; border-left: 1px solid #000;
  padding: 6px 12px; background: transparent;
}
table.cute-table th:first-child, table.cute-table td:first-child { border-left: none; }
table.cute-table th { background: transparent; font-weight: normal; }
table.cute-table thead th { border-bottom: 2px solid #000; }
table.cute-table tbody tr:nth-child(even) td { background: transparent; }
.math-display {
  margin: 1em 0;
  text-align: center;
  overflow-x: auto;
  overflow-y: hidden;
  page-break-inside: avoid;
}
.math-display > .katex-display { margin: 0; }
img { max-width: 100%; }
.callout {
  border: 1px solid; border-radius: 6px; margin: 0.9em 0; page-break-inside: avoid;
}
.callout-title {
  font-weight: 600; padding: 7px 12px; border-bottom: 1px solid rgba(0,0,0,0.07);
  text-align: left;
}
.callout-body { padding: 8px 12px; }
.callout-title .katex-display {
  display: inline-block;
  margin: 0;
  text-align: left;
}
.callout-title .katex-display > .katex {
  display: inline-block;
  text-align: left;
  white-space: nowrap;
}
.callout-info { border-color: #b6d4fe; background: #f0f7ff; }
.callout-info .callout-title { color: #0b5cab; }
.callout-success { border-color: #b7e1b8; background: #f2fbf2; }
.callout-success .callout-title { color: #1a7f37; }
.callout-warning { border-color: #ffe0a3; background: #fffaf0; }
.callout-warning .callout-title { color: #9a6700; }
.callout-error { border-color: #f5b7b1; background: #fff5f4; }
.callout-error .callout-title { color: #c0392b; }
.epigraph { border-left: 4px solid #9a6700; background: #fffaf0; }
.epigraph-attr {
  text-align: right; font-style: italic; color: #6a737d; margin-top: 0.4em;
}
.task-check { margin-right: 0.3em; }
del { color: #6a737d; }
`;

  /* ======================================================================
   * 9. 长公式自动缩放脚本（注入到打印文档内部）
   * ==================================================================== */

  const FIT_MATH_JS = `
(function () {
  var MIN_ZOOM = 0.3;
  function visualWidth(el) { return el.getBoundingClientRect().width; }
  function fitMath() {
    var els = document.querySelectorAll('.math-display');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.style.zoom = '';
      var avail = el.clientWidth;
      if (!avail) continue;
      var natural = el.scrollWidth;
      if (!natural || natural <= avail + 1) continue;
      var zoom = Math.max(avail / natural, MIN_ZOOM);
      el.style.zoom = zoom.toFixed(4);
      for (var k = 0; k < 2; k++) {
        var now = visualWidth(el);
        if (now <= avail + 1) break;
        zoom = Math.max(zoom * (avail / now), MIN_ZOOM);
        el.style.zoom = zoom.toFixed(4);
      }
    }
  }
  window.__lgpdfFitMath = fitMath;
  setTimeout(fitMath, 0);
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(fitMath); }
  window.addEventListener('load', fitMath);
  setTimeout(fitMath, 400);
})();
`;

  /* ======================================================================
   * 10. KaTeX 资源（随脚本打包，运行时零网络请求）
   *
   * 洛谷真实 CSP（<meta> 里那条）：
   *   default-src … blob: …; font-src * data:; img-src * data:; …
   * 注意 font-src 里的 `*` 只匹配 http/https/ws/wss，**不含 blob:**，
   * 所以 blob: 字体一定会被拦（踩过一次：CSS 生效、JS 生效，只有字体被拦，
   * 公式全部退化成 Times + Cambria Math）。而 data: 是被明确允许的。
   *
   * 构建时把 KaTeX 的 CSS / JS / woff2 字体压成 gzip + base64 固化在文件末尾
   * （见 build/build.mjs），运行时解压：
   *   - CSS / JS 内联成 <style> / <script>（style-src/script-src 走 default-src 的 'unsafe-inline'）；
   *   - 字体写成 data: URI 的 @font-face（font-src 明确允许 data:）。
   * 全程不联网、不依赖 GM_*，任何能执行本脚本的环境都能用。
   * ==================================================================== */

  // 构建时由 build.mjs 替换成 gzip+base64 的 KaTeX 资源包。
  const KATEX_EMBEDDED_GZIP_B64 =
    '__KATEX_EMBEDDED_GZIP_B64__';

  let katexData = null;

  function hasGzipPayload() {
    return KATEX_EMBEDDED_GZIP_B64.length > 64;
  }

  async function gunzipToString(b64) {
    if (!hasGzipPayload()) {
      throw new Error('本脚本未包含 KaTeX 资源（请使用 build/ 构建出的发布版）');
    }
    const bin = atob(b64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }

    // 老浏览器兜底：自己解 gzip（只需要 deflate + crc 校验跳过）
    return inflateGzip(bytes);
  }

  // 极简 gzip 解压：解析 header → raw deflate → 解压
  function inflateGzip(bytes) {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('不是 gzip 数据');
    let p = 10;
    const flg = bytes[3];
    if (flg & 0x04) p += 2 + (bytes[p] | (bytes[p + 1] << 8));
    if (flg & 0x08) { while (bytes[p] !== 0) p++; p++; }
    if (flg & 0x10) { while (bytes[p] !== 0) p++; p++; }
    if (flg & 0x02) p += 2;

    const bits = { buf: 0, cnt: 0 };
    const readBit = () => {
      if (bits.cnt === 0) { bits.buf = bytes[p++]; bits.cnt = 8; }
      const b = bits.buf & 1;
      bits.buf >>= 1;
      bits.cnt--;
      return b;
    };
    const readBits = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) v |= readBit() << i;
      return v;
    };
    const buildTree = (lengths) => {
      const maxLen = Math.max.apply(null, lengths.concat([0]));
      const blCount = new Array(maxLen + 1).fill(0);
      for (const l of lengths) if (l) blCount[l]++;
      const nextCode = new Array(maxLen + 1).fill(0);
      let code = 0;
      for (let b = 1; b <= maxLen; b++) {
        code = (code + blCount[b - 1]) << 1;
        nextCode[b] = code;
      }
      const map = new Map();
      for (let sym = 0; sym < lengths.length; sym++) {
        const l = lengths[sym];
        if (!l) continue;
        map.set(l + ':' + nextCode[l], sym);
        nextCode[l]++;
      }
      return { map, maxLen };
    };
    const decode = (tree) => {
      let code = 0;
      for (let len = 1; len <= tree.maxLen; len++) {
        code = (code << 1) | readBit();
        const sym = tree.map.get(len + ':' + code);
        if (sym !== undefined) return sym;
      }
      throw new Error('gzip 数据损坏');
    };

    let final = 0;
    const out = [];
    const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,
      4097,6145,8193,12289,16385,24577];
    const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

    while (!final) {
      final = readBit();
      const type = readBits(2);
      if (type === 0) {
        // stored
        bits.cnt = 0;
        const len = bytes[p] | (bytes[p + 1] << 8);
        p += 4;
        for (let i = 0; i < len; i++) out.push(bytes[p++]);
        continue;
      }
      let lit, dist;
      if (type === 1) {
        const lens = new Array(288);
        for (let i = 0; i < 288; i++) lens[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
        lit = buildTree(lens);
        dist = buildTree(new Array(30).fill(5));
      } else {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        const clLens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clLens[order[i]] = readBits(3);
        const clTree = buildTree(clLens);
        const lens = [];
        while (lens.length < hlit + hdist) {
          const sym = decode(clTree);
          if (sym < 16) lens.push(sym);
          else if (sym === 16) {
            const prev = lens[lens.length - 1];
            const n = 3 + readBits(2);
            for (let i = 0; i < n; i++) lens.push(prev);
          } else if (sym === 17) {
            const n = 3 + readBits(3);
            for (let i = 0; i < n; i++) lens.push(0);
          } else {
            const n = 11 + readBits(7);
            for (let i = 0; i < n; i++) lens.push(0);
          }
        }
        lit = buildTree(lens.slice(0, hlit));
        dist = buildTree(lens.slice(hlit));
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) { out.push(sym); continue; }
        if (sym === 256) break;
        const li = sym - 257;
        const len = LEN_BASE[li] + readBits(LEN_EXTRA[li]);
        const ds = decode(dist);
        const d = DIST_BASE[ds] + readBits(DIST_EXTRA[ds]);
        const start = out.length - d;
        for (let i = 0; i < len; i++) out.push(out[start + i]);
      }
    }

    let str = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < out.length; i += CHUNK) {
      str += String.fromCharCode.apply(null, out.slice(i, i + CHUNK));
    }
    return decodeURIComponent(escape(str));
  }

  async function loadKatex() {
    if (katexData) return katexData;
    const data = JSON.parse(await gunzipToString(KATEX_EMBEDDED_GZIP_B64));
    if (!data || !data.css || !data.js || !data.auto || !data.fonts) {
      throw new Error('内置的 KaTeX 资源不完整');
    }
    if (data.version !== KATEX_VERSION) {
      console.warn('[lgpdf] 内置 KaTeX 版本 ' + data.version + ' 与预期 ' + KATEX_VERSION + ' 不一致');
    }
    katexData = data;
    return data;
  }

  let katexPromise = null;
  function getKatex() {
    if (!katexPromise) {
      katexPromise = loadKatex().catch((err) => {
        katexPromise = null;
        throw err;
      });
    }
    return katexPromise;
  }

  /* ======================================================================
   * 11. 生成打印用 HTML
   * ==================================================================== */

  // 内联进打印文档的 <script> 里不能出现 </script
  function safeInlineScript(js) {
    return String(js).replace(/<\/script/gi, '<\\/script');
  }

  /**
   * 把 KaTeX CSS 里的 @font-face 改成内联 data: URI。
   *
   * 洛谷真实 CSP 里有一条 `font-src * data:`——`*` 只匹配 http/https/ws/wss，
   * **不含 blob:**，所以 blob: 字体会被拦掉（之前就是栽在这里：CSS 生效、JS 生效，
   * 只有字体被拦，公式全部回退成 Times + Cambria Math）。
   * data: 被这条指令明确允许，所以字体用 data: URI 内联。
   *
   * 只保留 woff2 一项；取不到字体的 @font-face 整条丢弃，避免留下 CDN 相对路径。
   */
  function inlineKatexCss(css, fonts) {
    if (!css) return '';
    return String(css).replace(/@font-face\s*\{[^{}]*\}/g, function (block) {
      const rewritten = block.replace(/src:\s*([^;}]+)([;}])/g, function (whole, list, tail) {
        const parts = list.split(',');
        const kept = [];
        for (let i = 0; i < parts.length; i++) {
          const m = /url\((['"]?)(?:\.\/)?fonts\/([^)'"]+)\1\)/.exec(parts[i]);
          if (!m || !/\.woff2$/i.test(m[2])) continue;
          const b64 = fonts && fonts[m[2]];
          if (!b64) continue;
          kept.push('url("data:font/woff2;base64,' + b64 + '") format("woff2")');
        }
        if (!kept.length) return whole;
        return 'src:' + kept.join(',') + tail;
      });
      return /src:\s*url\("data:font\/woff2;base64,/.test(rewritten) ? rewritten : '';
    });
  }

  function buildHtml(body, katex) {
    const ok = !!(katex && katex.css && katex.js && katex.auto);
    const katexCss = ok ? inlineKatexCss(katex.css, katex.fonts) : '';
    const katexJs = ok ? safeInlineScript(katex.js) : '';
    const katexAuto = ok ? safeInlineScript(katex.auto) : '';

    const katexBoot = katexJs
      ? `
<script>${katexJs}<\/script>
<script>${katexAuto}<\/script>
<script>
try {
  renderMathInElement(document.body, {
    delimiters: [
      {left: '$$', right: '$$', display: true},
      {left: '$', right: '$', display: false}
    ],
    // 和洛谷一致：只输出 HTML，不额外生成 MathML 层。
    // （KaTeX 默认 htmlAndMathml 会塞一层隐藏的 MathML，样式一旦没生效就会露出
    //   浏览器原生数学排版，看起来就"不是 KaTeX"了。）
    output: 'html',
    throwOnError: false,
    strict: false
  });
} catch (e) { /* KaTeX 渲染失败时保留原始 $...$ 文本 */ }
<\/script>`
      : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>${katexCss}</style>
<style>${CSS}</style>
</head>
<body>
${body}
${katexBoot}
<script>${FIT_MATH_JS}<\/script>
</body>
</html>`;
  }

  /* ======================================================================
   * 12. 打印
   * ==================================================================== */

  // 常见 KaTeX 字体族名，用于等待字体加载完毕
  const KATEX_FONT_FAMILIES = [
    'KaTeX_Main', 'KaTeX_Math',
    'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4',
    'KaTeX_AMS', 'KaTeX_Caligraphic', 'KaTeX_Fraktur',
    'KaTeX_SansSerif', 'KaTeX_Script', 'KaTeX_Typewriter',
  ];

  // body.textContent 里还含着内联的 katex.min.js 源码（里面有大量 "$"），
  // 必须剔除 script/style/pre/code 和已渲染的 .katex 才算得准。
  function pendingMathIn(doc) {
    try {
      if (!doc.body) return false;
      const probe = doc.body.cloneNode(true);
      const junk = probe.querySelectorAll('script, style, pre, code, .katex');
      for (let i = 0; i < junk.length; i++) junk[i].remove();
      const text = probe.textContent || '';
      return /\$(?!\$)[^$\n]+\$/.test(text);
    } catch (e) {
      return false;
    }
  }

  function waitKatexRendered(doc, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 4500);
    return new Promise(function (resolve) {
      const timer = setInterval(function () {
        let done = false;
        try {
          const pendingMath = pendingMathIn(doc);
          const hasKatex = !!doc.querySelector('.katex-html');
          done = !pendingMath || hasKatex;
        } catch (e) {
          done = true;
        }
        if (done || Date.now() >= deadline) {
          clearInterval(timer);
          resolve();
        }
      }, 30);
    });
  }

  function waitFonts(doc, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 3000);
    const fallback = new Promise(function (resolve) {
      setTimeout(resolve, timeoutMs || 3000);
    });
    let real;
    try {
      if (!doc.fonts || typeof doc.fonts.load !== 'function') {
        return Promise.resolve();
      }
      const jobs = KATEX_FONT_FAMILIES.map(function (fam) {
        // 用 KaTeX 实际会用到的一些字符触发字体子集加载
        return doc.fonts.load('1em "' + fam + '"', '()[]{}∑∫αβγijkxABC').catch(function () {});
      });
      real = Promise.all(jobs).then(function () {
        return (doc.fonts.ready || Promise.resolve()).catch(function () {});
      });
    } catch (e) {
      return Promise.resolve();
    }
    return Promise.race([real, fallback]);
  }

  function printHtml(htmlDoc) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    // 宽度必须等于 A4 正文宽（210mm - 左右各 18mm 页边距），不能是 0：
    // 长公式的自动缩放（FIT_MATH_JS）按这个宽度判断要不要缩小，宽度为 0 时一步都跑不动。
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:174mm;height:297mm;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(htmlDoc);
    doc.close();

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      setTimeout(function () {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 300);
    }

    waitKatexRendered(doc, 5000)
      .then(function () {
        return waitFonts(doc, 3000);
      })
      .then(function () {
        // 再给排版一点时间
        return new Promise(function (r) { setTimeout(r, 250); });
      })
      .then(function () {
        try {
          if (typeof iframe.contentWindow.__lgpdfFitMath === 'function') {
            iframe.contentWindow.__lgpdfFitMath();
          }
        } catch (e) {
          /* ignore */
        }

        try {
          iframe.contentWindow.addEventListener('afterprint', cleanup);
        } catch (e) {
          /* ignore */
        }

        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          console.error('[lgpdf] 调起打印失败：', e);
          alert('调起打印失败，请检查浏览器是否阻止了打印对话框。');
        } finally {
          setTimeout(cleanup, 3000);
        }
      });
  }

  /* ======================================================================
   * 13. 从页面读取 Markdown 源
   * ==================================================================== */

  function readContext() {
    const el = document.getElementById('lentille-context');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  function problemMarkdown(ctx) {
    const p = ctx && ctx.data && ctx.data.problem;
    if (!p) return null;
    const c = p.contenu || p.content;
    if (!c) return null;

    const parts = [];
    const title = p.name || p.pid || '题目';
    parts.push('# ' + title);

    if (c.background) parts.push('## 题目背景\n\n' + c.background);
    if (c.description) parts.push('## 题目描述\n\n' + c.description);
    if (c.formatI) parts.push('## 输入格式\n\n' + c.formatI);
    if (c.formatO) parts.push('## 输出格式\n\n' + c.formatO);

    const samples = Array.isArray(p.samples) ? p.samples : [];
    for (let idx = 0; idx < samples.length; idx++) {
      const n = idx + 1;
      const s = samples[idx] || [];
      const inp = s[0] == null ? '' : String(s[0]);
      const outp = s[1] == null ? '' : String(s[1]);
      parts.push(
        '## 输入输出样例 #' + n + '\n\n' +
        '### 输入 #' + n + '\n\n```\n' + inp + '\n```\n\n' +
        '### 输出 #' + n + '\n\n```\n' + outp + '\n```'
      );
    }

    if (c.hint) parts.push('## 说明/提示\n\n' + c.hint);

    return parts.join('\n\n');
  }

  function articleMarkdown(ctx) {
    const a = ctx && ctx.data && ctx.data.article;
    if (!a || !a.content) return null;
    const title = a.title || '';
    return (title ? '# ' + title + '\n\n' : '') + a.content;
  }

  function getMarkdown() {
    const ctx = readContext();
    if (ctx) {
      const isProblem = /^\/problem\//.test(location.pathname);
      const md = isProblem ? problemMarkdown(ctx) : articleMarkdown(ctx);
      if (md) return md;
    }
    return null;
  }

  /* ======================================================================
   * 14. HTML 渲染入口
   * ==================================================================== */

  function luoguToHtml(text) {
    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    return parseBlocks(lines, 0, lines.length);
  }

  /* ======================================================================
   * 15. UI —— 复用页面上原有的「下载 PDF」按钮样式
   * ==================================================================== */

  const PDF_ICON_SVG =
    '<svg viewBox="0 0 512 512" aria-hidden="true">' +
    '<path d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32V274.7l-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7V32zM64 352c-35.3 0-64 28.7-64 64v32c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V416c0-35.3-28.7-64-64-64H346.5l-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352H64z"/>' +
    '</svg>';

  const BTN_CSS = `
a[data-lgpdf-btn] {
  cursor: pointer; vertical-align: middle; text-decoration: none;
  display: inline-flex; align-items: center; gap: 3px; user-select: none;
}
a[data-lgpdf-btn]:hover { opacity: .75; }
a[data-lgpdf-btn] svg { width: 1em; height: 1em; fill: currentColor; flex: none; }
a[data-lgpdf-btn].lgpdf-standalone {
  margin: 10px 0 2px; padding: 3px 12px; border: 1px solid currentColor;
  border-radius: 4px; font-size: 14px; line-height: 1.7; width: fit-content;
  color: inherit; opacity: .8;
}
`;

  /**
   * 清理本脚本自己注入的元素（不动洛谷原生 / 其他插件的东西）。
   */
  function cleanupInjected() {
    document.querySelectorAll('style#' + BTN_STYLE_ID).forEach(function (el) {
      el.remove();
    });
    document.querySelectorAll('a[' + BTN_ATTR + ']').forEach(function (el) {
      el.remove();
    });
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.id = BTN_STYLE_ID;
    style.textContent = BTN_CSS;
    document.head.appendChild(style);
  }

  function createButton() {
    const a = document.createElement('a');
    a.setAttribute(BTN_ATTR, '1');
    a.href = 'javascript:void 0';
    a.title = BTN_TITLE;
    a.innerHTML = PDF_ICON_SVG + ' 下载 PDF';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleDownload();
    });
    return a;
  }

  function insertButton() {
    if (document.querySelector('a[' + BTN_ATTR + ']')) return;

    // —— 题目页：放在「复制 Markdown / 进入 IDE 模式」那一行 ——
    const problemActions = document.querySelector('.problem-block-actions');
    if (problemActions) {
      const btn = createButton();
      btn.style.marginLeft = '14px';
      problemActions.appendChild(btn);
      return;
    }

    // —— 专栏页：放在标题下方 ——
    const bannerContent = document.querySelector('.banner-content');
    if (bannerContent) {
      const btn = createButton();
      btn.classList.add('lgpdf-standalone');
      const title = bannerContent.querySelector('#article-title, h1.title');
      if (title && title.parentNode) {
        title.parentNode.insertBefore(btn, title.nextSibling);
      } else {
        bannerContent.insertBefore(btn, bannerContent.firstChild);
      }
      return;
    }
  }

  /* ======================================================================
   * 16. 下载流程
   * ==================================================================== */

  let busy = false;

  async function handleDownload() {
    if (busy) return;
    busy = true;
    try {
      const md = getMarkdown();
      if (!md) {
        alert('未能从当前页面读取到 Markdown 内容。\n请确认页面已加载完毕，且处于洛谷题目页或专栏页。');
        return;
      }

      let katex = null;
      try {
        katex = await getKatex();
      } catch (err) {
        // 资源内置在脚本里，走到这里说明脚本损坏或被截断了
        console.error('[lgpdf] 内置 KaTeX 资源解压失败：', err);
        alert(
          '内置的 KaTeX 公式资源解压失败，公式会显示成 LaTeX 源码。\n' +
          '原因：' + (err && err.message ? err.message : err) +
          '\n\n请重新安装完整的 userscript 文件（应从 build/ 构建出的发布版安装）。'
        );
      }

      const body = luoguToHtml(md);
      const html = buildHtml(body, katex);
      printHtml(html);
    } catch (err) {
      console.error('[lgpdf] 转换失败：', err);
      alert('转换失败：' + (err && err.message ? err.message : err));
    } finally {
      busy = false;
    }
  }

  /* ======================================================================
   * 17. 启动
   * ==================================================================== */

  function boot() {
    // 版本标记：控制台里能直接看到跑的是哪个版本，方便确认装没装对
    console.info(
      '[lgpdf] v' + SCRIPT_VERSION + ' 启动 · KaTeX ' + KATEX_VERSION + ' 内置 · @grant none'
    );
    cleanupInjected();
    injectStyle();
    insertButton();
    // 预热：解压内置的 KaTeX 资源（不联网）
    getKatex().catch(function (err) {
      console.error('[lgpdf] 内置 KaTeX 资源解压失败：', err);
    });
  }

  // 洛谷是 SPA，路由切换时按钮会被移除，需要持续补插
  let lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(function () {
        cleanupInjected();
        injectStyle();
        insertButton();
      }, 400);
      return;
    }
    if (!document.querySelector('a[' + BTN_ATTR + ']')) {
      insertButton();
    }
  }, 800);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
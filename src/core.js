'use strict';

/**
 * YAML 注释对齐核心逻辑（零依赖，CommonJS）
 *
 * 同时被 VSCode 扩展（src/extension.js）和命令行预览工具（tools/preview.js）使用。
 * 只做一件事：把代码行尾 / 独立成行的注释，按**显示宽度**对齐到指定的列。
 *
 * 不做的事：不解析 YAML 再重新序列化，不改缩进、不重排 key、不动引号、不动注释正文。
 */

/* ------------------------------------------------------------------ *
 * 显示宽度（East Asian Width）
 * 中日韩字符、全角标点、emoji 记为 2；组合字符 / 零宽字符记为 0。
 * ------------------------------------------------------------------ */

const ZERO_WIDTH_RANGES = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x05bf, 0x05bf],
  [0x05c1, 0x05c2], [0x05c4, 0x05c5], [0x05c7, 0x05c7], [0x0610, 0x061a],
  [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x06df, 0x06e4],
  [0x06e7, 0x06e8], [0x06ea, 0x06ed], [0x0711, 0x0711], [0x0730, 0x074a],
  [0x07a6, 0x07b0], [0x07eb, 0x07f3], [0x0816, 0x0819], [0x081b, 0x0823],
  [0x0825, 0x0827], [0x0829, 0x082d], [0x0859, 0x085b], [0x08e3, 0x0902],
  [0x093a, 0x093a], [0x093c, 0x093c], [0x0941, 0x0948], [0x094d, 0x094d],
  [0x0951, 0x0957], [0x0962, 0x0963], [0x0981, 0x0981], [0x09bc, 0x09bc],
  [0x09c1, 0x09c4], [0x09cd, 0x09cd], [0x09e2, 0x09e3], [0x0a01, 0x0a02],
  [0x0a3c, 0x0a3c], [0x0a41, 0x0a42], [0x0a47, 0x0a48], [0x0a4b, 0x0a4d],
  [0x0a51, 0x0a51], [0x0a70, 0x0a71], [0x0a75, 0x0a75], [0x0a81, 0x0a82],
  [0x0abc, 0x0abc], [0x0ac1, 0x0ac5], [0x0ac7, 0x0ac8], [0x0acd, 0x0acd],
  [0x0ae2, 0x0ae3], [0x0b01, 0x0b01], [0x0b3c, 0x0b3c], [0x0b3f, 0x0b3f],
  [0x0b41, 0x0b44], [0x0b4d, 0x0b4d], [0x0b56, 0x0b56], [0x0b62, 0x0b63],
  [0x0b82, 0x0b82], [0x0bc0, 0x0bc0], [0x0bcd, 0x0bcd], [0x0c00, 0x0c00],
  [0x0c3e, 0x0c40], [0x0c46, 0x0c48], [0x0c4a, 0x0c4d], [0x0c55, 0x0c56],
  [0x0c62, 0x0c63], [0x0c81, 0x0c81], [0x0cbc, 0x0cbc], [0x0cbf, 0x0cbf],
  [0x0cc6, 0x0cc6], [0x0ccc, 0x0ccd], [0x0ce2, 0x0ce3], [0x0d01, 0x0d01],
  [0x0d41, 0x0d44], [0x0d4d, 0x0d4d], [0x0d62, 0x0d63], [0x0dca, 0x0dca],
  [0x0dd2, 0x0dd4], [0x0dd6, 0x0dd6], [0x0e31, 0x0e31], [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e], [0x0eb1, 0x0eb1], [0x0eb4, 0x0eb9], [0x0ebb, 0x0ebc],
  [0x0ec8, 0x0ecd], [0x0f18, 0x0f19], [0x0f35, 0x0f35], [0x0f37, 0x0f37],
  [0x0f39, 0x0f39], [0x0f71, 0x0f7e], [0x0f80, 0x0f84], [0x0f86, 0x0f87],
  [0x0f8d, 0x0f97], [0x0f99, 0x0fbc], [0x0fc6, 0x0fc6], [0x102d, 0x1030],
  [0x1032, 0x1037], [0x1039, 0x103a], [0x103d, 0x103e], [0x1058, 0x1059],
  [0x105e, 0x1060], [0x1071, 0x1074], [0x1082, 0x1082], [0x1085, 0x1086],
  [0x108d, 0x108d], [0x109d, 0x109d], [0x135d, 0x135f], [0x1712, 0x1714],
  [0x1732, 0x1734], [0x1752, 0x1753], [0x1772, 0x1773], [0x17b4, 0x17b5],
  [0x17b7, 0x17bd], [0x17c6, 0x17c6], [0x17c9, 0x17d3], [0x17dd, 0x17dd],
  [0x180b, 0x180e], [0x18a9, 0x18a9], [0x1920, 0x1922], [0x1927, 0x1928],
  [0x1932, 0x1932], [0x1939, 0x193b], [0x1a17, 0x1a18], [0x1a1b, 0x1a1b],
  [0x1a56, 0x1a56], [0x1a58, 0x1a5e], [0x1a60, 0x1a60], [0x1a62, 0x1a62],
  [0x1a65, 0x1a6c], [0x1a73, 0x1a7c], [0x1a7f, 0x1a7f], [0x1ab0, 0x1aff],
  [0x1b00, 0x1b03], [0x1b34, 0x1b34], [0x1b36, 0x1b3a], [0x1b3c, 0x1b3c],
  [0x1b42, 0x1b42], [0x1b6b, 0x1b73], [0x1b80, 0x1b81], [0x1ba2, 0x1ba5],
  [0x1ba8, 0x1ba9], [0x1bab, 0x1bad], [0x1be6, 0x1be6], [0x1be8, 0x1be9],
  [0x1bed, 0x1bed], [0x1bef, 0x1bf1], [0x1c2c, 0x1c33], [0x1c36, 0x1c37],
  [0x1cd0, 0x1cd2], [0x1cd4, 0x1ce0], [0x1ce2, 0x1ce8], [0x1ced, 0x1ced],
  [0x1cf4, 0x1cf4], [0x1cf8, 0x1cf9], [0x1dc0, 0x1dff], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x2064], [0x20d0, 0x20f0], [0x2cef, 0x2cf1],
  [0x2d7f, 0x2d7f], [0x2de0, 0x2dff], [0x302a, 0x302d], [0x3099, 0x309a],
  [0xa66f, 0xa672], [0xa674, 0xa67d], [0xa69e, 0xa69f], [0xa6f0, 0xa6f1],
  [0xa802, 0xa802], [0xa806, 0xa806], [0xa80b, 0xa80b], [0xa825, 0xa826],
  [0xa8c4, 0xa8c5], [0xa8e0, 0xa8f1], [0xa926, 0xa92d], [0xa947, 0xa951],
  [0xa980, 0xa982], [0xa9b3, 0xa9b3], [0xa9b6, 0xa9b9], [0xa9bc, 0xa9bc],
  [0xa9e5, 0xa9e5], [0xaa29, 0xaa2e], [0xaa31, 0xaa32], [0xaa35, 0xaa36],
  [0xaa43, 0xaa43], [0xaa4c, 0xaa4c], [0xaa7c, 0xaa7c], [0xaab0, 0xaab0],
  [0xaab2, 0xaab4], [0xaab7, 0xaab8], [0xaabe, 0xaabf], [0xaac1, 0xaac1],
  [0xaaec, 0xaaed], [0xaaf6, 0xaaf6], [0xabe5, 0xabe5], [0xabe8, 0xabe8],
  [0xabed, 0xabed], [0xfb1e, 0xfb1e], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff], [0x101fd, 0x101fd], [0x102e0, 0x102e0], [0x10376, 0x1037a],
  [0x10a01, 0x10a03], [0x10a05, 0x10a06], [0x10a0c, 0x10a0f], [0x10a38, 0x10a3a],
  [0x10a3f, 0x10a3f], [0x10ae5, 0x10ae6], [0x11001, 0x11001], [0x11038, 0x11046],
  [0x1107f, 0x11081], [0x110b3, 0x110b6], [0x110b9, 0x110ba], [0x11100, 0x11102],
  [0x11127, 0x1112b], [0x1112d, 0x11134], [0x11173, 0x11173], [0x11180, 0x11181],
  [0x111b6, 0x111be], [0x1122f, 0x11231], [0x11234, 0x11234], [0x11236, 0x11237],
  [0x112df, 0x112df], [0x112e3, 0x112ea], [0x11300, 0x11301], [0x1133c, 0x1133c],
  [0x11340, 0x11340], [0x11366, 0x1136c], [0x11370, 0x11374], [0x114b3, 0x114b8],
  [0x114ba, 0x114ba], [0x114bf, 0x114c0], [0x114c2, 0x114c3], [0x115b2, 0x115b5],
  [0x115bc, 0x115bd], [0x115bf, 0x115c0], [0x11633, 0x1163a], [0x1163d, 0x1163d],
  [0x1163f, 0x11640], [0x116ab, 0x116ab], [0x116ad, 0x116ad], [0x116b0, 0x116b5],
  [0x116b7, 0x116b7], [0x16af0, 0x16af4], [0x16b30, 0x16b36], [0x1bc9d, 0x1bc9e],
  [0x1d167, 0x1d169], [0x1d17b, 0x1d182], [0x1d185, 0x1d18b], [0x1d1aa, 0x1d1ad],
  [0x1d242, 0x1d244], [0x1da00, 0x1da36], [0x1da3b, 0x1da6c], [0x1da75, 0x1da75],
  [0x1da84, 0x1da84], [0x1da9b, 0x1da9f], [0x1daa1, 0x1daaf], [0x1e8d0, 0x1e8d6],
  [0x1f3fb, 0x1f3ff], [0xe0100, 0xe01ef],
];

const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f2ff], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

function inRanges(cp, ranges) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = ranges[mid];
    if (cp < range[0]) hi = mid - 1;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** 单个码点在等宽字体下占几个单元格 */
function charWidth(cp) {
  if (cp < 0x20) return 0;                        // 控制字符
  if (cp >= 0x7f && cp < 0xa0) return 0;          // DEL / C1
  if (cp === 0x200d || cp === 0x200b) return 0;   // ZWJ / ZWSP
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0;  // 组合字符
  if (inRanges(cp, WIDE_RANGES)) return 2;        // 中日韩 / 全角 / emoji
  return 1;
}

/**
 * 字符串的显示宽度。tab 按 tabSize 展开到下一个制表位。
 * @param {string} str
 * @param {number} [tabSize=4]
 * @returns {number}
 */
function displayWidth(str, tabSize) {
  const ts = Number.isFinite(tabSize) && tabSize > 0 ? Math.floor(tabSize) : 4;
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp === 0x09) {
      width += ts - (width % ts);
      continue;
    }
    width += charWidth(cp);
  }
  return width;
}

/* ------------------------------------------------------------------ *
 * 行扫描：找出真正的注释起点
 * ------------------------------------------------------------------ */

function isBlank(line) {
  return /^[ \t]*$/.test(line);
}

function indentWidth(line, tabSize) {
  const m = /^[ \t]*/.exec(line);
  return displayWidth(m[0], tabSize);
}

/**
 * 判断 line[i] 处的引号是不是「一个标量节点的开头」。
 * YAML 的普通标量里可以随便出现单引号（name: John's file），
 * 那种情况不能当成引号字符串的开头。
 */
function isQuoteStart(line, i) {
  let j = i - 1;
  while (j >= 0 && (line[j] === ' ' || line[j] === '\t')) j--;
  if (j < 0) return true;
  const c = line[j];
  return c === ':' || c === '-' || c === '[' || c === '{' || c === ',';
}

/**
 * 扫描一行，返回注释起点与扫描结束时的引号状态。
 * @param {string} line
 * @param {{inSingle:boolean, inDouble:boolean}} state 上一行遗留的引号状态
 */
function findCommentStart(line, state) {
  let inSingle = state.inSingle;
  let inDouble = state.inDouble;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inSingle) {
      if (ch === "'") {
        if (line[i + 1] === "'") { i++; continue; }  // '' 转义
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '\\') { i++; continue; }            // 反斜杠转义
      if (ch === '"') inDouble = false;
      continue;
    }

    if ((ch === "'" || ch === '"') && isQuoteStart(line, i)) {
      if (ch === "'") inSingle = true;
      else inDouble = true;
      continue;
    }

    if (ch === '#') {
      // YAML 规范：'#' 必须在行首或前面是空白，否则是标量的一部分
      if (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t') {
        return { commentIndex: i, state: { inSingle, inDouble } };
      }
    }
  }

  return { commentIndex: -1, state: { inSingle, inDouble } };
}

/**
 * codePart 是不是一个块标量头（key: | 、- >- 、|2 等）。
 * 要求 | 或 > 是该节点的第一个字符，避免把 `key: a >` 这种普通标量误判。
 */
function isBlockScalarHeader(codePart) {
  const m = /(^|[ \t])([|>])([+-]?\d*|\d*[+-]?)$/.exec(codePart);
  if (!m) return false;
  // m.index 指向 | 或 > 之前的分隔空白，用 m[1].length 定位指示符本身
  const before = codePart.slice(0, m.index + m[1].length);
  if (/^[ \t]*(?:-[ \t]+)*$/.test(before)) return true;   // "|" / "- |" / "- - |"
  if (/:[ \t]*$/.test(before)) return true;               // "key: |" / "key:   >-"
  return false;
}

/* ------------------------------------------------------------------ *
 * 主分析
 * ------------------------------------------------------------------ */

function normOptions(opts) {
  const o = opts || {};
  const minSpaces = Number.isFinite(o.minSpaces) && o.minSpaces >= 1
    ? Math.floor(o.minSpaces)
    : 2;
  const tabSize = Number.isFinite(o.tabSize) && o.tabSize > 0 ? Math.floor(o.tabSize) : 4;
  const roundTo = Number.isFinite(o.roundTo) && o.roundTo > 1 ? Math.floor(o.roundTo) : 1;
  return {
    minSpaces,
    tabSize,
    roundTo,
    alignStandalone: o.alignStandalone !== false,
    column: Number.isFinite(o.column) && o.column >= 1 ? Math.floor(o.column) : null,
    onlyLines: o.onlyLines || null,
  };
}

/**
 * 逐行分析。（引号状态、块标量状态必须从文件第一行开始累积，
 * 所以调用方应始终传入完整文件的行数组，再用 onlyLines 限定改动范围。）
 *
 * @param {string[]} lines 不含换行符的行文本
 * @param {object} [opts]
 * @returns {{results: object[], maxCodeWidth: number}}
 */
function analyze(lines, opts) {
  const o = normOptions(opts);
  const results = [];
  let blockIndent = null;                       // 当前块标量的父级缩进；null 表示不在块标量里
  let quote = { inSingle: false, inDouble: false };
  let maxCodeWidth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1) 块标量内部一律跳过（里面的 # 是内容，不是注释）
    if (blockIndent !== null) {
      if (isBlank(line) || indentWidth(line, o.tabSize) > blockIndent) {
        results.push({ line: i, kind: 'block-scalar-content', commentIndex: -1, skipped: true, code: line, codeWidth: 0 });
        continue;
      }
      blockIndent = null;                       // 缩进回到父级，块标量结束，继续正常处理本行
    }

    const startedInQuote = quote.inSingle || quote.inDouble;
    const scan = findCommentStart(line, quote);
    quote = scan.state;

    const info = {
      line: i,
      kind: 'none',
      commentIndex: scan.commentIndex,
      skipped: false,
      code: line,
      codeWidth: 0,
    };

    let code = line;

    if (scan.commentIndex >= 0) {
      code = line.slice(0, scan.commentIndex).replace(/[ \t]+$/, '');
      info.code = code;
      info.codeWidth = displayWidth(code, o.tabSize);

      const standalone = code.trim() === '';
      info.kind = standalone ? 'standalone' : 'trailing';

      if (standalone && !o.alignStandalone) info.skipped = true;
      else if (!standalone) maxCodeWidth = Math.max(maxCodeWidth, info.codeWidth);
    }

    results.push(info);

    // 2) 检测块标量头。注意：没有注释、没有改动需求的行同样必须走这一步，
    //    否则块标量内部的 # 会被当成注释改坏。
    //    引号内不可能出现块标量头，跳过可避免多行引号串里的误判。
    if (!startedInQuote && !quote.inSingle && !quote.inDouble && isBlockScalarHeader(code)) {
      blockIndent = indentWidth(line, o.tabSize);
    }
  }

  return { results, maxCodeWidth };
}

/** 由最长代码行推算推荐列号（1 起算，含 minSpaces 间隔） */
function recommendedColumn(maxCodeWidth, opts) {
  const o = normOptions(opts);
  let col = maxCodeWidth + o.minSpaces + 1;
  if (o.roundTo > 1) col = Math.ceil(col / o.roundTo) * o.roundTo;
  return Math.max(col, o.minSpaces + 1);
}

function resolveColumn(maxCodeWidth, opts) {
  const o = normOptions(opts);
  const c = o.column;
  if (Number.isFinite(c) && c >= 1) return Math.floor(c);
  return recommendedColumn(maxCodeWidth, o);
}

/**
 * 计算对齐后的改动。
 * @param {string[]} lines 完整文件的行文本
 * @param {object} opts
 * @param {number} [opts.column]  目标列（1 起算，即 '#' 所在的列）。缺省则用推荐列。
 * @param {number} [opts.minSpaces=2]
 * @param {number} [opts.tabSize=4]
 * @param {boolean} [opts.alignStandalone=true]
 * @param {number[]|Set<number>} [opts.onlyLines] 只改这些行（0 起算），其余行只参与分析
 * @returns {{edits: {line:number, oldText:string, newText:string}[], column:number, maxCodeWidth:number}}
 */
function align(lines, opts) {
  const o = normOptions(opts);
  const { results, maxCodeWidth } = analyze(lines, opts);
  const column = resolveColumn(maxCodeWidth, opts);
  const only = o.onlyLines ? new Set(o.onlyLines) : null;
  const edits = [];

  for (const r of results) {
    if (r.commentIndex < 0 || r.skipped) continue;
    if (only && !only.has(r.line)) continue;
    const original = lines[r.line];
    const pad = Math.max(o.minSpaces, column - 1 - r.codeWidth);
    const newText = r.code + ' '.repeat(pad) + original.slice(r.commentIndex);
    if (newText !== original) edits.push({ line: r.line, oldText: original, newText });
  }

  return { edits, column, maxCodeWidth };
}

/* ------------------------------------------------------------------ *
 * 纯文本入口（命令行用）
 * ------------------------------------------------------------------ */

/** 切分文本，同时保留每行原来的换行符，保证 CRLF/LF 不被改动 */
function splitLines(text) {
  const src = String(text);
  const parts = src.split(/(\r\n|\n|\r)/);
  const lines = [];
  const eols = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i]);
    eols.push(i + 1 < parts.length ? parts[i + 1] : '');
  }
  if (lines.length > 1 && lines[lines.length - 1] === '' && eols[eols.length - 1] === '') {
    lines.pop();
    eols.pop();
  }
  return { lines, eols };
}

function joinLines(lines, eols) {
  let out = '';
  for (let i = 0; i < lines.length; i++) out += lines[i] + (eols[i] || '');
  return out;
}

/**
 * 直接对文本做对齐。
 * @returns {{text:string, edits:object[], column:number, maxCodeWidth:number}}
 */
function formatText(text, opts) {
  const { lines, eols } = splitLines(text);
  const res = align(lines, opts);
  for (const e of res.edits) lines[e.line] = e.newText;
  return { text: joinLines(lines, eols), edits: res.edits, column: res.column, maxCodeWidth: res.maxCodeWidth };
}

module.exports = {
  displayWidth,
  charWidth,
  analyze,
  align,
  formatText,
  recommendedColumn,
  splitLines,
  joinLines,
  isBlockScalarHeader,
  findCommentStart,
};

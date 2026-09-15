#!/usr/bin/env node
'use strict';

/**
 * 命令行预览 / 批量对齐工具（和 VSCode 扩展共用同一套核心逻辑）。
 *
 *   node tools/preview.js examples/docker-compose.sample.yml              # 预览，不写盘
 *   node tools/preview.js examples/docker-compose.sample.yml -c 42 -w     # 对齐到第 42 列并写回
 *   node tools/preview.js . -r -w                                         # 递归，用自动推荐列号
 *   node tools/preview.js ./compose --check                               # CI / pre-commit 校验
 */

const fs = require('fs');
const path = require('path');
const core = require('../src/core');

/* ------------------------------ 参数 ------------------------------ */

function usage() {
  console.log(`用法: node tools/preview.js [选项] <文件或目录...>

选项:
  -c, --column <n>      目标列（1 起算，'#' 所在列）。不传则用自动推荐列号。
  -r, --recommend       显式使用“最长代码行 + minSpaces”推荐列号
  -m, --min-spaces <n>  代码与 # 之间至少保留的空格数（默认 2）
      --round <n>       推荐列号向上取整到 n 的倍数（默认 1）
      --no-standalone   不处理独占一行的注释
  -w, --write           原地写回（不加则只预览）
      --check           只校验；有需要调整的文件时退出码为 1
      --max-diff <n>    每个文件最多显示多少行对比（默认 40）
  -h, --help            显示本帮助
`);
}

function parseArgs(argv) {
  const opts = {
    column: null,
    minSpaces: 2,
    roundTo: 1,
    alignStandalone: true,
    write: false,
    check: false,
    recommend: false,
    maxDiff: 40,
    targets: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} 缺少参数`);
      return v;
    };
    switch (a) {
      case '-c': case '--column': opts.column = Number(next()); break;
      case '-m': case '--min-spaces': opts.minSpaces = Number(next()); break;
      case '--round': opts.roundTo = Number(next()); break;
      case '--max-diff': opts.maxDiff = Number(next()); break;
      case '-r': case '--recommend': opts.recommend = true; break;
      case '--no-standalone': opts.alignStandalone = false; break;
      case '-w': case '--write': opts.write = true; break;
      case '--check': opts.check = true; break;
      case '-h': case '--help': usage(); process.exit(0); break;
      default:
        if (a.startsWith('-')) throw new Error(`未知选项: ${a}`);
        opts.targets.push(a);
    }
  }

  if (opts.column !== null && (!Number.isFinite(opts.column) || opts.column < 1)) {
    throw new Error('--column 需要一个不小于 1 的整数');
  }
  if (!Number.isFinite(opts.minSpaces) || opts.minSpaces < 1) opts.minSpaces = 2;
  if (!Number.isFinite(opts.roundTo) || opts.roundTo < 1) opts.roundTo = 1;

  return opts;
}

/* --------------------------- 收集文件 --------------------------- */

const YAML_EXT = new Set(['.yml', '.yaml']);

function collect(targets) {
  const files = [];
  const seen = new Set();

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && YAML_EXT.has(path.extname(entry.name).toLowerCase())) {
        if (!seen.has(full)) { seen.add(full); files.push(full); }
      }
    }
  };

  for (const t of targets) {
    let st;
    try {
      st = fs.statSync(t);
    } catch {
      console.error(`跳过（找不到）: ${t}`);
      continue;
    }
    if (st.isDirectory()) walk(t);
    else if (!seen.has(t)) { seen.add(t); files.push(t); }
  }

  return files.sort();
}

/* ---------------------------- 输出 ---------------------------- */

function showDiff(file, lines, edits, column, maxDiff) {
  console.log(`\n${file}  →  目标列 ${column}，改动 ${edits.length} 行`);
  const shown = edits.slice(0, maxDiff);
  for (const e of shown) {
    console.log(`  ${String(e.line + 1).padStart(4)} - ${e.oldText}`);
    console.log(`  ${' '.repeat(4)} + ${e.newText}`);
  }
  if (edits.length > shown.length) {
    console.log(`  ... 还有 ${edits.length - shown.length} 行未显示`);
  }
}

/* ---------------------------- 主流程 ---------------------------- */

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`参数错误: ${err.message}\n`);
    usage();
    process.exit(2);
  }

  if (opts.targets.length === 0) {
    usage();
    process.exit(2);
  }

  const files = collect(opts.targets);
  if (files.length === 0) {
    console.log('没有找到 .yml / .yaml 文件。');
    process.exit(0);
  }

  let changedFiles = 0;
  let changedLines = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const res = core.formatText(text, {
      column: opts.column === null ? undefined : opts.column,
      minSpaces: opts.minSpaces,
      roundTo: opts.roundTo,
      alignStandalone: opts.alignStandalone,
    });

    if (res.edits.length === 0) {
      if (!opts.check) console.log(`${file}  →  已对齐（第 ${res.column} 列），无需改动`);
      continue;
    }

    changedFiles++;
    changedLines += res.edits.length;

    if (opts.check) {
      console.log(`需要调整: ${file}  (${res.edits.length} 行，目标列 ${res.column})`);
      continue;
    }

    if (res.edits.length > 0) {
      showDiff(file, text.split('\n'), res.edits, res.column, opts.maxDiff);
    }
    if (opts.write) {
      fs.writeFileSync(file, res.text, 'utf8');
    }
  }

  const action = opts.check ? '需要调整' : opts.write ? '已改写' : '待调整';
  console.log(`\n共扫描 ${files.length} 个文件，${action} ${changedFiles} 个（${changedLines} 行）`);
  if (!opts.write && !opts.check && changedFiles > 0) {
    console.log('提示：加上 -w 或 --write 才会真正写回文件。');
  }

  process.exit(opts.check && changedFiles > 0 ? 1 : 0);
}

main();

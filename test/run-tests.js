'use strict';

/**
 * 核心逻辑测试：node test/run-tests.js
 * 不依赖任何测试框架。
 */

const assert = require('assert/strict');
const core = require('../src/core');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  \u2717 ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

/** '#' 所在的显示列（1 起算），没有注释返回 -1 */
function hashColumn(line, tabSize) {
  const idx = core.findCommentStart(line, { inSingle: false, inDouble: false }).commentIndex;
  if (idx < 0) return -1;
  return core.displayWidth(line.slice(0, idx), tabSize || 4) + 1;
}

function assertColumns(text, column, opts) {
  const lines = text.split('\n');
  for (const line of lines) {
    const col = hashColumn(line, (opts && opts.tabSize) || 4);
    if (col === -1) continue;
    assert.equal(col, column, `期望 '#' 在第 ${column} 列，实际第 ${col} 列: ${JSON.stringify(line)}`);
  }
}

function align(text, opts) {
  return core.formatText(text, opts);
}

/* ------------------------------------------------------------------ */

group('显示宽度');

test('ASCII 按 1 计', () => {
  assert.equal(core.displayWidth('abc'), 3);
});

test('中文按 2 计', () => {
  assert.equal(core.displayWidth('中文'), 4);
  assert.equal(core.displayWidth('挂载MySQL数据目录'), 17);   // 4 + 5 + 8
});

test('全角标点按 2 计', () => {
  assert.equal(core.displayWidth('（全角）'), 8);
});

test('tab 展开到下一个制表位', () => {
  assert.equal(core.displayWidth('\tkey', 4), 7);
  assert.equal(core.displayWidth('a\tb', 4), 5);
  assert.equal(core.displayWidth('ab\tc', 4), 5);
});

test('组合字符与零宽字符按 0 计', () => {
  assert.equal(core.displayWidth('e\u0301'), 1);
  assert.equal(core.displayWidth('a\u200bb'), 2);
});

test('emoji 按 2 计', () => {
  assert.equal(core.displayWidth('🚀'), 2);
});

/* ------------------------------------------------------------------ */

group('行尾注释对齐');

test('基本对齐到指定列', () => {
  const src = [
    "version: '3' # 版本",
    'services: # 服务',
    '  db: # 数据库',
    '    container_name: wp-mysql # 容器名',
  ].join('\n');
  const out = align(src, { column: 42 });
  assertColumns(out.text, 42);
  assert.equal(out.edits.length, 4);
  const lines = out.text.split('\n');
  // 代码部分必须原样保留
  assert.ok(lines[0].startsWith("version: '3'"));
  assert.ok(lines[3].startsWith('    container_name: wp-mysql'));
  assert.ok(lines[3].endsWith('# 容器名'));
});

test('中文注释按显示宽度对齐（代码部分含中文）', () => {
  const src = '名称: 值 # 注释';
  const out = align(src, { column: 20 });
  // '名称: 值' 显示宽度 = 2+2+1+1+2 = 8 => 补 11 个空格
  assert.equal(out.text, '名称: 值' + ' '.repeat(11) + '# 注释');
  assert.equal(hashColumn(out.text), 20);
  // 若按字符数（5）算会补 14 个空格，'#' 会跑到第 23 列 —— 这里明确按显示宽度
  assert.equal(core.displayWidth(out.text.slice(0, out.text.indexOf('#'))), 19);
});

test('代码超过目标列时只留最小间隔', () => {
  const src = 'key: averyverylongvalue # c';
  const out = align(src, { column: 10, minSpaces: 2 });
  assert.equal(out.text, 'key: averyverylongvalue  # c');
});

test('minSpaces 可配置', () => {
  const src = 'key: 1 # c';
  const out = align(src, { column: 10, minSpaces: 4 });
  assert.equal(out.text, 'key: 1    # c');
});

test('目标列变小会把空白收回去', () => {
  const src = 'key: 1' + ' '.repeat(30) + '# c';
  const out = align(src, { column: 10 });
  assert.equal(out.text, 'key: 1   # c');
});

test('重复执行结果不变（幂等）', () => {
  const src = [
    'services:',
    '  db: # 数据库服务',
    '    image: mysql:8.0   # 镜像',
    '# 独立注释',
  ].join('\n');
  const once = align(src, { column: 40 });
  const twice = align(once.text, { column: 40 });
  assert.equal(twice.text, once.text);
  assert.equal(twice.edits.length, 0);
});

/* ------------------------------------------------------------------ */

group('独立成行的注释（方案 A：推到目标列）');

test('整行注释与行尾注释对齐到同一列', () => {
  const src = ['services:', '# 上一行是服务定义', '  db: x # c'].join('\n');
  const out = align(src, { column: 20 });
  assertColumns(out.text, 20);
  const lines = out.text.split('\n');
  assert.equal(lines[1], ' '.repeat(19) + '# 上一行是服务定义');
  assert.equal(lines[2], '  db: x' + ' '.repeat(12) + '# c');
});

test('缩进的整行注释也会被推到目标列', () => {
  const src = ['a:', '    # 缩进的注释'].join('\n');
  const out = align(src, { column: 12 });
  assert.equal(out.text.split('\n')[1], ' '.repeat(11) + '# 缩进的注释');
});

test('关掉 alignStandaloneComments 后整行注释不动', () => {
  const src = ['a:', '# 保持原样', 'b: 1 # c'].join('\n');
  const out = align(src, { column: 20, alignStandalone: false });
  const lines = out.text.split('\n');
  assert.equal(lines[1], '# 保持原样');
  assert.equal(hashColumn(lines[2]), 20);
});

/* ------------------------------------------------------------------ */

group('不误判：# 不是注释的场景');

test('引号里的 # 不动（单引号）', () => {
  const src = "key: 'a # b'";
  const out = align(src, { column: 40 });
  assert.equal(out.text, src);
  assert.equal(out.edits.length, 0);
});

test('引号里的 # 不动（双引号）', () => {
  const src = 'key: "a # b"';
  const out = align(src, { column: 40 });
  assert.equal(out.text, src);
});

test('# 前面没有空白不算注释（YAML 规范）', () => {
  const src = 'password: p#ssw0rd';
  const out = align(src, { column: 40 });
  assert.equal(out.text, src);
});

test('URL 里的 # 不算注释', () => {
  const src = 'url: http://example.com/a#b';
  const out = align(src, { column: 40 });
  assert.equal(out.text, src);
});

test("普通标量里的撇号不影响注释识别（John's file）", () => {
  const src = "name: John's file # 人名";
  const out = align(src, { column: 30 });
  assert.equal(hashColumn(out.text), 30);
  assert.ok(out.text.startsWith("name: John's file"));
});

test('引号闭合后的注释正常对齐', () => {
  const src = 'key: "value" # 注释';
  const out = align(src, { column: 24 });
  assert.equal(hashColumn(out.text), 24);
  assert.ok(out.text.startsWith('key: "value"'));
});

test('多行双引号标量内部的 # 不动', () => {
  const src = [
    'key: "line one',
    '  two # 这不是注释"',
    'next: 1 # 这是注释',
  ].join('\n');
  const out = align(src, { column: 30 });
  const lines = out.text.split('\n');
  assert.equal(lines[1], '  two # 这不是注释"');
  assert.equal(hashColumn(lines[2]), 30);
});

test('引号跨行未闭合时整段当成字符串，不会误改', () => {
  const src = ['key: "line one', '  still text # 不是注释'].join('\n');
  const out = align(src, { column: 30 });
  assert.equal(out.text, src);
});

/* ------------------------------------------------------------------ */

group('块标量保护');

test('| 块内的 # 一律不动', () => {
  const src = [
    'a: |',
    '  # 这不是注释',
    '  text # 也不是',
    'b: 1 # 这才是',
  ].join('\n');
  const out = align(src, { column: 20 });
  const lines = out.text.split('\n');
  assert.equal(lines[1], '  # 这不是注释');
  assert.equal(lines[2], '  text # 也不是');
  assert.equal(hashColumn(lines[3]), 20);
});

test('缩进的 | 块按父级缩进判定结束', () => {
  const src = [
    'x:',
    '  a: |',
    '    text # 不是注释',
    '  b: 1 # 是注释',
  ].join('\n');
  const out = align(src, { column: 20 });
  const lines = out.text.split('\n');
  assert.equal(lines[2], '    text # 不是注释');
  assert.equal(hashColumn(lines[3]), 20);
});

test('>- 与 |2 形式都能识别', () => {
  const src = [
    'a: >-',
    '  text # 不是注释',
    'b: |2',
    '    text # 不是注释',
    'c: 1 # 是注释',
  ].join('\n');
  const out = align(src, { column: 20 });
  const lines = out.text.split('\n');
  assert.equal(lines[1], '  text # 不是注释');
  assert.equal(lines[3], '    text # 不是注释');
  assert.equal(hashColumn(lines[4]), 20);
});

test('块标量之后的整行注释会被处理', () => {
  const src = [
    'a: |',
    '  content',
    '# 块后面的独立注释',
  ].join('\n');
  const out = align(src, { column: 20 });
  assert.equal(out.text.split('\n')[2], ' '.repeat(19) + '# 块后面的独立注释');
});

test('块标量包含空行时不会提前结束', () => {
  const src = [
    'a: |',
    '  line1',
    '',
    '  line2 # 不是注释',
    'b: 1 # 是注释',
  ].join('\n');
  const out = align(src, { column: 20 });
  const lines = out.text.split('\n');
  assert.equal(lines[3], '  line2 # 不是注释');
  assert.equal(hashColumn(lines[4]), 20);
});

test('块标量头本身的行尾注释会被对齐', () => {
  const src = 'a: | # 这是一个多行文本';
  const out = align(src, { column: 24 });
  assert.equal(hashColumn(out.text), 24);
  assert.ok(out.text.startsWith('a: |'));
});

test('isBlockScalarHeader 不误判普通标量', () => {
  assert.equal(core.isBlockScalarHeader('a: |'), true);
  assert.equal(core.isBlockScalarHeader('a: >-'), true);
  assert.equal(core.isBlockScalarHeader('- |'), true);
  assert.equal(core.isBlockScalarHeader('a: |2-'), true);
  assert.equal(core.isBlockScalarHeader('a: a >'), false);
  assert.equal(core.isBlockScalarHeader('key: [|]'), false);
  assert.equal(core.isBlockScalarHeader('foo|'), false);
  assert.equal(core.isBlockScalarHeader('key: value'), false);
});

/* ------------------------------------------------------------------ */

group('范围与整体行为');

test('onlyLines 只改选中的行', () => {
  const src = ['a: 1 # one', 'b: 2 # two', 'c: 3 # three'].join('\n');
  const out = align(src, { column: 20, onlyLines: [1] });
  const lines = out.text.split('\n');
  assert.equal(lines[0], 'a: 1 # one');
  assert.equal(hashColumn(lines[1]), 20);
  assert.equal(lines[2], 'c: 3 # three');
});

test('选区在块标量中间时，靠整文件分析保证不误改', () => {
  const src = ['a: |', '  text # 不是注释', 'b: 1 # 是注释'].join('\n');
  // 只选第 1 行（块标量内部），结果应当什么都不改
  const out = align(src, { column: 20, onlyLines: [1] });
  assert.equal(out.edits.length, 0);
});

test('推荐列号 = 最长代码行 + minSpaces', () => {
  const src = ['a: 1 # x', 'bbbbbb: 2 # y', 'c: 3 # z'].join('\n');
  const res = align(src, { minSpaces: 2 });
  assert.equal(res.column, 12);
  assertColumns(res.text, 12);
  assert.equal(core.displayWidth('bbbbbb: 2'), 9);
});

test('推荐列号可以向上取整到指定倍数', () => {
  const src = ['a: 1 # x', 'bbbbbb: 2 # y'].join('\n');
  const res = align(src, { minSpaces: 2, roundTo: 8 });
  assert.equal(res.column, 16);   // 9+2+1 = 12 -> 16
});

test('没有注释时不做任何改动', () => {
  const src = ['a: 1', 'b: 2'].join('\n');
  const out = align(src, { column: 20 });
  assert.equal(out.text, src);
  assert.equal(out.edits.length, 0);
});

test('保留 tab 缩进，只补注释前的空白', () => {
  const src = '\tkey: 1 # c';
  const out = align(src, { column: 20, tabSize: 4 });
  assert.equal(out.text, '\tkey: 1' + ' '.repeat(9) + '# c');
  assert.equal(hashColumn(out.text, 4), 20);
});

test('CRLF 换行不被破坏', () => {
  const src = 'a: 1 # one\r\nb: 2 # two\r\n';
  const out = align(src, { column: 20 });
  assert.ok(out.text.includes('\r\n'));
  assert.equal((out.text.match(/\r\n/g) || []).length, 2);
  assert.ok(!/[^\r]\n/.test(out.text), '不能出现裸 LF');
  assertColumns(out.text.replace(/\r\n/g, '\n'), 20);
});

test('文件末尾没有换行时也不会多出来', () => {
  const out = align('a: 1 # one', { column: 20 });
  assert.ok(!out.text.endsWith('\n'));
});

test('空文件 / 空行 / 纯空白行安全', () => {
  assert.equal(align('', { column: 20 }).text, '');
  assert.equal(align('\n\n', { column: 20 }).text, '\n\n');
  assert.equal(align('a: 1 # c\n\n   \nb: 2 # d', { column: 20 }).text.split('\n')[2], '   ');
});

test('只改注释前的空白，注释正文和代码一个字符都不动', () => {
  const src = 'key:   "value"   # 注释里有 # 号和 空格  ';
  const out = align(src, { column: 30 });
  assert.ok(out.text.endsWith('# 注释里有 # 号和 空格  '));
  const code = out.text.slice(0, out.text.indexOf('#')).replace(/ +$/, '');
  assert.equal(code, 'key:   "value"');
});

/* ------------------------------------------------------------------ */

group('真实场景样例');

test('docker-compose 样例整体对齐到第 42 列', () => {
  const src = [
    "version: '3'                        # Compose文件格式版本号",
    'services:                           # 定义运行的服务',
    '  db:                               # 服务名称：数据库服务',
    '    container_name: wp-mysql       # 容器名称',
    '    image: mysql:8.0               # 使用的镜像及版本',
    '    volumes:                       # 挂载数据卷',
    '      - ./db_data:/var/lib/mysql   # 挂载MySQL数据目录',
  ].join('\n');
  const out = align(src, { column: 42 });
  assertColumns(out.text, 42);
  const lines = out.text.split('\n');
  // 最长的一行决定不了列号（固定列）
  assert.equal(core.displayWidth(lines[0].slice(0, lines[0].indexOf('#'))), 41);
  assert.equal(core.displayWidth(lines[6].slice(0, lines[6].indexOf('#'))), 41);
  // 注释正文没丢
  assert.ok(lines[3].endsWith('# 容器名称'));
  assert.ok(lines[6].endsWith('# 挂载MySQL数据目录'));
});

/* ------------------------------------------------------------------ */

console.log(`\n${'-'.repeat(50)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exit(1);
}

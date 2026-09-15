'use strict';

/**
 * 扩展集成冒烟测试：node test/extension-smoke.js
 *
 * 没有真实 VS Code 环境，所以用一个假的 vscode 模块把扩展跑起来，
 * 验证「命令注册 → 输入框取列号 → WorkspaceEdit 写回」这条链路。
 * 核心算法本身的测试在 test/run-tests.js。
 */

const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

/* ------------------------- 假的 vscode ------------------------- */

class Range {
  constructor(startLine, startChar, endLine, endChar) {
    this.start = { line: startLine, character: startChar };
    this.end = { line: endLine, character: endChar };
  }
}

class WorkspaceEdit {
  constructor() { this.entries = []; }
  replace(uri, range, newText) { this.entries.push({ uri, range, newText }); }
}

const state = {
  inputValue: undefined,
  inputCancelled: false,
  messages: [],
  errors: [],
  commands: new Map(),
  config: {},
  editCount: 0,
  savedCommands: [],
  docSaves: 0,
  editor: undefined,
  activeOverride: undefined,
  afterApply: undefined,
  openedUris: [],
  output: [],
  configUpdates: [],
  executedArgs: [],
  installedExtensions: [],
  messageChoice: undefined,
  messageChoices: [],
  updateShouldFail: false,
  activeEditorListeners: [],
  messageButtons: [],
  formattingProviders: [],
  configListeners: [],
};

const fakeVscode = {
  Range,
  WorkspaceEdit,
  TextEdit: { replace: (range, newText) => ({ range, newText }) },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  Disposable: {
    from: (...items) => ({
      dispose: () => { for (const i of items) if (i && i.dispose) i.dispose(); },
    }),
  },
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file', toString: () => p }) },
  extensions: {
    getExtension: (id) =>
      (state.installedExtensions.includes(id) ? { id } : undefined),
  },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, dflt) => (key in state.config ? state.config[key] : dflt),
      update: async (key, value, target) => {
        if (state.updateShouldFail) throw new Error('没有注册配置，因此无法写入用户设置');
        state.configUpdates.push({ section, key, value, target });
      },
    }),
    applyEdit: async (wsEdit) => {
      state.editCount++;
      applyToDocument(state.editor.document, wsEdit.entries);
      if (state.afterApply) state.afterApply();
      return true;
    },
    openTextDocument: async (uri) => {
      state.openedUris.push(String(uri));
      return state.editor.document;
    },
    onDidChangeConfiguration: (cb) => {
      state.configListeners.push(cb);
      return { dispose() {} };
    },
  },
  window: {
    get activeTextEditor() { return state.activeOverride || state.editor; },
    showInputBox: async () => (state.inputCancelled ? undefined : state.inputValue),
    showInformationMessage: (m, ...buttons) => {
      state.messages.push(m);
      state.messageButtons = buttons;
      // 与真实 API 一致：没有按钮就没有返回值，不能消费选择队列
      if (!buttons.length) return undefined;
      if (state.messageChoices.length) return state.messageChoices.shift();
      return state.messageChoice;
    },
    showWarningMessage: (m) => { state.messages.push(m); },
    showErrorMessage: (m) => { state.errors.push(m); },
    showTextDocument: async () => state.editor,
    onDidChangeActiveTextEditor: (cb) => {
      state.activeEditorListeners.push(cb);
      return { dispose() {} };
    },
    createOutputChannel: () => ({
      clear: () => { state.output = []; },
      appendLine: (l) => { state.output.push(l); },
      show: () => {},
      dispose: () => {},
    }),
  },
  commands: {
    registerCommand: (id, cb) => {
      state.commands.set(id, cb);
      return { dispose() {} };
    },
    registerTextEditorCommand: (id, cb) => {
      state.commands.set(id, cb);
      return { dispose() {} };
    },
    executeCommand: async (id, ...args) => {
      state.savedCommands.push(id);
      state.executedArgs = args;
    },
  },
  languages: {
    registerDocumentFormattingEditProvider: (selector, provider) => {
      const entry = { selector, provider, kind: 'document' };
      state.formattingProviders.push(entry);
      return { dispose: () => removeProvider(entry) };
    },
    registerDocumentRangeFormattingEditProvider: (selector, provider) => {
      const entry = { selector, provider, kind: 'range' };
      state.formattingProviders.push(entry);
      return { dispose: () => removeProvider(entry) };
    },
  },
};

function removeProvider(entry) {
  const i = state.formattingProviders.indexOf(entry);
  if (i >= 0) state.formattingProviders.splice(i, 1);
}

function applyToDocument(doc, entries) {
  const lines = [];
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text);
  for (const e of entries) {
    assert.equal(e.range.start.character, 0, '应当整行替换');
    assert.equal(e.range.end.character, lines[e.range.start.line].length, '应当替换到行尾（不含换行符）');
    lines[e.range.start.line] = e.newText;
  }
  doc.setText(lines.join('\n'));
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return origLoad.apply(this, arguments);
};

/* --------------------------- 跑起来 --------------------------- */

const ext = require('../src/extension');

function makeDocument(text) {
  let lines = text.split('\n');
  const doc = {
    uri: fakeVscode.Uri.file('/tmp/test.yml'),
    languageId: 'yaml',
    get lineCount() { return lines.length; },
    lineAt: (i) => ({ text: lines[i] }),
    getText: () => lines.join('\n'),
    setText: (t) => { lines = t.split('\n'); },
    save: async () => { state.docSaves++; },
  };
  return doc;
}

function makeEditor(text, selection) {
  const document = makeDocument(text);
  return {
    document,
    options: { tabSize: 4 },
    selection: selection || {
      isEmpty: true,
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
  };
}

let passed = 0;
const failures = [];

async function test(name, fn) {
  state.messages = [];
  state.errors = [];
  state.inputCancelled = false;
  state.config = {};
  state.savedCommands = [];
  state.docSaves = 0;
  state.editor = undefined;
  state.activeOverride = undefined;
  state.afterApply = undefined;
  state.openedUris = [];
  state.output = [];
  state.configUpdates = [];
  state.executedArgs = [];
  state.installedExtensions = [];
  state.messageChoice = undefined;
  state.messageChoices = [];
  state.updateShouldFail = false;
  state.messageButtons = [];
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  \u2717 ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}

async function main() {
  console.log('扩展集成冒烟测试');

  const ctx = {
    subscriptions: { push() {} },
    extension: { id: 'miyauchirenge.yaml-comment-align' },
    globalState: {
      store: {},
      get(k) { return this.store[k]; },
      async update(k, v) { this.store[k] = v; },
    },
  };

  ext.activate(ctx);

  await test('四个命令都注册了', () => {
    assert.ok(state.commands.has('yamlCommentAlign.align'));
    assert.ok(state.commands.has('yamlCommentAlign.alignRecommended'));
    assert.ok(state.commands.has('yamlCommentAlign.diagnose'));
    assert.ok(state.commands.has('yamlCommentAlign.setup'));
  });

  await test('对齐命令：输入 42 → 文档被写到第 42 列并提示成功', async () => {
    const editor = makeEditor([
      "version: '3' # 版本",
      'services: # 服务',
      '  db: # 数据库',
    ].join('\n'));
    state.editor = editor;
    state.inputValue = '42';

    await state.commands.get('yamlCommentAlign.align')();

    const out = editor.document.getText().split('\n');
    for (const line of out) {
      const idx = line.indexOf('#');
      assert.equal(idx >= 0, true);
      assert.equal(idx, 41, `'#' 应在下标 41: ${JSON.stringify(line)}`);
    }
    assert.equal(state.errors.length, 0);
    assert.match(state.messages[0], /已把 3 处注释对齐到第 42 列/);
  });

  await test('记住上次列号：第二次命令默认值来自 globalState', async () => {
    assert.equal(ctx.globalState.get('yamlCommentAlign.lastColumn'), 42);

    let captured;
    const origShow = fakeVscode.window.showInputBox;
    fakeVscode.window.showInputBox = async (opts) => { captured = opts; return '42'; };
    try {
      const editor = makeEditor('a: 1 # x');
      state.editor = editor;
      await state.commands.get('yamlCommentAlign.align')();
    } finally {
      fakeVscode.window.showInputBox = origShow;
    }
    assert.equal(captured.value, '42');
    assert.ok(captured.validateInput('42') === null);
    assert.ok(captured.validateInput('abc') !== null);
  });

  await test('用户按 Esc 取消 → 文档不变', async () => {
    const src = 'a: 1 # x';
    const editor = makeEditor(src);
    state.editor = editor;
    state.inputCancelled = true;
    state.messages = [];

    await state.commands.get('yamlCommentAlign.align')();

    assert.equal(editor.document.getText(), src);
    assert.equal(state.messages.length, 0);
  });

  await test('推荐列号命令：按最长代码行自动定列（a: 1 / bbbbbb: 2 → 第 12 列）', async () => {
    const editor = makeEditor(['a: 1 # x', 'bbbbbb: 2 # y'].join('\n'));
    state.editor = editor;

    await state.commands.get('yamlCommentAlign.alignRecommended')();

    const out = editor.document.getText().split('\n');
    assert.equal(out[0], 'a: 1' + ' '.repeat(7) + '# x');
    assert.equal(out[1], 'bbbbbb: 2  # y');
    assert.match(state.messages[0], /第 12 列/);
  });

  await test('推荐列号可配置取整（roundRecommendedTo=8 → 第 16 列）', async () => {
    state.config = { roundRecommendedTo: 8 };
    const editor = makeEditor(['a: 1 # x', 'bbbbbb: 2 # y'].join('\n'));
    state.editor = editor;

    await state.commands.get('yamlCommentAlign.alignRecommended')();

    assert.equal(editor.document.getText().split('\n')[0].indexOf('#'), 15);
    assert.match(state.messages[0], /第 16 列/);
  });

  await test('minSpaces 配置生效', async () => {
    state.config = { minSpaces: 5 };
    const editor = makeEditor('key: averyverylongvalue # c');
    state.editor = editor;
    state.inputValue = '10';

    await state.commands.get('yamlCommentAlign.align')();

    assert.equal(editor.document.getText(), 'key: averyverylongvalue     # c');
  });

  await test('默认（saveAfterAlign=never）不偷偷保存文件', async () => {
    const editor = makeEditor('a: 1 # x');
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    assert.deepEqual(state.savedCommands, []);
    assert.equal(state.docSaves, 0, '默认不应保存');
    assert.ok(!/保存/.test(state.messages[0]), '提示里不该提保存');
  });

  await test('saveAfterAlign=withoutFormatting 时走「保存但不格式化」绕开 YAML 格式化器', async () => {
    state.config = { saveAfterAlign: 'withoutFormatting' };
    const editor = makeEditor('a: 1 # x');
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    assert.deepEqual(state.savedCommands, ['workbench.action.files.saveWithoutFormatting']);
    assert.equal(state.docSaves, 0, '不应走普通保存（会触发 Prettier）');
    assert.match(state.messages[0], /已保存（跳过格式化器）/);
  });

  await test('saveAfterAlign=never 时不保存', async () => {
    state.config = { saveAfterAlign: 'never' };
    const editor = makeEditor('a: 1 # x');
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    assert.deepEqual(state.savedCommands, []);
    assert.equal(state.docSaves, 0);
    assert.ok(!/保存/.test(state.messages[0]), '提示里不该提保存');
  });

  await test('saveAfterAlign=normal 时走普通保存', async () => {
    state.config = { saveAfterAlign: 'normal' };
    const editor = makeEditor('a: 1 # x');
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    assert.deepEqual(state.savedCommands, []);
    assert.equal(state.docSaves, 1);
    assert.match(state.messages[0], /已保存。/);
  });

  await test('没有改动时不保存文件', async () => {
    const editor = makeEditor('a: 1  # x');   // 已经在第 7 列
    state.editor = editor;
    state.inputValue = '7';

    await state.commands.get('yamlCommentAlign.align')();

    assert.deepEqual(state.savedCommands, []);
    assert.equal(state.docSaves, 0);
  });

  await test('右键文件树调用：按传入的 URI 打开对应文件再对齐', async () => {
    const editor = makeEditor('a: 1 # x');
    state.editor = editor;
    state.inputValue = '20';

    const uri = fakeVscode.Uri.file('/tmp/from-explorer.yml');
    await state.commands.get('yamlCommentAlign.align')(uri);

    assert.deepEqual(state.openedUris, ['/tmp/from-explorer.yml'], '应当打开右键点中的那个文件');
    assert.equal(editor.document.getText().split('\n')[0].indexOf('#'), 19);
  });

  await test('编辑器已不是当前窗口时不做保存（避免误存别的文件）', async () => {
    state.config = { saveAfterAlign: 'withoutFormatting' };
    const editor = makeEditor('a: 1 # x');
    state.editor = editor;
    state.inputValue = '20';
    // 写入完成后、保存之前，活动编辑器变成了别的文件
    state.afterApply = () => { state.activeOverride = { document: { uri: 'other' } }; };

    await state.commands.get('yamlCommentAlign.align')();

    assert.deepEqual(state.savedCommands, []);
    assert.equal(state.docSaves, 0);
    assert.match(state.messages[0], /未保存/);
  });

  await test('推荐列号命令也按配置保存', async () => {
    state.config = { saveAfterAlign: 'withoutFormatting' };
    const editor = makeEditor(['a: 1 # x', 'bbbbbb: 2 # y'].join('\n'));
    state.editor = editor;

    await state.commands.get('yamlCommentAlign.alignRecommended')();

    assert.deepEqual(state.savedCommands, ['workbench.action.files.saveWithoutFormatting']);
  });

  await test('选择某几行时只改这几行', async () => {    const editor = makeEditor(['a: 1 # one', 'b: 2 # two', 'c: 3 # three'].join('\n'), {
      isEmpty: false,
      start: { line: 1, character: 0 },
      end: { line: 1, character: 5 },
    });
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    const out = editor.document.getText().split('\n');
    assert.equal(out[0], 'a: 1 # one');
    assert.equal(out[1], 'b: 2' + ' '.repeat(15) + '# two');
    assert.equal(out[2], 'c: 3 # three');
    assert.match(state.messages[0], /1 处注释/);
  });

  await test('alignStandaloneComments=false 时不推整行注释', async () => {
    state.config = { alignStandaloneComments: false };
    const editor = makeEditor(['# 保持原样', 'b: 1 # c'].join('\n'));
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    const out = editor.document.getText().split('\n');
    assert.equal(out[0], '# 保持原样');
    assert.equal(out[1].indexOf('#'), 19);
  });

  await test('块标量内容在扩展链路里也不会被改', async () => {
    const src = ['a: |', '  # 内容', '  text # 内容', 'b: 1 # 注释'].join('\n');
    const editor = makeEditor(src);
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    const out = editor.document.getText().split('\n');
    assert.equal(out[1], '  # 内容');
    assert.equal(out[2], '  text # 内容');
    assert.equal(out[3].indexOf('#'), 19);
  });

  await test('没有可改的内容时给出提示且不产生编辑', async () => {
    const before = state.editCount;
    const editor = makeEditor(['a: 1', 'b: 2'].join('\n'));
    state.editor = editor;
    state.inputValue = '20';

    await state.commands.get('yamlCommentAlign.align')();

    assert.equal(state.editCount, before, '不应调用 applyEdit');
    assert.match(state.messages[0], /没有需要改动的注释/);
  });

  /* ---------------------- 格式化器 ---------------------- */

  const docFormat = () => state.formattingProviders.find((p) => p.kind === 'document').provider;
  const rangeFormat = () => state.formattingProviders.find((p) => p.kind === 'range').provider;

  await test('注册了 YAML / dockercompose 的文档与范围格式化器', () => {
    assert.deepEqual(state.formattingProviders.map((p) => p.kind).sort(), ['document', 'range']);
    for (const p of state.formattingProviders) {
      assert.deepEqual(p.selector, [{ language: 'yaml' }, { language: 'dockercompose' }]);
    }
  });

  await test('格式化器使用「上次手动对齐用过的列号」', async () => {
    await ctx.globalState.update('yamlCommentAlign.lastColumn', 20);
    const doc = makeDocument(['a: 1 # x', 'bbbbbb: 2 # y'].join('\n'));

    const edits = docFormat().provideDocumentFormattingEdits(doc, { tabSize: 2 });

    assert.equal(edits.length, 2);
    assert.equal(edits[0].range.start.line, 0);
    assert.equal(edits[0].range.end.character, 'a: 1 # x'.length, '应当替换到行尾且不含换行符');
    assert.equal(edits[0].newText, 'a: 1' + ' '.repeat(15) + '# x');
    assert.equal(edits[1].newText, 'bbbbbb: 2' + ' '.repeat(10) + '# y');
  });

  await test('没记住列号时格式化器回落到 defaultColumn 设置', async () => {
    await ctx.globalState.update('yamlCommentAlign.lastColumn', undefined);
    state.config = { defaultColumn: 30 };
    const doc = makeDocument('a: 1 # x');

    const edits = docFormat().provideDocumentFormattingEdits(doc, { tabSize: 2 });

    assert.equal(edits.length, 1);
    assert.equal(edits[0].newText.indexOf('#'), 29);
  });

  await test('已经对齐时格式化器返回空数组（不制造噪音 diff）', async () => {
    await ctx.globalState.update('yamlCommentAlign.lastColumn', 7);
    const doc = makeDocument('a: 1  # x');

    const edits = docFormat().provideDocumentFormattingEdits(doc, { tabSize: 2 });

    assert.deepEqual(edits, []);
  });

  await test('范围格式化只处理范围内的行', async () => {
    await ctx.globalState.update('yamlCommentAlign.lastColumn', 20);
    const doc = makeDocument(['a: 1 # one', 'b: 2 # two', 'c: 3 # three'].join('\n'));

    const edits = rangeFormat().provideDocumentRangeFormattingEdits(doc, new Range(1, 0, 1, 5), { tabSize: 2 });

    assert.equal(edits.length, 1);
    assert.equal(edits[0].range.start.line, 1);
  });

  await test('格式化器同样不动块标量内容', async () => {
    await ctx.globalState.update('yamlCommentAlign.lastColumn', 20);
    const doc = makeDocument(['a: |', '  # 内容', 'b: 1 # 注释'].join('\n'));

    const edits = docFormat().provideDocumentFormattingEdits(doc, { tabSize: 2 });

    assert.equal(edits.length, 1);
    assert.equal(edits[0].range.start.line, 2);
  });

  await test('registerFormatter=false 立即移除，改回 true 立即恢复', () => {
    const listener = state.configListeners[0];
    assert.ok(listener, '应当监听了配置变更');
    const event = { affectsConfiguration: (s) => s === 'yamlCommentAlign.registerFormatter' };

    state.config = { registerFormatter: false };
    listener(event);
    assert.equal(state.formattingProviders.length, 0);

    state.config = { registerFormatter: true };
    listener(event);
    assert.equal(state.formattingProviders.length, 2);
  });

  /* ---------------------- 诊断命令 ---------------------- */

  await test('诊断：formatOnSave 未开启时直接点明这是原因', async () => {
    state.config = { defaultColumn: 20, formatOnSave: false, defaultFormatter: 'miyauchirenge.yaml-comment-align' };
    state.editor = makeEditor('a: 1 # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    const text = state.output.join('\n');
    assert.match(text, /editor\.formatOnSave\s*: false/);
    assert.match(text, /没有开启/);
    assert.match(text, /Shift\+Alt\+F/);
  });

  await test('诊断：文件已对齐时说明「没有改动」而不是报错', async () => {
    await ctx.globalState.update('yamlCommentAlign.lastColumn', undefined);
    state.config = { defaultColumn: 7, formatOnSave: true, defaultFormatter: 'miyauchirenge.yaml-comment-align' };
    state.editor = makeEditor('a: 1  # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    const text = state.output.join('\n');
    assert.match(text, /需要改动的注释行\s*: 0/);
    assert.match(text, /已经对齐到第 7 列/);
  });

  await test('诊断输出的中文标签按显示宽度对齐', async () => {
    state.config = { defaultColumn: 20, formatOnSave: true, defaultFormatter: 'miyauchirenge.yaml-comment-align' };
    state.editor = makeEditor('a: 1 # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    const core = require('../src/core');
    const rows = state.output.filter((l) => l.includes(': ') && !l.startsWith('#') && !l.startsWith(' '));
    assert.ok(rows.length >= 5, `应当有若干行键值对，实际 ${rows.length} 行`);
    const cols = rows.map((l) => core.displayWidth(l.slice(0, l.indexOf(': '))));
    assert.equal(new Set(cols).size, 1,
      '冒号应当落在同一显示列，实际:\n' + rows.map((l, i) => `      [${cols[i]}] ${l}`).join('\n'));
  });

  await test('诊断：配置正确时给出肯定结论', async () => {
    state.config = { defaultColumn: 20, formatOnSave: true, defaultFormatter: 'miyauchirenge.yaml-comment-align' };
    state.editor = makeEditor('a: 1 # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    assert.match(state.output.join('\n'), /配置看起来是对的/);
  });

  await test('诊断：默认格式化器不是本扩展时提示重新指定', async () => {
    state.config = { defaultColumn: 20, formatOnSave: true, defaultFormatter: 'redhat.vscode-yaml' };
    state.editor = makeEditor('a: 1 # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    const text = state.output.join('\n');
    assert.match(text, /redhat\.vscode-yaml/);
    assert.match(text, /Format Document With/);
  });

  await test('诊断：registerFormatter=false 时说明格式化器为什么找不到', async () => {
    state.config = { registerFormatter: false };
    state.editor = makeEditor('a: 1 # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    const text = state.output.join('\n');
    assert.match(text, /registerFormatter = false/);
    assert.match(text, /找不到/);
  });

  await test('诊断：检测到旧版重复安装时优先警告', async () => {
    state.installedExtensions = ['localtools.yaml-comment-align'];
    state.config = { defaultColumn: 20, formatOnSave: true, defaultFormatter: 'miyauchirenge.yaml-comment-align' };
    state.editor = makeEditor('a: 1 # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    const text = state.output.join('\n');
    assert.match(text, /重复安装/);
    assert.match(text, /localtools\.yaml-comment-align/);
    assert.match(text, /卸载旧版/);
    assert.ok(state.messageButtons.includes('打开扩展面板'));
  });

  await test('诊断：报告 Red Hat 的 yaml.format.enable 实际取值', async () => {
    state.config = {
      defaultColumn: 20, formatOnSave: true,
      defaultFormatter: 'miyauchirenge.yaml-comment-align', 'format.enable': true,
    };
    state.editor = makeEditor('a: 1 # x');

    await state.commands.get('yamlCommentAlign.diagnose')();

    const text = state.output.join('\n');
    assert.match(text, /yaml\.format\.enable（Red Hat）\s*: true/);
    assert.match(text, /仍是启用状态/);
    assert.ok(state.messageButtons.includes('打开 yaml.format.enable 设置'));
  });

  await test('诊断：点「打开 formatOnSave 设置」只打开设置界面，不代写配置', async () => {
    state.config = { defaultColumn: 20, formatOnSave: false, defaultFormatter: 'miyauchirenge.yaml-comment-align' };
    state.editor = makeEditor('a: 1 # x');
    state.messageChoice = '打开 formatOnSave 设置';

    await state.commands.get('yamlCommentAlign.diagnose')();

    assert.deepEqual(state.savedCommands, ['workbench.action.openSettings']);
    assert.deepEqual(state.executedArgs, ['editor.formatOnSave']);
    assert.deepEqual(state.configUpdates, [], '不应代用户写配置');
  });

  await test('诊断：点「打开默认格式化器设置」会打开设置界面', async () => {
    state.config = { defaultColumn: 20, formatOnSave: true, defaultFormatter: 'redhat.vscode-yaml' };
    state.editor = makeEditor('a: 1 # x');
    state.messageChoice = '打开默认格式化器设置';

    await state.commands.get('yamlCommentAlign.diagnose')();

    assert.deepEqual(state.savedCommands, ['workbench.action.openSettings']);
    assert.deepEqual(state.executedArgs, ['editor.defaultFormatter']);
    assert.deepEqual(state.configUpdates, []);
  });

  await test('诊断：点「打开 yaml.format.enable 设置」会打开设置界面', async () => {
    state.config = {
      defaultColumn: 20, formatOnSave: true,
      defaultFormatter: 'miyauchirenge.yaml-comment-align', 'format.enable': true,
    };
    state.editor = makeEditor('a: 1 # x');
    state.messageChoice = '打开 yaml.format.enable 设置';

    await state.commands.get('yamlCommentAlign.diagnose')();

    assert.deepEqual(state.savedCommands, ['workbench.action.openSettings']);
    assert.deepEqual(state.executedArgs, ['yaml.format.enable']);
    assert.deepEqual(state.configUpdates, []);
  });

  /* ---------------------- 首次设置 ---------------------- */

  await test('首次设置：选「对齐后自动保存」只写本扩展自己的设置', async () => {
    state.editor = makeEditor('a: 1 # x');
    state.messageChoice = '对齐后自动保存（跳过格式化器）';

    await state.commands.get('yamlCommentAlign.setup')();

    assert.deepEqual(state.configUpdates, [
      { section: 'yamlCommentAlign', key: 'saveAfterAlign', value: 'withoutFormatting', target: 1 },
    ]);
    assert.match(state.messages[0], /想怎么用它/);
    assert.match(state.messages[1], /立即保存/);
  });

  await test('首次设置：Red Hat 装着且格式化器还开着时会追问，同意才写入', async () => {
    state.installedExtensions = ['redhat.vscode-yaml'];
    state.config = { 'format.enable': true };
    state.editor = makeEditor('a: 1 # x');
    state.messageChoices = ['对齐后自动保存（跳过格式化器）', '关掉 yaml.format.enable'];

    await state.commands.get('yamlCommentAlign.setup')();

    assert.deepEqual(state.configUpdates, [
      { section: 'yamlCommentAlign', key: 'saveAfterAlign', value: 'withoutFormatting', target: 1 },
      { section: 'yaml', key: 'format.enable', value: false, target: 1 },
    ]);
  });

  await test('首次设置：Red Hat 没装时不追问', async () => {
    state.editor = makeEditor('a: 1 # x');
    state.messageChoices = ['对齐后自动保存（跳过格式化器）'];

    await state.commands.get('yamlCommentAlign.setup')();

    assert.equal(state.configUpdates.length, 1, '只应写入本扩展自己的那一项');
  });

  await test('首次设置：选「只用快捷键」不写任何设置', async () => {
    state.editor = makeEditor('a: 1 # x');
    state.messageChoice = '只用快捷键，不改设置';

    await state.commands.get('yamlCommentAlign.setup')();

    assert.deepEqual(state.configUpdates, []);
    assert.match(state.messages[1], /Ctrl\+K Ctrl\+S/);
  });

  await test('首次设置：写设置失败只给警告，不抛错', async () => {
    state.editor = makeEditor('a: 1 # x');
    state.messageChoice = '对齐后自动保存（跳过格式化器）';
    state.updateShouldFail = true;

    await state.commands.get('yamlCommentAlign.setup')();   // 不应抛出

    assert.deepEqual(state.configUpdates, []);
    assert.match(state.messages.join('\n'), /没能自动写入/);
    assert.deepEqual(state.errors, [], '不应弹错误对话框');
  });

  await test('首次设置：激活时没有 YAML 文件就先不问，等打开 YAML 再问一次', async () => {
    assert.ok(state.activeEditorListeners.length > 0, '应当注册了活动编辑器监听');
    const listener = state.activeEditorListeners[0];

    listener({ document: { languageId: 'plaintext' } });
    assert.equal(state.messages.length, 0, '非 YAML 文件不应触发');

    state.messageChoice = '只用快捷键，不改设置';
    listener({ document: { languageId: 'dockercompose' } });
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(state.messages.some((m) => /想怎么用它/.test(m)), '打开 YAML 后应当问一次');
  });

  console.log(`\n${'-'.repeat(50)}`);
  if (failures.length === 0) {
    console.log(`全部通过：${passed} 项`);
    process.exit(0);
  }
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：${failures.join(', ')}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

'use strict';

const vscode = require('vscode');
const core = require('./core');

const STATE_LAST_COLUMN = 'yamlCommentAlign.lastColumn';
const STATE_SETUP_CHOICE = 'yamlCommentAlign.setupChoice';
const STATE_SETUP_PROMPTED = 'yamlCommentAlign.setupPrompted';

const YAML_LANGUAGES = new Set(['yaml', 'dockercompose']);

/* ------------------------------------------------------------------ *
 * 配置 / 工具
 * ------------------------------------------------------------------ */

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const SAVE_MODES = new Set(['never', 'withoutFormatting', 'normal']);

function readConfig(doc) {
  const c = vscode.workspace.getConfiguration('yamlCommentAlign', doc ? doc.uri : null);
  const rawSave = c.get('saveAfterAlign', 'never');
  return {
    defaultColumn: clampInt(c.get('defaultColumn'), 2, 100000, 40),
    minSpaces: clampInt(c.get('minSpaces'), 1, 100, 2),
    roundTo: clampInt(c.get('roundRecommendedTo'), 1, 1000, 1),
    alignStandalone: c.get('alignStandaloneComments', true) !== false,
    saveAfterAlign: SAVE_MODES.has(rawSave) ? rawSave : 'never',
    registerFormatter: c.get('registerFormatter', true) !== false,
  };
}

function tabSizeOf(editor) {
  const t = editor.options ? editor.options.tabSize : undefined;
  const n = typeof t === 'string' ? parseInt(t, 10) : t;
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/** 选区覆盖的行号（0 起算）；没有选区则返回 null，表示整篇 */
function selectedLines(editor) {
  const sel = editor.selection;
  if (!sel || sel.isEmpty) return null;
  const start = sel.start.line;
  let end = sel.end.line;
  if (sel.end.character === 0 && end > start) end -= 1;      // 选区停在下一行行首时不算进来
  const out = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function documentLines(doc) {
  const lines = new Array(doc.lineCount);
  for (let i = 0; i < doc.lineCount; i++) lines[i] = doc.lineAt(i).text;
  return lines;
}

/** 格式化器/命令都用的目标列：上次手动对齐用过的列 → 设置里的 defaultColumn */
function effectiveColumn(ctx, doc) {
  const cfg = readConfig(doc);
  const remembered = ctx.globalState.get(STATE_LAST_COLUMN);
  return clampInt(remembered, 2, 100000, cfg.defaultColumn);
}

/**
 * 右键菜单传入的是资源 URI，键盘/命令面板不带参数。
 * 统一从这里取到「本次要操作的编辑器」。
 */
async function resolveEditor(arg) {
  if (arg && typeof arg === 'object' && typeof arg.scheme === 'string') {
    const doc = await vscode.workspace.openTextDocument(arg);
    return vscode.window.showTextDocument(doc, { preview: false });
  }
  return vscode.window.activeTextEditor;
}

/* ------------------------------------------------------------------ *
 * 对齐
 * ------------------------------------------------------------------ */

/**
 * 注意：始终把整篇文档交给 core 分析（块标量 / 引号状态要从第 0 行累积），
 * 只用 onlyLines 限定真正改动的范围。
 */
function alignDocument(doc, opts) {
  const cfg = readConfig(doc);
  return core.align(documentLines(doc), {
    column: opts.column,
    minSpaces: cfg.minSpaces,
    tabSize: opts.tabSize,
    alignStandalone: cfg.alignStandalone,
    onlyLines: opts.onlyLines,
    roundTo: cfg.roundTo,          // 只在没给 column 时（自动推荐）起作用
  });
}

function toTextEdits(edits) {
  return edits.map((e) =>
    // 只替换行内容，不动行尾换行符（CRLF/LF 保持原样）
    vscode.TextEdit.replace(new vscode.Range(e.line, 0, e.line, e.oldText.length), e.newText)
  );
}

/**
 * 对齐之后保存。
 *
 * `withoutFormatting` 走内置的 `workbench.action.files.saveWithoutFormatting`
 * （菜单里的「文件: 保存但不格式化」），绕开 YAML 格式化器——否则装了
 * Red Hat YAML 那类扩展时，保存触发的 Prettier 会把刚对齐好的空白压回单个空格。
 *
 * 默认是 `never`：手动命令不偷偷写盘。想要保存即落盘的用户自行开启。
 */
async function saveAfterAlign(doc, mode) {
  if (mode === 'never') return 'none';

  const active = vscode.window.activeTextEditor;
  if (!active || active.document !== doc) {
    // saveWithoutFormatting / save 都只作用于当前活动编辑器，不是它就别乱动
    return 'skipped';
  }

  if (mode === 'withoutFormatting') {
    await vscode.commands.executeCommand('workbench.action.files.saveWithoutFormatting');
    return 'withoutFormatting';
  }

  await doc.save();
  return 'normal';
}

async function applyAlignment(editor, result, ctx, source) {
  const doc = editor.document;

  if (result.edits.length === 0) {
    vscode.window.showInformationMessage(
      `YAML 注释对齐：没有需要改动的注释（目标列 ${result.column}）。`
    );
    return;
  }

  const ws = new vscode.WorkspaceEdit();
  for (const e of result.edits) {
    // 整批一次提交，Ctrl+Z 单步撤销
    ws.replace(doc.uri, new vscode.Range(e.line, 0, e.line, e.oldText.length), e.newText);
  }

  const ok = await vscode.workspace.applyEdit(ws);
  if (!ok) {
    vscode.window.showErrorMessage('YAML 注释对齐：写入失败，文档可能已被修改，请重试。');
    return;
  }

  // 记住列号：下次输入框默认值、以及格式化器，都用它
  await ctx.globalState.update(STATE_LAST_COLUMN, result.column);

  const saved = await saveAfterAlign(doc, readConfig(doc).saveAfterAlign);

  const suffix = source === 'recommended'
    ? `（按最长代码行 ${result.maxCodeWidth} 自动推荐）`
    : '';
  let saveNote = '';
  if (saved === 'withoutFormatting') saveNote = '，已保存（跳过格式化器）';
  else if (saved === 'normal') saveNote = '，已保存';
  else if (saved === 'skipped') saveNote = '，未保存（该文件已不是当前编辑窗口）';

  vscode.window.showInformationMessage(
    `YAML 注释对齐：已把 ${result.edits.length} 处注释对齐到第 ${result.column} 列${suffix}${saveNote}。`
  );
}

/* ------------------------------------------------------------------ *
 * 命令
 * ------------------------------------------------------------------ */

async function commandAlign(arg, ctx) {
  const editor = await resolveEditor(arg);
  if (!editor) {
    vscode.window.showWarningMessage('YAML 注释对齐：请先打开一个文件并把光标放进编辑器。');
    return;
  }

  const cfg = readConfig(editor.document);
  const remembered = ctx.globalState.get(STATE_LAST_COLUMN);
  const initial = clampInt(remembered, 2, 100000, cfg.defaultColumn);
  const selected = selectedLines(editor);
  const scopeHint = selected ? `本次只处理选中的 ${selected.length} 行` : '本次处理整个文件';

  const input = await vscode.window.showInputBox({
    title: 'YAML 注释对齐',
    prompt: `注释 # 要对齐到第几列？（1 起算，中文按 2 个宽度算；${scopeHint}）`,
    placeHolder: String(cfg.defaultColumn),
    value: String(initial),
    valueSelection: [0, String(initial).length],
    validateInput: (v) => {
      const t = String(v).trim();
      if (!/^\d+$/.test(t)) return '请输入一个整数列号，例如 42';
      const n = Number(t);
      if (n < 2) return '列号至少为 2';
      if (n > 100000) return '列号过大';
      return null;
    },
  });

  if (input === undefined) return;                       // 用户按 Esc 取消

  const column = clampInt(String(input).trim(), 2, 100000, cfg.defaultColumn);
  const result = alignDocument(editor.document, {
    column,
    tabSize: tabSizeOf(editor),
    onlyLines: selected,
  });

  await applyAlignment(editor, result, ctx, 'manual');
}

async function commandAlignRecommended(arg, ctx) {
  const editor = await resolveEditor(arg);
  if (!editor) {
    vscode.window.showWarningMessage('YAML 注释对齐：请先打开一个文件并把光标放进编辑器。');
    return;
  }

  // 不传 column：core 会用「最长代码行 + minSpaces」自动推算，并按 roundRecommendedTo 取整
  const result = alignDocument(editor.document, {
    tabSize: tabSizeOf(editor),
    onlyLines: selectedLines(editor),
  });

  await applyAlignment(editor, result, ctx, 'recommended');
}

/* ------------------------------------------------------------------ *
 * 诊断
 *
 * 「保存时没有自动对齐」的原因基本只有三种，这个命令把它们直接列出来：
 *   1. 文件其实已经是对齐的，所以没有改动
 *   2. editor.formatOnSave 没开，保存时压根不会跑格式化器
 *   3. formatOnSave 开了，但当前语言的默认格式化器不是本扩展
 * ------------------------------------------------------------------ */

let outputChannel = null;

function getOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('YAML 注释对齐');
  }
  return outputChannel;
}

async function commandDiagnose(arg, ctx) {
  const editor = await resolveEditor(arg);
  if (!editor) {
    vscode.window.showWarningMessage('YAML 注释对齐：请先打开一个文件并把光标放进编辑器。');
    return;
  }

  const doc = editor.document;
  const cfg = readConfig(doc);
  const scope = { uri: doc.uri, languageId: doc.languageId };
  const editorCfg = vscode.workspace.getConfiguration('editor', scope);
  const formatOnSave = editorCfg.get('formatOnSave');
  const defaultFormatter = editorCfg.get('defaultFormatter');
  const autoSave = vscode.workspace.getConfiguration('files', scope).get('autoSave');
  const redhatFormat = vscode.workspace.getConfiguration('yaml', scope).get('format.enable');

  // 0.1.0 ~ 0.2.1 用的 publisher 是 localtools，0.3.0 起改成 miyauchirenge，
  // 两者是不同的扩展 ID，会同时存在并抢占同名命令。
  const staleInstall = vscode.extensions.getExtension
    ? vscode.extensions.getExtension('localtools.yaml-comment-align')
    : undefined;

  const remembered = ctx.globalState.get(STATE_LAST_COLUMN);
  const column = effectiveColumn(ctx, doc);
  const result = alignDocument(doc, { column, tabSize: tabSizeOf(editor), onlyLines: null });
  const selfId = ctx.extension ? ctx.extension.id : 'yaml-comment-align';

  // 用显示宽度对齐：标签可能是中文（占 2 列），写死宽度迟早会被更长的标签撑破，
  // 所以先量出最宽的标签再补齐。
  const rows = [
    ['文件', doc.uri.fsPath || doc.uri.toString()],
    ['语言', doc.languageId],
    ['格式化器已注册', cfg.registerFormatter ? '是' : '否（registerFormatter = false）'],
  ];
  if (staleInstall) {
    rows.push(['⚠ 重复安装', '旧版 localtools.yaml-comment-align 仍在，会抢占同名命令，建议卸载']);
  }
  rows.push(
    null,
    ['目标列', remembered
      ? `${column}（来自上次手动对齐记住的值）`
      : `${column}（来自 defaultColumn 设置）`],
    ['本文件需要改动的注释行', String(result.edits.length)],
    null,
    ['editor.defaultFormatter', JSON.stringify(defaultFormatter)],
    ['editor.formatOnSave', JSON.stringify(formatOnSave)],
    ['files.autoSave', JSON.stringify(autoSave)],
    ['yamlCommentAlign.saveAfterAlign', JSON.stringify(cfg.saveAfterAlign)],
    ['yaml.format.enable（Red Hat）', JSON.stringify(redhatFormat)],
  );

  const labelWidth = Math.max(...rows.filter(Boolean).map(([k]) => core.displayWidth(k)));

  const lines = ['# YAML 注释对齐 — 诊断', ''];
  for (const r of rows) {
    if (!r) { lines.push(''); continue; }
    const [k, v] = r;
    lines.push(k + ' '.repeat(Math.max(1, labelWidth + 1 - core.displayWidth(k))) + ': ' + v);
  }
  lines.push('');

  let verdict;
  if (staleInstall) {
    verdict = '检测到旧版本扩展（localtools.yaml-comment-align）仍在安装中。'
      + '两个版本会注册同名的对齐命令，命令行为会不可预期（例如「对齐后是否保存」不一致）。'
      + '请先在扩展面板卸载旧版，只保留 miyauchirenge.yaml-comment-align。';
  } else if (!cfg.registerFormatter) {
    verdict = '本扩展没有注册为格式化器（registerFormatter = false），所以 Format Document 里找不到它。'
      + '把该设置改回 true 即可。';
  } else if (result.edits.length === 0) {
    verdict = `本文件已经对齐到第 ${column} 列，保存时不会有任何改动。`
      + '如果你想换一个列号，先用 Ctrl+Alt+Y 指定，之后格式化器会用这个新列号。';
  } else if (formatOnSave !== true) {
    verdict = 'editor.formatOnSave 没有开启，所以保存时不会运行任何格式化器。'
      + '打开设置搜索 "format on save" 勾选，或直接按 Shift+Alt+F 手动格式化一次来验证格式化器本身是否正常。';
  } else if (defaultFormatter !== selfId) {
    verdict = `formatOnSave 已开启，但当前语言的默认格式化器是 ${JSON.stringify(defaultFormatter)}，不是本扩展（${selfId}）。`
      + '用 Format Document With... → 配置默认格式化器 重新指定。'
      + '此时保存会由那个格式化器执行，本扩展刚对齐好的空白会被它改回去。';
  } else if (redhatFormat === true) {
    verdict = `配置是对的，保存时应当由本扩展把 ${result.edits.length} 行对齐到第 ${column} 列。`
      + '但 Red Hat YAML 的格式化器仍是启用状态（yaml.format.enable = true）；'
      + '正常情况下它不会被执行（默认格式化器已是本扩展），如果保存后格式仍被改回，可以把它关掉。';
  } else {
    verdict = `配置看起来是对的：保存时应当把 ${result.edits.length} 行对齐到第 ${column} 列。`
      + '如果仍然没有变化，先按 Shift+Alt+F 手动格式化一次，再把这份输出发出来。';
  }

  lines.push('结论:');
  lines.push('  ' + verdict);
  lines.push('');

  const out = getOutputChannel();
  out.clear();
  for (const l of lines) out.appendLine(l);
  out.show(true);

  // 只提供当前确实需要的按钮。这里刻意只打开设置界面，不代替用户写配置：
  // 写语言级设置需要 overrideInLanguage 等细节，而写错会让命令直接抛错。
  const buttons = [];
  if (staleInstall) buttons.push('打开扩展面板');
  if (defaultFormatter !== selfId) buttons.push('打开默认格式化器设置');
  if (formatOnSave !== true) buttons.push('打开 formatOnSave 设置');
  if (redhatFormat === true) buttons.push('打开 yaml.format.enable 设置');

  const picked = await vscode.window.showInformationMessage(
    'YAML 注释对齐：诊断结果已输出到「输出」面板（YAML 注释对齐）。',
    ...buttons
  );

  if (picked === '打开默认格式化器设置') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'editor.defaultFormatter');
  } else if (picked === '打开 formatOnSave 设置') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'editor.formatOnSave');
  } else if (picked === '打开 yaml.format.enable 设置') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'yaml.format.enable');
  } else if (picked === '打开扩展面板') {
    await vscode.commands.executeCommand('workbench.view.extensions', 'localtools.yaml-comment-align');
  }
}

/* ------------------------------------------------------------------ *
 * 首次设置
 *
 * 装好后第一次打开 YAML 文件时问一次「想怎么用」，把选择写进设置，之后不再打扰，
 * 随时可以用命令「首次设置」重选。
 *
 * 写设置的铁律（踩过一次坑）：
 *   - 只写本扩展自己注册的设置（yamlCommentAlign.*），这类一定成功
 *   - 别人的设置只在确认对方已安装、并且该配置确实已注册时才写（例如 Red Hat 的
 *     yaml.format.enable）；语言级设置（[yaml].editor.defaultFormatter）不代写，
 *     只打开设置界面
 *   - 全部包在 try/catch 里：写失败最多是没生效，绝不能变成命令报错弹窗
 * ------------------------------------------------------------------ */

async function safeUpdateSetting(section, key, value) {
  try {
    await vscode.workspace.getConfiguration(section)
      .update(key, value, vscode.ConfigurationTarget.Global);
    return true;
  } catch (err) {
    const out = getOutputChannel();
    out.appendLine(`# 写入设置失败: ${section}.${key} = ${JSON.stringify(value)}`);
    out.appendLine(`  ${err && err.message ? err.message : String(err)}`);
    vscode.window.showWarningMessage(
      `YAML 注释对齐：没能自动写入 ${section}.${key}，请在设置里手动改这一项。`
    );
    return false;
  }
}

/** Red Hat YAML 已安装且它的格式化器还开着时才值得提醒 */
function redhatFormatterEnabled(doc) {
  const installed = vscode.extensions.getExtension
    ? vscode.extensions.getExtension('redhat.vscode-yaml')
    : undefined;
  if (!installed) return false;
  const scope = doc ? { uri: doc.uri, languageId: doc.languageId } : null;
  return vscode.workspace.getConfiguration('yaml', scope).get('format.enable') === true;
}

function activeYamlEditor() {
  const e = vscode.window.activeTextEditor;
  if (!e) return undefined;
  return YAML_LANGUAGES.has(e.document.languageId) ? e : undefined;
}

async function runSetup(ctx) {
  const picked = await vscode.window.showInformationMessage(
    'YAML 注释对齐：想怎么用它？（随时可用命令「首次设置」重选）',
    '对齐后自动保存（跳过格式化器）',
    '接管 YAML 格式化器',
    '只用快捷键，不改设置'
  );

  if (picked === undefined) return;                    // 直接关掉，不再追问

  if (picked === '对齐后自动保存（跳过格式化器）') {
    const ok = await safeUpdateSetting('yamlCommentAlign', 'saveAfterAlign', 'withoutFormatting');
    if (!ok) return;
    await ctx.globalState.update(STATE_SETUP_CHOICE, 'autoSave');
    vscode.window.showInformationMessage(
      '已设置：Ctrl+Alt+Y 对齐后会立即保存，并且那一次保存跳过所有格式化器。'
    );

    const doc = activeYamlEditor() ? activeYamlEditor().document : undefined;
    if (redhatFormatterEnabled(doc)) {
      const again = await vscode.window.showInformationMessage(
        '还需要一步：Red Hat 的格式化器还开着（yaml.format.enable = true），'
        + '你之后正常按 Ctrl+S 时它会照样把对齐改回去。关掉它吗？'
        + '（只关格式化器，校验、补全、Kubernetes 支持不受影响）',
        '关掉 yaml.format.enable',
        '暂时不用'
      );
      if (again === '关掉 yaml.format.enable') {
        await safeUpdateSetting('yaml', 'format.enable', false);
      }
    }
    return;
  }

  if (picked === '接管 YAML 格式化器') {
    await ctx.globalState.update(STATE_SETUP_CHOICE, 'formatter');
    await vscode.commands.executeCommand('workbench.action.openSettings', 'editor.defaultFormatter');
    vscode.window.showInformationMessage(
      '需要两步：① 默认格式化器选「YAML 注释对齐」；② 打开 editor.formatOnSave。'
      + '设置界面已打开，搜 format on save 就能找到第二项。'
    );
    return;
  }

  await ctx.globalState.update(STATE_SETUP_CHOICE, 'manual');
  vscode.window.showInformationMessage(
    '好的，只保留快捷键。顺带一提：Ctrl+Alt+Y 可以在 Ctrl+K Ctrl+S 里改成你习惯的键。'
  );
}

/** 只问一次：激活时如果已经打开着 YAML 文件就问，否则等第一个 YAML 文件打开 */
function scheduleSetupPrompt(ctx) {
  if (ctx.globalState.get(STATE_SETUP_PROMPTED)) return;

  if (activeYamlEditor()) {
    void ctx.globalState.update(STATE_SETUP_PROMPTED, true);
    void runSetup(ctx);
    return;
  }

  const sub = vscode.window.onDidChangeActiveTextEditor((e) => {
    if (!e || !YAML_LANGUAGES.has(e.document.languageId)) return;
    sub.dispose();
    void ctx.globalState.update(STATE_SETUP_PROMPTED, true);
    void runSetup(ctx);
  });
  ctx.subscriptions.push(sub);
}

/* ------------------------------------------------------------------ *
 * 格式化器
 *
 * 注册之后本扩展会出现在「Format Document With...」里，可以被选为 YAML 的
 * 默认格式化器。注意：这只决定「用谁格式化」，还需要开启 editor.formatOnSave
 * 才会在保存时执行。
 * ------------------------------------------------------------------ */

function createFormatterProvider(ctx) {
  const format = (document, options, onlyLines) => {
    const tabSize = options && Number.isFinite(options.tabSize) && options.tabSize > 0
      ? options.tabSize
      : 2;
    const result = alignDocument(document, {
      column: effectiveColumn(ctx, document),
      tabSize,
      onlyLines,
    });
    return toTextEdits(result.edits);
  };

  return {
    provideDocumentFormattingEdits: (document, options) => format(document, options, null),
    provideDocumentRangeFormattingEdits: (document, range, options) => {
      const onlyLines = [];
      for (let i = range.start.line; i <= range.end.line; i++) onlyLines.push(i);
      return format(document, options, onlyLines);
    },
  };
}

const FORMATTER_SELECTOR = [{ language: 'yaml' }, { language: 'dockercompose' }];

let formatterDisposable = null;

function syncFormatterRegistration() {
  const want = readConfig().registerFormatter;

  if (want && !formatterDisposable) {
    const provider = createFormatterProvider(activeContext);
    formatterDisposable = vscode.Disposable.from(
      vscode.languages.registerDocumentFormattingEditProvider(FORMATTER_SELECTOR, provider),
      vscode.languages.registerDocumentRangeFormattingEditProvider(FORMATTER_SELECTOR, provider)
    );
  } else if (!want && formatterDisposable) {
    formatterDisposable.dispose();
    formatterDisposable = null;
  }
}

/* ------------------------------------------------------------------ *
 * 激活
 * ------------------------------------------------------------------ */

let activeContext = null;

function activate(context) {
  activeContext = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('yamlCommentAlign.align', (arg) => commandAlign(arg, context)),
    vscode.commands.registerCommand('yamlCommentAlign.alignRecommended', (arg) =>
      commandAlignRecommended(arg, context)
    ),
    vscode.commands.registerCommand('yamlCommentAlign.diagnose', (arg) =>
      commandDiagnose(arg, context)
    ),
    vscode.commands.registerCommand('yamlCommentAlign.setup', () => runSetup(context)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('yamlCommentAlign.registerFormatter')) {
        syncFormatterRegistration();
      }
    })
  );

  syncFormatterRegistration();
  scheduleSetupPrompt(context);
}

function deactivate() {
  if (formatterDisposable) {
    formatterDisposable.dispose();
    formatterDisposable = null;
  }
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = null;
  }
  activeContext = null;
}

module.exports = { activate, deactivate };

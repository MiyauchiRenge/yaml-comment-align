# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-09-15

首个公开发布版本。

### 功能

- 命令 `对齐注释到指定列…`（`Ctrl+Alt+Y`）：弹出输入框指定列号，并记住上次用过的值
- 命令 `按最长代码行自动推荐列号并对齐`（`Ctrl+Alt+Shift+Y`）
- 命令 `诊断：为什么保存时没有自动对齐`：把目标列、待改动行数，以及
  `editor.defaultFormatter` / `editor.formatOnSave` / `files.autoSave` 的实际取值和结论输出到「输出」面板
- 命令 `首次设置：选择用法`：装好后第一次打开 YAML 文件时自动询问一次，之后不再打扰
- 编辑器右键、左侧文件树右键、命令面板均可调用；快捷键可在 `Ctrl+K Ctrl+S` 里自由改绑
- 整篇对齐，或选中若干行只处理选区；改小列号会把多余的空白收回去
- 按**显示宽度**对齐：中日韩字符、全角标点、emoji 记 2 列（按字符数计算的工具会让中文注释看起来是歪的）
- 独占一行的注释也会被推到同一列，可用 `alignStandaloneComments` 关闭
- **可作为 YAML 格式化器**：被指定为默认格式化器后接管 `Format Document` 与 `formatOnSave`，
  与 Prettier（Red Hat YAML 扩展内置的那套）是**替代关系**而不是互相覆盖

### 设置项

| 设置项 | 默认 |
| --- | --- |
| `yamlCommentAlign.defaultColumn` | `40` |
| `yamlCommentAlign.minSpaces` | `2` |
| `yamlCommentAlign.alignStandaloneComments` | `true` |
| `yamlCommentAlign.roundRecommendedTo` | `1` |
| `yamlCommentAlign.saveAfterAlign` | `"never"` |
| `yamlCommentAlign.registerFormatter` | `true` |

### 安全边界

- **块标量内部的 `#` 一个都不碰**：`|` / `>-` / `|2` 之后、缩进比父节点深的所有行都会跳过，
  那里面是 SQL / shell / 证书等内容
- **引号内的 `#` 不碰**：`password: 'p#ssw0rd'`、`url: "http://x/a#b"`
- `#` 前面没有空白时不算注释（YAML 规范），原样保留
- 跨行的单/双引号标量内部不碰，包括引号跨行未闭合的情况（整段视为字符串）
- 只改「代码与 `#` 之间的空白」：缩进、key 顺序、引号、值、注释正文一个字符都不动
- 幂等；保留 `CRLF`/`LF` 与 tab 缩进；整批修改合并为一次 `WorkspaceEdit`，`Ctrl+Z` 单步撤销
- 不收集遥测、不发起网络请求、不执行外部命令

### 其他

- 命令行工具 `tools/preview.js` 与扩展共用核心逻辑，可批量处理目录，或在 CI / pre-commit 里做校验
- 96 项自动化检查：核心算法 41 + 扩展集成 43 + 文档一致性 12
- 要求 VS Code `1.63.0` 及以上

<details>
<summary>开发期间的历史（内部迭代，均未公开发布，仅作记录）</summary>

#### 内部迭代 0.4.0

- **首次设置**：装好后第一次打开 YAML 文件时询问一次用法，并把选择记住，之后不再打扰。
  三个选项：`对齐后自动保存（跳过格式化器）` / `接管 YAML 格式化器` / `只用快捷键，不改设置`
- 选择「对齐后自动保存」时，若检测到 Red Hat YAML 的格式化器仍开着（`yaml.format.enable = true`），
  会追问一次是否关掉它——否则之后正常 `Ctrl+S` 仍会把对齐改回去
- 写设置改为**只写本扩展自己注册的配置**；涉及其它扩展的配置一律先征求同意再写，
  语言级设置（`[yaml].editor.defaultFormatter`）不代写，只打开设置界面
- 所有设置写入都包在 `try/catch` 中：写失败只记录到输出面板并给出警告，不再让命令抛错

#### 内部迭代 0.3.3

- **修复**：诊断命令的修复按钮会让命令直接抛错，报
  `没有注册配置 [yaml].editor.defaultFormatter，因此无法写入用户设置`。
  原因是语言级设置不能用 `getConfiguration('[yaml]').update(...)` 写入。
  这些按钮已改为只打开对应的设置界面
- README 增加「最省事的组合」：`saveAfterAlign: "withoutFormatting"` + `yaml.format.enable: false`

#### 内部迭代 0.3.2

- 诊断命令增强：报告 `yaml.format.enable` 的实际取值；检测是否有旧版本重复安装、抢占同名命令
- 诊断结果附带可点击的按钮，只显示当前确实需要的那几个

#### 内部迭代 0.3.1

- **修复**：右键菜单此前只注册了编辑器右键（`editor/context`），在文件树里右键看不到任何内容，现已补充 `explorer/context`
- **修复**：从右键菜单调用时改为按传入的资源 URI 打开对应文件，避免「右键 A 文件却对齐了当前打开的 B 文件」
- **修复**：README 未说明「配置默认格式化器」不会开启 `formatOnSave`，现已拆成两步说明
- 新增诊断命令

#### 内部迭代 0.3.0

- **注册为 YAML 的格式化器**，可接管 `Format Document` 与 `formatOnSave`
- 设置项 `registerFormatter`；支持范围格式化；扩展图标 `icon/icon128.png`；`tools/make-icon.py`
- **`saveAfterAlign` 默认值由 `"withoutFormatting"` 改为 `"never"`**：手动命令不再偷偷写盘
- `activationEvents` 增加 `onLanguage:dockercompose`

#### 内部迭代 0.2.1

- `engines.vscode` 由 `^1.75.0` 下调到 `^1.63.0`，与 `redhat.vscode-yaml` 的要求保持一致

#### 内部迭代 0.2.0

- 设置项 `saveAfterAlign`（`never` / `withoutFormatting` / `normal`）与对齐后自动保存

#### 内部迭代 0.1.0

- 对齐到指定列 / 自动推荐列号两个命令；按显示宽度对齐；独占一行的注释与行尾注释同列
- 块标量、引号、`#` 前无空白等场景一律不动的安全边界

</details>

[0.1.0]: https://github.com/MiyauchiRenge/yaml-comment-align/releases/tag/v0.1.0

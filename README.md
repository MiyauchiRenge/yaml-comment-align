# YAML 注释对齐 (yaml-comment-align)

一个 VS Code 扩展：把 YAML 文件里的注释统一对齐到指定列，中文按显示宽度 2 计算。

```yaml
version: '3'                             # Compose文件格式版本号
services:                                # 定义运行的服务
  db:                                    # 服务名称：数据库服务
    container_name: wp-mysql             # 容器名称
    image: mysql:8.0                     # 使用的镜像及版本
    volumes:                             # 挂载数据卷
      - ./db_data:/var/lib/mysql         # 挂载MySQL数据目录
```

## 为什么会有这个插件

想要的效果是「整个文件的注释 `#` 全落在同一列」，跨缩进层级也算。现有的对齐类扩展（[Better Align](https://marketplace.visualstudio.com/items?itemName=chouzz.vscode-better-align)、[CodeAlign](https://marketplace.visualstudio.com/items?itemName=r-seize.code-align)）做不到：

- 它们只对齐「连续且同缩进」的行组，缩进一变就断开，所以 `services:` 和它下面深缩进的 key 不会落到同一列
- 它们按**字符数**补空格，而中日韩字符在等宽字体里占两格，注释里一有中文，渲染出来就是歪的

需求本身很小——就是把注释前的空白算准——但没有现成插件能做，于是自己写了一个，顺便处理掉 YAML 里几个容易改坏文件的坑：块标量（`|` / `>-` / `|2`）内部的 `#`、引号里的 `#`、`#` 前没有空格的伪注释，全部原样保留。

> 本项目仅作分享与个人留存，不建议用于生产环境。

## 安装

### 方式一：应用市场

在 VS Code 里按 `Ctrl+P`，粘贴并回车：

```
ext install miyauchirenge.yaml-comment-align
```

或在扩展面板（`Ctrl+Shift+X`）搜索 `yaml-comment-align`。

> 如果搜不到，说明还没上架，用下面的 VSIX 方式。

### 方式二：VSIX 本地安装

从 [Releases](https://github.com/MiyauchiRenge/yaml-comment-align/releases) 下载最新的 `.vsix`，然后：

- VS Code → 扩展面板 → 右上角 `...` → **从 VSIX 安装…**，或
- `code --install-extension yaml-comment-align-<版本>.vsix`

装完重载窗口（`Ctrl+Shift+P` → `Developer: Reload Window`）。

> 要求 VS Code `1.63.0` 及以上。

## 使用

| 命令 | 默认快捷键 | 说明 |
| --- | --- | --- |
| `YAML 注释对齐：对齐注释到指定列…` | `Ctrl+Alt+Y` / `Cmd+Alt+Y` | 弹出输入框填写列号（默认填上次用过的值），回车即对齐 |
| `YAML 注释对齐：按最长代码行自动推荐列号并对齐` | `Ctrl+Alt+Shift+Y` / `Cmd+Alt+Shift+Y` | 取「最长代码行 + 2 空格」所在的列，直接对齐 |
| `YAML 注释对齐：诊断：为什么保存时没有自动对齐` | 无 | 排查保存不生效的原因（见下） |
| `YAML 注释对齐：首次设置：选择用法` | 无 | 重新选择使用方式（见下） |

调用方式：**编辑器里右键**、**左侧文件树里右键** `.yml` / `.yaml` 文件，或命令面板（`Ctrl+Shift+P`）搜索 `YAML 注释对齐`。

> 编辑器右键菜单里，前两项的位置在**中上部**（`Format Document` 那一带），不在菜单底部。

### 自定义快捷键

默认 `Ctrl+Alt+Y`，**可以随意改**——VS Code 的快捷键本来就不归扩展管：

1. `Ctrl+K Ctrl+S` 打开键盘快捷方式
2. 搜 `yamlCommentAlign`（或直接搜中文 `YAML 注释对齐`）
3. **双击**那一行 → 直接按下你想用的组合键；右键 → `移除按键绑定` 可以取消默认
4. 也可以在 `keybindings.json` 里手写覆盖：

```json
{ "key": "ctrl+alt+j", "command": "yamlCommentAlign.align", "when": "editorTextFocus" }
```

有冲突的话这个面板会用感叹号标出来。

### 首次使用会问一次

装好后第一次打开 YAML 文件时会弹一次询问，选一种用法即记住，之后不再打扰：

| 选项 | 效果 |
| --- | --- |
| **对齐后自动保存（跳过格式化器）** | 把 `saveAfterAlign` 设为 `"withoutFormatting"`：`Ctrl+Alt+Y` 对齐后立即保存，那一次保存跳过所有格式化器。若检测到 Red Hat 的格式化器还开着，会再问一句要不要关掉 |
| **接管 YAML 格式化器** | 打开设置界面，由你自己指定默认格式化器和 `formatOnSave`（语言级设置不代写） |
| **只用快捷键，不改设置** | 什么都不动 |

选错了随时用命令 `YAML 注释对齐：首次设置：选择用法` 重选。

> 只有「对齐后自动保存」这一项会自动写设置，写的是本扩展自己的 `yamlCommentAlign.saveAfterAlign`；
> 涉及其它扩展（`yaml.format.enable`）或语言级设置时，一律先问、或只打开设置界面。

- **选中若干行**再执行命令，则只处理选中的行；不选则处理整个文件。
- 「列号」从 1 起算，指 `#` 所在的那一列；「上次用过的列号」会被记住。
- 独占一行的注释也会被推到同一列，可用 `alignStandaloneComments` 关闭。
- 只改「代码与 `#` 之间的空白」：缩进、key 顺序、引号、值、注释正文一个字符都不动。执行是幂等的，保留 `CRLF`/`LF` 与 tab 缩进，整批修改一步 `Ctrl+Z` 撤销。

### 当成格式化器

本扩展注册了 YAML 的格式化器，可以接管 `Format Document` 和 `formatOnSave`。
要自动生效需要**两步，少一步都不会起作用**：

**① 指定用哪个格式化器**

`Ctrl+Shift+P` → `Format Document With...` → `配置默认格式化器...` → 选 `YAML 注释对齐`，
或直接写设置：

```json
"[yaml]": { "editor.defaultFormatter": "miyauchirenge.yaml-comment-align" }
```

**② 开启保存时格式化**

设置里搜 `format on save` 勾选，或写：

```json
"editor.formatOnSave": true
```

> ⚠️ 第 ① 步只决定「用谁」，**不会**自动开启 `editor.formatOnSave`。
> 只做第 ① 步的话，保存时什么都不会发生——这是最容易踩的坑。

**验证与排查**

- 想立刻确认格式化器本身是否正常，按 `Shift+Alt+F` 手动格式化一次（这一步不受 `formatOnSave` 影响）
- 还是没反应，就运行 `YAML 注释对齐：诊断：为什么保存时没有自动对齐`：它会把目标列、需要改动的行数、
  `editor.defaultFormatter` / `editor.formatOnSave` / `files.autoSave` 的实际取值和结论一起输出到「输出」面板

格式化器使用的列号是**上次手动对齐用过的列号**，没记过则用 `defaultColumn`；
先用 `Ctrl+Alt+Y` 定一次列号，后续保存就固定用这一列。

> 如果你同时启用了别的 YAML 格式化器（例如 Red Hat YAML 扩展内置的那套 Prettier），
> 保存时它会把对齐好的空白压成单个空格。按上面两步让本扩展接管即可。
>
> **如果保存后格式仍被改回**（例如单引号被改成双引号、被按 80 列折行），说明还有别的格式化器在生效。
> 最直接的解法是关掉 Red Hat YAML 的格式化器，只保留它的校验与补全——这一项**不影响**它在
> schema 校验、补全和 Kubernetes 支持上的任何功能：
>
> ```json
> "yaml.format.enable": false
> ```
>
> 拿不准是哪种情况，就运行上面的诊断命令：它会指出是哪一环的问题，并打开对应的设置界面。

### 最省事的组合：不动默认格式化器

如果你不想改默认格式化器和 `formatOnSave`，只想「对齐完就存、存的时候别被改回去」，用这两行：

```json
"yamlCommentAlign.saveAfterAlign": "withoutFormatting",
"yaml.format.enable": false
```

- 第一行：`Ctrl+Alt+Y` 对齐后**立刻保存**，并且那次保存会**跳过所有格式化器**（走的是 VS Code 内置的「保存但不格式化」），Red Hat 的 Prettier 不会执行
- 第二行：让 Red Hat 在其它情况下也不再重排格式。**它只关掉格式化器**，`yaml.validate`、`yaml.completion`、schema 校验和 Kubernetes 支持全部照常

> 只设第一行的话，那次对齐保存是安全的；但你之后正常按 `Ctrl+S` 时 Red Hat 仍会执行并把空白压回去。
> 要长期稳定，两行都设上，或者改用上面的「当成格式化器」让本扩展接管。

### 设置

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| `yamlCommentAlign.defaultColumn` | `40` | 输入框默认列号，也是格式化器没记住列号时的兜底值 |
| `yamlCommentAlign.minSpaces` | `2` | 代码与 `#` 之间至少保留的空格数（与 yamllint 的默认值一致） |
| `yamlCommentAlign.alignStandaloneComments` | `true` | 是否也处理独占一行的注释 |
| `yamlCommentAlign.roundRecommendedTo` | `1` | 「自动推荐列号」向上取整的倍数，设成 `8` 会得到整列号 |
| `yamlCommentAlign.saveAfterAlign` | `"never"` | 手动执行命令后是否保存：`"never"` 只改编辑器内容；`"withoutFormatting"` 保存但不走格式化器；`"normal"` 走普通保存 |
| `yamlCommentAlign.registerFormatter` | `true` | 是否把本扩展注册为 YAML 的格式化器 |

## 关于 AI

本项目的代码、测试、脚本、图标与文档由 **DeepSeek 编码助手**（DSH 工具链，模型 **DeepSeek-V4.1-Flash**）生成，由维护者提出需求、逐项确认设计决策并验收。运行时不含任何 AI 能力：扩展不联网、不上传数据、不收集遥测、不执行外部命令。

完整记录——包括 AI 具体做了什么、验证到什么程度（以及哪些行为还没在真实 VS Code 里验证过）——见 [AI-USAGE.md](AI-USAGE.md)。

## 目录结构

```
package.json                       扩展清单（命令、快捷键、设置、格式化器）
icon/icon128.png                   扩展图标
src/core.js                        核心算法（零依赖，扩展与 CLI 共用）
src/extension.js                   VS Code 扩展入口（命令 + 格式化器）
tools/preview.js                   命令行预览/批量工具
tools/make-icon.py                 零依赖生成图标（Python 标准库手写 PNG 编码器）
test/run-tests.js                  核心算法测试（41 项）
test/extension-smoke.js            扩展集成测试（43 项）
test/docs-consistency.js           文档与 package.json 的一致性检查（12 项）
examples/docker-compose.sample.yml 演示样例
AI-USAGE.md                        AI 使用说明与来源记录
CHANGELOG.md                       更新日志
PUBLISHING.md                      发布指引
```

## 许可

[MIT](LICENSE)

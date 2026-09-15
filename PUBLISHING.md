# 发布指引

从零到上架，一共四步。**只有第 2 步和第 3 步的 token 创建必须由维护者本人操作**，因为 marketplace 会把扩展永久绑定到 publisher 身份上。

---

## 1. 建仓库并推上去

在 GitHub 上建一个**公开**仓库，名字必须是：

```
yaml-comment-align
```

也就是最终地址为 `https://github.com/MiyauchiRenge/yaml-comment-align`——`package.json` 里的 `repository` / `homepage` / `bugs` 已经指向这里，名字不一致的话商店页面上的链接会 404。

```bash
cd yml统一文件
git init
git add .
git commit -m "feat: YAML 注释对齐 0.1.0"
git branch -M main
git remote add origin https://github.com/MiyauchiRenge/yaml-comment-align.git
git push -u origin main
```

> **先不要打标签。** 打标签会立即触发自动发布（第 4 步）；等 secret 配好再打。

## 2. 建 publisher（必须本人）

1. 打开 <https://marketplace.visualstudio.com/manage>
2. 用 Microsoft 账号登录（没有就注册一个，免费）
3. 左侧 **Create publisher**
4. **ID 填 `miyauchirenge`**，Name 随意（显示用，比如你的名字或品牌名）

> **ID 创建后不可修改**，且必须和 `package.json` 里的 `publisher` 字段完全一致——当前值是 `miyauchirenge`。
> 如果这个 ID 已被占用，需要改 `package.json` 里的 `publisher`（只能用字母、数字、连字符，全小写）后重新打包。

## 3. 建 PAT 并加进 GitHub Secrets

1. 打开 <https://dev.azure.com>，登录同一个 Microsoft 账号（没有组织的话按提示建一个，免费）
2. 右上角头像 → **Personal access tokens** → **New Token**
3. 关键设置（这三项填错是 401 的主要原因）：
   - **Organization**：选 **All accessible organizations**（千万别选某个具体组织）
   - **Expiration**：按需，最长一年；到期要换
   - **Scopes**：点 **Show all scopes** → 滚到 **Marketplace** → 勾 **Manage**
4. 创建后**立刻复制** token（页面关了就再也看不到）
5. 到 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - Name 填 **`VSCE_PAT`**（必须一字不差，workflow 里就是这么读的）
   - Secret 粘贴刚才的 token

> ⚠️ **Azure DevOps 的全局 Personal Access Token 将于 2026 年 12 月 1 日退役。** 之后需要改用 Microsoft Entra ID + 托管标识的方式（`vsce publish --azure-credential`），届时下面的 workflow 需要相应调整。

## 4. 发布

**推荐：推标签自动发（secret 只存在 GitHub 里，不经过你本地）**

```bash
# 改版本号（三选一）
npm version patch      # 0.1.0 -> 0.1.1
npm version minor      # 0.1.0 -> 0.2.0
npm version 0.4.2      # 直接指定

git push && git push --tags
```

`npm version` 会自动改 `package.json` 并打好标签，推送后 GitHub Actions 会：跑全部测试 → 校验标签和 `package.json` 版本一致 → `vsce publish`。

**备用：本地直接发**

```bash
npx @vscode/vsce login miyauchirenge   # 提示时粘贴 PAT
npx @vscode/vsce publish minor         # 自动改版本、commit、tag，然后发布
```

两种方式不要混用，否则容易出现标签和版本对不上的情况。

---

## 发布前的自检

```bash
npm test                                        # 96 项检查应当全绿（核心 41 + 集成 43 + 文档一致性 12）
npm_config_cache=/tmp/npm-cache-yml \
  npx --yes @vscode/vsce package                # 应当零 WARNING
unzip -p yaml-comment-align-*.vsix extension/package.json | head -20
```

另外确认这几项（发布工具会强制校验）：

- [ ] 图标不是 SVG（本项目是 128×128 PNG ✓）
- [ ] README / CHANGELOG 里的图片都是 `https` 且非 SVG（本项目没有图片 ✓）
- [ ] `publisher` 字段与 marketplace 上创建的 publisher ID 完全一致
- [ ] 版本号没有被用过（同一个版本不能重复发布，也不能删除最新版本后重用）
- [ ] VSIX 内容是 **9 个文件 / 约 28 KB**（若明显变大，多半是本地临时文件被误打入包）

## 关于 AI 披露

AI 使用情况写在两处，改动时两处都要同步：

- `README.md` 的「关于 AI」一节——README 同时是商店详情页，所以这段会显示给浏览商店的人
- `AI-USAGE.md` 完整记录——随仓库发布，**不随扩展安装包分发**（已列入 `.vscodeignore`）

改动披露内容时，更新 `AI-USAGE.md` 的细节，并检查 README 那节的摘要是否仍然准确。

## PAT 退役（2026-12-01）与三条发布路径

Azure DevOps 的**全局 PAT**（即 "All accessible organizations" 那种）将于 **2026 年 12 月 1 日完全停用**。
商店发布**只能用这种 PAT**，所以那天之后传统的 `vsce publish` 就断了。三条应对路径：

### 路径 1：PAT（现在能用，最省事）

就是本文档上面写的流程，**2026-12-01 之前一直有效**，到期前不用管。

### 路径 2：OIDC 信任发布（推荐，一劳永逸）

`vsce` 4.0.0 起支持 `vsce publish --oidc`，**不需要 PAT、不需要 Azure 订阅、凭据不会过期**。

```yaml
jobs:
  publish:
    permissions:
      contents: read
      id-token: write          # 必须，否则拿不到 OIDC token
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx @vscode/vsce publish --oidc
```

原理：向 GitHub 申请 audience 为 `marketplace.visualstudio.com` 的 OIDC token，
再用它向 `POST /_apis/gallery/token` 换取短期 Marketplace 凭据。

**需要你在 Marketplace 后台做一步**：为「本仓库 + 本 workflow」配置一条**信任发布策略**
（trusted publishing policy）。入口在 [publisher 管理页](https://marketplace.visualstudio.com/manage) 里，
具体位置取决于当前 UI 版本——这一点官方发布文档**尚未收录**（只有 vsce 自己的 README 有说明），
找不到时就在管理页里找带 "Trusted publishing" 字样的区域。

> ⚠️ `--oidc` 失败时**不会回退**到 PAT（vsce 源码明确写了 no fallback）。
> 本仓库的 workflow 因此做了分流：**配了 `VSCE_PAT` 就走 PAT，没配才走 OIDC**，
> 两种可以并存、随时切换，不会出现看不懂的报错。

### 路径 3：手动上传 VSIX（零依赖兜底）

```bash
npm run package          # 生成 .vsix
```

然后到 [publisher 管理页](https://marketplace.visualstudio.com/manage) 用浏览器直接上传。
**这条路不需要任何 token**，官方文档明确支持，适合发布频率低的扩展。
本仓库的 workflow 会把 VSIX 自动附到 GitHub Release，直接下载即可。

### 不推荐：Entra ID + 托管标识

官方发布文档的主推方案，但需要创建 user-assigned managed identity，也就是**必须有 Azure 订阅**，
而且官方示例基于 **Azure Pipelines**（用 `AzureCLI@2` + 服务连接取 token）。
对个人小扩展成本过高——OIDC 路径能达到同样的效果而无需 Azure 订阅。

| 路径 | 需要 PAT | 需要 Azure 订阅 | 2026-12-01 之后 |
| --- | --- | --- | --- |
| PAT | 是 | 否 | ❌ 失效 |
| OIDC 信任发布 | 否 | 否 | ✅ 推荐 |
| 手动上传 VSIX | 否 | 否 | ✅ 兜底 |
| Entra + 托管标识 | 否 | **是** | ✅ 但过重 |

## 常见错误对照

| 报错 | 原因 |
| --- | --- |
| `401 Unauthorized` / `Access Denied` | PAT 的 Organization 没选 **All accessible organizations**，或 Scopes 没勾 **Marketplace → Manage**，或 token 过期 |
| `ERROR The publisher 'xxx' does not exist` | marketplace 上还没建这个 publisher，或 `package.json` 里的 `publisher` 拼写不一致 |
| `ERROR Version 0.1.0 already exists` | 这个版本号发过了。改版本号，**不能删除最新版后重用同一个号** |
| `ERROR Missing repository field` | 删掉了 `repository` 字段。加上即可（本项目已有） |
| `ERROR Extension entrypoint(s) missing` | `main` 指向的文件不在包里，检查 `.vscodeignore` 有没有误伤 `src/` |
| 发布成功但商店搜不到 | 索引有延迟，通常几分钟；也可能是扩展名被搜索词掩盖，直接开 `https://marketplace.visualstudio.com/items?itemName=miyauchirenge.yaml-comment-align` |

## 发布之后

- **不要点 Remove**：一旦移除，扩展名会被**永久保留**且不可复用，连你自己都不能再建同名的。想下架用 **Unpublish**（保留统计、仍可通过直链访问）。
- 用户装的是自动更新版本，改完记得 `npm version` 再推标签。
- 装的人变多之后可以考虑申请 **verified publisher**，但要求 publisher 下的扩展已上架满 6 个月、且能验证一个自己拥有的域名（不支持子域名）。

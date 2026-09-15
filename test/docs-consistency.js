'use strict';

/**
 * 文档一致性检查：node test/docs-consistency.js
 *
 * 文档里的版本号、命令名、设置项最容易在迭代中腐烂——发布前跑一遍，
 * 保证 README / CHANGELOG 说的和 package.json 里实际的一模一样。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const pkg = JSON.parse(read('package.json'));
const readme = read('README.md');
const changelog = read('CHANGELOG.md');
const aiUsage = read('AI-USAGE.md');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  \u2717 ${name}\n      ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('文档一致性检查');

check('README 覆盖了 package.json 里的每个命令', () => {
  for (const c of pkg.contributes.commands) {
    assert(readme.includes(c.title), `README 里找不到命令「${c.title}」`);
  }
});

check('README 覆盖了 package.json 里的每个设置项', () => {
  for (const key of Object.keys(pkg.contributes.configuration.properties)) {
    assert(readme.includes(key), `README 里找不到设置项 ${key}`);
  }
});

check('package.json 里的设置项数与 README 设置表行数一致', () => {
  const table = readme.split('## 设置')[1].split('```')[0];
  const rows = table.split('\n').filter((l) => l.startsWith('| `yamlCommentAlign.'));
  const declared = Object.keys(pkg.contributes.configuration.properties);
  assert(rows.length === declared.length,
    `README 设置表有 ${rows.length} 行，package.json 声明了 ${declared.length} 项`);
});

check('CHANGELOG 里有当前版本的条目', () => {
  assert(changelog.includes(`## [${pkg.version}]`),
    `CHANGELOG 里找不到 ## [${pkg.version}]`);
});

check('CHANGELOG 里每个版本都有对比链接', () => {
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  for (const v of versions) {
    assert(new RegExp(`^\\[${v.replace(/\./g, '\\.')}\\]: `, 'm').test(changelog),
      `CHANGELOG 缺少 [${v}] 的链接定义`);
  }
});

check('README 里没有过期版本的 VSIX 文件名', () => {
  const found = [...readme.matchAll(/yaml-comment-align-(\d+\.\d+\.\d+)\.vsix/g)].map((m) => m[1]);
  const stale = found.filter((v) => v !== pkg.version);
  assert(stale.length === 0,
    `README 里出现过期版本: ${stale.join(', ')}（当前 ${pkg.version}）`);
});

check('README 的商店安装命令用的是当前 publisher 和 name', () => {
  assert(readme.includes(`ext install ${pkg.publisher}.${pkg.name}`),
    `README 里没有 ext install ${pkg.publisher}.${pkg.name}`);
});

check('README 的默认格式化器 ID 与当前 publisher 一致', () => {
  const stale = [...readme.matchAll(/"editor\.defaultFormatter":\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id) => id !== `${pkg.publisher}.${pkg.name}`);
  assert(stale.length === 0, `README 里还有过期的格式化器 ID: ${stale.join(', ')}`);
});

check('README 与 AI-USAGE 记录的模型名一致', () => {
  const re = /DeepSeek-V4\.?1-Flash/;
  const inReadme = readme.match(re);
  const inAi = aiUsage.match(re);
  assert(inReadme, 'README 的「关于 AI」里没有模型名');
  assert(inAi, 'AI-USAGE.md 里没有模型名');
  assert(inReadme[0] === inAi[0],
    `两处模型名写法不一致: README=${inReadme[0]}, AI-USAGE=${inAi[0]}`);
});

check('AI-USAGE.md 的模型信息完整（标识 / 提供方 / 推理强度 / 出处）', () => {
  for (const [label, re] of [
    ['API 标识', /模型 API 标识[\s\S]{0,40}deepseek-flash/],
    ['提供方', /模型提供方[\s\S]{0,40}deepseek-official/],
    ['推理强度', /推理强度[\s\S]{0,40}high/],
    ['工具版本', /工具版本[\s\S]{0,40}0\.1\.5-rc\.1/],
    ['可核对出处', /settings\.yaml/],
  ]) {
    assert(re.test(aiUsage), `AI-USAGE.md 缺少${label}`);
  }
});

check('README 与 AI-USAGE 对 AI 参与的表述一致（README 有摘要）', () => {
  assert(readme.includes('DeepSeek'), 'README 的「关于 AI」一节丢了模型信息');
  assert(aiUsage.includes('README.md'), 'AI-USAGE.md 应当说明 README 里有摘要');
});

check('README 里没有残留的旧 publisher', () => {
  assert(!readme.includes('localtools'), 'README 里还有旧的 publisher localtools');
});

console.log(`\n${'-'.repeat(50)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项`);
  process.exit(0);
}
console.log(`通过 ${passed} 项，失败 ${failures.length} 项：${failures.join(', ')}`);
process.exit(1);

#!/usr/bin/env node
/**
 * 一次改版走完：升版本 → 全套自检 → 重生成 describe.json → 打包 → 记下 sha256。
 *
 *   node release.mjs 0.2.0 "摘掉 experimental，补截图与图标"
 *   node release.mjs 0.2.0 --dry-run      # 只跑自检，不改版本、不打包
 *
 * 自检不过就停在这一步，不写版本号、不打包——避免把没验过的包留在 releases 里。
 * 它不发 npm：发布这一步要人（或桌宠）扣扳机，命令在最后打印出来。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkgDir = join(root, 'cortico-world-omikuji');
const releasesDir = join(root, 'releases');
const packageJsonPath = join(pkgDir, 'package.json');
const changelogPath = join(pkgDir, 'CHANGELOG.md');
const recordsPath = join(root, '发布记录.md');
const npmCache = 'E:\\DSH-PET\\.npm-cache';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
/** 版本号已经是这个值时，只重跑一遍自检并重新打包，不升号（上一次可能中途被打断）。 */
const repack = args.includes('--repack');
const [version, note] = args.filter((arg) => !arg.startsWith('--'));

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('用法：node release.mjs <版本号> [改动说明] [--dry-run]\n例：node release.mjs 0.2.0 "摘掉 experimental"');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const current = pkg.version;
const skipBump = repack && current === version;
if (!dryRun && current === version && !skipBump) {
  console.error(`版本号还是 ${current}，没有变化。要重新打包请先改 CHANGELOG 再升号，或用 --repack 重打同一个版本。`);
  process.exit(2);
}
if (!dryRun && !skipBump && !isNewer(version, current)) {
  console.error(`${version} 不比当前 ${current} 新。`);
  process.exit(2);
}

console.log(`精灵日签 ${current} → ${version}${dryRun ? '（dry-run，不写盘）' : ''}\n`);

// ---------------------------------------------------------------- 自检

const node = process.execPath;
const npmCli = join(node, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js');

function run(label, command, commandArgs, extra = {}) {
  console.log(`── ${label}`);
  const result = spawnSync(command, commandArgs, { cwd: pkgDir, stdio: 'inherit', ...extra });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} 失败（exit ${result.status}）。改完再跑。`);
    process.exit(1);
  }
}

run('单元测试', node, ['--experimental-transform-types', '--test', '--test-isolation=none', 'test/*.test.ts']);
run('类型检查', node, [join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']);
run('浏览器产物契约', node, ['--experimental-transform-types', 'tools/check-client.mjs']);
run('面板假 DOM 冒烟', node, ['--experimental-transform-types', 'tools/dom-smoke.mjs']);
// describe.json 必须重新生成：改了工具、事件、面板或 ENV_PROMPT 之后手改 JSON 是不允许的。
run('重生成 describe.json', node, ['--experimental-transform-types', 'tools/describe.ts']);
run('自描述复核', node, ['--experimental-transform-types', 'tools/describe.ts', '--check']);
run('发布前检查（标签/CHANGELOG）', node, ['--experimental-transform-types', 'tools/release-check.ts', '--brief']);

if (dryRun) {
  console.log('\n自检全过。dry-run 到此为止，没有改动任何文件。');
  process.exit(0);
}

// ---------------------------------------------------------------- 升版本

if (!skipBump) {
  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

const changelog = readFileSync(changelogPath, 'utf8');
if (!changelog.includes(`## ${version}`)) {
  const heading = changelog.startsWith('# Changelog') ? '# Changelog\n\n' : '';
  const body = changelog.slice(heading.length);
  const section = `## ${version}\n\n${note ?? '- （待补：这一版改了什么）'}\n\n`;
  writeFileSync(changelogPath, `${heading}${section}${body}`, 'utf8');
  console.log(`\nCHANGELOG 加了 ## ${version}，正文请自己补全。`);
}

// ---------------------------------------------------------------- 打包

mkdirSync(releasesDir, { recursive: true });
// stdio 必须是 inherit：本机沙箱禁止子进程走管道，捕获输出的调用会直接 EPERM。
const pack = spawnSync(
  node,
  [npmCli, 'pack', '--pack-destination', releasesDir, '--cache', npmCache],
  { cwd: pkgDir, stdio: 'inherit' },
);
if (pack.error || pack.status !== 0) {
  console.error(`\n✗ 打包失败（${pack.error?.message ?? `exit ${pack.status}`}）`);
  process.exit(1);
}
const tgzName = `cortico-world-omikuji-${version}.tgz`;
const tgzPath = join(releasesDir, tgzName);
if (!existsSync(tgzPath)) {
  console.error(`\n✗ 没找到产物 ${tgzName}。`);
  process.exit(1);
}

const sha256 = createHash('sha256').update(readFileSync(tgzPath)).digest('hex');
const size = (readFileSync(tgzPath).length / 1024).toFixed(1);

// SHA256SUMS.txt 保留历史：同名文件的旧行替换掉，别的版本留着。
const sumsPath = join(releasesDir, 'SHA256SUMS.txt');
const kept = existsSync(sumsPath)
  ? readFileSync(sumsPath, 'utf8').split('\n').filter((line) => line.trim() && !line.includes(tgzName))
  : [];
writeFileSync(sumsPath, `${[...kept, `${sha256}  ${tgzName}`].join('\n')}\n`, 'utf8');

const stamp = new Date().toISOString().slice(0, 10);
const record = existsSync(recordsPath) ? readFileSync(recordsPath, 'utf8') : '# 精灵日签 · 发布记录\n';
const entry = [
  '',
  `## ${version} — ${stamp}`,
  '',
  note ? `- 改动：${note}` : '- 改动：（未填）',
  `- 产物：\`releases/${tgzName}\`（${size} kB）`,
  `- sha256：\`${sha256}\``,
  '- 状态：**已打包，未发布**（`npm publish` 跑完把这一行改成「已发布」并写上日期）',
  '',
].join('\n');
writeFileSync(recordsPath, `${record.trimEnd()}\n${entry}`, 'utf8');

console.log(`
✓ ${tgzName}（${size} kB）
  sha256  ${sha256}
  记录    releases/SHA256SUMS.txt · 发布记录.md

发布（--registry 不能省，否则会发到 npmmirror 镜像）：

  cd ${pkgDir}
  npm publish --registry=https://registry.npmjs.org/ --cache ${npmCache}
`);

// ---------------------------------------------------------------- 小工具

/** 简易 semver 比较：只比较主次修订号，预发布版排在正式版之前。 */
function isNewer(next, prev) {
  const split = (v) => v.split('-')[0].split('.').map(Number);
  const [a, b] = [split(next), split(prev)];
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return next.includes('-') && !prev.includes('-') ? false : true;
}

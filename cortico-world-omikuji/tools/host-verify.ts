/**
 * 真机验收：核对**已安装**的那份扩展是不是好的。
 *
 * 用法（在包目录下）：
 *   node --experimental-transform-types tools/host-verify.ts
 *   node --experimental-transform-types tools/host-verify.ts --log "D:\path\to\core.log"
 *
 * 查四件事：
 *   1. 装的是哪个版本（extensions/package.json 的依赖 + node_modules 里那份的 package.json）
 *   2. 已安装包里的三个媒体素材在不在、多大
 *   3. 已安装包里的 src/assets.ts 在不在（0.4.2 之前没有它，等于还是旧逻辑）
 *   4. core.log 里有没有「没找到 assets/... 抽签不播动画」这条——有的话说明还在用错包目录
 *
 * 只读，不改任何东西。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_EXT_ROOT = resolve('E:/DSH-PET/Coopanion/data/extensions');
const DEFAULT_LOG = join(DEFAULT_EXT_ROOT, '..', 'logs', 'core.log');

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const extRoot = resolve(argOf('--extensions') ?? DEFAULT_EXT_ROOT);
const logPath = resolve(argOf('--log') ?? DEFAULT_LOG);
const pkgName = 'cortico-world-omikuji';

let failed = 0;
const ok = (message: string) => console.log(`ok    ${message}`);
const bad = (message: string) => {
  failed += 1;
  console.log(`FAIL  ${message}`);
};

/**
 * 读 JSON，坏了就返回 null。
 *
 * 先剥 BOM：这个工作区的文件被别人（尤其是 PowerShell 5.1 的 Set-Content）写一次就会带上
 * `EF BB BF`，而 `JSON.parse` 对 BOM 是硬报错的——之前就因为它误报了「没声明依赖」。
 */
function readJson(path: string): Record<string, unknown> | null {
  try {
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

console.log(`扩展目录: ${extRoot}`);
console.log(`日志:     ${logPath}\n`);

// 1. 装了哪个版本
const rootManifest = readJson(join(extRoot, 'package.json'));
const declared = (rootManifest?.dependencies as Record<string, string> | undefined)?.[pkgName];
declared ? ok(`extensions/package.json 里声明 ${pkgName}@${declared}`) : bad(`extensions/package.json 里没有 ${pkgName}`);

const installedDir = join(extRoot, 'node_modules', pkgName);
const installedManifest = readJson(join(installedDir, 'package.json'));
const installedVersion = typeof installedManifest?.version === 'string' ? installedManifest.version : null;
installedVersion ? ok(`已安装版本 ${installedVersion}`) : bad(`${installedDir} 下读不到 package.json`);

// .pnpm 里留下了哪些版本（旧版本残留不影响，只是信息）
const pnpmDir = join(extRoot, 'node_modules', '.pnpm');
if (existsSync(pnpmDir)) {
  const versions = readdirSync(pnpmDir)
    .filter((name) => name.startsWith(`${pkgName}@`))
    .map((name) => name.slice(pkgName.length + 1))
    .sort();
  console.log(`       .pnpm 里的版本: ${versions.join(', ') || '(无)'}`);
}

// 2. 三个媒体素材
const assets = ['draw.mp4', 'panel-bg.mp4', 'avatar.jpg'];
for (const name of assets) {
  const file = join(installedDir, 'assets', name);
  if (!existsSync(file)) {
    bad(`已安装包里缺 assets/${name}`);
    continue;
  }
  const size = statSync(file).size;
  ok(`assets/${name} 在（${size.toLocaleString('en-US')} 字节）`);
}

// 3. 修素材路径的那个文件
if (existsSync(join(installedDir, 'src', 'assets.ts'))) ok('src/assets.ts 在（0.4.2 起就这样定位包目录）');
else bad('src/assets.ts 不在——这版还没修素材路径，装的是 0.4.1 或更早');

// 4. 日志里还有没有那条报错（只看**本次进程启动之后**的，旧进程留下的不算）
if (!existsSync(logPath)) {
  console.log(`      (没有日志文件，跳过日志检查: ${logPath})`);
} else {
  const lines = readFileSync(logPath, 'utf8').split(/\r?\n/);
  // 锚点：最后一次「core已启动」之后，就是当前正在跑的这个进程
  let anchor = -1;
  lines.forEach((line, index) => {
    if (line.includes('core已启动') || line.includes('World 已启动: omikuji')) anchor = index;
  });
  const sinceStart = anchor >= 0 ? lines.slice(anchor) : lines;
  const missing = sinceStart.filter((line) => line.includes('抽签不播动画') || line.includes('没找到 assets/'));

  if (missing.length === 0) ok('本次进程的日志里没有「找不到素材」的记录');
  else {
    bad(
      `当前进程仍在用旧包：本次启动后有 ${missing.length} 条「找不到素材」。\n`
      + '      磁盘上若是新版本，重启宿主即可 —— 旧包还在内存里跑着。',
    );
  }

  // 补充：整份日志里历史上出现过多少次（旧版本的事故记录，仅供比对）
  const everMissing = lines.filter((line) => line.includes('抽签不播动画') || line.includes('没找到 assets/')).length;
  if (everMissing > missing.length) console.log(`      (整份日志里历史共 ${everMissing} 条，其中 ${missing.length} 条属于本次进程)`);
}

console.log(failed === 0 ? '\n真机验收：通过' : `\n真机验收：${failed} 项没过`);
process.exit(failed === 0 ? 0 : 1);

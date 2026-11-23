#!/usr/bin/env node
/**
 * 用 releases/ 里的 tgz 做出「下载即用」的 zip：包内文件 + 一份中文安装说明。
 *
 *   node pack-zip.mjs 0.1.1
 *
 * 说明文字来自 `先读我-模板.txt`，其中的 {{version}} 换成实际版本。
 * zip 里的内容严格等于 tgz（也就是 npm 会发的那些文件），不掺开发工具和 node_modules。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const releases = join(root, 'releases');
const stage = join(root, '.tmp-zip');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('用法：node pack-zip.mjs <版本号>\n例：node pack-zip.mjs 0.1.1');
  process.exit(2);
}

const tgz = join(releases, `cortico-world-omikuji-${version}.tgz`);
if (!existsSync(tgz)) {
  console.error(`没有 ${tgz}。先跑 node release.mjs ${version} "改动说明"。`);
  process.exit(1);
}

const innerName = `cortico-world-omikuji-${version}`;
const zipName = `精灵日签-${version}.zip`;
const zipPath = join(releases, zipName);
const stageRoot = join(stage, `精灵日签-${version}`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

const untar = spawnSync('tar', ['-xzf', tgz, '-C', stageRoot], { stdio: 'inherit' });
if (untar.status !== 0) {
  console.error('✗ 解 tgz 失败');
  process.exit(1);
}
renameSync(join(stageRoot, 'package'), join(stageRoot, innerName));

// 说明文件：模板 + 版本号，写成带 BOM 的 UTF-8，Windows 记事本双击不乱码。
const template = readFileSync(join(root, '先读我-模板.txt'), 'utf8');
writeFileSync(join(stageRoot, '先读我-安装说明.txt'), `\uFEFF${template.replaceAll('{{version}}', version)}`, 'utf8');

rmSync(zipPath, { force: true });
const zip = spawnSync(
  'powershell',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${stageRoot}' -DestinationPath '${zipPath}' -CompressionLevel Optimal`],
  { stdio: 'inherit' },
);
if (zip.status !== 0) {
  console.error('✗ Compress-Archive 失败（这一步只在 Windows 上跑）');
  process.exit(1);
}

const bytes = readFileSync(zipPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const fileCount = (function count(dir) {
  return readdirSync(dir).reduce((sum, name) => {
    const path = join(dir, name);
    return sum + (statSync(path).isDirectory() ? count(path) : 1);
  }, 0);
})(join(stageRoot, innerName));

console.log(`
✓ ${zipName}
  大小    ${(bytes.length / 1024).toFixed(1)} kB
  内容    ${innerName}/（${fileCount} 个文件）+ 先读我-安装说明.txt
  sha256  ${sha256}
`);

rmSync(stage, { recursive: true, force: true });

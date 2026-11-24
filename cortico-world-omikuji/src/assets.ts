/**
 * 本扩展自己的包目录。
 *
 * 为什么不直接用 `ctx.packageDir`：WorldContext 里那个字段是**bot 代码包目录**
 * （框架原文：「bot 代码包目录，供包内模板与资产使用」）。World 扩展拿到的
 * `ctx.packageDir` 指向 bot（比如 fatfish）的包，而不是本 World 的包——
 * 照它拼 `assets/draw.mp4` 会一路都找不到，面板于是没有抽签动画、没有背景、没有头像。
 *
 * 所以这里用本模块自己的位置反推包根：`src/assets.ts` 的上一级就是包目录。
 * 宿主按 `src/definition.ts` import 本扩展，`import.meta.url` 因此永远落在本包内
 * （pnpm 软链会解析到 `.pnpm/...` 下的真实包目录，那里同样带着 `assets/`）。
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本包根目录（由本文件位置推出）。`new URL('..')` 会带尾部分隔符，这里归一化掉。 */
export const OWN_PACKAGE_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 包目录的判定：里面有 assets/ 或 package.json，像个包的样子。 */
function looksLikePackage(dir: string): boolean {
  try {
    return statSync(join(dir, 'assets')).isDirectory() || existsSync(join(dir, 'package.json'));
  } catch {
    return false;
  }
}

/**
 * 挑一个能用的包目录：本包优先，`hint`（宿主给的 `ctx.packageDir`）作兜底。
 *
 * 兜底那支是为了离线自检工具——它们显式传包目录，且在假部署里跑；
 * 真宿主上第一支就命中，不会再去看 bot 目录。
 */
export function resolvePackageDir(hint?: string): string {
  if (looksLikePackage(OWN_PACKAGE_DIR)) return OWN_PACKAGE_DIR;
  if (hint && looksLikePackage(hint)) return hint;
  return OWN_PACKAGE_DIR;
}

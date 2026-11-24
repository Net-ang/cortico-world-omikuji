/**
 * 回归：媒体素材必须从**本包**目录取，不能跟着宿主给的 `ctx.packageDir` 走。
 *
 * 0.4.1 的真机事故就是这么来的：框架文档写明 `WorldContext.packageDir` 是
 * 「bot 代码包目录」，宿主传进来的是 fatfish 的包；照它拼 `assets/draw.mp4`
 * 永远找不到，于是抽签没有动画、面板没有背景、页脚没有头像。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { OWN_PACKAGE_DIR, resolvePackageDir } from '../src/assets.ts';

const assets = (...names: string[]) => names.map((name) => join(OWN_PACKAGE_DIR, 'assets', name));

test('本包目录里确实有三个媒体素材', () => {
  assert.equal(OWN_PACKAGE_DIR, join(import.meta.dirname, '..'));
  for (const file of assets('draw.mp4', 'panel-bg.mp4', 'avatar.jpg')) {
    assert.ok(existsSync(file), `缺素材：${file}`);
  }
});

test('没给提示时用自己的包目录', () => {
  assert.equal(resolvePackageDir(undefined), OWN_PACKAGE_DIR);
});

test('宿主给的是 bot 包目录（不含 assets）时，仍然用自己的包目录', () => {
  // 仿造真宿主的情形：一个像包的目录（有 package.json），但没有 assets/
  const botDir = join(import.meta.dirname, '..', '.tmp-test', 'assets', 'fake-bot-package');
  rmSync(botDir, { recursive: true, force: true });
  mkdirSync(botDir, { recursive: true });
  writeFileSync(join(botDir, 'package.json'), '{"name":"cortico-world-fatfish"}', 'utf8');

  assert.equal(resolvePackageDir(botDir), OWN_PACKAGE_DIR);
});

test('自己的包目录不可用时才退回提示（自检工具的走法）', () => {
  // 提示为空串时等价于没有提示
  assert.equal(resolvePackageDir(''), OWN_PACKAGE_DIR);
});

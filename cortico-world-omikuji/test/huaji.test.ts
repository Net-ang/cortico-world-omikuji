/**
 * 「转运板」的服务端：记账与状态。
 *
 * 规则：只有**已定下来的凶签**（大凶 / 小凶）才记账；其他日子想玩就玩，不挂标签。
 * 未定下来的日子（今天还没抽签）连档位与分数都不给——与主面板同一条铁律。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSignContent } from '../src/content.ts';
import { OMIKUJI_DEFAULTS, type OmikujiConfigSection } from '../src/config.ts';
import { huajiStatus, panelInvoke, type PanelDeps } from '../src/panel.ts';
import { isBadTier, readHuaji, recordHuaji } from '../src/huaji.ts';
import { OmikujiWorld } from '../src/world.ts';

const content = loadSignContent();
const PACKAGE_DIR = join(import.meta.dirname, '..');
const root = join(import.meta.dirname, '..', '.tmp-test', 'huaji');
const SALT = 'feedfacefeedface';
const TODAY = '2026-11-24';

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 找一个档位是「凶」的日期（用固定盐试出来，不依赖运气）。 */
function findBadDate(): string {
  const world = new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: 'builtin' },
    timezone: 'Asia/Shanghai',
    dataDir: join(root, 'probe'),
    packageDir: PACKAGE_DIR,
    content,
    now: () => `${TODAY}T10:00:00+08:00`,
  });
  for (let day = 1; day <= 28; day += 1) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    if (isBadTier(world.signFor(date).tierId)) return date;
  }
  throw new Error('十月份居然没有一天是凶签');
}

function makeDeps(dataDir: string, today = TODAY): PanelDeps {
  const world = new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: 'builtin' },
    timezone: 'Asia/Shanghai',
    dataDir,
    packageDir: PACKAGE_DIR,
    content,
    now: () => `${today}T10:00:00+08:00`,
  });
  return {
    mode: 'builtin',
    dataDir,
    packageDir: PACKAGE_DIR,
    today,
    signFor: (date) => world.signFor(date),
    drawFor: (date) => world.drawFor(date),
    text: { font: 'kai' },
  };
}

const BAD_DATE = findBadDate();

test('凶签判定只认大凶与小凶，末吉不算', () => {
  assert.equal(isBadTier('daxiong'), true);
  assert.equal(isBadTier('xiaoxiong'), true);
  for (const ok of ['moji', 'ping', 'xiaoji', 'zhongji', 'daji', 'shangshang']) {
    assert.equal(isBadTier(ok), false, `${ok} 不该算凶`);
  }
});

test('记账：同一天只留第一次的时间，tries 取小的', () => {
  const dir = freshDir('store');
  const first = recordHuaji(dir, BAD_DATE, '2026-11-24T10:00:00+08:00', 4);
  assert.equal(first.kept, false);
  assert.equal(first.record.tries, 4);

  const second = recordHuaji(dir, BAD_DATE, '2026-11-24T11:00:00+08:00', 2);
  assert.equal(second.kept, true);
  assert.equal(second.record.at, '2026-11-24T10:00:00+08:00', '首次通关时间不被覆盖');
  assert.equal(second.record.tries, 2, 'tries 取更小的那个');

  assert.deepEqual(readHuaji(dir, BAD_DATE), { at: '2026-11-24T10:00:00+08:00', tries: 2 });
  assert.equal(readHuaji(dir, '1999-01-01'), null);
});

test('状态：今天还没抽签时，一个数字都不给', async () => {
  const deps = makeDeps(freshDir('unsettled'));
  const status = (await panelInvoke(deps, 'zhuanyun', 'status', [])) as {
    settled: boolean;
    bad: boolean;
    tierLabel: unknown;
    score: unknown;
    done: boolean;
  };
  assert.equal(status.settled, false);
  assert.equal(status.bad, false);
  assert.equal(status.tierLabel, null);
  assert.equal(status.score, null);
  assert.equal(status.done, false);
});

test('状态：抽过之后才报档位；凶签 bad=true', async () => {
  const dir = freshDir('settled');
  const deps = makeDeps(dir);
  deps.drawFor(TODAY);
  const status = (await panelInvoke(deps, 'zhuanyun', 'status', [])) as {
    settled: boolean;
    tierLabel: string;
    score: number;
    bad: boolean;
  };
  assert.equal(status.settled, true);
  assert.equal(typeof status.tierLabel, 'string');
  assert.equal(typeof status.score, 'number');
  assert.equal(status.bad, isBadTier(content.tiers.find((t) => t.label === status.tierLabel)!.id));
});

test('通关只给「已定下来的凶签」记账', async () => {
  const dir = freshDir('record');
  const deps = makeDeps(dir);

  // 未抽签时调用 win：不记账
  await panelInvoke(deps, 'zhuanyun', 'win', [TODAY, 3]);
  assert.equal(readHuaji(dir, TODAY), null, '还没抽签就不该挂标签');

  // 抽到凶签的日期（过去的日子，已经定下来）
  const badDeps = makeDeps(dir);
  const badStatus = huajiStatus(badDeps, BAD_DATE);
  assert.equal(badStatus.bad, true, `${BAD_DATE} 应是凶签`);

  const after = (await panelInvoke(badDeps, 'zhuanyun', 'win', [BAD_DATE, 3])) as { done: boolean; tries: number };
  assert.equal(after.done, true);
  assert.equal(after.tries, 3);
  assert.ok(readHuaji(dir, BAD_DATE), '凶签通关要落盘');
});

test('主面板快照带上 bad / huaji 两个字段', async () => {
  const dir = freshDir('snapshot');
  const deps = makeDeps(dir);
  const before = (await panelInvoke(deps, 'now', 'snapshot', [])) as { bad: boolean; huaji: boolean };
  assert.equal(before.huaji, false);

  // 给一个过去的凶签日期记上，然后用 now 回看那一天
  recordHuaji(dir, BAD_DATE, '2026-11-24T10:00:00+08:00', 1);
  const past = (await panelInvoke(deps, 'now', 'snapshot', [BAD_DATE])) as { bad: boolean; huaji: boolean };
  assert.equal(past.bad, true);
  assert.equal(past.huaji, true);
});

test('未知面板与方法照旧报错', async () => {
  const deps = makeDeps(freshDir('errors'));
  await assert.rejects(panelInvoke(deps, 'nope', 'status', []), /没有这个面板/);
  await assert.rejects(panelInvoke(deps, 'zhuanyun', 'cheat', []), /没有这个方法/);
  await assert.rejects(panelInvoke(deps, 'zhuanyun', 'win', [TODAY, 0]), TypeError);
});

test('记账文件坏了当作没记账，不影响状态查询', () => {
  const dir = freshDir('broken');
  writeFileSync(join(dir, 'omikuji-huaji.json'), '{ 不是 JSON', 'utf8');
  assert.equal(readHuaji(dir, BAD_DATE), null);
  const deps = makeDeps(dir);
  assert.equal(huajiStatus(deps, BAD_DATE).done, false);
  assert.ok(existsSync(join(dir, 'omikuji-huaji.json')));
});

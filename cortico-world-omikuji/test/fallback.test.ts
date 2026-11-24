/**
 * 「第二天回头补录」的规则：
 *
 * 当天没抽签 → 第二天用「日期 + 固定本机盐」把它生成出来，之后冻结。
 * 今天永远不补：今天没抽就是没抽，一个数字都不给。
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import { OMIKUJI_DEFAULTS, type OmikujiConfigSection } from '../src/config.ts';
import { daysFilePath, lockFallbackDays, readDayRecord, readDaySalt } from '../src/daysalt.ts';
import { OmikujiWorld } from '../src/world.ts';

const content = loadSignContent();
const PACKAGE_DIR = join(import.meta.dirname, '..');
const root = join(import.meta.dirname, '..', '.tmp-test', 'fallback');
const SALT = 'feedfacefeedface';
const TODAY = '2026-11-24';
const YESTERDAY = '2026-11-23';

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeWorld(dataDir: string, now: string, cfg: Partial<OmikujiConfigSection> = {}): OmikujiWorld {
  return new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: 'builtin', ...cfg },
    timezone: 'Asia/Shanghai',
    dataDir,
    packageDir: PACKAGE_DIR,
    content,
    now: () => now,
  });
}

test('补录只动「今天之前、还没记录」的日子，今天不碰', () => {
  const dir = freshDir('scope');
  const locked = lockFallbackDays(dir, TODAY, SALT, `${TODAY}T09:00:00+08:00`);

  assert.ok(!locked.includes(TODAY), '今天不能补录');
  assert.ok(locked.includes(YESTERDAY), '昨天该补');
  assert.ok(locked.every((date) => date < TODAY));
  assert.equal(readDaySalt(dir, TODAY), null, '今天依然没有盐');
  assert.equal(readDayRecord(dir, YESTERDAY)?.source, 'fallback');
  assert.equal(readDayRecord(dir, YESTERDAY)?.salt, SALT, '补录用的是固定本机盐');
});

test('已经抽过的日子一个字节都不改', () => {
  const dir = freshDir('keep-drawn');
  // 先真的抽一次昨天（用假时钟把「今天」定在昨天）
  const yesterdayWorld = makeWorld(dir, `${YESTERDAY}T23:30:00+08:00`);
  const drawn = yesterdayWorld.drawFor(YESTERDAY);
  const saltBefore = readDaySalt(dir, YESTERDAY);
  assert.ok(saltBefore && saltBefore !== SALT, '真抽的盐不是固定盐');

  // 第二天开机：补录跑一遍，昨天的记录必须原样
  const todayWorld = makeWorld(dir, `${TODAY}T09:00:00+08:00`);
  assert.deepEqual(todayWorld.signFor(YESTERDAY), drawn, '抽过的那天还是那张签');
  assert.equal(readDaySalt(dir, YESTERDAY), saltBefore);
  assert.equal(readDayRecord(dir, YESTERDAY)?.source, 'draw');
});

test('补录之后那一天冻结：换配置里的盐也不再变', () => {
  const dir = freshDir('freeze');
  lockFallbackDays(dir, TODAY, SALT, `${TODAY}T09:00:00+08:00`);
  const world = makeWorld(dir, `${TODAY}T10:00:00+08:00`);
  const before = world.signFor(YESTERDAY);

  // 就算把固定盐改掉，补录过的那天还是同一张（已经是既成事实）
  const changed = makeWorld(dir, `${TODAY}T10:05:00+08:00`, { salt: 'abcdefabcdefabcd' });
  assert.deepEqual(changed.signFor(YESTERDAY), before);
  // 而没补录过的更早日期会跟着新盐走
  assert.notDeepEqual(
    changed.signFor('2026-11-10'),
    world.signFor('2026-11-10'),
    '七天窗口外的日子没有记录，仍按当前固定盐算',
  );
});

test('挂载时就补录，并写进日志；跨了几天也一并补上', async () => {
  const dir = freshDir('on-start');
  const world = makeWorld(dir, `${TODAY}T09:00:00+08:00`);
  const logs: string[] = [];
  const host = {
    pushEvent: async (event: unknown) => event,
    log: { info: (m: string) => logs.push(m), warn: () => {}, error: () => {}, debug: () => {} },
  } as never;

  await world.start(host);
  try {
    const store = JSON.parse(readFileSync(daysFilePath(dir), 'utf8')) as Record<string, { source?: string }>;
    assert.equal(store[TODAY], undefined, '今天不补');
    for (const date of ['2026-11-23', '2026-11-22', '2026-11-21']) {
      assert.equal(store[date]?.source, 'fallback', `${date} 该被补录`);
    }
    assert.ok(logs.some((line) => line.includes('补录')), '补录要留一条日志');
  } finally {
    await world.stop();
  }
});

test('补录出来的签与 0.1.3 口径一致（日期 + 固定盐）', () => {
  const dir = freshDir('compat');
  lockFallbackDays(dir, TODAY, SALT, `${TODAY}T09:00:00+08:00`);
  const world = makeWorld(dir, `${TODAY}T12:00:00+08:00`);
  assert.deepEqual(world.signFor(YESTERDAY), drawSign(YESTERDAY, SALT, content));
});

test('同一天只补录一次；第二次跑不写盘、不报重复', () => {
  const dir = freshDir('idempotent');
  const first = lockFallbackDays(dir, TODAY, SALT, `${TODAY}T09:00:00+08:00`);
  assert.ok(first.length > 0);
  const second = lockFallbackDays(dir, TODAY, SALT, `${TODAY}T10:00:00+08:00`);
  assert.deepEqual(second, [], '已经补过的不再补');
});

/**
 * 每天 7 点的「结算」：把昨天定下来，并把日子翻到今天。
 *
 * 昨天抽过 → 用当时摇的盐；昨天没抽 → 用「日期 + 固定本机盐」补录并冻结。
 * 同一天只做一次（`omikuji-settle.json`），未到 7 点不做。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import { OMIKUJI_DEFAULTS } from '../src/config.ts';
import { readDayRecord, readDaySalt } from '../src/daysalt.ts';
import { settledDate } from '../src/settle.ts';
import { OmikujiWorld } from '../src/world.ts';

const content = loadSignContent();
const PACKAGE_DIR = join(import.meta.dirname, '..');
const root = join(import.meta.dirname, '..', '.tmp-test', 'settle');
const SALT = 'feedfacefeedface';
const TODAY = '2026-11-24';
const YESTERDAY = '2026-11-23';

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeWorld(dataDir: string, now: string): OmikujiWorld {
  return new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: 'builtin' },
    timezone: 'Asia/Shanghai',
    dataDir,
    packageDir: PACKAGE_DIR,
    content,
    now: () => now,
  });
}

function fakeHost(pushed: Array<{ event: { type: string; text: string }; opts?: unknown }>) {
  return {
    pushEvent: async (event: unknown, opts?: unknown) => {
      pushed.push({ event: event as { type: string; text: string }, opts });
      return event;
    },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as never;
}

test('7 点之前不结算：昨天不会被补录', async () => {
  const dir = freshDir('before-seven');
  const pushed: Array<{ event: { type: string; text: string }; opts?: unknown }> = [];
  const world = makeWorld(dir, `${TODAY}T06:30:00+08:00`);
  await world.start(fakeHost(pushed));
  await world.stop();

  assert.equal(readDaySalt(dir, YESTERDAY), null, '还没到 7 点，昨天不该被定下来');
  assert.equal(settledDate(dir), null);
  assert.equal(pushed.length, 1, '只推挂载事件');
  assert.doesNotMatch(pushed[0]!.event.text, /新的一天/);
});

test('过了 7 点：昨天用固定盐补录，挂载事件里报出新的一天与昨天结果', async () => {
  const dir = freshDir('after-seven');
  const pushed: Array<{ event: { type: string; text: string }; opts?: unknown }> = [];
  const world = makeWorld(dir, `${TODAY}T07:05:00+08:00`);
  await world.start(fakeHost(pushed));
  await world.stop();

  const record = readDayRecord(dir, YESTERDAY);
  assert.equal(record?.source, 'fallback', '昨天没抽，用固定盐补录');
  assert.equal(record?.salt, SALT);
  assert.equal(settledDate(dir), TODAY, '记下今天已结算');

  const text = pushed[0]!.event.text;
  assert.match(text, /新的一天（2026-11-24）/);
  assert.match(text, /昨天没抽，按日期 \+ 固定盐定为/);

  // 补出来的签要和「日期 + 固定盐」一致
  const sign = drawSign(YESTERDAY, SALT, content);
  assert.match(text, new RegExp(`第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分`));
});

test('昨天真抽过：结算报「昨天的签是」，且不改写那条记录', async () => {
  const dir = freshDir('drawn-yesterday');
  const yesterdayWorld = makeWorld(dir, `${YESTERDAY}T20:00:00+08:00`);
  const drawn = yesterdayWorld.drawFor(YESTERDAY);
  const saltBefore = readDaySalt(dir, YESTERDAY);

  const pushed: Array<{ event: { type: string; text: string }; opts?: unknown }> = [];
  const todayWorld = makeWorld(dir, `${TODAY}T07:05:00+08:00`);
  await todayWorld.start(fakeHost(pushed));
  await todayWorld.stop();

  assert.equal(readDaySalt(dir, YESTERDAY), saltBefore, '抽过的那天一个字节都不改');
  assert.match(pushed[0]!.event.text, /昨天的签是/);
  assert.match(pushed[0]!.event.text, new RegExp(`第 ${drawn.lot} 签`));
});

test('同一天只结算一次：再开机不会重复补录，也不会重复报', async () => {
  const dir = freshDir('once-a-day');
  const first: Array<{ event: { type: string; text: string }; opts?: unknown }> = [];
  const w1 = makeWorld(dir, `${TODAY}T07:05:00+08:00`);
  await w1.start(fakeHost(first));
  await w1.stop();
  assert.match(first[0]!.event.text, /新的一天/);

  const second: Array<{ event: { type: string; text: string }; opts?: unknown }> = [];
  const w2 = makeWorld(dir, `${TODAY}T15:00:00+08:00`);
  await w2.start(fakeHost(second));
  await w2.stop();
  assert.doesNotMatch(second[0]!.event.text, /新的一天/, '今天已经结算过');
});

test('跨零点后自动重置：第二天 7 点又会结算一次', async () => {
  const dir = freshDir('next-day');
  const w1 = makeWorld(dir, `${TODAY}T07:05:00+08:00`);
  await w1.start(fakeHost([]));
  await w1.stop();
  assert.equal(settledDate(dir), TODAY);

  const pushed: Array<{ event: { type: string; text: string }; opts?: unknown }> = [];
  const w2 = makeWorld(dir, `2026-11-25T07:05:00+08:00`);
  await w2.start(fakeHost(pushed));
  await w2.stop();
  assert.equal(settledDate(dir), '2026-11-25');
  assert.match(pushed[0]!.event.text, /新的一天（2026-11-25）/);
  assert.equal(readDayRecord(dir, TODAY)?.source, 'fallback', '今天没抽，第二天被补录');
});

test('结算的记账文件坏了也不影响挂载', async () => {
  const dir = freshDir('broken-marker');
  const fs = await import('node:fs');
  fs.writeFileSync(join(dir, 'omikuji-settle.json'), '{ 这不是 JSON', 'utf8');
  assert.equal(settledDate(dir), null, '读不出来就当没结算过');

  const pushed: Array<{ event: { type: string; text: string }; opts?: unknown }> = [];
  const world = makeWorld(dir, `${TODAY}T07:05:00+08:00`);
  await world.start(fakeHost(pushed));
  await world.stop();
  assert.match(pushed[0]!.event.text, /新的一天/, '坏文件按没结算过处理，照常结算');
  assert.ok(existsSync(join(dir, 'omikuji-settle.json')));
});

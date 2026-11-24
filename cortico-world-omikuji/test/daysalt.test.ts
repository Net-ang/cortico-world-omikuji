import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { nowIso } from 'cortico/core/util.ts';
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import {
  clearDaySalts,
  daysBefore,
  daysFilePath,
  materializeDaySalt,
  readDaySalt,
  RETENTION_DAYS,
} from '../src/daysalt.ts';
import type { OmikujiConfigSection } from '../src/config.ts';
import { OmikujiWorld } from '../src/world.ts';

const content = loadSignContent();
const PACKAGE_DIR = join(import.meta.dirname, '..');
const root = join(import.meta.dirname, '..', '.tmp-test', 'daysalt');
const TZ = 'Asia/Shanghai';
const TODAY = nowIso(TZ).slice(0, 10);
const FIXED = 'feedfacefeedface';

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function world(dir: string, overrides: Partial<OmikujiConfigSection> = {}): OmikujiWorld {
  const cfg: OmikujiConfigSection = { enabled: true, salt: FIXED, wording: 'pet', ...overrides };
  return new OmikujiWorld({ cfg, timezone: TZ, dataDir: dir, packageDir: PACKAGE_DIR, content });
}

test('读不产生随机：signFor 不摇盐，没抽过的日子给的就是「日期 + 固定盐」', () => {
  const dir = freshDir('readonly-sign');
  const w = world(dir);

  const read = w.signFor();
  assert.equal(readDaySalt(dir, TODAY), null, '只读一下不该摇出盐来');
  assert.equal(existsSync(daysFilePath(dir)), false, '也不该写文件');

  const expected = drawSign(TODAY, FIXED, content);
  assert.equal(read.score, expected.score, '没抽过时就是 0.1.3 那套：日期 + 固定盐');

  // 真抽之后才开始用当日盐
  const drawn = w.drawFor();
  assert.notEqual(readDaySalt(dir, TODAY), null);
  assert.equal(w.signFor().score, drawn.score, '抽过之后读到的就是抽出来的那张');
});

test('抽过去的日子不摇新盐：补抽只是读', () => {
  const dir = freshDir('past-draw');
  const w = world(dir);
  const past = '2025-03-04';
  const a = w.drawFor(past);
  const b = w.signFor(past);
  assert.equal(readDaySalt(dir, past), null, '过去的日子不该被动摇出盐');
  assert.equal(a.score, b.score);
  assert.equal(a.score, drawSign(past, FIXED, content).score);
});

test('今天第一次真抽签就摇一个真随机的盐并落盘，之后同一天不再变', () => {
  const dir = freshDir('first');
  assert.equal(readDaySalt(dir, TODAY), null, '第一次之前什么都没有');

  const first = materializeDaySalt(dir, TODAY, nowIso(TZ));
  assert.equal(first.created, true, '第一次算生成');
  assert.match(first.salt, /^[0-9a-f]{16}$/);
  assert.equal(readDaySalt(dir, TODAY), first.salt, '盐必须落盘');

  const second = materializeDaySalt(dir, TODAY, nowIso(TZ));
  assert.equal(second.created, false, '第二次不该重摇');
  assert.equal(second.salt, first.salt, '同一天只能是同一个盐');
});

test('只读不创建：readDaySalt 不会凭空造盐', () => {
  const dir = freshDir('readonly');
  assert.equal(readDaySalt(dir, TODAY), null);
  assert.equal(existsSync(daysFilePath(dir)), false, '读一次不该写出文件');
});

test('换一台机器就是另一套：两个数据目录今天各抽各的，盐不同、签不同', () => {
  const dirA = freshDir('machine-a');
  const dirB = freshDir('machine-b');
  const signA = world(dirA).drawFor();
  const signB = world(dirB).drawFor();

  assert.notEqual(readDaySalt(dirA, TODAY), readDaySalt(dirB, TODAY), '两台机器今天的盐必须不同');
  assert.notDeepEqual(
    { lot: signA.lot, score: signA.score, poem: signA.poem },
    { lot: signB.lot, score: signB.score, poem: signB.poem },
  );
});

test('同一台机器重启后，今天仍是同一张签（从盘上读回来）', () => {
  const dir = freshDir('restart');
  const drawn = world(dir).drawFor();
  const reread = world(dir).signFor();
  const redrawn = world(dir).drawFor();
  assert.deepEqual(reread, drawn, '重新挂载读回来的是同一张');
  assert.deepEqual(redrawn, drawn, '再抽一次也不换');
});

test('只留七天：落盘时把窗口外的条目删掉，窗口内保留', () => {
  const dir = freshDir('prune');
  // daysBefore 升序且含今天，去掉今天才是「已有的历史」
  const history = daysBefore(TODAY, RETENTION_DAYS).slice(0, -1);
  const stale = '2020-01-01';
  const seeded: Record<string, { salt: string; createdAt: string }> = {};
  for (const date of [...history, stale]) seeded[date] = { salt: `seed${date.replaceAll('-', '')}`, createdAt: nowIso(TZ) };
  rmSync(daysFilePath(dir), { force: true });
  writeFileSync(daysFilePath(dir), JSON.stringify(seeded), 'utf8');

  materializeDaySalt(dir, TODAY, nowIso(TZ));
  const after = JSON.parse(readFileSync(daysFilePath(dir), 'utf8')) as Record<string, unknown>;

  assert.equal(after[stale], undefined, '七天前的条目必须被删掉');
  for (const date of history) assert.ok(after[date], `窗口内的 ${date} 要留着`);
  assert.ok(after[TODAY], '今天的当然要在');
  assert.equal(Object.keys(after).length, RETENTION_DAYS, `正好 ${RETENTION_DAYS} 天`);
});

test('七天以外的日期回落到固定本机盐：两台机器算出来一样', () => {
  const old = daysBefore(TODAY, 30)[0]!;
  const dirA = freshDir('fallback-a');
  const dirB = freshDir('fallback-b');
  const a = world(dirA).signFor(old);
  const b = world(dirB).signFor(old);
  const expected = drawSign(old, FIXED, content);

  assert.deepEqual(a, b, '回落是确定的，跨机器一致');
  assert.equal(a.score, expected.score);
  assert.equal(readDaySalt(dirA, old), null, '回落不写每日盐');
});

test('面板的七天回看里，抽过的那些天就是当时那张', () => {
  const dir = freshDir('panel-window');
  const w = world(dir);
  const yesterday = daysBefore(TODAY, 2)[0]!;
  const readYesterday = w.signFor(yesterday); // 七天以内但没抽过 → 按固定盐读
  assert.equal(readDaySalt(dir, yesterday), null, '读不会给过去的日子摇盐');
  assert.equal(w.signFor(yesterday).score, readYesterday.score);

  // 真抽今天之后，读到的就是抽出来的那张
  const drawn = w.drawFor();
  assert.notEqual(readDaySalt(dir, TODAY), null);
  assert.equal(w.signFor().score, drawn.score);
});

test('clearDaySalts 把整份每日盐清掉，再抽就是新的一套', () => {
  const dir = freshDir('clear');
  const before = world(dir).drawFor();
  clearDaySalts(dir);
  assert.equal(readDaySalt(dir, TODAY), null);

  const after = world(dir).drawFor();
  assert.notEqual(readDaySalt(dir, TODAY), null);
  assert.ok(before.score >= 0 && before.score <= 100);
  assert.ok(after.score >= 0 && after.score <= 100);
  assert.equal(world(dir).signFor().score, after.score, '清掉之后读到的也是新抽的那张');
});

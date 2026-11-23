import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSignContent, loadSignContent } from '../src/content.ts';
import { dateSeedOf, drawSign, isDateIso, seedOfDate, tierForScore } from '../src/daily.ts';
import { ensureSalt, readSalt, SALT_FILE_NAME, saltFilePath } from '../src/salt.ts';

const content = loadSignContent();
const SALT = 'a1b2c3d4e5f60718';

/** n 个连续日期，从 start 起。 */
function datesFrom(start: string, days: number): string[] {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

test('日期即种子：2026-11-23 的种子数字是 20261123', () => {
  assert.equal(dateSeedOf('2026-11-23'), 20261123);
  assert.equal(dateSeedOf('2027-01-05'), 20270105);
});

test('同机同日恒定：同日期同盐抽多少次都一样', () => {
  for (const date of ['2026-11-23', '2026-02-28', '2027-12-31']) {
    const first = drawSign(date, SALT, content);
    const again = drawSign(date, SALT, content);
    assert.deepEqual(again, first);
  }
});

test('换盐就换签：同一天在不同机器上大多给出不同的签', () => {
  // 两次独立取 0–100 本来就有约 1% 撞分，所以这里量的是比例而不是「一个都不许撞」。
  const dates = datesFrom('2026-01-01', 1000);
  let sameScore = 0;
  let sameSlip = 0;
  for (const date of dates) {
    const a = drawSign(date, SALT, content);
    const b = drawSign(date, 'ffffffffffffffff', content);
    if (a.score === b.score) sameScore += 1;
    if (a.score === b.score && a.poem === b.poem && a.gloss === b.gloss) sameSlip += 1;
  }
  assert.ok(sameScore / dates.length < 0.03, `${sameScore}/1000 dates keep the score across salts`);
  assert.ok(sameSlip / dates.length < 0.01, `${sameSlip}/1000 dates share a whole slip across salts`);
});

test('相邻日期不雷同：连续日期的分数不重复', () => {
  const dates = datesFrom('2026-03-01', 90);
  for (let i = 1; i < dates.length; i += 1) {
    const previous = drawSign(dates[i - 1]!, SALT, content);
    const current = drawSign(dates[i]!, SALT, content);
    assert.notEqual(current.score, previous.score, `${dates[i]} repeats ${dates[i - 1]}'s score`);
  }
});

test('档位完整覆盖 0–100 且分数落在自己的档里', () => {
  checkSignContent(content);
  for (let score = 0; score <= 100; score += 1) {
    const tier = tierForScore(score, content);
    assert.ok(score >= tier.min && score <= tier.max);
  }
  for (const date of datesFrom('2024-01-01', 800)) {
    const sign = drawSign(date, SALT, content);
    assert.ok(sign.score >= 0 && sign.score <= 100);
    assert.equal(sign.tierId, tierForScore(sign.score, content).id);
  }
});

test('分布接近均匀：八年日期的档位占比与档宽相符', () => {
  const dates = datesFrom('2020-01-01', 2922);
  const counts = new Map<string, number>();
  for (const date of dates) {
    const sign = drawSign(date, SALT, content);
    counts.set(sign.tierId, (counts.get(sign.tierId) ?? 0) + 1);
  }
  for (const tier of content.tiers) {
    const expected = (tier.max - tier.min + 1) / 101;
    const observed = (counts.get(tier.id) ?? 0) / dates.length;
    assert.ok(
      Math.abs(observed - expected) < 0.02,
      `${tier.id}: expected ${expected.toFixed(3)}, observed ${observed.toFixed(3)}`,
    );
  }
});

test('宜与忌不会同一句，签号在 1–1000', () => {
  for (const date of datesFrom('2026-06-01', 400)) {
    const sign = drawSign(date, SALT, content);
    assert.notEqual(sign.yi, sign.ji);
    assert.ok(sign.lot >= 1 && sign.lot <= 1000);
    assert.ok(content.colors.includes(sign.color));
    assert.ok(content.yi.includes(sign.yi));
    assert.ok(content.ji.includes(sign.ji));
  }
});

test('日期校验挡住不存在的日子', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '20261123', '2026-1-1', '']) {
    assert.equal(isDateIso(bad), false, bad);
  }
  for (const good of ['2026-11-23', '2024-02-29', '2026-12-31']) {
    assert.equal(isDateIso(good), true, good);
  }
  assert.throws(() => seedOfDate('2026-02-30', SALT), RangeError);
  assert.throws(() => drawSign('2026-02-30', SALT, content), RangeError);
  assert.throws(() => seedOfDate('2026-11-23', ''), RangeError);
});

test('本机盐落盘后复用，换个目录就是另一个盐', () => {
  const root = join(import.meta.dirname, '..', '.tmp-test', 'salt');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const machineA = join(root, 'a');
  const machineB = join(root, 'b');

  const first = ensureSalt(machineA, '2026-11-23T10:00:00+08:00');
  const second = ensureSalt(machineA, '2026-11-24T10:00:00+08:00');
  assert.equal(second, first, 'same directory must keep the same salt');
  assert.equal(readSalt(machineA), first);
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(readSalt(join(root, 'missing')), null);

  const other = ensureSalt(machineB, '2026-11-23T10:00:00+08:00');
  assert.notEqual(other, first, 'another directory is another machine');
  assert.ok(saltFilePath(machineA).endsWith(SALT_FILE_NAME));

  rmSync(root, { recursive: true, force: true });
});

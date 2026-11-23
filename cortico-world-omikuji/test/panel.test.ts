import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import { saveWording } from '../src/wording.ts';
import { PANEL_ID, panelInvoke, panelSnapshot, type PanelDeps } from '../src/panel.ts';
import { OmikujiWorld } from '../src/world.ts';

const content = loadSignContent();
const root = join(import.meta.dirname, '..', '.tmp-test', 'panel');
const SALT = 'feedfacefeedface';
const TODAY = '2026-11-23';

function deps(mode: 'builtin' | 'pet', dir: string): PanelDeps {
  const cfg = { enabled: true, salt: SALT, wording: mode };
  const world = new OmikujiWorld({ cfg, timezone: 'Asia/Shanghai', dataDir: dir, content });
  return { mode, dataDir: dir, today: TODAY, signFor: (date: string) => world.signFor(date) };
}

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('面板快照给的就是今天那张签', () => {
  const snap = panelSnapshot(deps('builtin', freshDir('builtin')));
  const expected = drawSign(TODAY, SALT, content);
  assert.equal(snap.today, TODAY);
  assert.equal(snap.date, TODAY);
  assert.equal(snap.sign.lot, expected.lot);
  assert.equal(snap.sign.score, expected.score);
  assert.equal(snap.sign.tierLabel, expected.tierLabel);
  assert.equal(snap.sign.poem, expected.poem);
  assert.equal(snap.written, null, 'builtin mode never reports pet wording');
});

test('七天回看：今天在最前，逐天倒序', () => {
  const snap = panelSnapshot(deps('builtin', freshDir('builtin-days')));
  assert.equal(snap.recent.length, 7);
  assert.equal(snap.recent[0]!.date, TODAY);
  assert.deepEqual(
    snap.recent.map((day) => day.date),
    ['2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20', '2026-11-19', '2026-11-18', '2026-11-17'],
  );
  for (const day of snap.recent) {
    const sign = drawSign(day.date, SALT, content);
    assert.equal(day.score, sign.score);
    assert.equal(day.tierLabel, sign.tierLabel);
  }
});

test('pet 模式：写过就报原文，没写就报 null 且不编造', () => {
  const dir = freshDir('pet');
  const written = '檐下站一会儿，等雨小些再走。';
  const before = panelSnapshot(deps('pet', dir));
  assert.equal(before.written, null);
  assert.equal(before.recent[0]!.written, false);

  saveWording(dir, TODAY, written, '2026-11-23T09:00:00+08:00');
  const after = panelSnapshot(deps('pet', dir));
  assert.equal(after.written, written);
  assert.equal(after.recent[0]!.written, true);
  assert.equal(after.recent[1]!.written, false, 'neighbouring days stay unwritten');
});

test('回看指定日期只换 day，七天条不动', () => {
  const snap = panelSnapshot(deps('builtin', freshDir('past')), '2026-11-19');
  assert.equal(snap.date, '2026-11-19');
  assert.equal(snap.sign.date, '2026-11-19');
  assert.equal(snap.recent[0]!.date, TODAY);
  assert.equal(snap.today, TODAY);
});

test('面板方法只认 snapshot，别的都报错', async () => {
  const dir = freshDir('invoke');
  const snapshot = (await panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', [])) as { date: string };
  assert.equal(snapshot.date, TODAY);

  const past = (await panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', ['2026-11-20'])) as { date: string };
  assert.equal(past.date, '2026-11-20');

  await assert.rejects(panelInvoke(deps('builtin', dir), PANEL_ID, 'draw', []), /没有这个方法/);
  await assert.rejects(panelInvoke(deps('builtin', dir), 'other', 'snapshot', []), /没有这个面板/);
  await assert.rejects(panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', [20261123]), TypeError);
  await assert.rejects(panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', ['2026-02-30']), RangeError);
});

test('World 的 webUi 声明了面板并接上 invoke', async () => {
  const dir = freshDir('world');
  const cfg = { enabled: true, salt: SALT, wording: 'pet' as const };
  const world = new OmikujiWorld({ cfg, timezone: 'Asia/Shanghai', dataDir: dir, content });
  const decl = world.webUi('zh');
  assert.ok(decl.panels?.some((panel) => panel.id === PANEL_ID), 'panel must be declared');
  assert.equal(decl.badges?.[0]?.value, '桌宠写');
  assert.ok(decl.invoke, 'invoke must be wired');
  const snapshot = (await decl.invoke!(PANEL_ID, 'snapshot', [])) as { mode: string; today: string };
  assert.equal(snapshot.mode, 'pet');
  assert.match(snapshot.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(world.webUi('en').badges?.[0]?.value, 'pet');
});

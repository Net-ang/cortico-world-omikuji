import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';
import { readDaySalt } from '../src/daysalt.ts';
import { OMIKUJI_DEFAULTS } from '../src/config.ts';
import { saveWording } from '../src/wording.ts';
import { nowIso } from 'cortico/core/util.ts';
import { DRAW_VIDEO, PANEL_ID, panelInvoke, panelSnapshot, type PanelDeps } from '../src/panel.ts';
import { OmikujiWorld } from '../src/world.ts';

const PACKAGE_DIR = join(import.meta.dirname, '..');
const content = loadSignContent();
const root = join(import.meta.dirname, '..', '.tmp-test', 'panel');
const SALT = 'feedfacefeedface';
const TODAY = '2026-11-23';

function deps(mode: 'builtin' | 'pet', dir: string): PanelDeps {
  const cfg = { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: mode };
  const world = new OmikujiWorld({ cfg, timezone: 'Asia/Shanghai', dataDir: dir, packageDir: PACKAGE_DIR, content });
  return {
    mode,
    dataDir: dir,
    packageDir: PACKAGE_DIR,
    today: TODAY,
    signFor: (date: string) => world.signFor(date),
    drawFor: (date: string) => world.drawFor(date),
    text: { font: 'kai' },
  };
}

function freshDir(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('今天没抽：快照里一个数字都不给（sign 为 null）', () => {
  const dir = freshDir('builtin');
  const snap = panelSnapshot(deps('builtin', dir));
  assert.equal(snap.today, TODAY);
  assert.equal(snap.date, TODAY);
  assert.equal(snap.sign, null, '没抽就没有签可报');
  assert.equal(snap.drawn, false);
  assert.equal(snap.locked, false);
  assert.equal(snap.recent[0]!.date, TODAY);
  assert.equal(snap.recent[0]!.drawn, false);
  assert.equal(snap.recent[0]!.lot, null, '今天的格子里也不能有数字');
  assert.equal(snap.recent[0]!.score, null);
  assert.equal(snap.recent[0]!.tierLabel, null);
  assert.equal(snap.written, null, 'builtin mode never reports pet wording');
  assert.equal(readDaySalt(dir, TODAY), null, 'snapshot 不该摇盐');

  // 今天那一条里不许有任何分数/签号（过去的日子是定死的，可以带数字）
  assert.doesNotMatch(JSON.stringify(snap.recent[0]), /"(score|lot)":\d/, '没抽就一个数字都不应存在');
  assert.equal(snap.sign, null);
});

test('抽过之后快照给的才是那天那张签', async () => {
  const dir = freshDir('builtin-drawn');
  const world = new OmikujiWorld({
    cfg: { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: 'builtin' },
    timezone: 'Asia/Shanghai',
    dataDir: dir,
    packageDir: PACKAGE_DIR,
    content,
    now: () => `${TODAY}T10:00:00+08:00`,
  });
  const sign = world.drawFor(TODAY);
  const snap = panelSnapshot(deps('builtin', dir));
  assert.ok(snap.sign, '抽过就有签');
  assert.equal(snap.sign.lot, sign.lot);
  assert.equal(snap.sign.score, sign.score);
  assert.equal(snap.sign.tierLabel, sign.tierLabel);
  assert.equal(snap.drawn, true);
  assert.equal(snap.locked, false, '真抽的不算补录');
  assert.equal(snap.recent[0]!.lot, sign.lot);
});

test('七天回看：今天在最前，逐天倒序；过去的没抽也按固定盐定死', () => {
  const snap = panelSnapshot(deps('builtin', freshDir('builtin-days')));
  assert.equal(snap.recent.length, 7);
  assert.equal(snap.recent[0]!.date, TODAY);
  assert.deepEqual(
    snap.recent.map((day) => day.date),
    ['2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20', '2026-11-19', '2026-11-18', '2026-11-17'],
  );
  // 今天还没抽 → 没有数字；过去的日子（`drawFor` 不会回填）按固定盐算，永远是同一张
  assert.equal(snap.recent[0]!.score, null);
  for (const day of snap.recent.slice(1)) {
    const sign = drawSign(day.date, SALT, content);
    assert.equal(day.score, sign.score);
    assert.equal(day.tierLabel, sign.tierLabel);
    assert.equal(day.drawn, true, '过去的日子视为已定');
  }
});

test('pet 模式：写过就报原文与解签，没写就报 null 且不编造', () => {
  const dir = freshDir('pet');
  const written = '檐下站一会儿，等雨小些再走。';
  const reading = '今天不必赶。把想做的排一件就够，剩下的留给明天。';
  const before = panelSnapshot(deps('pet', dir));
  assert.equal(before.written, null);
  assert.equal(before.writtenReading, null);
  assert.equal(before.recent[0]!.written, false);

  saveWording(dir, TODAY, written, reading, '2026-11-23T09:00:00+08:00');
  const after = panelSnapshot(deps('pet', dir));
  assert.equal(after.written, written);
  assert.equal(after.writtenReading, reading, '解签也要报出来');
  assert.equal(after.recent[0]!.written, true);
  assert.equal(after.recent[1]!.written, false, 'neighbouring days stay unwritten');
});

test('回看指定日期只换 day，七天条不动', () => {
  const snap = panelSnapshot(deps('builtin', freshDir('past')), '2026-11-19');
  assert.equal(snap.date, '2026-11-19');
  assert.equal(snap.sign!.date, '2026-11-19', '过去的日子按固定盐定死，回看给得出');
  assert.equal(snap.recent[0]!.date, TODAY);
  assert.equal(snap.today, TODAY);
});

test('面板方法只认 snapshot，别的都报错', async () => {
  const dir = freshDir('invoke');
  const snapshot = (await panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', [])) as { date: string };
  assert.equal(snapshot.date, TODAY);

  const past = (await panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', ['2026-11-20'])) as { date: string };
  assert.equal(past.date, '2026-11-20');

  // 只认 snapshot 与 draw；别的名字一律报错
  await assert.rejects(panelInvoke(deps('builtin', dir), PANEL_ID, 'refresh', []), /没有这个方法/);
  await assert.rejects(panelInvoke(deps('builtin', dir), 'other', 'snapshot', []), /没有这个面板/);
  await assert.rejects(panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', [20261123]), TypeError);
  await assert.rejects(panelInvoke(deps('builtin', dir), PANEL_ID, 'snapshot', ['2026-02-30']), RangeError);
  await assert.rejects(panelInvoke(deps('builtin', dir), PANEL_ID, 'draw', ['2026-02-30']), RangeError);
});

test('抽签动画：video 方法把包里那个 mp4 的流式回执交出来', async () => {
  const out = (await panelInvoke(deps('builtin', freshDir('video')), PANEL_ID, 'video', [])) as {
    $file?: { mime: string; path: string; bytes: number; sha256: string };
  };
  assert.ok(out.$file, 'assets/draw.mp4 在包里时必须给 $file');
  assert.equal(out.$file.mime, 'video/mp4');
  assert.ok(out.$file.path.endsWith(DRAW_VIDEO.replaceAll('/', '\\')) || out.$file.path.endsWith(DRAW_VIDEO));
  assert.ok(existsSync(out.$file.path));
  assert.ok(out.$file.bytes > 100_000, `动画应该是个真视频，拿到 ${out.$file.bytes} 字节`);
  assert.match(out.$file.sha256, /^[0-9a-f]{64}$/);

  // 包目录里没有这个素材时不能抛错，回 { absent: true } 让面板直接揭晓
  const bare = { ...deps('builtin', freshDir('video-bare')), packageDir: join(root, 'no-such-package') };
  assert.deepEqual(await panelInvoke(bare, PANEL_ID, 'video', []), { absent: true });
});

test('面板只有 draw 才摇盐：snapshot 和回看都不摇，且抽之前没有签', async () => {
  const dir = freshDir('panel-draw');
  const d = deps('builtin', dir);
  const realToday = nowIso('Asia/Shanghai').slice(0, 10);

  const read = (await panelInvoke(d, PANEL_ID, 'snapshot', [realToday])) as { sign: unknown; date: string };
  assert.equal(readDaySalt(dir, realToday), null, 'snapshot 不该摇盐');
  assert.equal(read.date, realToday);
  assert.equal(read.sign, null, '今天没抽，快照里不该有签');

  const drawn = (await panelInvoke(d, PANEL_ID, 'draw', [realToday])) as { sign: unknown };
  assert.notEqual(readDaySalt(dir, realToday), null, 'draw 必须摇出盐来');
  assert.ok(drawn.sign, 'draw 之后才有签');

  const after = (await panelInvoke(d, PANEL_ID, 'snapshot', [realToday])) as { sign: unknown };
  assert.deepEqual(after.sign, drawn.sign, '抽过之后读到的是抽出的那张');
});

test('World 的 webUi 声明了面板并接上 invoke', async () => {
  const dir = freshDir('world');
  const cfg = { ...OMIKUJI_DEFAULTS, enabled: true, salt: SALT, wording: 'pet' as const };
  const world = new OmikujiWorld({ cfg, timezone: 'Asia/Shanghai', dataDir: dir, packageDir: PACKAGE_DIR, content });
  const decl = world.webUi('zh');
  assert.ok(decl.panels?.some((panel) => panel.id === PANEL_ID), 'panel must be declared');
  assert.equal(decl.badges?.[0]?.value, '桌宠写');
  assert.ok(decl.invoke, 'invoke must be wired');
  const snapshot = (await decl.invoke!(PANEL_ID, 'snapshot', [])) as { mode: string; today: string };
  assert.equal(snapshot.mode, 'pet');
  assert.match(snapshot.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(world.webUi('en').badges?.[0]?.value, 'pet');
});

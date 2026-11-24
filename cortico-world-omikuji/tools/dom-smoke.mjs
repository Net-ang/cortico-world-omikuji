/**
 * 面板的假 DOM 冒烟测试。
 *
 * 沙箱里截不了图，但可以在 Node 里给一个够用的 document 桩，把**真的**客户端
 * （dist/webui.js）+ **真的**服务端（src/panel.ts）跑一遍：翻牌、看七天、回看、回今天。
 *
 *   node --experimental-transform-types tools/dom-smoke.mjs
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bundle from '../dist/webui.js';
import { loadSignContent } from '../src/content.ts';
import { saveWording } from '../src/wording.ts';
import { panelInvoke, PANEL_ID } from '../src/panel.ts';
import { OmikujiWorld } from '../src/world.ts';

// ----------------------------------------------------------------- DOM 桩

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.children = [];
    this.listeners = {};
    this.own = '';
    this.disabled = false;
    this.title = '';
    this.type = '';
    this.src = '';
    this.parent = null;
  }
  set textContent(v) {
    this.own = v == null ? '' : String(v);
    this.children = [];
  }
  get textContent() {
    return this.own + this.children.map((child) => child.textContent).join('');
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = nodes;
    for (const node of nodes) node.parent = this;
    this.own = '';
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

globalThis.document = { createElement: (tag) => new FakeNode(tag) };
// 浏览器里 window.URL 负责 blob 地址，这里给个假的
globalThis.window = globalThis;
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};

/** 卡面翻开没有：详批那一行只在成句的卡面出现（pet 模式未写时没有它）。 */
const isRevealed = (root) => root.textContent.includes('详批：') || findAll(root, (n) => (n.className ?? '') === 'om-star').length > 0;
/** 深度优先找出所有满足条件的节点。 */
function findAll(node, test) {
  const hits = [];
  if (test(node)) hits.push(node);
  for (const child of node.children ?? []) hits.push(...findAll(child, test));
  return hits;
}
const buttons = (root) => findAll(root, (node) => node.tagName === 'button');
/** 按文本找按钮：容器会累加子节点文本，所以这里限定 button，免得抓到外壳。 */
const byText = (root, exact) => buttons(root).find((node) => node.textContent === exact);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(what, test, timeoutMs = 2000) {
  const started = Date.now();
  for (;;) {
    if (test()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(10);
  }
}

// ----------------------------------------------------------------- 装配

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const content = loadSignContent();
const SALT = 'feedfacefeedface';
const TODAY = '2026-11-23';

const failures = [];
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok    ${label}`);
  else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

function mountPanel(dir, mode, { fresh = true, video = true } = {}) {
  if (fresh) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const world = new OmikujiWorld({
    cfg: { enabled: true, salt: SALT, wording: mode },
    timezone: 'Asia/Shanghai',
    dataDir: dir,
    packageDir,
    content,
  });
  const deps = {
    mode,
    dataDir: dir,
    packageDir,
    today: TODAY,
    signFor: (date) => world.signFor(date),
    drawFor: (date) => world.drawFor(date),
  };
  const memo = new Map();
  const ctx = {
    pageId: 'world:omikuji',
    panelId: PANEL_ID,
    language: 'zh',
    root: new FakeNode('div'),
    signal: new AbortController().signal,
    memo: { get: (k, f) => (memo.has(k) ? memo.get(k) : f), set: (k, v) => void memo.set(k, v) },
    invoke: (method, args) => panelInvoke(deps, PANEL_ID, method, args ?? []),
    invokeBinary: async (method) => {
      if (!video) return new Blob(['{}'], { type: 'application/json' });
      const out = await panelInvoke(deps, PANEL_ID, method, []);
      if (!out || !out.$file) return new Blob(['{}'], { type: 'application/json' });
      return new Blob([readFileSync(out.$file.path)], { type: out.$file.mime });
    },
    timeout: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      return { dispose: () => clearTimeout(handle) };
    },
  };
  return { ctx, world, deps, video };
}

/** 点「抽今天的签」并把动画放完：等 video 出现，手动触发 ended（桩里不会自己播）。 */
async function drawAndWait(root) {
  byText(root, '抽今天的签').listeners.click[0]();
  await until('抽签动画', () => findAll(root, (node) => node.tagName === 'video').length === 1);
  const videoNode = findAll(root, (node) => node.tagName === 'video')[0];
  videoNode.listeners.ended[0]();
  await until('卡面', () => isRevealed(root));
  return videoNode;
}

// ----------------------------------------------------------------- 内置模式

{
  const dir = join(packageDir, '.tmp-test', 'smoke-builtin');
  const { ctx, deps } = mountPanel(dir, 'builtin');
  await bundle.panels.now.mount(ctx);
  const today = deps.signFor(TODAY);

  const hasClass = (name) => findAll(ctx.root, (node) => (node.className ?? '').split(/\s+/).includes(name)).length;

  check('首次进入牌是扣着的', ctx.root.textContent.includes('今天的签还扣着'));
  check('顶部有那段引言', ctx.root.textContent.includes('轻盈的停顿'));
  check('扣着的时候有「封」印', hasClass('om-seal-mark') === 1 && hasClass('om-sealed') === 1);
  check('封着的时候不收束（还没签可对上）', !ctx.root.textContent.includes('刚好对上此刻的心情'));
  const drawButton = byText(ctx.root, '抽今天的签');
  check('扣着的时候有「抽今天的签」按钮', Boolean(drawButton));

  drawButton.listeners.click[0]();
  await until('抽签动画', () => findAll(ctx.root, (node) => node.tagName === 'video').length === 1);
  const videoNode = findAll(ctx.root, (node) => node.tagName === 'video')[0];
  check('抽签先播动画：出现 video 且用 blob 地址', videoNode.src === 'blob:fake');
  check('动画默认静音（否则浏览器不给自动播）', videoNode.muted === true);
  videoNode.listeners.ended[0]();
  await until('卡面', () => isRevealed(ctx.root));
  check('播完之后 video 被移除', findAll(ctx.root, (node) => node.tagName === 'video').length === 0);
  check('拿到的就是包里那个 mp4', readFileSync(join(packageDir, 'assets/draw.mp4')).length > 100_000);

  check('翻开后有这一天的签文', ctx.root.textContent.includes(today.poem), today.poem);
  check('翻开后有这一天的解语', ctx.root.textContent.includes(today.gloss), today.gloss);
  check('牌面写的是第几签、多少分', ctx.root.textContent.includes(`第 ${today.lot} 签`) && ctx.root.textContent.includes(`${today.score} 分`));
  check('翻开后去掉扣着的那句', !ctx.root.textContent.includes('今天的签还扣着'));
  check('牌面有宜、忌', ['宜', '忌'].every((word) => ctx.root.textContent.includes(word)));
  check('牌面有节气与月相那一行', ctx.root.textContent.includes('月相·'));
  check('牌面有详批', ctx.root.textContent.includes('详批：'));
  check('牌面有六项运势星级', findAll(ctx.root, (n) => (n.className ?? '') === 'om-star').length === 6);
  check('六个星条都画了 5 格', findAll(ctx.root, (n) => (n.className ?? '') === 'om-star-v').every((n) => n.textContent.length === 5));
  check('幸运四项并成一行', findAll(ctx.root, (n) => (n.className ?? '') === 'om-lucky').length === 1);
  check('牌面带免责说明', ctx.root.textContent.includes('相信科学，仅供娱乐参考。'));
  check('牌底有收束句', ctx.root.textContent.includes('刚好对上此刻的心情'));
  const isChip = (node) => node.tagName === 'button' && /^om-chip(\s|$)/.test(node.className);
  check('七天都画出来了', findAll(ctx.root, isChip).length === 7);
  check('翻开标记写进了 memo', ctx.memo.get('drawn', false) === true);
  check('翻开后引言还在', ctx.root.textContent.includes('轻盈的停顿'));
  check('翻开后「封」印消失', hasClass('om-seal-mark') === 0);
  check('刚抽出来的那张带动画钩子 om-reveal', hasClass('om-reveal') === 1);

  // 再点「再看一眼」不该重复播动画：钩子只在抽出来那一次
  const againButton = byText(ctx.root, '再看一眼');
  againButton.listeners.click[0]();
  await until('重绘', () => hasClass('om-reveal') === 0);
  check('重看一次不带动画钩子', hasClass('om-reveal') === 0);

  const chips = findAll(ctx.root, isChip);
  const target = chips.find((chip) => chip.textContent.includes('11-20'));
  check('找得到 11-20 那一格', Boolean(target));
  target.listeners.click[0]();
  await until('回看', () => ctx.root.textContent.includes('回看'));

  check('回看时牌面标出来源日期', ctx.root.textContent.includes('2026-11-20'));
  const back = byText(ctx.root, '回到今天');
  check('回看时给「回到今天」', Boolean(back));

  back.listeners.click[0]();
  await until('回到今天', () => !byText(ctx.root, '回到今天'));
  check('回到今天后日期是当天', ctx.root.textContent.includes(TODAY));
}

// ----------------------------------------------------------------- pet 模式

{
  const dir = join(packageDir, '.tmp-test', 'smoke-pet');
  const { ctx } = mountPanel(dir, 'pet');
  await bundle.panels.now.mount(ctx);
  await drawAndWait(ctx.root);

  check('没写时提示去对话里问', ctx.root.textContent.includes('桌宠还没写这一签'));
  check('没写时列出这一档的分寸', ctx.root.textContent.includes('这一档的分寸'));
  check('没写时列出可用意象', ctx.root.textContent.includes('可用的意象'));

  saveWording(dir, TODAY, '檐下站一会儿，等雨小些再走。', '今天不必赶，把想做的排一件就够。', '2026-11-23T09:00:00+08:00');
  // 重新挂一次面板（不清目录）：牌子应该直接是已写的那段。
  const second = mountPanel(dir, 'pet', { fresh: false });
  await bundle.panels.now.mount(second.ctx);
  await drawAndWait(second.ctx.root);
  check('写过之后牌面是原文', second.ctx.root.textContent.includes('檐下站一会儿，等雨小些再走。'));
  check('桌宠写的解签也显示出来', second.ctx.root.textContent.includes('今天不必赶，把想做的排一件就够。'));
  check('写过之后不再提示去对话里问', !second.ctx.root.textContent.includes('桌宠还没写这一签'));
}

// ----------------------------------------------------------------- 没有动画也不能卡住

{
  const dir = join(packageDir, '.tmp-test', 'smoke-novideo');
  const { ctx } = mountPanel(dir, 'builtin', { video: false });
  await bundle.panels.now.mount(ctx);
  byText(ctx.root, '抽今天的签').listeners.click[0]();
  await until('无动画也能揭晓', () => isRevealed(ctx.root));
  check('没有动画素材时直接揭晓，不留空档', findAll(ctx.root, (node) => node.tagName === 'video').length === 0);
}

// ----------------------------------------------------------------- 失败路径

{
  const broken = mountPanel(join(packageDir, '.tmp-test', 'smoke-broken'), 'builtin');
  const ctx = { ...broken.ctx, invoke: async () => { throw new Error('服务端不理人'); } };
  await bundle.panels.now.mount(ctx);
  byText(ctx.root, '抽今天的签').listeners.click[0]();
  await until('错误卡', () => ctx.root.textContent.includes('没抽成'));
  check('服务端报错时给出可重试的失败卡', ctx.root.textContent.includes('服务端不理人'));
}

console.log('');
if (failures.length > 0) {
  console.log(`FAILED ${failures.length}: ${failures.join(' / ')}`);
  process.exitCode = 1;
} else {
  console.log('panel smoke: all checks passed');
}

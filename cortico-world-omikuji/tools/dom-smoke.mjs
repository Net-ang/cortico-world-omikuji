/**
 * 面板的假 DOM 冒烟测试。
 *
 * 沙箱里截不了图，但可以在 Node 里给一个够用的 document 桩，把**真的**客户端
 * （dist/webui.js）+ **真的**服务端（src/panel.ts）跑一遍：翻牌、看七天、回看、回今天。
 *
 *   node --experimental-transform-types tools/dom-smoke.mjs
 */
import { mkdirSync, rmSync } from 'node:fs';
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
  }
  set textContent(v) {
    this.own = v == null ? '' : String(v);
    this.children = [];
  }
  get textContent() {
    return this.own + this.children.map((child) => child.textContent).join('');
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
    this.own = '';
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
}

globalThis.document = { createElement: (tag) => new FakeNode(tag) };

/** 深度优先找出所有满足条件的节点。 */
function findAll(node, test) {
  const hits = [];
  if (test(node)) hits.push(node);
  for (const child of node.children ?? []) hits.push(...findAll(child, test));
  return hits;
}
const buttons = (root) => findAll(root, (node) => node.tagName === 'button');
const byText = (root, exact) => findAll(root, (node) => node.textContent === exact)[0];

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

function mountPanel(dir, mode, { fresh = true } = {}) {
  if (fresh) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const world = new OmikujiWorld({ cfg: { enabled: true, salt: SALT, wording: mode }, timezone: 'Asia/Shanghai', dataDir: dir, content });
  const deps = {
    mode,
    dataDir: dir,
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
  };
  return { ctx, world, deps };
}

// ----------------------------------------------------------------- 内置模式

{
  const dir = join(packageDir, '.tmp-test', 'smoke-builtin');
  const { ctx, deps } = mountPanel(dir, 'builtin');
  await bundle.panels.now.mount(ctx);
  const today = deps.signFor(TODAY);

  check('首次进入牌是扣着的', ctx.root.textContent.includes('今天的签还扣着'));
  const drawButton = byText(ctx.root, '抽今天的签');
  check('扣着的时候有「抽今天的签」按钮', Boolean(drawButton));

  drawButton.listeners.click[0]();
  await until('卡面', () => ctx.root.textContent.includes('幸运色'));

  check('翻开后有这一天的签文', ctx.root.textContent.includes(today.poem), today.poem);
  check('翻开后有这一天的解语', ctx.root.textContent.includes(today.gloss), today.gloss);
  check('牌面写的是第几签、多少分', ctx.root.textContent.includes(`第 ${today.lot} 签`) && ctx.root.textContent.includes(`${today.score} 分`));
  check('翻开后去掉扣着的那句', !ctx.root.textContent.includes('今天的签还扣着'));
  check('牌面有宜、忌、幸运色', ['宜', '忌', '幸运色'].every((word) => ctx.root.textContent.includes(word)));
  check('牌面带免责说明', ctx.root.textContent.includes('相信科学，仅供娱乐参考。'));
  const isChip = (node) => node.tagName === 'button' && /^om-chip(\s|$)/.test(node.className);
  check('七天都画出来了', findAll(ctx.root, isChip).length === 7);
  check('翻开标记写进了 memo', ctx.memo.get('drawn', false) === true);

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
  byText(ctx.root, '抽今天的签').listeners.click[0]();
  await until('pet 卡面', () => ctx.root.textContent.includes('幸运色'));

  check('没写时提示去对话里问', ctx.root.textContent.includes('桌宠还没写这一签'));
  check('没写时列出这一档的分寸', ctx.root.textContent.includes('这一档的分寸'));
  check('没写时列出可用意象', ctx.root.textContent.includes('可用的意象'));

  saveWording(dir, TODAY, '檐下站一会儿，等雨小些再走。', '2026-11-23T09:00:00+08:00');
  // 重新挂一次面板（不清目录）：牌子应该直接是已写的那段。
  const second = mountPanel(dir, 'pet', { fresh: false });
  await bundle.panels.now.mount(second.ctx);
  byText(second.ctx.root, '抽今天的签').listeners.click[0]();
  await until('已写的卡面', () => second.ctx.root.textContent.includes('桌宠写下的这一签'));
  check('写过之后牌面是原文', second.ctx.root.textContent.includes('檐下站一会儿，等雨小些再走。'));
  check('写过之后不再提示去对话里问', !second.ctx.root.textContent.includes('桌宠还没写这一签'));
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

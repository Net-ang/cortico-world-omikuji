import { loadSignContent } from '../src/content.ts';

const content = loadSignContent();

const lens = (xs: readonly string[]) => xs.map((x) => [...x].length);
const stat = (xs: readonly string[]) => {
  const l = lens(xs);
  return `n=${xs.length} 长度 ${Math.min(...l)}–${Math.max(...l)} 字, 均 ${(l.reduce((a, b) => a + b, 0) / l.length).toFixed(1)}`;
};

console.log('=== 每档数量 ===');
for (const t of content.tiers) {
  console.log(`${t.label.padEnd(4)} ${String(t.min).padStart(3)}-${String(t.max).padStart(3)}  签文 ${t.poems.length}  解语 ${t.glosses.length}  | 签文${stat(t.poems)} | 解语${stat(t.glosses)}`);
}

const allPoems = content.tiers.flatMap((t) => t.poems.map((p) => [t.label, p] as const));
const allGloss = content.tiers.flatMap((t) => t.glosses.map((g) => [t.label, g] as const));

const dup = (rows: ReadonlyArray<readonly [string, string]>) => {
  const seen = new Map<string, string[]>();
  for (const [tier, text] of rows) seen.set(text, [...(seen.get(text) ?? []), tier]);
  return [...seen].filter(([, tiers]) => tiers.length > 1);
};
const dupPoems = dup(allPoems);
const dupGloss = dup(allGloss);
console.log(`\n重复签文: ${dupPoems.length}  重复解语: ${dupGloss.length}`);

console.log(`\n=== 池子 ===`);
console.log(`宜 ${content.yi.length} 条 | ${stat(content.yi)} 重复 ${content.yi.length - new Set(content.yi).size}`);
console.log(`忌 ${content.ji.length} 条 | ${stat(content.ji)} 重复 ${content.ji.length - new Set(content.ji).size}`);
const both = content.yi.filter((x) => content.ji.includes(x));
console.log(`宜忌同句（会迫使重抽）: ${both.length}${both.length ? ' -> ' + both.join(', ') : ''}`);
console.log(`幸运色 ${content.colors.length} 种 | 重复 ${content.colors.length - new Set(content.colors).size}`);

console.log(`\n=== 全文列举 ===`);
for (const t of content.tiers) {
  console.log(`\n【${t.label}】`);
  t.poems.forEach((p, i) => console.log(`  签文${i + 1} ${p}`));
  t.glosses.forEach((g, i) => console.log(`  解语${i + 1} ${g}`));
}

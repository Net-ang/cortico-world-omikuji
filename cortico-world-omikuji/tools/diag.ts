import { loadSignContent } from '../src/content.ts';
import { drawSign } from '../src/daily.ts';

const content = loadSignContent();

function dates(n: number): string[] {
  const base = Date.UTC(2000, 0, 1);
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

const list = dates(20000);
const pairs: Array<[string, string]> = [
  ['a1b2c3d4e5f60718', 'ffffffffffffffff'],
  ['0000000000000000', '1111111111111111'],
  ['deadbeefdeadbeef', 'cafebabecafebabe'],
];

const expected = list.length / 101;
for (const [a, b] of pairs) {
  let same = 0;
  for (const d of list) {
    if (drawSign(d, a, content).score === drawSign(d, b, content).score) same += 1;
  }
  const sigma = Math.sqrt(expected * (1 - 1 / 101));
  const z = (same - expected) / sigma;
  console.log(`salt ${a} vs ${b}: same score ${same}, expected ${expected.toFixed(1)}, z=${z.toFixed(2)}`);
}

// 对照组：同一支盐自己跟自己（必须 100% 相同），以及盐只差一个字符
let selfSame = 0;
let nearSame = 0;
for (const d of list) {
  if (drawSign(d, pairs[0]![0], content).score === drawSign(d, pairs[0]![0], content).score) selfSame += 1;
  const x = drawSign(d, 'aaaaaaaaaaaaaaa1', content).score;
  const y = drawSign(d, 'aaaaaaaaaaaaaaa2', content).score;
  if (x === y) nearSame += 1;
}
console.log(`self: ${selfSame}/${list.length} (must be 100%)`);
const nearZ = (nearSame - expected) / Math.sqrt(expected * (1 - 1 / 101));
console.log(`salt differing in last char: same score ${nearSame}, expected ${expected.toFixed(1)}, z=${nearZ.toFixed(2)}`);

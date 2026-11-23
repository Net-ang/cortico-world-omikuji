/** 签库的读取与结构校验。签库是纯数据，改它不需要动逻辑。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SignContent, SignTier } from './daily.ts';

const SIGNS_FILE = fileURLToPath(new URL('../data/signs.json', import.meta.url));

/** 签名库的结构校验。 */
export function checkSignContent(content: SignContent): SignContent {
  if (!content.algorithm) throw new Error('signs.json: algorithm is required');
  if (content.tiers.length === 0) throw new Error('signs.json: tiers must not be empty');
  const ordered: SignTier[] = [...content.tiers].sort((a, b) => a.min - b.min);
  let expected = 0;
  for (const tier of ordered) {
    if (tier.min !== expected) {
      throw new Error(`signs.json: tier ${tier.id} starts at ${tier.min}, expected ${expected}`);
    }
    if (tier.max < tier.min) throw new Error(`signs.json: tier ${tier.id} has max < min`);
    if (tier.poems.length === 0) throw new Error(`signs.json: tier ${tier.id} has no poems`);
    if (tier.glosses.length === 0) throw new Error(`signs.json: tier ${tier.id} has no glosses`);
    if (!content.petTones[tier.id]) throw new Error(`signs.json: tier ${tier.id} has no petTone`);
    expected = tier.max + 1;
  }
  if (expected !== 101) throw new Error(`signs.json: tiers cover 0–${expected - 1}, expected 0–100`);
  for (const key of ['yi', 'ji', 'colors', 'images'] as const) {
    if (content[key].length === 0) throw new Error(`signs.json: ${key} must not be empty`);
  }
  return content;
}

export function loadSignContent(): SignContent {
  return checkSignContent(JSON.parse(readFileSync(SIGNS_FILE, 'utf8')) as SignContent);
}

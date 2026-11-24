import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WordingMode } from './daily.ts';

/** config.json 的 worlds.omikuji 段，默认禁用。 */
export interface OmikujiConfigSection {
  enabled: boolean;
  /**
   * 固定的本机盐，现在只当回落用。
   *
   * 每天的签用它当天现摇的随机盐（`omikuji-days.json`，只留七天）；七天以外的日期没有当日盐了，
   * 才回落到这个固定盐去算。留空就用自动生成的那一个。
   */
  salt: string;
  /** 措辞归谁写：`builtin` 用签库成句，`pet` 由桌宠自己写并落盘。 */
  wording: WordingMode;
}

export const OMIKUJI_DEFAULTS: OmikujiConfigSection = {
  // enabled 由 bot 声明决定，扩展自己改这个值不起作用（worldDefaults() 会覆盖）。
  enabled: false,
  salt: '',
  // 默认让桌宠自己写：这份扩展的意义就是「她自己的签」，不是一批共用的句子。
  wording: 'pet',
};

/** `x-options` 的 kind；`definition.configOptions()` 按它给下拉项。 */
export const WORDING_OPTIONS_KIND = 'omikuji.wording';

export const OMIKUJI_CONFIG_GROUP: ConfigGroup = {
  id: 'world:omikuji',
  owner: 'world:omikuji',
  schema: {
    type: 'object',
    title: '精灵日签',
    properties: {
      'worlds.omikuji.wording': {
        type: 'string',
        title: '措辞由谁写',
        description: '默认由桌宠自己写：只给它分数、档位与写作约束，当天首次写下的正文会被保存并复用。切成「内置文案」则直接用签库成句，不花模型。',
        'x-options': WORDING_OPTIONS_KIND,
        'x-hot': true,
      },
      'worlds.omikuji.salt': {
        type: 'string',
        title: '固定本机盐（回落用）',
        description: '每天的签用当天现摇的随机盐（只留七天）；七天以外的日期才回落到这个固定盐。留空用自动生成的那一个。',
        'x-hot': true,
      },
    },
  },
};

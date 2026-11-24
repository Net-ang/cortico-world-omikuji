import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WordingMode } from './daily.ts';

/** 面板字体族。值只是「选哪一种」，真正的 font-family 栈在 dist/webui.css 里。 */
export type TextFont = 'kai' | 'hand' | 'song' | 'li' | 'hei' | 'round' | 'wenkai';

/** config.json 的 worlds.omikuji 段，默认禁用。 */
export interface OmikujiConfigSection {
  enabled: boolean;
  /**
   * 固定的本机盐，现在只当回落用。
   *
   * 每天的签用当天现摇的随机盐（`omikuji-days.json`，只留七天）；七天以外的日期没有当日盐了，
   * 才回落到这个固定盐去算。留空就用自动生成的那一个。
   */
  salt: string;
  /** 措辞归谁写：`builtin` 用签库成句，`pet` 由桌宠自己写并落盘。 */
  wording: WordingMode;
  /**
   * 面板字体。
   *
   * 字号、字重、斜体不开放给用户：那是排版决定，写在 dist/webui.css 里。
   */
  fontFamily: TextFont;
}

export const OMIKUJI_DEFAULTS: OmikujiConfigSection = {
  // enabled 由 bot 声明决定，扩展自己改这个值不起作用（worldDefaults() 会覆盖）。
  enabled: false,
  salt: '',
  // 默认让桌宠自己写：这份扩展的意义是「她自己的签」，不是一批共用的句子。
  wording: 'pet',
  // 楷体：有手写的笔意，又不至于像行书那样难读。
  fontFamily: 'kai',
};

/** `x-options` 的 kind；`definition.configOptions()` 按它给下拉项。 */
export const WORDING_OPTIONS_KIND = 'omikuji.wording';
export const FONT_OPTIONS_KIND = 'omikuji.font';

/** 字体名 → 中英文标签。栈在 CSS 里，这里只给下拉项。 */
export const FONT_LABELS: Readonly<Record<TextFont, { zh: string; en: string }>> = {
  kai: { zh: '楷体（默认，有笔意）', en: 'Kai (brush-ish, default)' },
  hand: { zh: '手写（方正舒体 / 行楷）', en: 'Handwriting (Shuti / Xingkai)' },
  song: { zh: '宋体（印刷感）', en: 'Song / serif' },
  li: { zh: '隶书（古意）', en: 'Clerical script' },
  hei: { zh: '黑体（清爽）', en: 'Hei / sans' },
  round: { zh: '圆体（软）', en: 'Round' },
  wenkai: { zh: '霞鹜文楷（联网加载，跨机器一致）', en: 'LXGW WenKai (loaded from CDN)' },
};

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
      'worlds.omikuji.fontFamily': {
        type: 'string',
        title: '字体',
        description: '按名字引用本机字体：手写体走方正舒体 / 华文行楷，没装就退到楷体；「霞鹜文楷」是从 jsdelivr 取的开源字体（OFL），需要联网但跨机器一致。字体文件不随包分发。字号、字重、斜体是排版决定，由扩展自己定，不开放设置。',
        'x-options': FONT_OPTIONS_KIND,
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

import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import type { Language } from 'cortico/core/language.ts';
import { OMIKUJI_DEFAULTS, WORDING_OPTIONS_KIND, type OmikujiConfigSection } from './config.ts';
import { loadSignContent } from './content.ts';
import { OMIKUJI_TOOL_DECLS, OmikujiWorld } from './world.ts';

export const OMIKUJI: WorldDefinition<OmikujiConfigSection> = {
  id: 'omikuji',
  label: '精灵日签',
  defaults: () => ({ ...OMIKUJI_DEFAULTS }),
  configOptions: (kind: string, language: Language) => {
    if (kind !== WORDING_OPTIONS_KIND) return [];
    const chinese = language === 'zh' || language === 'zh-Hant';
    return chinese
      ? [
          { value: 'pet', label: '桌宠自己写' },
          { value: 'builtin', label: '内置文案' },
        ]
      : [
          { value: 'pet', label: 'Written by the pet' },
          { value: 'builtin', label: 'Built-in wording' },
        ];
  },
  create: (ctx) =>
    new OmikujiWorld({
      cfg: ctx.cfg,
      timezone: ctx.timezone,
      dataDir: ctx.dataDir,
      packageDir: ctx.packageDir,
      content: loadSignContent(),
    }),
  describe: {
    tools: describeTools(OMIKUJI_TOOL_DECLS, {
      omikuji_draw: {
        zh: '取某一天的签；不传日期就是今天。同一天在同一台机器上永远是同一张。',
        en: "Returns the slip for a date, today by default. The same date is the same slip on this machine.",
      },
      omikuji_record: {
        zh: '把桌宠自己写好的那一签记下来；同一天只认第一份。',
        en: 'Stores the slip the pet wrote; the first text for a date is the one kept.',
      },
    }),
    events: [
      {
        type: 'omikuji.started',
        description: { zh: 'World 挂载完成，附今天这一签的档位与分数。', en: "The World was mounted, with today's grade and score." },
      },
    ],
  },
};

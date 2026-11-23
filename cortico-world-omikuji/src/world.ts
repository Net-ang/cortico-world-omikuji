/** 精灵日签：每天一张签。措辞可以来自签库，也可以由桌宠自己写并落盘。 */
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolSpec, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { nowIso } from 'cortico/core/util.ts';
import {
  asWordingMode,
  drawSign,
  formatBrief,
  formatHint,
  formatSign,
  isDateIso,
  type DailySign,
  type SignContent,
  type WordingMode,
} from './daily.ts';
import { ensureSalt } from './salt.ts';
import { readWording, saveWording } from './wording.ts';
import { panelInvoke, PANEL_ID, type PanelDeps } from './panel.ts';
import type { OmikujiConfigSection } from './config.ts';
import { OMIKUJI_CONFIG_GROUP } from './config.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

export const OMIKUJI_TOOL_DECLS: readonly ToolSpec[] = [
  {
    name: 'omikuji_draw',
    description:
      "Draw the daily fortune slip. With no arguments it returns today's slip; pass date (YYYY-MM-DD) to read the slip of another day. The slip for a date is fixed on this machine, so drawing it again never changes it. In built-in wording mode the reply is the finished slip: lot number, grade, score, verse, reading, what to favour, what to avoid and a lucky colour. In pet wording mode the reply is the facts plus writing constraints instead, and omikuji_record stores the slip you write.",
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        date: {
          type: 'string',
          description: 'Calendar date in YYYY-MM-DD. Omit for today in the deployment timezone.',
        },
      },
      required: [],
    },
  },
  {
    name: 'omikuji_record',
    description:
      'Store the slip you wrote for a date, in pet wording mode only. The first text stored for a date is kept and every later draw returns it unchanged, so record once and do not rewrite it. Returns the stored text.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: 'The slip itself: two short lines, 14–18 characters in total, no predictions stated as fact.',
        },
        date: {
          type: 'string',
          description: 'Calendar date in YYYY-MM-DD. Omit for today in the deployment timezone.',
        },
      },
      required: ['text'],
    },
  },
];

export interface OmikujiWorldOptions {
  /** `worlds.omikuji` 的活引用。 */
  cfg: OmikujiConfigSection;
  timezone: string;
  dataDir: string;
  content: SignContent;
}

export class OmikujiWorld implements World {
  readonly id = 'omikuji';

  readonly #opts: OmikujiWorldOptions;

  #storedSalt: string | null = null;

  // 不用参数属性：本包在只有类型剥离、没有完整转译的环境里也能直接跑工具与预览。
  constructor(opts: OmikujiWorldOptions) {
    this.#opts = opts;
  }

  /** 只报值；提示词正文来自 ENV_PROMPT.md。 */
  envPromptVars(): Record<string, string> | null {
    try {
      const wording = this.wording();
      return {
        'omikuji.hint': formatHint(this.signFor(), wording),
        'omikuji.mode':
          wording === 'pet'
            ? 'Wording: written by you. omikuji_draw returns facts and constraints; compose the slip and call omikuji_record so the rest of the day uses your text.'
            : 'Wording: built-in. omikuji_draw returns the finished slip; use it as written and do not rewrite the verse.',
      };
    } catch {
      // 签库或数据目录出问题时不能把每一轮前缀都搞坏；工具调用会照常报错。
      return null;
    }
  }

  tools(): ToolDef[] {
    const draw: ToolDef = {
      ...OMIKUJI_TOOL_DECLS[0]!,
      handler: async (args) => {
        const date = args.date;
        if (date !== undefined && typeof date !== 'string') {
          throw new TypeError('date must be a YYYY-MM-DD string');
        }
        const sign = this.signFor(date);
        if (this.wording() === 'builtin') return formatSign(sign);
        const stored = readWording(this.#opts.dataDir, sign.date);
        if (stored) {
          return `${stored.text}\n\n（${sign.date} 已记下的措辞。第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分）`;
        }
        return formatBrief(sign);
      },
    };
    if (this.wording() !== 'pet') return [draw];

    const record: ToolDef = {
      ...OMIKUJI_TOOL_DECLS[1]!,
      handler: async (args) => {
        const text = args.text;
        if (typeof text !== 'string') throw new TypeError('text must be a string');
        const date = args.date;
        if (date !== undefined && typeof date !== 'string') {
          throw new TypeError('date must be a YYYY-MM-DD string');
        }
        const sign = this.signFor(date);
        const { record: stored, kept } = saveWording(
          this.#opts.dataDir,
          sign.date,
          text,
          nowIso(this.#opts.timezone),
        );
        const head = kept
          ? `${sign.date} 已经记下了另一份正文，保留的是先写下的那份：`
          : `已记下 ${sign.date} 的措辞：`;
        return `${head}\n\n${stored.text}`;
      },
    };
    return [draw, record];
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const chinese = language === 'zh' || language === 'zh-Hant';
    const petMode = this.wording() === 'pet';
    return {
      label: chinese ? '精灵日签' : 'Daily Omikuji',
      badges: [
        {
          label: chinese ? '措辞' : 'Wording',
          value: petMode ? (chinese ? '桌宠写' : 'pet') : chinese ? '内置' : 'built-in',
          tone: petMode ? 'plain' : 'off',
        },
      ],
      panels: [
        {
          id: PANEL_ID,
          title: chinese ? '今日一签' : "Today's slip",
          description: chinese ? '按下按钮抽今天的签，顺带看这七天。' : "Press the button for today's slip, and the last seven days.",
        },
      ],
      invoke: (panel, method, args) => panelInvoke(this.#panelDeps(), panel, method, [...args]),
      config: [OMIKUJI_CONFIG_GROUP],
      promptDocs: [
        {
          key: 'worlds.omikuji.envPrompt',
          title: chinese ? '精灵日签 · 环境提示词' : 'Daily Omikuji · Environment prompt',
          description: chinese ? '今天的签与调用约定。' : "Today's slip and when to draw it.",
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'omikuji.hint', description: chinese ? '今天这一签的档位与分数。' : "Today's grade and score." },
            { name: 'omikuji.mode', description: chinese ? '措辞由谁写。' : 'Who writes the wording.' },
          ],
        },
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    const sign = this.signFor();
    await host.pushEvent({
      type: 'omikuji.started',
      ts: nowIso(this.#opts.timezone),
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      text: `精灵日签已挂载。今天是第 ${sign.lot} 签，${sign.tierLabel}（${sign.score} 分）。`,
    });
  }

  async stop(): Promise<void> {}

  /** 指定日期的签；不传日期就是部署时区里的今天。 */
  signFor(date?: string): DailySign {
    const target = date ?? this.#today();
    if (!isDateIso(target)) throw new RangeError(`date must be YYYY-MM-DD, got ${JSON.stringify(target)}`);
    return drawSign(target, this.#salt(), this.#opts.content);
  }

  /** 现读配置：改了措辞模式或盐，下一次调用就生效。 */
  wording(): WordingMode {
    return asWordingMode(this.#opts.cfg.wording);
  }

  /** 面板用的依赖；面板只读，签名与盐都从当天现读。 */
  #panelDeps(): PanelDeps {
    return {
      mode: this.wording(),
      dataDir: this.#opts.dataDir,
      today: this.#today(),
      signFor: (date: string) => this.signFor(date),
    };
  }

  #today(): string {
    return nowIso(this.#opts.timezone).slice(0, 10);
  }

  /** 配置里填了就用填的，否则用落盘的本机盐。 */
  #salt(): string {
    const override = (this.#opts.cfg.salt ?? '').trim();
    if (override) return override;
    this.#storedSalt ??= ensureSalt(this.#opts.dataDir, nowIso(this.#opts.timezone));
    return this.#storedSalt;
  }
}

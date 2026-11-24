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
import { materializeDaySalt, readDaySalt } from './daysalt.ts';
import { readWording, saveWording } from './wording.ts';
import { panelInvoke, PANEL_ID, type PanelDeps, type PanelText } from './panel.ts';
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
      'Store the slip you wrote for a date, in pet wording mode only: the verse and, optionally, your own reading of it. The first record for a date is kept and every later draw returns it unchanged, so record once and do not rewrite it. Returns what was stored.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: 'The verse: two short lines, 14–18 characters in total, no predictions stated as fact.',
        },
        reading: {
          type: 'string',
          description:
            'Your reading of the slip: two or three sentences, 40–120 characters, about how to spend the day — what to do and what not to do. Do not restate the star numbers and do not turn it into a prediction.',
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
  /** 包目录：面板的抽签动画素材在包内。 */
  packageDir: string;
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
        // 真抽签才摇当天的盐；读（前缀、面板打开、回看）都不摇。
        const sign = this.drawFor(date);
        if (this.wording() === 'builtin') return formatSign(sign);
        const stored = readWording(this.#opts.dataDir, sign.date);
        if (stored) {
          const footer = `（${sign.date} 已记下的那份。第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分）`;
          return stored.reading ? `${stored.text}\n\n${stored.reading}\n\n${footer}` : `${stored.text}\n\n${footer}`;
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
        const reading = args.reading;
        if (reading !== undefined && typeof reading !== 'string') throw new TypeError('reading must be a string');
        const date = args.date;
        if (date !== undefined && typeof date !== 'string') {
          throw new TypeError('date must be a YYYY-MM-DD string');
        }
        const sign = this.signFor(date);
        const { record: stored, kept } = saveWording(
          this.#opts.dataDir,
          sign.date,
          text,
          reading,
          nowIso(this.#opts.timezone),
        );
        const head = kept
          ? `${sign.date} 已经记下了另一份，保留的是先写下的那份：`
          : `已记下 ${sign.date} 的签文与解签：`;
        return stored.reading ? `${head}\n\n${stored.text}\n\n${stored.reading}` : `${head}\n\n${stored.text}`;
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

  /**
   * 读某一天的签，**不产生随机、不写盘**。
   *
   * 那天抽过（有当日盐）就是当时那张；没抽过就按固定本机盐算——等同于旧版的「日期 + 固定盐」。
   */
  signFor(date?: string): DailySign {
    const target = this.#resolveDate(date);
    return drawSign(target, this.#saltFor(target, { create: false }), this.#opts.content);
  }

  /**
   * 真抽签：今天还没有当日盐就现摇一个真随机的并落盘，然后算签。
   *
   * 只有走这条路才会产生随机；系统前缀、面板打开、七天回看都走 `signFor()`。
   * 抽的是别的日子时不摇新盐——那一天的随机性属于那一天真正被抽的时刻。
   */
  drawFor(date?: string): DailySign {
    const target = this.#resolveDate(date);
    return drawSign(target, this.#saltFor(target, { create: true }), this.#opts.content);
  }

  /** 现读配置：改了措辞模式或盐，下一次调用就生效。 */
  wording(): WordingMode {
    return asWordingMode(this.#opts.cfg.wording);
  }

  /** 面板用的依赖；面板只读，抽签由面板的 `draw` 方法显式走 `drawFor`。 */
  #panelDeps(): PanelDeps {
    return {
      mode: this.wording(),
      dataDir: this.#opts.dataDir,
      packageDir: this.#opts.packageDir,
      today: this.#today(),
      signFor: (date: string) => this.signFor(date),
      drawFor: (date: string) => this.drawFor(date),
      text: this.#text(),
    };
  }

  /** 字体现读配置：改完刷新面板即生效。字号与字重不开放，写在 CSS 里。 */
  #text(): PanelText {
    return { font: this.#opts.cfg.fontFamily ?? 'kai' };
  }

  #resolveDate(date?: string): string {
    const target = date ?? this.#today();
    if (!isDateIso(target)) throw new RangeError(`date must be YYYY-MM-DD, got ${JSON.stringify(target)}`);
    return target;
  }

  #today(): string {
    return nowIso(this.#opts.timezone).slice(0, 10);
  }

  /**
   * 某一天的盐。
   *
   * `create: true` 只在真抽签、而且抽的正是**今天**时才摇：那天的随机盐属于「那天抽的那次」，
   * 事后补抽别的日子不产生新随机，按既有规则读（当日盐若有，否则固定本机盐）。
   * 落盘时顺手裁掉七天前的条目。
   */
  #saltFor(date: string, opts: { create: boolean }): string {
    const stored = readDaySalt(this.#opts.dataDir, date);
    if (stored) return stored;
    if (opts.create && date === this.#today()) {
      return materializeDaySalt(this.#opts.dataDir, date, nowIso(this.#opts.timezone)).salt;
    }
    return this.#fixedSalt();
  }

  /** 固定的本机盐：配置填了就用填的，否则用落盘的那一个。它现在只当回落与「两机对齐」用。 */
  #fixedSalt(): string {
    const override = (this.#opts.cfg.salt ?? '').trim();
    if (override) return override;
    this.#storedSalt ??= ensureSalt(this.#opts.dataDir, nowIso(this.#opts.timezone));
    return this.#storedSalt;
  }
}

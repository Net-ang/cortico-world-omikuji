/** 精灵日签：每天一张签。措辞可以来自签库，也可以由桌宠自己写并落盘。 */
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolSpec, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { nowIso } from 'cortico/core/util.ts';
import {
  asWordingMode,
  drawSign,
  ENV_HINT,
  formatBrief,
  formatSign,
  isDateIso,
  type DailySign,
  type SignContent,
  type WordingMode,
} from './daily.ts';
import { ensureSalt } from './salt.ts';
import { lockFallbackDays, materializeDaySalt, readDayRecord } from './daysalt.ts';
import { markReminded, remindedDate } from './remind.ts';
import { markSettled, settledDate } from './settle.ts';
import { daysBefore } from './daysalt.ts';
import { readWording, saveWording } from './wording.ts';
import { panelInvoke, PANEL_ID, type PanelDeps, type PanelText } from './panel.ts';
import type { OmikujiConfigSection } from './config.ts';
import { OMIKUJI_CONFIG_GROUP } from './config.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

/** 巡检间隔；结算与提醒的起始整点（部署时区，含）。 */
const REMIND_INTERVAL_MS = 10 * 60 * 1000;
/** 每天几点结算昨天（裁决时刻）。 */
const SETTLE_HOUR = 7;
/** 每天几点起还没抽签就提醒一次。 */
const REMIND_AFTER_HOUR = 9;

export const OMIKUJI_TOOL_DECLS: readonly ToolSpec[] = [
  {
    name: 'omikuji_draw',
    description:
      "Draw the daily fortune slip. With no arguments it returns today's slip; pass date (YYYY-MM-DD) to read the slip of another day. The slip for a date is fixed on this machine, so drawing it again never changes it. In built-in wording mode the reply is the finished slip: lot number, grade, score, verse, reading, what to favour, what to avoid and a lucky colour. In pet wording mode the reply is the facts plus writing constraints instead, and omikuji_record stores the slip you write. Pass peek: true to find out whether today's slip has been drawn yet without drawing it. Dates later than today are always refused: a future slip does not exist yet, so never quote one.",
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        date: {
          type: 'string',
          description: 'Calendar date in YYYY-MM-DD, today or earlier. Omit for today. A date after today is refused.',
        },
        peek: {
          type: 'boolean',
          description:
            "Only ask about the state: returns whether today's slip exists already, without drawing one. Use it to decide whether to offer a draw.",
        },
      },
      required: [],
    },
  },
  {
    name: 'omikuji_record',
    description:
      'Store the slip you wrote for a date: the verse and, optionally, your own reading of it. The first record for a date is kept and every later draw returns it unchanged, so record once and do not rewrite it. Returns what was stored. A date after today is refused — there is no slip for a day that has not happened. Built-in wording mode keeps its own verses, so the call only answers with a note there.',
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
  /**
   * 取当前时间（带时区偏移的 ISO）。缺省按 `timezone` 读系统时钟。
   *
   * 只给测试用：面板与工具都按「今天」判事，假时钟能让「今天」与测试里的日期对上。
   */
  now?: () => string;
}

export class OmikujiWorld implements World {
  readonly id = 'omikuji';

  readonly #opts: OmikujiWorldOptions;

  #storedSalt: string | null = null;

  /** 挂载期间拿到的宿主句柄；提醒定时器要用它推事件。 */
  #host: WorldHost | null = null;

  /** 「今天还没抽签」的定时器；`stop()` 里清掉。 */
  #reminderTimer: ReturnType<typeof setInterval> | null = null;

  // 不用参数属性：本包在只有类型剥离、没有完整转译的环境里也能直接跑工具与预览。
  constructor(opts: OmikujiWorldOptions) {
    this.#opts = opts;
  }

  /**
   * 只报值；提示词正文来自 ENV_PROMPT.md。
   *
   * **这里只有静态文案，没有今天的分数、也没有措辞模式。** 前缀只在挂载/可见性变化/
   * 手动重载/重启时重建，抽签与改配置都不会让它刷新；写进任何会变的东西，抽完签
   * 就会在模型上下文里留下旧值。分数走工具回执，模式走工具回执里的写法要求。
   */
  envPromptVars(): Record<string, string> | null {
    return { 'omikuji.hint': ENV_HINT };
  }

  /**
   * 两个工具**始终都在**。
   *
   * 早先按措辞模式只挂一个，但工具表跟着系统前缀走，而改配置不会重建前缀——
   * 从「内置」热切到「桌宠自己写」之后，提示词要求它调 `omikuji_record`，
   * 工具表里却没有这个工具。现在恒挂两个：内置模式下调用 `omikuji_record` 会得到
   * 一句说明，而不是「没有这个工具」。
   */
  tools(): ToolDef[] {
    const draw: ToolDef = {
      ...OMIKUJI_TOOL_DECLS[0]!,
      handler: async (args) => {
        const date = args.date;
        if (date !== undefined && typeof date !== 'string') {
          throw new TypeError('date must be a YYYY-MM-DD string');
        }
        const peek = args.peek;
        if (peek !== undefined && typeof peek !== 'boolean') throw new TypeError('peek must be a boolean');

        // 只看状态：读，不摇盐。用来决定要不要开口提醒抽签。
        if (peek) return this.#stateNote(date);

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
        if (this.wording() === 'builtin') {
          const target = this.#resolveDate(date);
          return `${target} 用的是内置文案，签文由签库给，不需要记。要让这一签由你自己写，把配置里的「措辞」切成「桌宠自己写」。`;
        }

        /*
         * 先把这一天的盐摇定，再落盘。
         *
         * 否则会出现「签文记在按固定盐算的那张上，而当天真抽到的却是另一张」——
         * 记下来的句子和牌面对不上。抽签就是定签，写签文之前先定下来。
         */
        const sign = this.drawFor(date);
        const { record: stored, kept } = saveWording(
          this.#opts.dataDir,
          sign.date,
          text,
          reading,
          this.#nowIso(),
        );
        const head = kept
          ? `${sign.date} 已经记下了另一份，保留的是先写下的那份：`
          : `已记下 ${sign.date} 的签文与解签：`;
        return stored.reading ? `${head}\n\n${stored.text}\n\n${stored.reading}` : `${head}\n\n${stored.text}`;
      },
    };

    return [draw, record];
  }

  /**
   * 今天抽没抽的一句话状态（只读）。
   *
   * 今天还没定下来时**不报任何数字**：那时按固定本机盐算出来的只是「现在抽会是什么」，
   * 真抽一次会摇新盐换成另一张，报了就是给模型一个会被打脸的结论。
   * 过去的某天如果没抽过，第二天已经被补录（固定盐定死），报了也不会变。
   */
  #stateNote(date?: string): string {
    const target = this.#resolveDate(date);
    const record = readDayRecord(this.#opts.dataDir, target);
    if (record) {
      const sign = this.signFor(target);
      const how = record.source === 'fallback' ? '（那天没抽，第二天按日期 + 固定盐补录的）' : '';
      return `${target} 已经定下了${how}：第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分。要细节就再调一次 omikuji_draw。`;
    }
    if (target === this.#today()) {
      return `今天（${target}）还没抽签，也就还没有签可报——分数是抽的那一刻才定下来的。要抽就直接说一声，或调 omikuji_draw 抽一张。`;
    }
    return `${target} 没有抽过签；按日期加本机固定盐算是第 ${this.signFor(target).lot} 签，这个结果不会再变（那天当时没抽）。`;
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
            {
              name: 'omikuji.hint',
              description: chinese
                ? '静态约定：一天一签、同机同日恒定、要签就调工具。不含今天的分数（前缀不随抽签刷新）。'
                : "Static note: one slip a day, fixed per machine, call the tool for it. Carries no score, because the prefix does not refresh after a draw.",
            },
          ],
        },
      ],
    };
  }

  /**
   * 挂载：推一条事件告诉它今天的状态，并挂上「今天还没抽」的定时提醒。
   *
   * 事件走 `piggyback`——内部事件的默认 trigger 是 `flush`，那会在每次开机时
   * 立刻唤醒主模型白跑一轮完整上下文。piggyback 只入队，随下一批正常消息捎带。
   *
   * 事件内容分两种：抽过了就报分数（当天的盐已定，这个分数不会再变）；
   * 没抽就只说「还没抽」，一个字都不提分数——抽完会换成另一张。
   */
  async start(host: WorldHost): Promise<void> {
    this.#host = host;
    // 先把「过去了却没抽」的日子补录掉，再判断今天
    this.#sweepUndrawn();
    // 开机时如果已经过了 7 点、今天还没结算过，就把昨天结算掉，并写进挂载事件里
    const settled = this.#settleIfDue();
    const head = readDayRecord(this.#opts.dataDir, this.#today())
      ? this.#drawnNote(this.#today())
      : `精灵日签已挂载。今天（${this.#today()}）还没抽签。`;
    await this.#push(host, 'omikuji.started', settled ? `${head}\n${settled}` : head);
    this.#scheduleReminder();
  }

  async stop(): Promise<void> {
    if (this.#reminderTimer !== null) clearInterval(this.#reminderTimer);
    this.#reminderTimer = null;
    this.#host = null;
  }

  /**
   * 每日结算：**每天早上 7 点**（部署时区）把昨天定下来，并把日子翻到今天。
   *
   * 昨天抽过 → 用当时摇的盐（那张早已定死）；昨天没抽 → 用「日期 + 固定本机盐」补录并冻结。
   * 同一天只做一次（记在 `omikuji-settle.json`），跨零点自动重置。
   *
   * 返回一句给模型看的话；今天已经结算过或还没到 7 点就返回 null。
   * 不做成会唤醒模型的事件：调用方决定是并进挂载事件，还是单独推一条 piggyback。
   */
  #settleIfDue(): string | null {
    try {
      const today = this.#today();
      if (settledDate(this.#opts.dataDir) === today) return null;
      const hour = Number(this.#nowIso().slice(11, 13));
      if (!(hour >= SETTLE_HOUR)) return null;

      this.#sweepUndrawn();                       // 昨天（以及更早没抽的）在这里定下来
      markSettled(this.#opts.dataDir, today);

      const yesterday = daysBefore(today, 2)[0]!;
      const record = readDayRecord(this.#opts.dataDir, yesterday);
      if (!record) return `新的一天（${today}）开始。昨天（${yesterday}）还没有记录。`;
      const sign = this.signFor(yesterday);
      const how = record.source === 'fallback' ? '昨天没抽，按日期 + 固定盐定为' : '昨天的签是';
      return `新的一天（${today}）开始。${how}：第 ${sign.lot} 签 · ${sign.tierLabel} · ${sign.score} 分。`;
    } catch {
      return null;
    }
  }

  /**
   * 补录：七天窗口里「已经过去、却没有抽过」的日子，按「日期 + 固定本机盐」定下来。
   *
   * 这是作者定的规则——当天没抽，第二天回头就用固定盐把它生成出来，之后就冻结了。
   * **只在每天 7 点（裁决时刻）之后做**：夜里到早上 7 点之前不补录，那段时间看昨天
   * 仍是「日期 + 固定盐」算出来的同一张（结果一样，只是还没落成记录）。
   * 挂载时与每 10 分钟巡检都会走这里，所以跨零点不用重启。
   *
   * 今天永远不补：今天没抽就是没抽，一个数字都不给。
   */
  #sweepUndrawn(): string[] {
    try {
      // 裁决时刻之前不补录：昨天要等 7 点那一裁决才定下来（夜里看昨天仍按固定盐算，结果一样）
      if (Number(this.#nowIso().slice(11, 13)) < SETTLE_HOUR) return [];
      const locked = lockFallbackDays(this.#opts.dataDir, this.#today(), this.#fixedSalt(), this.#nowIso());
      if (locked.length > 0) {
        this.#host?.log?.info?.(`精灵日签：补录了没抽的日子 ${locked.join('、')}（按日期 + 固定盐）`);
      }
      return locked;
    } catch {
      // 补录失败不影响今天的抽签
      return [];
    }
  }

  /** 抽过的那天报分数：盐已落盘，这张签不会再变。 */
  #drawnNote(date: string): string {
    const sign = this.signFor(date);
    return `精灵日签已挂载。今天是第 ${sign.lot} 签，${sign.tierLabel}（${sign.score} 分）。`;
  }

  /** 推一条内部事件，按 piggyback 入队（不单独唤醒模型）。 */
  async #push(host: WorldHost, type: string, text: string): Promise<void> {
    await host.pushEvent(
      {
        type,
        ts: this.#nowIso(),
        source: this.id,
        origin: 'internal',
        senderKey: this.id,
        text,
      },
      { trigger: 'piggyback' },
    );
  }

  /**
   * 每日巡检：每 10 分钟一拍，按顺序做两件事。
   *
   * 1. **7 点结算**（`#settleIfDue`）：把昨天定下来，并推一条 piggyback 事件告诉模型
   *    「新的一天开始了 + 昨天是什么签」。
   * 2. **9 点后提醒**：今天还没抽签就提一句，一天最多一次。
   *
   * 两次判断都看**当下**状态，所以跨零点不用重启，开机晚了也会立刻补上。
   */
  #scheduleReminder(): void {
    if (this.#reminderTimer !== null) return;
    const tick = () => {
      const host = this.#host;
      if (!host) return;
      try {
        // ① 结算（7 点后，每天一次）
        const settled = this.#settleIfDue();
        if (settled) {
          void this.#push(host, 'omikuji.settled', settled).catch(() => {
            // 推不出去就算了：补录已经落盘，数据是对的
          });
        }

        // ② 提醒（9 点后，每天一次）
        this.#sweepUndrawn();
        const today = this.#today();
        if (readDayRecord(this.#opts.dataDir, today)) return;          // 定下来了
        if (remindedDate(this.#opts.dataDir) === today) return;        // 今天已经提醒过
        const hour = Number(this.#nowIso().slice(11, 13));
        if (!(hour >= REMIND_AFTER_HOUR)) return;                      // 还没到提醒的点
        markReminded(this.#opts.dataDir, today);
        void this.#push(
          host,
          'omikuji.reminder',
          `精灵日签：今天（${today}）还没抽签。他要是这会儿在，可以问一句要不要抽一张。`,
        ).catch(() => {
          // 推不出去就算了，明天再说
        });
      } catch {
        // 提醒失败不影响抽签
      }
    };
    this.#reminderTimer = setInterval(tick, REMIND_INTERVAL_MS);
    // 别让这个定时器把进程拖住不退出
    this.#reminderTimer.unref?.();
    /*
     * 这里**不**立刻跑一次 tick：挂载事件已经说过「今天还没抽签」，
     * 立刻再推一条提醒等于同一批里唠叨两遍。让定时器在下一拍（≤10 分钟）再说。
     */
  }

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

  /**
   * 把日期参数落成一个可用的日期，**并且禁止未来**。
   *
   * 未来的日子还没有到，那一天的真随机盐也还不该存在；要是允许读，桌宠就会用
   * 「日期 + 固定盐」算出一张明天的签念给用户——等于提前剧透，而且那天真抽签时
   * 还会换成另一张。所以这里是唯一入口，统一挡掉：任何晚于今天的日期直接报错。
   *
   * 今天是允许的（抽签就是给今天摇盐），过去的日子也允许（读或补录）。
   */
  #resolveDate(date?: string): string {
    const target = date ?? this.#today();
    if (!isDateIso(target)) throw new RangeError(`date must be YYYY-MM-DD, got ${JSON.stringify(target)}`);
    const today = this.#today();
    if (target > today) {
      // 拒绝要说人话：模型会照着这条去回应用户，别让它把技术报错念出去
      throw new RangeError(
        `${target} 还没到（今天是 ${today}），抽签也抽不到未来——我没办法穿越到明天去抽签。`
        + '可以俏皮地回一句，比如「我没有办法穿越到明天去抽签呢，可以期待一下，说不定是上上签」，'
        + '但绝不能替那一天编造签文、档位或分数。',
      );
    }
    return target;
  }

  #today(): string {
    return this.#nowIso().slice(0, 10);
  }

  /** 当前时间：测试可注入假时钟，其余时候读系统时钟。 */
  #nowIso(): string {
    return this.#opts.now?.() ?? nowIso(this.#opts.timezone);
  }

  /**
   * 某一天的盐。
   *
   * `create: true` 只在真抽签、而且抽的正是**今天**时才摇：那天的随机盐属于「那天抽的那次」，
   * 事后补抽别的日子不产生新随机，按既有规则读（当日记录若有——抽的或补录的——否则固定本机盐）。
   * 落盘时顺手裁掉七天前的条目。
   */
  #saltFor(date: string, opts: { create: boolean }): string {
    const stored = readDayRecord(this.#opts.dataDir, date);
    if (stored) return stored.salt;
    if (opts.create && date === this.#today()) {
      return materializeDaySalt(this.#opts.dataDir, date, this.#nowIso()).salt;
    }
    return this.#fixedSalt();
  }

  /** 固定的本机盐：配置填了就用填的，否则用落盘的那一个。它现在只当回落与「两机对齐」用。 */
  #fixedSalt(): string {
    const override = (this.#opts.cfg.salt ?? '').trim();
    if (override) return override;
    this.#storedSalt ??= ensureSalt(this.#opts.dataDir, this.#nowIso());
    return this.#storedSalt;
  }
}

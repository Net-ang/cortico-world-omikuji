/**
 * 签面上的历法点缀：节气、月相。
 *
 * 都是近似算法——节气取「常年日期表」，个别年份会差一天；月相用朔望月的平均长度推算。
 * 它们的用途是给签面一点时令感，不承担任何精确性承诺，回执里也不当事实陈述。
 */

export interface SolarTerm {
  /** 节气名，如「小雪」。 */
  name: string;
  /** 这一签处在哪个节气里（最近的、已到的那个）。 */
  since: string;
  /** 距下一个节气还有几天。 */
  untilNext: number;
  nextName: string;
}

export interface MoonPhase {
  /** 月相名，如「残月」。 */
  name: string;
  /** 0–1，0 为朔、0.5 为望。 */
  ratio: number;
  /** 一句时令注解。 */
  note: string;
}

/** 二十四节气：按公历的常年日期（月, 日）。个别年份会差一天，够用。 */
const TERMS: ReadonlyArray<{ name: string; month: number; day: number; note: string }> = [
  { name: '小寒', month: 1, day: 6, note: '最冷的日子刚开始，收着过' },
  { name: '大寒', month: 1, day: 20, note: '冷到头了，再往後就是回暖' },
  { name: '立春', month: 2, day: 4, note: '春天在日历上先到了' },
  { name: '雨水', month: 2, day: 19, note: '土里的东西开始醒' },
  { name: '惊蛰', month: 3, day: 6, note: '动静都多起来' },
  { name: '春分', month: 3, day: 21, note: '昼夜一样长，正好用来平衡' },
  { name: '清明', month: 4, day: 5, note: '天清了，人也该出去走走' },
  { name: '谷雨', month: 4, day: 20, note: '雨水养着刚种下的东西' },
  { name: '立夏', month: 5, day: 6, note: '热起来了，别急着开空调' },
  { name: '小满', month: 5, day: 21, note: '将满未满，留着余地最好' },
  { name: '芒种', month: 6, day: 6, note: '该收的收，该种的种' },
  { name: '夏至', month: 6, day: 21, note: '白昼最长的这一天' },
  { name: '小暑', month: 7, day: 7, note: '热要来了，先备好水' },
  { name: '大暑', month: 7, day: 23, note: '一年里最热的一段' },
  { name: '立秋', month: 8, day: 8, note: '名字先凉下来' },
  { name: '处暑', month: 8, day: 23, note: '暑气开始退场' },
  { name: '白露', month: 9, day: 8, note: '夜里凉了，早上有露水' },
  { name: '秋分', month: 9, day: 23, note: '又是昼夜一样长' },
  { name: '寒露', month: 10, day: 8, note: '露水凉到有点刺人' },
  { name: '霜降', month: 10, day: 23, note: '第一层霜，晚上加件衣服' },
  { name: '立冬', month: 11, day: 7, note: '冬天正式上桌' },
  { name: '小雪', month: 11, day: 22, note: '雪还没积起来，先试试' },
  { name: '大雪', month: 12, day: 7, note: '该积的都积住了' },
  { name: '冬至', month: 12, day: 22, note: '夜最长的一天，光从明天起就多起来' },
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 这一天的节气与距下一个节气的天数。 */
export function solarTermOf(dateIso: string): SolarTerm {
  const matched = ISO.exec(dateIso);
  if (!matched) throw new RangeError(`not a calendar date: ${dateIso}`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const stamp = Date.UTC(year, month - 1, day);

  // 把相邻三年的节气按时间排开，找「最近一个已到的」与「下一个」
  const marks: Array<{ name: string; note: string; time: number }> = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const term of TERMS) marks.push({ name: term.name, note: term.note, time: Date.UTC(y, term.month - 1, term.day) });
  }
  marks.sort((a, b) => a.time - b.time);

  let current = marks[0]!;
  for (const mark of marks) if (mark.time <= stamp) current = mark;
  const next = marks.find((mark) => mark.time > stamp) ?? marks[marks.length - 1]!;

  return {
    name: current.name,
    since: '',
    untilNext: Math.round((next.time - stamp) / 86_400_000),
    nextName: next.name,
  };
}

/** 这一天的月相（近似：朔望月平均 29.53 天，参考新月 2000-01-06 18:14 UTC）。 */
export function moonPhaseOf(dateIso: string): MoonPhase {
  const matched = ISO.exec(dateIso);
  if (!matched) throw new RangeError(`not a calendar date: ${dateIso}`);
  const stamp = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  const SYNODIC = 29.530588853;
  const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
  const days = (stamp - REFERENCE_NEW_MOON) / 86_400_000;
  const ratio = ((days / SYNODIC) % 1 + 1) % 1;

  const phases: ReadonlyArray<{ upTo: number; name: string; note: string }> = [
    { upTo: 0.0625, name: '朔月', note: '看不见的时候，适合起头' },
    { upTo: 0.1875, name: '娥眉月', note: '刚有一点光，别催它' },
    { upTo: 0.3125, name: '上弦月', note: '一半亮着，够用了' },
    { upTo: 0.4375, name: '盈凸月', note: '越来越满，事在往前' },
    { upTo: 0.5625, name: '望月', note: '最亮的一夜，适合被看见' },
    { upTo: 0.6875, name: '亏凸月', note: '开始收，收得慢也没事' },
    { upTo: 0.8125, name: '下弦月', note: '另一半亮着，换个角度看' },
    { upTo: 0.9375, name: '残月', note: '月末收官，适合清理和告别' },
    { upTo: 1, name: '朔月', note: '看不见的时候，适合起头' },
  ];
  const phase = phases.find((entry) => ratio < entry.upTo) ?? phases[phases.length - 1]!;
  return { name: phase.name, ratio, note: phase.note };
}

/**
 * 节气那行的一句话，例如「小雪 · 雪还没积起来，先试试　月相·望月 · 最亮的一夜，适合被看见」。
 *
 * 不报「还有几天到下一个节气」——签面够挤了，那点信息不值得占一行。
 */
export function almanacLine(dateIso: string): string {
  const term = solarTermOf(dateIso);
  const termNote = TERMS.find((entry) => entry.name === term.name)?.note ?? '';
  const moon = moonPhaseOf(dateIso);
  return `${term.name} · ${termNote}　月相·${moon.name} · ${moon.note}`;
}

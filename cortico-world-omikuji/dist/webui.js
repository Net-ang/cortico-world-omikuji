/*
 * 「今日一签」面板。
 *
 * 原生 ES module，不打包：宿主按 URL import 这个文件，浏览器直接跑。
 * 契约只有一条 —— default 导出 { panels: { <panelId>: { mount(ctx) } } }。
 *
 * 这一页只做两件事：翻牌（抽今天的签）和往前看七天。
 * 不引框架，也不在这里写随机：签由服务端按 (日期, 盐) 算，面板只负责画。
 */

const TEXT = {
  zh: {
    title: '今日一签',
    faceLead: '今天的签还扣着。',
    draw: '抽今天的签',
    drawing: '抽签中…',
    again: '再看一眼',
    backToday: '回到今天',
    lookBack: '回看',
    poem: '签文',
    gloss: '解语',
    yi: '宜',
    ji: '忌',
    color: '幸运色',
    writtenBy: '桌宠写下的这一签',
    notYet: '桌宠还没写这一签 —— 在对话里问一句「今日气运」，它会用自己的话念给你。',
    tone: '这一档的分寸',
    images: '可用的意象',
    recent: '这七天',
    writtenMark: '已写',
    disclaimer: '相信科学，仅供娱乐参考。',
    failed: '没抽成',
  },
  en: {
    title: "Today's slip",
    faceLead: 'The slip is still face down.',
    draw: "Draw today's slip",
    drawing: 'Drawing…',
    again: 'Look again',
    backToday: 'Back to today',
    lookBack: 'Earlier',
    poem: 'Verse',
    gloss: 'Reading',
    yi: 'Favour',
    ji: 'Avoid',
    color: 'Lucky colour',
    writtenBy: 'Written by the pet',
    notYet: 'The pet has not written this slip yet. Ask it about today in chat and it will say it in its own words.',
    tone: 'Tone for this grade',
    images: 'Images to use',
    recent: 'Last seven days',
    writtenMark: 'written',
    disclaimer: 'For fun only. Nothing here predicts anything.',
    failed: 'Draw failed',
  },
};

/** 缺的语言读英文；繁体读中文。 */
const text = (language) => (language === 'zh' || language === 'zh-Hant' ? TEXT.zh : TEXT.en);

function el(tag, cls, body) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (body != null) node.textContent = body;
  return node;
}

/** `2026-11-23` → `11-23` */
const shortDate = (date) => date.slice(5);

function factRow(label, value) {
  const row = el('div', 'om-fact');
  row.append(el('span', 'om-fact-k', label), el('span', 'om-fact-v', value));
  return row;
}

export default {
  panels: {
    now: {
      async mount(ctx) {
        const T = text(ctx.language);
        const app = el('div', 'om-app');
        const head = el('header', 'om-head');
        const meta = el('p', 'om-meta', '');
        head.append(el('h1', 'om-title', T.title), meta);
        const stage = el('section', 'om-stage');
        const strip = el('section', 'om-strip');
        const chips = el('div', 'om-chips');
        strip.append(el('p', 'om-strip-title', T.recent), chips);
        app.append(head, stage, strip);
        ctx.root.append(app);

        let snapshot = null;

        const setBusy = (button, busy, idleLabel) => {
          if (!button) return;
          button.disabled = busy;
          button.textContent = busy ? T.drawing : idleLabel;
        };

        const load = async (date, button, idleLabel) => {
          setBusy(button, true, idleLabel);
          try {
            snapshot = await ctx.invoke('snapshot', date ? [date] : []);
            // 今天这一页翻开过就不再扣回去；回看别的日子不动这个标记。
            if (!date) ctx.memo.set('drawn', true);
            render();
          } catch (err) {
            stage.replaceChildren();
            const box = el('div', 'om-face');
            box.append(el('p', 'om-err', `${T.failed}：${err && err.message ? err.message : String(err)}`));
            const retry = el('button', 'om-btn', T.draw);
            retry.type = 'button';
            retry.addEventListener('click', () => void load(date, retry, T.draw), { signal: ctx.signal });
            box.append(retry);
            stage.append(box);
            ctx.memo.set('drawn', false);
          } finally {
            setBusy(button, false, idleLabel);
          }
        };

        const faceDown = () => {
          stage.replaceChildren();
          const box = el('div', 'om-face');
          box.append(el('p', 'om-face-lead', T.faceLead));
          const button = el('button', 'om-btn om-btn-primary', T.draw);
          button.type = 'button';
          button.addEventListener('click', () => void load(undefined, button, T.draw), { signal: ctx.signal });
          box.append(button);
          stage.append(box);
        };

        const renderCard = (s) => {
          const card = el('div', `om-card${s.date === s.today ? '' : ' om-card-past'}`);
          const top = el('div', 'om-card-top');
          top.append(
            el('span', 'om-lot', `第 ${s.sign.lot} 签`),
            el('span', 'om-tier', s.sign.tierLabel),
            el('span', 'om-score', `${s.sign.score} 分`),
          );
          if (s.date !== s.today) top.append(el('span', 'om-tag', `${T.lookBack} ${shortDate(s.date)}`));
          card.append(top);

          const body = el('div', 'om-card-body');
          if (s.mode === 'pet') {
            if (s.written) {
              body.append(el('p', 'om-written', s.written), el('p', 'om-written-by', T.writtenBy));
            } else {
              body.append(el('p', 'om-pending', T.notYet));
              if (s.sign.tone) body.append(factRow(T.tone, s.sign.tone));
              if (s.sign.images.length) body.append(factRow(T.images, s.sign.images.join('、')));
            }
          } else {
            body.append(el('p', 'om-poem', s.sign.poem), el('p', 'om-gloss', s.sign.gloss));
          }
          body.append(
            factRow(T.yi, s.sign.yi),
            factRow(T.ji, s.sign.ji),
            factRow(T.color, s.sign.color),
          );
          card.append(body, el('p', 'om-disclaimer', T.disclaimer));

          const actions = el('div', 'om-actions');
          const again = el('button', 'om-btn', T.again);
          again.type = 'button';
          again.addEventListener('click', () => void load(s.date, again, T.again), { signal: ctx.signal });
          actions.append(again);
          if (s.date !== s.today) {
            const back = el('button', 'om-btn om-btn-primary', T.backToday);
            back.type = 'button';
            back.addEventListener('click', () => void load(undefined, back, T.backToday), { signal: ctx.signal });
            actions.append(back);
          }
          card.append(actions);
          return card;
        };

        const renderChips = (s) => {
          chips.replaceChildren();
          for (const day of s.recent) {
            const chip = el('button', `om-chip${day.date === s.date ? ' om-chip-on' : ''}`);
            chip.type = 'button';
            chip.title = `${day.date} · ${day.tierLabel} · ${day.score} 分`;
            chip.append(
              el('span', 'om-chip-date', shortDate(day.date)),
              el('span', 'om-chip-tier', day.tierLabel),
            );
            if (day.written) chip.append(el('span', 'om-chip-mark', T.writtenMark));
            chip.addEventListener('click', () => void load(day.date, null, null), { signal: ctx.signal });
            chips.append(chip);
          }
        };

        const render = () => {
          const s = snapshot;
          if (!s) return faceDown();
          meta.textContent = s.date === s.today ? s.today : `${s.date} · ${T.lookBack}`;
          stage.replaceChildren(renderCard(s));
          renderChips(s);
          return undefined;
        };

        if (ctx.memo.get('drawn', false)) await load(undefined, null, null);
        else faceDown();
      },
    },
  },
};

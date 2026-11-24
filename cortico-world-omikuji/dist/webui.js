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
    reading: '详批：',
    yi: '宜',
    ji: '忌',
    item: '幸运物',
    number: '幸运数字',
    direction: '幸运方位',
    color: '幸运色',
    lucky: '幸运',
    writtenBy: '桌宠写下的这一签',
    notYet: '桌宠还没写这一签 —— 在对话里问一句「今日气运」，它会用自己的话念给你。',
    tone: '这一档的分寸',
    images: '可用的意象',
    recent: '这七天',
    writtenMark: '已写',
    disclaimer: '相信科学，仅供娱乐参考。',
    failed: '没抽成',
    sealMark: '封',
    blessing: '愿你今天顺手抽到的那一签，刚好对上此刻的心情。',
    intro:
      '在桌宠与世界交汇的日常里，总有些时刻需要一点轻盈的停顿——不需要宏大的占卜，也不必把日子过得像一张排满任务的清单。把每天的签文做成一件随手可翻的小事，像窗边落下的微光，像炉火旁刚好温热的杯盏，陪你在敲字、发呆、等编译或刷屏的间隙，抽一张属于今天的签。',
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
    reading: 'Detail: ',
    yi: 'Favour',
    ji: 'Avoid',
    item: 'Lucky item',
    number: 'Lucky number',
    direction: 'Lucky direction',
    color: 'Lucky colour',
    lucky: 'Lucky',
    writtenBy: 'Written by the pet',
    notYet: 'The pet has not written this slip yet. Ask it about today in chat and it will say it in its own words.',
    tone: 'Tone for this grade',
    images: 'Images to use',
    recent: 'Last seven days',
    writtenMark: 'written',
    disclaimer: 'For fun only. Nothing here predicts anything.',
    failed: 'Draw failed',
    sealMark: 'sealed',
    blessing: 'May the slip you happened to draw today land close to how you feel right now.',
    intro:
      'Some moments in the everyday where the pet and the world meet ask for a light pause — no grand divination, no day lived like a checklist. Make the daily slip a small thing you can turn over in passing: a glimmer by the window, a cup still warm beside the stove. Draw one for today, in the gaps between typing, staring off, waiting for a build, or scrolling.',
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
        const intro = el('p', 'om-intro', T.intro);
        app.append(head, intro, stage, strip);
        ctx.root.append(app);

        let snapshot = null;
        /** 上一次渲染是不是「刚抽出来」——用来只在翻开那一刻挂动画类。 */
        let justDrew = false;

        const setBusy = (button, busy, idleLabel) => {
          if (!button) return;
          button.disabled = busy;
          button.textContent = busy ? T.drawing : idleLabel;
        };

        /*
         * 抽签动画：服务端把包里的 mp4 流式送过来（面板方法 video）。
         * 拿不到、播不完、浏览器不给播，都直接揭晓——动画是点缀，不能挡住签。
         */
        const playDrawAnimation = async () => {
          let url = null;
          let video = null;
          try {
            const blob = await ctx.invokeBinary('video');
            // 服务端没有素材时回的是 JSON，blob 类型就不是视频了
            if (!blob || !/^video\//.test(blob.type ?? '')) return;
            url = window.URL.createObjectURL(blob);
            video = document.createElement('video');
            video.className = 'om-reveal-video';
            video.src = url;
            video.muted = true;          // 静音才会自动播；想在抽签时出声把这里改成 false
            video.playsInline = true;
            video.autoplay = true;
            stage.replaceChildren(video);
            await new Promise((resolve) => {
              let settled = false;
              const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
              };
              video.addEventListener('ended', finish, { once: true });
              video.addEventListener('error', finish, { once: true });
              // 兜底：万一 ended 一直不来，也不能把面板卡在视频上
              ctx.timeout(finish, 8000);
              if (typeof video.play === 'function') Promise.resolve(video.play()).catch(finish);
            });
          } catch {
            // 没有视频或取不到：静默跳过
          } finally {
            if (video && typeof video.remove === 'function') video.remove();
            if (url) window.URL.revokeObjectURL(url);
          }
        };

        /*
         * `draw` 才是抽签：那一天还没有盐就摇一个真随机的出来。
         * 打开面板、看七天、回看某一天都走 `snapshot`，只读，不产生随机。
         */
        const load = async (date, button, idleLabel, method = 'snapshot') => {
          setBusy(button, true, idleLabel);
          try {
            snapshot = await ctx.invoke(method, date ? [date] : []);
            justDrew = method === 'draw';
            // 今天这一页翻开过就不再扣回去；回看别的日子不动这个标记。
            if (method === 'draw' && !date) ctx.memo.set('drawn', true);
            if (method === 'draw') await playDrawAnimation();
            render();
          } catch (err) {
            stage.replaceChildren();
            const box = el('div', 'om-face');
            box.append(el('p', 'om-err', `${T.failed}：${err && err.message ? err.message : String(err)}`));
            const retry = el('button', 'om-btn', T.draw);
            retry.type = 'button';
            retry.addEventListener('click', () => void load(date, retry, T.draw, method), { signal: ctx.signal });
            box.append(retry);
            stage.append(box);
            ctx.memo.set('drawn', false);
          } finally {
            setBusy(button, false, idleLabel);
          }
        };

        const faceDown = () => {
          stage.replaceChildren();
          const box = el('div', 'om-face om-sealed');
          // 封着的印子只是装饰，动画要接的话接在 .om-reveal（见 webui.css）。
          box.append(el('span', 'om-seal-mark', T.sealMark));
          box.append(el('p', 'om-face-lead', T.faceLead));
          const button = el('button', 'om-btn om-btn-primary', T.draw);
          button.type = 'button';
          button.addEventListener('click', () => void load(undefined, button, T.draw, 'draw'), { signal: ctx.signal });
          box.append(button);
          stage.append(box);
        };

        const renderCard = (s) => {
          // 刚抽出来的那一张挂 om-reveal：抽签动画的入口就这一个类，其余状态不带。
          const reveal = justDrew && s.date === s.today ? ' om-reveal' : '';
          const card = el('div', `om-card${s.date === s.today ? '' : ' om-card-past'}${reveal}`);
          const top = el('div', 'om-card-top');
          top.append(
            el('span', 'om-lot', `第 ${s.sign.lot} 签`),
            el('span', 'om-tier', s.sign.tierLabel),
            el('span', 'om-score', `${s.sign.score} 分`),
          );
          if (s.date !== s.today) top.append(el('span', 'om-tag', `${T.lookBack} ${shortDate(s.date)}`));
          card.append(top);

          const body = el('div', 'om-card-body');
          if (s.sign.almanac) body.append(el('p', 'om-almanac', s.sign.almanac));
          if (s.mode === 'pet') {
            if (s.written) {
              body.append(el('p', 'om-written', s.written), el('p', 'om-written-by', T.writtenBy));
              if (s.writtenReading) body.append(el('p', 'om-reading', `${T.reading}　${s.writtenReading}`));
            } else {
              body.append(el('p', 'om-pending', T.notYet));
              if (s.sign.tone) body.append(factRow(T.tone, s.sign.tone));
              if (s.sign.images.length) body.append(factRow(T.images, s.sign.images.join('、')));
            }
          } else {
            body.append(el('p', 'om-poem', s.sign.poem), el('p', 'om-gloss', s.sign.gloss));
            if (s.sign.reading) body.append(el('p', 'om-reading', `${T.reading}　${s.sign.reading}`));
          }

          // 六项运势：两列，星条用实心/空心格
          if (Array.isArray(s.sign.stars) && s.sign.stars.length) {
            const grid = el('div', 'om-stars');
            for (const star of s.sign.stars) {
              const cell = el('div', 'om-star');
              cell.append(
                el('span', 'om-star-k', star.label),
                el('span', 'om-star-v', '★'.repeat(star.stars) + '☆'.repeat(Math.max(0, 5 - star.stars))),
              );
              grid.append(cell);
            }
            body.append(grid);
          }

          body.append(
            factRow(T.yi, s.sign.yi),
            factRow(T.ji, s.sign.ji),
            // 幸运四项并成一行：列出来只会把牌面撑成表格
            el('p', 'om-lucky', `${T.lucky}　${s.sign.luckyItem} · ${s.sign.color} · ${s.sign.luckyNumber} · ${s.sign.luckyDirection}`),
          );
          card.append(
            body,
            el('p', 'om-blessing', T.blessing),
            el('p', 'om-disclaimer', T.disclaimer),
          );

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

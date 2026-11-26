/*
 * 「今日一签」面板。
 *
 * 原生 ES module，不打包：宿主按 URL import 这个文件，浏览器直接跑。
 * 契约只有一条 —— default 导出 { panels: { <panelId>: { mount(ctx) } } }。
 *
 * 这一页只做两件事：翻牌（抽今天的签）和往前看七天。
 * 不引框架，也不在这里写随机：签由服务端按 (日期, 盐) 算，面板只负责画。
 */

/** 面板构建号：页脚里淡淡地写出来，装错/缓存旧版时一眼能看出来。 */
const BUILD = '0.5.4';

const TEXT = {
  zh: {
    title: '今日一签',
    faceLead: '今天的签还扣着。',
    draw: '抽今天的签',
    drawing: '抽签中…',
    again: '再看一眼',
    replaying: '再放一次…',
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
    undrawn: '未抽',
    locked: '当时没抽，按固定盐补录',
    more: '更多…',
    moreText: '过去的事无可挽回，你能做的只有着眼当下和期待未来',
    moreClose: '好',
    // 转运板
    zyTitle: '转运板',
    zyLeadBad: '这一签有点沉。拨开三朵云，把今天扳回来。',
    zyLeadCalm: '今天这一签不凶，用不着转运 —— 想玩也可以玩玩。',
    zyBadge: '逢凶化吉',
    zyHint: '这一签偏凶 —— 去「转运板」把它扳回来。',
    zyTaps: '还剩',
    zyTapsUnit: '次',
    zyAlready: '已经转运成功过',
    zyAgain: '再玩一次',
    zyStart: '开始',
    zyWinTitle: '化吉成功！',
    zyWinBody: '三朵云都拨开了，这一签已经被你扳回来。主面板上会挂一枚金色的「逢凶化吉」。',
    zyWinClose: '好',
    zyLoseTitle: '差一点',
    zyLoseBody: '不要气馁，运气这东西越较真越跑。再来一次就是了。',
    zyLoseRetry: '再来一次',
    zyLoseLater: '先这样',
    zyTileJi: '吉',
    zyTileEmpty: '这里什么也没有',
    zyLegend: '九片里藏着三枚「吉」，五次之内把它们全翻出来。',
    disclaimer: '相信科学，仅供娱乐参考。',
    failed: '没抽成',
    sealMark: '封',
    blessing: '愿你今天顺手抽到的那一签，刚好对上此刻的心情。',
    authorNote: '作者寄语：',
    authorWish: 'wish you a happy day',
    authorWishZh: '（愿你天天开心）',
    intro:
      '在桌宠与世界交汇的日常里，总有些时刻需要一点轻盈的停顿——不需要宏大的占卜，也不必把日子过得像一张排满任务的清单。把每天的签文做成一件随手可翻的小事，像窗边落下的微光，像炉火旁刚好温热的杯盏，陪你在敲字、发呆、等编译或刷屏的间隙，抽一张属于今天的签。',
  },
  en: {
    title: "Today's slip",
    faceLead: 'The slip is still face down.',
    draw: "Draw today's slip",
    drawing: 'Drawing…',
    again: 'Look again',
    replaying: 'Replaying…',
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
    undrawn: 'not drawn',
    locked: 'not drawn that day; filled in from the fixed salt',
    more: 'More…',
    moreText: 'What is past cannot be undone. All that is left to you is to face the present and look forward to what comes.',
    moreClose: 'Close',
    // 转运板
    zyTitle: 'Turn it around',
    zyLeadBad: 'This slip sits heavy. Clear three clouds and turn the day around.',
    zyLeadCalm: "Today's slip is not unlucky — nothing to turn around. Play anyway if you like.",
    zyBadge: 'Turned around',
    zyHint: 'This slip leans unlucky — head to the board and turn it around.',
    zyTaps: 'Taps left',
    zyTapsUnit: '',
    zyAlready: 'Already turned around',
    zyAgain: 'Play again',
    zyStart: 'Start',
    zyWinTitle: 'Turned around!',
    zyWinBody: 'All three clouds are cleared and the slip is yours again. A gold badge now sits on the slip.',
    zyWinClose: 'Nice',
    zyLoseTitle: 'So close',
    zyLoseBody: 'No need to sulk — luck sulks back. Just try again.',
    zyLoseRetry: 'Try again',
    zyLoseLater: 'Later',
    zyTileEmpty: 'nothing here',
    zyLegend: 'Three of the nine hide a 「吉」. Find all three within five taps.',
    disclaimer: 'For fun only. Nothing here predicts anything.',
    failed: 'Draw failed',
    sealMark: 'sealed',
    blessing: 'May the slip you happened to draw today land close to how you feel right now.',
    authorNote: 'A note from the author: ',
    authorWish: 'wish you a happy day',
    authorWishZh: '(愿你天天开心)',
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

        /*
         * 动态背景：包里有 assets/panel-bg.mp4 就铺在整页底下（cover + 压暗遮罩），
         * 没有就什么都不做。它是装饰，取不到也不影响抽签。
         */
        const shell = el('div', 'om-shell');
        const bgLayer = el('div', 'om-bg');
        const app = el('div', 'om-app');
        shell.append(bgLayer, app);
        ctx.root.append(shell);

        const head = el('header', 'om-head');
        const meta = el('p', 'om-meta', '');
        head.append(el('h1', 'om-title', T.title), meta);
        const stage = el('section', 'om-stage');
        const strip = el('section', 'om-strip');
        const chips = el('div', 'om-chips');
        strip.append(el('p', 'om-strip-title', T.recent), chips);
        const intro = el('p', 'om-intro', T.intro);
        // 最底下的落款：头像 + 名字 + 寄语（英文那条用真斜体，中文不斜）
        const foot = el('footer', 'om-foot');
        const avatar = el('img', 'om-avatar');
        avatar.alt = '';
        const footText = el('div', 'om-foot-text');
        const footName = el('p', 'om-foot-name', '奶糖_net');
        const footNote = el('p', 'om-foot-note');
        footNote.append(
          document.createTextNode(T.authorNote),
          el('em', 'om-foot-wish', T.authorWish),
          document.createTextNode(T.authorWishZh),
        );
        footText.append(footName, footNote);
        // 很淡的构建号：排查「我改了怎么没变」用，正常看不到存在感
        const buildTag = el('span', 'om-version', 'v' + BUILD);
        foot.append(avatar, footText, buildTag);
        app.append(head, intro, stage, strip, foot);

        /*
         * 字体：只写 data-font，具体字体栈在 css 里，缺哪个由 CSS 回退。
         * 字号、字重、斜体不开放给用户——那是排版决定，直接写在 css 里。
         */
        let wenkaiLinked = false;
        const applyText = (text) => {
          if (!text) return;
          if (text.font) shell.dataset.font = text.font;
          // 「霞鹜文楷」是本机未必装的开源字体：只有选它时才去 CDN 取样式表
          if (text.font === 'wenkai' && !wenkaiLinked) {
            wenkaiLinked = true;
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css';
            link.addEventListener('error', () => { wenkaiLinked = false; });
            document.head.append(link);
          }
        };

        let avatarStarted = false;
        const startAvatar = async () => {
          if (avatarStarted || !ctx.invokeBinary) return;
          avatarStarted = true;
          try {
            const blob = await ctx.invokeBinary('avatar');
            if (!blob || !/^image\//.test(blob.type ?? '')) { avatarStarted = false; return; }
            const url = window.URL.createObjectURL(blob);
            avatar.src = url;
            if (ctx.signal) ctx.signal.addEventListener('abort', () => window.URL.revokeObjectURL(url), { once: true });
          } catch {
            avatarStarted = false;
          }
        };

        let bgStarted = false;
        const startBackground = async () => {
          if (bgStarted || !ctx.invokeBinary) return;
          bgStarted = true;
          try {
            const blob = await ctx.invokeBinary('background');
            const type = blob?.type ?? '';
            const isVideo = /^video\//.test(type);
            // GIF / WebP 这类动图也是 image/*，浏览器自己会循环，所以两种都收
            if (!blob || !(isVideo || /^image\//.test(type))) return;
            const url = window.URL.createObjectURL(blob);
            const media = document.createElement(isVideo ? 'video' : 'img');
            media.className = isVideo ? 'om-bg-video' : 'om-bg-image';
            media.src = url;
            if (isVideo) {
              media.muted = true;
              media.loop = true;
              media.autoplay = true;
              media.playsInline = true;
            }
            bgLayer.append(media);
            /*
             * 播放失败（解码不支持、被浏览器策略拦、文件坏了）就把节点撤掉，
             * 露出 CSS 里那层暖墨兜底背景——宁可没有动图，也不要一块黑块或灰块。
             */
            media.addEventListener('error', () => {
              media.remove();
              window.URL.revokeObjectURL(url);
            }, { once: true });
            // 面板卸载时释放 blob 地址
            if (ctx.signal) ctx.signal.addEventListener('abort', () => window.URL.revokeObjectURL(url), { once: true });
            if (isVideo && typeof media.play === 'function') Promise.resolve(media.play()).catch(() => {});
          } catch {
            bgStarted = false; // 取不到就算了，下次再试
          }
        };

        let snapshot = null;
        /** 上一次渲染是不是「刚抽出来」——用来只在翻开那一刻挂动画类。 */
        let justDrew = false;

        const setBusy = (button, busy, idleLabel, busyLabel = T.drawing) => {
          if (!button) return;
          button.disabled = busy;
          button.textContent = busy ? busyLabel : idleLabel;
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
         *
         * `animate` 决定要不要再放一遍抽签动画：「抽今天的签」和「再看一眼」都放；
         * 回看别的日子、切页签只读不放。
         */
        const load = async (date, button, idleLabel, method = 'snapshot', animate = method === 'draw') => {
          // 重放动画时别显示「抽签中…」——签没变，只是再看一遍
          setBusy(button, true, idleLabel, animate && method === 'snapshot' ? T.replaying : T.drawing);
          try {
            snapshot = await ctx.invoke(method, date ? [date] : []);
            justDrew = animate;
            // 今天这一页翻开过就不再扣回去；回看别的日子不动这个标记。
            if (method === 'draw' && !date) ctx.memo.set('drawn', true);
            if (animate) await playDrawAnimation();
            render();
          } catch (err) {
            stage.replaceChildren();
            const box = el('div', 'om-face');
            box.append(el('p', 'om-err', `${T.failed}：${err && err.message ? err.message : String(err)}`));
            const retry = el('button', 'om-btn', T.draw);
            retry.type = 'button';
            retry.addEventListener('click', () => void load(date, retry, T.draw, method, animate), { signal: ctx.signal });
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
          /*
           * 凶签：转运成功就挂一枚金色小标签「逢凶化吉」；还没转运就给一句引导，
           * 告诉用户去哪儿把这天的运气扳回来（标签是成就，页名是地方，两者不冲突）。
           */
          if (s.bad) {
            top.append(s.huaji
              ? el('span', 'om-tag om-tag-gold', `✦ ${T.zyBadge}`)
              : el('span', 'om-tag om-tag-hint', T.zyHint));
          }
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
          // 再看一眼 = 把动画重放一遍再看这段话，不是再抽一次（签不会变）
          again.addEventListener('click', () => void load(s.date, again, T.again, 'snapshot', true), { signal: ctx.signal });
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
            // 没定下来的那天（就是今天还没抽）横排上写「未抽」，一个数字都不写
            const provisional = !day.drawn;
            const chip = el('button', `om-chip${day.date === s.date ? ' om-chip-on' : ''}`);
            chip.type = 'button';
            chip.title = provisional
              ? `${day.date} · ${T.undrawn}`
              : `${day.date} · ${day.tierLabel} · ${day.score} 分${day.locked ? ` · ${T.locked}` : ''}`;
            chip.append(
              el('span', 'om-chip-date', shortDate(day.date)),
              el('span', provisional ? 'om-chip-tier om-chip-undrawn' : 'om-chip-tier', provisional ? T.undrawn : day.tierLabel),
            );
            if (day.written) chip.append(el('span', 'om-chip-mark', T.writtenMark));
            chip.addEventListener('click', () => void load(day.date, null, null), { signal: ctx.signal });
            chips.append(chip);
          }
          /*
           * 翻到头了：七天之后没有更多日签可看，只有这一句。
           * 放在最后一个日期后面，点开是一个只有一句话的小弹窗。
           */
          const more = el('button', 'om-chip om-chip-more', T.more);
          more.type = 'button';
          more.addEventListener('click', () => openMore(), { signal: ctx.signal });
          chips.append(more);
        };

        /*
         * 「更多…」的弹窗。
         *
         * 自己搭一层：宿主没有给面板开弹窗的接口，而这一句只是一个收束，不需要交互。
         * 挂在 shell 里（而不是 body），这样能继承 shell 上的色板变量；
         * position: fixed 覆盖整个面板区域，卸载时随 signal 一起收掉。
         */
        let moreLayer = null;
        const closeMore = () => {
          const layer = moreLayer;
          if (!layer) return;
          moreLayer = null;
          if (typeof layer.remove === 'function') layer.remove();
        };
        const openMore = () => {
          if (moreLayer) return;
          const layer = el('div', 'om-more');
          layer.tabIndex = -1; // 让这一层能拿到焦点，Esc 才有地方触发
          if (typeof layer.setAttribute === 'function') {
            layer.setAttribute('role', 'dialog');
            layer.setAttribute('aria-modal', 'true');
            layer.setAttribute('aria-label', T.more);
          }
          const card = el('div', 'om-more-card');
          const text = el('p', 'om-more-text', T.moreText);
          const close = el('button', 'om-btn om-btn-primary', T.moreClose);
          close.type = 'button';
          close.addEventListener('click', closeMore, { signal: ctx.signal });
          card.append(text, close);
          layer.append(card);
          // 点背板关掉；点卡片本身不关
          layer.addEventListener('click', (event) => {
            if (!event || event.target === layer) closeMore();
          }, { signal: ctx.signal });
          // Esc 关掉（焦点落在这一层上，键盘事件才会到这儿）
          layer.addEventListener('keydown', (event) => {
            if (event && event.key === 'Escape') closeMore();
          }, { signal: ctx.signal });
          moreLayer = layer;
          shell.append(layer);
          if (typeof layer.focus === 'function') layer.focus();
        };
        if (ctx.signal) ctx.signal.addEventListener('abort', closeMore, { once: true });

        const render = () => {
          const s = snapshot;
          if (!s) return faceDown();
          // 构建号跟着日期一起显示：确认「现在跑的是哪一版」用
          meta.textContent = (s.date === s.today ? s.today : `${s.date} · ${T.lookBack}`) + ' · v' + BUILD;
          applyText(s.text);
          /*
           * 服务端说这一天还没定下来（`sign` 为 null，只有「今天还没抽」这一种）：
           * 背景、头像、字体、日期、七天横排照常画——这些不必等抽签——但中间只摆一张扣着的牌。
           * 没抽就一个数字都不显示：真抽一次会摇新盐换成另一张，提前显示它才是那个「突变」的来源。
           */
          if (!s.sign) faceDown();
          else stage.replaceChildren(renderCard(s));
          renderChips(s);
          // 快照说包里有背景素材才去取；取一次就够，之后不再重复请求
          if (s.background) void startBackground();
          if (s.avatar) void startAvatar();
          return undefined;
        };

        // 开屏就先取一次快照：背景、头像、字体、七天横排都不必等抽签才出现
        await load(undefined, null, null);
      },
    },
    /*
     * 「转运板」：凶签才用得上的一页。
     *
     * 小游戏 = 九片云里藏着三枚「吉」，五次之内全翻出来。**不限次数**，失败随时重来；
     * 通关就记一笔（服务端只给「已定下来的凶签」记账），主面板会在凶签后面挂一枚
     * 金色「逢凶化吉」。整套就是图一乐，不设失败惩罚、不留记录。
     */
    zhuanyun: {
      async mount(ctx) {
        const T = text(ctx.language);

        const shell = el('div', 'om-shell');
        if (shell.dataset) shell.dataset.page = 'zhuanyun';
        const app = el('div', 'om-app');
        const head = el('header', 'om-head');
        const meta = el('p', 'om-meta', '');
        head.append(el('h1', 'om-title', T.zyTitle), meta);
        const lead = el('p', 'om-intro');
        const stage = el('section', 'om-stage');
        app.append(head, lead, stage);
        shell.append(app);
        ctx.root.append(shell);

        /*
         * 云图案：包里放四朵（assets/cloud-1..4）就轮换着用，只放一张也行。
         * 一张都取不到时退回 CSS 的淡圆环，不会出现破图。
         */
        const CLOUDS = 4;
        const startCloud = async () => {
          if (!ctx.invokeBinary) return;
          let loaded = 0;
          for (let i = 1; i <= CLOUDS; i += 1) {
            try {
              const blob = await ctx.invokeBinary('cloud', [i]);
              if (!blob || !/^image\//.test(blob.type ?? '')) continue;
              const url = window.URL.createObjectURL(blob);
              shell.style.setProperty('--om-cloud-' + i, 'url("' + url + '")');
              if (ctx.signal) ctx.signal.addEventListener('abort', () => window.URL.revokeObjectURL(url), { once: true });
              loaded += 1;
            } catch {
              // 这一朵取不到就用不到，继续下一朵
            }
          }
          if (loaded > 0) shell.dataset.cloud = String(loaded);
        };

        const TILES = 9;
        const HITS = 3;
        const TAPS = 5;

        let status = null;
        let round = 0;        // 第几次尝试
        let tapsUsed = 0;
        let found = 0;
        let hidden = new Set();
        let playing = false;

        /** 一层暗幕弹窗：成功/失败都用它。button 数组给「关掉/再来一次」这类出口。 */
        const showDialog = (title, body, buttons) => {
          const layer = el('div', 'om-more');
          layer.tabIndex = -1;
          const card = el('div', 'om-more-card');
          card.append(el('p', 'om-more-title', title), el('p', 'om-more-text', body));
          const row = el('div', 'om-dialog-actions');
          for (const [label, onClick, primary] of buttons) {
            const button = el('button', primary ? 'om-btn om-btn-primary' : 'om-btn', label);
            button.type = 'button';
            button.addEventListener('click', () => {
              if (typeof layer.remove === 'function') layer.remove();
              if (onClick) onClick();
            }, { signal: ctx.signal });
            row.append(button);
          }
          card.append(row);
          layer.append(card);
          shell.append(layer);
          if (typeof layer.focus === 'function') layer.focus();
        };

        /** 洗一副九格的牌：随机挑三格藏「吉」。客户端随机，跟抽签的种子无关。 */
        const deal = () => {
          const pool = Array.from({ length: TILES }, (_, i) => i);
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          hidden = new Set(pool.slice(0, HITS));
          tapsUsed = 0;
          found = 0;
          playing = true;
        };

        const renderBoard = () => {
          stage.replaceChildren();
          const board = el('div', 'om-board');

          const bar = el('div', 'om-board-bar');
          bar.append(
            el('span', 'om-board-hint', T.zyLegend),
            el('span', 'om-board-taps', `${T.zyTaps} ${TAPS - tapsUsed} ${T.zyTapsUnit}`),
          );
          board.append(bar);

          const grid = el('div', 'om-grid');
          for (let i = 0; i < TILES; i += 1) {
            // 未翻开的格子不放文字：图案由 CSS 的 ::before 画一枚淡圆环
            const tile = el('button', 'om-tile');
            if (tile.dataset) tile.dataset.cloud = String((i % CLOUDS) + 1);
            tile.type = 'button';
            tile.addEventListener('click', () => onTap(i, tile, grid), { signal: ctx.signal });
            grid.append(tile);
          }
          board.append(grid);
          stage.append(board);
        };

        const finishRound = async (won) => {
          playing = false;
          if (won) {
            round += 1;
            try {
              status = await ctx.invoke('win', [status && status.date ? status.date : undefined, round]);
            } catch {
              // 记账失败不影响“通关了”这件事本身
            }
            showDialog(T.zyWinTitle, T.zyWinBody, [[T.zyWinClose, () => void load(), true]]);
            return;
          }
          showDialog(T.zyLoseTitle, T.zyLoseBody, [
            [T.zyLoseRetry, () => { round += 1; deal(); renderBoard(); }, true],
            [T.zyLoseLater, () => void load()],
          ]);
        };

        const onTap = (index, tile, grid) => {
          if (!playing) return;
          if (tile.dataset && tile.dataset.open === '1') return;
          tapsUsed += 1;
          if (tile.dataset) tile.dataset.open = '1';

          if (hidden.has(index)) {
            found += 1;
            tile.className = 'om-tile om-tile-hit';
            tile.textContent = T.zyTileJi;
          } else {
            tile.className = 'om-tile om-tile-miss';
            tile.textContent = T.zyTileEmpty;   // 空格：这里什么都没有
          }

          const left = TAPS - tapsUsed;
          const tapsNode = board_tapsNode(grid);
          if (tapsNode) tapsNode.textContent = `${T.zyTaps} ${left} ${T.zyTapsUnit}`;

          if (found >= HITS) void finishRound(true);
          else if (left <= 0) {
            // 时间到了：把剩下的「吉」亮出来，让人知道差在哪儿
            let i = 0;
            for (const child of grid.children ?? []) {
              if (hidden.has(i) && (!child.dataset || child.dataset.open !== '1')) {
                child.className = 'om-tile om-tile-reveal';
                child.textContent = T.zyTileJi;
              }
              i += 1;
            }
            void finishRound(false);
          }
        };

        /** 从棋盘里找回「还剩几次」那一格。桩环境里没有 closest，只能手找。 */
        const board_tapsNode = (node) => {
          const walk = (current) => {
            if (!current) return null;
            if ((current.className ?? '') === 'om-board-taps') return current;
            for (const child of current.children ?? []) {
              const hit = walk(child);
              if (hit) return hit;
            }
            return null;
          };
          return walk(stage);
        };

        /** 状态 1/2：还没抽签、或者抽到的不是凶签。 */
        const renderCalm = (settled, bad) => {
          stage.replaceChildren();
          const box = el('div', 'om-face');
          if (!settled) {
            box.append(el('p', 'om-face-lead', '今天还没抽签 —— 抽了才知道要不要转运。'));
            box.append(el('p', 'om-hint', '去「今日一签」抽一张，凶的话再回来。'));
            stage.append(box);
            return;
          }
          box.append(el('p', 'om-face-lead', T.zyLeadCalm));
          const free = el('button', 'om-btn', `${T.zyStart}（${T.zyAgain}）`);
          free.type = 'button';
          free.addEventListener('click', () => { deal(); renderBoard(); }, { signal: ctx.signal });
          box.append(free);
          stage.append(box);
        };

        const load = async () => {
          try {
            status = await ctx.invoke('status', []);
          } catch (err) {
            stage.replaceChildren();
            const box = el('div', 'om-face');
            box.append(el('p', 'om-err', `转运板没打开：${err && err.message ? err.message : String(err)}`));
            stage.append(box);
            return;
          }
          const s = status;
          meta.textContent = s.settled ? `${s.date} · ${s.tierLabel} · ${s.score} 分` : s.date;

          if (!s.settled) {
            lead.textContent = '';
            renderCalm(false, false);
            return;
          }
          if (!s.bad) {
            lead.textContent = T.zyLeadCalm;
            renderCalm(true, false);
            return;
          }
          lead.textContent = T.zyLeadBad;
          if (s.done) {
            // 已经转运过：金色标签 + 再玩一次
            stage.replaceChildren();
            const box = el('div', 'om-face');
            const badge = el('p', 'om-badge', `✦ ${T.zyBadge}`);
            box.append(badge);
            box.append(el('p', 'om-face-lead', s.tries ? `${T.zyAlready}（第 ${s.tries} 次）` : T.zyAlready));
            const again = el('button', 'om-btn om-btn-primary', T.zyAgain);
            again.type = 'button';
            again.addEventListener('click', () => { deal(); renderBoard(); }, { signal: ctx.signal });
            box.append(again);
            stage.append(box);
            return;
          }
          deal();
          renderBoard();
        };

        void startCloud();
        await load();
      },
    },
  },
};

(() => {
  const $ = (sel) => document.querySelector(sel);
  const gridEl = $('#categoryGrid');
  const recruitDialog = $('#recruitDialog');
  const recruitNumber = $('#recruitNumber');
  const recruitStatus = $('#recruitStatus');
  const heroAward = $('#hero-award');
  const heroVote = $('#hero-vote');
  const heroList = $('#hero-nominee-list');
  const tabsEl = $('#tabs');
  const unvotedOnly = $('#unvotedOnly');
  const modal = $('#modal');
  const modalBody = $('#modalBody');
  const ballotActions = $('#ballotActions');
  const picker = $('#nomineePicker');
  const pickerDrawer = $('#pickerDrawer');
  const pickerSegments = $('#pickerSegments');
  const drawerToggle = $('#drawerToggle');
  const drawerHint = $('#drawerHint');
  const mobilePicker = matchMedia('(max-width: 767px), (pointer: coarse) and (orientation: landscape) and (max-height: 500px)');
  const modalNotice = $('#modalNotice');
  const modalTitle = $('#modalTitle');
  const modalEn = $('#modalEn');
  const modalTotal = $('#modalTotal');
  const modalHint = $('#modalHint');
  const modalMy = $('#modalMy');

  const toastEl = $('#toast');

  const ui = {
    data: null,
    activeTab: 'all',
    openCategory: null,
    selectedNominee: null,
    confirmingVote: false,
    voteError: '',
    modalTrigger: null,
    awardListScroll: null,
    pendingCardRefresh: false,
    busy: false
  };

  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
  const dailyVoteRule = '每个奖项每日仅限一票';

  /* ---------------- 云服务（WorkBuddy Cloud Service） ---------------- */
  const CLOUD_CONFIG = {
    endpoint: 'https://tga2026-vote.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_RAfiDZV87lfCVLYCIsVx2i_koKqsmoDnjqi8P9mcDNluoNgES5IO3Yc'
  };

  const cloud = (() => {
    try {
      return window.WorkBuddyCloud?.createWorkBuddyCloud
        ? window.WorkBuddyCloud.createWorkBuddyCloud(CLOUD_CONFIG)
        : null;
    } catch {
      return null;
    }
  })();

  const VOTER_KEY = 'tga-voter-id';
  function voterId() {
    try {
      let id = localStorage.getItem(VOTER_KEY);
      if (!id) {
        id = crypto.randomUUID
          ? crypto.randomUUID()
          : 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(VOTER_KEY, id);
      }
      return id;
    } catch {
      return 'v-' + Date.now().toString(36);
    }
  }

  /* 投票日按北京时间零点切分 */
  function voteClockNow() {
    const now = Date.now();
    const beijing = new Date(now + 8 * 3600e3);
    const dayEnd = Date.UTC(
      beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate() + 1
    ) - 8 * 3600e3;
    return { serverNow: now, voteDayEndsAt: dayEnd };
  }

  function summaryOf(payload) {
    if (Array.isArray(payload)) return payload[0] || {};
    return payload || {};
  }

  function applySummaryTo(data, payload) {
    const summary = summaryOf(payload);
    if (!data) return summary;
    data.event.totalVotes = Number(summary.totalVotes || 0);
    data.event.voters = Number(summary.voters || 0);
    const categories = summary.categories || {};
    for (const category of data.categories) {
      category.total = Number(categories[category.id] || 0);
    }
    return summary;
  }

  function categoryTotalOf(summary, categoryId) {
    return Number((summary.categories || {})[categoryId] || 0);
  }

  async function fetchCloudSummary() {
    if (!cloud) throw new Error('cloud-unavailable');
    const { data, error } = await cloud.database.rpc('vote_summary');
    if (error) throw error;
    return summaryOf(data);
  }

  async function fetchMyVotes() {
    if (!cloud) throw new Error('cloud-unavailable');
    const { data, error } = await cloud.database.rpc('my_votes', { p_voter: voterId() });
    if (error) throw error;
    const mine = {};
    for (const row of data || []) mine[row.category_id] = row.nominee_id;
    return mine;
  }


  /* ---------------- 封面图 ---------------- */
  function coverCell(n, extraClass = '') {
    const directory = extraClass === 'ballot-poster' ? '/covers/' : '/covers/previews/';
    const img = n.cover
      ? `<img loading="lazy" alt="${n.name} 封面" src="${directory}${n.id}.jpg" onerror="this.remove()" />`
      : '';
    const format = n.id === 'gta6' ? ' cover-wide' : '';
    const nominee = extraClass === 'cat-cover' ? ` data-cover-nominee="${n.id}"` : '';
    return `<div class="cover-cell ${extraClass}${format}"${nominee}>${img}<span class="cover-fallback" aria-hidden="true"><img class="ui-icon" src="/icons/image-off.svg" alt="" width="24" height="24" /></span></div>`;
  }

  function findCategory(id) {
    return ui.data && ui.data.categories.find((c) => c.id === id);
  }

  function nomineeName(category, id) {
    const n = category.nominees.find((x) => x.id === id);
    return n ? distinctName(category, n) : '';
  }

  /* ---------------- 顶部数据 ---------------- */
  function renderStats() {
    $('#statVotes').textContent = fmt(ui.data.event.totalVotes);
    $('#statVoters').textContent = fmt(ui.data.event.voters);
    $('#statCats').textContent = fmt(ui.data.event.categoryCount);
    $('#tabAllCount').textContent = ui.data.categories.length;
    const resultsOpen = ui.data.event.resultsOpen || ui.data.event.votingClosed;
    $('#resultsLink').hidden = !resultsOpen;
    $('#resultsLocked').hidden = Boolean(resultsOpen);
    if (ui.data.event.votingClosed) {
      $('#resultsAnnouncement').textContent = '溯游票选结果已公布';
      $('#awardProgress').hidden = true;
      $('#categoriesTitle + p').textContent = '本次投票已结束，仍可浏览所有提名。';
      heroVote.textContent = '查看年度最佳提名';
      heroAward.textContent = '查看提名';
    }
  }

  /* ---------------- 卡片 ---------------- */
  const hoverCoverMotion = matchMedia('(width > 680px) and (any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)');
  let hoveredCoverStage;
  let coverRotation;

  function stopCoverRotation() {
    clearInterval(coverRotation);
    hoveredCoverStage = null;
  }

  function startCoverRotation(stage) {
    stopCoverRotation();
    if (!hoverCoverMotion.matches || stage.childElementCount < 2 || document.hidden || modal.open || recruitDialog.open) return;
    hoveredCoverStage = stage;
    coverRotation = setInterval(() => stepAwardCover(stage, 1, false), 1800);
  }

  hoverCoverMotion.addEventListener('change', stopCoverRotation);
  document.addEventListener('visibilitychange', stopCoverRotation);
  window.addEventListener('blur', stopCoverRotation);

  function renderCards() {
    if (modal.open) {
      ui.pendingCardRefresh = true;
      return;
    }
    ui.pendingCardRefresh = false;
    stopCoverRotation();
    const { categories, myVotes, event } = ui.data;
    $('#todayVoteCount').textContent = categories.filter(c => myVotes[c.id]).length + ' / ' + categories.length;
    unvotedOnly.disabled = false;
    const list = categories.filter(c => (ui.activeTab === 'all' || c.tab === ui.activeTab) &&
      (event.votingClosed || !unvotedOnly.checked || !myVotes[c.id]));
    gridEl.innerHTML = list.map((c) => {
      const myVote = ui.data.myVotes[c.id];
      const covers = c.nominees.filter((nominee) => nominee.cover);
      const label = event.votingClosed ? '查看提名' : myVote ? '查看今日投票' : '去投票';
      const shortLabel = event.votingClosed ? '提名' : myVote ? '已投' : '投票';
      return `
        <article class="cat-card" data-id="${c.id}">
          <div class="cat-cover-slider" role="group" aria-label="${c.cn}候选封面">
            ${covers.length > 1 ? `
              <button class="cat-cover-hit cat-cover-prev" type="button" data-cover-step="-1" aria-label="上一张封面"></button>
              <button class="cat-cover-hit cat-cover-next" type="button" data-cover-step="1" aria-label="下一张封面"></button>
              <span class="cat-cover-announcement" role="status"></span>` : ''}
            <div class="cat-cover-stage" data-cover-index="0" aria-hidden="true">${covers.map((nominee) => coverCell(nominee, 'cat-cover')).join('')}</div>
          </div>
          <div class="cat-top">
            <p class="cat-en" lang="en">${c.en}</p>
            <h3 class="cat-cn">${c.cn}</h3>
            <p class="cat-cover-caption"></p>
          </div>
          <button class="ghost-btn card-vote${myVote ? ' is-voted' : ''}" type="button" data-open="${c.id}" aria-haspopup="dialog" aria-label="${label}：${c.cn}">
            <span class="vote-label">${label}</span>
            <span class="vote-label-short">${shortLabel}</span>
            <img class="ui-icon vote-arrow" src="/icons/arrow-up-right.svg" width="19" height="19" alt="" />
            <svg class="vote-ticket" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </button>
        </article>`;
    }).join('') || '<p class="loading">这个分类的奖项今天都投过了。</p>';
    for (const card of gridEl.querySelectorAll('.cat-card')) {
      const stage = card.querySelector('.cat-cover-stage');
      showAwardCover(stage, 0);
      card.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') startCoverRotation(stage);
      });
      card.addEventListener('pointerleave', () => {
        if (hoveredCoverStage === stage) stopCoverRotation();
      });
    }
  }

  function showAwardCover(stage, index, announce = true) {
    const tiles = [...stage.children];
    stage.dataset.coverIndex = index;
    tiles.forEach((tile, position) => {
      const distance = (position - index + tiles.length) % tiles.length;
      tile.dataset.coverDepth = distance > tiles.length / 2 ? distance - tiles.length : distance;
    });
    const card = stage.closest('.cat-card');
    const category = findCategory(card.dataset.id);
    const name = nomineeName(category, tiles[index]?.dataset.coverNominee);
    card.querySelector('.cat-cover-caption').textContent = name;
    const announcement = card.querySelector('.cat-cover-announcement');
    if (announcement && announce) {
      announcement.textContent = '第 ' + (index + 1) + ' 张，共 ' + tiles.length + ' 张' + (name ? '，' + name : '');
    }
  }

  function stepAwardCover(stage, step, announce = true) {
    const count = stage.childElementCount;
    const index = (Number(stage.dataset.coverIndex) + step + count) % count;
    showAwardCover(stage, index, announce);
  }

  unvotedOnly.addEventListener('change', renderCards);

  function nextUnvotedAward(categoryId) {
    const { categories, myVotes } = ui.data;
    const index = categories.findIndex(category => category.id === categoryId);
    const remaining = [...categories.slice(index + 1), ...categories.slice(0, index)]
      .filter(category => !myVotes[category.id] && category.nominees.length);
    return remaining.find(category => category.tab === ui.activeTab) || remaining[0];
  }

  function renderFeaturedNominees() {
    const category = findCategory('goty');
    if (!category) return;
    heroAward.disabled = false;
    heroVote.disabled = false;
    heroList.replaceChildren(...category.nominees.map((nominee) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'featured-nominee';
      button.dataset.nominee = nominee.id;
      button.setAttribute('aria-haspopup', 'dialog');

      const title = document.createElement('strong');
      title.textContent = compactName(nominee);
      button.insertAdjacentHTML('beforeend', coverCell(nominee, 'featured-cover'));
      button.querySelector('.featured-cover').setAttribute('aria-hidden', 'true');
      button.append(title);
      if (nominee.en && nominee.en !== nominee.name) {
        const subtitle = element('span', null, nominee.en);
        subtitle.lang = 'en';
        button.append(subtitle);
      }
      if (nominee.id === 'gta6') {
        const studio = element('small', 'featured-studio', nominee.details?.studio || nominee.sub);
        studio.title = '制作公司 · ' + studio.textContent;
        button.append(studio);
      }
      item.append(button);
      return item;
    }));
  }

  /* ---------------- 选票 ---------------- */
  const nomineeTypes = {
    'best-performance': { vote: '投给这位演员', detail: '饰演角色' },
    'best-esports-athlete': { vote: '投给这位选手', detail: '参赛项目' },
    'best-esports-team': { vote: '投给这支战队', detail: '赛区' },
    'content-creator': { vote: '投给这位创作者', detail: '身份' },
    'best-adaptation': { vote: '投给这部作品', detail: '制作公司' },
    'best-user-creation': { vote: '投给这个创作', detail: '创作团队' }
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function icon(name) {
    const image = element('img', 'ui-icon');
    image.src = `/icons/${name}.svg`;
    image.alt = '';
    image.width = 16;
    image.height = 16;
    return image;
  }

  function externalLink(label, url) {
    const link = element('a', 'ballot-link', label);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(icon('external-link'));
    return link;
  }

  function distinctName(category, nominee) {
    return category.nominees.some((item) => item.id !== nominee.id && item.name === nominee.name)
      ? `${nominee.name}（${nominee.en}）`
      : nominee.name;
  }

  function compactName(nominee, name = nominee.name) {
    return nominee.id === 'zelda-oot' ? name.replace(' ', '\n') : name;
  }

  function renderPicker(category) {
    picker.replaceChildren(...category.nominees.map((nominee) => {
      const button = element('button', 'nominee-thumb');
      button.type = 'button';
      button.dataset.selectNominee = nominee.id;
      button.insertAdjacentHTML('beforeend', coverCell(nominee, 'thumb-cover'));
      button.firstElementChild.setAttribute('aria-hidden', 'true');
      const mark = element('span', 'thumb-mark');
      mark.append(icon('check'));
      mark.setAttribute('aria-hidden', 'true');
      button.append(element('span', 'thumb-label', compactName(nominee, distinctName(category, nominee))));
      button.append(mark);
      return button;
    }));
    pickerSegments.replaceChildren(...category.nominees.map((nominee, i) => {
      const seg = element('button', 'picker-seg');
      seg.type = 'button';
      seg.dataset.selectNominee = nominee.id;
      seg.setAttribute('aria-pressed', 'false');
      seg.setAttribute('aria-label', '第 ' + (i + 1) + ' 个提名：' + distinctName(category, nominee));
      return seg;
    }));
  }

  function setDrawer(open) {
    pickerDrawer.dataset.open = open ? 'true' : 'false';
    drawerToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    drawerHint.textContent = open ? '收起名单' : '展开名单';
  }

  function renderCriticQuote(critic) {
    const media = element('figure', 'ballot-media');
    const quote = element('blockquote', 'ballot-quote');
    quote.cite = critic.source;

    if (critic.translationZh) {
      const translation = element('q', 'ballot-quote-main', critic.translationZh);
      translation.lang = 'zh-CN';
      quote.append(translation);
    }
    const original = element('q', critic.translationZh ? 'ballot-quote-original' : 'ballot-quote-main', critic.text);
    original.lang = critic.lang || 'en';
    quote.append(original);

    const caption = element('figcaption', 'ballot-media-byline');
    const source = externalLink(critic.outlet, critic.source);
    source.classList.add('ballot-media-source');
    caption.append(element('span', null, '媒体短评'), source);
    media.append(quote, caption);
    return media;
  }

  function renderModal(categoryId, animate = false) {
    if (ui.openCategory !== categoryId) return;
    const category = findCategory(categoryId);
    const index = category.nominees.findIndex((item) => item.id === ui.selectedNominee);
    const nominee = category.nominees[index];
    if (!nominee) return;
    const info = nominee.details || {};
    const type = nomineeTypes[categoryId];
    const isGame = !type;
    const myVote = ui.data.myVotes[categoryId];

    modalTotal.textContent = `累计 ${fmt(category.total)} 票`;
    modalNotice.textContent = ui.voteError;
    if (myVote) {
      modalHint.textContent = '';
      modalMy.replaceChildren(
        document.createTextNode(`今日选择：${nomineeName(category, myVote)}`),
        element('span', 'vote-rule', `（${dailyVoteRule}）`)
      );
    } else {
      modalHint.textContent = dailyVoteRule;
      modalMy.textContent = '';
    }
    const position = `提名 ${index + 1} / ${category.nominees.length}`;
    $('#nomineePosition').textContent = position;
    $('#desktopNomineePosition').textContent = position;
    for (const button of modal.querySelectorAll('[data-step]')) {
      button.disabled = category.nominees.length < 2;
    }
    for (const button of picker.children) {
      button.setAttribute('aria-pressed', button.dataset.selectNominee === nominee.id);
    }
    for (const seg of pickerSegments.children) {
      seg.setAttribute('aria-pressed', seg.dataset.selectNominee === nominee.id);
    }

    const panel = element('article', animate ? 'ballot-entry ballot-enter' : 'ballot-entry');
    panel.dataset.nid = nominee.id;
    panel.insertAdjacentHTML('beforeend', coverCell(nominee, 'ballot-poster'));
    const poster = panel.querySelector('.ballot-poster');
    poster.querySelector('img')?.removeAttribute('loading');
    if (['best-performance', 'best-esports-athlete', 'content-creator'].includes(categoryId)) {
      poster.classList.add('ballot-person');
    }

    const content = element('div', 'ballot-copy');
    const identity = element('div', 'ballot-identity');
    const titles = element('div', 'ballot-titles');
    titles.append(element('h3', 'ballot-name', nominee.name));
    if (nominee.en && nominee.en !== nominee.name) {
      const original = element('p', 'ballot-original', nominee.en);
      if (isGame || categoryId === 'best-adaptation') original.lang = 'en';
      titles.append(original);
    }
    if (info.studio || nominee.sub) {
      const detail = info.studio || nominee.sub;
      const label = type?.detail || '制作公司';
      const value = categoryId === 'best-performance' ? detail.replace(/^饰\s*/, '') : detail;
      titles.append(element('p', 'ballot-studio', `${label} · ${value}`));
    }

    identity.append(titles);
    if (isGame && info.score) {
      const score = info.score;
      const badge = externalLink('', score.source);
      badge.className = 'ballot-score';
      const scoreLabel = `Metacritic 媒体评分 ${score.value} 分，${score.platform}`;
      const reviewCount = score.criticReviewCount ? `，基于 ${fmt(score.criticReviewCount)} 篇媒体评测` : '';
      badge.title = scoreLabel + reviewCount;
      badge.setAttribute('aria-label', badge.title + '，打开来源');
      badge.replaceChildren();
      const value = element('strong', 'score-value', String(score.value));
      value.dataset.rating = score.value >= 75 ? 'positive' : score.value >= 50 ? 'mixed' : 'negative';
      const emblem = element('img', 'score-icon');
      emblem.src = '/icons/metacritic.svg';
      emblem.alt = '';
      emblem.width = 14;
      emblem.height = 14;
      const attribution = element('span', 'score-attribution');
      attribution.append(emblem, element('span', 'score-brand', 'Metacritic'),
        element('small', 'score-platform', score.platform));
      if (score.criticReviewCount) {
        attribution.append(element('small', 'score-review-count', fmt(score.criticReviewCount) + ' 篇评测'));
      }
      badge.append(value, attribution);
      identity.append(badge);
    } else if (isGame && info.metacriticPending) {
      titles.append(element('p', 'score-pending', 'Metacritic 暂无媒体分'));
    }
    content.append(identity);
    const introLabel = info.officialIntro ? '官方介绍摘要' : type ? '候选简介' : '游戏简介';
    const intro = element('p', 'ballot-intro', info.officialIntro || info.storeIntro || nominee.intro || '暂无中文简介。');
    const description = element('div', 'ballot-description');
    description.append(element('h4', 'ballot-section-label', introLabel), intro);
    content.append(description);

    const links = element('div', 'ballot-links');
    for (const link of info.links || []) links.append(externalLink(link.label, link.url));
    if (isGame) {
      const title = encodeURIComponent(nominee.en || nominee.name);
      if (!info.links?.length) {
        links.append(externalLink('搜索 Steam', 'https://store.steampowered.com/search/?term=' + title));
      }
      if (!info.score || (info.metacritic && new URL(info.score.source).hostname !== 'www.metacritic.com')) {
        links.append(info.metacritic
          ? externalLink('Metacritic', info.metacritic)
          : externalLink('搜索 Metacritic', 'https://www.metacritic.com/search/' + title + '/'));
      }
    }
    if (info.video && info.video.bvid) {
      const video = info.video;
      const link = externalLink('B站 介绍视频', 'https://www.bilibili.com/video/' + video.bvid + '/');
      link.title = `${video.owner}｜${video.title}`;
      link.dataset.video = video.bvid;
      links.append(link);
    }
    if (links.childElementCount) content.append(links);
    if (isGame && info.criticQuote) content.append(renderCriticQuote(info.criticQuote));

    ballotActions.replaceChildren();
    if (ui.data.event.votingClosed) {
      modalHint.textContent = '本次投票已结束';
      const link = element('a', 'vote-btn', '查看最终结果');
      link.href = '/results';
      ballotActions.append(link);
    } else if (ui.confirmingVote && !myVote && !ui.busy) {
      const confirmation = element('div', 'vote-confirmation');
      const title = element('p', null, `确认将「${category.cn}」投给「${distinctName(category, nominee)}」？`);
      const hint = element('p', 'ballot-tally', '提交后不可更改。');
      const cancel = element('button', 'vote-cancel', '返回');
      cancel.type = 'button';
      cancel.dataset.cancelVote = '';
      const confirm = element('button', 'vote-btn', '确认投票');
      confirm.type = 'button';
      confirm.dataset.confirmVote = nominee.id;
      const confirmCopy = element('div', 'confirm-copy');
      confirmCopy.append(title, hint);
      const confirmButtons = element('div', 'confirm-buttons');
      confirmButtons.append(cancel, confirm);
      confirmation.append(confirmCopy, confirmButtons);
      ballotActions.append(confirmation);
    } else if (myVote) {
      const followup = element('div', 'vote-followup');
      const back = element('button', 'vote-cancel', '返回奖项列表');
      back.type = 'button';
      back.dataset.returnAwards = '';
      followup.append(back);
      const next = nextUnvotedAward(categoryId);
      if (next) {
        const proceed = element('button', 'vote-btn', '下一个未投奖项');
        proceed.type = 'button';
        proceed.dataset.nextAward = next.id;
        followup.append(proceed);
      } else {
        modalHint.textContent = '今日全部奖项已投';
      }
      ballotActions.append(followup);
    } else {
      const voteButton = element('button', 'vote-btn',
        ui.busy ? '提交中…' : ui.voteError ? '重试投票' : type?.vote || '投给这款游戏');
      voteButton.type = 'button';
      voteButton.dataset.vote = nominee.id;
      voteButton.disabled = ui.busy;
      if (!voteButton.disabled) voteButton.append(icon('arrow-up-right'));
      ballotActions.append(voteButton);
    }
    panel.append(content);
    modalBody.replaceChildren(panel);
  }

  function selectNominee(nomineeId) {
    ui.selectedNominee = nomineeId;
    ui.confirmingVote = false;
    ui.voteError = '';
    renderModal(ui.openCategory, true);
    modalBody.scrollTop = 0;
    if (modal.open) revealThumbnail();
  }

  function openModal(categoryId, nomineeId, trigger = document.activeElement) {
    const category = findCategory(categoryId);
    if (!category?.nominees.length || modal.open) return;
    stopCoverRotation();
    ui.modalTrigger = trigger;
    ui.awardListScroll = gridEl.contains(trigger) ? window.scrollY : null;
    modal.returnValue = '';
    showAward(category, nomineeId);
    document.body.style.overflow = 'hidden';
    modal.showModal();
    modalBody.scrollTop = 0;
    const button = ballotActions.querySelector('.vote-btn:not(:disabled)');
    (nomineeId && button ? button : modal.querySelector('[data-close]')).focus({ preventScroll: true });
    revealThumbnail();
  }

  function showAward(category, nomineeId) {
    ui.openCategory = category.id;
    modalTitle.textContent = category.cn;
    modalEn.textContent = category.en;
    renderPicker(category);
    setDrawer(false);
    selectNominee(nomineeId || ui.data.myVotes[category.id] || category.nominees[0].id);
    fetch('/api/award-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: category.id }),
      keepalive: true
    }).catch(() => {});
  }

  function revealThumbnail() {
    const thumb = picker.querySelector('[aria-pressed=true]');
    if (!thumb) return;
    const frame = picker.getBoundingClientRect();
    const tile = thumb.getBoundingClientRect();
    if (tile.left < frame.left) picker.scrollLeft += tile.left - frame.left - 4;
    else if (tile.right > frame.right) picker.scrollLeft += tile.right - frame.right + 4;
  }

  modal.addEventListener('close', () => {
    if (modal.open) return;
    ui.openCategory = null;
    ui.selectedNominee = null;
    ui.confirmingVote = false;
    document.body.style.overflow = '';
    if (ui.pendingCardRefresh) renderCards();
    const originCategory = ui.modalTrigger?.dataset.open;
    let trigger = ui.modalTrigger?.isConnected ? ui.modalTrigger :
      gridEl.querySelector('[data-open="' + originCategory + '"]');
    if (ui.awardListScroll !== null) {
      window.scrollTo({ top: ui.awardListScroll, behavior: 'instant' });
      trigger ??= [...gridEl.querySelectorAll('[data-open]')].find(button => {
        const { top, bottom } = button.getBoundingClientRect();
        return top >= tabsEl.getBoundingClientRect().bottom && bottom <= window.innerHeight;
      });
    } else if (modal.returnValue === 'awards') {
      $('#categories').scrollIntoView({ behavior: 'instant' });
      trigger = ui.data.event.votingClosed ? $('#categoriesTitle') : unvotedOnly;
    }
    (trigger || (ui.data.event.votingClosed ? $('#categoriesTitle') : unvotedOnly)).focus({ preventScroll: true });
    ui.modalTrigger = null;
    ui.awardListScroll = null;
  });

  /* ---------------- 投票 ---------------- */
  /* SDK 会把 PostgreSQL 错误码前缀成 DATABASE_xxx */
  function hasPgCode(error, code) {
    const raw = String(error && error.code || '');
    return raw === code || raw.endsWith('_' + code);
  }

  async function submitVote(categoryId, nomineeId) {
    const clock = voteClockNow();
    if (!cloud) return { ok: false, error: '云端服务暂不可用，请刷新页面后重试。' };
    if (ui.data.event.votingClosed) return { closed: true, ...clock };

    const { error } = await cloud.database
      .from('votes')
      .insert({ category_id: categoryId, nominee_id: nomineeId, voter_id: voterId() });

    if (!error) {
      const summary = await fetchCloudSummary();
      applySummaryTo(ui.data, summary);
      return {
        ok: true,
        votedFor: nomineeId,
        categoryTotal: categoryTotalOf(summary, categoryId),
        totalVotes: ui.data.event.totalVotes,
        voters: ui.data.event.voters,
        ...clock
      };
    }

    if (hasPgCode(error, '23505')) {
      const [summary, mine] = await Promise.all([fetchCloudSummary(), fetchMyVotes()]);
      applySummaryTo(ui.data, summary);
      return {
        conflict: true,
        votedFor: mine[categoryId] || null,
        categoryTotal: categoryTotalOf(summary, categoryId),
        ...clock
      };
    }

    if (hasPgCode(error, '42501')) return { ok: false, error: '没有权限提交投票，请稍后再试。' };
    if (hasPgCode(error, '42P01')) return { ok: false, error: '投票服务尚未就绪，请联系主办方。' };
    return { ok: false, error: error.message || '投票失败，请重试。' };
  }

  async function vote(categoryId, nomineeId, btn) {
    if (ui.busy) return;
    ui.busy = true;
    ui.voteError = '';
    let error = '';
    const wasFocused = document.activeElement === btn;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '提交中…';
    }
    try {
      const result = await submitVote(categoryId, nomineeId);
      if (result.ok) {
        updateVoteClock(result);
        const cat = findCategory(categoryId);
        if (cat) cat.total = result.categoryTotal;
        ui.data.myVotes[categoryId] = result.votedFor;
        ui.data.event.totalVotes = result.totalVotes;
        ui.data.event.voters = result.voters;
        renderStats();
        renderCards();
        if (!modal.open) showToast('投票成功，感谢参与！');
      } else if (result.closed) {
        ui.data.event.votingClosed = true;
        renderStats();
        renderCards();
      } else if (result.conflict) {
        updateVoteClock(result);
        if (result.votedFor) ui.data.myVotes[categoryId] = result.votedFor;
        const cat = findCategory(categoryId);
        if (cat) cat.total = result.categoryTotal;
        renderCards();
        if (!modal.open) showToast('你今天已经在该奖项投过票了');
      } else {
        error = result.error || '投票失败，请重试。';
      }
    } catch (err) {
      error = err && String(err.code || '').endsWith('42501') ? '没有权限提交投票，请稍后再试。' : '网络异常，请重试。';
    } finally {
      ui.busy = false;
      if (ui.openCategory) {
        const sameVote = ui.openCategory === categoryId && ui.selectedNominee === nomineeId;
        if (sameVote) ui.voteError = error;
        const shouldRestoreFocus = sameVote && wasFocused &&
          (document.activeElement === btn || document.activeElement === document.body);
        renderModal(ui.openCategory);
        if (shouldRestoreFocus) {
          const action = ballotActions.querySelector('.vote-btn:not(:disabled), [data-return-awards]:only-child');
          (action || modal.querySelector('.ballot-status'))?.focus({ preventScroll: true });
        }
      } else if (error) {
        showToast(error);
      }
    }
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ---------------- 倒计时 ---------------- */
  function startCountdown(target) {
    const elD = $('#cdD');
    const elH = $('#cdH');
    const elM = $('#cdM');
    const elS = $('#cdS');
    const end = new Date(target).getTime();
    const tick = () => {
      const diff = Math.max(0, end - Date.now());
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      elD.textContent = String(d).padStart(2, '0');
      elH.textContent = String(h).padStart(2, '0');
      elM.textContent = String(m).padStart(2, '0');
      elS.textContent = String(s).padStart(2, '0');
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ---------------- 事件 ---------------- */
  function selectTab(btn) {
    ui.activeTab = btn.dataset.tab;
    tabsEl.querySelectorAll('.tab').forEach((tab) => {
      const active = tab === btn;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    gridEl.setAttribute('aria-labelledby', btn.id);
    if (!ui.data) return;
    renderCards();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gridEl.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    }
  }

  tabsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.tab');
    if (btn) selectTab(btn);
  });

  tabsEl.addEventListener('keydown', (event) => {
    const keys = ['Home', 'End', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    const tabs = [...tabsEl.querySelectorAll('.tab')];
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next]);
    tabs[next].focus();
  });

  function openRecruitDialog() {
    stopCoverRotation();
    const posters = recruitDialog.querySelector('.recruit-posters');
    const set = posters.firstElementChild;
    const previous = [...set.children];
    const images = [...previous];
    for (let index = images.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [images[index], images[randomIndex]] = [images[randomIndex], images[index]];
    }
    if (images.length > 1 && images.every((image, index) => image === previous[index])) {
      images.push(images.shift());
    }
    for (const image of images) image.loading = 'eager';
    set.replaceChildren(...images);
    // 四组保持同一顺序，轨道移动一组的距离后可以无缝循环。
    posters.replaceChildren(set, set.cloneNode(true), set.cloneNode(true), set.cloneNode(true));
    recruitStatus.textContent = '';
    recruitDialog.showModal();
  }

  for (const trigger of document.querySelectorAll('button[aria-controls="recruitDialog"]')) {
    trigger.addEventListener('click', openRecruitDialog);
  }

  $('#recruitCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(recruitNumber.value);
      recruitStatus.textContent = '已复制群号';
    } catch {
      recruitNumber.focus();
      recruitNumber.select();
      recruitStatus.textContent = '已选中群号，可手动复制';
    }
  });

  heroAward.addEventListener('click', () => openModal('goty'));
  heroVote.addEventListener('click', () => openModal('goty'));
  heroList.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-nominee]');
    if (tile) openModal('goty', tile.dataset.nominee);
  });

  gridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.cat-card');
    if (!card) return;
    const sideCover = e.target.closest('[data-cover-step]');
    if (sideCover) {
      const slider = sideCover.closest('.cat-cover-slider');
      const stage = slider.querySelector('.cat-cover-stage');
      stepAwardCover(stage, Number(sideCover.dataset.coverStep));
      if (hoveredCoverStage === stage) startCoverRotation(stage);
      return;
    }
    const activeCover = card.querySelector('.cat-cover[data-cover-depth="0"]');
    const clickedCover = e.target.closest('[data-cover-nominee]');
    // 换场中以指针下仍处于前层的图片为准。
    const frontArtwork = clickedCover && Number(getComputedStyle(clickedCover).zIndex) > 1;
    openModal(card.dataset.id, (frontArtwork ? clickedCover : activeCover)?.dataset.coverNominee, card.querySelector('[data-open]'));
  });

  drawerToggle.addEventListener('click', () => {
    const open = pickerDrawer.dataset.open !== 'true';
    setDrawer(open);
    if (open) revealThumbnail();
  });

  function stepNominee(direction) {
    const category = findCategory(ui.openCategory);
    const count = category?.nominees.length ?? 0;
    if (count < 2) return;
    const index = category.nominees.findIndex((item) => item.id === ui.selectedNominee);
    if (index < 0) return;
    const next = (index + direction + count) % count;
    selectNominee(category.nominees[next].id);
  }

  /* 左右滑动正文切换提名 */
  modalBody.addEventListener('dragstart', (event) => {
    if (mobilePicker.matches) event.preventDefault();
  });
  let swipeTrack = null;
  modalBody.addEventListener('pointerdown', (event) => {
    if (!mobilePicker.matches || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    swipeTrack = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null, dx: 0 };
  }, { passive: true });
  modalBody.addEventListener('pointermove', (event) => {
    if (!swipeTrack || swipeTrack.id !== event.pointerId) return;
    const dx = event.clientX - swipeTrack.x;
    const dy = event.clientY - swipeTrack.y;
    if (!swipeTrack.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      swipeTrack.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (swipeTrack.axis === 'x') modalBody.classList.add('is-swiping');
    }
    if (swipeTrack.axis === 'x') swipeTrack.dx = dx;
  }, { passive: true });
  function endSwipe(event) {
    if (!swipeTrack || swipeTrack.id !== event.pointerId) return;
    const track = swipeTrack;
    swipeTrack = null;
    modalBody.classList.remove('is-swiping');
    if (event.type === 'pointerup' && mobilePicker.matches && track.axis === 'x' && Math.abs(track.dx) >= 48) {
      stepNominee(track.dx < 0 ? 1 : -1);
    }
  }
  modalBody.addEventListener('pointerup', endSwipe, { passive: true });
  modalBody.addEventListener('pointercancel', endSwipe, { passive: true });

  picker.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const current = event.target.closest('[data-select-nominee]');
    if (!current) return;
    event.preventDefault();
    const next = event.key === 'ArrowRight' ? current.nextElementSibling : current.previousElementSibling;
    if (!next) return;
    selectNominee(next.dataset.selectNominee);
    next.focus({ preventScroll: true });
  });

  modal.addEventListener('wheel', (event) => {
    if (event.deltaY !== 0 && !event.ctrlKey) event.preventDefault();
  }, { passive: false });

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-return-awards]')) {
      modal.close('awards');
      return;
    }
    const nextAward = event.target.closest('[data-next-award]');
    if (nextAward) {
      showAward(findCategory(nextAward.dataset.nextAward));
      modalTitle.focus({ preventScroll: true });
      return;
    }
    if (event.target.closest('[data-close]')) {
      modal.close();
      return;
    }
    const step = event.target.closest('[data-step]');
    if (step) {
      stepNominee(Number(step.dataset.step));
      return;
    }
    const thumbnail = event.target.closest('[data-select-nominee]');
    if (thumbnail) {
      selectNominee(thumbnail.dataset.selectNominee);
      return;
    }
    if (event.target.closest('[data-cancel-vote]')) {
      cancelConfirmation();
      return;
    }
    const confirm = event.target.closest('[data-confirm-vote]');
    if (confirm && ui.confirmingVote && confirm.dataset.confirmVote === ui.selectedNominee) {
      ui.confirmingVote = false;
      vote(ui.openCategory, ui.selectedNominee, confirm);
      return;
    }
    const button = event.target.closest('[data-vote]:not(:disabled)');
    if (button && ui.openCategory && !ui.busy) {
      ui.confirmingVote = true;
      renderModal(ui.openCategory);
      ballotActions.querySelector('[data-cancel-vote]')?.focus();
    }
  });

  function cancelConfirmation() {
    ui.confirmingVote = false;
    renderModal(ui.openCategory);
    ballotActions.querySelector('[data-vote]')?.focus();
  }

  modal.addEventListener('cancel', (event) => {
    if (!ui.confirmingVote) return;
    event.preventDefault();
    cancelConfirmation();
  });

  /* ---------------- 每日投票状态与初始化 ---------------- */
  let voteDayTimer;
  let voteDayDeadline = Infinity;
  let checkingVoteDay = false;

  async function fetchVoteState(recordVisit = false) {
    const source = recordVisit && new URLSearchParams(location.search).get('utm_source');
    const url = source ? '/api/state?utm_source=' + encodeURIComponent(source) : '/api/state';
    const res = await fetch(url, recordVisit ? { headers: { 'X-Suyou-View': '1' } } : {});
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    try {
      const [summary, mine] = await Promise.all([fetchCloudSummary(), fetchMyVotes()]);
      applySummaryTo(data, summary);
      data.myVotes = mine;
      Object.assign(data, voteClockNow());
      data.cloudReady = true;
    } catch {
      data.cloudReady = false;
    }
    return data;
  }

  function scheduleVoteDay(clock) {
    if (!Number.isFinite(clock.voteDayEndsAt) || !Number.isFinite(clock.serverNow)) return;
    const delay = Math.max(50, clock.voteDayEndsAt - clock.serverNow + 100);
    voteDayDeadline = performance.now() + delay;
    clearTimeout(voteDayTimer);
    voteDayTimer = setTimeout(refreshVoteDay, delay);
  }

  function updateVoteClock(clock) {
    if (!Number.isFinite(clock.voteDayEndsAt)) return;
    if (ui.data.voteDayEndsAt !== clock.voteDayEndsAt) {
      ui.data.myVotes = {};
      ui.data.voteDayEndsAt = clock.voteDayEndsAt;
    }
    scheduleVoteDay(clock);
  }

  async function refreshVoteDay() {
    if (checkingVoteDay || document.hidden || performance.now() < voteDayDeadline) return;
    clearTimeout(voteDayTimer);
    if (ui.busy) {
      voteDayTimer = setTimeout(refreshVoteDay, 1000);
      return;
    }
    const previousDayEnd = ui.data.voteDayEndsAt;
    checkingVoteDay = true;
    try {
      const data = await fetchVoteState();
      if (ui.data.voteDayEndsAt !== previousDayEnd) return;
      if (ui.busy) {
        voteDayTimer = setTimeout(refreshVoteDay, 1000);
        return;
      }
      if (data.voteDayEndsAt !== previousDayEnd || data.event.votingClosed !== ui.data.event.votingClosed ||
          data.event.resultsOpen !== ui.data.event.resultsOpen) {
        const focusAction = ballotActions.contains(document.activeElement);
        ui.data = data;
        ui.voteError = '';
        renderStats();
        renderCards();
        if (ui.openCategory) {
          renderModal(ui.openCategory);
          if (focusAction) ballotActions.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
        }
      }
      scheduleVoteDay(data);
    } catch {
      voteDayTimer = setTimeout(refreshVoteDay, 30000);
    } finally {
      checkingVoteDay = false;
    }
  }

  document.addEventListener('visibilitychange', refreshVoteDay);
  window.addEventListener('pageshow', refreshVoteDay);

  async function init() {
    try {
      ui.data = await fetchVoteState(true);
      renderFeaturedNominees();
      renderStats();
      renderCards();
      startCountdown(ui.data.event.ceremonyAt);
      scheduleVoteDay(ui.data);
    } catch (err) {
      gridEl.innerHTML = '<div class="loading">加载失败，请确认服务已启动后刷新页面。</div>';
    }
  }

  init();
})();

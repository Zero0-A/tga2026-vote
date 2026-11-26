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
    busy: false
  };

  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
  const dailyVoteRule = '每个奖项每日仅限一票';

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
  }

  /* ---------------- 卡片 ---------------- */
  function renderCards() {
    const list = ui.data.categories.filter((c) => ui.activeTab === 'all' || c.tab === ui.activeTab);
    gridEl.innerHTML = list.map((c) => {
      const myVote = ui.data.myVotes[c.id];
      const covers = c.nominees.filter((nominee) => nominee.cover);
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
          </div>
          <button class="ghost-btn card-vote${myVote ? ' is-voted' : ''}" type="button" data-open="${c.id}" aria-haspopup="dialog" aria-label="${myVote ? '查看今日投票' : '去投票'}：${c.cn}">
            <span class="vote-label">${myVote ? '查看今日投票' : '去投票'}</span>
            <span class="vote-label-short">${myVote ? '已投' : '投票'}</span>
            <img class="ui-icon vote-arrow" src="/icons/arrow-up-right.svg" width="19" height="19" alt="" />
            <svg class="vote-ticket" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </button>
        </article>`;
    }).join('');
    gridEl.querySelectorAll('.cat-cover-stage').forEach((stage) => showAwardCover(stage, 0));
  }

  function showAwardCover(stage, index) {
    const tiles = [...stage.children];
    stage.dataset.coverIndex = index;
    tiles.forEach((tile, position) => {
      const distance = (position - index + tiles.length) % tiles.length;
      tile.dataset.coverDepth = distance > tiles.length / 2 ? distance - tiles.length : distance;
    });
    const card = stage.closest('.cat-card');
    const announcement = card.querySelector('.cat-cover-announcement');
    if (announcement) {
      const name = tiles[index]?.querySelector('img')?.alt || '';
      announcement.textContent = '第 ' + (index + 1) + ' 张，共 ' + tiles.length + ' 张' + (name ? '，' + name : '');
    }
  }

  function stepAwardCover(stage, step) {
    const count = stage.childElementCount;
    const index = (Number(stage.dataset.coverIndex) + step + count) % count;
    showAwardCover(stage, index);
    return index;
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
      title.textContent = nominee.name;
      button.insertAdjacentHTML('beforeend', coverCell(nominee, 'featured-cover'));
      button.querySelector('.featured-cover').setAttribute('aria-hidden', 'true');
      button.append(title);
      if (nominee.en && nominee.en !== nominee.name) {
        const subtitle = element('span', null, nominee.en);
        subtitle.lang = 'en';
        button.append(subtitle);
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
      button.append(element('span', 'thumb-label', distinctName(category, nominee)));
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
    const chosen = myVote === nominee.id;

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
    if (ui.confirmingVote && !myVote && !ui.busy) {
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
    } else {
      const voteButton = element('button', 'vote-btn' + (chosen ? ' voted-btn' : ''),
        chosen ? '今日已投给该候选' : myVote ? '本奖项今日已投' : ui.busy ? '提交中…' : ui.voteError ? '重试投票' : type?.vote || '投给这款游戏');
      voteButton.type = 'button';
      voteButton.dataset.vote = nominee.id;
      voteButton.disabled = Boolean(myVote) || ui.busy;
      if (!voteButton.disabled || chosen) voteButton.append(icon(chosen ? 'check' : 'arrow-up-right'));
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

  function openModal(categoryId, nomineeId) {
    const category = findCategory(categoryId);
    if (!category?.nominees.length || modal.open) return;
    ui.modalTrigger = document.activeElement;
    ui.openCategory = categoryId;
    modalTitle.textContent = category.cn;
    modalEn.textContent = category.en;
    renderPicker(category);
    setDrawer(false);
    selectNominee(nomineeId || ui.data.myVotes[categoryId] || category.nominees[0].id);
    document.body.style.overflow = 'hidden';
    modal.showModal();
    modalBody.scrollTop = 0;
    const button = ballotActions.querySelector('.vote-btn:not(:disabled)');
    (nomineeId && button ? button : modal.querySelector('[data-close]')).focus({ preventScroll: true });
    revealThumbnail();
    fetch('/api/award-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId }),
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
    const categoryId = ui.openCategory;
    ui.openCategory = null;
    ui.selectedNominee = null;
    ui.confirmingVote = false;
    document.body.style.overflow = '';
    const trigger = ui.modalTrigger?.isConnected
      ? ui.modalTrigger
      : gridEl.querySelector('[data-open="' + categoryId + '"]');
    trigger?.focus({ preventScroll: true });
    ui.modalTrigger = null;
  });

  /* ---------------- 投票 ---------------- */
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
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, nomineeId })
      });
      const data = await res.json();
      if (res.ok) {
        updateVoteClock(data);
        const cat = findCategory(categoryId);
        if (cat) cat.total = data.categoryTotal;
        ui.data.myVotes[categoryId] = data.votedFor;
        ui.data.event.totalVotes = data.totalVotes;
        ui.data.event.voters = data.voters;
        renderStats();
        renderCards();
        if (!modal.open) showToast('投票成功，感谢参与！');
      } else if (res.status === 409) {
        updateVoteClock(data);
        ui.data.myVotes[categoryId] = data.votedFor;
        const cat = findCategory(categoryId);
        if (cat) cat.total = data.categoryTotal;
        renderCards();
        if (!modal.open) showToast('你今天已经在该奖项投过票了');
      } else {
        error = data.error || '投票失败，请重试。';
      }
    } catch (err) {
      error = '网络异常，请重试。';
    } finally {
      ui.busy = false;
      if (ui.openCategory) {
        const sameVote = ui.openCategory === categoryId && ui.selectedNominee === nomineeId;
        if (sameVote) ui.voteError = error;
        const shouldRestoreFocus = sameVote && wasFocused &&
          (document.activeElement === btn || document.activeElement === document.body);
        renderModal(ui.openCategory);
        if (shouldRestoreFocus) {
          (ballotActions.querySelector('.vote-btn:not(:disabled)') || modal.querySelector('.ballot-status'))?.focus({ preventScroll: true });
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
      const index = stepAwardCover(stage, Number(sideCover.dataset.coverStep));
      const label = stage.children[index].querySelector('img')?.alt;
      slider.querySelector('.cat-cover-announcement').textContent =
        '第 ' + (index + 1) + ' 张，共 ' + stage.childElementCount + ' 张' + (label ? '，' + label : '');
      return;
    }
    const activeCover = card.querySelector('.cat-cover[data-cover-depth="0"]');
    const clickedCover = e.target.closest('[data-cover-nominee]');
    // 换场中以指针下仍处于前层的图片为准。
    const frontArtwork = clickedCover && Number(getComputedStyle(clickedCover).zIndex) > 1;
    openModal(card.dataset.id, (frontArtwork ? clickedCover : activeCover)?.dataset.coverNominee);
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
    return res.json();
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
      if (data.voteDayEndsAt !== previousDayEnd) {
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

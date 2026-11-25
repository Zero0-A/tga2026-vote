(() => {
  const $ = (sel) => document.querySelector(sel);
  const gridEl = $('#categoryGrid');
  const heroAward = $('#hero-award');
  const heroVote = $('#hero-vote');
  const heroList = $('#hero-nominee-list');
  const tabsEl = $('#tabs');
  const modal = $('#modal');
  const modalBody = $('#modalBody');
  const ballotActions = $('#ballotActions');
  const picker = $('#nomineePicker');
  const modalNotice = $('#modalNotice');
  const modalTitle = $('#modalTitle');
  const modalEn = $('#modalEn');
  const modalHint = $('#modalHint');
  const modalMy = $('#modalMy');
  const toastEl = $('#toast');

  const ui = {
    data: null,
    activeTab: 'all',
    openCategory: null,
    selectedNominee: null,
    confirmingVote: false,
    modalTrigger: null,
    busy: false
  };

  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');

  /* ---------------- 封面图 ---------------- */
  function coverCell(n, extraClass = '') {
    const directory = extraClass === 'ballot-poster' ? '/covers/' : '/covers/previews/';
    const img = n.cover
      ? `<img loading="lazy" alt="${n.name} 封面" src="${directory}${n.id}.jpg" onerror="this.remove()" />`
      : '';
    return `<div class="cover-cell ${extraClass}">${img}<span class="cover-fallback" aria-hidden="true"><img class="ui-icon" src="/icons/image-off.svg" alt="" width="24" height="24" /></span></div>`;
  }

  function findCategory(id) {
    return ui.data && ui.data.categories.find((c) => c.id === id);
  }

  function countOf(category) {
    const map = {};
    (category.counts || []).forEach((c) => { map[c.id] = c.votes; });
    return map;
  }

  function categoryTotal(category) {
    return (category.counts || []).reduce((s, c) => s + c.votes, 0);
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
    gridEl.innerHTML = list
      .map((c) => {
        const myVote = ui.data.myVotes[c.id];
        const chips = c.nominees.slice(0, 3).map((n) => `<span class="chip">${n.name}</span>`).join('');
        const more = c.nominees.length > 3 ? `<span class="chip more">+${c.nominees.length - 3}</span>` : '';
        const covers = c.nominees.filter((n) => n.cover).slice(0, 3).map((n) => coverCell(n)).join('');
        return `
          <article class="cat-card ${myVote ? 'voted' : ''}" data-id="${c.id}">
            ${covers ? `<div class="cover-strip">${covers}</div>` : ''}
            <div class="cat-top">
              <div>
                <p class="cat-en">${c.en}</p>
                <h3 class="cat-cn">${c.cn}</h3>
              </div>
              ${myVote ? '<span class="cat-count">已投票</span>' : ''}
            </div>
            <div class="chips">${chips}${more}</div>
            <div class="cat-foot">
              <span class="cat-status">${myVote ? `你的选择：<strong>${nomineeName(c, myVote)}</strong>` : `${c.nominees.length} 款提名 · ${fmt(categoryTotal(c))} 票`}</span>
              <button class="ghost-btn ${myVote ? 'outline' : ''}" data-open="${c.id}">${myVote ? '查看结果' : '去投票'}</button>
            </div>
          </article>`;
      })
      .join('');
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
      const subtitle = document.createElement('span');
      subtitle.textContent = nominee.en;
      subtitle.lang = 'en';
      button.insertAdjacentHTML('beforeend', coverCell(nominee, 'featured-cover'));
      button.querySelector('.featured-cover').setAttribute('aria-hidden', 'true');
      button.append(title, subtitle);
      item.append(button);
      return item;
    }));
  }

  /* ---------------- 选票 ---------------- */
  const nomineeTypes = {
    'best-performance': { vote: '投给这位演员', detail: '饰演角色', portrait: true },
    'best-esports-athlete': { vote: '投给这位选手', detail: '参赛项目', portrait: true },
    'best-esports-team': { vote: '投给这支战队', detail: '赛区' },
    'content-creator': { vote: '投给这位创作者', detail: '身份', portrait: true },
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
    picker.classList.toggle('portrait-picker', Boolean(nomineeTypes[category.id]?.portrait));
    picker.replaceChildren(...category.nominees.map((nominee) => {
      const button = element('button', 'nominee-thumb');
      button.type = 'button';
      button.dataset.selectNominee = nominee.id;
      button.insertAdjacentHTML('beforeend', coverCell(nominee, 'thumb-cover'));
      button.firstElementChild.setAttribute('aria-hidden', 'true');
      const mark = element('span', 'thumb-mark');
      mark.append(icon('check'));
      mark.setAttribute('aria-hidden', 'true');
      button.append(element('span', 'thumb-label', nominee.name));
      if (distinctName(category, nominee) !== nominee.name) {
        button.append(element('span', 'thumb-subtitle', nominee.en));
      }
      button.append(mark);
      return button;
    }));
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
    const votes = countOf(category)[nominee.id] || 0;
    const total = categoryTotal(category);
    const chosen = myVote === nominee.id;

    modalMy.textContent = myVote ? `你的选择：${nomineeName(category, myVote)}` : '';
    modalHint.textContent = myVote ? '本奖项已完成投票' : '每人每个奖项限投一票';
    $('#nomineePosition').textContent = `提名 ${index + 1} / ${category.nominees.length}`;
    for (const button of modal.querySelectorAll('[data-step]')) {
      button.disabled = !category.nominees[index + Number(button.dataset.step)];
    }
    for (const button of picker.children) {
      button.setAttribute('aria-pressed', button.dataset.selectNominee === nominee.id);
    }

    const panel = element('article', animate ? 'ballot-entry ballot-enter' : 'ballot-entry');
    panel.dataset.nid = nominee.id;
    panel.insertAdjacentHTML('beforeend', coverCell(nominee, 'ballot-poster'));
    const poster = panel.querySelector('.ballot-poster');
    const posterImage = poster.querySelector(':scope > img');
    if (posterImage) {
      posterImage.removeAttribute('loading');
      poster.style.setProperty('--poster-glow', `url("/covers/previews/${nominee.id}.jpg")`);
    }

    const content = element('div', 'ballot-copy');
    content.append(element('h3', 'ballot-name', nominee.name));
    if (nominee.en && nominee.en !== nominee.name) {
      content.append(element('p', 'ballot-original', nominee.en));
    }
    if (info.studio || nominee.sub) {
      const detail = info.studio || nominee.sub;
      const label = type?.detail || '制作公司';
      const value = categoryId === 'best-performance' ? detail.replace(/^饰\s*/, '') : detail;
      content.append(element('p', 'ballot-studio', `${label} · ${value}`));
    }

    if (isGame) {
      const score = info.score
        ? `${info.score.value}/100 · ${info.score.platform}`
        : '暂无已核实评分';
      const scoreText = `Metacritic  ${score}`;
      const badge = info.score?.source
        ? externalLink(scoreText, info.score.source)
        : element('span', 'ballot-score', scoreText);
      badge.className = 'ballot-score';
      badge.querySelector('img')?.remove();
      content.append(badge);
    }
    const introLabel = info.officialIntro ? '官方介绍摘要' : info.officialExcerpt ? '商店介绍节选' : '候选简介';
    const intro = element('p', 'ballot-intro', info.officialIntro || info.officialExcerpt || nominee.intro || '暂无简介。');
    if (info.officialExcerpt && !info.officialIntro) intro.lang = 'en';
    content.append(element('h4', 'ballot-section-label', introLabel), intro);

    const links = element('div', 'ballot-links');
    for (const link of info.links || []) links.append(externalLink(link.label, link.url));
    if (isGame) {
      const title = encodeURIComponent(nominee.en || nominee.name);
      if (!info.links?.length) {
        links.append(externalLink('搜索 Steam', 'https://store.steampowered.com/search/?term=' + title));
      }
      links.append(info.metacritic
        ? externalLink('Metacritic', info.metacritic)
        : externalLink('搜索 Metacritic', 'https://www.metacritic.com/search/' + title + '/'));
    }
    if (links.childElementCount) content.append(links);

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
      confirmation.append(title, hint, cancel, confirm);
      ballotActions.append(confirmation);
    } else {
      const voteButton = element('button', 'vote-btn' + (chosen ? ' voted-btn' : ''),
        chosen ? '已投给该候选' : myVote ? '本奖项已投票' : ui.busy ? '提交中…' : type?.vote || '投给这款游戏');
      voteButton.type = 'button';
      voteButton.dataset.vote = nominee.id;
      voteButton.disabled = Boolean(myVote) || ui.busy;
      ballotActions.append(element('span', 'ballot-tally',
        `${fmt(votes)} 票 · ${total ? (votes / total * 100).toFixed(1) : '0'}%`), voteButton);
    }
    panel.append(content);
    modalBody.replaceChildren(panel);
  }

  function selectNominee(nomineeId) {
    ui.selectedNominee = nomineeId;
    ui.confirmingVote = false;
    modalNotice.textContent = '';
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
    selectNominee(nomineeId || ui.data.myVotes[categoryId] || category.nominees[0].id);
    document.body.style.overflow = 'hidden';
    modal.showModal();
    modalBody.scrollTop = 0;
    const button = ballotActions.querySelector('.vote-btn:not(:disabled)');
    (nomineeId && button ? button : modal.querySelector('.icon-btn')).focus({ preventScroll: true });
    revealThumbnail();
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
    ui.modalTrigger?.focus({ preventScroll: true });
    ui.modalTrigger = null;
  });

  /* ---------------- 投票 ---------------- */
  async function vote(categoryId, nomineeId, btn) {
    if (ui.busy) return;
    ui.busy = true;
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
        const cat = findCategory(categoryId);
        if (cat) cat.counts = data.counts;
        ui.data.myVotes[categoryId] = data.votedFor;
        ui.data.event.totalVotes = data.totalVotes;
        ui.data.event.voters = data.voters;
        renderStats();
        renderCards();
        showToast('投票成功，感谢参与！');
      } else if (res.status === 409) {
        ui.data.myVotes[categoryId] = data.votedFor;
        const cat = findCategory(categoryId);
        if (cat && data.counts) cat.counts = data.counts;
        renderCards();
        showToast('你已经在该奖项投过票了');
      } else {
        showToast(data.error || '投票失败，请稍后再试');
      }
    } catch (err) {
      showToast('网络异常，请检查服务是否正常运行');
    } finally {
      ui.busy = false;
      if (ui.openCategory) renderModal(ui.openCategory);
    }
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(msg) {
    if (modal.open) {
      modalNotice.textContent = msg;
      return;
    }
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
  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    ui.activeTab = btn.dataset.tab;
    tabsEl.querySelectorAll('.tab').forEach((t) => {
      const on = t === btn;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    renderCards();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gridEl.animate([{ opacity: .65, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        { duration: 190, easing: 'ease-out' });
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
    openModal(card.dataset.id);
  });

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      modal.close();
      return;
    }
    const step = event.target.closest('[data-step]');
    if (step) {
      const category = findCategory(ui.openCategory);
      const current = category.nominees.findIndex((item) => item.id === ui.selectedNominee);
      const next = category.nominees[current + Number(step.dataset.step)];
      if (next) {
        selectNominee(next.id);
        if (step.disabled) picker.querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
      }
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

  /* ---------------- 初始化 ---------------- */
  async function init() {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('bad status');
      ui.data = await res.json();
      renderFeaturedNominees();
      renderStats();
      renderCards();
      startCountdown(ui.data.event.ceremonyAt);
    } catch (err) {
      gridEl.innerHTML = '<div class="loading">加载失败，请确认服务已启动后刷新页面。</div>';
    }
  }

  init();
})();

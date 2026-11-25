(() => {
  const $ = (sel) => document.querySelector(sel);
  const gridEl = $('#categoryGrid');
  const heroAward = $('#hero-award');
  const heroVote = $('#hero-vote');
  const heroList = $('#hero-nominee-list');
  const tabsEl = $('#tabs');
  const modal = $('#modal');
  const modalBody = $('#modalBody');
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
  // 官方封面由服务端预置在 public/covers/{id}.jpg，无图时使用首字头像
  function initials(name) {
    const cleaned = String(name).replace(/[《》®™:：]/g, ' ').trim();
    return cleaned.slice(0, 2).toUpperCase();
  }

  function coverCell(n, extraClass = '') {
    const directory = extraClass === 'ballot-poster' ? '/covers/' : '/covers/previews/';
    const img = n.cover
      ? `<img loading="lazy" alt="${n.name} 封面" src="${directory}${n.id}.jpg" onerror="this.remove()" />`
      : '';
    return `<div class="cover-cell ${extraClass}"><span class="cover-fallback">${initials(n.name)}</span>${img}</div>`;
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
    return n ? n.name : '';
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
      button.querySelector('img')?.setAttribute('alt', '');
      button.append(title, subtitle);
      item.append(button);
      return item;
    }));
  }

  /* ---------------- 选票 ---------------- */
  const nonGameAwards = new Set([
    'best-performance', 'best-adaptation', 'best-user-creation',
    'best-esports-athlete', 'best-esports-team', 'content-creator'
  ]);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function externalLink(label, url) {
    const link = element('a', 'ballot-link', label);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function renderPicker(category) {
    picker.replaceChildren(...category.nominees.map((nominee) => {
      const button = element('button', 'nominee-thumb');
      button.type = 'button';
      button.dataset.selectNominee = nominee.id;
      button.insertAdjacentHTML('beforeend', coverCell(nominee, 'thumb-cover'));
      button.firstElementChild.setAttribute('aria-hidden', 'true');
      button.append(element('span', 'thumb-label', nominee.name));
      return button;
    }));
  }

  function renderModal(categoryId) {
    if (ui.openCategory !== categoryId) return;
    const category = findCategory(categoryId);
    const nominee = category.nominees.find((item) => item.id === ui.selectedNominee);
    if (!nominee) return;
    const info = nominee.details || {};
    const isGame = !nonGameAwards.has(categoryId);
    const myVote = ui.data.myVotes[categoryId];
    const votes = countOf(category)[nominee.id] || 0;
    const total = categoryTotal(category);
    const chosen = myVote === nominee.id;

    modalMy.textContent = myVote ? `你的选择：${nomineeName(category, myVote)}` : '';
    modalHint.textContent = myVote ? '本奖项已完成投票' : '同一浏览器每个奖项限投一票';
    for (const button of picker.children) {
      button.setAttribute('aria-pressed', button.dataset.selectNominee === nominee.id);
    }

    const panel = element('article', 'ballot-entry');
    panel.dataset.nid = nominee.id;
    panel.insertAdjacentHTML('beforeend', coverCell(nominee, 'ballot-poster'));
    panel.querySelector('img')?.removeAttribute('loading');

    const content = element('div', 'ballot-copy');
    content.append(element('h3', 'ballot-name', nominee.name));
    if (nominee.en && nominee.en !== nominee.name) {
      content.append(element('p', 'ballot-original', nominee.en));
    }
    if (info.studio || nominee.sub) {
      content.append(element('p', 'ballot-studio', `${isGame ? '制作公司' : '所属／作品'} · ${info.studio || nominee.sub}`));
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
      content.append(badge);
    }
    const introLabel = info.officialIntro ? '官方介绍摘要' : info.officialExcerpt ? '商店介绍节选' : '提名简介';
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

    const actions = element('div', 'ballot-actions');
    if (ui.confirmingVote && !myVote && !ui.busy) {
      const confirmation = element('div', 'vote-confirmation');
      const title = element('p', null, `确认将「${category.cn}」投给「${nominee.name}」？`);
      const hint = element('p', 'ballot-tally', '提交后不可更改。');
      const cancel = element('button', 'vote-cancel', '返回');
      cancel.type = 'button';
      cancel.dataset.cancelVote = '';
      const confirm = element('button', 'vote-btn', '确认投票');
      confirm.type = 'button';
      confirm.dataset.confirmVote = nominee.id;
      confirmation.append(title, hint, cancel, confirm);
      actions.append(confirmation);
    } else {
      const voteButton = element('button', 'vote-btn' + (chosen ? ' voted-btn' : ''),
        chosen ? '已投此作' : myVote ? '本奖项已投票' : ui.busy ? '提交中…' : '投给此作');
      voteButton.type = 'button';
      voteButton.dataset.vote = nominee.id;
      voteButton.disabled = Boolean(myVote) || ui.busy;
      actions.append(voteButton, element('span', 'ballot-tally',
        `${fmt(votes)} 票 · ${total ? (votes / total * 100).toFixed(1) : '0'}%`));
    }
    content.append(actions);
    panel.append(content);
    modalBody.replaceChildren(panel);
  }

  function selectNominee(nomineeId) {
    ui.selectedNominee = nomineeId;
    ui.confirmingVote = false;
    modalNotice.textContent = '';
    renderModal(ui.openCategory);
    modalBody.scrollTop = 0;
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
    const button = modalBody.querySelector('.vote-btn:not(:disabled)');
    (nomineeId && button ? button : modal.querySelector('.icon-btn')).focus({ preventScroll: true });
    picker.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }

  modal.addEventListener('close', () => {
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
      modalBody.querySelector('[data-cancel-vote]')?.focus();
    }
  });

  function cancelConfirmation() {
    ui.confirmingVote = false;
    renderModal(ui.openCategory);
    modalBody.querySelector('[data-vote]')?.focus();
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

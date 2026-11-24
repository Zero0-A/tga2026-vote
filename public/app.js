(() => {
  const $ = (sel) => document.querySelector(sel);
  const gridEl = $('#categoryGrid');
  const tabsEl = $('#tabs');
  const modal = $('#modal');
  const modalBody = $('#modalBody');
  const modalTitle = $('#modalTitle');
  const modalEn = $('#modalEn');
  const modalHint = $('#modalHint');
  const modalMy = $('#modalMy');
  const toastEl = $('#toast');

  const ui = {
    data: null,
    activeTab: 'all',
    openCategory: null,
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
    const img = n.cover
      ? `<img loading="lazy" alt="${n.name} 封面" src="/covers/${n.id}.jpg" onerror="this.remove()" />`
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
        const idx = ui.data.categories.indexOf(c) + 1;
        const myVote = ui.data.myVotes[c.id];
        const chips = c.nominees.slice(0, 3).map((n) => `<span class="chip">${n.name}</span>`).join('');
        const more = c.nominees.length > 3 ? `<span class="chip more">+${c.nominees.length - 3}</span>` : '';
        const covers = c.nominees.filter((n) => n.cover).slice(0, 3).map((n) => coverCell(n)).join('');
        return `
          <article class="cat-card ${myVote ? 'voted' : ''}" data-id="${c.id}">
            ${covers ? `<div class="cover-strip">${covers}</div>` : ''}
            <div class="cat-top">
              <span class="cat-index">${String(idx).padStart(2, '0')}</span>
              <span class="cat-count ${myVote ? '' : 'live'}">${myVote ? '已投票' : '正在投票'}</span>
            </div>
            <p class="cat-en">${c.en}</p>
            <h3 class="cat-cn">${c.cn}</h3>
            <div class="chips">${chips}${more}</div>
            <div class="cat-foot">
              <span class="cat-status">${myVote ? `你的选择：<strong>${nomineeName(c, myVote)}</strong>` : `${c.nominees.length} 款提名 · ${fmt(categoryTotal(c))} 票`}</span>
              <button class="ghost-btn ${myVote ? 'outline' : ''}" data-open="${c.id}">${myVote ? '查看结果' : '去投票'}</button>
            </div>
          </article>`;
      })
      .join('');
  }

  /* ---------------- 弹窗 ---------------- */
  function renderModal(categoryId) {
    const c = findCategory(categoryId);
    if (!c) return;
    const myVote = ui.data.myVotes[c.id];
    const counts = countOf(c);
    const total = categoryTotal(c);

    modalTitle.textContent = c.cn;
    modalEn.textContent = c.en;
    modalMy.textContent = myVote ? `你的选择：${nomineeName(c, myVote)}` : '';
    modalHint.textContent = myVote ? '本奖项已完成投票' : '同一浏览器每个奖项限投一票';

    modalBody.innerHTML = c.nominees
      .map((n, i) => {
        const votes = counts[n.id] || 0;
        const pct = total ? (votes / total) * 100 : 0;
        const mine = myVote === n.id;
        let btn;
        if (mine) {
          btn = '<button class="vote-btn voted-btn" disabled>已投此作</button>';
        } else if (myVote) {
          btn = '<button class="vote-btn" disabled>已投票</button>';
        } else {
          btn = `<button class="vote-btn" data-vote="${n.id}">投票</button>`;
        }
        return `
          <div class="nominee ${mine ? 'mine' : ''}" data-nid="${n.id}">
            <div class="nominee-main">
              ${coverCell(n, 'nominee-cover')}
              <div class="nominee-info">
                <div class="nominee-name">${n.name}${mine ? '<span class="mine-tag">我的选择</span>' : ''}</div>
                <div class="nominee-sub">${String(i + 1).padStart(2, '0')} · ${n.en}${n.sub ? ' · ' + n.sub : ''}</div>
              </div>
              ${btn}
            </div>
            <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
            <div class="nominee-meta">
              <span class="pct">${pct.toFixed(1)}%</span>
              <span>${fmt(votes)} 票</span>
              <button class="intro-toggle" data-intro="${n.id}">游戏简介 ▾</button>
            </div>
            <div class="intro" data-intro-panel="${n.id}">${n.intro || '暂无简介。'}</div>
          </div>`;
      })
      .join('');
  }

  function openModal(categoryId) {
    ui.openCategory = categoryId;
    renderModal(categoryId);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    ui.openCategory = null;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

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
        renderModal(categoryId);
        showToast('投票成功，感谢参与！');
      } else if (res.status === 409) {
        ui.data.myVotes[categoryId] = data.votedFor;
        const cat = findCategory(categoryId);
        if (cat && data.counts) cat.counts = data.counts;
        renderCards();
        renderModal(categoryId);
        showToast('你已经在该奖项投过票了');
      } else {
        showToast(data.error || '投票失败，请稍后再试');
        renderModal(categoryId);
      }
    } catch (err) {
      showToast('网络异常，请检查服务是否正常运行');
      renderModal(categoryId);
    } finally {
      ui.busy = false;
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

  gridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.cat-card');
    if (!card) return;
    openModal(card.dataset.id);
  });

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closeModal();
      return;
    }
    const introBtn = e.target.closest('[data-intro]');
    if (introBtn) {
      const panel = modalBody.querySelector(`[data-intro-panel="${introBtn.dataset.intro}"]`);
      if (panel) {
        const open = panel.classList.toggle('open');
        introBtn.textContent = open ? '收起简介 ▴' : '游戏简介 ▾';
      }
      return;
    }
    const voteBtn = e.target.closest('[data-vote]');
    if (voteBtn && ui.openCategory) {
      vote(ui.openCategory, voteBtn.dataset.vote, voteBtn);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  /* ---------------- 初始化 ---------------- */
  async function init() {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('bad status');
      ui.data = await res.json();
      renderStats();
      renderCards();
      startCountdown(ui.data.event.ceremonyAt);
    } catch (err) {
      gridEl.innerHTML = '<div class="loading">加载失败，请确认服务已启动后刷新页面。</div>';
    }
  }

  init();
})();

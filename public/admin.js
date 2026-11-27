(() => {
  const $ = (s) => document.querySelector(s);
  const loginView = $('#loginView');
  const dashView = $('#dashView');
  const notice = $('#dashboardNotice');
  const awardPicker = $('#reportAward');
  const datePicker = $('#reportDate');

  let cloud = null;
  let sdkLoading = false;

  function connectCloud() {
    if (cloud || sdkLoading) return;
    sdkLoading = true;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';
    script.onload = () => {
      try {
        cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
          endpoint: 'https://tga2026-vote.app.workbuddy.host',
          oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
          publishableKey: 'wbpk_RAfiDZV87lfCVLYCIsVx2i_koKqsmoDnjqi8P9mcDNluoNgES5IO3Yc'
        });
      } catch {
        cloud = null;
      }
      sdkLoading = false;
      if (statsData && cloud) loadStats();
      else if (statsData) renderView();
    };
    script.onerror = () => {
      sdkLoading = false;
      script.remove();
      if (statsData) renderView();
    };
    document.head.append(script);
  }

  function applyCloudBreakdown(analytics, payload) {
    const data = Array.isArray(payload) ? payload[0] || {} : payload || {};
    const byDevice = data.byDevice || {};
    const daily = Array.isArray(data.daily) ? data.daily : [];

    const fill = (bucket, votes, voters) => {
      if (!bucket) return;
      bucket.votes = votes;
      bucket.voters = voters;
      bucket.converted = voters;
      bucket.conversionRate = bucket.visitors ? Math.round((voters / bucket.visitors) * 10000) / 100 : null;
    };

    let allVotes = 0;
    let allVoters = 0;
    for (const [device, bucket] of Object.entries(analytics.summary)) {
      if (device === 'all') continue;
      const row = byDevice[device] || {};
      const votes = Number(row.votes || 0);
      const voters = Number(row.voters || 0);
      fill(bucket, votes, voters);
      allVotes += votes;
      allVoters += voters;
    }
    fill(analytics.summary.all, allVotes, allVoters);

    const byDate = new Map();
    for (const row of daily) {
      const key = String(row.date || '').slice(0, 10);
      if (!key) continue;
      if (!byDate.has(key)) byDate.set(key, {});
      byDate.get(key)[row.device || 'unknown'] = { votes: Number(row.votes || 0), voters: Number(row.voters || 0) };
    }
    for (const day of analytics.daily || []) {
      const rows = byDate.get(day.date) || {};
      let dayVotes = 0;
      let dayVoters = 0;
      for (const [device, bucket] of Object.entries(day.groups)) {
        if (device === 'all') continue;
        const row = rows[device] || {};
        const votes = Number(row.votes || 0);
        const voters = Number(row.voters || 0);
        fill(bucket, votes, voters);
        dayVotes += votes;
        dayVoters += voters;
      }
      fill(day.groups.all, dayVotes, dayVoters);
    }
    analytics.cloudBacked = true;
  }

  async function overlayRecentVotes(d) {
    const labels = new Map();
    for (const category of d.categories) {
      for (const nominee of category.nominees) {
        labels.set(category.id + '|' + nominee.id, { category: category.cn, nominee: nominee.name });
      }
    }
    const { data, error } = await cloud.database.rpc('recent_votes', { p_limit: 30 });
    if (error || !Array.isArray(data)) return;
    d.recentCloudBacked = true;
    d.recent = data.map((row) => {
      const label = labels.get(row.category_id + '|' + row.nominee_id) || {};
      return {
        category: label.category || row.category_id,
        nominee: label.nominee || row.nominee_id,
        device: row.device || 'unknown',
        ts: Date.parse(row.created_at)
      };
    });
  }

  /* 票数真实来源是云数据库，服务端本地存档不再记录投票 */
  async function overlayCloudStats(d) {
    if (!cloud || !d) return d;
    try {
      const { data, error } = await cloud.database.rpc('vote_summary');
      const summary = Array.isArray(data) ? data[0] : data;
      if (error || !summary || !Number.isFinite(Number(summary.totalVotes))) return d;
      const tallies = summary.tallies || {};
      d.totalVotes = Number(summary.totalVotes || 0);
      d.voters = Number(summary.voters || 0);
      for (const category of d.categories) {
        const tally = tallies[category.id] || {};
        category.total = Object.values(tally).reduce((sum, n) => sum + Number(n || 0), 0);
        for (const nominee of category.nominees) nominee.votes = Number(tally[nominee.id] || 0);
        category.nominees.sort((a, b) => b.votes - a.votes);
        const base = category.total || 1;
        for (const nominee of category.nominees) {
          nominee.pct = Math.round((nominee.votes / base) * 1000) / 10;
        }
      }
      d.cloudBacked = true;
    } catch {
      return d;
    }
    await Promise.allSettled([
      cloud.database.rpc('vote_breakdown').then(({ data, error }) => {
        if (d.analytics && data && !error) applyCloudBreakdown(d.analytics, data);
      }),
      overlayRecentVotes(d)
    ]);
    return d;
  }

  let statsData = null;
  let statsRequest = 0;
  let archiveRequest = 0;
  let archiveBusy = false;
  let archiveListKey = '';
  let awardActivity = null;
  let awardRequest = 0;
  let autoTimer = null;
  let activeView = 'overview';
  let lastSync = null;
  const sections = [...document.querySelectorAll('[data-view]')];
  const viewLinks = [...document.querySelectorAll('.view-nav a')];

  const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
  const TAB_NAMES = { game: '游戏类', esports: '电竞类', production: '制作类' };
  const DEVICE_NAMES = { all: '全部设备', mobile: '移动端', desktop: '电脑端', tablet: '平板', unknown: '未知' };
  const CHANNEL_NAMES = { qq: 'QQ', wechat: '微信', bilibili: 'B 站', xiaohongshu: '小红书', untagged: '直接访问／未标记' };
  const formatVoteTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });

  const fmtRate = rate => rate === null ? '—' : rate + '%';

  async function api(url, options = {}) {
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: '网络异常，请重试。' } };
    }
  }

  function showLogin(expired = false) {
    statsRequest++;
    awardRequest++;
    archiveRequest++;
    archiveListKey = '';
    statsData = null;
    awardActivity = null;
    lastSync = null;
    clearInterval(autoTimer);
    autoTimer = null;
    if ($('#resetDialog').open) $('#resetDialog').close();
    dashView.hidden = true;
    $('#logoutBtn').hidden = true;
    loginView.hidden = false;
    $('#passwordInput').type = 'password';
    $('#showPassword').textContent = '显示';
    $('#showPassword').setAttribute('aria-pressed', 'false');
    $('#showPassword').setAttribute('aria-label', '显示密码');
    $('#loginErr').textContent = expired ? '登录已过期，请重新输入管理密码。' : '';
    $('#passwordInput').removeAttribute('aria-invalid');
    notice.textContent = '';
    $('#archiveFeedback').textContent = '';
    $('#archiveStatus').textContent = '';
    $('#archiveList').replaceChildren();
    $('#resetStatus').textContent = '';
    $('#archiveBtn').disabled = true;
    $('#resetBtn').disabled = true;
    $('#awardSearch').value = '';
    awardPicker.replaceChildren();
    if (expired) $('#passwordInput').focus();
  }

  function updateAuto() {
    clearInterval(autoTimer);
    autoTimer = $('#autoBtn').checked && !dashView.hidden
      ? setInterval(() => {
        if (!document.hidden && !$('#refreshBtn').disabled) loadStats(true);
      }, 15000)
      : null;
  }

  function route(focus = false) {
    const [view, awardId] = location.hash.slice(1).split('/');
    activeView = sections.some(section => section.dataset.view === view) ? view : 'overview';
    for (const section of sections) section.hidden = section.dataset.view !== activeView;
    for (const link of viewLinks) {
      if (link.hash === '#' + activeView) {
        link.setAttribute('aria-current', 'page');
        $('#statsTitle').textContent = link.textContent;
      } else {
        link.removeAttribute('aria-current');
      }
    }
    if (statsData) {
      if (activeView === 'awards' && awardId) $('#awardSearch').value = '';
      renderView(true, awardId);
      if (activeView === 'archives') loadArchives();
    }
    if (focus && !dashView.hidden) {
      $('#statsTitle').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  async function loadStats(silent = false) {
    const request = ++statsRequest;
    const refresh = $('#refreshBtn');
    refresh.disabled = true;
    if (!silent) refresh.textContent = '刷新中…';
    const { ok, status, data } = await api('/api/admin/stats');
    if (request !== statsRequest) return;
    if (ok) await overlayCloudStats(data);
    if (request !== statsRequest) return;
    refresh.disabled = false;
    refresh.textContent = '立即刷新';
    if (!ok) {
      if (status === 401) showLogin(!dashView.hidden);
      else if (dashView.hidden) $('#loginErr').textContent = data.error || '后台暂时无法连接，请重试。';
      else report(data.error || '刷新失败，请重试。', 'refresh-error');
      return;
    }
    if (notice.dataset.state === 'refresh-error') notice.textContent = '';
    const firstLoad = !statsData;
    statsData = data;
    lastSync = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    if (firstLoad) {
      loginView.hidden = true;
      dashView.hidden = false;
      $('#logoutBtn').hidden = false;
      connectCloud();
      route();
      updateAuto();
    } else {
      renderView(true);
      if (activeView === 'archives' && !archiveBusy) loadArchives();
    }
  }

  function report(message, state = 'error') {
    notice.dataset.state = state;
    notice.textContent = message;
  }

  function analyticsCells(row) {
    return [fmt(row.visits), fmt(row.visitors), fmt(row.voters), fmt(row.votes), fmtRate(row.conversionRate)]
      .map(value => '<td>' + value + '</td>').join('');
  }

  function renderAnalytics(analytics) {
    $('#analytics').hidden = !analytics;
    $('#analyticsUnavailable').hidden = Boolean(analytics);
    if (!analytics) return;
    const source = analytics.cloudBacked ? '本地访问、云端投票' : '本地访问与投票';
    const period = analytics.since ? source + ' · 自 ' + analytics.since + ' 起统计（北京时间）。' : source + ' · 暂无本地访问起始日期。';
    $('#conversionNote').textContent = analytics.cloudBacked ?
      '转化率按云端投票人数除以本地独立访客估算。' :
      '人数按浏览器去重。转化率为所选范围内，既访问又投票的访客占独立访客的比例。';
    const legacy = analytics.legacyVotes ? ' 另有 ' + fmt(analytics.legacyVotes) + ' 票缺少设备记录，已计入本地累计票数。' : '';
    $('#analyticsPeriod').textContent = period + legacy;
    $('#analyticsSummary').innerHTML = Object.entries(DEVICE_NAMES).map(([key, name]) =>
      '<tr data-device="' + key + '"><th scope="row">' + name + '</th>' + analyticsCells(analytics.summary[key]) + '</tr>'
    ).join('');
    $('#exportAnalyticsBtn').disabled = !analytics.daily.length;
    const channels = analytics.channels || {};
    $('#channelRows').innerHTML = Object.entries(CHANNEL_NAMES).map(([key, name]) => {
      const row = channels[key];
      return '<tr><th scope="row">' + name + '</th><td>' + fmt(row?.visits) + '</td><td>' + fmt(row?.visitors) + '</td></tr>';
    }).join('');
    $('#exportChannelBtn').disabled = !Object.values(channels).some(row => row.visits > 0);
    renderTrend();
  }

  function renderTrend() {
    const analytics = statsData?.analytics;
    if (!analytics) return;
    const device = $('#analyticsDevice').value;
    const metric = $('#analyticsMetric').value;
    const days = analytics.daily.slice(-14).map(day => ({ date: day.date, row: day.groups[device] }));
    const values = days.map(day => day.row[metric] ?? 0);
    const scale = metric === 'conversionRate' ? 100 : Math.max(1, ...values);
    const hasData = days.some(day => day.row.visits || day.row.votes);
    $('#analyticsEmpty').classList.toggle('hidden', hasData);
    const plot = $('#analyticsPlot');
    plot.classList.toggle('hidden', !hasData);
    plot.innerHTML = days.map(({ date, row }, index) => {
      const tick = index === 0 || index === days.length - 1 || (index % 4 === 0 && index < days.length - 2);
      const label = metric === 'conversionRate' ? fmtRate(row[metric]) : fmt(row[metric]);
      return '<div class="analytics-day" title="' + date + ' · ' + label + '"><div class="analytics-track"><i style="height:' +
        values[index] / scale * 100 + '%"></i></div><time datetime="' + date + '"' +
        (tick ? ' class="chart-tick"' : '') + '>' + date.slice(5) + '</time></div>';
    }).join('');
    $('#analyticsDaily').innerHTML = days.length ? days.reverse().map(({ date, row }) =>
      '<tr><th scope="row"><time datetime="' + date + '">' + date.slice(5) + '</time></th>' + analyticsCells(row) + '</tr>'
    ).join('') : '<tr><td colspan="6">暂无统计数据</td></tr>';
  }

  async function loadAwardActivity(showLoading = false) {
    if (!awardPicker.value) return;
    const request = ++awardRequest;
    const status = $('#awardReportStatus');
    if (showLoading) {
      awardActivity = null;
      $('#awardOverview').textContent = '';
      $('#awardDaily').replaceChildren();
      datePicker.replaceChildren();
      datePicker.disabled = true;
      $('#awardNominees').replaceChildren();
      $('#exportAwardBtn').disabled = true;
      status.textContent = '正在加载奖项明细…';
    }
    const { ok, data } = await api('/api/admin/award-activity?categoryId=' + encodeURIComponent(awardPicker.value));
    if (request !== awardRequest || !statsData) return;
    if (!ok) {
      status.textContent = data.error || '奖项明细加载失败。';
      return;
    }
    awardActivity = data;
    const { summary, daily } = data;
    $('#awardOverview').textContent = [
      '累计打开 ' + fmt(summary.opens) + ' 次',
      '打开人数 ' + fmt(summary.visitors),
      '投票人数 ' + fmt(summary.voters),
      '累计 ' + fmt(summary.votes) + ' 票'
    ].join(' · ');
    const tracking = data.opensSince ? '奖项打开数据自 ' + data.opensSince + ' 起累计。' : '首次打开该奖项后开始统计打开人数。';
    status.textContent = tracking + (data.undatedVotes ? ' 另有 ' + fmt(data.undatedVotes) + ' 张旧票缺少日期，已计入累计。' : '');
    const selected = datePicker.value;
    $('#awardDaily').innerHTML = daily.map(day => '<tr><th scope="row">' + day.date + '</th>' +
      [fmt(day.opens), fmt(day.visitors), fmt(day.voters), fmt(day.votes), fmtRate(day.conversionRate)]
        .map(value => '<td>' + value + '</td>').join('') + '</tr>').join('') ||
      '<tr><td colspan="6">暂无每日记录</td></tr>';
    if (daily.length !== datePicker.length || daily.some((day, i) => day.date !== datePicker.options[i].value)) {
      datePicker.replaceChildren(...daily.map(day => new Option(day.date, day.date)));
    }
    if (daily.some(day => day.date === selected)) datePicker.value = selected;
    datePicker.disabled = !daily.length;
    $('#exportAwardBtn').disabled = !daily.length && !data.undatedVotes;
    renderAwardNominees();
  }

  function renderAwardNominees() {
    const day = awardActivity?.daily.find(row => row.date === datePicker.value);
    const tbody = $('#awardNominees');
    tbody.replaceChildren();
    if (!day) {
      tbody.innerHTML = '<tr><td colspan="2">暂无候选单日记录</td></tr>';
      return;
    }
    for (const nominee of awardActivity.nominees) {
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = nominee.name;
      row.append(name);
      row.insertCell().textContent = fmt(day.nomineeVotes[nominee.id]);
      tbody.append(row);
    }
  }

  async function loadArchives() {
    const request = ++archiveRequest;
    const { ok, data } = await api('/api/admin/archives');
    if (request !== archiveRequest || !statsData) return;
    if (!ok) {
      $('#archiveStatus').textContent = data.error || '归档列表加载失败。';
      $('#resetBtn').disabled = true;
      return;
    }
    const list = $('#archiveList');
    $('#archiveBtn').disabled = archiveBusy || !statsData.cloudBacked;
    $('#archiveSource').textContent = statsData.cloudBacked ? '' : '请先刷新并连接云端，以获取可归档的票数。';
    $('#resetBtn').disabled = Boolean(data.publishedId) || !cloud;
    $('#resetStatus').textContent = data.publishedId ? '结果已公布，投票数据已锁定。' :
      !cloud ? '连接云端后可清空投票。' : '';
    $('#archiveStatus').textContent = data.publishedId ? '结果已公布，投票已结束。' :
      data.canPublish ? '现在可以公布结果。' :
        '最早可于 ' + formatVoteTime.format(data.availableAt) + '（北京时间）公布。';
    const listKey = JSON.stringify([data.archives, data.publishedId, data.canPublish]);
    if (archiveListKey === listKey) return;
    archiveListKey = listKey;
    list.replaceChildren();
    if (!data.archives.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '暂无结果归档';
      list.append(empty);
      return;
    }
    for (const archive of data.archives) {
      const item = document.createElement('li');
      item.className = 'archive-entry';
      const label = document.createElement('p');
      const captured = document.createElement('time');
      captured.dateTime = new Date(archive.archivedAt).toISOString();
      captured.textContent = formatVoteTime.format(archive.archivedAt) + '（北京时间）';
      label.append(captured, fmt(archive.totalVotes) + ' 票 · ' + fmt(archive.voters) + ' 位投票者');
      const links = document.createElement('div');
      links.className = 'archive-actions';
      const csv = document.createElement('a');
      csv.className = 'btn';
      csv.href = '/api/admin/archives/' + encodeURIComponent(archive.id) + '/results';
      csv.textContent = '下载结果 CSV';
      links.append(csv);
      if (archive.id === data.publishedId) {
        const link = document.createElement('a');
        link.className = 'btn';
        link.href = '/results';
        link.textContent = '查看已公布结果';
        links.append(link);
      } else if (data.canPublish && archive === data.archives[0]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.dataset.publishArchive = archive.id;
        button.textContent = '正式公布';
        links.append(button);
      }
      item.append(label, links);
      list.append(item);
    }
  }

  function sourceLabel() {
    if (statsData.cloudBacked) return '云端票数';
    return sdkLoading ? '云端连接中 · 暂示本地票数' : '云端未连接 · 本地票数';
  }

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function renderOverview() {
    const { categories, recent, totalVotes, voters } = statsData;
    $('#dTotalVotes').textContent = fmt(totalVotes);
    $('#dVoters').textContent = fmt(voters);
    const voted = categories.filter(category => category.total > 0);
    $('#dCatVoted').innerHTML = fmt(voted.length) + ' <small>/ ' + fmt(categories.length) + '</small>';
    const pct = categories.length ? Math.round(voted.length / categories.length * 100) : 0;
    $('#coverage').textContent = '覆盖 ' + pct + '% 的奖项';
    const top = voted.sort((a, b) => b.total - a.total).slice(0, 5);
    const ranks = top.map((category, index) => `
      <li><a class="rank-link" href="#awards/${encodeURIComponent(category.id)}">
        <span class="rank-index">${String(index + 1).padStart(2, '0')}</span>
        <span><b>${escapeHtml(category.cn)}</b><span class="rank-track"><i style="width:${category.total / top[0].total * 100}%"></i></span></span>
        <small>${fmt(category.total)} 票 ›</small>
      </a></li>`).join('') || '<li class="empty">首张选票提交后，这里会显示奖项排行。</li>';
    const rankList = $('#rankList');
    const focusHref = rankList.contains(document.activeElement) ? document.activeElement.hash : '';
    rankList.innerHTML = ranks;
    if (focusHref) [...rankList.querySelectorAll('a')].find(link => link.hash === focusHref)?.focus({ preventScroll: true });

    const recentSource = statsData.recentCloudBacked ? '云端' : '本地';
    $('#recentSource').textContent = '最近 30 条' + recentSource + '记录 · 北京时间';
    $('#recentList').innerHTML = recent.map(row => {
      const time = Number.isFinite(row.ts) ? formatVoteTime.format(row.ts) : '时间未知';
      return `<div class="recent-row"><div><b>${escapeHtml(row.nominee)}</b><small>${escapeHtml(row.category)}</small></div>
        <div class="recent-meta">${time}<small>${escapeHtml(DEVICE_NAMES[row.device] || '未知')}</small></div></div>`;
    }).join('') || '<p class="empty">暂无' + recentSource + '投票记录。</p>';
  }

  function renderAwards(refreshDaily = false, preferredId) {
    const query = $('#awardSearch').value.trim().toLocaleLowerCase();
    const matches = statsData.categories.filter(category => !query ||
      [category.cn, category.en, ...category.nominees.flatMap(n => [n.name, n.en])]
        .some(name => name?.toLocaleLowerCase().includes(query)));
    const next = matches.find(category => category.id === (preferredId || awardPicker.value)) || matches[0];
    const changed = next?.id !== awardPicker.dataset.selected;
    if (matches.length !== awardPicker.length || matches.some((item, i) => awardPicker.options[i].value !== item.id)) {
      awardPicker.replaceChildren(...matches.map(category => new Option(category.cn, category.id)));
    }
    $('#awardMatches').textContent = '（' + fmt(matches.length) + ' 项）';
    $('#exportBtn').disabled = !statsData.categories.length;
    awardPicker.disabled = !next;
    $('#awardEmpty').hidden = Boolean(next);
    $('#awardDetail').hidden = !next;
    if (!next) {
      awardRequest++;
      delete awardPicker.dataset.selected;
      awardActivity = null;
      return;
    }
    awardPicker.value = next.id;
    awardPicker.dataset.selected = next.id;
    $('#awardGroup').textContent = TAB_NAMES[next.tab] || next.tab;
    $('#awardName').textContent = next.cn;
    $('#awardSubtitle').textContent = next.en;
    $('#awardTotal').textContent = fmt(next.total);
    $('#nomineeList').innerHTML = next.nominees.map(n => `<li>
      <div class="nominee-line"><b>${escapeHtml(n.name)}</b><span>${fmt(n.votes)} 票 · ${fmt(n.pct)}%</span></div>
      ${n.en && n.name !== n.en ? '<small lang="en">' + escapeHtml(n.en) + '</small>' : ''}
      <div class="vote-track"><i style="width:${Number(n.pct)}%"></i></div></li>`).join('') || '<li class="empty">暂无提名</li>';
    if (changed || refreshDaily) loadAwardActivity(changed || !awardActivity);
  }

  function renderView(refreshDaily = false, preferredId) {
    $('#lastUpdated').textContent = '最近更新 ' + lastSync + ' · 北京时间';
    document.querySelectorAll('.source-label').forEach(label => { label.textContent = sourceLabel(); });
    if (activeView === 'overview') renderOverview();
    if (activeView === 'awards') renderAwards(refreshDaily, preferredId);
    if (activeView === 'analytics') renderAnalytics(statsData.analytics);
  }

  window.addEventListener('hashchange', () => route(true));
  $('#awardSearch').addEventListener('input', () => {
    history.replaceState(null, '', '#awards');
    renderAwards();
  });
  $('#clearSearch').addEventListener('click', () => {
    $('#awardSearch').value = '';
    renderAwards();
    $('#awardSearch').focus();
  });
  awardPicker.addEventListener('change', () => {
    history.replaceState(null, '', '#awards/' + encodeURIComponent(awardPicker.value));
    renderAwards();
  });

  $('#showPassword').addEventListener('click', event => {
    const input = $('#passwordInput');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? '隐藏' : '显示';
    event.currentTarget.setAttribute('aria-pressed', String(show));
    event.currentTarget.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  });
  $('#passwordInput').addEventListener('input', () => {
    $('#passwordInput').removeAttribute('aria-invalid');
    $('#loginErr').textContent = '';
  });

  /* 登录 */
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const errEl = $('#loginErr');
    btn.disabled = true;
    btn.textContent = '登录中…';
    errEl.textContent = '';
    const entered = $('#passwordInput').value;
    const { ok, data } = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: entered })
    });
    btn.disabled = false;
    btn.textContent = '进入后台';
    if (ok) {
      $('#passwordInput').value = '';
      await loadStats();
      if (!dashView.hidden) $('#statsTitle').focus({ preventScroll: true });
    } else {
      $('#passwordInput').setAttribute('aria-invalid', 'true');
      $('#passwordInput').focus();
      errEl.textContent = data.error || '登录失败';
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    const { ok, data } = await api('/api/admin/logout', { method: 'POST' });
    if (ok) {
      history.replaceState(null, '', location.pathname + location.search);
      showLogin();
      $('#passwordInput').focus();
    } else {
      report(data.error || '退出失败，请重试。');
    }
  });

  $('#refreshBtn').addEventListener('click', () => {
    notice.textContent = '';
    if (statsData && !cloud) connectCloud();
    loadStats();
  });
  $('#autoBtn').addEventListener('change', updateAuto);

  $('#analyticsDevice').addEventListener('change', renderTrend);
  $('#analyticsMetric').addEventListener('change', renderTrend);
  datePicker.addEventListener('change', renderAwardNominees);

  $('#archiveBtn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const feedback = $('#archiveFeedback');
    if (archiveBusy || !statsData?.cloudBacked) return;
    archiveBusy = true;
    button.disabled = true;
    feedback.textContent = '正在归档当前结果…';
    const { categories, totalVotes, voters } = statsData;
    const { ok, data } = await api('/api/admin/archives', {
      method: 'POST',
      body: JSON.stringify({ results: { categories, totalVotes, voters } })
    });
    archiveBusy = false;
    if (!statsData) return;
    feedback.textContent = ok ? '归档完成，可下载结果 CSV。' : data.error || '归档失败，请重试。';
    if (ok) await loadArchives();
    button.disabled = !statsData?.cloudBacked;
  });

  $('#archiveList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-publish-archive]');
    if (!button || !confirm('公布这份归档后，公众可查看最终结果，投票将结束。确定公布吗？')) return;
    button.disabled = true;
    const { ok, data } = await api('/api/admin/publish-results', {
      method: 'POST',
      body: JSON.stringify({ archiveId: button.dataset.publishArchive })
    });
    if (ok) {
      await loadArchives();
    } else {
      $('#archiveStatus').textContent = data.error || '公布失败，请重试。';
      button.disabled = false;
    }
  });

  function downloadCsv(filename, lines) {
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function csvLine(values) {
    return values.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',');
  }

  $('#exportChannelBtn').addEventListener('click', () => {
    const channels = statsData?.analytics?.channels;
    if (!channels) return;
    const lines = ['渠道,访问量,独立访客'];
    for (const [key, label] of Object.entries(CHANNEL_NAMES)) {
      const row = channels[key];
      lines.push(csvLine([label, row.visits, row.visitors]));
    }
    downloadCsv('suyou-channels.csv', lines);
  });

  $('#exportAwardBtn').addEventListener('click', () => {
    if (!awardActivity) return;
    const { categoryId, categoryName, daily, nominees, undatedVotes } = awardActivity;
    const lines = ['日期,奖项,记录类型,候选,打开次数,打开人数,投票人数,票数,转化率'];
    for (const day of daily) {
      const rate = day.conversionRate === null ? '' : fmtRate(day.conversionRate);
      lines.push(csvLine([day.date, categoryName, '奖项汇总', '', day.opens, day.visitors, day.voters, day.votes, rate]));
      for (const nominee of nominees) {
        lines.push(csvLine([day.date, categoryName, '候选票数', nominee.name, '', '', '', day.nomineeVotes[nominee.id] || 0, '']));
      }
    }
    if (undatedVotes) lines.push(csvLine(['时间未知', categoryName, '旧票', '', '', '', '', undatedVotes, '']));
    downloadCsv('suyou-award-' + categoryId + '.csv', lines);
  });

  $('#exportAnalyticsBtn').addEventListener('click', () => {
    const analytics = statsData?.analytics;
    if (!analytics) return;
    const lines = ['日期,设备,访问量,独立访客,投票人数,票数,转化率'];
    const periods = [{ date: '累计', groups: analytics.summary }, ...analytics.daily];
    for (const { date, groups } of periods) {
      for (const [device, name] of Object.entries(DEVICE_NAMES)) {
        const row = groups[device];
        lines.push([date, name, row.visits, row.visitors, row.voters, row.votes,
          row.conversionRate === null ? '' : fmtRate(row.conversionRate)].join(','));
      }
    }
    downloadCsv('tga2026-analytics-' + analytics.daily.at(-1).date + '.csv', lines);
  });

  $('#exportBtn').addEventListener('click', () => {
    if (!statsData) return;
    const lines = ['奖项分类,奖项(中文),奖项(英文),提名,票数,占比'];
    statsData.categories.forEach((c) => {
      c.nominees.forEach((n) => {
        lines.push(csvLine([TAB_NAMES[c.tab] || c.tab, c.cn, c.en, n.name, n.votes, n.votes > 0 ? n.pct + '%' : '0%']));
      });
    });
    downloadCsv('tga2026-votes-' + new Date().toISOString().slice(0, 10) + '.csv', lines);
  });

  /* ---------------- 逐票管理 ---------------- */
  const voteDayInput = $('#voteDay');
  const voteKeyInput = $('#voteKey');
  const voteStatus = $('#voteStatus');
  const voteRowsEl = $('#voteRows');
  const voteCategorySel = $('#voteCategory');
  const voteClearBtn = $('#voteClear');
  let voteRows = [];

  function beijingToday() {
    return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  }

  function voteKeyValue() {
    const raw = voteKeyInput.value.trim();
    return raw ? raw.normalize('NFKC') : '';
  }

  function voteLabel(categoryId, nomineeId) {
    const category = statsData?.categories.find(item => item.id === categoryId);
    const nominee = category?.nominees.find(item => item.id === nomineeId);
    return { category: category?.cn || categoryId, nominee: nominee?.name || nomineeId };
  }

  function voteError(error, fallback) {
    return String(error?.code || '').endsWith('42501') ? '管理密码不正确。' : fallback;
  }

  function renderVoteRows() {
    if (!voteRows.length) {
      voteRowsEl.innerHTML = '<tr><td colspan="6">这一天没有投票记录。</td></tr>';
      voteClearBtn.disabled = true;
      return;
    }
    voteRowsEl.innerHTML = voteRows.map((row) => {
      const label = voteLabel(row.category_id, row.nominee_id);
      return '<tr><td>' + formatVoteTime.format(Date.parse(row.created_at)) + '</td>' +
        '<td>' + escapeHtml(label.category) + '</td>' +
        '<td>' + escapeHtml(label.nominee) + '</td>' +
        '<td>' + escapeHtml(DEVICE_NAMES[row.device] || '未知') + '</td>' +
        '<td><code>' + escapeHtml(row.voter_short || '') + '</code></td>' +
        '<td><button class="btn danger small" type="button" data-delete-vote="' + row.id + '">删除</button></td></tr>';
    }).join('');

    const ids = [...new Set(voteRows.map(row => row.category_id))];
    const current = voteCategorySel.value;
    voteCategorySel.replaceChildren(new Option('当天全部', ''),
      ...ids.map(id => new Option(voteLabel(id).category, id)));
    if (ids.includes(current)) voteCategorySel.value = current;
    voteClearBtn.disabled = false;
  }

  async function loadVoteRows() {
    if (!cloud) {
      voteStatus.textContent = '云端未连接，无法读取投票明细。';
      return;
    }
    const key = voteKeyValue();
    if (!key) {
      voteStatus.textContent = '请先输入管理密码。';
      return;
    }
    const day = voteDayInput.value || beijingToday();
    voteStatus.textContent = '正在读取…';
    try {
      const { data, error } = await cloud.database.rpc('admin_vote_rows', { p_key: key, p_day: day });
      if (error) {
        voteRows = [];
        voteStatus.textContent = voteError(error, '读取失败，请稍后重试。');
        renderVoteRows();
        return;
      }
      voteRows = data || [];
      voteStatus.textContent = day + ' 共 ' + fmt(voteRows.length) + ' 票。';
      renderVoteRows();
    } catch {
      voteStatus.textContent = '网络异常，请重试。';
    }
  }

  voteDayInput.value = beijingToday();
  $('#voteLoad').addEventListener('click', loadVoteRows);
  voteDayInput.addEventListener('change', () => {
    if (voteKeyValue()) loadVoteRows();
  });

  voteRowsEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-vote]');
    if (!button) return;
    const id = Number(button.dataset.deleteVote);
    const row = voteRows.find(item => Number(item.id) === id);
    const label = row ? voteLabel(row.category_id, row.nominee_id) : {};
    const key = voteKeyValue();
    if (!key) {
      voteStatus.textContent = '请先输入管理密码。';
      return;
    }
    if (!confirm('确定删除这一票（' + (label.nominee || id) + '）？此操作不可恢复。')) return;
    button.disabled = true;
    const { data, error } = await cloud.database.rpc('admin_delete_votes', { p_key: key, p_ids: [id] });
    if (error) {
      button.disabled = false;
      voteStatus.textContent = voteError(error, '删除失败，请重试。');
      return;
    }
    await loadVoteRows();
    await loadStats(true);
    voteStatus.textContent = '已删除 ' + fmt(data) + ' 票。';
  });

  voteClearBtn.addEventListener('click', async () => {
    const key = voteKeyValue();
    if (!key) {
      voteStatus.textContent = '请先输入管理密码。';
      return;
    }
    const day = voteDayInput.value || beijingToday();
    const categoryId = voteCategorySel.value;
    const label = categoryId ? voteLabel(categoryId).category : '当天全部奖项';
    if (!confirm('确定删除「' + label + '」在 ' + day + ' 的全部投票？此操作不可恢复。')) return;
    voteClearBtn.disabled = true;
    const params = { p_key: key, p_day: day };
    if (categoryId) params.p_category = categoryId;
    const { data, error } = await cloud.database.rpc('admin_clear_votes', params);
    voteClearBtn.disabled = false;
    if (error) {
      voteStatus.textContent = voteError(error, '删除失败，请重试。');
      return;
    }
    await loadVoteRows();
    await loadStats(true);
    voteStatus.textContent = '已删除 ' + fmt(data) + ' 票。';
  });

  const resetDialog = $('#resetDialog');
  const resetForm = $('#resetForm');
  const resetSubmit = resetForm.querySelector('[type="submit"]');
  $('#resetBtn').addEventListener('click', () => resetDialog.showModal());
  $('#cancelReset').addEventListener('click', () => resetDialog.close());
  resetDialog.addEventListener('cancel', event => {
    if (resetSubmit.disabled) event.preventDefault();
  });
  resetDialog.addEventListener('close', () => {
    resetForm.reset();
    $('#resetError').textContent = '';
  });
  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (resetSubmit.disabled || !cloud || $('#resetBtn').disabled) return;
    resetSubmit.disabled = true;
    $('#cancelReset').disabled = true;
    $('#resetError').textContent = '正在清空云端投票…';
    try {
      const { data, error } = await cloud.database.rpc('admin_clear_votes', {
        p_key: $('#resetPassword').value.normalize('NFKC')
      });
      if (error) {
        $('#resetError').textContent = String(error.code).endsWith('42501') ? '管理密码不正确，请重试。' : '清空失败，请重试。';
        return;
      }
      resetDialog.close();
      await loadStats();
      report('已清空 ' + fmt(data) + ' 条云端投票记录。', 'success');
    } catch {
      $('#resetError').textContent = '清空失败，请检查网络后重试。';
    } finally {
      resetSubmit.disabled = false;
      $('#cancelReset').disabled = false;
    }
  });

  loadStats();
})();

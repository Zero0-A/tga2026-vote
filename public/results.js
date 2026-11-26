(() => {
  const status = document.querySelector('#resultsStatus');
  const retry = document.querySelector('#resultsRetry');
  const awards = document.querySelector('#resultsAwards');
  const fmt = new Intl.NumberFormat('zh-CN');
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric'
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function renderAward(category) {
    const article = element('article', 'result-award');
    const title = element('div');
    const english = element('p', 'result-award-en', category.en);
    english.lang = 'en';
    title.append(element('h2', '', category.cn), english);
    const winner = element('p', 'result-winner');
    const best = Math.max(0, ...category.nominees.map(nominee => nominee.votes));
    if (best > 0) {
      const names = category.nominees.filter(nominee => nominee.votes === best).map(nominee => nominee.name);
      winner.append(element('span', '', names.length > 1 ? '并列第一' : '票选第一'), ' · ' + names.join('、'));
    } else {
      winner.textContent = '暂无得票';
    }
    const details = element('details');
    const ballots = element('ul', 'result-ballots');
    for (const nominee of category.nominees) {
      const row = element('li');
      row.append(element('span', '', nominee.name), element('span', '', fmt.format(nominee.votes) + ' 票 · ' + nominee.pct + '%'));
      ballots.append(row);
    }
    details.append(element('summary', '', '全部候选 · ' + fmt.format(category.total) + ' 票'), ballots);
    article.append(title, winner, details);
    return article;
  }

  async function loadResults() {
    retry.hidden = true;
    try {
      const response = await fetch('/api/results');
      if (!response.ok) throw new Error('Results unavailable');
      const { availableAt, results } = await response.json();
      if (!results) {
        status.textContent = '结果待公布。计划于 ' + date.format(availableAt) + '（北京时间，TGA 颁奖典礼前一天）公布。';
        setTimeout(loadResults, 30000);
        return;
      }
      status.textContent = '已于 ' + date.format(results.publishedAt) + '（北京时间）公布。';
      document.querySelector('#resultsVotes').textContent = fmt.format(results.totalVotes);
      document.querySelector('#resultsVoters').textContent = fmt.format(results.voters);
      document.querySelector('#resultsSummary').hidden = false;
      awards.replaceChildren(...results.categories.map(renderAward));
    } catch {
      status.textContent = '暂时无法加载结果，请重试。';
      retry.hidden = false;
    }
  }

  retry.addEventListener('click', loadResults);
  loadResults();
})();

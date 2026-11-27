// The printed QR in /brand/vote-site-qr.png encodes the same public invitation.
const siteUrl = 'https://tga2026-vote.app.workbuddy.host/?sharecode=LXOCI6B7DF';
const dialog = document.querySelector('#shareDialog');
const poster = document.querySelector('#sharePoster');
const progress = document.querySelector('#shareProgress');
const save = document.querySelector('#shareSave');
const share = document.querySelector('#shareFile');
const status = document.querySelector('#shareStatus');
const urlField = document.querySelector('#shareUrl');
const sans = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
let revision = 0;
let imageUrl;
let imageFile;

async function loadImage(src) {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function wrapName(ctx, text, width) {
  const lines = [];
  let line = '';
  const tokens = text.match(/[\p{Script=Latin}\d]+|./gu) || [];
  const parts = tokens.flatMap(token => ctx.measureText(token).width > width ? [...token] : [token]);
  for (const part of parts) {
    if (line && ctx.measureText(line + part).width > width) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += line ? part : part.trimStart();
  }
  lines.push(line.trimEnd());
  return lines;
}

function drawTicketPaper(ctx, mark, width, top, height) {
  ctx.save();
  ctx.translate(0, top);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const paper = ctx.createLinearGradient(0, 0, width, 80);
  paper.addColorStop(0, '#f6eff8');
  paper.addColorStop(0.52, '#ecdef3');
  paper.addColorStop(1, '#d6c2e6');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  // Fine engraved curves along the outer edge of the ticket.
  ctx.strokeStyle = '#8c69a543';
  ctx.lineWidth = 0.65;
  for (let y = -110; y < height; y += 270) {
    for (let line = 0; line < 18; line++) {
      const gap = line * 3.4;
      ctx.beginPath();
      ctx.moveTo(width + 4, y + gap);
      ctx.bezierCurveTo(width - 12, y + 84 + gap, 141 + gap, y + 119, 172 + gap, y + 179);
      ctx.bezierCurveTo(196 + gap, y + 228, width - 14, y + 181 + gap, width + 4, y + 238 + gap);
      ctx.stroke();
    }
  }
  if (mark) {
    ctx.globalAlpha = 0.28;
    ctx.drawImage(mark, 202, -16, 150, 150);
  }
  ctx.restore();
}

async function drawTicket({ choices, total, synced, closed, dayEnd }) {
  const [qr, hero, mark, thumbs] = await Promise.all([
    loadImage('/brand/vote-site-qr.png'),
    loadImage('/brand/suyou-awards-stage.jpg').catch(() => null),
    loadImage('/brand/suyou-fold.svg').catch(() => null),
    Promise.all(choices.map(({ cover }) => loadImage(cover).catch(() => null)))
  ]);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const nameFont = 'bold 22px ' + sans;
  ctx.font = nameFont;
  const rows = choices.map(({ name }, i) => {
    const x = thumbs[i] ? 90 : 22;
    const lines = wrapName(ctx, name, 338 - x);
    return { x, lines, height: 82 + (lines.length - 1) * 28 };
  });
  const width = 360;
  const headerHeight = 112;
  const listHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const footerTop = headerHeight + (rows.length ? listHeight : 64);
  const height = footerTop + 102;
  canvas.width = width * 2;
  canvas.height = height * 2;
  ctx.scale(2, 2);
  function text(value, x, y, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  ctx.fillStyle = '#190b29';
  ctx.fillRect(0, 0, width, headerHeight);
  if (hero) ctx.drawImage(hero, 152, -2, 208, 117);
  const shade = ctx.createLinearGradient(0, 0, 282, 0);
  shade.addColorStop(0, '#1b0d2c');
  shade.addColorStop(0.45, '#1b0d2cf5');
  shade.addColorStop(1, '#1b0d2c00');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, headerHeight);
  if (mark) ctx.drawImage(mark, 20, 12, 17, 17);
  text('溯游工作室', mark ? 43 : 22, 25, 'bold 12px ' + sans, '#e9d9fa');
  text('我的投票', 20, 71, '900 34px ' + sans, '#fff7ff');
  text('2026 年度游戏票选', 22, 95, '600 13px ' + sans, '#d8bde9');

  drawTicketPaper(ctx, mark, width, headerHeight, height - headerHeight);
  if (!choices.length) {
    const note = !synced ? '投票记录暂未同步' : closed ? '本次票选已结束' : '今天还没有投票';
    text(note, 22, headerHeight + 38, '15px ' + sans, '#624d6f');
  }
  let top = headerHeight;
  choices.forEach(({ award }, i) => {
    const { x, lines, height: rowHeight } = rows[i];
    if (i > 0) {
      ctx.fillStyle = '#cdbbd6';
      ctx.fillRect(22, top, 316, 1);
    }
    if (thumbs[i]) {
      const img = thumbs[i];
      const size = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 22, top + 14, 54, 54);
    }
    text(award, x, top + 30, '13px ' + sans, '#6d527c');
    lines.forEach((line, j) => text(line, x, top + 58 + j * 28, nameFont, '#301b3d'));
    top += rowHeight;
  });

  ctx.strokeStyle = '#947aa4';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, footerTop + 0.5);
  ctx.lineTo(width, footerTop + 0.5);
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const x of [0, width]) {
    ctx.beginPath();
    ctx.arc(x, footerTop, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const date = new Date(dayEnd - 1).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '.');
  const count = synced || choices.length ? choices.length : '—';
  const progressText = '今日已投 ' + count + (total ? ' / ' + total : '');
  text(closed ? '扫码查看票选' : '扫码参与票选', 22, footerTop + 46, 'bold 15px ' + sans, '#4f395e');
  text(date + '  ·  ' + progressText, 22, footerTop + 69, '12px ' + sans, '#624d6f');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, 256, footerTop + 10, 82, 82);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png'
  ));
}

function resetImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  imageFile = null;
  poster.removeAttribute('src');
  save.removeAttribute('href');
  poster.hidden = save.hidden = share.hidden = true;
}

export async function renderShareCard(ballot) {
  const current = ++revision;
  resetImage();
  progress.hidden = false;
  progress.textContent = '正在生成投票卡…';
  try {
    const blob = await drawTicket(ballot);
    if (current !== revision || !dialog.open) return;
    imageUrl = URL.createObjectURL(blob);
    const summary = ballot.synced || ballot.choices.length
      ? '今日已投 ' + ballot.choices.length + ' 项'
      : '投票记录暂未同步';
    poster.alt = ['我的投票', ...ballot.choices.map(c => c.award + '：' + c.name), summary, '扫码打开票选网站'].join('。');
    poster.src = save.href = imageUrl;
    if (typeof File === 'function' && navigator.share && navigator.canShare) {
      imageFile = new File([blob], '我的投票.png', { type: 'image/png' });
    }
    const canShare = imageFile && navigator.canShare({ files: [imageFile] });
    save.hidden = canShare;
    share.hidden = !canShare;
    progress.hidden = true;
    poster.hidden = false;
  } catch {
    if (current === revision) progress.textContent = '投票卡生成失败，可复制链接分享。';
  }
}

share.addEventListener('click', async () => {
  try {
    await navigator.share({ files: [imageFile], title: '我的投票 · 溯游工作室' });
  } catch (error) {
    if (error.name === 'AbortError') return;
    share.hidden = true;
    save.hidden = false;
    status.textContent = '可保存卡片后分享';
  }
});
document.querySelector('#shareCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(siteUrl);
    status.textContent = '已复制票选链接';
  } catch {
    urlField.value = siteUrl;
    urlField.hidden = false;
    urlField.focus();
    urlField.select();
    status.textContent = '已选中网址，可手动复制';
  }
});
dialog.addEventListener('close', () => {
  revision++;
  resetImage();
  status.textContent = '';
  urlField.hidden = true;
  dialog.querySelector('.share-preview').scrollTop = 0;
});

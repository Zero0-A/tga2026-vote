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
const display = '"Barlow Condensed", ' + sans;
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
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > width) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += char;
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
    ctx.globalAlpha = 0.46;
    ctx.drawImage(mark, 94, -14, 168, 168);
  }
  ctx.restore();
}

async function drawTicket({ choices, total, synced, closed, dayEnd }) {
  const [qr, hero, mark, thumbs] = await Promise.all([
    loadImage('/brand/vote-site-qr.png'),
    loadImage('/brand/suyou-awards-stage.jpg').catch(() => null),
    loadImage('/brand/suyou-fold.svg').catch(() => null),
    Promise.all(choices.map(({ cover }) => loadImage(cover).catch(() => null))),
    document.fonts.load('800 48px "Barlow Condensed"').catch(() => {})
  ]);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const nameFont = 'bold 17px ' + sans;
  ctx.font = nameFont;
  const rows = choices.map(({ name }, i) => {
    const x = thumbs[i] ? 76 : 22;
    const lines = wrapName(ctx, name, 338 - x);
    return { x, lines, height: 66 + (lines.length - 1) * 23 };
  });
  const width = 360;
  const stubEnd = 308;
  const height = stubEnd + rows.reduce((sum, row) => sum + row.height, 0);
  canvas.width = width * 2;
  canvas.height = height * 2;
  ctx.scale(2, 2);
  function text(value, x, y, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  ctx.fillStyle = '#190b29';
  ctx.fillRect(0, 0, width, 158);
  if (hero) ctx.drawImage(hero, 70, 0, 290, 163);
  const shade = ctx.createLinearGradient(0, 0, 282, 0);
  shade.addColorStop(0, '#1b0d2c');
  shade.addColorStop(0.45, '#1b0d2cf5');
  shade.addColorStop(1, '#1b0d2c00');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, 158);
  if (mark) ctx.drawImage(mark, 20, 19, 19, 19);
  text('溯游工作室', mark ? 46 : 22, 34, 'bold 12px ' + sans, '#e9d9fa');
  text('我的投票', 19, 105, '900 42px ' + sans, '#fff7ff');
  text('2026 年度游戏票选', 22, 134, '600 15px ' + sans, '#d8bde9');

  drawTicketPaper(ctx, mark, width, 158, height - 158);
  ctx.strokeStyle = '#947aa4';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, 158.5);
  ctx.lineTo(width, 158.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const x of [0, width]) {
    ctx.beginPath();
    ctx.arc(x, 158, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const date = new Date(dayEnd - 1).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '.');
  text(date, 22, 187, '800 17px ' + display, '#715782');
  text('今日已投', 22, 215, 'bold 14px ' + sans, '#4f395e');
  const count = synced || choices.length ? String(choices.length).padStart(2, '0') : '—';
  text(count, 20, 265, '800 58px ' + display, '#321840');
  const countWidth = ctx.measureText(count).width;
  if (total) text('/ ' + total, 29 + countWidth, 264, '800 26px ' + display, '#785f86');
  if (!choices.length) {
    const note = !synced ? '投票记录暂未同步' : closed ? '本次票选已结束' : '今天还没有投票';
    text(note, 22, 288, '12px ' + sans, '#624d6f');
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, 235, 177, 102.5, 102.5);
  ctx.imageSmoothingEnabled = true;
  ctx.textAlign = 'center';
  text(closed ? '扫码查看票选' : '扫码参与票选', 286, 296, 'bold 12px ' + sans, '#4f395e');
  ctx.textAlign = 'start';

  let top = stubEnd;
  choices.forEach(({ award }, i) => {
    const { x, lines, height: rowHeight } = rows[i];
    ctx.fillStyle = '#cdbbd6';
    ctx.fillRect(22, top, 316, 1);
    if (thumbs[i]) {
      const img = thumbs[i];
      const size = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 22, top + 12, 42, 42);
    }
    text(award, x, top + 24, '12px ' + sans, '#6d527c');
    lines.forEach((line, j) => text(line, x, top + 47 + j * 23, nameFont, '#301b3d'));
    top += rowHeight;
  });
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
    poster.alt = ['我的投票', summary, ...ballot.choices.map(c => c.award + '：' + c.name), '扫码打开票选网站'].join('。');
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

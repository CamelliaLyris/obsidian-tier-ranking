const { Modal, Notice, normalizePath } = require('obsidian');

function loadImage(win, src) {
  return new Promise((resolve, reject) => {
    const image = new win.Image();
    const timer = win.setTimeout(() => reject(new Error('图片加载超时')), 20000);
    image.onload = () => { win.clearTimeout(timer); resolve(image); };
    image.onerror = () => { win.clearTimeout(timer); reject(new Error('图片无法读取')); };
    image.src = src;
  });
}

async function captureBoard(plugin, host, width) {
  const doc = host.ownerDocument, win = doc.defaultView;
  await doc.fonts?.ready;
  const stage = doc.createElement('div');
  stage.className = 'tr-export-stage';
  stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none;`;
  const clone = host.cloneNode(true);
  stage.appendChild(clone); doc.body.appendChild(stage);
  try {
    const title = doc.createElement('div');
    title.className = 'tr-export-title';
    title.textContent = host.querySelector('.tr-toolbar strong')?.textContent || '';
    clone.querySelector('.tr-toolbar')?.replaceWith(title);
    clone.querySelectorAll('.tr-hint,.tr-actions,.tr-empty').forEach(e => e.remove());
    clone.querySelectorAll('.is-selected,.tr-over').forEach(e => e.classList.remove('is-selected', 'tr-over'));
    // Preserve the tier label while removing all interactive elements from the output.
    clone.querySelectorAll('.tr-label').forEach(label => {
      const plain = doc.createElement('div');
      plain.className = label.className; plain.style.cssText = label.style.cssText;
      plain.textContent = label.textContent; label.replaceWith(plain);
    });
    clone.querySelectorAll('button').forEach(e => e.remove());
    clone.classList.add('tr-export-clean');
    clone.style.width = '100%';
    // Inline vault image bytes so the SVG has no app:// or file:// dependencies.
    const originals = [...host.querySelectorAll('.tr-card img')];
    const images = [...clone.querySelectorAll('.tr-card img')];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const src = originals[i]?.getAttribute('src');
      const files = plugin.app.vault.getFiles();
      const file = files.find(f => plugin.app.vault.getResourcePath(f) === src);
      if (!file) throw new Error('导出时无法找到原图，请重新打开榜单后重试');
      const bytes = await plugin.app.vault.readBinary(file);
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' }[file.extension.toLowerCase()];
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new win.FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('原图读取失败'));
        reader.readAsDataURL(new win.Blob([bytes], { type: mime }));
      });
      img.removeAttribute('srcset'); img.src = dataUrl;
      await loadImage(win, dataUrl);
    }
    // Wait for the clone's own image layout, not only the separate decoder.
    await Promise.all(images.map(img => img.decode()));
    const height = Math.ceil(clone.getBoundingClientRect().height);
    if (!height || width * height * 4 > 32000000 || height * 2 > 30000) throw new Error('榜单太大，请减小导出宽度或拆分榜单');
    const nodes = [clone, ...clone.querySelectorAll('*')];
    for (const node of nodes) {
      const computed = win.getComputedStyle(node);
      const css = [];
      for (const key of computed) {
        if (key === 'animation' || key.startsWith('transition') || key === 'caret-color') continue;
        css.push(`${key}:${computed.getPropertyValue(key)};`);
      }
      node.setAttribute('style', css.join(''));
      node.removeAttribute('tabindex'); node.removeAttribute('draggable');
    }
    const serialized = new win.XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
    const image = await loadImage(win, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    const canvas = doc.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前环境不支持图片导出');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法生成 PNG');
    return blob;
  } finally { stage.remove(); }
}

function openExportPreview(plugin, title, sourcePath, host) {
  const modal = new Modal(plugin.app), doc = host.ownerDocument, win = doc.defaultView;
  let blob = null, url = null, closed = false, busy = false;
  const filename = (title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().slice(0, 60) || '从夯到拉') + '.png';
  modal.onOpen = () => {
    modal.modalEl.addClass('tr-export-modal');
    modal.contentEl.createEl('h2', { text: '导出榜单图片' });
    const controls = modal.contentEl.createDiv({ cls: 'tr-export-controls' });
    const label = controls.createEl('label', { text: '排版宽度 ' });
    const input = label.createEl('input', { type: 'number', attr: { min: '400', max: '2400', step: '100', 'aria-label': '导出排版宽度' } });
    input.value = String(Math.max(400, Math.min(2400, Math.round(host.getBoundingClientRect().width))));
    const status = modal.contentEl.createDiv({ cls: 'tr-export-status' });
    const preview = modal.contentEl.createDiv({ cls: 'tr-export-preview' });
    const actions = [];
    const add = (text, action) => {
      const b = controls.createEl('button', { text });
      b.onclick = async () => { try { await action(); } catch (err) { new Notice(err.message); } };
      return b;
    };
    const refresh = async () => {
      if (busy) return;
      const width = Number(input.value);
      if (!Number.isInteger(width) || width < 400 || width > 2400) throw new Error('宽度请输入 400～2400 的整数');
      busy = true; blob = null;
      actions.forEach(b => b.disabled = true); update.disabled = true; input.disabled = true;
      status.setText('正在生成透明背景、2 倍清晰度预览…');
      try {
        const result = await captureBoard(plugin, host, width);
        if (closed) return;
        blob = result;
        if (url) win.URL.revokeObjectURL(url);
        url = win.URL.createObjectURL(blob);
        preview.empty(); preview.createEl('img', { attr: { src: url, alt: '榜单导出预览' } });
        status.setText(`透明 PNG · 实际宽度 ${width * 2} 像素 · 不含按钮和卡片背景`);
        actions.forEach(b => b.disabled = false);
      } catch (err) { status.setText('生成失败：' + err.message); }
      finally { busy = false; update.disabled = false; input.disabled = false; }
    };
    const update = add('更新预览', refresh);
    actions.push(add('保存到库', async () => {
      if (!blob) return;
      const folder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
      const path = normalizePath(folder + filename.slice(0, -4) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.png');
      await plugin.app.vault.createBinary(path, await blob.arrayBuffer()); new Notice('已保存：' + path, 8000);
    }));
    actions.push(add('另存为', () => {
      if (!blob || !url) return;
      const a = doc.createElement('a'); a.href = url; a.download = filename;
      doc.body.appendChild(a); a.click(); a.remove();
    }));
    if (win.ClipboardItem && win.navigator.clipboard?.write) actions.push(add('复制图片', async () => {
      if (!blob) return;
      await win.navigator.clipboard.write([new win.ClipboardItem({ 'image/png': blob })]); new Notice('已复制图片');
    }));
    actions.forEach(b => b.disabled = true);
    input.addEventListener('input', () => { blob = null; actions.forEach(b => b.disabled = true); status.setText('宽度已改变，请点击更新预览'); });
    refresh();
  };
  modal.onClose = () => { closed = true; if (url) win.URL.revokeObjectURL(url); plugin.expandedBoards.delete(modal); };
  plugin.expandedBoards.add(modal); modal.open();
}

module.exports = { openExportPreview, captureBoard };

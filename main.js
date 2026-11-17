const { Plugin, PluginSettingTab, Setting, Modal, Menu, Notice, normalizePath } = require('obsidian');

const DEFAULT_TIERS = [
  ['夯', '#ff7f7f'], ['顶级', '#ffbf7f'], ['人上人', '#ffdf7f'],
  ['NPC', '#ffff7f'], ['拉', '#bfff7f']
];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const fresh = (tiers = DEFAULT_TIERS) => ({ version: 1, title: '从夯到拉', tiers: tiers.map(([name, color]) => ({ id: uid(), name, color, items: [] })), unranked: [] });
const fence = data => '```tier-ranking\n' + JSON.stringify(data, null, 2) + '\n```';
const BOARD_FOLDER = '从夯到拉';
const ASSET_FOLDER = '素材库';
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'];
const DEFAULT_OPTIONS = { useBoardFolder: true, boardFolder: BOARD_FOLDER, assetFolder: ASSET_FOLDER,
  defaultScale: 125, cardWidth: 144, imageHeight: 120, imageFit: 'contain', showNames: true,
  libraryAllImages: false, defaultTiers: DEFAULT_TIERS };
const copy = value => JSON.parse(JSON.stringify(value));
function folderPath(value) {
  if (typeof value !== 'string') throw new Error('文件夹路径不能为空');
  const result = value.trim().replace(/\\/g, '/');
  if (!result || result.split('/').some(part => !part || part.startsWith('.') || /[:*?"<>|\x00-\x1f]/.test(part) || /[. ]$/.test(part)))
    throw new Error('请使用库内相对文件夹路径，例如「从夯到拉」，不要包含隐藏文件夹、空段或特殊字符');
  return normalizePath(result);
}
function checkedOptions(raw) {
  const value = Object.assign(copy(DEFAULT_OPTIONS), raw);
  value.boardFolder = folderPath(value.boardFolder);
  // Legacy assetFolder is kept only to find existing images, never as the new import destination.
  try { value.assetFolder = folderPath(value.assetFolder); } catch (_) { value.assetFolder = ASSET_FOLDER; }
  for (const [key, min, max] of [['defaultScale', 75, 200], ['cardWidth', 80, 360], ['imageHeight', 60, 360]]) {
    if (!Number.isInteger(Number(value[key])) || Number(value[key]) < min || Number(value[key]) > max) throw new Error(`${key} 必须在 ${min}～${max} 之间`);
    value[key] = Number(value[key]);
  }
  if (!['contain', 'cover'].includes(value.imageFit)) throw new Error('图片显示方式不正确');
  for (const key of ['useBoardFolder', 'showNames', 'libraryAllImages']) value[key] = !!value[key];
  if (!Array.isArray(value.defaultTiers) || value.defaultTiers.length < 1 || value.defaultTiers.length > 12 || value.defaultTiers.some(t => !Array.isArray(t) || typeof t[0] !== 'string' || !t[0].trim() || !/^#[0-9a-f]{6}$/i.test(t[1]))) throw new Error('默认分级需为 1～12 档，每档需填写名称和颜色');
  value.defaultTiers = value.defaultTiers.map(([name, color]) => [name.trim(), color]);
  return value;
}

function renderSettings(plugin, container, onSaved, draft = copy(plugin.options)) {
  container.empty();
  container.createEl('h2', { text: '从夯到拉 · 设置' });
  container.createEl('p', { text: '修改后点击底部「保存设置」。显示设置会立即应用到已打开的榜单；路径设置只影响今后的新文件，不会移动旧文件。', cls: 'tr-library-hint' });
  new Setting(container).setName('默认保存到榜单文件夹').setDesc('新建榜单时仍可单独选择。').addToggle(c => c.setValue(draft.useBoardFolder).onChange(v => draft.useBoardFolder = v));
  new Setting(container).setName('榜单文件夹').setDesc('库内相对路径，不存在时自动创建。').addText(c => c.setValue(draft.boardFolder).onChange(v => draft.boardFolder = v));
  container.createEl('p', { text: '项目图片沿用独立「素材库」插件的本地目录，请在素材库设置中管理。未启用素材库插件时使用「素材库」目录。已有图片引用保持不变，选择图片时可临时查看整个笔记库。', cls: 'tr-library-hint' });
  container.createEl('h3', { text: '榜单显示' });
  for (const [key, label, min, max, step] of [['defaultScale', '默认缩放（%）', 75, 200, 5], ['cardWidth', '条目基础宽度（px）', 80, 360, 4], ['imageHeight', '图片基础高度（px）', 60, 360, 4]]) {
    new Setting(container).setName(label).addSlider(c => c.setLimits(min, max, step).setValue(draft[key]).setDynamicTooltip().onChange(v => draft[key] = v));
  }
  new Setting(container).setName('图片显示方式').addDropdown(c => c.addOption('contain', '完整显示（保留比例）').addOption('cover', '填满区域（可能裁切）').setValue(draft.imageFit).onChange(v => draft.imageFit = v));
  new Setting(container).setName('显示条目名称').setDesc('关闭后仅隐藏文字，不会删除名称。').addToggle(c => c.setValue(draft.showNames).onChange(v => draft.showNames = v));
  container.createEl('h3', { text: '新榜单的默认分级' });
  container.createEl('p', { text: '按下列顺序创建，修改不会影响已有榜单。', cls: 'tr-library-hint' });
  draft.defaultTiers.forEach((tier, i) => {
    new Setting(container).setName(`第 ${i + 1} 档`)
      .addText(c => c.setValue(tier[0]).onChange(v => tier[0] = v))
      .addColorPicker(c => c.setValue(tier[1]).onChange(v => tier[1] = v))
      .addExtraButton(c => c.setIcon('arrow-up').setTooltip('向上移动').onClick(() => { if (i > 0) { [draft.defaultTiers[i - 1], draft.defaultTiers[i]] = [tier, draft.defaultTiers[i - 1]]; renderSettings(plugin, container, onSaved, draft); } }))
      .addExtraButton(c => c.setIcon('trash').setTooltip('删除此档').onClick(() => { if (draft.defaultTiers.length > 1) { draft.defaultTiers.splice(i, 1); renderSettings(plugin, container, onSaved, draft); } }));
  });
  new Setting(container).setName('添加分级').addButton(c => c.setButtonText('添加一档').onClick(() => { if (draft.defaultTiers.length < 12) { draft.defaultTiers.push(['新分级', '#cccccc']); renderSettings(plugin, container, onSaved, draft); } }));
  new Setting(container).addButton(c => c.setButtonText('保存设置').setCta().onClick(async () => {
    c.setDisabled(true);
    try { await plugin.updateOptions(draft); new Notice('设置已保存'); onSaved?.(); }
    catch (err) { new Notice('保存失败：' + err.message); }
    finally { c.setDisabled(false); }
  })).addButton(c => c.setButtonText('恢复默认值').onClick(() => renderSettings(plugin, container, onSaved, copy(DEFAULT_OPTIONS))));
}
class TierSettingsTab extends PluginSettingTab {
  constructor(plugin) { super(plugin.app, plugin); this.plugin = plugin; }
  display() { renderSettings(this.plugin, this.containerEl); }
}
function validate(data) {
  if (!data || typeof data.title !== 'string' || !Array.isArray(data.tiers) || !Array.isArray(data.unranked)) throw new Error('榜单格式不正确');
  const ids = new Set();
  for (const tier of data.tiers) {
    if (!tier || typeof tier.id !== 'string' || typeof tier.name !== 'string' || !Array.isArray(tier.items) || ids.has(tier.id)) throw new Error('分级格式不正确');
    ids.add(tier.id);
  }
  for (const item of [...data.tiers.flatMap(t => t.items), ...data.unranked]) {
    if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || ids.has(item.id) || (item.image != null && typeof item.image !== 'string')) throw new Error('条目格式不正确或 ID 重复');
    ids.add(item.id);
  }
  return data;
}

class EditModal extends Modal {
  constructor(app, title, fields, submit) { super(app); this.heading = title; this.fields = fields; this.submit = submit; }
  onOpen() {
    this.contentEl.createEl('h2', { text: this.heading });
    const form = this.contentEl.createEl('form');
    const inputs = {};
    for (const field of this.fields) {
      const label = form.createEl('label', { cls: 'tr-field', text: field.label });
      const input = label.createEl('input', { type: field.type || 'text' });
      input.value = field.value || ''; input.placeholder = field.placeholder || '';
      if (field.required) input.required = true;
      inputs[field.key] = input;
      if (field.pick) {
        const pick = label.createEl('button', { text: '从素材库选择图片', type: 'button' });
        pick.addEventListener('click', async e => { e.preventDefault(); if (pick.disabled) return; pick.disabled = true; try { await field.pick(path => { if (input.isConnected) input.value = path; }); } catch (err) { new Notice(err.message); } finally { pick.disabled = false; } });
      }
    }
    form.createEl('button', { text: '保存', type: 'submit', cls: 'mod-cta' });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value.trim()]));
      if (this.fields.some(f => f.required && !values[f.key])) return;
      try { await this.submit(values); this.close(); } catch (err) { new Notice(err.message); }
    });
    Object.values(inputs)[0]?.focus();
  }
  onClose() { this.contentEl.empty(); }
}

class AssetLibraryModal extends Modal {
  constructor(plugin, choose, multiple = false) {
    super(plugin.app); this.plugin = plugin; this.choose = choose; this.multiple = multiple;
    this.selected = new Set(); this.allImages = plugin.options.libraryAllImages; this.query = ''; this.saving = false;
  }
  onOpen() {
    this.modalEl.addClass('tr-library-modal');
    this.contentEl.createEl('h2', { text: '从夯到拉 · 素材库' });
    this.contentEl.createEl('p', { text: `导入的原图保存在「${this.plugin.imageFolder()}」。目录沿用素材库插件；选择已有图片不会复制或移动原文件。`, cls: 'tr-library-hint' });
    const controls = this.contentEl.createDiv({ cls: 'tr-library-controls' });
    const search = controls.createEl('input', { type: 'search', attr: { placeholder: '搜索图片名称', 'aria-label': '搜索素材' } });
    search.addEventListener('input', () => { this.query = search.value; this.draw(); });
    const label = controls.createEl('label', { text: '显示整个笔记库的图片 ' });
    const all = label.createEl('input', { type: 'checkbox' });
    all.checked = this.allImages;
    all.addEventListener('change', () => { this.allImages = all.checked; this.draw(); });
    const importer = controls.createEl('input', { type: 'file', attr: { accept: IMAGE_EXTENSIONS.map(x => '.' + x).join(','), multiple: '' } });
    importer.style.display = 'none';
    const importButton = controls.createEl('button', { text: '导入图片' });
    importButton.onclick = () => importer.click();
    importer.addEventListener('change', async () => {
      importButton.disabled = true;
      try {
        const files = await this.plugin.importAssets([...importer.files]);
        if (files.length) new Notice(`已导入 ${files.length} 张图片`);
        this.draw();
      } catch (err) { new Notice('导入失败：' + err.message); this.draw(); }
      finally { importButton.disabled = false; importer.value = ''; }
    });
    const refresh = controls.createEl('button', { text: '刷新' }); refresh.onclick = () => this.draw();
    if (this.multiple && this.choose) {
      this.confirm = this.contentEl.createEl('button', { text: '添加所选图片', cls: 'mod-cta' });
      this.confirm.onclick = async () => {
        if (this.saving || !this.selected.size) return;
        this.saving = true; this.confirm.disabled = true;
        try { await this.choose([...this.selected]); this.close(); }
        catch (err) { new Notice(err.message); }
        finally { this.saving = false; this.draw(); }
      };
    }
    this.grid = this.contentEl.createDiv({ cls: 'tr-library-grid' });
    this.draw();
  }
  draw() {
    if (!this.grid) return;
    this.grid.empty();
    const materialLibrary = this.app.plugins?.getPlugin?.('material-library');
    const roots = [this.plugin.options.assetFolder, this.plugin.imageFolder(), ...(materialLibrary?.options?.sources || [])].filter(root => typeof root === 'string' && root);
    const files = this.plugin.app.vault.getFiles().filter(file => IMAGE_EXTENSIONS.includes(file.extension.toLowerCase()) &&
      (this.allImages || roots.some(root => file.path.startsWith(root + '/'))) && file.path.toLowerCase().includes(this.query.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    if (!files.length) this.grid.createEl('p', { text: '还没有匹配的图片。点击「导入图片」，或勾选「显示整个笔记库的图片」。', cls: 'tr-library-hint' });
    if (this.confirm) { this.confirm.setText(`添加所选图片（${this.selected.size}）`); this.confirm.disabled = this.saving || !this.selected.size; }
    for (const file of files) {
      const tile = this.grid.createEl('button', { cls: 'tr-library-tile' + (this.selected.has(file.path) ? ' is-selected' : ''), attr: { title: file.path, 'aria-pressed': String(this.selected.has(file.path)) } });
      tile.createEl('img', { attr: { src: this.app.vault.getResourcePath(file), alt: file.basename, loading: 'lazy' } });
      tile.createSpan({ text: file.name });
      tile.onclick = async () => {
        if (!this.choose) return;
        if (this.multiple) { if (this.selected.has(file.path)) this.selected.delete(file.path); else this.selected.add(file.path); this.draw(); }
        else { try { await this.choose(file.path); this.close(); } catch (err) { new Notice(err.message); } }
      };
    }
  }
}


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


module.exports = class TierRankingPlugin extends Plugin {
  async onload() {
    const stored = await this.loadData();
    try { this.options = checkedOptions(stored); }
    catch (_) { this.options = copy(DEFAULT_OPTIONS); new Notice('从夯到拉：设置格式不正确，已使用默认值'); }
    this.boardViews = new Set();
    this.addSettingTab(new TierSettingsTab(this));
    this.expandedBoards = new Set();
    this.register(() => { for (const modal of this.expandedBoards) modal.close(); });
    this.registerMarkdownCodeBlockProcessor('tier-ranking', (source, el, ctx) => this.renderBoard(source, el, ctx));
    this.addRibbonIcon('list-ordered', '新建从夯到拉榜单', () => this.createBoard());
    this.addCommand({ id: 'create-board', name: '新建分级榜', callback: () => this.createBoard() });
    this.addCommand({ id: 'open-library', name: '打开素材库', callback: () => this.openLibrary() });
    this.addCommand({ id: 'open-settings', name: '打开设置', callback: () => this.openSettings() });
    this.addCommand({ id: 'insert-board', name: '在当前笔记插入分级榜', editorCallback: editor => editor.replaceSelection('\n' + fence(fresh(this.options.defaultTiers)) + '\n') });
  }
  async updateOptions(draft) {
    const next = checkedOptions(draft);
    await this.saveData(next); this.options = next;
    for (const refresh of this.boardViews) refresh();
  }
  openSettings() {
    const modal = new Modal(this.app);
    modal.onOpen = () => { modal.modalEl.addClass('tr-settings-modal'); renderSettings(this, modal.contentEl, () => modal.close()); };
    modal.onClose = () => this.expandedBoards.delete(modal);
    this.expandedBoards.add(modal); modal.open();
  }
  async ensureFolder(folderPath) {
    let current = '';
    for (const part of folderPath.split('/')) {
      current = current ? current + '/' + part : part;
      let entry = this.app.vault.getAbstractFileByPath(current);
      if (!entry) {
        try { await this.app.vault.createFolder(current); }
        catch (err) { if (!this.app.vault.getAbstractFileByPath(current)) throw err; }
        entry = this.app.vault.getAbstractFileByPath(current);
      }
      if (!entry || !Array.isArray(entry.children)) throw new Error(`「${current}」已被同名文件占用，请先重命名该文件`);
    }
  }
  materialImagePicker() {
    if (typeof this.app.plugins?.getPlugin?.('material-library')?.selectImage !== 'function') return null;
    return async choose => {
      const library = this.app.plugins?.getPlugin?.('material-library');
      if (typeof library?.selectImage !== 'function') throw new Error('请先启用素材库插件');
      const path = await library.selectImage(); if (path) choose(path);
    };
  }
  imageFolder() {
    const library = this.app.plugins?.getPlugin?.('material-library');
    return folderPath(library?.options?.root || ASSET_FOLDER);
  }
  async importAssets(files) {
    if (!files.length) return [];
    const assetFolder = this.imageFolder();
    await this.ensureFolder(assetFolder);
    const imported = [];
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) { new Notice('跳过不支持的文件：' + file.name); continue; }
      const stem = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().slice(0, 80) || '图片';
      const path = normalizePath(`${assetFolder}/${stem}-${uid()}.${ext}`);
      imported.push(await this.app.vault.createBinary(path, await file.arrayBuffer()));
    }
    return imported;
  }
  openLibrary(choose, multiple = false) {
    const modal = new AssetLibraryModal(this, choose, multiple);
    this.expandedBoards.add(modal);
    modal.onClose = () => this.expandedBoards.delete(modal);
    modal.open();
  }
  createBoard() {
    const modal = new Modal(this.app);
    modal.onOpen = () => {
      modal.contentEl.createEl('h2', { text: '新建从夯到拉榜单' });
      const form = modal.contentEl.createEl('form');
      const label = form.createEl('label', { text: '榜单名称', cls: 'tr-field' });
      const title = label.createEl('input', { type: 'text' }); title.value = '从夯到拉'; title.required = true;
      const folderLabel = form.createEl('label', { cls: 'tr-folder-choice' });
      const checkbox = folderLabel.createEl('input', { type: 'checkbox' }); checkbox.checked = this.options.useBoardFolder;
      folderLabel.createSpan({ text: `保存到「${this.options.boardFolder}」文件夹（不存在时自动创建）` });
      form.createEl('p', { text: '不勾选则使用 Obsidian 默认的新笔记位置。下次会记住本次选择。', cls: 'tr-library-hint' });
      const submit = form.createEl('button', { type: 'submit', text: '创建榜单', cls: 'mod-cta' });
      form.addEventListener('submit', async e => {
        e.preventDefault(); if (submit.disabled) return;
        const name = title.value.trim();
        if (!name || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name)) { new Notice('请输入有效的榜单名称，不要包含路径或特殊字符'); return; }
        submit.disabled = true;
        try { await this.createBoardFile(name, checkbox.checked); modal.close(); }
        catch (err) { new Notice('创建失败：' + err.message); }
        finally { submit.disabled = false; }
      });
      title.focus(); title.select();
    };
    this.expandedBoards.add(modal); modal.onClose = () => this.expandedBoards.delete(modal); modal.open();
  }
  async createBoardFile(title, useBoardFolder) {
      const parent = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path || '');
      if (useBoardFolder) await this.ensureFolder(this.options.boardFolder);
      const folder = useBoardFolder ? this.options.boardFolder + '/' : (parent.path === '/' ? '' : parent.path + '/');
      let name = folder + title + '.md', n = 1;
      while (this.app.vault.getAbstractFileByPath(name)) name = folder + `${title} ${n++}.md`;
      const data = fresh(this.options.defaultTiers); data.title = title;
      const file = await this.app.vault.create(name, '# ' + title + '\n\n' + fence(data) + '\n');
      this.options.useBoardFolder = useBoardFolder;
      try { await this.saveData(this.options); } catch (_) { new Notice('榜单已创建，但默认位置偏好未能保存'); }
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice('榜单已创建；在阅读视图或实时预览中使用。');
      return file;
  }
  resolveImage(path, sourcePath) {
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath) || this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(file.extension?.toLowerCase()) ? file : null;
  }
  async exportBoard(data, sourcePath, host) {
    openExportPreview(this, data.title, sourcePath, host);
  }
  renderBoard(source, el, ctx) {
    let data;
    try { data = validate(JSON.parse(source)); } catch (err) { el.createEl('p', { text: '从夯到拉：' + err.message }); return; }
    const host = el.createDiv({ cls: 'tr-board' });
    let currentSource = source.replace(/\r\n/g, '\n').trim(), busy = false, selected = null, dragged = null;
    let expanded = null, scale = this.options.defaultScale, exporting = false;
    const lists = () => [...data.tiers.map(t => t.items), data.unranked];
    const save = async mutate => {
      if (busy) { new Notice('正在保存，请稍后再试'); return; }
      busy = true;
      const before = JSON.stringify(data);
      try {
        mutate(); validate(data);
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!file || file.extension !== 'md') throw new Error('找不到榜单笔记');
        const nextSource = JSON.stringify(data, null, 2);
        await this.app.vault.process(file, content => {
          // Match the exact old block to avoid overwriting concurrent edits or other boards.
          const blocks = [...content.matchAll(/^([ \t]*)(`{3,}|~{3,})tier-ranking[^\S\r\n]*\r?\n([\s\S]*?)^\1\2[^\S\r\n]*(?=\r?$)/gm)];
          const matches = blocks.filter(m => m[3].replace(/\r\n/g, '\n').trim() === currentSource);
          let match;
          if (matches.length === 1) match = matches[0];
          else if (matches.length > 1) {
            const info = ctx.getSectionInfo(el);
            match = matches.find(m => content.slice(0, m.index).split('\n').length - 1 === info?.lineStart);
          }
          if (!match) throw new Error('笔记已发生变化，请重新打开榜单后再操作');
          return content.slice(0, match.index) + fence(data) + content.slice(match.index + match[0].length);
        });
        currentSource = nextSource;
      } catch (err) { data = JSON.parse(before); new Notice('保存失败：' + err.message); }
      finally { busy = false; draw(); }
    };
    const button = (parent, text, title, action) => {
      const b = parent.createEl('button', { text, attr: { title, 'aria-label': title } });
      b.addEventListener('click', e => { e.stopPropagation(); action(); }); return b;
    };
    const editItem = item => new EditModal(this.app, item ? '编辑条目' : '添加条目', [
      { key: 'text', label: '名称（可选，图片可以不填名称）', value: item?.text },
      { key: 'image', label: '图片（可选）', value: item?.image, placeholder: '填写库内图片路径', pick: this.materialImagePicker() }
    ], values => {
      if (!values.text && !values.image) throw new Error('请填写名称或图片路径，任选一项即可');
      return save(() => { if (item) Object.assign(item, values); else data.unranked.push({ id: uid(), ...values }); });
    }).open();
    const expand = () => {
      if (expanded) { expanded.close(); return; }
      const modal = new Modal(this.app);
      modal.onOpen = () => {
        modal.modalEl.addClass('tr-expanded-modal');
        modal.contentEl.appendChild(host);
        draw();
      };
      modal.onClose = () => {
        expanded = null;
        this.expandedBoards.delete(modal);
        if (el.isConnected) { el.appendChild(host); draw(); }
        else host.remove();
      };
      expanded = modal;
      this.expandedBoards.add(modal);
      modal.open();
    };
    const move = (id, target, beforeId) => save(() => {
      let item;
      for (const list of lists()) { const i = list.findIndex(x => x.id === id); if (i >= 0) { item = list.splice(i, 1)[0]; break; } }
      if (!item) return;
      const index = beforeId ? target.findIndex(x => x.id === beforeId) : -1;
      target.splice(index < 0 ? target.length : index, 0, item); selected = null;
    });
    const draw = () => {
      host.empty();
      const toolbar = host.createDiv({ cls: 'tr-toolbar' });
      toolbar.createEl('strong', { text: data.title });
      button(toolbar, '修改标题', '修改榜单标题', () => new EditModal(this.app, '榜单标题', [{ key: 'title', label: '标题', value: data.title, required: true }], v => save(() => { data.title = v.title; })).open());
      button(toolbar, '＋ 添加条目', '添加待评级条目', () => editItem());
      button(toolbar, '⚙ 设置', '调整从夯到拉的默认设置与显示', () => this.openSettings());
      button(toolbar, expanded ? '收起榜单' : '放大榜单', expanded ? '返回笔记内查看' : '在大窗口中查看与编辑榜单', expand);
      const exportButton = button(toolbar, exporting ? '正在导出…' : '导出图片', '预览、调整宽度并保存或复制透明 PNG', async () => {
        if (exporting) return;
        exporting = true; draw();
        try { await this.exportBoard(JSON.parse(JSON.stringify(data)), ctx.sourcePath, host); }
        catch (err) { new Notice('导出失败：' + err.message); }
        finally { exporting = false; draw(); }
      });
      exportButton.disabled = exporting;
      const zoom = toolbar.createDiv({ cls: 'tr-zoom' });
      button(zoom, '−', '缩小条目', () => { scale = Math.max(75, scale - 25); draw(); });
      zoom.createSpan({ text: scale + '%', attr: { 'aria-live': 'polite' } });
      button(zoom, '＋', '放大条目', () => { scale = Math.min(200, scale + 25); draw(); });
      host.style.setProperty('--tr-scale', String(scale / 100));
      host.style.setProperty('--tr-card-width', this.options.cardWidth + 'px');
      host.style.setProperty('--tr-image-height', this.options.imageHeight + 'px');
      host.style.setProperty('--tr-image-fit', this.options.imageFit);
      host.style.setProperty('--tr-name-display', this.options.showNames ? 'block' : 'none');
      host.createDiv({ cls: 'tr-hint', text: selected ? '已选中条目，点击目标分级空白处移动；再次点击条目取消。' : '拖动或点选条目评级；双击编辑，右键（触屏长按）查看原图或删除。' });
      const row = (name, color, items, tier) => {
        const r = host.createDiv({ cls: 'tr-row' });
        const label = r.createEl('button', { cls: 'tr-label', text: name, attr: { title: tier ? '修改分级名称与颜色' : '待评级' } });
        label.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#dddddd';
        if (tier) label.onclick = () => {
          if (selected) { move(selected, items); return; }
          new EditModal(this.app, '编辑分级', [{ key: 'name', label: '名称', value: tier.name, required: true }, { key: 'color', label: '颜色', value: color, type: 'color' }], v => save(() => Object.assign(tier, v))).open();
        };
        else label.onclick = () => { if (selected) move(selected, items); };
        const zone = r.createDiv({ cls: 'tr-zone' });
        zone.setAttribute('aria-label', name);
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.addClass('tr-over'); });
        zone.addEventListener('dragleave', () => zone.removeClass('tr-over'));
        zone.addEventListener('drop', e => { e.preventDefault(); zone.removeClass('tr-over'); if (dragged) { const card = e.target.closest('.tr-card'); if (card?.dataset.id === dragged) return; move(dragged, items, card?.dataset.id); dragged = null; } });
        zone.addEventListener('click', e => { if (selected && !e.target.closest('.tr-card')) move(selected, items); });
        if (!items.length) zone.createSpan({ cls: 'tr-empty', text: '将条目放到这里' });
        for (const item of items) {
          const card = zone.createDiv({ cls: 'tr-card' + (selected === item.id ? ' is-selected' : '') });
          const itemLabel = item.text || '图片条目';
          card.dataset.id = item.id; card.draggable = true; card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', itemLabel);
          if (item.image) {
            const imageFile = this.resolveImage(item.image, ctx.sourcePath);
            if (imageFile) card.createEl('img', { attr: { src: this.app.vault.getResourcePath(imageFile), alt: itemLabel, draggable: 'false', decoding: 'async' } });
            else card.createSpan({ cls: 'tr-image-missing', text: '图片未找到' });
          }
          if (item.text) card.createSpan({ cls: 'tr-text', text: item.text });
          const actions = card.createDiv({ cls: 'tr-actions' });
          if (item.image) button(actions, '⛶', '查看原图', () => {
            const file = this.resolveImage(item.image, ctx.sourcePath);
            if (!file) { new Notice('图片未找到'); return; }
            const modal = new Modal(this.app);
            modal.onOpen = () => {
              modal.modalEl.addClass('tr-image-modal');
              modal.contentEl.createEl('img', { attr: { src: this.app.vault.getResourcePath(file), alt: itemLabel } });
            };
            modal.open();
          });
          button(actions, '✎', '编辑 ' + itemLabel, () => editItem(item));
          button(actions, '×', '删除 ' + itemLabel, () => save(() => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); }));
          card.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            const menu = new Menu();
            if (item.image) menu.addItem(entry => entry.setTitle('查看原图').setIcon('maximize').onClick(() => actions.querySelector('button').click()));
            menu.addItem(entry => entry.setTitle('编辑条目').setIcon('pencil').onClick(() => editItem(item)));
            menu.addItem(entry => entry.setTitle('删除条目').setIcon('trash').onClick(() => save(() => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); })));
            menu.showAtMouseEvent(e);
          });
          card.addEventListener('click', e => { e.stopPropagation(); selected = selected === item.id ? null : item.id; draw(); });
          card.addEventListener('keydown', e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selected = selected === item.id ? null : item.id; draw(); } });
          card.addEventListener('dblclick', () => editItem(item));
          card.addEventListener('dragstart', e => { dragged = item.id; e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; });
          card.addEventListener('dragend', () => { dragged = null; host.querySelectorAll('.tr-over').forEach(z => z.removeClass('tr-over')); });
        }
      };
      for (const tier of data.tiers) row(tier.name, tier.color, tier.items, tier);
      row('待评级', '#cccccc', data.unranked);
    };
    const refreshSettings = () => { if (host.isConnected) { scale = this.options.defaultScale; draw(); } else this.boardViews.delete(refreshSettings); };
    this.boardViews.add(refreshSettings);
    draw();
  }
};

window.PINDOU_BUILD = '2026.10.30-layout-v61';
const el = id => document.getElementById(id);
const EDITOR_MODE = new URLSearchParams(window.location.search).get('editor') === '1';
const ui = {
  fileInput: el('fileInput'), dropZone: el('dropZone'), fileCard: el('fileCard'), sourceThumb: el('sourceThumb'),
  fileName: el('fileName'), fileMeta: el('fileMeta'), empty: el('emptyState'), scroll: el('canvasScroll'),
  canvas: el('patternCanvas'), width: el('gridWidth'), height: el('gridHeight'), colors: el('colorCount'),
  showGrid: el('showGrid'), showSymbols: el('showSymbols'), removeWhite: el('removeWhite'),
  majorGridSize: el('majorGridSize'), majorGridStyle: el('majorGridStyle'),
  palette: el('palettePanel'), paletteList: el('paletteList'), paintToggle: el('paintToggle'),
  eraserButton: el('eraserButton'), referenceToggle: el('referenceToggle'), pickerButton: el('pickerButton'), mardColor: el('mardColor'), customColor: el('customColor'),
  undoButton: el('undoButton'), redoButton: el('redoButton'), paintStatus: el('paintStatus'), replaceModal: el('replaceModal'),
  replaceClose: el('replaceClose'), replaceCancel: el('replaceCancel'), replaceConfirm: el('replaceConfirm'),
  replaceColorSelect: el('replaceColorSelect'), replaceFromSwatch: el('replaceFromSwatch'), replaceFromCode: el('replaceFromCode'),
  replaceFromCount: el('replaceFromCount'), replaceToSwatch: el('replaceToSwatch'), replaceToCode: el('replaceToCode'), replaceToHex: el('replaceToHex'),
  saveDraft: el('saveDraft'), clearDraft: el('clearDraft'), draftStatus: el('draftStatus'),
  cloudDraftStatus: el('cloudDraftStatus'), restoreCloudDraft: el('restoreCloudDraft'),
  zoomOut: el('zoomOut'), zoomValue: el('zoomValue'), zoomIn: el('zoomIn'), zoomFit: el('zoomFit'),
  openEditorButton: el('openEditorButton'), editorPageHeader: el('editorPageHeader'), returnToMain: el('returnToMain'),
  fillButton: el('fillButton'), lineButton: el('lineButton'), rectButton: el('rectButton'), selectButton: el('selectButton'), panButton: el('panButton'),
  openAllColors: el('openAllColors'), paletteBrowserModal: el('paletteBrowserModal'), paletteBrowserClose: el('paletteBrowserClose'),
  paletteSearch: el('paletteSearch'), paletteBrowserCount: el('paletteBrowserCount'), paletteGroups: el('paletteGroups'), allColorsGrid: el('allColorsGrid'),
  finishedPreviewButton: el('finishedPreviewButton'), finishedPreviewModal: el('finishedPreviewModal'), finishedPreviewClose: el('finishedPreviewClose'), finishedPreviewCanvas: el('finishedPreviewCanvas'),
  exportMajorGridColor: el('exportMajorGridColor'), exportMinorGridColor: el('exportMinorGridColor'), gridIntervalValue: el('gridIntervalValue'),
  selectionActions: el('selectionActions'), selectionSize: el('selectionSize'), selectionCopy: el('selectionCopy'), selectionCut: el('selectionCut'),
  selectionPaste: el('selectionPaste'), selectionDelete: el('selectionDelete'), selectionCancel: el('selectionCancel')
};

const state = {
  image: null, fileName: '', baseCells: [], cells: [], manualOverrides: new Map(), colorReplacements: new Map(), cols: 80, rows: 40,
  processedCols: 80, processedRows: 40, used: [],
  paintMode: false, pickerMode: false, selectedColor: null, drawing: false, lastPaintIndex: -1,
  history: [], redoHistory: [], cellSize: 10, gridOriginX: 0, gridOriginY: 0, customIndex: 1, showReference: false,
  replaceSource: null, lastPaintColor: null, restoringDraft: false, draftSaveTimer: null, hasStoredDraft: false,
  skipDraftRestore: false, imageLoadToken: 0, zoom: 1, fitZoom: true,
  previewLogicalWidth: 0, previewLogicalHeight: 0, previewRenderScale: 1,
  tool: 'brush', gestureStartIndex: -1, gestureEndIndex: -1, selection: null, selectionClipboard: null, panStart: null,
  renderFrame: 0, paletteGroup: 'ALL', processingMode: 'realistic', mergeStrength: 35,
  originalImage: null, originalSrc: '', sourceEdits: null, sampleCache: null, processToken: 0,
  layers: [], activeLayerId: null, baseVisible: true, snapshotGrid: null,
  paletteCodes: null, inventory: {}, paletteDraft: null, paletteMode: 'palette',
  exportSettings: { interval: 5, majorColor: '#E83F36', minorColor: '#77736D', showSymbols: true }
};

const DRAFT_DB_NAME = 'douge-projects';
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_KEY = 'current-project';
const DRAFT_VERSION = 1;
const DRAFT_TTL = 3 * 24 * 60 * 60 * 1000;

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function gridInterval(value,fallback=5) { const n=parseInt(value,10);return Number.isFinite(n)?clamp(n,0,20):fallback; }
function gridIntervalLabel(value) { return value===0?'无粗线':value===1?'每格粗线':`每 ${value} 格`; }
function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(rgb) { return '#' + rgb.map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function luminance(rgb) { return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000; }
function colorDistance(a, b) {
  const mean = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db;
}
const MARD_COLORS = window.MARD_PALETTE.map(([code, hex]) => ({ code, name: `MARD ${code}`, hex, rgb: hexToRgb(hex) }));
const MARD_RGB = MARD_COLORS.map(color => color.rgb);
const EMPTY_KEY = '__EMPTY__';
const EMPTY_COLOR = Object.freeze({ code: 'EMPTY', name: '无豆 / 留空', hex: 'transparent', rgb: [255, 255, 255], isEmpty: true });
let draftDatabasePromise = null;

function serializeColor(color) {
  if (!color) return null;
  return { code: color.code, name: color.name, hex: color.hex, rgb: [...color.rgb], isEmpty: Boolean(color.isEmpty) };
}

function deserializeColor(data) {
  if (!data) return null;
  if (data.isEmpty || data.code === EMPTY_COLOR.code) return EMPTY_COLOR;
  const known = MARD_COLORS.find(color => color.code === data.code && color.hex.toUpperCase() === String(data.hex).toUpperCase());
  if (known) return known;
  if (!/^#[0-9A-F]{6}$/i.test(String(data.hex)) || !Array.isArray(data.rgb) || data.rgb.length !== 3) return null;
  const code=/^[A-Z]{1,3}\d{1,6}$/.test(String(data.code))?String(data.code):'X01';
  return { code, name: code.startsWith('X')?'自定义色':`MARD ${code}`, hex: String(data.hex).toUpperCase(), rgb: hexToRgb(String(data.hex)) };
}

function openDraftDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('当前浏览器不支持 IndexedDB'));
  if (draftDatabasePromise) return draftDatabasePromise;
  draftDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_STORE_NAME)) request.result.createObjectStore(DRAFT_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地草稿库'));
  });
  return draftDatabasePromise;
}

async function readStoredDraft() {
  const db = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DRAFT_STORE_NAME, 'readonly').objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('无法读取本地草稿'));
  });
}

async function writeStoredDraft(record) {
  const db = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite');
    transaction.objectStore(DRAFT_STORE_NAME).put(record, DRAFT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('无法写入本地草稿'));
    transaction.onabort = () => reject(transaction.error || new Error('本地草稿写入已中止'));
  });
}

async function deleteStoredDraft() {
  const db = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite');
    transaction.objectStore(DRAFT_STORE_NAME).delete(DRAFT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('无法删除本地草稿'));
  });
}

function draftRecord() {
  const savedAt = Date.now();
  return {
    version: DRAFT_VERSION,
    savedAt,
    expiresAt: savedAt + DRAFT_TTL,
    imageSrc: ui.sourceThumb.src,
    originalImageSrc: state.originalSrc || ui.sourceThumb.src, sourceEdits: state.sourceEdits,
    fileName: state.fileName,
    fileMeta: ui.fileMeta.textContent,
    settings: {
      cols: state.cols, rows: state.rows, colors: clamp(parseInt(ui.colors.value) || 16, 4, MARD_COLORS.length),
      showGrid: ui.showGrid.checked, showSymbols: ui.showSymbols.checked, removeWhite: ui.removeWhite.checked,
      majorGridSize: ui.majorGridSize.value, majorGridStyle: ui.majorGridStyle.value,
      majorGridColor: state.exportSettings.majorColor, minorGridColor: state.exportSettings.minorColor, showReference: state.showReference,
      zoom: state.zoom, fitZoom: state.fitZoom, processingMode: state.processingMode, mergeStrength: state.mergeStrength
    },
    manualOverrides: [...state.manualOverrides].map(([index, color]) => [index, serializeColor(color)]),
    layers: state.layers.map(layer => ({ id:layer.id, name:layer.name, visible:layer.visible, locked:layer.locked, cells:[...layer.cells].map(([i,c])=>[i,serializeColor(c)]),scalePercent:layer.scalePercent,scaleOffset:layer.scaleOffset,scaleSource:layer.scaleSource?[...layer.scaleSource].map(([i,c])=>[i,serializeColor(c)]):null })),
    activeLayerId: state.activeLayerId, baseVisible: state.baseVisible,
    snapshotGrid: state.snapshotGrid,
    paletteCodes: state.paletteCodes ? [...state.paletteCodes] : null,
    colorReplacements: [...state.colorReplacements].map(([key, color]) => [key, serializeColor(color)]),
    selectedColor: serializeColor(state.selectedColor),
    lastPaintColor: serializeColor(state.lastPaintColor),
    customIndex: state.customIndex
  };
}

function formatDraftStatus(savedAt) {
  const time = new Date(savedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `已保存 ${time} · 编辑后续期 3 天`;
}

function updateDraftControls() {
  ui.saveDraft.disabled = !state.image;
  ui.clearDraft.disabled = !state.hasStoredDraft;
}

async function saveDraft(showNotice = false) {
  if (!state.image || state.restoringDraft) return;
  clearTimeout(state.draftSaveTimer); state.draftSaveTimer = null;
  ui.draftStatus.textContent = '正在保存草稿…';
  const record = draftRecord();
  try {
    await writeStoredDraft(record);
    state.hasStoredDraft = true; updateDraftControls(); ui.draftStatus.textContent = formatDraftStatus(record.savedAt);
    if (window.PindouCloudDraft) {
      if (showNotice) window.PindouCloudDraft.save(record, true);
      else window.PindouCloudDraft.queueSave(record);
    }
    if (showNotice) showToast('草稿已保存在当前浏览器，有效期 3 天');
  } catch (error) {
    console.error(error); ui.draftStatus.textContent = '保存失败，可能是浏览器存储空间不足';
    if (showNotice) showToast('草稿保存失败，请检查浏览器存储空间');
  }
}

function scheduleDraftSave() {
  if (!state.image || state.restoringDraft) return;
  clearTimeout(state.draftSaveTimer);
  state.draftSaveTimer = setTimeout(() => saveDraft(false), 900);
}

function prepareDedicatedEditor(event) {
  if (!state.image) {
    event.preventDefault();
    showToast('请先选择一张图片');
    return;
  }
  // IndexedDB transactions are queued in creation order, so the editor's read
  // waits for this write while the browser opens the new tab normally.
  saveDraft(false);
}

function leaveDedicatedEditor() {
  if (window.opener && !window.opener.closed) {
    window.opener.focus();
    window.close();
    return;
  }
  window.location.href = window.location.pathname;
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed',collapsed);
  const button=el('sidebarToggle'),panel=el('layersPanel');
  button.textContent=collapsed?'◨ 展开菜单':'◧ 收起菜单';button.setAttribute('aria-expanded',String(!collapsed));
  if(collapsed)document.querySelector('.canvas-toolbar').after(panel);
  else el('controlsPanel').insertBefore(panel,document.querySelector('.draft-section'));
  // Page scrolling must own sticky positioning in the expanded workspace.
  // Keep the toolbar in normal flow, outside the canvas overflow container.
  const toolbar=el('paintToolbar');
  if(collapsed)el('canvasStage').insertBefore(toolbar,ui.scroll);
  else ui.scroll.prepend(toolbar);
  document.documentElement.style.setProperty('--topbar-height',`${document.querySelector('.topbar').getBoundingClientRect().height}px`);
  if(collapsed)state.fitZoom=true;
  requestAnimationFrame(()=>{if(state.image)render(ui.canvas,false,{recalculate:false,updateUi:false,save:false});});
}
function applyEditorMode() {
  document.body.classList.remove('editor-mode');
  if (ui.editorPageHeader) ui.editorPageHeader.hidden = true;
  setSidebarCollapsed(EDITOR_MODE);
  document.title = EDITOR_MODE ? '豆格 · 独立图纸编辑器' : '豆格 · 拼豆图纸生成器';
}

async function clearDraft(showNotice = true, clearCloud = showNotice) {
  clearTimeout(state.draftSaveTimer); state.draftSaveTimer = null;
  try {
    await deleteStoredDraft();
    state.hasStoredDraft = false; updateDraftControls();
    ui.draftStatus.textContent = state.image ? '缓存已清除，继续编辑后会重新保存' : '暂无草稿 · 编辑后自动保存 3 天';
    if (clearCloud && window.PindouCloudDraft) window.PindouCloudDraft.remove();
    if (showNotice) showToast('本地草稿已删除');
  } catch (error) {
    console.error(error); ui.draftStatus.textContent = '无法删除本地草稿';
    if (showNotice) showToast('删除草稿失败');
  }
}

function applyDraftState(draft) {
  const settings = draft.settings || {};
  state.processingMode=settings.processingMode==='cartoon'?'cartoon':'realistic';
  state.mergeStrength=clamp(Number(settings.mergeStrength??35),0,100);
  el('processingMode').value=state.processingMode;el('mergeStrength').value=state.mergeStrength;el('mergeStrengthValue').textContent=state.mergeStrength;
  const cols = clamp(parseInt(settings.cols) || 80, 8, 600), rows = clamp(parseInt(settings.rows) || 40, 8, 600);
  ui.width.value = cols; ui.height.value = rows; ui.colors.value = clamp(parseInt(settings.colors) || 16, 4, MARD_COLORS.length);
  ui.showGrid.checked = settings.showGrid !== false; ui.showSymbols.checked = settings.showSymbols !== false; ui.removeWhite.checked = Boolean(settings.removeWhite);
  const restoredInterval = gridInterval(settings.majorGridSize,state.exportSettings.interval??5);
  ui.majorGridSize.value = String(restoredInterval); ui.gridIntervalValue.textContent = gridIntervalLabel(restoredInterval); ui.majorGridStyle.value = settings.majorGridStyle === 'dashed' ? 'dashed' : 'solid';
  state.exportSettings.interval = restoredInterval;
  if (/^#[0-9A-F]{6}$/i.test(settings.majorGridColor || '')) state.exportSettings.majorColor = settings.majorGridColor.toUpperCase();
  if (/^#[0-9A-F]{6}$/i.test(settings.minorGridColor || '')) state.exportSettings.minorColor = settings.minorGridColor.toUpperCase();
  ui.exportMajorGridColor.value = state.exportSettings.majorColor; ui.exportMinorGridColor.value = state.exportSettings.minorColor;
  state.cols = cols; state.rows = rows; state.processedCols = cols; state.processedRows = rows;
  state.showReference = Boolean(settings.showReference);
  state.zoom = clamp(Number(settings.zoom) || 1, .25, 3); state.fitZoom = settings.fitZoom !== false;
  state.manualOverrides = new Map((draft.manualOverrides || []).map(([index, color]) => [Number(index), deserializeColor(color)]).filter(([index, color]) => Number.isInteger(index) && index >= 0 && index < cols * rows && color));
  state.colorReplacements = new Map((draft.colorReplacements || []).map(([key, color]) => [String(key).toUpperCase(), deserializeColor(color)]).filter(([, color]) => color));
  state.selectedColor = deserializeColor(draft.selectedColor); state.lastPaintColor = deserializeColor(draft.lastPaintColor);
  state.customIndex = Math.max(1, parseInt(draft.customIndex) || 1);
  restoreLayers(draft);
  state.snapshotGrid=validPatternGrid(draft.snapshotGrid)?draft.snapshotGrid:null;
  if (Array.isArray(draft.paletteCodes)) state.paletteCodes = new Set(draft.paletteCodes.filter(code=>MARD_COLORS.some(c=>c.code===code)));
}

async function restoreDraftOnStart() {
  try {
    const draft = await readStoredDraft();
    if (!draft) { ui.draftStatus.textContent = '暂无草稿 · 编辑后自动保存 3 天'; updateDraftControls(); return; }
    if (draft.version !== DRAFT_VERSION || !draft.imageSrc || !draft.expiresAt || draft.expiresAt <= Date.now()) {
      await deleteStoredDraft(); state.hasStoredDraft = false; ui.draftStatus.textContent = '旧草稿已过期并自动清理'; updateDraftControls(); return;
    }
    if (state.image || state.skipDraftRestore) return;
    state.hasStoredDraft = true; state.restoringDraft = true; updateDraftControls(); ui.draftStatus.textContent = '正在恢复上次草稿…';
    loadImage(draft.imageSrc, draft.fileName || '未命名作品.png', draft.fileMeta || '本地草稿', draft);
  } catch (error) {
    console.error(error); ui.draftStatus.textContent = '当前浏览器无法使用本地草稿'; updateDraftControls();
  }
}
function nearestIndex(rgb, colors) {
  let best = 0, score = Infinity;
  for (let i = 0; i < colors.length; i++) { const d = colorDistance(rgb, colors[i]); if (d < score) { score = d; best = i; } }
  return best;
}

// 原图中的每个像素只会被计入一个网格区域，整个过程不创建网格尺寸的缩略图。
function averageOriginalRegions(image, cols, rows, dominant = false) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const count = cols * rows;
  const sumR = new Float64Array(count), sumG = new Float64Array(count), sumB = new Float64Array(count), weights = new Float64Array(count);
  const buckets=dominant?new Map():null;
  const winners=dominant?new Array(count):null;
  for (let y = 0; y < canvas.height; y++) {
    const gy = Math.min(rows - 1, Math.floor(y * rows / canvas.height));
    for (let x = 0; x < canvas.width; x++) {
      const gx = Math.min(cols - 1, Math.floor(x * cols / canvas.width));
      const cell = gy * cols + gx, i = (y * canvas.width + x) * 4, alpha = data[i + 3] / 255;
      if (alpha < .05) continue;
      if(dominant){
        const key=cell*4096+(data[i]>>4)*256+(data[i+1]>>4)*16+(data[i+2]>>4);
        let bucket=buckets.get(key);if(!bucket){bucket=[0,0,0,0];buckets.set(key,bucket);}
        bucket[0]+=data[i]*alpha;bucket[1]+=data[i+1]*alpha;bucket[2]+=data[i+2]*alpha;bucket[3]+=alpha;
        if(!winners[cell]||bucket[3]>winners[cell][3])winners[cell]=bucket;
      }
      sumR[cell] += data[i] * alpha; sumG[cell] += data[i + 1] * alpha; sumB[cell] += data[i + 2] * alpha; weights[cell] += alpha;
    }
  }
  return Array.from({ length: count }, (_, i) => {
    if(!weights[i]&&(cols>canvas.width||rows>canvas.height)){
      const x=Math.min(canvas.width-1,Math.floor((i%cols+.5)*canvas.width/cols)),y=Math.min(canvas.height-1,Math.floor((Math.floor(i/cols)+.5)*canvas.height/rows)),p=(y*canvas.width+x)*4;
      return data[p+3]/255>=.05?[data[p],data[p+1],data[p+2]]:null;
    }
    return dominant ? (winners[i]?winners[i].slice(0,3).map(v=>v/winners[i][3]):null) : weights[i] ? [sumR[i] / weights[i], sumG[i] / weights[i], sumB[i] / weights[i]] : null;
  });
}

// 将区域平均色按感知颜色距离分层。颜色数量是上限，实际颜色可能更少。
function clusterColors(samples, requestedCount) {
  const valid = samples.filter(Boolean);
  if (!valid.length) return { colors: [], assignments: samples.map(() => -1) };
  // 大图最多取约 12,000 个均匀分布的格子训练色心；最终仍会给全部格子分配色号。
  // 这样 600×600 图纸不会把聚类计算放大到数亿次距离比较。
  const trainingLimit = 12000;
  const stride = Math.max(1, Math.ceil(valid.length / trainingLimit));
  const training = stride === 1 ? valid : valid.filter((_, index) => index % stride === 0).slice(0, trainingLimit);
  const unique = new Map();
  for (const rgb of training) { const key = rgb.map(v => Math.round(v / 3) * 3).join(','); if (!unique.has(key)) unique.set(key, rgb); }
  const points = [...unique.values()], k = Math.min(requestedCount, points.length);
  const mean = training.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(v => v / training.length);
  const centers = [points.reduce((best, p) => colorDistance(p, mean) < colorDistance(best, mean) ? p : best, points[0]).slice()];
  const seedDistances = new Float64Array(points.length).fill(Infinity);
  while (centers.length < k) {
    let farthest = points[0], farthestDistance = -1;
    for (let i=0;i<points.length;i++) { const p=points[i],d=Math.min(seedDistances[i],colorDistance(p,centers[centers.length-1])); seedDistances[i]=d; if (d > farthestDistance) { farthestDistance = d; farthest = p; } }
    centers.push(farthest.slice());
  }
  for (let iteration = 0; iteration < 8; iteration++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const p of training) { const n = nearestIndex(p, centers); sums[n][0] += p[0]; sums[n][1] += p[1]; sums[n][2] += p[2]; sums[n][3]++; }
    let movement = 0;
    for (let i = 0; i < k; i++) if (sums[i][3]) {
      const next = [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]];
      movement += colorDistance(centers[i], next); centers[i] = next;
    }
    if (movement < 1) break;
  }
  // 聚类数量只是上限；感知距离很小的中心继续合并，避免把近似色硬拆成多种豆子。
  const mergedCenters = [];
  for (const center of centers) {
    const match = mergedCenters.findIndex(existing => colorDistance(center, existing) < state.mergeStrength ** 2 * .6);
    if (match < 0) mergedCenters.push(center.slice());
    else mergedCenters[match] = mergedCenters[match].map((v, channel) => (v + center[channel]) / 2);
  }
  // 将每个色块锁定到最接近的 MARD 221 实体豆色；多个色块命中同一色号时自动合并。
  const available = MARD_COLORS.filter(color => !state.paletteCodes || state.paletteCodes.has(color.code));
  if (!available.length) throw new Error('色板至少需要保留一种颜色');
  const availableRgb = available.map(color=>color.rgb);
  const mappedByCode = new Map();
  for (const center of mergedCenters) {
    const mard = available[nearestIndex(center, availableRgb)];
    mappedByCode.set(mard.code, mard);
  }
  const colors = [...mappedByCode.values()].sort((a, b) => luminance(b.rgb) - luminance(a.rgb));
  const paletteCenters = colors.map(item => item.rgb);
  const assignmentCache = new Map();
  const assignments = samples.map(p => {
    if (!p) return -1;
    const key = `${Math.round(p[0] / 4)},${Math.round(p[1] / 4)},${Math.round(p[2] / 4)}`;
    if (!assignmentCache.has(key)) assignmentCache.set(key, nearestIndex(p, paletteCenters));
    return assignmentCache.get(key);
  });
  return { colors, assignments };
}

function colorKey(color) { return color && color.isEmpty ? EMPTY_KEY : `${color.code || ''}:${color.hex}`.toUpperCase(); }

function resolveReplacementKey(startKey) {
  const key = startKey.toUpperCase();
  const target=state.colorReplacements.get(key)||state.colorReplacements.get(key.split(':').at(-1));
  return target?colorKey(target):key;
}

function resolveColorReplacement(color) {
  return color ? state.colorReplacements.get(colorKey(color)) || state.colorReplacements.get(color.hex.toUpperCase()) || color : color;
}

function renderableCell(color) {
  const resolved = color ? resolveColorReplacement(color) : null;
  return resolved && !resolved.isEmpty ? resolved : null;
}

function selectPaintColor(color) {
  state.selectedColor = color;
  if (color && !color.isEmpty) state.lastPaintColor = color;
}

function toggleEraser() {
  if (state.selectedColor && state.selectedColor.isEmpty) {
    let restore = state.lastPaintColor ? resolveColorReplacement(state.lastPaintColor) : null;
    if (!restore || restore.isEmpty) restore = state.used[0] || MARD_COLORS[0];
    selectPaintColor(restore);
  } else {
    if (state.selectedColor) state.lastPaintColor = state.selectedColor;
    state.selectedColor = EMPTY_COLOR;
  }
  state.pickerMode = false; state.tool = 'brush'; updatePaintUI(); updateDetails();
}

function applyColorLayers() {
  state.cells = state.baseVisible ? state.baseCells.slice() : Array(state.baseCells.length).fill(null);
  const sources = state.layers.length ? state.layers.filter(layer=>layer.visible).map(layer=>layer.cells) : [state.manualOverrides];
  for (const source of sources) for (const [index, color] of source) {
    if (index >= 0 && index < state.cells.length) state.cells[index] = color;
  }
  state.cells = state.cells.map(renderableCell);
}

function historySnapshot() {
  return { manualOverrides: new Map(state.manualOverrides), colorReplacements: new Map(state.colorReplacements),
    layers:state.layers.map(layer=>({...layer,cells:new Map(layer.cells)})),activeLayerId:state.activeLayerId,baseVisible:state.baseVisible };
}
function restoreHistorySnapshot(snapshot) {
  state.manualOverrides = new Map(snapshot.manualOverrides); state.colorReplacements = new Map(snapshot.colorReplacements);
  state.layers = (snapshot.layers || []).map(layer=>({...layer,cells:new Map(layer.cells)})); state.activeLayerId=snapshot.activeLayerId; state.baseVisible=snapshot.baseVisible!==false;
  bindActiveLayer();
  applyColorLayers(); render(); renderLayers(); updatePaintUI();
}
function pushHistory() {
  state.history.push(historySnapshot()); state.redoHistory = [];
  if (state.history.length > 30) state.history.shift();
}

function replaceColorGlobally(source, target) {
  const sourceKey = colorKey(source), targetKey = colorKey(target);
  if (sourceKey === targetKey) return false;
  pushHistory();
  const affectedKeys = new Set([sourceKey]);
  for (const color of state.baseCells) if (color && resolveReplacementKey(colorKey(color)) === sourceKey) affectedKeys.add(colorKey(color));
  for (const cells of state.layers.length?state.layers.map(layer=>layer.cells):[state.manualOverrides]) for (const color of cells.values()) if (color && resolveReplacementKey(colorKey(color)) === sourceKey) affectedKeys.add(colorKey(color));
  for (const rawKey of state.colorReplacements.keys()) if (resolveReplacementKey(rawKey) === sourceKey) affectedKeys.add(rawKey);

  // 映射始终保存为“原始色 → 最终色”，不递归追踪，因此不会形成替换链或循环。
  for (const rawKey of affectedKeys) {
    if (rawKey === targetKey) state.colorReplacements.delete(rawKey);
    else state.colorReplacements.set(rawKey, target);
  }
  applyColorLayers();
  return true;
}

function remapManualOverrides(oldCols, oldRows, newCols, newRows) {
  if (!state.manualOverrides.size || (oldCols === newCols && oldRows === newRows)) return new Map(state.manualOverrides);
  const remapped = new Map();
  for (const [oldIndex, color] of state.manualOverrides) {
    const oldX = oldIndex % oldCols, oldY = Math.floor(oldIndex / oldCols);
    const newX = Math.min(newCols - 1, Math.floor((oldX + .5) * newCols / oldCols));
    const newY = Math.min(newRows - 1, Math.floor((oldY + .5) * newRows / oldRows));
    remapped.set(newY * newCols + newX, color);
  }
  return remapped;
}

function processImage(onComplete) {
  if (!state.image) return;
  const nextCols = clamp(parseInt(ui.width.value) || 80, 8, 600);
  const nextRows = clamp(parseInt(ui.height.value) || 40, 8, 600);
  const dimensionsChanged = nextCols !== state.processedCols || nextRows !== state.processedRows;
  if (dimensionsChanged) {
    for(const layer of state.layers){layer.scaleSource=null;layer.scalePercent=100;}
    if (state.layers.length) {
      for (const layer of state.layers) { state.manualOverrides=layer.cells; layer.cells=remapManualOverrides(state.processedCols,state.processedRows,nextCols,nextRows); }
      bindActiveLayer();
    } else state.manualOverrides = remapManualOverrides(state.processedCols, state.processedRows, nextCols, nextRows);
    state.history = []; state.redoHistory = []; state.selection = null;
  }
  state.cols = nextCols; state.rows = nextRows;
  state.processedCols = nextCols; state.processedRows = nextRows;
  ui.width.value = state.cols; ui.height.value = state.rows;
  ui.paintStatus.textContent = '正在计算区域平均色…';
  const processToken=++state.processToken;
  requestAnimationFrame(() => {
    if(processToken!==state.processToken)return;
    try {
      if(state.snapshotGrid && state.snapshotGrid.cols===state.cols && state.snapshotGrid.rows===state.rows){
        const grid=state.snapshotGrid, colors=grid.colors.map(deserializeColor);
        state.baseCells=grid.indices.map(i=>i<0?null:colors[i]);applyColorLayers();render();renderLayers();updatePaintUI();onComplete?.(true);return;
      }
      state.snapshotGrid=null;
      const key=`${state.cols}:${state.rows}:${state.processingMode}`;
      if(!state.sampleCache||state.sampleCache.image!==state.image||state.sampleCache.key!==key)state.sampleCache={image:state.image,key,samples:averageOriginalRegions(state.image,state.cols,state.rows,state.processingMode==='cartoon')};
      const averages = state.sampleCache.samples;
      const filtered = averages.map(rgb => rgb && ui.removeWhite.checked && luminance(rgb) > 242 ? null : rgb);
      const requestedColors = clamp(parseInt(ui.colors.value) || 16, 4, MARD_COLORS.length);
      ui.colors.value = requestedColors;
      const result = clusterColors(filtered, requestedColors);
      state.baseCells = result.assignments.map(i => i < 0 ? null : result.colors[i]);
      applyColorLayers();
      if (!state.selectedColor) selectPaintColor(result.colors[0] || null);
      render(); updatePaintUI(); renderLayers(); onComplete?.(true);
    } catch (error) {
      console.error(error); showToast('图片过大，浏览器无法读取全部像素'); ui.paintStatus.textContent = '处理失败'; onComplete?.(false);
    }
  });
}

function recalculateUsed() {
  const map = new Map();
  for (const color of state.cells) if (color) {
    const key = colorKey(color);
    if (!map.has(key)) map.set(key, { ...color, count: 0 });
    map.get(key).count++;
  }
  state.used = [...map.values()].sort((a, b) => b.count - a.count).map(p => ({ ...p, symbol: p.code }));
}

const ZOOM_LEVELS = [.25, .33, .5, .67, .75, 1, 1.25, 1.5, 2, 2.5, 3];
function updateZoomUI() {
  const percent = Math.round(state.zoom * 100);
  ui.zoomValue.textContent = `${percent}%`;
  ui.zoomOut.disabled = state.zoom <= ZOOM_LEVELS[0];
  ui.zoomIn.disabled = state.zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  ui.zoomFit.classList.toggle('active', state.fitZoom);
  ui.zoomFit.setAttribute('aria-pressed', String(state.fitZoom));
}
function applyCanvasZoom() {
  if (!ui.canvas.width || !ui.canvas.height) { updateZoomUI(); return; }
  const logicalWidth = state.previewLogicalWidth || ui.canvas.width;
  const logicalHeight = state.previewLogicalHeight || ui.canvas.height;
  ui.canvas.style.width = `${Math.max(1, Math.round(logicalWidth * state.zoom))}px`;
  ui.canvas.style.height = `${Math.max(1, Math.round(logicalHeight * state.zoom))}px`;
  syncCanvasToolbar();
  updateZoomUI();
}
function toolbarNeedsDock(canvasHeight, toolbarHeight, viewportHeight, headerHeight) {
  return canvasHeight + toolbarHeight + headerHeight + 64 > viewportHeight;
}
function syncCanvasToolbar() {
  const headerHeight=document.querySelector('.topbar').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--topbar-height',`${headerHeight}px`);
  const stage=el('canvasStage'),toolbar=el('paintToolbar');
  const dock=document.body.classList.contains('sidebar-collapsed') && toolbarNeedsDock(
    parseFloat(ui.canvas.style.height)||0,toolbar.getBoundingClientRect().height,window.innerHeight,headerHeight);
  stage.classList.toggle('toolbar-docked',dock);
}
function setCanvasZoom(nextZoom, fit = false) {
  if (!state.image) return;
  const oldZoom = state.zoom || 1, focusX = ui.scroll.scrollLeft + ui.scroll.clientWidth / 2 - ui.canvas.offsetLeft;
  const focusY = ui.scroll.scrollTop + ui.scroll.clientHeight / 2 - ui.canvas.offsetTop;
  state.fitZoom = fit;
  if (!fit) state.zoom = clamp(nextZoom, ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  render();
  if (fit) { ui.scroll.scrollLeft = 0; scheduleDraftSave(); return; }
  const ratio = state.zoom / oldZoom;
  requestAnimationFrame(() => {
    ui.scroll.scrollLeft = ui.canvas.offsetLeft + focusX * ratio - ui.scroll.clientWidth / 2;
    ui.scroll.scrollTop = ui.canvas.offsetTop + focusY * ratio - ui.scroll.clientHeight / 2;
  });
  scheduleDraftSave();
}
function stepCanvasZoom(direction) {
  const next = direction > 0
    ? ZOOM_LEVELS.find(level => level > state.zoom + .005) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
    : [...ZOOM_LEVELS].reverse().find(level => level < state.zoom - .005) || ZOOM_LEVELS[0];
  setCanvasZoom(next, false);
}

function render(target = ui.canvas, exportMode = false, options = {}) {
  const recalculate = options.recalculate !== false, updateUi = options.updateUi !== false, save = options.save !== false;
  if (recalculate) recalculateUsed();
  const total = state.used.reduce((sum, color) => sum + color.count, 0);
  const baseCell = exportMode
    ? Math.max(12, Math.min(32, Math.floor(1900 / state.cols), Math.floor(2600 / state.rows)))
    : Math.min(18, Math.max(4, Math.floor(900 / state.cols)));
  const coordinatesVisible = true;
  const logicalCoordinateBand = coordinatesVisible ? (exportMode ? 34 : Math.max(18, Math.min(28, baseCell * 1.8))) : 0;
  if (!exportMode && state.fitZoom) {
    const logicalWidth = state.cols * baseCell + logicalCoordinateBand * 2;
    const availableWidth = Math.max(160, ui.scroll.clientWidth - 36);
    state.zoom = clamp(Math.min(1, availableWidth / logicalWidth), ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  }
  const renderScale = exportMode ? 1 : Math.min(3, Math.max(1, state.zoom * Math.min(window.devicePixelRatio || 1, 2)));
  const cell = baseCell * renderScale;
  const coordinateBand = logicalCoordinateBand * renderScale;
  const outerPadding = exportMode ? 38 : 0;
  const titleHeight = exportMode ? 104 : 0;
  const gridWidth = state.cols * cell, gridHeight = state.rows * cell;
  const contentWidth = gridWidth + coordinateBand * 2;
  const canvasWidth = Math.max(contentWidth + outerPadding * 2, exportMode ? 1000 : 0);
  const horizontalOffset = (canvasWidth - contentWidth - outerPadding * 2) / 2;
  const gridX = outerPadding + coordinateBand + horizontalOffset, gridY = titleHeight + coordinateBand;
  const legendColumns = exportMode ? Math.max(1, Math.min(10, Math.floor((canvasWidth - outerPadding * 2) / 190))) : 0;
  const legendRows = exportMode ? Math.ceil(state.used.length / legendColumns) : 0;
  const legendHeight = exportMode ? 78 + legendRows * 50 : 0;
  target.width = canvasWidth;
  target.height = gridY + gridHeight + coordinateBand + outerPadding + legendHeight;
  if (!exportMode) {
    state.cellSize = cell; state.gridOriginX = gridX; state.gridOriginY = gridY;
    state.previewRenderScale = renderScale;
    state.previewLogicalWidth = target.width / renderScale;
    state.previewLogicalHeight = target.height / renderScale;
    applyCanvasZoom();
  }

  const ctx = target.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target.width, target.height);
  const referenceVisible = state.showReference && !exportMode && state.image;
  if (referenceVisible) {
    ctx.save(); ctx.globalAlpha = .82;
    ctx.drawImage(state.image, 0, 0, state.image.naturalWidth, state.image.naturalHeight, gridX, gridY, gridWidth, gridHeight);
    ctx.restore();
  }
  const symbolMap = new Map(state.used.map(p => [colorKey(p), p.symbol]));
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    const p = state.cells[y * state.cols + x], px = gridX + x * cell, py = gridY + y * cell;
    if (p) {
      ctx.save(); ctx.globalAlpha = referenceVisible ? .52 : 1; ctx.fillStyle = p.hex;
      const inset = exportMode ? .3 : .3 * renderScale;
      ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
      ctx.restore();
      if (exportMode ? state.exportSettings.showSymbols : ui.showSymbols.checked && baseCell*state.zoom>=8) {
        const code = symbolMap.get(colorKey(p)) || p.code;
        const symbolSize = Math.max(5, Math.min(cell * .38, (cell - 2) / Math.max(1, code.length * .56)));
        ctx.fillStyle = luminance(p.rgb) > 155 ? '#292723' : '#fff'; ctx.font = `700 ${symbolSize}px Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(code, px + cell / 2, py + cell / 2 + .5);
      }
    }
  }

  drawGridAndCoordinates(ctx, { cell, gridX, gridY, gridWidth, gridHeight, coordinateBand, exportMode, renderScale });
  if (!exportMode && state.drawing && state.gestureStartIndex >= 0 && state.gestureEndIndex >= 0 && ['line','rect','select'].includes(state.tool)) {
    drawGesturePreview(ctx, { cell, gridX, gridY, renderScale });
  }
  if (!exportMode && state.selection) {
    const selection = state.selection;
    ctx.save(); ctx.strokeStyle = '#1877d2'; ctx.fillStyle = 'rgba(24,119,210,.10)'; ctx.lineWidth = Math.max(2, 1.6 * renderScale); ctx.setLineDash([6 * renderScale, 4 * renderScale]);
    const sx = gridX + selection.left * cell, sy = gridY + selection.top * cell;
    const sw = (selection.right - selection.left + 1) * cell, sh = (selection.bottom - selection.top + 1) * cell;
    ctx.fillRect(sx, sy, sw, sh); ctx.strokeRect(sx, sy, sw, sh); ctx.restore();
  }

  if (exportMode) {
    ctx.fillStyle = '#242321'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 22px Arial, sans-serif'; ctx.fillText('豆格 · MARD 拼豆图纸', outerPadding, 32);
    ctx.font = '700 34px "Microsoft YaHei", Arial, sans-serif'; ctx.fillText(state.fileName.replace(/\.[^.]+$/, ''), outerPadding, 76);
    ctx.textAlign = 'right'; ctx.font = '700 21px Arial, sans-serif';
    ctx.fillText(`${state.cols} × ${state.rows} / ${state.used.length} 色 / 共 ${total} 颗`, target.width - outerPadding, 73);
    drawExportLegend(ctx, gridY + gridHeight + coordinateBand + outerPadding, outerPadding, target.width - outerPadding * 2, legendColumns);
  }
  if (updateUi) updateDetails();
  if (target === ui.canvas && !exportMode && save) scheduleDraftSave();
}

function scheduleInteractiveRender() {
  if (state.renderFrame) return;
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = 0;
    render(ui.canvas, false, { recalculate: false, updateUi: false, save: false });
  });
}

function drawGesturePreview(ctx, layout) {
  const { cell, gridX, gridY, renderScale } = layout;
  const start = cellPoint(state.gestureStartIndex), end = cellPoint(state.gestureEndIndex);
  if (!start || !end) return;
  ctx.save();
  if (state.tool === 'select') {
    const left = Math.min(start.x,end.x), right = Math.max(start.x,end.x), top = Math.min(start.y,end.y), bottom = Math.max(start.y,end.y);
    ctx.fillStyle = 'rgba(24,119,210,.10)'; ctx.strokeStyle = '#1877d2'; ctx.lineWidth = Math.max(2,1.6*renderScale); ctx.setLineDash([6*renderScale,4*renderScale]);
    ctx.fillRect(gridX + left*cell, gridY + top*cell, (right-left+1)*cell, (bottom-top+1)*cell);
    ctx.strokeRect(gridX + left*cell, gridY + top*cell, (right-left+1)*cell, (bottom-top+1)*cell);
  } else {
    const indices = state.tool === 'line' ? lineIndices(state.gestureStartIndex,state.gestureEndIndex) : rectangleIndices(state.gestureStartIndex,state.gestureEndIndex,true);
    const previewColor = state.selectedColor && !state.selectedColor.isEmpty ? state.selectedColor.hex : '#FFFFFF';
    ctx.globalAlpha = .58; ctx.fillStyle = previewColor;
    for (const index of indices) { const point = cellPoint(index); ctx.fillRect(gridX+point.x*cell+.5,gridY+point.y*cell+.5,Math.max(1,cell-1),Math.max(1,cell-1)); }
    ctx.globalAlpha = 1; ctx.strokeStyle = '#1677b8'; ctx.lineWidth = Math.max(1.5,1.2*renderScale); ctx.setLineDash([5*renderScale,3*renderScale]);
    ctx.beginPath(); ctx.moveTo(gridX+(start.x+.5)*cell,gridY+(start.y+.5)*cell); ctx.lineTo(gridX+(end.x+.5)*cell,gridY+(end.y+.5)*cell); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#1677b8';
    for (const point of [start,end]) { ctx.beginPath(); ctx.arc(gridX+(point.x+.5)*cell,gridY+(point.y+.5)*cell,Math.max(2.5,2*renderScale),0,Math.PI*2); ctx.fill(); }
  }
  ctx.restore();
}

function drawGridAndCoordinates(ctx, layout) {
  const { cell, gridX, gridY, gridWidth, gridHeight, coordinateBand, exportMode, renderScale = 1 } = layout;
  ctx.save();
  if (ui.showGrid.checked) {
    ctx.beginPath();
    for (let x = 0; x <= state.cols; x++) { const px = gridX + x * cell; ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight); }
    for (let y = 0; y <= state.rows; y++) { const py = gridY + y * cell; ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py); }
    ctx.strokeStyle = state.exportSettings.minorColor; ctx.globalAlpha = exportMode ? .58 : .42; ctx.lineWidth = exportMode ? .8 : .55 * renderScale; ctx.setLineDash([]); ctx.stroke(); ctx.globalAlpha = 1;
  }

  const interval = state.exportSettings.interval;
  if(interval>0) {
  ctx.beginPath();
  for (let x = 0; x <= state.cols; x += interval) { const px = gridX + x * cell; ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight); }
  if (state.cols % interval) { ctx.moveTo(gridX + gridWidth, gridY); ctx.lineTo(gridX + gridWidth, gridY + gridHeight); }
  for (let y = 0; y <= state.rows; y += interval) { const py = gridY + y * cell; ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py); }
  if (state.rows % interval) { ctx.moveTo(gridX, gridY + gridHeight); ctx.lineTo(gridX + gridWidth, gridY + gridHeight); }
  ctx.strokeStyle = state.exportSettings.majorColor; ctx.lineWidth = exportMode ? 2 : 1.55 * renderScale;
  ctx.setLineDash(ui.majorGridStyle.value === 'dashed' ? (exportMode ? [7, 4] : [4 * renderScale, 2 * renderScale]) : []); ctx.stroke(); ctx.setLineDash([]);
  }

  const coordinateFont = exportMode ? Math.max(6, Math.min(13, cell * .45)) : Math.max(6, Math.min(9, cell * .58));
  ctx.font = `500 ${coordinateFont}px Arial, sans-serif`; ctx.fillStyle = '#68645e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let x = 0; x < state.cols; x++) {
    const px = gridX + (x + .5) * cell, label = String(x + 1);
    ctx.fillText(label, px, gridY - coordinateBand / 2); ctx.fillText(label, px, gridY + gridHeight + coordinateBand / 2);
  }
  for (let y = 0; y < state.rows; y++) {
    const py = gridY + (y + .5) * cell, label = String(y + 1);
    ctx.fillText(label, gridX - coordinateBand / 2, py); ctx.fillText(label, gridX + gridWidth + coordinateBand / 2, py);
  }
  ctx.restore();
}

function drawExportLegend(ctx, top, left, width, columns) {
  ctx.save();
  ctx.strokeStyle = '#d6d2cb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left + width, top); ctx.stroke();
  ctx.fillStyle = '#242321'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = '700 22px "Microsoft YaHei", Arial, sans-serif';
  ctx.fillText('配色清单', left, top + 34);
  ctx.fillStyle = '#77716a'; ctx.font = '14px Arial, sans-serif'; ctx.fillText(`MARD ${MARD_COLORS.length} · ${state.used.length} 种颜色`, left + 104, top + 34);
  const gap = 10, itemWidth = (width - gap * (columns - 1)) / columns, itemHeight = 50, startY = top + 52;
  state.used.forEach((color, index) => {
    const column = index % columns, row = Math.floor(index / columns), x = left + column * (itemWidth + gap), y = startY + row * itemHeight;
    ctx.fillStyle = '#faf9f7'; ctx.strokeStyle = '#d9d5ce'; ctx.lineWidth = 1; ctx.fillRect(x, y, itemWidth, 39); ctx.strokeRect(x, y, itemWidth, 39);
    ctx.fillStyle = color.hex; ctx.fillRect(x + 6, y + 6, 27, 27); ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.strokeRect(x + 6, y + 6, 27, 27);
    ctx.fillStyle = '#272522'; ctx.font = '700 14px Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(color.code, x + 40, y + 13);
    ctx.fillStyle = '#87817a'; ctx.font = '10px Arial, sans-serif'; ctx.fillText(color.hex, x + 40, y + 28);
    ctx.fillStyle = '#272522'; ctx.font = '700 14px Arial, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${color.count} 颗`, x + itemWidth - 8, y + 20);
  });
  ctx.restore();
}

function updateDetails() {
  const total = state.used.reduce((n, p) => n + p.count, 0);
  const emptyCount = Math.max(0, state.cols * state.rows - total);
  const eraserActive = Boolean(state.selectedColor && state.selectedColor.isEmpty);
  el('sizeStat').textContent = `${state.cols} × ${state.rows}`; el('beadStat').textContent = total.toLocaleString(); el('colorStat').textContent = state.used.length;
  el('paletteSummary').textContent = `共 ${total.toLocaleString()} 颗 · ${state.used.length} 种颜色`;
  const emptyCard = `<div class="swatch empty-swatch${eraserActive ? ' active' : ''}"><button class="swatch-select" data-empty-color title="${eraserActive ? '退出橡皮并恢复之前的颜色' : '选择橡皮，将格子设为无豆'}"><span class="swatch-color empty-pattern">×</span><span><b>无豆 / 留空</b><small>${eraserActive ? '再次点击退出橡皮' : '取消放置豆子'}</small></span><strong>${emptyCount}</strong></button><span class="swatch-empty-mark" title="留空格数量">空</span></div>`;
  ui.paletteList.innerHTML = emptyCard + state.used.map(p => `<div class="swatch${state.selectedColor && colorKey(state.selectedColor) === colorKey(p) ? ' active' : ''}"><button class="swatch-select" data-color="${colorKey(p)}" title="选择 ${p.code} 进行手绘"><span class="swatch-color" style="background:${p.hex};--text-color:${luminance(p.rgb) > 155 ? '#332f29' : '#fff'}">${p.symbol}</span><span><b>${p.name}</b><small>${p.code} · ${p.hex}</small></span><strong>${p.count}</strong></button><button class="swatch-replace" data-replace="${colorKey(p)}" title="替换全部 ${p.code}" aria-label="替换全部 ${p.code}">⇄</button></div>`).join('');
}

function updatePaintUI() {
  ui.paintToggle.classList.toggle('active', state.paintMode); ui.canvas.classList.toggle('painting', state.paintMode);
  ui.referenceToggle.classList.toggle('active', state.showReference); ui.referenceToggle.setAttribute('aria-pressed', String(state.showReference));
  ui.referenceToggle.querySelector('b').textContent = state.showReference ? '隐藏原图' : '显示原图';
  ui.eraserButton.disabled = !state.paintMode; ui.pickerButton.disabled = !state.paintMode; ui.mardColor.disabled = !state.paintMode; ui.customColor.disabled = !state.paintMode; ui.undoButton.disabled = !state.history.length; ui.redoButton.disabled = !state.redoHistory.length;
  [ui.fillButton, ui.lineButton, ui.rectButton, ui.selectButton].forEach(button => { if (button) button.disabled = !state.paintMode; });
  const eraserActive = Boolean(state.selectedColor && state.selectedColor.isEmpty);
  ui.eraserButton.classList.toggle('active', eraserActive); ui.eraserButton.setAttribute('aria-pressed', String(eraserActive));
  ui.eraserButton.innerHTML = eraserActive ? '<span>⌫</span> 退出橡皮' : '<span>⌫</span> 留空 / 橡皮';
  ui.pickerButton.classList.toggle('active', state.pickerMode);
  [[ui.fillButton,'fill'],[ui.lineButton,'line'],[ui.rectButton,'rect'],[ui.selectButton,'select'],[ui.panButton,'pan']].forEach(([button,tool]) => {
    if (!button) return; button.dataset.tool = tool; button.classList.toggle('active', state.tool === tool);
  });
  if (state.selectedColor && MARD_COLORS.some(color => color.code === state.selectedColor.code)) ui.mardColor.value = state.selectedColor.code;
  const selected = state.selectedColor ? (state.selectedColor.isEmpty ? '无豆 / 留空' : `${state.selectedColor.hex} · ${state.selectedColor.name}`) : '未选择颜色';
  const edited = state.manualOverrides.size ? ` · 已保留 ${state.manualOverrides.size} 格手绘` : '';
  const replaced = state.colorReplacements.size ? ` · ${state.colorReplacements.size} 条整色替换` : '';
  ui.paintStatus.hidden = !state.pickerMode && !state.paintMode;
  const toolNames = { brush: '画笔', fill: '填充', line: '直线', rect: '矩形', select: '选区', picker: '取色', pan: '拖拽' };
  ui.paintStatus.textContent = state.pickerMode ? '请在图纸上吸取颜色' : state.paintMode ? `${toolNames[state.tool] || '画笔'}：${selected}${edited}${replaced}${state.selection ? ` · 已选 ${state.selection.right-state.selection.left+1}×${state.selection.bottom-state.selection.top+1}` : ''}` : '';
  ui.selectionActions.hidden = !state.selection;
  if (state.selection) ui.selectionSize.textContent = `已选 ${state.selection.right-state.selection.left+1} × ${state.selection.bottom-state.selection.top+1}`;
  ui.selectionPaste.disabled = !state.selectionClipboard;
}

function colorAtPointer(event) {
  const rect = ui.canvas.getBoundingClientRect(), scaleX = ui.canvas.width / rect.width, scaleY = ui.canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX, canvasY = (event.clientY - rect.top) * scaleY;
  const x = Math.floor((canvasX - state.gridOriginX) / state.cellSize), y = Math.floor((canvasY - state.gridOriginY) / state.cellSize);
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return -1;
  return y * state.cols + x;
}
function cellPoint(index) { return index < 0 ? null : { x: index % state.cols, y: Math.floor(index / state.cols) }; }
function setCellOverride(index, color) {
  if (index < 0 || index >= state.cells.length || !color) return;
  const layer=state.layers.find(layer=>layer.id===state.activeLayerId);
  if (layer && (layer.locked || !layer.visible)) return;
  if(layer){layer.scaleSource=null;layer.scalePercent=100;layer.scaleOffset=null;}
  state.manualOverrides.set(index, color);
  let composed=state.baseVisible?state.baseCells[index]:null;
  if(state.layers.length){for(const candidate of state.layers)if(candidate.visible&&candidate.cells.has(index))composed=candidate.cells.get(index);}
  else composed=color;
  state.cells[index] = renderableCell(composed);
}
function paintAt(event) {
  const index = colorAtPointer(event); if (index < 0 || index === state.lastPaintIndex || !state.selectedColor) return;
  const indices = state.lastPaintIndex >= 0 ? lineIndices(state.lastPaintIndex, index) : [index];
  for (const cellIndex of indices) setCellOverride(cellIndex, state.selectedColor);
  state.lastPaintIndex = index; scheduleInteractiveRender();
}
function floodFill(startIndex, color) {
  const sourceKey = colorKey(state.cells[startIndex] || EMPTY_COLOR), targetKey = colorKey(color);
  if (sourceKey === targetKey) return;
  const queue = [startIndex], visited = new Uint8Array(state.cells.length);
  while (queue.length) {
    const index = queue.pop(); if (visited[index]) continue; visited[index] = 1;
    if (colorKey(state.cells[index] || EMPTY_COLOR) !== sourceKey) continue;
    setCellOverride(index, color);
    const x = index % state.cols, y = Math.floor(index / state.cols);
    if (x > 0) queue.push(index - 1); if (x + 1 < state.cols) queue.push(index + 1);
    if (y > 0) queue.push(index - state.cols); if (y + 1 < state.rows) queue.push(index + state.cols);
  }
}
function lineIndices(fromIndex, toIndex) {
  const from = cellPoint(fromIndex), to = cellPoint(toIndex), result = [];
  if (!from || !to) return result;
  let x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    result.push(y0 * state.cols + x0); if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error; if (twice >= dy) { error += dy; x0 += sx; } if (twice <= dx) { error += dx; y0 += sy; }
  }
  return result;
}
function rectangleIndices(fromIndex, toIndex, filled = false) {
  const from = cellPoint(fromIndex), to = cellPoint(toIndex), result = [];
  if (!from || !to) return result;
  const left = Math.min(from.x, to.x), right = Math.max(from.x, to.x), top = Math.min(from.y, to.y), bottom = Math.max(from.y, to.y);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (filled || x === left || x === right || y === top || y === bottom) result.push(y * state.cols + x);
  }
  return result;
}
function setTool(tool) {
  state.tool = tool; state.pickerMode = tool === 'picker';
  if (tool !== 'pan') state.paintMode = true;
  ui.scroll.classList.toggle('pan-mode', tool === 'pan');
  ui.scroll.classList.toggle('selection-active', tool === 'select');
  updatePaintUI();
}
function beginPaint(event) {
  if (state.tool === 'pan' || event.button === 1 || event.code === 'Space') {
    event.preventDefault(); state.panStart = { x: event.clientX, y: event.clientY, left: ui.scroll.scrollLeft, top: ui.scroll.scrollTop };
    state.drawing = true; ui.scroll.classList.add('dragging-pan'); ui.canvas.setPointerCapture?.(event.pointerId); return;
  }
  if (!state.paintMode) return;
  const activeLayer=state.layers.find(layer=>layer.id===state.activeLayerId);
  if (state.tool!=='select' && state.tool!=='picker' && activeLayer && (activeLayer.locked || !activeLayer.visible)) return showToast('请先显示并解锁当前图层');
  event.preventDefault(); const index = colorAtPointer(event); if (index < 0) return;
  if (state.tool === 'picker' || state.pickerMode) {
    selectPaintColor(state.cells[index] || EMPTY_COLOR); state.pickerMode = false; state.tool = 'brush'; updatePaintUI(); updateDetails(); return;
  }
  if (!state.selectedColor && state.tool !== 'select') return;
  if (state.tool !== 'select') pushHistory();
  state.gestureStartIndex = index; state.gestureEndIndex = index; state.drawing = true; state.lastPaintIndex = -1; ui.canvas.setPointerCapture?.(event.pointerId);
  if (state.tool === 'fill') { floodFill(index, state.selectedColor); state.drawing = false; state.gestureStartIndex = -1; state.gestureEndIndex = -1; applyColorLayers(); render(); }
  else if (state.tool === 'brush') paintAt(event);
  updatePaintUI();
}
function movePaint(event) {
  if (!state.drawing) return;
  if (state.panStart) {
    event.preventDefault(); ui.scroll.scrollLeft = state.panStart.left - (event.clientX - state.panStart.x); ui.scroll.scrollTop = state.panStart.top - (event.clientY - state.panStart.y); return;
  }
  if (state.tool === 'brush') { event.preventDefault(); paintAt(event); return; }
  if (['line','rect','select'].includes(state.tool)) {
    event.preventDefault(); const index = colorAtPointer(event);
    if (index >= 0 && index !== state.gestureEndIndex) { state.gestureEndIndex = index; scheduleInteractiveRender(); }
  }
}
function endPaint(event) {
  if (!state.drawing) return;
  if (state.panStart) { state.panStart = null; state.drawing = false; ui.scroll.classList.remove('dragging-pan'); return; }
  const pointerIndex = event ? colorAtPointer(event) : -1;
  const endIndex = pointerIndex >= 0 ? pointerIndex : state.gestureEndIndex;
  if (endIndex >= 0 && state.gestureStartIndex >= 0) {
    if (state.tool === 'line' && state.selectedColor) lineIndices(state.gestureStartIndex, endIndex).forEach(index => setCellOverride(index, state.selectedColor));
    if (state.tool === 'rect' && state.selectedColor) rectangleIndices(state.gestureStartIndex, endIndex, true).forEach(index => setCellOverride(index, state.selectedColor));
    if (state.tool === 'select') {
      const a = cellPoint(state.gestureStartIndex), b = cellPoint(endIndex);
      state.selection = { left: Math.min(a.x,b.x), right: Math.max(a.x,b.x), top: Math.min(a.y,b.y), bottom: Math.max(a.y,b.y) };
    }
  }
  state.drawing = false; state.gestureStartIndex = -1; state.gestureEndIndex = -1; state.lastPaintIndex = -1; applyColorLayers(); render(); updatePaintUI();
}

function mardOptionsHtml() {
  const groups = new Map();
  for (const color of MARD_COLORS) {
    const group = color.code.match(/^[A-Z]+/)[0]; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(color);
  }
  return `<option value="${EMPTY_KEY}">⊘ 无豆 / 留空（取消放置）</option>` + [...groups.entries()].map(([group, colors]) => `<optgroup label="${group} 系列">${colors.map(color => `<option value="${color.code}">${color.code} · ${color.hex}</option>`).join('')}</optgroup>`).join('');
}

function replacementTargetFromValue() {
  return ui.replaceColorSelect.value === EMPTY_KEY ? EMPTY_COLOR : MARD_COLORS.find(color => color.code === ui.replaceColorSelect.value);
}

function updateReplacePreview() {
  const target = replacementTargetFromValue();
  if (!target || !state.replaceSource) return;
  ui.replaceToSwatch.classList.toggle('empty-pattern', Boolean(target.isEmpty));
  ui.replaceToSwatch.style.setProperty('--swatch', target.isEmpty ? '#fff' : target.hex);
  ui.replaceToCode.textContent = target.isEmpty ? '无豆 / 留空' : `MARD ${target.code}`;
  ui.replaceToHex.textContent = target.isEmpty ? '不放置豆子' : target.hex;
  ui.replaceConfirm.disabled = colorKey(target) === colorKey(state.replaceSource);
}

function openReplaceModal(hex) {
  const source = state.used.find(color => colorKey(color) === hex.toUpperCase()); if (!source) return;
  state.replaceSource = source;
  ui.replaceFromSwatch.style.setProperty('--swatch', source.hex); ui.replaceFromCode.textContent = source.name;
  ui.replaceFromCount.textContent = `${source.count} 格`;
  const closest = MARD_COLORS[nearestIndex(source.rgb, MARD_RGB)];
  ui.replaceColorSelect.value = MARD_COLORS.some(color => color.code === source.code) ? source.code : closest.code;
  updateReplacePreview(); ui.replaceModal.hidden = false; document.body.classList.add('modal-open'); ui.replaceColorSelect.focus();
}

function closeReplaceModal() {
  ui.replaceModal.hidden = true; document.body.classList.remove('modal-open'); state.replaceSource = null;
}

function confirmColorReplacement() {
  const source = state.replaceSource, target = replacementTargetFromValue();
  if (!source || !target || colorKey(source) === colorKey(target)) return;
  const changedCount = source.count, sourceCode = source.code;
  if (replaceColorGlobally(source, target)) {
    selectPaintColor(resolveColorReplacement(state.selectedColor || target));
    closeReplaceModal(); render(); updatePaintUI(); showToast(`${sourceCode} 的 ${changedCount} 格已${target.isEmpty ? '设为留空' : `替换为 ${target.code}`}`);
  }
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return showToast('请选择图片文件');
  const reader = new FileReader(); reader.onload = e => loadImage(e.target.result, file.name, `${(file.size / 1024 / 1024).toFixed(2)} MB`); reader.readAsDataURL(file);
}
function loadImage(src, name, meta = '示例图片', restoredDraft = null, restoreSource = 'local') {
  const loadToken = ++state.imageLoadToken;
  if (!restoredDraft) { state.skipDraftRestore = true; state.restoringDraft = false; state.zoom = 1; state.fitZoom = true; }
  const img = new Image(); img.onload = () => {
    if (loadToken !== state.imageLoadToken) return;
    closeReplaceModal();
    state.baseCells = []; state.cells = []; state.manualOverrides = new Map(); state.colorReplacements = new Map(); state.history = []; state.redoHistory = []; state.selection = null; state.selectionClipboard = null; state.tool = 'brush';
    state.selectedColor = null; state.lastPaintColor = null;
    state.layers=[]; state.activeLayerId=null; state.baseVisible=true; state.snapshotGrid=null;
    if (restoredDraft) applyDraftState(restoredDraft);
    else restoreLayers({});
    state.image = img; state.fileName = name; ui.sourceThumb.src = src; ui.fileName.textContent = name;
    state.originalSrc=restoredDraft?.originalImageSrc||src;state.sourceEdits=restoredDraft?.sourceEdits||null;state.sampleCache=null;
    state.originalImage=img;el('sourceTools').hidden=false;
    if(state.originalSrc!==src){
      state.originalImage=null;el('sourceTools').hidden=true;
      const original=new Image();original.onload=()=>{if(loadToken===state.imageLoadToken){state.originalImage=original;el('sourceTools').hidden=false;}};
      original.onerror=()=>{if(loadToken===state.imageLoadToken){state.originalImage=img;state.originalSrc=src;state.sourceEdits=null;el('sourceTools').hidden=false;showToast('原始图片恢复失败，当前图片仍可编辑');}};original.src=state.originalSrc;
    }
    ui.fileMeta.textContent = restoredDraft && restoredDraft.fileMeta ? restoredDraft.fileMeta : `${img.naturalWidth} × ${img.naturalHeight} · ${meta}`;
    ui.dropZone.hidden = true; ui.fileCard.hidden = false; ui.empty.hidden = true; ui.scroll.hidden = false; ui.palette.hidden = false;
    el('projectTitle').textContent = name.replace(/\.[^.]+$/, ''); updateDraftControls();
    processImage(success => {
      if (!restoredDraft) return;
      state.restoringDraft = false;
      if (success) {
        ui.draftStatus.textContent = formatDraftStatus(restoredDraft.savedAt);
        showToast(restoreSource === 'cloud' ? '已恢复账号中的云端草稿' : '已恢复上次未完成的草稿');
        if (restoreSource === 'cloud') saveDraft(false);
      }
      else ui.draftStatus.textContent = '草稿原图无法恢复';
    });
  };
  img.onerror = () => {
    if (loadToken !== state.imageLoadToken) return;
    if (restoredDraft) { state.restoringDraft = false; clearDraft(false, false); ui.draftStatus.textContent = '草稿原图损坏，已清理'; }
    showToast('图片读取失败');
  };
  img.src = src;
}
function createDemo() {
  const c = document.createElement('canvas'); c.width = 800; c.height = 400; const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 400); sky.addColorStop(0, '#9bc7d6'); sky.addColorStop(1, '#f7dd9a'); x.fillStyle = sky; x.fillRect(0, 0, 800, 400);
  x.fillStyle = '#315f4f'; x.beginPath(); x.moveTo(0, 330); x.lineTo(150, 170); x.lineTo(270, 330); x.lineTo(430, 130); x.lineTo(650, 330); x.lineTo(800, 210); x.lineTo(800, 400); x.lineTo(0, 400); x.fill();
  x.fillStyle = '#efb24a'; x.beginPath(); x.arc(635, 95, 52, 0, Math.PI * 2); x.fill(); x.fillStyle = '#f5f0e5';
  for (const [cx, cy, r] of [[170, 95, 38], [215, 90, 52], [260, 105, 34]]) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
  loadImage(c.toDataURL('image/png'), '山野日落.png', '内置示例');
}
function reset() {
  state.layers=[];state.activeLayerId=null;state.baseVisible=true;state.snapshotGrid=null;
  closeReplaceModal();
  state.imageLoadToken++; state.skipDraftRestore = true; state.restoringDraft = false;
  state.image = null; state.baseCells = []; state.cells = []; state.manualOverrides = new Map(); state.colorReplacements = new Map(); state.history = []; state.redoHistory = [];
  state.originalImage=null;state.originalSrc='';state.sourceEdits=null;state.sampleCache=null;state.processToken++;el('sourceTools').hidden=true;
  state.paintMode = false; state.showReference = false; state.selectedColor = null; state.lastPaintColor = null; state.tool = 'brush'; state.selection = null;
  state.zoom = 1; state.fitZoom = true; ui.fileInput.value = '';
  ui.dropZone.hidden = false; ui.fileCard.hidden = true; ui.empty.hidden = false; ui.scroll.hidden = true; ui.palette.hidden = true;
  el('projectTitle').textContent = '等待你的作品'; el('sizeStat').textContent = '—'; el('beadStat').textContent = '0'; el('colorStat').textContent = '0';
  updateDraftControls(); clearDraft(false, true);
}
function showToast(msg) { const t = el('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove('show'), 2200); }
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }

function bytesFromText(text) { return new TextEncoder().encode(text); }
function joinBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0), output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function jpegBytes(canvas) {
  const base64 = canvas.toDataURL('image/jpeg', .98).split(',')[1], binary = atob(base64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function pdfFromPages(pages) {
  const defaultPageWidth = 842, defaultPageHeight = 595, margin = 18;
  const objects = [bytesFromText('<< /Type /Catalog /Pages 2 0 R >>'), null];
  const pageIds = [];
  pages.forEach(page => {
    if(page.content){
      const pageId=objects.length+1,contentId=pageId+1;pageIds.push(pageId);
      objects.push(bytesFromText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.pageWidth} ${page.pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>`));
      objects.push(joinBytes([bytesFromText(`<< /Length ${page.content.length} >>\nstream\n`),page.content,bytesFromText('\nendstream')]));return;
    }
    const pageWidth = page.pageWidth || defaultPageWidth, pageHeight = page.pageHeight || defaultPageHeight;
    const pageId = objects.length + 1, contentId = pageId + 1, imageId = pageId + 2;
    pageIds.push(pageId);
    const scale = Math.min((pageWidth - margin * 2) / page.pixelWidth, (pageHeight - margin * 2) / page.pixelHeight);
    const drawWidth = page.pixelWidth * scale, drawHeight = page.pixelHeight * scale;
    const left = (pageWidth - drawWidth) / 2, bottom = (pageHeight - drawHeight) / 2;
    const content = bytesFromText(`q\n${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${left.toFixed(3)} ${bottom.toFixed(3)} cm\n/Im0 Do\nQ\n`);
    objects.push(bytesFromText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(joinBytes([bytesFromText(`<< /Length ${content.length} >>\nstream\n`), content, bytesFromText('endstream')]));
    objects.push(joinBytes([bytesFromText(`<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.length} >>\nstream\n`), page.image, bytesFromText('\nendstream')]));
  });
  objects[1] = bytesFromText(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const chunks = [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 255, 255, 255, 255, 10])], offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const wrapped = joinBytes([bytesFromText(`${index + 1} 0 obj\n`), object, bytesFromText('\nendobj\n')]);
    chunks.push(wrapped); length += wrapped.length;
  });
  const xrefOffset = length;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(bytesFromText(xref));
  return new Blob(chunks, { type: 'application/pdf' });
}

function renderPdfTile(startCol, startRow, tileCols, tileRows, pageNumber, pageCount) {
  const cell = 28, band = 48, padding = 22, titleHeight = 66;
  const gridWidth = tileCols * cell, gridHeight = tileRows * cell;
  const canvas = document.createElement('canvas');
  canvas.width = padding * 2 + band * 2 + gridWidth;
  canvas.height = padding * 2 + titleHeight + band * 2 + gridHeight;
  const ctx = canvas.getContext('2d'), gridX = padding + band, gridY = padding + titleHeight + band;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#242321'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 24px "Microsoft YaHei", Arial, sans-serif';
  ctx.fillText(state.fileName.replace(/\.[^.]+$/, ''), padding, 34);
  ctx.fillStyle = '#706a63'; ctx.font = '15px Arial, sans-serif';
  ctx.fillText(`列 ${startCol + 1}–${startCol + tileCols} · 行 ${startRow + 1}–${startRow + tileRows}`, padding, 57);
  ctx.textAlign = 'right'; ctx.fillText(`${state.cols} × ${state.rows} · 第 ${pageNumber}/${pageCount} 页`, canvas.width - padding, 34);
  ctx.fillText(`${state.used.length} 色 · ${state.used.reduce((sum, color) => sum + color.count, 0).toLocaleString('zh-CN')} 颗`, canvas.width - padding, 57);

  const symbolMap = new Map(state.used.map(color => [color.hex.toUpperCase(), color.code]));
  for (let y = 0; y < tileRows; y++) for (let x = 0; x < tileCols; x++) {
    const color = state.cells[(startRow + y) * state.cols + startCol + x];
    if (!color) continue;
    const px = gridX + x * cell, py = gridY + y * cell, code = symbolMap.get(color.hex.toUpperCase()) || color.code;
    ctx.fillStyle = color.hex; ctx.fillRect(px + .5, py + .5, cell - 1, cell - 1);
    if (state.exportSettings.showSymbols) {
      const fontSize = Math.max(10, Math.min(14, (cell - 5) / Math.max(1, code.length * .56)));
      ctx.fillStyle = luminance(color.rgb) > 155 ? '#211f1c' : '#fff';
      ctx.font = `700 ${fontSize}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(code, px + cell / 2, py + cell / 2 + .5);
    }
  }

  ctx.beginPath();
  for (let x = 0; x <= tileCols; x++) { const px = gridX + x * cell; ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight); }
  for (let y = 0; y <= tileRows; y++) { const py = gridY + y * cell; ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py); }
  ctx.strokeStyle = state.exportSettings.minorColor; ctx.globalAlpha = .58; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke(); ctx.globalAlpha = 1;

  const interval = state.exportSettings.interval;
  if(interval>0) {
  ctx.beginPath();
  for (let x = 0; x <= tileCols; x++) if (x === 0 || x === tileCols || (startCol + x) % interval === 0) {
    const px = gridX + x * cell; ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight);
  }
  for (let y = 0; y <= tileRows; y++) if (y === 0 || y === tileRows || (startRow + y) % interval === 0) {
    const py = gridY + y * cell; ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py);
  }
  ctx.strokeStyle = state.exportSettings.majorColor; ctx.lineWidth = 2.4;
  ctx.setLineDash(ui.majorGridStyle.value === 'dashed' ? [8, 5] : []); ctx.stroke(); ctx.setLineDash([]);
  }

  ctx.fillStyle = '#514d48'; ctx.font = '600 12px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let x = 0; x < tileCols; x++) {
    const label = String(startCol + x + 1), px = gridX + (x + .5) * cell;
    ctx.fillText(label, px, gridY - band / 2); ctx.fillText(label, px, gridY + gridHeight + band / 2);
  }
  for (let y = 0; y < tileRows; y++) {
    const label = String(startRow + y + 1), py = gridY + (y + .5) * cell;
    ctx.fillText(label, gridX - band / 2, py); ctx.fillText(label, gridX + gridWidth + band / 2, py);
  }
  return canvas;
}

function renderPdfLegend() {
  const canvas = document.createElement('canvas'); canvas.width = 1500; canvas.height = Math.max(1050,170+Math.ceil(state.used.length/4)*52);
  const ctx = canvas.getContext('2d'), padding = 58, columns = 4, gap = 18;
  const itemWidth = (canvas.width - padding * 2 - gap * (columns - 1)) / columns, itemHeight = 52;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#242321'; ctx.font = '700 38px "Microsoft YaHei", Arial, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('豆格 · MARD 配色清单', padding, 68);
  ctx.fillStyle = '#706a63'; ctx.font = '20px Arial, sans-serif';
  ctx.fillText(`${state.fileName.replace(/\.[^.]+$/, '')} · ${state.cols} × ${state.rows} · ${state.used.length} 色 · 共 ${state.used.reduce((sum, color) => sum + color.count, 0).toLocaleString('zh-CN')} 颗`, padding, 103);
  state.used.forEach((color, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const x = padding + column * (itemWidth + gap), y = 134 + row * itemHeight;
    ctx.fillStyle = '#faf9f7'; ctx.strokeStyle = '#d9d5ce'; ctx.lineWidth = 1; ctx.fillRect(x, y, itemWidth, 42); ctx.strokeRect(x, y, itemWidth, 42);
    ctx.fillStyle = color.hex; ctx.fillRect(x + 7, y + 7, 28, 28); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.strokeRect(x + 7, y + 7, 28, 28);
    ctx.fillStyle = '#272522'; ctx.font = '700 16px Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`MARD ${color.code}`, x + 46, y + 14);
    ctx.fillStyle = '#817b74'; ctx.font = '12px Arial, sans-serif'; ctx.fillText(color.hex, x + 46, y + 30);
    ctx.fillStyle = '#272522'; ctx.font = '700 17px Arial, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${color.count.toLocaleString('zh-CN')} 颗`, x + itemWidth - 10, y + 21);
  });
  return canvas;
}

function wholePdfPage(){
  const cell=10,left=36,bottom=36,width=state.cols*cell,height=state.rows*cell;
  const commands=['1 1 1 rg',`0 0 ${width+72} ${height+100} re f`];
  const rgb=hex=>[1,3,5].map(i=>(parseInt(hex.slice(i,i+2),16)/255).toFixed(3)).join(' ');
  for(let y=0;y<state.rows;y++){
    for(let x=0;x<state.cols;){const color=state.cells[y*state.cols+x];if(!color){x++;continue;}let end=x+1;while(end<state.cols&&state.cells[y*state.cols+end]?.hex===color.hex)end++;
      commands.push(`${rgb(color.hex)} rg ${left+x*cell} ${bottom+(state.rows-y-1)*cell} ${(end-x)*cell} ${cell} re f`);x=end;}
  }
  const grid=(interval,color,lineWidth)=>{commands.push(`${rgb(color)} RG ${lineWidth} w`);for(let x=0;x<=state.cols;x++)if(x===state.cols||x%interval===0)commands.push(`${left+x*cell} ${bottom} m ${left+x*cell} ${bottom+height} l`);for(let y=0;y<=state.rows;y++)if(y===state.rows||y%interval===0)commands.push(`${left} ${bottom+height-y*cell} m ${left+width} ${bottom+height-y*cell} l`);commands.push('S');};
  if(ui.showGrid.checked)grid(1,state.exportSettings.minorColor,.25);
  if(state.exportSettings.interval>0){if(ui.majorGridStyle.value==='dashed')commands.push('[3 2] 0 d');grid(state.exportSettings.interval,state.exportSettings.majorColor,.65);commands.push('[] 0 d');}
  const text=(value,x,y,size=4)=>commands.push(`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${value}) Tj ET`);
  if(state.exportSettings.showSymbols)for(let y=0;y<state.rows;y++)for(let x=0;x<state.cols;x++){const color=state.cells[y*state.cols+x];if(!color)continue;const code=String(color.code).replace(/[^A-Z0-9]/g,'');const size=Math.min(4,8/Math.max(1,code.length*.6));commands.push(luminance(color.rgb)>155?'0.12 0.12 0.12 rg':'1 1 1 rg');text(code,left+x*cell+(cell-code.length*size*.56)/2,bottom+(state.rows-y-1)*cell+3.5,size);}
  commands.push('0.25 0.25 0.25 rg');
  for(let x=0;x<state.cols;x++){text(x+1,left+x*cell+2,bottom-10);text(x+1,left+x*cell+2,bottom+height+7);}
  for(let y=0;y<state.rows;y++){text(y+1,left-22,bottom+(state.rows-y-1)*cell+3);text(y+1,left+width+6,bottom+(state.rows-y-1)*cell+3);}
  text(`MARD - ${state.cols} x ${state.rows}`,left,bottom+height+35,12);
  return {content:bytesFromText(commands.join('\n')),pageWidth:width+72,pageHeight:height+100};
}
async function generatePaidPdf({yieldPages=true}={}) {
  recalculateUsed();
  const whole=document.getElementById('pdfLayout').value!=='tiled';
  const tileSize = 160, across = Math.ceil(state.cols / tileSize), down = Math.ceil(state.rows / tileSize);
  const tilePageCount = across * down, pages = [];
  showToast(whole?'正在生成整体矢量 PDF…':`正在生成 ${tilePageCount + 1} 页高清 PDF…`);
  if(whole)pages.push(wholePdfPage());
  let pageNumber = 0;
  for (let startRow = 0; !whole && startRow < state.rows; startRow += tileSize) {
    for (let startCol = 0; startCol < state.cols; startCol += tileSize) {
      pageNumber++;
      const canvas = renderPdfTile(startCol, startRow, Math.min(tileSize, state.cols - startCol), Math.min(tileSize, state.rows - startRow), pageNumber, tilePageCount);
      pages.push({
        image: jpegBytes(canvas), pixelWidth: canvas.width, pixelHeight: canvas.height,
        pageWidth: canvas.width * .58 + 36, pageHeight: canvas.height * .58 + 36
      });
      canvas.width = 1; canvas.height = 1;
      if (yieldPages && pageNumber % 2 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  const legend = renderPdfLegend();
  pages.push({ image: jpegBytes(legend), pixelWidth: legend.width, pixelHeight: legend.height });
  legend.width = 1; legend.height = 1;
  const blob = pdfFromPages(pages), url = URL.createObjectURL(blob);
  download(url, `${state.fileName.replace(/\.[^.]+$/, '')}-拼豆图纸-${whole?'整体版':'分页版'}.pdf`);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  showToast(`高清 PDF 已生成：${whole?'1 张整体图纸':tilePageCount+' 张图纸页'} + 1 张配色页`);
}

function renderPaletteGroups() {
  const groups = new Map();
  for (const color of MARD_COLORS) { const group=color.code.match(/^[A-Z]+/)[0]; groups.set(group, (groups.get(group) || 0) + 1); }
  ui.paletteGroups.innerHTML = `<button type="button" data-palette-group="ALL" class="${state.paletteGroup === 'ALL' ? 'active' : ''}"><span>全部</span><small>${MARD_COLORS.length}</small></button>` +
    [...groups.entries()].map(([group,count]) => `<button type="button" data-palette-group="${group}" class="${state.paletteGroup === group ? 'active' : ''}"><span>${group} 系列</span><small>${count}</small></button>`).join('');
}
function renderAllColors(filter = '') {
  const query = String(filter).trim().toUpperCase();
  const colors = MARD_COLORS.filter(color => (state.paletteGroup === 'ALL' || color.code.match(/^[A-Z]+/)[0] === state.paletteGroup) && (!query || color.code.toUpperCase().includes(query.replace(/^([A-Z]+)0+(\d)/,'$1$2')) || color.hex.toUpperCase().includes(query)));
  renderPaletteGroups();
  const chosen=state.paletteDraft?.codes || state.paletteCodes || new Set(MARD_COLORS.map(c=>c.code));
  ui.paletteBrowserCount.textContent = `已选 ${chosen.size} / ${MARD_COLORS.length} 色`;
  ui.allColorsGrid.innerHTML = colors.map(color => state.paletteMode==='inventory'
    ? `<label class="all-color-card inventory-card"><i style="--color:${color.hex}"></i><span><b>${color.code}</b><input data-stock-code="${color.code}" aria-label="${color.code} 库存数量" type="number" min="0" max="9999999" value="${state.paletteDraft?.inventory[color.code] || 0}"></span></label>`
    : `<button class="all-color-card ${chosen.has(color.code)?'is-selected':''}" type="button" data-palette-code="${color.code}" aria-pressed="${chosen.has(color.code)}" title="启用或排除 MARD ${color.code}"><i style="--color:${color.hex}"></i><span><b>${color.code}</b><small>${color.hex}</small></span><em>${chosen.has(color.code)?'✓':''}</em></button>`).join('') || '<p class="algorithm-note">没有找到匹配的色号。</p>';
}
function openPaletteBrowser() {
  state.paletteDraft={codes:new Set(state.paletteCodes || MARD_COLORS.map(c=>c.code)),inventory:{...state.inventory}};
  el('paletteEditorStatus').textContent='';
  renderAllColors(ui.paletteSearch.value); ui.paletteBrowserModal.hidden = false; document.body.classList.add('modal-open'); setTimeout(() => ui.paletteSearch.focus(), 0);
}
function closePaletteBrowser() { state.paletteDraft=null; ui.paletteBrowserModal.hidden = true; document.body.classList.remove('modal-open'); }

function renderFinishedPreview() {
  recalculateUsed();
  const maximum = 1450, cell = Math.max(3, Math.min(14, Math.floor(maximum / Math.max(state.cols, state.rows))));
  const padding = Math.max(18, cell * 3), canvas = ui.finishedPreviewCanvas;
  canvas.width = state.cols * cell + padding * 2; canvas.height = state.rows * cell + padding * 2;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0,0,canvas.width,canvas.height); gradient.addColorStop(0,'#fbfaf6'); gradient.addColorStop(1,'#e8e3d8');
  ctx.fillStyle = gradient; ctx.fillRect(0,0,canvas.width,canvas.height);
  const gap = Math.max(.45, cell * .09), radius = Math.max(1, cell * .22);
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    const color = state.cells[y * state.cols + x]; if (!color) continue;
    const px = padding + x * cell + gap, py = padding + y * cell + gap, size = cell - gap * 2;
    ctx.beginPath(); ctx.roundRect(px,py,size,size,radius); ctx.fillStyle = color.hex; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.13)'; ctx.lineWidth = Math.max(.35,cell*.035); ctx.stroke();
    if (cell >= 7) { ctx.fillStyle = 'rgba(255,255,255,.23)'; ctx.beginPath(); ctx.arc(px + size*.34,py + size*.3,Math.max(.6,size*.1),0,Math.PI*2); ctx.fill(); }
  }
}
function openFinishedPreview() {
  if (!state.image) return showToast('请先选择一张图片');
  renderFinishedPreview(); ui.finishedPreviewModal.hidden = false; document.body.classList.add('modal-open');
}
function closeFinishedPreview() { ui.finishedPreviewModal.hidden = true; document.body.classList.remove('modal-open'); }

function saveUnifiedGridSettings(renderNow = true) {
  state.exportSettings = {
    interval: gridInterval(ui.majorGridSize.value), majorColor: ui.exportMajorGridColor.value.toUpperCase(),
    minorColor: ui.exportMinorGridColor.value.toUpperCase(), showSymbols: ui.showSymbols.checked
  };
  ui.gridIntervalValue.textContent = gridIntervalLabel(state.exportSettings.interval);
  localStorage.setItem('pindou-export-settings', JSON.stringify(state.exportSettings));
  if (renderNow && state.image) render();
}
function restoreExportSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('pindou-export-settings') || 'null');
    if (stored && Number(stored.interval) >= 0 && Number(stored.interval) <= 20 && /^#[0-9A-F]{6}$/i.test(stored.majorColor) && /^#[0-9A-F]{6}$/i.test(stored.minorColor)) {
      state.exportSettings = { interval: gridInterval(stored.interval), majorColor: stored.majorColor.toUpperCase(), minorColor: stored.minorColor.toUpperCase(), showSymbols: stored.showSymbols !== false };
    }
  } catch {}
  ui.majorGridSize.value = String(state.exportSettings.interval); ui.gridIntervalValue.textContent = gridIntervalLabel(state.exportSettings.interval);
  ui.exportMajorGridColor.value = state.exportSettings.majorColor; ui.exportMinorGridColor.value = state.exportSettings.minorColor; ui.showSymbols.checked = state.exportSettings.showSymbols;
}

function applySelectionColor(color) {
  if (!state.selection || !color) return false;
  pushHistory(); const { left,right,top,bottom } = state.selection;
  for (let y=top;y<=bottom;y++) for (let x=left;x<=right;x++) setCellOverride(y*state.cols+x,color);
  applyColorLayers(); render(); updatePaintUI(); return true;
}

function copySelection(cut = false) {
  if (!state.selection) return false;
  const { left,right,top,bottom } = state.selection, width = right-left+1, height = bottom-top+1, cells = [];
  for (let y=top;y<=bottom;y++) for (let x=left;x<=right;x++) cells.push(state.cells[y*state.cols+x] || EMPTY_COLOR);
  state.selectionClipboard = { width, height, cells };
  if (cut) {
    pushHistory();
    for (let y=top;y<=bottom;y++) for (let x=left;x<=right;x++) setCellOverride(y*state.cols+x,EMPTY_COLOR);
    applyColorLayers(); render(); showToast('已剪切选区，可在新的选区中粘贴');
  } else showToast('已复制选区，可选择新的位置后粘贴');
  updatePaintUI(); return true;
}

function pasteSelection() {
  if (!state.selection || !state.selectionClipboard) return false;
  pushHistory(); const startX = state.selection.left, startY = state.selection.top, clipboard = state.selectionClipboard;
  for (let y=0;y<clipboard.height;y++) for (let x=0;x<clipboard.width;x++) {
    const targetX = startX+x, targetY = startY+y;
    if (targetX >= state.cols || targetY >= state.rows) continue;
    setCellOverride(targetY*state.cols+targetX,clipboard.cells[y*clipboard.width+x]);
  }
  state.selection = { left:startX, top:startY, right:Math.min(state.cols-1,startX+clipboard.width-1), bottom:Math.min(state.rows-1,startY+clipboard.height-1) };
  applyColorLayers(); render(); updatePaintUI(); showToast('选区内容已粘贴'); return true;
}

function cancelSelection() {
  if (!state.selection) return;
  state.selection = null; render(ui.canvas,false,{recalculate:false,updateUi:false,save:false}); updatePaintUI();
}

function bindActiveLayer() {
  const layer=state.layers.find(layer=>layer.id===state.activeLayerId) || state.layers.at(-1);
  if(layer) { state.activeLayerId=layer.id; state.manualOverrides=layer.cells; syncLayerScaleControls(layer.scalePercent||100); }
}
function restoreLayers(draft) {
  const validCells=entries=>new Map((Array.isArray(entries)?entries:[]).map(([i,c])=>[Number(i),deserializeColor(c)]).filter(([i,c])=>Number.isInteger(i)&&i>=0&&i<state.cols*state.rows&&c));
  state.layers=Array.isArray(draft.layers)&&draft.layers.length?draft.layers.slice(0,20).map((layer,i)=>({id:`layer-${i}`,name:String(layer.name||`图层 ${i+1}`).slice(0,32),visible:layer.visible!==false,locked:!!layer.locked,cells:validCells(layer.cells)})):[{id:'layer-0',name:'手绘图层',visible:true,locked:false,cells:new Map(state.manualOverrides)}];
  const originalIndex=(draft.layers||[]).findIndex(layer=>layer.id===draft.activeLayerId);
  if(Array.isArray(draft.layers))state.layers.forEach((layer,i)=>{const saved=draft.layers[i];if(Array.isArray(saved?.scaleSource)&&saved.scaleSource.length<=state.cols*state.rows){layer.scaleSource=validCells(saved.scaleSource);layer.scalePercent=Number.isFinite(saved.scalePercent)?clamp(saved.scalePercent,1,5000):100;layer.scaleOffset={x:clamp(Number(saved.scaleOffset?.x)||0,-state.cols,state.cols),y:clamp(Number(saved.scaleOffset?.y)||0,-state.rows,state.rows)};layer.cells=scaleLayerPercent(layer.scaleSource,layer.scalePercent,state.cols,state.rows,layer.scaleOffset);}});
  state.activeLayerId=state.layers[Math.max(0,originalIndex)]?.id; state.baseVisible=draft.baseVisible!==false; bindActiveLayer();
}
function renderLayers() {
  const list=el('layerList'); if(!list) return;
  list.replaceChildren();
  [...state.layers].reverse().forEach(layer=>{
    const row=document.createElement('div'); row.className='layer-row'+(layer.id===state.activeLayerId?' active':'');
    const select=document.createElement('button'); select.type='button'; select.className='layer-name'; select.textContent=layer.name; select.title='双击重命名'; select.onclick=()=>{state.activeLayerId=layer.id;bindActiveLayer();for(const item of list.children)item.classList.toggle('active',item===row);updatePaintUI();scheduleDraftSave();};
    const rename=()=>{
      if(row.querySelector('input'))return;
      const input=document.createElement('input');input.className='layer-name-input';input.value=layer.name;input.maxLength=32;input.setAttribute('aria-label','图层名称');select.replaceWith(input);input.focus();input.select();
      let finished=false;
      const finish=save=>{if(finished)return;finished=true;const name=input.value.trim();if(save&&name&&name!==layer.name){pushHistory();layer.name=name;scheduleDraftSave();}renderLayers();updatePaintUI();};
      input.onblur=()=>finish(true);input.onkeydown=event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();finish(true);}else if(event.key==='Escape'){event.preventDefault();finish(false);}};
    };
    select.dataset.layerId=layer.id;select.startRename=rename;select.ondblclick=rename;select.onkeydown=event=>{if(event.key==='F2'){event.preventDefault();rename();}};
    row.append(select);
    for(const [field,on,off] of [['visible','显示','隐藏'],['locked','锁定','解锁']]) {
      const button=document.createElement('button'); button.type='button';button.className='layer-state';button.textContent=layer[field]?on:off;button.setAttribute('aria-pressed',String(layer[field]));button.title=field==='visible'?'切换图层显示':'切换图层锁定';
      button.onclick=()=>{pushHistory();layer[field]=!layer[field];applyColorLayers();render();renderLayers();};row.append(button);
    } list.append(row);
  });
  const base=el('baseLayerVisible');if(base)base.checked=state.baseVisible;
}
function layerAction(action,confirmedId=null) {
  if(!state.image) return showToast('请先选择图片');
  if(state.drawing)return;
  if(!state.layers.length)restoreLayers({});
  const index=state.layers.findIndex(layer=>layer.id===(confirmedId||state.activeLayerId)),current=state.layers[index];if(!current)return;
  if(['add','duplicate'].includes(action)&&state.layers.length>=20)return showToast('最多 20 个图层');
  if(action==='remove'&&state.layers.length===1)return showToast('至少保留一个手绘图层');
  if(action==='clear'&&current.locked)return showToast('当前图层已锁定');
  if(['clear','remove'].includes(action)&&!confirmedId){openLayerConfirmation(action,current);return;}
  if(action==='rename') {
    const nameButton=[...el('layerList').querySelectorAll('.layer-name')].find(button=>button.dataset.layerId===current.id);nameButton?.scrollIntoView({block:'nearest'});nameButton?.startRename();return;
  } else {
    pushHistory();
    if(action==='add'||action==='duplicate') {
      const layer={id:`layer-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,name:action==='add'?`图层 ${state.layers.length+1}`:`${current.name} 副本`,visible:true,locked:false,cells:action==='add'?new Map():new Map(current.cells),scaleSource:action==='duplicate'&&current.scaleSource?new Map(current.scaleSource):null,scalePercent:action==='duplicate'?current.scalePercent:100,scaleOffset:action==='duplicate'?current.scaleOffset:null};
      state.layers.splice(index+1,0,layer);state.activeLayerId=layer.id;
    } else if(action==='remove')state.layers.splice(index,1);
    else if(action==='clear') { if(current.locked)return showToast('当前图层已锁定');current.cells.clear();current.scaleSource=null;current.scalePercent=100; }
    else if(action==='up'&&index<state.layers.length-1)[state.layers[index],state.layers[index+1]]=[state.layers[index+1],state.layers[index]];
    else if(action==='down'&&index>0)[state.layers[index],state.layers[index-1]]=[state.layers[index-1],state.layers[index]];
  }
  bindActiveLayer();applyColorLayers();render();renderLayers();updatePaintUI();
}
function restorePaletteConfig() {
  try {
    const config=JSON.parse(localStorage.getItem('douge-mard-library-v1')||'null');
    if(config){const valid=validatePaletteConfig(config);state.paletteCodes=new Set(valid.codes);state.inventory=valid.inventory;}
  }catch{}
}
function validatePaletteConfig(config) {
  if(!config||config.brand!=='MARD'||!Array.isArray(config.codes))throw new Error('请选择有效的 MARD 色板文件');
  const known=new Set(MARD_COLORS.map(c=>c.code));
  const codes=[...new Set(config.codes.map(code=>String(code).toUpperCase().replace(/^([A-Z]+)0+(\d)/,'$1$2')))];
  if(codes.some(code=>!known.has(code)))throw new Error('文件包含未知 MARD 色号');
  const inventory={};
  for(const [code,value] of Object.entries(config.inventory||{})){
    const normalized=code.toUpperCase().replace(/^([A-Z]+)0+(\d)/,'$1$2');
    if(!known.has(normalized)||!Number.isInteger(value)||value<0||value>9999999)throw new Error('豆库数量必须为 0–9999999 的整数');
    inventory[normalized]=value;
  } return {codes,inventory};
}
function paletteConfigCsv(config) {
  return '\uFEFF品牌,色号,HEX,启用,库存数量\r\n'+MARD_COLORS.map(c=>['MARD',c.code,c.hex,config.codes.has(c.code)?1:0,config.inventory[c.code]||0].join(',')).join('\r\n');
}
function parsePaletteFile(text) {
  const clean=text.replace(/^\uFEFF/,'').trim();
  if(clean.startsWith('{'))return validatePaletteConfig(JSON.parse(clean));
  const lines=clean.split(/\r?\n/);
  if(lines.shift()!=='品牌,色号,HEX,启用,库存数量')throw new Error('请选择豆格导出的 MARD CSV 色板文件');
  const codes=[],inventory={},seen=new Set();
  for(const line of lines){
    if(!line.trim())continue;
    const fields=line.split(','),[brand,code,hex,enabled,stock]=fields;
    if(fields.length!==5||brand!=='MARD'||!/^#[0-9a-f]{6}$/i.test(hex)||!['0','1'].includes(enabled)||!/^\d+$/.test(stock)||seen.has(code))throw new Error('CSV 内容无效或存在重复色号');
    seen.add(code);if(enabled==='1')codes.push(code);inventory[code]=Number(stock);
  }
  return validatePaletteConfig({brand:'MARD',codes,inventory});
}
function sourceRectangle(image, values = {}) {
  const x=clamp(Math.floor(Number(values.x)||0),0,image.naturalWidth-1),y=clamp(Math.floor(Number(values.y)||0),0,image.naturalHeight-1);
  return {x,y,width:clamp(Math.floor(Number(values.width)||image.naturalWidth),1,image.naturalWidth-x),height:clamp(Math.floor(Number(values.height)||image.naturalHeight),1,image.naturalHeight-y)};
}
function applySourceEdits(edits) {
  if(!state.originalImage)return;
  const original=state.originalImage,rect=sourceRectangle(original,edits),canvas=document.createElement('canvas');
  canvas.width=rect.width;canvas.height=rect.height;
  const ctx=canvas.getContext('2d');ctx.translate(edits.flipX?rect.width:0,edits.flipY?rect.height:0);ctx.scale(edits.flipX?-1:1,edits.flipY?-1:1);
  ctx.drawImage(original,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
  const img=new Image(),token=++state.imageLoadToken;
  img.onload=()=>{if(token!==state.imageLoadToken)return;state.image=img;state.sourceEdits={...rect,flipX:!!edits.flipX,flipY:!!edits.flipY};state.sampleCache=null;state.snapshotGrid=null;ui.sourceThumb.src=img.src;ui.fileMeta.textContent=`${img.naturalWidth} × ${img.naturalHeight} · 已调整原图`;processImage();};
  img.onerror=()=>showToast('无法处理原图，请重试');img.src=canvas.toDataURL('image/png');
}
function cropFields() {
  return sourceRectangle(state.originalImage,{x:el('cropX').value,y:el('cropY').value,width:el('cropWidth').value,height:el('cropHeight').value});
}
function setCropFields(rect) {
  for(const [key,id] of [['x','cropX'],['y','cropY'],['width','cropWidth'],['height','cropHeight']])el(id).value=rect[key];
  drawCropPreview();
}
function drawCropPreview() {
  const img=state.originalImage;if(!img)return;
  const canvas=el('cropCanvas'),scale=Math.min(1,900/img.naturalWidth,440/img.naturalHeight);
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d'),rect=cropFields();ctx.drawImage(img,0,0,canvas.width,canvas.height);
  ctx.fillStyle='rgba(15,30,24,.5)';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.beginPath();ctx.rect(rect.x*scale,rect.y*scale,rect.width*scale,rect.height*scale);ctx.clip();ctx.drawImage(img,0,0,canvas.width,canvas.height);ctx.restore();
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(rect.x*scale,rect.y*scale,rect.width*scale,rect.height*scale);
}
function stickerLayerCells(image,width,height,startX,startY,cols,rows) {
  const samples=averageOriginalRegions(image,width,height,true),available=MARD_COLORS.filter(c=>!state.paletteCodes||state.paletteCodes.has(c.code)),rgb=available.map(c=>c.rgb),cache=new Map(),cells=new Map();
  if(!available.length)throw new Error('请先在色板中选择至少一种颜色');
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=samples[y*width+x];if(!p||x+startX>=cols||y+startY>=rows)continue;
    const key=p.map(v=>Math.round(v)).join(',');if(!cache.has(key))cache.set(key,available[nearestIndex(p,rgb)]);
    cells.set((y+startY)*cols+x+startX,cache.get(key));
  }return cells;
}
function fitStickerBox(x,y,width,height,cols,rows,ratio=null) {
  let w=clamp(Math.round(width)||1,1,cols),h=clamp(Math.round(height)||1,1,rows);
  if(ratio>0){h=Math.max(1,Math.round(w/ratio));if(h>rows){h=rows;w=Math.max(1,Math.round(h*ratio));}w=Math.min(cols,w);}
  return {x:clamp(Math.round(x)||0,0,cols-w),y:clamp(Math.round(y)||0,0,rows-h),width:w,height:h};
}
function presetShapeContains(shape,x,y) {
  if(x<0||y<0||x>1||y>1)return false;
  const a=(x-.5)*2,b=(.5-y)*2;
  if(shape==='circle')return a*a+b*b<=.9*.9;
  if(shape==='diamond')return Math.abs(a)+Math.abs(b)<=.95;
  if(shape==='heart'){const X=a*1.2,Y=b*1.2+.12;return (X*X+Y*Y-1)**3-X*X*Y**3<=0;}
  if(shape==='star'){
    const vertices=Array.from({length:10},(_,i)=>{const angle=-Math.PI/2+i*Math.PI/5,r=i%2?.21:.48;return [.5+Math.cos(angle)*r,.5+Math.sin(angle)*r];});
    let inside=false;for(let i=0,j=9;i<10;j=i++){const [xi,yi]=vertices[i],[xj,yj]=vertices[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;
  }return false;
}
function presetShapePixel(shape,style,x,y,size) {
  const u=(x+.5)/size,v=(y+.5)/size;if(!presetShapeContains(shape,u,v))return false;
  if(style==='stripe')return Math.floor((x+y)/Math.max(2,Math.round(size/10)))%2===0;
  if(style==='outline'){const d=Math.max(1/size,.085);return [[-d,0],[d,0],[0,-d],[0,d]].some(([dx,dy])=>!presetShapeContains(shape,u+dx,v+dy));}return true;
}
function shiftedLayerCells(cells,dx,dy,cols,rows) {
  const b=layerBounds(cells,cols,rows);dx=clamp(dx,-b.left,cols-1-b.right);dy=clamp(dy,-b.top,rows-1-b.bottom);
  const result=new Map();for(const [i,color] of cells)result.set((Math.floor(i/cols)+dy)*cols+i%cols+dx,color);return result;
}
function layerBounds(cells,cols,rows){let left=cols,right=-1,top=rows,bottom=-1;for(const i of cells.keys()){left=Math.min(left,i%cols);right=Math.max(right,i%cols);top=Math.min(top,Math.floor(i/cols));bottom=Math.max(bottom,Math.floor(i/cols));}return {left,right,top,bottom};}
function scaleLayerPercent(cells,percent,cols,rows,offset={x:0,y:0}){
  const result=new Map();if(!cells.size)return result;
  const b=layerBounds(cells,cols,rows),width=b.right-b.left+1,height=b.bottom-b.top+1,factor=clamp(percent,1,5000)/100;
  const w=Math.max(1,width*factor),h=Math.max(1,height*factor),left=b.left+(width-w)/2+(offset?.x||0),top=b.top+(height-h)/2+(offset?.y||0);
  for(let y=Math.max(0,Math.ceil(top-.5));y<Math.min(rows,top+h-.5);y++)for(let x=Math.max(0,Math.ceil(left-.5));x<Math.min(cols,left+w-.5);x++){const sx=b.left+Math.min(width-1,Math.floor((x-left+.5)*width/w)),sy=b.top+Math.min(height-1,Math.floor((y-top+.5)*height/h)),color=cells.get(sy*cols+sx);if(color)result.set(y*cols+x,color);}return result;
}
function syncLayerScaleControls(percent){const range=el('layerScaleRange'),number=el('layerScalePercent');if(!range||!number)return;range.max='5000';range.value=clamp(percent,1,5000);number.value=clamp(percent,1,5000);}
function translatedLayerTransform(layer,dx,dy,cols,rows){
  const b=layerBounds(layer.cells,cols,rows);dx=clamp(dx,-b.left,cols-1-b.right);dy=clamp(dy,-b.top,rows-1-b.bottom);if(!dx&&!dy)return null;
  const scaleSource=layer.scaleSource||new Map(layer.cells),scalePercent=layer.scalePercent||100,scaleOffset={x:(layer.scaleOffset?.x||0)+dx,y:(layer.scaleOffset?.y||0)+dy};
  return {scaleSource,scalePercent,scaleOffset,cells:scaleLayerPercent(scaleSource,scalePercent,cols,rows,scaleOffset)};
}
let pendingLayerConfirmation=null;
function openLayerConfirmation(action,layer){pendingLayerConfirmation={action,id:layer.id,focus:document.activeElement};el('layerConfirmTitle').textContent=action==='remove'?'删除图层？':'清空图层？';el('layerConfirmMessage').textContent=action==='remove'?`确定删除“${layer.name}”吗？`:`确定清空“${layer.name}”中的全部内容吗？`;el('layerConfirmModal').hidden=false;document.body.classList.add('modal-open');el('layerConfirmCancel').focus();}
function closeLayerConfirmation(){const pending=pendingLayerConfirmation;pendingLayerConfirmation=null;el('layerConfirmModal').hidden=true;document.body.classList.remove('modal-open');if(pending?.focus?.isConnected)pending.focus.focus();return pending;}
function scaledLayerCells(cells,factor,cols,rows) {
  if(!cells.size)return new Map();
  let left=cols,right=0,top=rows,bottom=0;for(const i of cells.keys()){left=Math.min(left,i%cols);right=Math.max(right,i%cols);top=Math.min(top,Math.floor(i/cols));bottom=Math.max(bottom,Math.floor(i/cols));}
  const width=right-left+1,height=bottom-top+1;
  const resize=n=>factor>1?Math.max(n+1,Math.round(n*factor)):Math.max(1,Math.min(n-1,Math.round(n*factor)));
  const w=resize(width),h=resize(height);if(w>cols||h>rows)return null;
  const x=clamp(Math.round(left+(width-w)/2),0,cols-w),y=clamp(Math.round(top+(height-h)/2),0,rows-h),result=new Map();
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const source=(top+Math.min(height-1,Math.floor((j+.5)*height/h)))*cols+left+Math.min(width-1,Math.floor((i+.5)*width/w));if(cells.has(source))result.set((y+j)*cols+x+i,cells.get(source));}
  return result;
}
function initSectionDisclosure() {
  const sections=[...el('controlsPanel').children].filter(section=>section.tagName==='SECTION');
  let saved={};try{saved=JSON.parse(localStorage.getItem('douge-panel-folds')||'{}')||{};}catch{}
  sections.forEach((section,index)=>{
    const heading=section.querySelector('.section-heading'),button=document.createElement('button');if(!heading)return;
    button.type='button';button.className='section-fold';heading.append(button);
    const update=folded=>{section.classList.toggle('section-folded',folded);button.textContent=folded?'＋':'−';button.setAttribute('aria-expanded',String(!folded));button.setAttribute('aria-label',`${folded?'展开':'收起'}${heading.querySelector('h2').textContent}`);};
    update(!!saved[index]);button.onclick=()=>{const folded=!section.classList.contains('section-folded');update(folded);saved[index]=folded;try{localStorage.setItem('douge-panel-folds',JSON.stringify(saved));}catch{}};
  });
}
function filterStickerColors(query='',series='ALL') {
  const term=String(query).trim().toUpperCase().replace(/^MARD\s*/,'').replace(/^([A-Z]+)0+(\d)/,'$1$2');
  return MARD_COLORS.filter(color=>(!state.paletteCodes||state.paletteCodes.has(color.code))&&(series==='ALL'||color.code.replace(/\d/g,'')===series)&&(!term||color.code.includes(term)||color.hex.includes(term)));
}
function initSourceControls() {
  const modal=(id,open)=>{el(id).hidden=!open;document.body.classList.toggle('modal-open',open);};
  el('processingMode').onchange=event=>{state.processingMode=event.target.value;state.snapshotGrid=null;processImage();};
  el('mergeStrength').oninput=event=>{el('mergeStrengthValue').textContent=event.target.value;};
  el('mergeStrength').onchange=event=>{state.mergeStrength=clamp(Number(event.target.value),0,100);state.snapshotGrid=null;processImage();};
  el('cropSource').onclick=()=>{if(!state.image)return;setCropFields(sourceRectangle(state.originalImage,state.sourceEdits||{}));modal('cropModal',true);};
  el('cropClose').onclick=()=>modal('cropModal',false);
  el('cropFull').onclick=()=>setCropFields(sourceRectangle(state.originalImage));
  ['cropX','cropY','cropWidth','cropHeight'].forEach(id=>el(id).onchange=()=>setCropFields(cropFields()));
  el('cropApply').onclick=()=>{applySourceEdits({...state.sourceEdits,...cropFields()});modal('cropModal',false);};
  for(const [id,key] of [['flipSourceX','flipX'],['flipSourceY','flipY']])el(id).onclick=()=>{if(state.image)applySourceEdits({...state.sourceEdits,[key]:!state.sourceEdits?.[key]});};
  el('resetSource').onclick=()=>{if(state.image)applySourceEdits({});};
  const cropCanvas=el('cropCanvas');let start=null;
  const point=event=>{const r=cropCanvas.getBoundingClientRect();return {x:clamp(Math.floor((event.clientX-r.left)/r.width*state.originalImage.naturalWidth),0,state.originalImage.naturalWidth-1),y:clamp(Math.floor((event.clientY-r.top)/r.height*state.originalImage.naturalHeight),0,state.originalImage.naturalHeight-1)};};
  cropCanvas.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();start=point(event);cropCanvas.setPointerCapture(event.pointerId);};
  cropCanvas.onpointermove=event=>{if(!start)return;const end=point(event);setCropFields({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x)+1,height:Math.abs(end.y-start.y)+1});};
  cropCanvas.onpointerup=()=>start=null;cropCanvas.onpointercancel=()=>start=null;
  let sticker=null,stickerName='',stickerToken=0,turns=0,flipX=false,flipY=false,stickerDrag=null,previewFrame=0,transformCache=null,backgroundCache=null,isPreset=false;
  const placement=el('stickerPlacement');
  const ratio=()=>!sticker?1:turns%2?sticker.naturalHeight/sticker.naturalWidth:sticker.naturalWidth/sticker.naturalHeight;
  const box=()=>fitStickerBox(Number(el('stickerX').value)-1,Number(el('stickerY').value)-1,Number(el('stickerWidth').value),Number(el('stickerHeight').value),state.cols,state.rows,el('stickerAspect').checked?ratio():null);
  const writeBox=b=>{el('stickerX').value=b.x+1;el('stickerY').value=b.y+1;el('stickerWidth').value=b.width;el('stickerHeight').value=b.height;};
  const transformed=()=>{
    const key=`${turns}:${flipX}:${flipY}`;if(transformCache?.image===sticker&&transformCache.key===key)return transformCache.canvas;
    const c=document.createElement('canvas'),scale=Math.min(1,2048/Math.max(sticker.naturalWidth,sticker.naturalHeight)),w=Math.max(1,Math.round(sticker.naturalWidth*scale)),h=Math.max(1,Math.round(sticker.naturalHeight*scale));c.width=turns%2?h:w;c.height=turns%2?w:h;
    const ctx=c.getContext('2d');ctx.translate(c.width/2,c.height/2);ctx.scale(flipX?-1:1,flipY?-1:1);ctx.rotate(turns*Math.PI/2);ctx.drawImage(sticker,-w/2,-h/2,w,h);
    c.naturalWidth=c.width;c.naturalHeight=c.height;transformCache={image:sticker,key,canvas:c};return c;
  };
  const preview=()=>{
    previewFrame=0;if(el('stickerModal').hidden)return;
    const s=Math.min(760/state.cols,420/state.rows);placement.width=Math.round(state.cols*s);placement.height=Math.round(state.rows*s);
    const ctx=placement.getContext('2d');
    if(backgroundCache?.cells!==state.cells||backgroundCache.width!==placement.width||backgroundCache.height!==placement.height){const c=document.createElement('canvas');c.width=placement.width;c.height=placement.height;const bctx=c.getContext('2d');bctx.fillStyle='#fff';bctx.fillRect(0,0,c.width,c.height);for(let y=0;y<state.rows;y++)for(let x=0;x<state.cols;x++){const color=state.cells[y*state.cols+x];if(color){bctx.fillStyle=color.hex;bctx.fillRect(x*s,y*s,Math.ceil(s),Math.ceil(s));}}backgroundCache={cells:state.cells,width:c.width,height:c.height,canvas:c};}
    ctx.drawImage(backgroundCache.canvas,0,0);
    const editable=Boolean(sticker);for(const id of ['stickerApply','stickerAspect','stickerCenter','stickerRotate','stickerFlipX','stickerFlipY','stickerReset','stickerX','stickerY','stickerWidth','stickerHeight'])el(id).disabled=!editable;
    if(!editable){el('stickerStatus').textContent='请选择预制贴纸或上传图片';return;}
    const b=box();ctx.imageSmoothingEnabled=false;ctx.drawImage(transformed(),b.x*s,b.y*s,b.width*s,b.height*s);
    ctx.strokeStyle='#e85d35';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.strokeRect(b.x*s,b.y*s,b.width*s,b.height*s);ctx.setLineDash([]);ctx.fillStyle='#e85d35';ctx.fillRect((b.x+b.width)*s-6,(b.y+b.height)*s-6,12,12);
    el('stickerStatus').textContent=`${b.width} × ${b.height} 格 · 第 ${b.x+1} 列，第 ${b.y+1} 行`;
  };
  const queuePreview=()=>{if(!previewFrame)previewFrame=requestAnimationFrame(preview);};
  const centered=()=>{const b=box();writeBox({...b,x:Math.floor((state.cols-b.width)/2),y:Math.floor((state.rows-b.height)/2)});queuePreview();};
  const resetSticker=()=>{turns=0;flipX=false;flipY=false;el('stickerAspect').checked=true;writeBox(fitStickerBox(0,0,Math.min(32,state.cols),32,state.cols,state.rows,ratio()));centered();};
  for(const id of ['stickerX','stickerY','stickerWidth','stickerHeight'])el(id).onchange=()=>{if(id==='stickerHeight'&&el('stickerAspect').checked)el('stickerWidth').value=Math.round(Number(el(id).value)*ratio());writeBox(box());queuePreview();};
  el('stickerAspect').onchange=()=>{writeBox(box());queuePreview();};el('stickerCenter').onclick=centered;el('stickerReset').onclick=resetSticker;
  el('stickerRotate').onclick=()=>{const b=box();turns=(turns+1)%4;writeBox(fitStickerBox(b.x,b.y,b.height,b.width,state.cols,state.rows,el('stickerAspect').checked?ratio():null));queuePreview();};
  el('stickerFlipX').onclick=()=>{flipX=!flipX;queuePreview();};el('stickerFlipY').onclick=()=>{flipY=!flipY;queuePreview();};
  const pointer=event=>{const r=placement.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*state.cols,y:(event.clientY-r.top)/r.height*state.rows};};
  placement.onpointerdown=event=>{if(!sticker||event.button!==0)return;const p=pointer(event),b=box(),r=placement.getBoundingClientRect(),hit=12*state.cols/r.width;const resize=Math.abs(p.x-b.x-b.width)<hit&&Math.abs(p.y-b.y-b.height)<12*state.rows/r.height;if(!resize&&(p.x<b.x||p.x>b.x+b.width||p.y<b.y||p.y>b.y+b.height))return;event.preventDefault();stickerDrag={p,b,resize};placement.setPointerCapture(event.pointerId);};
  placement.onpointermove=event=>{if(!stickerDrag)return;const p=pointer(event),{b,p:origin,resize}=stickerDrag,dx=p.x-origin.x,dy=p.y-origin.y;writeBox(resize?fitStickerBox(b.x,b.y,b.width+dx,b.height+dy,state.cols,state.rows,el('stickerAspect').checked?ratio():null):fitStickerBox(b.x+dx,b.y+dy,b.width,b.height,state.cols,state.rows));queuePreview();};
  placement.onpointerup=()=>stickerDrag=null;placement.onpointercancel=()=>stickerDrag=null;
  const makePreset=()=>{
    const first=!isPreset||!sticker;stickerToken++;isPreset=true;
    const size=clamp(Number(el('stickerSize').value)||32,3,Math.min(state.cols,state.rows)),shape=el('stickerShape').value,style=el('stickerStyle').value;
    const available=MARD_COLORS.filter(c=>!state.paletteCodes||state.paletteCodes.has(c.code));if(!available.length)return showToast('请先选择至少一种色号');
    const color=available.find(c=>c.code===el('stickerColor').value)||available[0];el('stickerColor').value=color.code;el('stickerColorCode').textContent=`${color.name} · ${color.hex}`;
    el('stickerColorCode').style.borderLeft=`16px solid ${color.hex}`;
    const c=document.createElement('canvas');c.width=c.height=size;c.naturalWidth=c.naturalHeight=size;const ctx=c.getContext('2d');ctx.fillStyle=color.hex;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(presetShapePixel(shape,style,x,y,size))ctx.fillRect(x,y,1,1);
    sticker=c;stickerName={heart:'爱心',star:'星星',circle:'圆形',diamond:'菱形'}[shape];transformCache=null;
    const old=first?{x:Math.floor((state.cols-size)/2),y:Math.floor((state.rows-size)/2)}:box();
    writeBox(fitStickerBox(old.x,old.y,size,size,state.cols,state.rows));el('stickerSizeValue').textContent=`${size} 格`;renderStickerChoices(color.hex);queuePreview();
  };
  const renderStickerChoices=hex=>{
    for(const [id,items,input] of [['stickerShapeChoices',[['heart','爱心'],['star','星星'],['circle','圆形'],['diamond','菱形']],'stickerShape'],['stickerStyleChoices',[['solid','纯色'],['outline','镂空'],['stripe','条纹']],'stickerStyle']]){
      const host=el(id);host.replaceChildren();for(const [value,label] of items){const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(el(input).value===value));const canvas=document.createElement('canvas');canvas.width=canvas.height=40;canvas.setAttribute('aria-hidden','true');const ctx=canvas.getContext('2d');ctx.fillStyle=hex;for(let y=0;y<40;y++)for(let x=0;x<40;x++)if(presetShapePixel(input==='stickerShape'?value:el('stickerShape').value,input==='stickerStyle'?value:el('stickerStyle').value,x,y,40))ctx.fillRect(x,y,1,1);const name=document.createElement('span');name.textContent=label;button.append(canvas,name);button.onclick=()=>{el(input).value=value;makePreset();};host.append(button);}
    }
  };
  const renderStickerColorGrid=()=>{
    const colors=filterStickerColors(el('stickerColorSearch').value,el('stickerColorSeries').value),host=el('stickerColorGrid');host.replaceChildren();el('stickerColorCount').textContent=`${colors.length} 色`;
    for(const color of colors){const button=document.createElement('button');button.type='button';button.className='sticker-color-card';button.dataset.code=color.code;button.setAttribute('aria-label',`${color.name} ${color.hex}`);button.setAttribute('aria-pressed',String(color.code===el('stickerColor').value));button.title=`${color.name} · ${color.hex}`;const swatch=document.createElement('i');swatch.style.background=color.hex;swatch.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent=color.code;button.append(swatch,text);button.onclick=()=>{const position=isPreset&&sticker?box():null;el('stickerColor').value=color.code;makePreset();if(position){writeBox(position);queuePreview();}renderStickerColorGrid();};host.append(button);}
    if(!colors.length){const empty=document.createElement('p');empty.textContent='没有匹配的色号';host.append(empty);}
  };
  const refreshStickerColors=()=>{const available=filterStickerColors();if(!available.some(c=>c.code===el('stickerColor').value))el('stickerColor').value=(available.find(c=>c.code==='A14')||available[0])?.code||'';el('stickerColorSearch').value='';el('stickerColorSeries').replaceChildren();for(const series of ['ALL',...new Set(available.map(c=>c.code.replace(/\d/g,'')))]){const option=document.createElement('option');option.value=series;option.textContent=series==='ALL'?'全部系列':`${series} 系列`;el('stickerColorSeries').append(option);}renderStickerColorGrid();};
  el('stickerColorSearch').oninput=renderStickerColorGrid;el('stickerColorSeries').onchange=renderStickerColorGrid;
  el('presetStickerToggle').onclick=()=>{const open=el('presetStickerSettings').hidden;el('presetStickerSettings').hidden=!open;el('presetStickerToggle').setAttribute('aria-expanded',String(open));if(open)makePreset();else if(isPreset){sticker=null;isPreset=false;transformCache=null;stickerDrag=null;queuePreview();}};
  el('addSticker').onclick=()=>{if(!state.image)return showToast('请先选择原图');if(state.layers.length>=20)return showToast('最多 20 个图层');modal('stickerModal',true);el('presetStickerSettings').hidden=true;el('presetStickerToggle').setAttribute('aria-expanded','false');refreshStickerColors();sticker=null;stickerToken++;stickerDrag=null;transformCache=null;isPreset=false;turns=0;flipX=false;flipY=false;el('stickerSize').max=Math.min(150,state.cols,state.rows);queuePreview();};
  el('stickerUpload').onclick=()=>el('stickerFile').click();
  ['stickerShape','stickerStyle','stickerColor'].forEach(id=>el(id).onchange=makePreset);el('stickerSize').oninput=makePreset;
  el('stickerFile').onchange=event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)return showToast('请选择 10 MB 以内的 PNG、JPG 或 WEBP 图片');
    const token=++stickerToken,reader=new FileReader();reader.onerror=()=>showToast('贴纸读取失败');reader.onload=()=>{const img=new Image();img.onload=()=>{if(token!==stickerToken)return;sticker=img;isPreset=false;stickerName=file.name.replace(/\.[^.]+$/,'').slice(0,25);modal('stickerModal',true);resetSticker();};img.onerror=()=>showToast('贴纸图片读取失败');img.src=reader.result;};reader.readAsDataURL(file);
  };
  el('stickerClose').onclick=()=>{stickerToken++;sticker=null;modal('stickerModal',false);};
  el('stickerApply').onclick=()=>{
    if(!sticker||!state.image)return;
    if(state.layers.length>=20){el('stickerStatus').textContent='最多 20 个图层';return;}
    const {x,y,width:w,height:h}=box();
    try{const cells=stickerLayerCells(transformed(),w,h,x,y,state.cols,state.rows);if(!cells.size)throw new Error('贴纸没有可放置的像素');pushHistory();const layer={id:`sticker-${Date.now()}`,name:`贴纸 · ${stickerName}`,visible:true,locked:false,cells};state.layers.push(layer);state.activeLayerId=layer.id;bindActiveLayer();applyColorLayers();render();renderLayers();updatePaintUI();modal('stickerModal',false);sticker=null;showToast('贴纸已添加到独立图层');}catch(error){el('stickerStatus').textContent=error.message;}
  };
  for(const id of ['cropModal','stickerModal'])el(id).onclick=event=>{if(event.target===el(id))modal(id,false);};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){modal('cropModal',false);modal('stickerModal',false);}});
}
function initStudioControls() {
  el('layerConfirmCancel').onclick=closeLayerConfirmation;
  el('layerConfirmSubmit').onclick=()=>{const pending=closeLayerConfirmation();if(pending)layerAction(pending.action,pending.id);};
  el('layerConfirmModal').onclick=event=>{if(event.target===el('layerConfirmModal'))closeLayerConfirmation();};
  el('layerConfirmModal').onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeLayerConfirmation();}else if(event.key==='Tab'){event.preventDefault();(document.activeElement===el('layerConfirmCancel')?el('layerConfirmSubmit'):el('layerConfirmCancel')).focus();}};
  initSectionDisclosure();
  initSourceControls();
  const applyScale=percent=>{const layer=state.layers.find(l=>l.id===state.activeLayerId);if(!layer||(!layer.cells.size&&!layer.scaleSource?.size))return showToast('当前图层没有内容');if(layer.locked){syncLayerScaleControls(layer.scalePercent||100);return showToast('请先解锁当前图层');}if(!Number.isFinite(percent)){syncLayerScaleControls(layer.scalePercent||100);return;}percent=clamp(percent,1,5000);pushHistory();if(!layer.scaleSource){layer.scaleSource=new Map(layer.cells);layer.scaleOffset={x:0,y:0};}layer.cells=scaleLayerPercent(layer.scaleSource,percent,state.cols,state.rows,layer.scaleOffset);layer.scalePercent=percent;bindActiveLayer();applyColorLayers();render();updatePaintUI();};
  el('layerScaleRange').oninput=event=>{el('layerScalePercent').value=event.target.value;};
  el('layerScaleRange').onchange=event=>applyScale(Number(event.target.value));el('layerScalePercent').onchange=event=>applyScale(Number(event.target.value));
  document.querySelectorAll('[data-layer-move]').forEach(button=>button.onclick=()=>{
    const layer=state.layers.find(l=>l.id===state.activeLayerId);if(!layer||!layer.cells.size)return showToast('当前图层没有可移动的内容');if(layer.locked)return showToast('请先解锁当前图层');
    const step=clamp(Math.floor(Number(el('layerMoveStep').value)||1),1,600),[x,y]=button.dataset.layerMove.split(',').map(Number),transform=translatedLayerTransform(layer,x*step,y*step,state.cols,state.rows);
    if(!transform)return showToast('已到画板边缘');pushHistory();Object.assign(layer,transform);bindActiveLayer();applyColorLayers();render();updatePaintUI();
  });
  el('sidebarToggle').onclick=()=>setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
  restorePaletteConfig();
  for(const [id,mode] of [['paletteTab','palette'],['inventoryTab','inventory']])el(id).onclick=()=>{state.paletteMode=mode;el('paletteTab').classList.toggle('active',mode==='palette');el('inventoryTab').classList.toggle('active',mode==='inventory');renderAllColors(ui.paletteSearch.value);};
  ui.allColorsGrid.addEventListener('input',event=>{const code=event.target.dataset.stockCode;if(!code||!state.paletteDraft)return;state.paletteDraft.inventory[code]=clamp(Math.floor(Number(event.target.value)||0),0,9999999);});
  el('paletteSelectAll').onclick=()=>{if(!state.paletteDraft)return;state.paletteDraft.codes=new Set(MARD_COLORS.map(c=>c.code));renderAllColors(ui.paletteSearch.value);};
  el('paletteClear').onclick=()=>{if(!state.paletteDraft)return;if(state.paletteMode==='inventory')state.paletteDraft.inventory={};else state.paletteDraft.codes.clear();renderAllColors(ui.paletteSearch.value);};
  el('paletteCancel').onclick=closePaletteBrowser;
  el('paletteApply').onclick=()=>{
    const config=state.paletteDraft;if(!config?.codes.size){el('paletteEditorStatus').textContent='请至少选择一种色号';return;}
    try{localStorage.setItem('douge-mard-library-v1',JSON.stringify({version:1,brand:'MARD',codes:[...config.codes],inventory:config.inventory}));}
    catch{el('paletteEditorStatus').textContent='无法保存，请检查浏览器存储空间';return;}
    state.paletteCodes=new Set(config.codes);state.inventory={...config.inventory};closePaletteBrowser();if(state.image)processImage();showToast('色板与豆库已保存并应用');
  };
  el('paletteImport').onclick=()=>el('paletteImportFile').click();
  el('paletteImportFile').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>1024*1024)throw new Error('文件不能超过 1 MB');const config=parsePaletteFile(await file.text());state.paletteDraft={codes:new Set(config.codes),inventory:config.inventory};renderAllColors(ui.paletteSearch.value);el('paletteEditorStatus').textContent='已导入，保存与应用后生效';}catch(error){el('paletteEditorStatus').textContent=error.message;}finally{event.target.value='';}};
  el('paletteExport').onclick=()=>{const config=state.paletteDraft;if(!config)return;const url=URL.createObjectURL(new Blob([paletteConfigCsv(config)],{type:'text/csv;charset=utf-8'}));download(url,'豆格-MARD色板与豆库.csv');setTimeout(()=>URL.revokeObjectURL(url),1000);};
  document.querySelectorAll('[data-layer-action]').forEach(button=>button.onclick=()=>layerAction(button.dataset.layerAction));
  el('baseLayerVisible').onchange=event=>{if(!state.image)return;pushHistory();state.baseVisible=event.target.checked;applyColorLayers();render();};
}

ui.fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach(n => ui.dropZone.addEventListener(n, e => { e.preventDefault(); ui.dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(n => ui.dropZone.addEventListener(n, e => { e.preventDefault(); ui.dropZone.classList.remove('dragging'); }));
ui.dropZone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0])); el('removeImage').addEventListener('click', reset); el('useDemo').addEventListener('click', createDemo);
[ui.width, ui.height].forEach(input => input.addEventListener('change', () => { document.querySelectorAll('.preset-row button').forEach(b => b.classList.remove('active')); processImage(); }));
document.querySelectorAll('.preset-row button').forEach(btn => btn.addEventListener('click', () => {
  const [cols, rows] = btn.dataset.size.split('x'); ui.width.value = cols; ui.height.value = rows;
  document.querySelectorAll('.preset-row button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); processImage();
}));
ui.colors.addEventListener('change', () => processImage());
ui.colors.addEventListener('keydown', event => { if (event.key === 'Enter') ui.colors.blur(); });
ui.showGrid.addEventListener('change', () => state.image && render());
ui.showSymbols.addEventListener('change', () => saveUnifiedGridSettings()); ui.removeWhite.addEventListener('change', () => processImage());
ui.majorGridSize.addEventListener('input', () => saveUnifiedGridSettings());
[ui.majorGridStyle,ui.exportMajorGridColor,ui.exportMinorGridColor].forEach(control => control.addEventListener('change', () => saveUnifiedGridSettings()));
ui.paintToggle.addEventListener('click', () => { state.paintMode = !state.paintMode; state.pickerMode = false; state.tool = 'brush'; updatePaintUI(); });
ui.eraserButton.addEventListener('click', toggleEraser);
ui.fillButton.addEventListener('click', () => setTool('fill'));
ui.lineButton.addEventListener('click', () => setTool('line'));
ui.rectButton.addEventListener('click', () => setTool('rect'));
ui.selectButton.addEventListener('click', () => setTool('select'));
ui.panButton.addEventListener('click', () => setTool(state.tool === 'pan' ? 'brush' : 'pan'));
ui.referenceToggle.addEventListener('click', () => { state.showReference = !state.showReference; render(); updatePaintUI(); });
ui.pickerButton.addEventListener('click', () => setTool(state.tool === 'picker' ? 'brush' : 'picker'));
ui.customColor.addEventListener('input', () => {
  const hex = ui.customColor.value.toUpperCase(), rgb = hexToRgb(hex);
  selectPaintColor({ code: `X${String(state.customIndex++).padStart(2, '0')}`, name: '自定义色', hex, rgb });
  state.pickerMode = false; updatePaintUI(); updateDetails();
});
ui.mardColor.addEventListener('change', () => {
  const chosen = ui.mardColor.value===EMPTY_KEY?EMPTY_COLOR:MARD_COLORS.find(color => color.code === ui.mardColor.value);
  if (chosen) selectPaintColor(resolveColorReplacement(chosen));
  state.pickerMode = false; updatePaintUI(); updateDetails();
});
ui.paletteList.addEventListener('click', event => {
  const replaceButton = event.target.closest('[data-replace]');
  if (replaceButton) { openReplaceModal(replaceButton.dataset.replace); return; }
  const emptyButton = event.target.closest('[data-empty-color]');
  if (emptyButton) {
    if (!state.paintMode) state.paintMode = true; toggleEraser(); return;
  }
  const swatch = event.target.closest('[data-color]'); if (!swatch) return;
  const key = swatch.dataset.color.toUpperCase(), chosen = state.used.find(p => colorKey(p) === key);
  if (chosen) selectPaintColor(chosen);
  if (!state.paintMode) state.paintMode = true; state.pickerMode = false; updatePaintUI(); updateDetails();
});
ui.replaceColorSelect.addEventListener('change', updateReplacePreview);
ui.replaceClose.addEventListener('click', closeReplaceModal); ui.replaceCancel.addEventListener('click', closeReplaceModal);
ui.replaceConfirm.addEventListener('click', confirmColorReplacement);
ui.replaceModal.addEventListener('click', event => { if (event.target === ui.replaceModal) closeReplaceModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !ui.replaceModal.hidden) closeReplaceModal(); });
ui.undoButton.addEventListener('click', () => {
  const previous = state.history.pop(); if (!previous) return;
  state.redoHistory.push(historySnapshot()); restoreHistorySnapshot(previous);
});
ui.redoButton.addEventListener('click', () => {
  const next = state.redoHistory.pop(); if (!next) return;
  state.history.push(historySnapshot()); restoreHistorySnapshot(next);
});
ui.canvas.addEventListener('pointerdown', beginPaint); ui.canvas.addEventListener('pointermove', movePaint);
ui.canvas.addEventListener('pointerup', endPaint); ui.canvas.addEventListener('pointercancel', endPaint); ui.canvas.addEventListener('pointerleave', e => { if (e.buttons === 0) endPaint(e); });
ui.zoomOut.addEventListener('click', () => stepCanvasZoom(-1));
ui.zoomIn.addEventListener('click', () => stepCanvasZoom(1));
ui.zoomValue.addEventListener('click', () => setCanvasZoom(1, false));
ui.zoomFit.addEventListener('click', () => setCanvasZoom(state.zoom, true));
ui.openEditorButton.addEventListener('click', () => setSidebarCollapsed(true));
ui.returnToMain.addEventListener('click', leaveDedicatedEditor);
ui.openAllColors.addEventListener('click', openPaletteBrowser);
ui.paletteBrowserClose.addEventListener('click', closePaletteBrowser);
ui.paletteBrowserModal.addEventListener('click', event => { if (event.target === ui.paletteBrowserModal) closePaletteBrowser(); });
ui.paletteSearch.addEventListener('input', () => renderAllColors(ui.paletteSearch.value));
ui.paletteGroups.addEventListener('click', event => {
  const button = event.target.closest('[data-palette-group]'); if (!button) return;
  state.paletteGroup = button.dataset.paletteGroup; renderAllColors(ui.paletteSearch.value);
});
ui.allColorsGrid.addEventListener('click', event => {
  const card = event.target.closest('[data-palette-code]'); if (!card) return;
  const chosen = MARD_COLORS.find(color => color.code === card.dataset.paletteCode); if (!chosen) return;
  if (!state.paletteDraft) return;
  const codes=state.paletteDraft.codes; codes.has(chosen.code)?codes.delete(chosen.code):codes.add(chosen.code);
  renderAllColors(ui.paletteSearch.value);
});
ui.finishedPreviewButton.addEventListener('click', openFinishedPreview);
ui.finishedPreviewClose.addEventListener('click', closeFinishedPreview);
ui.finishedPreviewModal.addEventListener('click', event => { if (event.target === ui.finishedPreviewModal) closeFinishedPreview(); });
ui.selectionCopy.addEventListener('click', () => copySelection(false));
ui.selectionCut.addEventListener('click', () => copySelection(true));
ui.selectionPaste.addEventListener('click', pasteSelection);
ui.selectionDelete.addEventListener('click', () => applySelectionColor(EMPTY_COLOR));
ui.selectionCancel.addEventListener('click', cancelSelection);
ui.scroll.addEventListener('wheel', event => {
  if (!event.ctrlKey || !state.image) return;
  event.preventDefault(); stepCanvasZoom(event.deltaY < 0 ? 1 : -1);
}, { passive: false });
window.addEventListener('resize', () => { if (state.image && state.fitZoom) render(); else if(state.image)syncCanvasToolbar(); });
ui.saveDraft.addEventListener('click', () => saveDraft(true));
ui.clearDraft.addEventListener('click', () => clearDraft(true));
el('exportPng').addEventListener('click', () => {
  if (!state.image) return showToast('请先选择一张图片');
  if (!window.PindouBilling) return showToast('付费结算模块尚未加载，请刷新页面后重试');
  window.PindouBilling.requestOwnDownload(generatePaidPdf);
});
el('exportCsv').addEventListener('click', () => {
  if (!state.image) return showToast('请先选择一张图片'); recalculateUsed();
  const rows = ['色号,颜色名称,HEX,数量', ...state.used.map(p => `${p.code},${p.name},${p.hex},${p.count}`), `,总计,,${state.used.reduce((n, p) => n + p.count, 0)}`];
  const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }); download(URL.createObjectURL(blob), `${state.fileName.replace(/\.[^.]+$/, '')}-用量清单.csv`); showToast('用量清单已导出');
});

document.addEventListener('keydown', event => {
  const editable = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (!editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); (event.shiftKey ? ui.redoButton : ui.undoButton).click(); return;
  }
  if (!editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); ui.redoButton.click(); return; }
  if (event.key === 'Escape') {
    if (!ui.paletteBrowserModal.hidden) closePaletteBrowser();
    else if (!ui.finishedPreviewModal.hidden) closeFinishedPreview();
    else if (state.selection) cancelSelection();
  }
  if (!state.selection || editable) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(false); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') { event.preventDefault(); copySelection(true); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); applySelectionColor(EMPTY_COLOR); }
  if (event.key === 'Enter' && state.selectedColor) { event.preventDefault(); applySelectionColor(state.selectedColor); }
});

initStudioControls();
ui.mardColor.innerHTML = mardOptionsHtml();
ui.replaceColorSelect.innerHTML = mardOptionsHtml();
restoreExportSettings(); renderAllColors();
window.PindouDraftBridge = Object.freeze({
  hasProject: () => Boolean(state.image),
  currentProject: () => state.image ? draftRecord() : null,
  restore(project) {
    if (!project || project.version !== DRAFT_VERSION || typeof project.imageSrc !== 'string') return false;
    state.restoringDraft = true;
    loadImage(project.imageSrc, project.fileName || '云端草稿.png', project.fileMeta || '账号云草稿', project, 'cloud');
    return true;
  }
});
function validPatternGrid(grid) {
  return !!grid && Number.isInteger(grid.cols)&&grid.cols>=8&&grid.cols<=600 && Number.isInteger(grid.rows)&&grid.rows>=8&&grid.rows<=600 && Array.isArray(grid.colors)&&grid.colors.length<=1000 && grid.colors.every(color=>color&&/^#[0-9a-f]{6}$/i.test(color.hex)&&Array.isArray(color.rgb)&&color.rgb.length===3&&color.rgb.every(v=>Number.isFinite(v)&&v>=0&&v<=255)) && Array.isArray(grid.indices)&&grid.indices.length===grid.cols*grid.rows&&grid.indices.every(i=>Number.isInteger(i)&&i>=-1&&i<grid.colors.length);
}
window.PindouGalleryBridge=Object.freeze({
  current() {
    if(!state.image)return null;
    const colors=[],lookup=new Map(),indices=state.cells.map(color=>{if(!color)return -1;const key=`${color.code}:${color.hex}`;if(!lookup.has(key)){lookup.set(key,colors.length);colors.push(serializeColor(color));}return lookup.get(key);});
    return {title:state.fileName.replace(/\.[^.]+$/,''),pattern:{cols:state.cols,rows:state.rows,colors,indices}};
  },
  open(work) {
    if(!validPatternGrid(work.pattern))throw new Error('图纸数据不正确');
    const grid=work.pattern,canvas=document.createElement('canvas');canvas.width=grid.cols;canvas.height=grid.rows;
    const ctx=canvas.getContext('2d');grid.indices.forEach((i,index)=>{if(i>=0){ctx.fillStyle=grid.colors[i].hex;ctx.fillRect(index%grid.cols,Math.floor(index/grid.cols),1,1);}});
    const project={version:1,fileName:`${String(work.title||'画廊作品').slice(0,80)}.png`,settings:{cols:grid.cols,rows:grid.rows,colors:Math.max(4,grid.colors.length)},manualOverrides:[],colorReplacements:[],snapshotGrid:grid};
    loadImage(canvas.toDataURL('image/png'),project.fileName,'画廊图纸',project,'gallery');
  }
});
applyEditorMode(); updatePaintUI(); updateDraftControls(); updateZoomUI(); restoreDraftOnStart();

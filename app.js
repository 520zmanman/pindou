window.PINDOU_BUILD = '2026.08.23-eraser-v6';
const el = id => document.getElementById(id);
const ui = {
  fileInput: el('fileInput'), dropZone: el('dropZone'), fileCard: el('fileCard'), sourceThumb: el('sourceThumb'),
  fileName: el('fileName'), fileMeta: el('fileMeta'), empty: el('emptyState'), scroll: el('canvasScroll'),
  canvas: el('patternCanvas'), width: el('gridWidth'), height: el('gridHeight'), colors: el('colorCount'),
  showGrid: el('showGrid'), showSymbols: el('showSymbols'), removeWhite: el('removeWhite'),
  majorGridSize: el('majorGridSize'), majorGridStyle: el('majorGridStyle'),
  palette: el('palettePanel'), paletteList: el('paletteList'), paintToggle: el('paintToggle'),
  eraserButton: el('eraserButton'), referenceToggle: el('referenceToggle'), pickerButton: el('pickerButton'), mardColor: el('mardColor'), customColor: el('customColor'),
  undoButton: el('undoButton'), paintStatus: el('paintStatus'), replaceModal: el('replaceModal'),
  replaceClose: el('replaceClose'), replaceCancel: el('replaceCancel'), replaceConfirm: el('replaceConfirm'),
  replaceColorSelect: el('replaceColorSelect'), replaceFromSwatch: el('replaceFromSwatch'), replaceFromCode: el('replaceFromCode'),
  replaceFromCount: el('replaceFromCount'), replaceToSwatch: el('replaceToSwatch'), replaceToCode: el('replaceToCode'), replaceToHex: el('replaceToHex')
};

const state = {
  image: null, fileName: '', baseCells: [], cells: [], manualOverrides: new Map(), colorReplacements: new Map(), cols: 80, rows: 40,
  processedCols: 80, processedRows: 40, used: [],
  paintMode: false, pickerMode: false, selectedColor: null, drawing: false, lastPaintIndex: -1,
  history: [], cellSize: 10, gridOriginX: 0, gridOriginY: 0, customIndex: 1, showReference: false,
  replaceSource: null, lastPaintColor: null
};

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(rgb) { return '#' + rgb.map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function luminance(rgb) { return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000; }
function colorDistance(a, b) {
  const mean = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db;
}
const MARD_COLORS = window.MARD_PALETTE.map(([code, hex]) => ({ code, name: `MARD ${code}`, hex, rgb: hexToRgb(hex) }));
const EMPTY_KEY = '__EMPTY__';
const EMPTY_COLOR = Object.freeze({ code: 'EMPTY', name: '无豆 / 留空', hex: 'transparent', rgb: [255, 255, 255], isEmpty: true });
function nearestIndex(rgb, colors) {
  let best = 0, score = Infinity;
  for (let i = 0; i < colors.length; i++) { const d = colorDistance(rgb, colors[i]); if (d < score) { score = d; best = i; } }
  return best;
}

// 原图中的每个像素只会被计入一个网格区域，整个过程不创建网格尺寸的缩略图。
function averageOriginalRegions(image, cols, rows) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const count = cols * rows;
  const sumR = new Float64Array(count), sumG = new Float64Array(count), sumB = new Float64Array(count), weights = new Float64Array(count);
  for (let y = 0; y < canvas.height; y++) {
    const gy = Math.min(rows - 1, Math.floor(y * rows / canvas.height));
    for (let x = 0; x < canvas.width; x++) {
      const gx = Math.min(cols - 1, Math.floor(x * cols / canvas.width));
      const cell = gy * cols + gx, i = (y * canvas.width + x) * 4, alpha = data[i + 3] / 255;
      if (alpha < .05) continue;
      sumR[cell] += data[i] * alpha; sumG[cell] += data[i + 1] * alpha; sumB[cell] += data[i + 2] * alpha; weights[cell] += alpha;
    }
  }
  return Array.from({ length: count }, (_, i) => weights[i] ? [sumR[i] / weights[i], sumG[i] / weights[i], sumB[i] / weights[i]] : null);
}

// 将区域平均色按感知颜色距离分层。颜色数量是上限，实际颜色可能更少。
function clusterColors(samples, requestedCount) {
  const valid = samples.filter(Boolean);
  if (!valid.length) return { colors: [], assignments: samples.map(() => -1) };
  const unique = new Map();
  for (const rgb of valid) { const key = rgb.map(v => Math.round(v / 3) * 3).join(','); if (!unique.has(key)) unique.set(key, rgb); }
  const points = [...unique.values()], k = Math.min(requestedCount, points.length);
  const mean = valid.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(v => v / valid.length);
  const centers = [points.reduce((best, p) => colorDistance(p, mean) < colorDistance(best, mean) ? p : best, points[0]).slice()];
  while (centers.length < k) {
    let farthest = points[0], farthestDistance = -1;
    for (const p of points) { const d = Math.min(...centers.map(c => colorDistance(p, c))); if (d > farthestDistance) { farthestDistance = d; farthest = p; } }
    centers.push(farthest.slice());
  }
  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const p of valid) { const n = nearestIndex(p, centers); sums[n][0] += p[0]; sums[n][1] += p[1]; sums[n][2] += p[2]; sums[n][3]++; }
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
    const match = mergedCenters.findIndex(existing => colorDistance(center, existing) < 700);
    if (match < 0) mergedCenters.push(center.slice());
    else mergedCenters[match] = mergedCenters[match].map((v, channel) => (v + center[channel]) / 2);
  }
  // 将每个色块锁定到最接近的 MARD 221 实体豆色；多个色块命中同一色号时自动合并。
  const mappedByCode = new Map();
  for (const center of mergedCenters) {
    const mard = MARD_COLORS[nearestIndex(center, MARD_COLORS.map(color => color.rgb))];
    mappedByCode.set(mard.code, mard);
  }
  const colors = [...mappedByCode.values()].sort((a, b) => luminance(b.rgb) - luminance(a.rgb));
  const paletteCenters = colors.map(item => item.rgb);
  const assignments = samples.map(p => p ? nearestIndex(p, paletteCenters) : -1);
  return { colors, assignments };
}

function colorKey(color) { return color && color.isEmpty ? EMPTY_KEY : color.hex.toUpperCase(); }

function resolveReplacementKey(startKey) {
  const key = startKey.toUpperCase();
  return state.colorReplacements.has(key) ? colorKey(state.colorReplacements.get(key)) : key;
}

function resolveColorReplacement(color) {
  return color && state.colorReplacements.has(colorKey(color)) ? state.colorReplacements.get(colorKey(color)) : color;
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
  state.pickerMode = false; updatePaintUI(); updateDetails();
}

function applyColorLayers() {
  state.cells = state.baseCells.slice();
  for (const [index, color] of state.manualOverrides) {
    if (index >= 0 && index < state.cells.length) state.cells[index] = color;
  }
  state.cells = state.cells.map(renderableCell);
}

function pushHistory() {
  state.history.push({ manualOverrides: new Map(state.manualOverrides), colorReplacements: new Map(state.colorReplacements) });
  if (state.history.length > 30) state.history.shift();
}

function replaceColorGlobally(source, target) {
  const sourceKey = colorKey(source), targetKey = colorKey(target);
  if (sourceKey === targetKey) return false;
  pushHistory();
  const affectedKeys = new Set([sourceKey]);
  for (const color of state.baseCells) if (color && resolveReplacementKey(colorKey(color)) === sourceKey) affectedKeys.add(colorKey(color));
  for (const color of state.manualOverrides.values()) if (color && resolveReplacementKey(colorKey(color)) === sourceKey) affectedKeys.add(colorKey(color));
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

function processImage() {
  if (!state.image) return;
  const nextCols = clamp(parseInt(ui.width.value) || 80, 8, 160);
  const nextRows = clamp(parseInt(ui.height.value) || 40, 8, 160);
  const dimensionsChanged = nextCols !== state.processedCols || nextRows !== state.processedRows;
  if (dimensionsChanged) {
    state.manualOverrides = remapManualOverrides(state.processedCols, state.processedRows, nextCols, nextRows);
    state.history = [];
  }
  state.cols = nextCols; state.rows = nextRows;
  state.processedCols = nextCols; state.processedRows = nextRows;
  ui.width.value = state.cols; ui.height.value = state.rows;
  ui.paintStatus.textContent = '正在计算区域平均色…';
  requestAnimationFrame(() => {
    try {
      const averages = averageOriginalRegions(state.image, state.cols, state.rows);
      const filtered = averages.map(rgb => rgb && ui.removeWhite.checked && luminance(rgb) > 242 ? null : rgb);
      const requestedColors = clamp(parseInt(ui.colors.value) || 16, 4, 64);
      ui.colors.value = requestedColors;
      const result = clusterColors(filtered, requestedColors);
      state.baseCells = result.assignments.map(i => i < 0 ? null : result.colors[i]);
      applyColorLayers();
      if (!state.selectedColor) selectPaintColor(result.colors[0] || null);
      render(); updatePaintUI();
    } catch (error) {
      console.error(error); showToast('图片过大，浏览器无法读取全部像素'); ui.paintStatus.textContent = '处理失败';
    }
  });
}

function recalculateUsed() {
  const map = new Map();
  for (const color of state.cells) if (color) {
    const key = color.hex.toUpperCase();
    if (!map.has(key)) map.set(key, { ...color, count: 0 });
    map.get(key).count++;
  }
  state.used = [...map.values()].sort((a, b) => b.count - a.count).map(p => ({ ...p, symbol: p.code }));
}

function render(target = ui.canvas, exportMode = false) {
  recalculateUsed();
  const total = state.used.reduce((sum, color) => sum + color.count, 0);
  const cell = exportMode
    ? Math.max(12, Math.min(32, Math.floor(1900 / state.cols), Math.floor(2600 / state.rows)))
    : Math.min(18, Math.max(9, Math.floor(900 / state.cols)));
  const coordinatesVisible = true;
  const coordinateBand = coordinatesVisible ? (exportMode ? 34 : Math.max(18, Math.min(28, cell * 1.8))) : 0;
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
  if (!exportMode) { state.cellSize = cell; state.gridOriginX = gridX; state.gridOriginY = gridY; }

  const ctx = target.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target.width, target.height);
  const referenceVisible = state.showReference && !exportMode && state.image;
  if (referenceVisible) {
    ctx.save(); ctx.globalAlpha = .82;
    ctx.drawImage(state.image, 0, 0, state.image.naturalWidth, state.image.naturalHeight, gridX, gridY, gridWidth, gridHeight);
    ctx.restore();
  }
  const symbolMap = new Map(state.used.map(p => [p.hex.toUpperCase(), p.symbol]));
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    const p = state.cells[y * state.cols + x], px = gridX + x * cell, py = gridY + y * cell;
    if (p) {
      ctx.save(); ctx.globalAlpha = referenceVisible ? .52 : 1; ctx.fillStyle = p.hex;
      ctx.fillRect(px + .3, py + .3, cell - .6, cell - .6);
      ctx.restore();
      if (ui.showSymbols.checked || exportMode) {
        const code = symbolMap.get(p.hex.toUpperCase());
        const symbolSize = Math.max(5, Math.min(cell * .38, (cell - 2) / Math.max(1, code.length * .56)));
        ctx.fillStyle = luminance(p.rgb) > 155 ? '#292723' : '#fff'; ctx.font = `700 ${symbolSize}px Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(symbolMap.get(p.hex.toUpperCase()), px + cell / 2, py + cell / 2 + .5);
      }
    }
  }

  drawGridAndCoordinates(ctx, { cell, gridX, gridY, gridWidth, gridHeight, coordinateBand, exportMode });

  if (exportMode) {
    ctx.fillStyle = '#242321'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 22px Arial, sans-serif'; ctx.fillText('豆格 · MARD 拼豆图纸', outerPadding, 32);
    ctx.font = '700 34px "Microsoft YaHei", Arial, sans-serif'; ctx.fillText(state.fileName.replace(/\.[^.]+$/, ''), outerPadding, 76);
    ctx.textAlign = 'right'; ctx.font = '700 21px Arial, sans-serif';
    ctx.fillText(`${state.cols} × ${state.rows} / ${state.used.length} 色 / 共 ${total} 颗`, target.width - outerPadding, 73);
    drawExportLegend(ctx, gridY + gridHeight + coordinateBand + outerPadding, outerPadding, target.width - outerPadding * 2, legendColumns);
  }
  updateDetails();
}

function drawGridAndCoordinates(ctx, layout) {
  const { cell, gridX, gridY, gridWidth, gridHeight, coordinateBand, exportMode } = layout;
  ctx.save();
  if (ui.showGrid.checked || exportMode) {
    ctx.beginPath();
    for (let x = 0; x <= state.cols; x++) { const px = gridX + x * cell; ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight); }
    for (let y = 0; y <= state.rows; y++) { const py = gridY + y * cell; ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py); }
    ctx.strokeStyle = exportMode ? 'rgba(45,43,40,.32)' : 'rgba(45,43,40,.24)'; ctx.lineWidth = exportMode ? .8 : .55; ctx.setLineDash([]); ctx.stroke();
  }

  const interval = parseInt(ui.majorGridSize.value) || 5;
  ctx.beginPath();
  for (let x = 0; x <= state.cols; x += interval) { const px = gridX + x * cell; ctx.moveTo(px, gridY); ctx.lineTo(px, gridY + gridHeight); }
  if (state.cols % interval) { ctx.moveTo(gridX + gridWidth, gridY); ctx.lineTo(gridX + gridWidth, gridY + gridHeight); }
  for (let y = 0; y <= state.rows; y += interval) { const py = gridY + y * cell; ctx.moveTo(gridX, py); ctx.lineTo(gridX + gridWidth, py); }
  if (state.rows % interval) { ctx.moveTo(gridX, gridY + gridHeight); ctx.lineTo(gridX + gridWidth, gridY + gridHeight); }
  ctx.strokeStyle = '#e83f36'; ctx.lineWidth = exportMode ? 2 : 1.55;
  ctx.setLineDash(ui.majorGridStyle.value === 'dashed' ? (exportMode ? [7, 4] : [4, 2]) : []); ctx.stroke(); ctx.setLineDash([]);

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
  ctx.fillStyle = '#77716a'; ctx.font = '14px Arial, sans-serif'; ctx.fillText(`MARD 221 · ${state.used.length} 种颜色`, left + 104, top + 34);
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
  ui.paletteList.innerHTML = emptyCard + state.used.map(p => `<div class="swatch${state.selectedColor && colorKey(state.selectedColor) === colorKey(p) ? ' active' : ''}"><button class="swatch-select" data-color="${p.hex}" title="选择 ${p.code} 进行手绘"><span class="swatch-color" style="background:${p.hex};--text-color:${luminance(p.rgb) > 155 ? '#332f29' : '#fff'}">${p.symbol}</span><span><b>${p.name}</b><small>${p.code} · ${p.hex}</small></span><strong>${p.count}</strong></button><button class="swatch-replace" data-replace="${p.hex}" title="替换全部 ${p.code}" aria-label="替换全部 ${p.code}">⇄</button></div>`).join('');
}

function updatePaintUI() {
  ui.paintToggle.classList.toggle('active', state.paintMode); ui.canvas.classList.toggle('painting', state.paintMode);
  ui.referenceToggle.classList.toggle('active', state.showReference); ui.referenceToggle.setAttribute('aria-pressed', String(state.showReference));
  ui.referenceToggle.querySelector('b').textContent = state.showReference ? '隐藏原图' : '显示原图';
  ui.eraserButton.disabled = !state.paintMode; ui.pickerButton.disabled = !state.paintMode; ui.mardColor.disabled = !state.paintMode; ui.customColor.disabled = !state.paintMode; ui.undoButton.disabled = !state.history.length;
  const eraserActive = Boolean(state.selectedColor && state.selectedColor.isEmpty);
  ui.eraserButton.classList.toggle('active', eraserActive); ui.eraserButton.setAttribute('aria-pressed', String(eraserActive));
  ui.eraserButton.innerHTML = eraserActive ? '<span>⌫</span> 退出橡皮' : '<span>⌫</span> 留空 / 橡皮';
  ui.pickerButton.classList.toggle('active', state.pickerMode);
  if (state.selectedColor && MARD_COLORS.some(color => color.code === state.selectedColor.code)) ui.mardColor.value = state.selectedColor.code;
  const selected = state.selectedColor ? (state.selectedColor.isEmpty ? '无豆 / 留空' : `${state.selectedColor.hex} · ${state.selectedColor.name}`) : '未选择颜色';
  const edited = state.manualOverrides.size ? ` · 已保留 ${state.manualOverrides.size} 格手绘` : '';
  const replaced = state.colorReplacements.size ? ` · ${state.colorReplacements.size} 条整色替换` : '';
  ui.paintStatus.textContent = state.pickerMode ? '请在图纸上吸取颜色' : state.paintMode ? `方格画笔：${selected}${edited}${replaced}` : `方格图纸 · 预览模式${edited}${replaced}`;
}

function colorAtPointer(event) {
  const rect = ui.canvas.getBoundingClientRect(), scaleX = ui.canvas.width / rect.width, scaleY = ui.canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX, canvasY = (event.clientY - rect.top) * scaleY;
  const x = Math.floor((canvasX - state.gridOriginX) / state.cellSize), y = Math.floor((canvasY - state.gridOriginY) / state.cellSize);
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return -1;
  return y * state.cols + x;
}
function paintAt(event) {
  const index = colorAtPointer(event); if (index < 0 || index === state.lastPaintIndex || !state.selectedColor) return;
  state.manualOverrides.set(index, state.selectedColor);
  state.cells[index] = renderableCell(state.selectedColor); state.lastPaintIndex = index; render();
}
function beginPaint(event) {
  if (!state.paintMode) return;
  event.preventDefault(); const index = colorAtPointer(event); if (index < 0) return;
  if (state.pickerMode) {
    selectPaintColor(state.cells[index] || EMPTY_COLOR);
    state.pickerMode = false; updatePaintUI(); updateDetails(); return;
  }
  pushHistory();
  state.drawing = true; state.lastPaintIndex = -1; ui.canvas.setPointerCapture?.(event.pointerId); paintAt(event); updatePaintUI();
}
function endPaint() { state.drawing = false; state.lastPaintIndex = -1; updatePaintUI(); }

function mardOptionsHtml() {
  const groups = new Map();
  for (const color of MARD_COLORS) {
    const group = color.code.charAt(0); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(color);
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
  const closest = MARD_COLORS[nearestIndex(source.rgb, MARD_COLORS.map(color => color.rgb))];
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
function loadImage(src, name, meta = '示例图片') {
  const img = new Image(); img.onload = () => {
    closeReplaceModal();
    state.baseCells = []; state.cells = []; state.manualOverrides = new Map(); state.colorReplacements = new Map(); state.history = [];
    state.selectedColor = null; state.lastPaintColor = null;
    state.image = img; state.fileName = name; ui.sourceThumb.src = src; ui.fileName.textContent = name;
    ui.fileMeta.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${meta}`;
    ui.dropZone.hidden = true; ui.fileCard.hidden = false; ui.empty.hidden = true; ui.scroll.hidden = false; ui.palette.hidden = false;
    el('projectTitle').textContent = name.replace(/\.[^.]+$/, ''); processImage();
  }; img.src = src;
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
  closeReplaceModal();
  state.image = null; state.baseCells = []; state.cells = []; state.manualOverrides = new Map(); state.colorReplacements = new Map(); state.history = [];
  state.paintMode = false; state.showReference = false; state.selectedColor = null; state.lastPaintColor = null; ui.fileInput.value = '';
  ui.dropZone.hidden = false; ui.fileCard.hidden = true; ui.empty.hidden = false; ui.scroll.hidden = true; ui.palette.hidden = true;
  el('projectTitle').textContent = '等待你的作品'; el('sizeStat').textContent = '—'; el('beadStat').textContent = '0'; el('colorStat').textContent = '0';
}
function showToast(msg) { const t = el('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove('show'), 2200); }
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }

ui.fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach(n => ui.dropZone.addEventListener(n, e => { e.preventDefault(); ui.dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(n => ui.dropZone.addEventListener(n, e => { e.preventDefault(); ui.dropZone.classList.remove('dragging'); }));
ui.dropZone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0])); el('removeImage').addEventListener('click', reset); el('useDemo').addEventListener('click', createDemo);
[ui.width, ui.height].forEach(input => input.addEventListener('change', () => { document.querySelectorAll('.preset-row button').forEach(b => b.classList.remove('active')); processImage(); }));
document.querySelectorAll('.preset-row button').forEach(btn => btn.addEventListener('click', () => {
  const [cols, rows] = btn.dataset.size.split('x'); ui.width.value = cols; ui.height.value = rows;
  document.querySelectorAll('.preset-row button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); processImage();
}));
ui.colors.addEventListener('change', processImage);
ui.colors.addEventListener('keydown', event => { if (event.key === 'Enter') ui.colors.blur(); });
[ui.showGrid, ui.showSymbols].forEach(x => x.addEventListener('change', () => state.image && render())); ui.removeWhite.addEventListener('change', processImage);
[ui.majorGridSize, ui.majorGridStyle].forEach(control => control.addEventListener('change', () => state.image && render()));
ui.paintToggle.addEventListener('click', () => { state.paintMode = !state.paintMode; state.pickerMode = false; updatePaintUI(); });
ui.eraserButton.addEventListener('click', toggleEraser);
ui.referenceToggle.addEventListener('click', () => { state.showReference = !state.showReference; render(); updatePaintUI(); });
ui.pickerButton.addEventListener('click', () => { state.pickerMode = !state.pickerMode; updatePaintUI(); });
ui.customColor.addEventListener('input', () => {
  const hex = ui.customColor.value.toUpperCase(), rgb = hexToRgb(hex);
  selectPaintColor({ code: `X${String(state.customIndex++).padStart(2, '0')}`, name: '自定义色', hex, rgb });
  state.pickerMode = false; updatePaintUI(); updateDetails();
});
ui.mardColor.addEventListener('change', () => {
  const chosen = MARD_COLORS.find(color => color.code === ui.mardColor.value);
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
  const hex = swatch.dataset.color.toUpperCase(), chosen = state.used.find(p => p.hex.toUpperCase() === hex);
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
  state.manualOverrides = new Map(previous.manualOverrides); state.colorReplacements = new Map(previous.colorReplacements);
  applyColorLayers(); render(); updatePaintUI();
});
ui.canvas.addEventListener('pointerdown', beginPaint); ui.canvas.addEventListener('pointermove', e => { if (state.drawing) { e.preventDefault(); paintAt(e); } });
ui.canvas.addEventListener('pointerup', endPaint); ui.canvas.addEventListener('pointercancel', endPaint); ui.canvas.addEventListener('pointerleave', e => { if (e.buttons === 0) endPaint(); });
el('exportPng').addEventListener('click', () => { if (!state.image) return showToast('请先选择一张图片'); const c = document.createElement('canvas'); render(c, true); download(c.toDataURL('image/png'), `${state.fileName.replace(/\.[^.]+$/, '')}-拼豆图纸.png`); showToast('高清图纸已生成'); });
el('exportCsv').addEventListener('click', () => {
  if (!state.image) return showToast('请先选择一张图片'); recalculateUsed();
  const rows = ['色号,颜色名称,HEX,数量', ...state.used.map(p => `${p.code},${p.name},${p.hex},${p.count}`), `,总计,,${state.used.reduce((n, p) => n + p.count, 0)}`];
  const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }); download(URL.createObjectURL(blob), `${state.fileName.replace(/\.[^.]+$/, '')}-用量清单.csv`); showToast('用量清单已导出');
});

ui.mardColor.innerHTML = MARD_COLORS.map(color => `<option value="${color.code}">${color.code} · ${color.hex}</option>`).join('');
ui.replaceColorSelect.innerHTML = mardOptionsHtml();
updatePaintUI();

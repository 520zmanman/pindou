// Isolated editor logic tests: no account, draft database, payment, or user data access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { value: '', checked: false, hidden: true, style: {}, classList: { toggle() {}, add() {}, remove() {} } });
  return elements.get(id);
};
const sandbox = vm.createContext({
  window: { location: { search: '' } }, document: { getElementById: element }, URLSearchParams,
  requestAnimationFrame: () => 1, console, performance,
});
vm.runInContext(fs.readFileSync(path.join(root, 'mard-palette.js'), 'utf8'), sandbox);
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf("ui.fileInput.addEventListener('change'")), sandbox);
vm.runInContext(source.slice(source.indexOf('function validPatternGrid('),source.indexOf('window.PindouGalleryBridge')),sandbox);
vm.runInContext(`
  const realDrawGrid = drawGridAndCoordinates;
  const realDrawPreview = drawGesturePreview;
  render = () => {}; renderLayers = () => {}; updatePaintUI = () => {}; updateDetails = () => {}; showToast = () => {};
  colorAtPointer = event => event.index ?? -1;
  function setup(cols=8,rows=8) {
    state.cols=cols; state.rows=rows; state.baseCells=Array(cols*rows).fill(MARD_COLORS[0]);
    state.manualOverrides=new Map(); state.colorReplacements=new Map(); state.history=[]; state.redoHistory=[];
    state.selection=null; state.selectionClipboard=null; state.drawing=false; state.paintMode=true;
    state.selectedColor=MARD_COLORS[1]; state.tool='brush'; state.lastPaintIndex=-1;
    state.layers=[];state.activeLayerId=null;state.baseVisible=true;state.paletteCodes=null;
    state.gestureStartIndex=-1; state.gestureEndIndex=-1; state.panStart=null; applyColorLayers();
  }
  function event(index) { return {index,button:0,pointerId:1,preventDefault(){}}; }
  function undo() { const value=state.history.pop(); if(value){ state.redoHistory.push(historySnapshot()); restoreHistorySnapshot(value); } }
  function redo() { const value=state.redoHistory.pop(); if(value){ state.history.push(historySnapshot()); restoreHistorySnapshot(value); } }
`, sandbox);
function check(name, code) {
  assert.equal(vm.runInContext(`{ ${code} }`, sandbox), true, name);
  console.log('PASS', name);
}
check('fast brush movement fills intermediate cells', `setup(); beginPaint(event(0)); movePaint(event(7)); endPaint(event(7)); state.manualOverrides.size===8`);
check('undo and redo restore stroke', `undo(); const cleared=state.manualOverrides.size===0; redo(); cleared && state.manualOverrides.size===8`);
check('new edit clears redo history', `undo(); beginPaint(event(8)); endPaint(event(8)); state.redoHistory.length===0`);
check('rectangle fills border and interior', `setup(); state.tool='rect'; beginPaint(event(9)); movePaint(event(27)); endPaint(event(27)); state.manualOverrides.size===9 && state.manualOverrides.has(18)`);
check('release outside canvas commits last valid endpoint', `setup(); state.tool='line'; beginPaint(event(0)); movePaint(event(7)); endPaint(event(-1)); state.manualOverrides.size===8`);
check('selection does not paint and commits outside canvas', `setup(); state.tool='select'; beginPaint(event(9)); movePaint(event(27)); endPaint(event(-1)); state.manualOverrides.size===0 && state.selection.right===3 && state.selection.bottom===3`);
check('selection copy and paste', `copySelection(); state.selection={left:5,right:5,top:5,bottom:5}; pasteSelection(); state.manualOverrides.size===9 && state.selection.right===7`);
check('selection cut and undo', `setup(); state.selection={left:1,right:2,top:1,bottom:2}; copySelection(true); const cut=state.cells[9]===null && state.selectionClipboard.cells.length===4; undo(); cut && state.cells[9]!==null`);
check('selection delete and cancel', `applySelectionColor(EMPTY_COLOR); const deleted=state.cells[9]===null; cancelSelection(); deleted && state.selection===null`);
check('paste clips safely at canvas edge', `setup(); state.selection={left:0,right:2,top:0,bottom:2}; copySelection(); state.selection={left:7,right:7,top:7,bottom:7}; pasteSelection(); state.manualOverrides.size===1 && state.cells.length===64`);
check('all palette entries are MARD and categorized', `MARD_COLORS.length===291 && MARD_COLORS.every(c=>c.name.startsWith('MARD ')) && mardOptionsHtml().includes('B 系列')`);
check('line preview includes guide and endpoints', `setup(); state.tool='line'; state.gestureStartIndex=0; state.gestureEndIndex=7; const calls=[]; const ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true}); realDrawPreview(ctx,{cell:10,gridX:0,gridY:0,renderScale:1}); calls.some(c=>c[0]==='lineTo') && calls.filter(c=>c[0]==='arc').length===2`);
check('preview and PDF both honor disabled fine grid', `setup(); ui.showGrid.checked=false; ui.majorGridStyle.value='solid'; const strokes=[]; const ctx=new Proxy({}, {get:(o,key)=> typeof o[key]!=='undefined'?o[key]:(...args)=>{if(key==='stroke')strokes.push(o.strokeStyle)},set:(o,k,v)=>(o[k]=v,true)}); realDrawGrid(ctx,{cell:10,gridX:0,gridY:0,gridWidth:80,gridHeight:80,coordinateBand:18,exportMode:true,renderScale:1}); !strokes.includes(state.exportSettings.minorColor)`);
check('600x600 flood fill stays within bounds', `setup(600,600); floodFill(0,MARD_COLORS[1]); state.manualOverrides.size===360000 && state.cells.length===360000`);
const start = performance.now();
check('600x600 clustering maps all cells to MARD', `const samples=Array.from({length:360000},(_,i)=>[(i*17)%256,(i*31)%256,(i*47)%256]); const result=clusterColors(samples,128); result.assignments.length===360000 && result.colors.every(c=>c.name.startsWith('MARD ')) && result.assignments.every(n=>n>=0 && n<result.colors.length)`);
console.log('Clustering synthetic 600x600:', Math.round(performance.now()-start), 'ms (logic only, not browser rendering)');
check('legacy draft migrates into one layer', `setup();state.manualOverrides.set(0,MARD_COLORS[2]);restoreLayers({});state.layers.length===1&&state.manualOverrides===state.layers[0].cells&&state.manualOverrides.get(0).code===MARD_COLORS[2].code`);
check('visible layers compose in order', `setup();restoreLayers({});const bottom=state.layers[0];bottom.cells.set(0,MARD_COLORS[1]);state.layers.push({id:'top',visible:true,locked:false,cells:new Map([[0,MARD_COLORS[2]]])});applyColorLayers();state.cells[0].code===MARD_COLORS[2].code`);
check('hidden layer reveals lower layer', `state.layers[1].visible=false;applyColorLayers();state.cells[0].code===MARD_COLORS[1].code`);
check('locked layer blocks paint', `state.activeLayerId=state.layers[0].id;bindActiveLayer();state.layers[0].locked=true;setCellOverride(1,MARD_COLORS[3]);!state.manualOverrides.has(1)`);
check('undo restores layer structure', `state.layers[0].locked=false;pushHistory();state.layers.pop();undo();state.layers.length===2`);
check('palette import normalizes A01 and ZG codes', `const config=validatePaletteConfig({brand:'MARD',codes:['A01','ZG01'],inventory:{A01:42}});config.codes.join(',')==='A1,ZG1'&&config.inventory.A1===42`);
check('palette import rejects unknown codes', `let rejected=false;try{validatePaletteConfig({brand:'MARD',codes:['INVALID']})}catch{rejected=true}rejected`);
check('selected palette limits generated codes', `setup();state.paletteCodes=new Set(['A1','H7']);const result=clusterColors([[0,0,0],[255,255,255],[123,24,56]],3);result.colors.every(c=>state.paletteCodes.has(c.code))`);
console.log('All editor regression tests passed.');
check('grid interval preserves zero and one', `gridInterval('0')===0&&gridInterval('1')===1&&gridInterval('25')===20&&gridIntervalLabel(0)==='无粗线'&&gridIntervalLabel(1)==='每格粗线'`);
check('zero interval draws no coarse strokes, one draws every edge', `setup();ui.showGrid.checked=false;const paths=[];const ctx=new Proxy({}, {get:(o,key)=>o[key]??((...args)=>{if(key==='stroke')paths.push(o.strokeStyle)}),set:(o,k,v)=>(o[k]=v,true)});const layout={cell:10,gridX:0,gridY:0,gridWidth:80,gridHeight:80,coordinateBand:18,exportMode:false,renderScale:1};state.exportSettings.interval=0;realDrawGrid(ctx,layout);const noCoarse=!paths.includes(state.exportSettings.majorColor);state.exportSettings.interval=1;realDrawGrid(ctx,layout);noCoarse&&paths.includes(state.exportSettings.majorColor)`);
check('crop rectangle clamps to original image bounds', `const r=sourceRectangle({naturalWidth:100,naturalHeight:80},{x:95,y:-5,width:999,height:20});r.x===95&&r.y===0&&r.width===5&&r.height===20`);
check('source reset selects entire original', `const r=sourceRectangle({naturalWidth:120,naturalHeight:90});r.x===0&&r.y===0&&r.width===120&&r.height===90`);
check('cartoon uses dominant pixels while realistic averages pixels', `
  const pixels=new Uint8ClampedArray([255,0,0,255,255,0,0,255,0,0,255,255]);
  document.createElement=()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:pixels})})});
  const img={naturalWidth:3,naturalHeight:1},real=averageOriginalRegions(img,1,1)[0],cartoon=averageOriginalRegions(img,1,1,true)[0];
  real[0]===170&&real[2]===85&&cartoon[0]===255&&cartoon[2]===0
`);
check('transparent sticker pixels leave lower layers intact', `
  setup();const pixels=new Uint8ClampedArray([0,0,0,255,255,0,0,0]);
  document.createElement=()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:pixels})})});
  const cells=stickerLayerCells({naturalWidth:2,naturalHeight:1},2,1,1,1,8,8);
  cells.size===1&&cells.has(9)&&!cells.has(10)&&cells.get(9).name.startsWith('MARD ')
`);
check('color merge strength changes generated palette', `
  setup();const samples=[[120,120,120],[130,130,130],[140,140,140],[150,150,150],[160,160,160],[170,170,170]];
  state.mergeStrength=0;const low=clusterColors(samples,6);state.mergeStrength=100;const high=clusterColors(samples,6);state.mergeStrength=35;
  low.colors.length>high.colors.length&&high.assignments.length===samples.length
`);
check('new processing settings restore from drafts', `
  setup();applyDraftState({settings:{cols:8,rows:8,processingMode:'cartoon',mergeStrength:73},layers:[]});
  state.processingMode==='cartoon'&&state.mergeStrength===73&&document.getElementById('processingMode').value==='cartoon'
`);
console.log('All 31 editor regression tests passed.');
check('sticker dragging keeps whole sticker inside board', `const b=fitStickerBox(598,-20,32,16,600,600);b.x===568&&b.y===0&&b.width===32&&b.height===16`);
check('sticker aspect resize fits portrait within board', `const b=fitStickerBox(0,0,32,32,80,40,.25);b.width===10&&b.height===40&&b.y===0`);
check('sticker free resize and invalid dimensions remain safe', `const b=fitStickerBox(NaN,NaN,0,-4,80,40);b.width===1&&b.height===1&&b.x===0&&b.y===0`);
console.log('All 34 editor regression tests passed.');
check('four preset shapes have filled centers and transparent corners', `['heart','star','circle','diamond'].every(shape=>presetShapeContains(shape,.5,.5)&&!presetShapeContains(shape,0,0))`);
check('hollow sticker preserves empty center', `!presetShapePixel('circle','outline',15,15,32)&&presetShapePixel('circle','solid',15,15,32)`);
check('striped sticker has both filled and empty interior pixels', `const values=[];for(let y=8;y<24;y++)for(let x=8;x<24;x++)values.push(presetShapePixel('circle','stripe',x,y,32));values.some(Boolean)&&values.some(v=>!v)`);
check('layer movement preserves color and count', `setup();const c=new Map([[9,MARD_COLORS[0]],[10,MARD_COLORS[1]]]),next=shiftedLayerCells(c,2,1,8,8);next.size===2&&next.get(19)===MARD_COLORS[0]&&next.get(20)===MARD_COLORS[1]&&c.has(9)`);
check('out of bounds movement stops at edge without deleting pixels', `shiftedLayerCells(new Map([[0,MARD_COLORS[0]]]),-1,0,8,8).has(0)`);
console.log('All 39 editor regression tests passed.');
check('layer enlargement preserves a solid square', `const cells=new Map([[9,MARD_COLORS[0]],[10,MARD_COLORS[0]],[17,MARD_COLORS[0]],[18,MARD_COLORS[0]]]);const result=scaledLayerCells(cells,1.25,8,8);result.size===9&&cells.size===4`);
check('scaling too large refuses safely', `const cells=new Map([[0,MARD_COLORS[0]],[63,MARD_COLORS[1]]]);scaledLayerCells(cells,1.25,8,8)===null`);
check('shrink keeps colors and bounded indices', `const cells=new Map(Array.from({length:16},(_,i)=>[i%4+Math.floor(i/4)*8,MARD_COLORS[0]]));const result=scaledLayerCells(cells,.8,8,8);result.size===9&&[...result.keys()].every(i=>i>=0&&i<64)`);
check('600x600 layer scale avoids argument overflow', `const cells=new Map(Array.from({length:360000},(_,i)=>[i,MARD_COLORS[0]]));scaledLayerCells(cells,.8,600,600).size===230400`);
console.log('All 43 editor regression tests passed.');
check('oversized movement travels remaining distance', `const c=new Map([[4*8+3,MARD_COLORS[0]]]);shiftedLayerCells(c,0,-6,8,8).has(3)`);
check('one percent shrink can be restored from original', `const original=new Map(Array.from({length:64},(_,i)=>[i,MARD_COLORS[0]]));scaleLayerPercent(original,1,8,8).size===1&&scaleLayerPercent(original,100,8,8).size===64`);
check('large scale stays bounded by board memory', `const c=new Map([[27,MARD_COLORS[0]]]);scaleLayerPercent(c,1000000,8,8).size===64`);
check('scale baseline persists through draft restore', `setup();restoreLayers({layers:[{id:'a',cells:[[9,serializeColor(MARD_COLORS[0])]],scaleSource:[[9,serializeColor(MARD_COLORS[1])]],scalePercent:1}]});state.layers[0].scaleSource.get(9).code===MARD_COLORS[1].code&&state.layers[0].scalePercent===1`);
console.log('All 47 editor regression tests passed.');
check('repeated enlargement retains original center marker', `const original=new Map();for(let y=10;y<15;y++)for(let x=10;x<15;x++)original.set(y*80+x,x===12&&y===12?MARD_COLORS[1]:MARD_COLORS[0]);const a=scaleLayerPercent(original,400,80,80),b=scaleLayerPercent(original,800,80,80);a.get(12*80+12)===MARD_COLORS[1]&&b.get(12*80+12)===MARD_COLORS[1]`);
check('returning to 100 percent recovers source exactly', `const original=new Map([[19,MARD_COLORS[0]],[20,MARD_COLORS[1]],[27,MARD_COLORS[2]]]);const restored=scaleLayerPercent(original,100,8,8);restored.size===3&&[...original].every(([i,c])=>restored.get(i)===c)`);
check('scale percentage is capped at 5000', `const original=new Map([[9,MARD_COLORS[0]]]);JSON.stringify([...scaleLayerPercent(original,100000,8,8)])===JSON.stringify([...scaleLayerPercent(original,5000,8,8)])`);
check('scale slider range is fixed after synchronization', `syncLayerScaleControls(400);const max=document.getElementById('layerScaleRange').max;syncLayerScaleControls(800);max==='5000'&&document.getElementById('layerScaleRange').max==='5000'`);
assert.doesNotMatch(source.slice(source.indexOf('function layerAction('),source.indexOf('function restorePaletteConfig(')), /\b(?:prompt|confirm)\(/);
console.log('PASS rename and destructive layer actions avoid native browser dialogs');
console.log('All 52 editor regression tests passed.');
check('clipped enlargement survives movement then shrinking', `
const source=new Map();for(let y=4;y<7;y++)for(let x=0;x<3;x++)source.set(y*12+x,MARD_COLORS[x]);
const layer={scaleSource:source,scalePercent:400,cells:scaleLayerPercent(source,400,12,12)};
const moved=translatedLayerTransform(layer,2,0,12,12);const restored=scaleLayerPercent(moved.scaleSource,100,12,12,moved.scaleOffset);
restored.size===source.size&&restored.get(4*12+2)===MARD_COLORS[0]&&moved.scaleSource===source
`);
check('fully clipped color is recoverable after repeated scaling', `const original=new Map([[0,MARD_COLORS[0]],[1,MARD_COLORS[1]],[2,MARD_COLORS[2]]]);const huge=scaleLayerPercent(original,5000,8,8);const restored=scaleLayerPercent(original,100,8,8);huge.size<=64&&restored.size===3&&restored.get(0)===MARD_COLORS[0]`);
check('saved scale offsets retain invisible source content', `setup();const original=[[0,serializeColor(MARD_COLORS[0])],[1,serializeColor(MARD_COLORS[1])]];restoreLayers({layers:[{id:'offset',cells:[],scaleSource:original,scalePercent:500,scaleOffset:{x:2,y:0}}]});const l=state.layers[0],restored=scaleLayerPercent(l.scaleSource,100,8,8,l.scaleOffset);restored.get(2)===MARD_COLORS[0]&&l.scaleOffset.x===2`);
const stickerOpenCode=source.slice(source.indexOf("el('addSticker').onclick="),source.indexOf("el('stickerUpload').onclick="));
assert.doesNotMatch(stickerOpenCode,/makePreset\(/);
assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'),/id="usePresetSticker"/);
console.log('PASS sticker dialog opens without default preset and removes redundant action');
console.log('All 56 editor regression tests passed.');
check('sticker visual palette includes all available colors', `state.paletteCodes=null;filterStickerColors().length===291`);
check('sticker palette filters exact series and normalized code', `filterStickerColors('MARD ZG01','ZG').some(c=>c.code==='ZG1')&&filterStickerColors('','A').every(c=>/^A[0-9]+$/.test(c.code))`);
check('sticker palette honors enabled codes and no-result search', `state.paletteCodes=new Set(['A1','H7']);const ok=filterStickerColors().length===2&&filterStickerColors('not-a-color').length===0;state.paletteCodes=null;ok`);
console.log('All 59 editor regression tests passed.');
check('CSV export preserves selected colors and stock counts', `const csv=paletteConfigCsv({codes:new Set(['A1','H7']),inventory:{A1:123,H7:0}});const parsed=parsePaletteFile(csv);parsed.codes.length===2&&parsed.codes.includes('H7')&&parsed.inventory.A1===123&&parsed.inventory.H7===0`);
check('CSV export includes all 291 MARD colors', `paletteConfigCsv({codes:new Set(),inventory:{}}).split(String.fromCharCode(10)).length===292`);
check('legacy JSON palette files still import', `parsePaletteFile(JSON.stringify({brand:'MARD',codes:['A01'],inventory:{A01:10}})).codes[0]==='A1'`);
check('CSV rejects unknown color and invalid stock', `let failures=0;for(const row of ['MARD,ZZ999,#FFFFFF,1,1','MARD,A1,#FAF4C8,1,-1','MARD,A1,#FAF4C8,1,99999999']){try{parsePaletteFile('品牌,色号,HEX,启用,库存数量'+String.fromCharCode(10)+row);}catch{failures++;}}failures===3`);
check('CSV rejects duplicated records', `let rejected=false;try{parsePaletteFile('品牌,色号,HEX,启用,库存数量'+String.fromCharCode(10)+'MARD,A1,#FAF4C8,1,2'+String.fromCharCode(10)+'MARD,A1,#FAF4C8,1,3');}catch{rejected=true;}rejected`);
console.log('All 64 editor regression tests passed.');
check('small canvas leaves toolbar in normal flow', `!toolbarNeedsDock(280,120,819,68)`);
check('large canvas docks toolbar for page scrolling', `toolbarNeedsDock(900,120,819,68)`);
check('toolbar docking adapts to short viewports', `toolbarNeedsDock(280,120,450,68)`);
console.log('All 67 editor regression tests passed.');

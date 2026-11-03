'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../gallery.js'),'utf8');
const mode={value:'free',closest:()=>mode.label,label:{}},price={closest:()=>price.label,label:{}},visibility={value:'published'};
const heading={},submit={},form={querySelector:selector=>selector==='h3'?heading:submit};const nodes={galleryDownloadMode:mode,galleryPrice:price,galleryVisibility:visibility,galleryPublishForm:form};
const ctx=vm.createContext({get:id=>nodes[id]});vm.runInContext(source.slice(source.indexOf('  function syncPriceField()'),source.indexOf('  function form(')),ctx);
function sync(){vm.runInContext('syncPriceField()',ctx);}
sync();assert(!mode.label.hidden&&price.label.hidden&&price.disabled&&!price.required);
mode.value='points';sync();assert(!price.label.hidden&&price.required&&!price.disabled);
visibility.value='hidden';sync();assert(mode.label.hidden&&mode.disabled&&price.label.hidden&&price.disabled&&!price.required);assert.equal(heading.textContent,'确认作品与分享设置');
visibility.value='published';sync();assert(!mode.label.hidden&&!mode.disabled&&!price.label.hidden&&price.required);
mode.value='view';sync();assert(!mode.label.hidden&&price.label.hidden&&!price.required);
assert.equal(heading.textContent,'确认作品与分享设置');
assert(source.includes("actions.append(button('预览画面'"));
assert(source.includes("if(w.downloadMode!=='view'||(mine&&w.canEdit))"));
assert(!source.includes("button('下载 PDF'"));
assert(source.includes('if(mine&&w.canEdit)'));assert(source.includes('if(mine&&w.canDelete)'));
console.log('PASS gallery form: private visibility hides and disables download options; returning to public restores correct price validation');

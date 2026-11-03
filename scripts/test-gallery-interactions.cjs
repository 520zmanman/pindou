'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../gallery.js'),'utf8');
const nodes=new Map(),filters=['all','free','points','view'].map(value=>({dataset:{galleryFilter:value},classList:{toggle(_,selected){this.active=selected;}},setAttribute(){}}));
const get=id=>{if(!nodes.has(id))nodes.set(id,{childElementCount:0,classList:{toggle(_,value){this.active=value;}},setAttribute(){},click(){}});return nodes.get(id);};
let resolve,reject;
const ctx=vm.createContext({get,document:{querySelectorAll:()=>filters},api:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})});
vm.runInContext("let mine=false,likedOnly=false,filter='all';const pendingLikes=new Map();const message=()=>{};"+source.slice(source.indexOf('  function syncNavigation('),source.indexOf('  function policy(')),ctx);
(async()=>{
 vm.runInContext('syncNavigation()',ctx);assert(filters[0].classList.active);assert(!get('galleryMine').classList.active);
 const work={id:'test',liked:false,likeCount:0},like={setAttribute(){}};let removed=false;const card={remove(){removed=true;}};
 ctx.work=work;ctx.like=like;ctx.card=card;
 const first=vm.runInContext('toggleLike(work,like,card)',ctx);assert.equal(like.textContent,'♥ 1','count updates before response');resolve({liked:true,likeCount:1});await first;
 vm.runInContext('likedOnly=true',ctx);const second=vm.runInContext('toggleLike(work,like,card)',ctx);assert.equal(like.textContent,'♡ 0');resolve({liked:false,likeCount:0});await second;assert(removed);
 const failed=vm.runInContext('toggleLike(work,like,card)',ctx);reject(new Error('network'));await assert.rejects(failed);assert.equal(like.textContent,'♡ 0','failed requests roll back');
 console.log('PASS gallery interactions: default selection, immediate like count, unlike removes liked item, failure rollback');
})().catch(error=>{console.error(error);process.exitCode=1;});

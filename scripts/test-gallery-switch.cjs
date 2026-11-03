'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../gallery.js'),'utf8');
const nodes=new Map(),pending=[];const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,childElementCount:0,classList:{toggle(){}},replaceChildren(){},querySelector(){return null;}});return nodes.get(id);};
const ctx=vm.createContext({AbortController,setTimeout,clearTimeout,get,syncNavigation(){},document:{querySelectorAll:()=>[]},console,pending,api:(url,options)=>new Promise(resolve=>pending.push({url,signal:options.signal,resolve}))});
vm.runInContext(`let mine=false,likedOnly=false,filter='all',offset=0,loading=false,listController=null,listVersion=0;const pendingLikes=new Map();let lastMessage='';const message=text=>lastMessage=text;`+source.slice(source.indexOf('  async function list('),source.indexOf('  async function open(')),ctx);
(async()=>{
 const first=vm.runInContext('list()',ctx);vm.runInContext("filter='free'",ctx);const second=vm.runInContext('list()',ctx);
 assert(pending[0].signal.aborted);assert(pending[1].url.includes('filter=free'));
 pending[1].resolve({items:[],nextOffset:null});await second;pending[0].resolve({items:[{invalid:true}],nextOffset:null});await first;
 assert.equal(vm.runInContext('lastMessage',ctx),'暂时没有符合条件的公开作品');assert.equal(vm.runInContext('loading',ctx),false);
 let finishLike;ctx.likeTask=new Promise(resolve=>{finishLike=resolve;});vm.runInContext("pendingLikes.set('work',likeTask)",ctx);
 const waiting=vm.runInContext('list()',ctx);assert.equal(pending.length,2,'category waits for pending like before fetching');
 vm.runInContext('pendingLikes.clear()',ctx);finishLike();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pending.length,3);pending[2].resolve({items:[],nextOffset:null});await waiting;
 assert(!/\bconfirm\(/.test(source),'gallery uses custom centered confirmation dialogs');
 console.log('PASS rapid category changes cancel old request, ignore stale response, keep latest state; no native gallery confirmations');
})().catch(e=>{console.error(e);process.exitCode=1;});

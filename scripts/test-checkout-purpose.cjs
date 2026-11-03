'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../account.js'),'utf8'),nodes={checkoutPurpose:{},checkoutEyebrow:{}};
const ctx=vm.createContext({document:{getElementById:id=>nodes[id]}});
vm.runInContext(source.slice(source.indexOf('  function syncCheckoutPurpose('),source.indexOf('  function confirmReplaceOrder(')),ctx);
vm.runInContext('syncCheckoutPurpose(true)',ctx);assert.equal(nodes.checkoutPurpose.textContent,'本次充值');assert.equal(nodes.checkoutEyebrow.textContent,'账户充值');
vm.runInContext('syncCheckoutPurpose(false)',ctx);assert.equal(nodes.checkoutPurpose.textContent,'本次下载');assert.equal(nodes.checkoutEyebrow.textContent,'下载结算');
assert(source.includes("syncCheckoutPurpose(kind==='recharge')"));assert(source.includes('syncCheckoutPurpose(true)'));assert(source.includes('syncCheckoutPurpose(false)'));
console.log('PASS checkout labels: recharge setup/payment and returning to download use correct purpose');

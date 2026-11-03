'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');
for(const id of ['accountName','accountBinding','accountBalance','accountPoints','openRecharge','bindDestination','bindCode','sendBindCode','verifyBindCode','securityQuestionSelect','securityQuestionAnswer','securityQuestionPassword','saveSecurityQuestion','logoutButton','loginForm','registerForm']){
 assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} remains unique and available to account logic`);
}
assert(html.includes('账号将用于三天云缓存、账户余额、付费 PDF 下载和画廊及积分。'));
assert(html.includes('每笔付费PDF订单将兑换10积分。'));
assert(!html.includes('充值不赠送'));
assert(html.includes('class="account-identity"'));assert(html.includes('class="account-assets"'));
assert(css.includes('#authMember[hidden]{display:none}'));
console.log('PASS account layout: preserved control IDs, updated copy, separate identity/assets, hidden state preserved');

'use strict';
// Integer hundredths: never use floating point arithmetic for account transfers.
function createPointsStore(db){
  db.exec(`CREATE TABLE IF NOT EXISTS point_wallets(user_id INTEGER PRIMARY KEY,units INTEGER NOT NULL DEFAULT 0 CHECK(units>=0));
    CREATE TABLE IF NOT EXISTS point_ledger(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,delta INTEGER NOT NULL,reference TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,reference,kind));
    CREATE TABLE IF NOT EXISTS point_platform_fees(reference TEXT PRIMARY KEY,units INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
  function balance(id){return Number(db.prepare('SELECT units FROM point_wallets WHERE user_id=?').get(id)?.units||0);}
  function change(id,delta,reference,kind){
    db.prepare('INSERT OR IGNORE INTO point_wallets(user_id) VALUES(?)').run(id);
    const entry=db.prepare('INSERT OR IGNORE INTO point_ledger(user_id,delta,reference,kind,created_at) VALUES(?,?,?,?,?)').run(id,delta,reference,kind,Date.now());
    if(!entry.changes)return false;
    const result=db.prepare('UPDATE point_wallets SET units=units+? WHERE user_id=? AND units+?>=0').run(delta,id,delta);
    if(!result.changes)throw Object.assign(new Error('积分不足，请先付费下载 PDF 获取积分'),{statusCode:409});
    return true;
  }
  return {balance,change,reward(id,orderId){return change(id,1000,orderId,'paid_pdf_reward');}};
}
module.exports={createPointsStore};

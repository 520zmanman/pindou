'use strict';
const crypto=require('node:crypto');
function validPattern(pattern) {
  if(!pattern || !Number.isInteger(pattern.cols)||pattern.cols<8||pattern.cols>600 || !Number.isInteger(pattern.rows)||pattern.rows<8||pattern.rows>600)return false;
  if(!Array.isArray(pattern.colors)||pattern.colors.length>1000||!pattern.colors.every(c=>c&&typeof c.code==='string'&&/^[A-Z]{1,3}\d{1,6}$/.test(c.code)&&typeof c.name==='string'&&c.name.length<=80&&/^#[0-9a-f]{6}$/i.test(c.hex)&&Array.isArray(c.rgb)&&c.rgb.length===3&&c.rgb.every(n=>Number.isFinite(n)&&n>=0&&n<=255)))return false;
  return Array.isArray(pattern.indices)&&pattern.indices.length===pattern.cols*pattern.rows&&pattern.indices.every(i=>Number.isInteger(i)&&i>=-1&&i<pattern.colors.length);
}
function preview(pattern) {
  const cols=Math.min(64,pattern.cols),rows=Math.min(64,pattern.rows),indices=[];
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)indices.push(pattern.indices[Math.min(pattern.rows-1,Math.floor(y*pattern.rows/rows))*pattern.cols+Math.min(pattern.cols-1,Math.floor(x*pattern.cols/cols))]);
  return {cols,rows,colors:pattern.colors.map(c=>({hex:c.hex})),indices};
}
function createGalleryHandler({db,currentUser,respondJson,readJson,allowAttempt}) {
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_works (
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, pattern TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS gallery_works_created ON gallery_works(status,created_at DESC);`);
  return async function handle(req,res,pathname,params) {
    const user=currentUser(req),mine=params.get('mine')==='1',id=pathname.split('/')[3];
    if(req.method==='GET'&&!id){
      if(mine&&!user)return respondJson(req,res,401,{error:'登录后查看我的作品'});
      const offset=Math.min(10000,Math.max(0,parseInt(params.get('offset'))||0));
      const rows=mine?db.prepare('SELECT g.*,u.username FROM gallery_works g JOIN users u ON u.id=g.user_id WHERE g.user_id=? ORDER BY g.created_at DESC,g.id LIMIT 25 OFFSET ?').all(user.id,offset):db.prepare("SELECT g.*,u.username FROM gallery_works g JOIN users u ON u.id=g.user_id WHERE g.status='published' ORDER BY g.created_at DESC,g.id LIMIT 25 OFFSET ?").all(offset);
      const items=rows.slice(0,24).map(row=>{const pattern=JSON.parse(row.pattern);return {id:row.id,title:row.title,author:row.username,status:row.status,cols:pattern.cols,rows:pattern.rows,createdAt:row.created_at,canDelete:!!user&&(row.user_id===user.id||user.role==='superuser'),preview:preview(pattern)};});
      return respondJson(req,res,200,{items,nextOffset:rows.length>24?offset+24:null});
    }
    if(req.method==='GET'&&id){
      if(!user)return respondJson(req,res,401,{error:'请登录后打开画廊图纸'});
      const row=db.prepare('SELECT * FROM gallery_works WHERE id=?').get(id);
      if(!row || (row.status!=='published'&&row.user_id!==user.id&&user.role!=='superuser'))return respondJson(req,res,404,{error:'作品不存在或已下架'});
      return respondJson(req,res,200,{work:{id:row.id,title:row.title,pattern:JSON.parse(row.pattern)}});
    }
    if(req.method==='POST'&&!id){
      if(!user)return respondJson(req,res,401,{error:'请登录后分享作品'});
      if(!allowAttempt(req,`gallery-publish-${user.id}`,10,3600000))return respondJson(req,res,429,{error:'分享过于频繁，请稍后再试'});
      const body=await readJson(req,3*1024*1024),title=String(body.title||'').normalize('NFKC').trim();
      if(!title||title.length>80||body.rightsConfirmed!==true||!validPattern(body.pattern))return respondJson(req,res,400,{error:'请填写作品名称、确认分享权限并提交有效图纸'});
      if(db.prepare('SELECT COUNT(*) AS total FROM gallery_works WHERE user_id=?').get(user.id).total>=20)return respondJson(req,res,409,{error:'每个账号最多分享20件作品，请先删除不需要的作品'});
      const pattern=JSON.stringify({cols:body.pattern.cols,rows:body.pattern.rows,colors:body.pattern.colors.map(c=>({code:c.code,name:c.code.startsWith('X')?'自定义色':`MARD ${c.code}`,hex:c.hex.toUpperCase(),rgb:c.rgb})),indices:body.pattern.indices});
      const workId=crypto.randomUUID(),now=Date.now();db.prepare('INSERT INTO gallery_works (id,user_id,title,pattern,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(workId,user.id,title,pattern,now,now);
      return respondJson(req,res,201,{id:workId});
    }
    if((req.method==='DELETE'||req.method==='PATCH')&&id){
      if(!user)return respondJson(req,res,401,{error:'请先登录'});
      const row=db.prepare('SELECT user_id FROM gallery_works WHERE id=?').get(id);
      if(!row)return respondJson(req,res,404,{error:'作品不存在'});
      if(row.user_id!==user.id&&user.role!=='superuser')return respondJson(req,res,403,{error:'无权修改该作品'});
      if(req.method==='DELETE')db.prepare('DELETE FROM gallery_works WHERE id=?').run(id);
      else{const body=await readJson(req);if(!['published','hidden'].includes(body.status))return respondJson(req,res,400,{error:'状态不正确'});db.prepare('UPDATE gallery_works SET status=?,updated_at=? WHERE id=?').run(body.status,Date.now(),id);}
      return respondJson(req,res,200,{saved:true});
    }
    return respondJson(req,res,405,{error:'不支持的操作'});
  };
}
module.exports={createGalleryHandler,validPattern,preview};

'use strict';
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const unpack=value=>JSON.parse(typeof value==='string'?value:zlib.inflateSync(value).toString());
function validPattern(pattern) {
  if(!pattern || !Number.isInteger(pattern.cols)||pattern.cols<8||pattern.cols>600 || !Number.isInteger(pattern.rows)||pattern.rows<8||pattern.rows>600)return false;
  if(!Array.isArray(pattern.colors)||pattern.colors.length>1000||!pattern.colors.every(c=>c&&typeof c.code==='string'&&/^[A-Z]{1,3}\d{1,6}$/.test(c.code)&&typeof c.name==='string'&&c.name.length<=80&&/^#[0-9a-f]{6}$/i.test(c.hex)&&Array.isArray(c.rgb)&&c.rgb.length===3&&c.rgb.every(n=>Number.isFinite(n)&&n>=0&&n<=255)))return false;
  return Array.isArray(pattern.indices)&&pattern.indices.length===pattern.cols*pattern.rows&&pattern.indices.every(i=>Number.isInteger(i)&&i>=-1&&i<pattern.colors.length);
}
function preview(pattern) {
  const scale=Math.min(1,256/Math.max(pattern.cols,pattern.rows)),cols=Math.max(1,Math.round(pattern.cols*scale)),rows=Math.max(1,Math.round(pattern.rows*scale)),rgba=Buffer.alloc(cols*rows*4);
  const rgb=pattern.colors.map(c=>[1,3,5].map(i=>parseInt(c.hex.slice(i,i+2),16)));
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const left=x*pattern.cols/cols,right=(x+1)*pattern.cols/cols,top=y*pattern.rows/rows,bottom=(y+1)*pattern.rows/rows;
    let weight=0,r=0,g=0,b=0;
    for(let sy=Math.floor(top);sy<Math.ceil(bottom);sy++)for(let sx=Math.floor(left);sx<Math.ceil(right);sx++){
      const color=rgb[pattern.indices[sy*pattern.cols+sx]];if(!color)continue;
      const w=(Math.min(sx+1,right)-Math.max(sx,left))*(Math.min(sy+1,bottom)-Math.max(sy,top));
      r+=color[0]*w;g+=color[1]*w;b+=color[2]*w;weight+=w;
    }
    const i=(y*cols+x)*4;if(weight){rgba[i]=Math.round(r/weight);rgba[i+1]=Math.round(g/weight);rgba[i+2]=Math.round(b/weight);rgba[i+3]=Math.round(255*weight/((right-left)*(bottom-top)));}
  }
  return {version:2,cols,rows,rgba:rgba.toString('base64')};
}
function createGalleryHandler({db,currentUser,respondJson,readJson,allowAttempt,points=require('./points-store.js').createPointsStore(db)}) {
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_works (
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, pattern TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS gallery_works_created ON gallery_works(status,created_at DESC);`);
  const columns=new Set(db.prepare('PRAGMA table_info(gallery_works)').all().map(c=>c.name));
  for(const [name,type] of [['download_mode',"TEXT NOT NULL DEFAULT 'free'"],['price_points','INTEGER NOT NULL DEFAULT 1'],['expires_at','INTEGER'],['metadata','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE gallery_works ADD COLUMN ${name} ${type}`);
  for(const row of db.prepare("SELECT id,pattern FROM gallery_works WHERE metadata IS NULL OR json_extract(metadata,'$.preview.version') IS NOT 2").all()){const p=unpack(row.pattern);db.prepare('UPDATE gallery_works SET pattern=?,metadata=? WHERE id=?').run(zlib.deflateSync(Buffer.from(JSON.stringify(p))),JSON.stringify({cols:p.cols,rows:p.rows,preview:preview(p)}),row.id);}
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_claims(user_id INTEGER NOT NULL,request_id TEXT NOT NULL,work_id TEXT NOT NULL,pattern BLOB NOT NULL,title TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(user_id,request_id));
  CREATE TABLE IF NOT EXISTS gallery_likes(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,work_id TEXT NOT NULL REFERENCES gallery_works(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,work_id));
  CREATE INDEX IF NOT EXISTS gallery_likes_work ON gallery_likes(work_id);
  CREATE INDEX IF NOT EXISTS gallery_expiry ON gallery_works(status,expires_at);`);
  function options(body){
    const mode=body.downloadMode||'free',price=Number(body.pricePoints??1);
    if(!['free','points','view'].includes(mode)||!Number.isInteger(price)||price<1||price>100000)throw Object.assign(new Error('积分价格须为 1–100000 的整数'),{statusCode:400});
    return {mode,price};
  }
  function cleanup(){db.prepare("DELETE FROM gallery_works WHERE status='hidden' AND expires_at<=?").run(Date.now());db.prepare('DELETE FROM gallery_claims WHERE expires_at<=?').run(Date.now());}
  db.prepare("UPDATE gallery_works SET expires_at=updated_at+? WHERE status='hidden' AND expires_at IS NULL").run(3*86400000);
  cleanup();const timer=setInterval(cleanup,60000);timer.unref();
  return async function handle(req,res,pathname,params) {
    cleanup();
    const user=currentUser(req),mine=params.get('mine')==='1',liked=params.get('liked')==='1',id=pathname.split('/')[3];
    if(req.method==='GET'&&!id){
      if(mine&&!user)return respondJson(req,res,401,{error:'登录后查看我的作品'});
      if(liked&&!user)return respondJson(req,res,401,{error:'登录后查看点赞过的作品'});
      const offset=Math.min(10000,Math.max(0,parseInt(params.get('offset'))||0));
      const filter=params.get('filter')||'all';
      const rows=db.prepare(`SELECT g.id,g.user_id,g.title,g.status,g.download_mode,g.price_points,g.expires_at,g.metadata,g.created_at,u.username,
        (SELECT COUNT(*) FROM gallery_likes l WHERE l.work_id=g.id) AS like_count,
        EXISTS(SELECT 1 FROM gallery_likes l WHERE l.work_id=g.id AND l.user_id=?) AS liked
        FROM gallery_works g JOIN users u ON u.id=g.user_id
        WHERE ((?=1 AND g.user_id=?) OR (?=0 AND g.status='published'))
        AND (?=1 OR ?='all' OR g.download_mode=?)
        AND (?=0 OR EXISTS(SELECT 1 FROM gallery_likes l WHERE l.work_id=g.id AND l.user_id=?))
        ORDER BY like_count DESC,g.created_at DESC,g.id LIMIT 25 OFFSET ?`).all(user?.id||0,mine?1:0,user?.id||0,mine?1:0,mine?1:0,filter,filter,liked?1:0,user?.id||0,offset);
      const items=rows.slice(0,24).map(row=>{const meta=JSON.parse(row.metadata);return {id:row.id,title:row.title,author:row.username,status:row.status,downloadMode:row.download_mode,pricePoints:row.price_points,expiresAt:row.expires_at,cols:meta.cols,rows:meta.rows,createdAt:row.created_at,canEdit:!!user&&row.user_id===user.id,canDelete:!!user&&(row.user_id===user.id||user.role==='superuser'),preview:meta.preview};});
      items.forEach((item,i)=>{item.likeCount=Number(rows[i].like_count);item.liked=!!rows[i].liked;});
      return respondJson(req,res,200,{items,nextOffset:rows.length>24?offset+24:null,capabilities:{likes:true}});
    }
    if(req.method==='POST'&&id&&pathname.endsWith('/like')){
      if(!user)return respondJson(req,res,401,{error:'请先登录后点赞'});
      if(!allowAttempt(req,`gallery-like-${user.id}`,60,60000))return respondJson(req,res,429,{error:'操作过于频繁，请稍后再试'});
      const work=db.prepare('SELECT status FROM gallery_works WHERE id=?').get(id);
      if(!work||work.status!=='published')return respondJson(req,res,404,{error:'作品未公开或已删除'});
      const body=await readJson(req);if(typeof body.liked!=='boolean')return respondJson(req,res,400,{error:'点赞状态无效'});
      if(body.liked)db.prepare('INSERT OR IGNORE INTO gallery_likes VALUES(?,?,?)').run(user.id,id,Date.now());
      else db.prepare('DELETE FROM gallery_likes WHERE user_id=? AND work_id=?').run(user.id,id);
      return respondJson(req,res,200,{liked:body.liked,likeCount:Number(db.prepare('SELECT COUNT(*) AS n FROM gallery_likes WHERE work_id=?').get(id).n)});
    }
    if(req.method==='GET'&&id){
      if(!user)return respondJson(req,res,401,{error:'请登录后打开画廊图纸'});
      const row=db.prepare('SELECT * FROM gallery_works WHERE id=?').get(id);
      if(!row || (row.status!=='published'&&row.user_id!==user.id&&user.role!=='superuser'))return respondJson(req,res,404,{error:'作品不存在或已下架'});
      return respondJson(req,res,403,{error:'请使用积分下载或打开图纸'});
    }
    if(req.method==='POST'&&id&&pathname.endsWith('/download')){
      if(!user)return respondJson(req,res,401,{error:'游客可浏览作品，登录后才能使用积分下载'});
      if(!allowAttempt(req,`gallery-download-${user.id}`,30,60000))return respondJson(req,res,429,{error:'下载操作过于频繁，请稍后再试'});
      const body=await readJson(req),requestId=String(body.requestId||'');
      if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))return respondJson(req,res,400,{error:'下载请求标识无效'});
      let work;
      db.exec('BEGIN IMMEDIATE');
      try{
        const previous=db.prepare('SELECT * FROM gallery_claims WHERE user_id=? AND request_id=?').get(user.id,requestId);
        if(previous){if(previous.work_id!==id)throw new Error('下载请求标识冲突');work={id,title:previous.title,pattern:JSON.parse(require('node:zlib').inflateSync(previous.pattern).toString())};}
        else {
          const row=db.prepare('SELECT * FROM gallery_works WHERE id=?').get(id);
          if(!row||(row.status!=='published'&&row.user_id!==user.id))throw Object.assign(new Error('作品不存在或已下架'),{statusCode:404});
          const own=row.user_id===user.id;
          if(row.download_mode==='view'&&!own)throw Object.assign(new Error('作者仅允许浏览，不开放下载'),{statusCode:403});
          const cost=own||row.download_mode!=='points'?100:row.price_points*100;
          points.change(user.id,-cost,requestId,'gallery_download');
          if(!own&&row.download_mode==='points')points.change(row.user_id,cost-Math.ceil(cost/100),`${user.id}:${requestId}`,'gallery_income');
          db.prepare('INSERT INTO point_platform_fees VALUES(?,?,?)').run(`${user.id}:${requestId}`,!own&&row.download_mode==='points'?Math.ceil(cost/100):cost,Date.now());
          work={id,title:row.title,pattern:unpack(row.pattern)};
          db.prepare('INSERT INTO gallery_claims VALUES(?,?,?,?,?,?)').run(user.id,requestId,id,zlib.deflateSync(Buffer.from(JSON.stringify(work.pattern))),row.title,Date.now()+120000);
        }
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');return respondJson(req,res,error.statusCode||409,{error:error.message});}
      return respondJson(req,res,200,{work,points:points.balance(user.id)/100});
    }
    if(req.method==='POST'&&!id){
      if(!user)return respondJson(req,res,401,{error:'请登录后分享作品'});
      if(!allowAttempt(req,`gallery-publish-${user.id}`,10,3600000))return respondJson(req,res,429,{error:'分享过于频繁，请稍后再试'});
      const body=await readJson(req,3*1024*1024),title=String(body.title||'').normalize('NFKC').trim();
      const config=options(body);
      if(!title||title.length>80||body.rightsConfirmed!==true||!validPattern(body.pattern))return respondJson(req,res,400,{error:'请填写作品名称、确认分享权限并提交有效图纸'});
      if(db.prepare('SELECT COUNT(*) AS total FROM gallery_works WHERE user_id=?').get(user.id).total>=20)return respondJson(req,res,409,{error:'每个账号最多分享20件作品，请先删除不需要的作品'});
      const pattern=JSON.stringify({cols:body.pattern.cols,rows:body.pattern.rows,colors:body.pattern.colors.map(c=>({code:c.code,name:c.code.startsWith('X')?'自定义色':`MARD ${c.code}`,hex:c.hex.toUpperCase(),rgb:c.rgb})),indices:body.pattern.indices});
      if(body.status&&!['published','hidden'].includes(body.status))return respondJson(req,res,400,{error:'状态不正确'});
      const workId=crypto.randomUUID(),now=Date.now();db.prepare('INSERT INTO gallery_works (id,user_id,title,pattern,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(workId,user.id,title,zlib.deflateSync(Buffer.from(pattern)),JSON.stringify({cols:body.pattern.cols,rows:body.pattern.rows,preview:preview(body.pattern)}),now,now);
      db.prepare('UPDATE gallery_works SET download_mode=?,price_points=?,status=?,expires_at=? WHERE id=?').run(config.mode,config.price,body.status||'published',body.status==='hidden'?now+3*86400000:null,workId);
      return respondJson(req,res,201,{id:workId});
    }
    if((req.method==='DELETE'||req.method==='PATCH')&&id){
      if(!user)return respondJson(req,res,401,{error:'请先登录'});
      const row=db.prepare('SELECT user_id FROM gallery_works WHERE id=?').get(id);
      if(!row)return respondJson(req,res,404,{error:'作品不存在'});
      if(row.user_id!==user.id&&user.role!=='superuser')return respondJson(req,res,403,{error:'无权修改该作品'});
      if(req.method==='DELETE')db.prepare('DELETE FROM gallery_works WHERE id=?').run(id);
      else{const body=await readJson(req);if(!['published','hidden'].includes(body.status))return respondJson(req,res,400,{error:'状态不正确'});const config=options(body);const title=String(body.title||'').normalize('NFKC').trim();if(title.length>80)return respondJson(req,res,400,{error:'作品名称过长'});db.prepare('UPDATE gallery_works SET title=CASE WHEN ?=\'\' THEN title ELSE ? END,status=?,download_mode=?,price_points=?,expires_at=?,updated_at=? WHERE id=?').run(title,title,body.status,config.mode,config.price,body.status==='hidden'?Date.now()+3*86400000:null,Date.now(),id);}
      return respondJson(req,res,200,{saved:true});
    }
    return respondJson(req,res,405,{error:'不支持的操作'});
  };
}
module.exports={createGalleryHandler,validPattern,preview};

const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createGalleryHandler,validPattern,preview}=require('../gallery-store.js');
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT); INSERT INTO users VALUES(1,\'test-author\'),(2,\'test-reader\');');
const handler=createGalleryHandler({db,currentUser:req=>req.user||null,respondJson:(_req,res,status,data)=>{res.status=status;res.data=data;},readJson:async req=>req.body,allowAttempt:()=>true});
const pattern={cols:8,rows:8,colors:[{code:'A1',name:'MARD A1',hex:'#FAF4C8',rgb:[250,244,200]}],indices:Array(64).fill(0)};
const author={id:1,role:'user'},reader={id:2,role:'user'};
async function request(method,id='',user=null,body={},query=''){const res={};await handler({method,user,body},res,'/api/gallery'+(id?'/'+id:''),new URLSearchParams(query));return res;}
(async()=>{
  assert(validPattern(pattern));assert(!validPattern({...pattern,indices:[999]}));assert(!validPattern({...pattern,colors:[{...pattern.colors[0],hex:'<script>'}]}));
  assert.equal((await request('POST','',null)).status,401);
  const created=await request('POST','',author,{title:'<b>test</b>',pattern,rightsConfirmed:true,imageSrc:'must-not-store'});assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await request('GET',id)).status,401);
  assert.equal((await request('GET','',null)).data.items.length,1);
  const opened=await request('GET',id,reader);assert.equal(opened.status,200);assert.equal(opened.data.work.imageSrc,undefined);assert.deepEqual(opened.data.work.pattern,pattern);
  assert.equal((await request('DELETE',id,reader)).status,403);
  assert.equal((await request('PATCH',id,reader,{status:'hidden'})).status,403);
  assert.equal((await request('PATCH',id,author,{status:'hidden'})).status,200);
  assert.equal((await request('GET','',null)).data.items.length,0);
  assert.equal((await request('GET',id,reader)).status,404);
  assert.equal((await request('GET','',author,{},'mine=1')).data.items.length,1);
  assert.equal((await request('GET',id,author)).status,200);
  assert(preview({...pattern,cols:600,rows:600,indices:Array(360000).fill(0)}).indices.length<=4096);
  assert.equal((await request('DELETE',id,author)).status,200);
  assert.equal((await request('GET',id,author)).status,404);db.close();
  console.log('PASS gallery validation, guest restrictions, publish/read, ownership, hide, delete and bounded preview (in-memory database only)');
})().catch(error=>{console.error(error);db.close();process.exitCode=1;});

'use strict';
(() => {
  const get=id=>document.getElementById(id),page=get('galleryModal');
  let mine=false,likedOnly=false,filter='all',offset=0,loading=false,pending=null,editing=null,listController=null,listVersion=0;
  const pendingLikes=new Map();
  const message=text=>{get('galleryStatus').textContent=text;};
  async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'请求失败'),{status:response.status});return data;}
  function close(){listController?.abort();listVersion++;page.hidden=true;document.body.classList.remove('gallery-page-open');history.replaceState(null,'',location.pathname+location.search);}
  function ask(text){
    return new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.className='gallery-confirm-dialog';
      const heading=document.createElement('h3');heading.textContent='请确认操作';const copy=document.createElement('p');copy.textContent=text;
      const actions=document.createElement('div');const finish=value=>{dialog.close();dialog.remove();resolve(value);};
      actions.append(button('取消',()=>finish(false)),button('确认',()=>finish(true)));dialog.append(heading,copy,actions);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});document.body.append(dialog);dialog.showModal();actions.firstChild.focus();
    });
  }
  function draw(canvas,p){canvas.width=p.cols;canvas.height=p.rows;const ctx=canvas.getContext('2d');ctx.fillStyle='#f2efe5';ctx.fillRect(0,0,canvas.width,canvas.height);if(p.rgba){const data=ctx.createImageData(p.cols,p.rows),raw=atob(p.rgba);for(let i=0;i<raw.length;i++)data.data[i]=raw.charCodeAt(i);ctx.putImageData(data,0,0);}else p.indices.forEach((v,i)=>{if(v>=0){ctx.fillStyle=p.colors[v].hex;ctx.fillRect(i%p.cols,Math.floor(i/p.cols),1,1);}});}
  function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){message(e.message);}finally{b.disabled=false;}};return b;}
  function previewWork(work){
    get('galleryPreviewTitle').textContent=work.title;
    draw(get('galleryPreviewCanvas'),work.preview);
    get('galleryPreviewDialog').showModal();
  }
  function showPoints(user){const box=get('galleryPoints');box.hidden=!user;if(user)box.textContent=`当前剩余积分：${Number(user.points||0).toFixed(2)}`;}
  async function points(){const data=await api('/api/auth/me');showPoints(data.user);if(data.user)window.dispatchEvent(new CustomEvent('pindou-points-updated',{detail:{userId:data.user.id,points:data.user.points}}));return data.user;}
  window.addEventListener('pindou-points-updated',event=>showPoints(event.detail));
  function syncNavigation(){
    for(const [id,selected] of [['galleryMine',mine],['galleryLiked',likedOnly]]){get(id).classList.toggle('active',selected);get(id).setAttribute('aria-pressed',String(selected));}
    document.querySelectorAll('[data-gallery-filter]').forEach(b=>{const selected=!mine&&!likedOnly&&b.dataset.galleryFilter===filter;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  }
  async function toggleLike(w,like,card){
    if(pendingLikes.has(w.id))return;
    const previous={liked:!!w.liked,likeCount:Number(w.likeCount)||0},wanted=!previous.liked;
    const render=()=>{like.textContent=`${w.liked?'♥':'♡'} ${w.likeCount}`;like.setAttribute('aria-pressed',String(w.liked));like.setAttribute('aria-label',w.liked?'取消点赞':'点赞作品');};
    w.liked=wanted;w.likeCount=Math.max(0,previous.likeCount+(wanted?1:-1));render();
    let finish;const settled=new Promise(resolve=>{finish=resolve;});pendingLikes.set(w.id,settled);
    try{
      const result=await api(`/api/gallery/${w.id}/like`,{method:'POST',body:JSON.stringify({liked:wanted})});
      if(typeof result.liked!=='boolean'||!Number.isInteger(result.likeCount))throw new Error('点赞服务尚未更新，请重启网站服务后重试');
      w.liked=result.liked;w.likeCount=result.likeCount;render();
      if(likedOnly&&!w.liked){card.remove();if(!get('galleryGrid').childElementCount)message('还没有点赞过的公开作品');}
    }catch(error){Object.assign(w,previous);render();if(error.status===401)get('accountButton').click();throw error;}
    finally{pendingLikes.delete(w.id);finish();}
  }
  function policy(w){return w.downloadMode==='points'?`${w.pricePoints} 积分` : w.downloadMode==='view'?'仅供浏览':'免费分享 · 1积分下载维护费';}
  async function acquire(w){
    if(!await points()){get('accountButton').click();throw new Error('请先登录账号');}
    const cost=w.canEdit?1:w.downloadMode==='points'?w.pricePoints:1;
    const explanation=w.canEdit&&w.downloadMode==='points'?`本作品原价为 ${w.pricePoints} 积分，但由于你是原作者，故只需要 1 积分下载维护费，不收取标价的 1% 费用。`:`打开编辑将扣除 ${cost} 积分。`;
    const draftWarning=window.PindouDraftBridge?.hasProject()?'请先将当前草稿上传分享，继续将代替当前画布草稿。\n\n':'';
    if(!await ask(`${draftWarning}${explanation}\nPDF 导出仍需另行付费。继续吗？`))return;
    const key=`douge-gallery-claim:${w.id}:edit`;
    let claim;try{claim=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
    if(!claim||claim.until<=Date.now())claim={id:crypto.randomUUID(),until:Date.now()+110000};
    sessionStorage.setItem(key,JSON.stringify(claim));
    const data=await api(`/api/gallery/${w.id}/download`,{method:'POST',body:JSON.stringify({requestId:claim.id})});
    window.PindouGalleryBridge.open(data.work);close();
    sessionStorage.removeItem(key);await points();message('操作完成');
  }
  function syncPriceField(){
    const privateWork=get('galleryVisibility').value==='hidden',mode=get('galleryDownloadMode');
    mode.closest('label').hidden=privateWork;mode.disabled=privateWork;
    const paid=!privateWork&&mode.value==='points',input=get('galleryPrice');
    input.closest('label').hidden=!paid;input.disabled=!paid;input.required=paid;
    get('galleryPublishForm').querySelector('h3').textContent='确认作品与分享设置';
    get('galleryPublishForm').querySelector('button[type="submit"]').textContent=privateWork?'保存到云端暂存':'确认保存并上传';
  }
  function form(work=null){
    editing=work;get('galleryPublishForm').hidden=false;
    get('galleryWorkTitle').value=work?.title||pending?.title||'';
    get('galleryDownloadMode').value=work?.downloadMode||'free';get('galleryPrice').value=work?.pricePoints||1;
    get('galleryVisibility').value=work?.status||'published';get('galleryRights').checked=!!work;
    syncPriceField();
    get('galleryPublishPreview').hidden=!!work;
    if(!work)draw(get('galleryPublishPreview'),pending.pattern);
    get('galleryPublishForm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function list(append=false){
    listController?.abort();const controller=new AbortController();listController=controller;const version=++listVersion;
    const timer=setTimeout(()=>controller.abort('timeout'),15000);
    loading=true;message('正在加载…');get('galleryPublishForm').hidden=true;
    syncNavigation();
    try{
      if(pendingLikes.size)await Promise.all([...pendingLikes.values()]);
      if(version!==listVersion)return;
      const data=await api(`/api/gallery?mine=${mine?1:0}&liked=${likedOnly?1:0}&filter=${filter}&offset=${append?offset:0}`,{signal:controller.signal,cache:'no-store'});
      if(version!==listVersion)return;
      if(pendingLikes.size){await Promise.all([...pendingLikes.values()]);if(version!==listVersion)return;return list(append);}
      if(!append)get('galleryGrid').replaceChildren();get('galleryGrid').querySelector('[data-more]')?.remove();
      if(likedOnly&&data.capabilities?.likes!==true)throw new Error('点赞列表服务尚未更新，请重启网站服务后重试');
      for(const w of data.items){
        const card=document.createElement('article');card.className='gallery-card';
        const canvas=document.createElement('canvas');draw(canvas,w.preview);
        const title=document.createElement('h3');title.textContent=w.title;
        const detail=document.createElement('p');detail.textContent=`${w.author} · ${w.cols} × ${w.rows}`;
        const badge=document.createElement('span');badge.className='gallery-policy';badge.textContent=w.status==='hidden'?'私有保存 · 三天到期自动删除':policy(w);
        const actions=document.createElement('div');actions.className='gallery-card-actions';
        if(w.status==='published'){
          const like=button(`${w.liked?'♥':'♡'} ${w.likeCount||0}`,()=>toggleLike(w,like,card));like.className='gallery-like';like.setAttribute('aria-label',w.liked?'取消点赞':'点赞作品');like.setAttribute('aria-pressed',String(!!w.liked));actions.append(like);
        }
        actions.append(button('预览画面',()=>previewWork(w)));
        if(w.downloadMode!=='view'||(mine&&w.canEdit))actions.append(button('打开编辑',()=>acquire(w)));
        if(mine&&w.canEdit)actions.append(button('管理作品',()=>form(w)));
        if(mine&&w.canDelete)actions.append(button('删除',async()=>{if(await ask('确定永久删除作品？此操作不可撤销。')){await api(`/api/gallery/${w.id}`,{method:'DELETE'});await list();}}));
        card.append(canvas,title,detail,badge,actions);get('galleryGrid').append(card);
      }
      offset=data.nextOffset;
      if(offset!==null){const more=button('加载更多',()=>list(true));more.dataset.more='1';get('galleryGrid').append(more);}
      message(get('galleryGrid').childElementCount?'':mine?'暂无作品，来分享第一件作品吧':likedOnly?'还没有点赞过的公开作品':'暂时没有符合条件的公开作品');
    }catch(e){if(version===listVersion)message(controller.signal.aborted?'加载超时，请重新选择分类重试':e.message==='Failed to fetch'?'加载失败，请确认网站服务已启动，然后重新选择分类。':e.message);}finally{clearTimeout(timer);if(version===listVersion)loading=false;}
  }
  async function open(){mine=false;likedOnly=false;filter='all';page.hidden=false;document.body.classList.add('gallery-page-open');history.replaceState(null,'','#gallery');syncNavigation();points().catch(()=>{get('galleryPoints').hidden=true;});await list();window.scrollTo(0,0);}
  get('galleryButton').onclick=open;get('galleryClose').onclick=close;
  get('galleryPreviewClose').onclick=()=>get('galleryPreviewDialog').close();
  get('galleryPreviewDialog').onclick=event=>{if(event.target===get('galleryPreviewDialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}};
  get('galleryMine').onclick=()=>{mine=true;likedOnly=false;list();};
  get('galleryLiked').onclick=()=>{mine=false;likedOnly=true;filter='all';list();};
  document.querySelectorAll('[data-gallery-filter]').forEach(b=>b.onclick=()=>{mine=false;likedOnly=false;filter=b.dataset.galleryFilter;list();});
  get('galleryPublish').onclick=async()=>{try{if(!await points()){get('accountButton').click();throw new Error('请先登录后分享作品');}pending=window.PindouGalleryBridge.current();if(!pending)throw new Error('请先制作图纸');form();message('请确认预览与分享规则后上传，不包含原始照片和隐藏图层。');}catch(e){message(e.message);}};
  get('galleryPublishCancel').onclick=()=>{get('galleryPublishForm').hidden=true;pending=null;editing=null;};
  get('galleryPublishForm').onsubmit=async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;try{
    const body={title:get('galleryWorkTitle').value,downloadMode:get('galleryDownloadMode').value,pricePoints:get('galleryDownloadMode').value==='points'?Number(get('galleryPrice').value):1,status:get('galleryVisibility').value,rightsConfirmed:get('galleryRights').checked};
    if(body.status==='hidden'){body.downloadMode='free';body.pricePoints=1;}
    if(editing)await api(`/api/gallery/${editing.id}`,{method:'PATCH',body:JSON.stringify(body)});
    else {if(!pending)throw new Error('请重新预览作品');await api('/api/gallery',{method:'POST',body:JSON.stringify({...body,pattern:pending.pattern})});}
    mine=true;likedOnly=false;await list();message('作品已保存');pending=null;editing=null;
  }catch(e){message(e.message);}finally{submit.disabled=false;}};
  get('galleryDownloadMode').onchange=syncPriceField;get('galleryVisibility').onchange=syncPriceField;syncPriceField();
  get('galleryDownloadMode').querySelector('[value="free"]').textContent='免费下载（但需下载时的维护费）';
  get('galleryPublishForm').querySelector('small').textContent='为了节省存储资源，仅自己可见的作品三天后自动删除；到期前可重新公开。';
  if(location.hash==='#gallery')open();
})();

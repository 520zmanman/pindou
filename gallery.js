'use strict';
(() => {
  const get=id=>document.getElementById(id),modal=get('galleryModal');let mine=false,offset=0,loading=false;
  const status=message=>{get('galleryStatus').textContent=message;};
  async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});const data=await response.json();if(!response.ok)throw new Error(data.error||'画廊请求失败');return data;}
  function close(){modal.hidden=true;get('galleryPublishForm').hidden=true;document.body.classList.remove('modal-open');}
  function drawPreview(canvas,pattern){const scale=3;canvas.width=pattern.cols*scale;canvas.height=pattern.rows*scale;const ctx=canvas.getContext('2d');ctx.fillStyle='#f5f1e7';ctx.fillRect(0,0,canvas.width,canvas.height);pattern.indices.forEach((value,i)=>{if(value<0)return;ctx.fillStyle=pattern.colors[value].hex;ctx.fillRect(i%pattern.cols*scale,Math.floor(i/pattern.cols)*scale,scale,scale);});}
  async function list(append=false){if(loading)return;loading=true;status('正在加载作品…');get('galleryPublishForm').hidden=true;
    try{const data=await api(`/api/gallery?mine=${mine?1:0}&offset=${append?offset:0}`);if(!append)get('galleryGrid').replaceChildren();get('galleryGrid').querySelector('[data-more]')?.remove();
      for(const work of data.items){const card=document.createElement('article');card.className='gallery-card';const canvas=document.createElement('canvas');drawPreview(canvas,work.preview);const title=document.createElement('h3');title.textContent=work.title;const detail=document.createElement('p');detail.textContent=`${work.author} · ${work.cols}×${work.rows}${work.status==='hidden'?' · 已隐藏':''}`;
        const open=document.createElement('button');open.type='button';open.textContent='打开图纸';open.onclick=async()=>{try{open.disabled=true;const data=await api(`/api/gallery/${encodeURIComponent(work.id)}`);if(window.PindouDraftBridge?.hasProject()&&!confirm('打开此作品会替换当前画布，请先保存需要保留的草稿。继续吗？'))return;window.PindouGalleryBridge.open(data.work);close();}catch(error){status(error.message);}finally{open.disabled=false;}};
        card.append(canvas,title,detail,open);
        if(work.canDelete){const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.onclick=async()=>{if(!confirm('确定删除这件画廊作品？此操作不可撤销。'))return;try{await api(`/api/gallery/${work.id}`,{method:'DELETE'});await list();}catch(error){status(error.message);}};card.append(remove);
          const visibility=document.createElement('button');visibility.type='button';visibility.textContent=work.status==='hidden'?'公开':'隐藏';visibility.onclick=async()=>{try{await api(`/api/gallery/${work.id}`,{method:'PATCH',body:JSON.stringify({status:work.status==='hidden'?'published':'hidden'})});await list();}catch(error){status(error.message);}};card.append(visibility);}
        get('galleryGrid').append(card);
      }offset=data.nextOffset;if(offset!==null){const more=document.createElement('button');more.dataset.more='1';more.textContent='加载更多';more.onclick=()=>list(true);get('galleryGrid').append(more);}status(data.items.length?'':'暂无作品，来分享第一件作品吧');
    }catch(error){status(error.message);}finally{loading=false;}}
  get('galleryButton').onclick=()=>{modal.hidden=false;document.body.classList.add('modal-open');list();};get('galleryClose').onclick=close;modal.onclick=event=>{if(event.target===modal)close();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)close();});
  get('galleryPublic').onclick=()=>{mine=false;list();};get('galleryMine').onclick=()=>{mine=true;list();};
  get('galleryPublish').onclick=async()=>{try{const data=await api('/api/auth/me');if(!data.user)throw new Error('请先登录后分享作品');const work=window.PindouGalleryBridge.current();if(!work)throw new Error('请先制作图纸');get('galleryWorkTitle').value=work.title.slice(0,80);get('galleryRights').checked=false;get('galleryPublishForm').hidden=false;status('仅分享合成后的图纸，不包含原始照片、隐藏图层及账号信息。');}catch(error){status(error.message);}};
  get('galleryPublishForm').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{const work=window.PindouGalleryBridge.current();if(!work)throw new Error('没有可分享的图纸');await api('/api/gallery',{method:'POST',body:JSON.stringify({title:get('galleryWorkTitle').value,pattern:work.pattern,rightsConfirmed:get('galleryRights').checked})});mine=true;await list();status('作品已分享');}catch(error){status(error.message);}finally{button.disabled=false;}};
})();

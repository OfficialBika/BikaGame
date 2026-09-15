(()=>{
  const tg=window.Telegram?.WebApp;
  const initData=tg?.initData||'';
  const api=async(path,body={})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify(body)}),d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.message||d.error||'Request failed');return d};
  const esc=v=>String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]));
  function renderHistory(){
    const page=document.getElementById('bikaNavPage'),content=document.getElementById('bnpContent');
    if(!page||!content)return;
    content.innerHTML='<div class="bnp-kicker">BIKA PAY</div><h2 class="bnp-heading">Transfer History</h2><div class="history-toolbar"><span class="wallet-label">RECENT TRANSFERS</span><button class="history-refresh" id="transferHistoryRefresh">REFRESH</button></div><div class="transfer-history" id="transferHistoryList"><div class="bnp-empty">Loading transfers…</div></div>';
    const list=document.getElementById('transferHistoryList');
    async function load(){try{const d=await api('/api/mini/wallet/transfers',{limit:100}),items=d.items||[];list.innerHTML=items.map(x=>{const sent=x.direction==='sent',amt=Number(x.amount||0),date=x.createdAt?new Date(x.createdAt).toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';return '<div class="transfer-history-row"><div class="transfer-history-icon '+(sent?'sent':'received')+'">'+(sent?'↑':'↓')+'</div><div class="transfer-history-main"><b>'+(sent?'Sent Balance':'Received Balance')+'</b><span>'+esc(date)+'</span><small>Wallet: '+esc(x.otherUserId||'—')+'</small></div><strong class="transfer-history-amount '+(sent?'sent':'received')+'">'+(sent?'-':'+')+amt.toLocaleString()+'</strong></div>'}).join('')||'<div class="bnp-empty">No transfer history yet.</div>'}catch(e){list.innerHTML='<div class="bnp-empty">Unable to load transfer history.</div>'}}
    document.getElementById('transferHistoryRefresh').onclick=load;load();
  }
  function addButton(id,host,smallText){
    if(document.getElementById(id)||!host)return;
    const btn=document.createElement('button');
    btn.id=id;btn.type='button';btn.className='wallet-history-btn';btn.innerHTML='<span>↕</span><div><b>Transfer History</b><small>'+smallText+'</small></div><strong>›</strong>';
    btn.addEventListener('click',renderHistory);
    host.parentNode.insertBefore(btn,host);
  }
  function install(){
    const page=document.getElementById('bikaNavPage'),content=document.getElementById('bnpContent');
    if(!page||!content)return;
    const title=String(document.getElementById('bnpTitle')?.textContent||'').trim().toLowerCase();
    if(title==='wallet'){
      const stats=content.querySelector('.bnp-stat-grid');
      if(stats)addButton('walletTransferHistory',stats,'View sent and received balance transfers');
    }else if(title==='transfer balance'){
      const status=content.querySelector('#transferStatus');
      const host=status||content.querySelector('.wallet-card');
      if(host)addButton('transferPageHistory',host,'Open your transfer records');
    }
  }
  const observer=new MutationObserver(install);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  [0,100,300,600,1200,2000,3500].forEach(ms=>setTimeout(install,ms));
})();
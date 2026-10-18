const GUARDIANS_URL = 'https://guardians.family/';
const ART = {
  moon: '/assets/art/moon-keeper.webp',
  glass: '/assets/art/glass-spirit.webp',
  sun: '/assets/art/sun-orbit.webp',
  frog: '/assets/art/frog-cosmos.webp',
  keepers: '/assets/art/moonbound-keepers.webp'
};
const pad = n => String(n).padStart(4, '0');
const favKey = id => pad(Number(id)||0);
// On-chain item ids are plain integers, preview tiles use padded edition numbers.
const sameId = (a,b) => String(a).trim()!=='' && Number(a)===Number(b);
const num = n => n.toLocaleString('en-US');

const state = {
  route:'explore', config:null, market:{collections:[],listings:[],ok:false}, wallet:null,
  balances:[], balanceWarning:'', portfolio:{collections:[],tokens:[]}, points:{total:0,events:[]},
  query:'', status:'all', sort:'ed', collectionSort:'ed', collectionTab:'items', facetFilters:{}, traits:null, traitsLoaded:false, unrevealedShown:24,
  collectionPath:null, nft:null, collectionItems:[], collectionOffset:0, collectionHasMore:false,
  activeCreateTab:'collection', favorites:new Set(JSON.parse(localStorage.getItem('morrow_favorites')||'[]')),
  busy:false, txHistory:[], localCollections:JSON.parse(localStorage.getItem('morrow_created_collections')||'[]'),
  itemMeta:null, itemId:null, itemPkg:null, activePortfolioTab:'nfts'
};

const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortAddr = a => a ? `${a.slice(0,7)}…${a.slice(-5)}` : '';
const displayGnot = ugnot => `${(Number(ugnot||0)/1_000_000).toLocaleString('en-US',{maximumFractionDigits:4})} GNOT`;
const imageSrc = url => {
  if (!url || typeof url !== 'string') return ART.moon;
  if (url.startsWith('ipfs://')) {
    const g = (state.config?.pinataGateway || 'https://ipfs.io/ipfs/').replace(/\/$/,'');
    return g + '/' + url.slice(7).replace(/^ipfs\//,'');
  }
  if (/^https:\/\//i.test(url) || url.startsWith('/assets/') || url.startsWith('/collection-assets/')) return url;
  return ART.moon;
};
const collectionLink = path => `https://gno.land/${String(path||'').replace(/^gno\.land\//,'')}`;
const metaUri = id => `/collection-assets/metadata/${pad(id)}.json`;
const imageUri = id => `/collection-assets/images/${pad(id)}.webp`;

function toast(message, type='ok', delay=4800) {
  const region = $('#toastRegion'); const el=document.createElement('div'); el.className=`toast ${type==='error'?'error':''}`;
  el.innerHTML=`<span class="toast-mark">${type==='error'?'!':'✓'}</span><span>${escapeHTML(message)}</span>`; region.append(el);
  setTimeout(()=>el.remove(),delay);
}
function setBusy(b) { state.busy=b; $$('button').forEach(button=>{ if(b){ if(button.dataset.morrowWasDisabled===undefined)button.dataset.morrowWasDisabled=button.disabled?'1':'0';button.disabled=true; } else if(button.dataset.morrowWasDisabled!==undefined){button.disabled=button.dataset.morrowWasDisabled==='1';delete button.dataset.morrowWasDisabled;} }); }
function statusLine(text, tone='neutral') {
  const node=$('#networkStatusText'); if(!node) return;
  node.textContent=text; const pulse=$('.status-pulse'); if(pulse) pulse.style.background=tone==='bad'?'#c37e69':tone==='good'?'#7da85d':'#b2bd6b';
}
function updateHeader() {
  const btn=$('#walletButtonText'); const walletButton=$('#walletButton');
  if(state.wallet){ btn.textContent=shortAddr(state.wallet.address); walletButton.title=state.wallet.address; walletButton.classList.add('connected'); }
  else {btn.textContent='Connect wallet';walletButton.title='Connect Adena wallet';walletButton.classList.remove('connected')}
  $$('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.route===state.route || (state.route==='collection'&&x.dataset.route==='collections') || (state.route==='item'&&x.dataset.route==='explore')));
}
async function bootstrap() {
  try { state.config=await api('/api/config'); }
  catch(e) { state.config={chainId:'gnoland-1',registryConfigured:false,bootstrapEnabled:false,tradingEnabled:false,transactionsEnabled:false,treasuryConfigured:false,pinningConfigured:false,collectionServiceFeeUgnot:2_000_000_000,marketplaceFeeBps:250,adminWallet:'',launchFeeGnot:2000,moonbound:{name:'Moonbound Keepers',symbol:'MBK',maxSupply:1111,mintPriceUgnot:575_000_000,mintEnabled:false,assetsConfigured:false,collectionPath:''},guardians:{url:GUARDIANS_URL,mintActive:false},points:{buy:10,list:5,mint:8,launch:15}}; toast('Marketplace settings are not reachable; read-only mode is active.','error'); }
  try { state.market=await api('/api/market'); } catch(e) {state.market={collections:[],listings:[],ok:false,error:e.message}}
  if(!state.market.collections)state.market.collections=[]; if(!state.market.listings)state.market.listings=[];
  if(sessionStorage.getItem('morrow_wallet')) {
    try { const saved=JSON.parse(sessionStorage.getItem('morrow_wallet')); if(saved?.address) {state.wallet=saved; await refreshWalletData();} } catch {sessionStorage.removeItem('morrow_wallet')}
  }
  render(); updateHeader();
  $('#networkHeight').textContent=state.config.latestHeight?`Block ${Number(state.config.latestHeight).toLocaleString('en-US')}`:'Live registry';
  if(state.config.rpcHealthy) statusLine(`Connected · ${state.config.chainId}`,'good');
  else statusLine(`Read-only view · ${state.config.chainId}`,'neutral');
  if(!state.config.transactionsEnabled) {
    const note = state.config.registryError || (state.config.registryConfigured ? 'Transactions paused by Morrow network configuration' : 'Setup required · registry not configured');
    $('#networkStatusText').textContent=note; statusLine(note,'bad');
  }
  const interval=setInterval(async()=>{ try{state.market=await api('/api/market'); if(['explore','collections','activity','collection','create','item'].includes(state.route))render();}catch{} },60_000);
  window.addEventListener('beforeunload',()=>clearInterval(interval),{once:true});
}
async function refreshWalletData() {
  if(!state.wallet?.address)return;
  const addr=state.wallet.address;
  const tasks=await Promise.allSettled([
    api(`/api/wallet/${encodeURIComponent(addr)}/balances`),
    api(`/api/portfolio/${encodeURIComponent(addr)}`),
    api(`/api/points/${encodeURIComponent(addr)}`)
  ]);
  if(tasks[0].status==='fulfilled'){state.balances=tasks[0].value.balances||[];state.balanceWarning=tasks[0].value.warning||''}
  if(tasks[1].status==='fulfilled')state.portfolio=tasks[1].value;
  if(tasks[2].status==='fulfilled')state.points=tasks[2].value;
  updateHeader();
}
function normalizeWalletChain(value){
 const v=String(value||'').trim().toLowerCase();
 if(['gnoland-1','mainnet','gno mainnet','gno-mainnet'].includes(v))return 'gnoland-1';
 if(['onyx-1','onyx','testnet','gno testnet','gno-testnet'].includes(v))return 'onyx-1';
 return v;
}
async function connectWallet() {
  if(state.wallet){openWalletModal();return}
  const adena=window.adena;
  if(!adena){modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Wallet connection</div><h2 class="detail-title">Adena is needed</h2><p class="detail-info">Morrow never asks for a seed phrase or private key. Install Adena from its official site, create or import a wallet there, then come back and connect it.</p><div class="detail-actions"><a class="btn btn-dark" href="https://adena.app/" target="_blank" rel="noreferrer">Get Adena ↗</a><button class="btn btn-outline" data-action="close-modal">Not now</button></div><p class="modal-note">Only approve transactions that clearly show the intended Gno.land realm, price, fee and destination.</p></div>`);return}
  try{
    let establish;
    if(typeof adena.AddEstablish==='function') establish=await adena.AddEstablish('Morrow NFT Marketplace');
    if(establish?.status==='failure'||establish?.code>0) throw new Error(establish.message||'Wallet connection was rejected.');
    const result=typeof adena.GetAccount==='function'?await adena.GetAccount():null;
    const data=result?.data||result?.account||result||{};
    const address=data.address||data.account?.address||data.account_address||result?.address;
    if(!address) throw new Error('Adena did not return a wallet address. Unlock Adena and try again.');
    state.wallet={address,network:null,connectedAt:Date.now()};
    try{if(typeof adena.GetNetwork==='function'){const n=await adena.GetNetwork();state.wallet.network=(n?.data||n)?.chainId||(n?.data||n)?.chain_id||''}}catch{}
    sessionStorage.setItem('morrow_wallet',JSON.stringify(state.wallet));
    await refreshWalletData(); render(); toast(`Connected ${shortAddr(address)}. Your keys stay in Adena.`);
  }catch(e){toast(e.message||'Wallet connection failed.','error')}
}
function disconnectWallet(){state.wallet=null;state.balances=[];state.portfolio={collections:[],tokens:[]};state.points={total:0,events:[]};sessionStorage.removeItem('morrow_wallet');updateHeader();render();toast('Wallet disconnected from this page. Adena remains in control of your keys.')}
async function sendTx(messages,memo='Morrow marketplace transaction',allowBootstrap=false) {
  if(!window.adena || !state.wallet?.address) throw new Error('Connect Adena before signing a transaction.');
  const enabled = allowBootstrap ? state.config?.bootstrapEnabled : state.config?.transactionsEnabled;
  if(!enabled) throw new Error('Transactions are paused. Check the registry, treasury address and explicit network-write setting in the server configuration.');
  const adena=window.adena;
  let activeChain='';
  if(typeof adena.GetNetwork==='function') {
    try {
      const response=await adena.GetNetwork();
      if(response?.status==='failure'||response?.code>0) throw new Error(response?.message||'Adena could not read the active network.');
      const data=response?.data||response||{};
      activeChain=normalizeWalletChain(data.chainId||data.chain_id||data.network?.chainId||data.network||data.name||'');
    } catch(e) {
      if(typeof adena.GetAccount!=='function') throw new Error(`Could not read Adena's active network (${e.message||'unknown error'}). No transaction was sent.`);
    }
  }
  if(!activeChain && typeof adena.GetAccount==='function') {
    try {
      const response=await adena.GetAccount();
      if(response?.status==='failure'||response?.code>0) throw new Error(response?.message||'Adena could not read the current account.');
      const data=response?.data||response?.account||response||{};
      if(data.address && String(data.address).toLowerCase()!==String(state.wallet.address).toLowerCase()) throw new Error('The active Adena account changed. Reconnect the intended wallet before signing.');
      activeChain=normalizeWalletChain(data.chainId||data.chain_id||'');
    } catch(e) { throw new Error(`Could not verify Adena's current account/network (${e.message||'unknown error'}). No transaction was sent.`); }
  }
  if(!activeChain) throw new Error('Adena did not identify its active chain. Update Adena or switch to a supported network; no transaction was sent.');
  if(activeChain!==state.config?.chainId) throw new Error(`Network mismatch: this Morrow server is configured for ${state.config?.chainId}, but Adena is on ${activeChain}. Switch networks before signing.`);
  state.wallet.network=activeChain;
  let response;
  try { response=await adena.DoContract({tx:{messages,memo},isNotification:true}); }
  catch(e) { throw new Error(`Adena did not submit the transaction: ${e?.message||e}. No success is assumed.`); }
  if(response?.status==='failure' || (typeof response?.code==='number'&&response.code!==0)) throw new Error(response.message||response.data?.message||'Adena rejected or failed the transaction.');
  const d=response?.data||response?.result||response||{};
  const hash=d.hash||d.txHash||d.tx_hash||d.deliverTx?.hash||d.checkTx?.hash;
  if(response?.status && response.status!=='success' && response.status!=='SUCCESS') throw new Error(response.message||'Transaction was not accepted by Adena.');
  return {hash:hash?String(hash):'',raw:response};
}
function transactionMessage(pkg,func,args=[],send=''){
 return {type:'/vm.m_call',value:{caller:state.wallet.address,send,pkg_path:pkg,func,args:args.map(String)}};
}
async function verifyPoints(hash) {
  if(!hash||!state.wallet?.address)return;
  await new Promise(r=>setTimeout(r,3500));
  for(let i=0;i<3;i++){
    try{
      const result=await api('/api/rewards/verify',{method:'POST',body:JSON.stringify({address:state.wallet.address,txHash:hash})});
      await refreshWalletData();render();
      if(result.awarded)toast(`+${result.awarded} Morrow points · ${result.label}`);
      return result;
    }catch(e){
      if(i===2){toast(`Transaction sent. Points will be available after confirmation; verify with hash ${hash.slice(0,12)}…`, 'ok',7500);return null;}
      await new Promise(r=>setTimeout(r,4500));
    }
  }
}
function modal(content){$('#modalHost').innerHTML=`<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true"> <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>${content}</section></div>`;document.body.style.overflow='hidden'}
function closeModal(){ $('#modalHost').innerHTML='';document.body.style.overflow=''; }

function artCard(nft, options={}){
  const favorite=state.favorites.has(favKey(nft.id));
  const real=!!nft.collectionPath&&!nft.preview;
  const badge=real?(nft.listed?'<span class="nft-tag live">LIVE LISTING</span>':'<span class="nft-tag">ON-CHAIN</span>'):'<span class="nft-tag preview">COLLECTION PREVIEW</span>';
  const price=real&&nft.listed?`<span class="price-value">${displayGnot(nft.priceUgnot)}</span>`:`<span class="price-value" style="color:#8b9084">Not for sale</span>`;
  return `<article class="nft-card" data-open-nft="${escapeHTML(String(nft.id))}" data-preview="${nft.preview?'1':'0'}" data-collection-path="${escapeHTML(nft.collectionPath||'')}">
   <div class="nft-image-wrap"><img loading="lazy" class="nft-image" src="${escapeHTML(imageSrc(nft.image))}" alt="${escapeHTML(nft.name||'NFT collectible')}" onerror="this.onerror=null;this.src='${ART.moon}'">${badge}<button class="favorite-btn ${favorite?'active':''}" data-action="favorite" data-id="${escapeHTML(String(nft.id))}" aria-label="Toggle favorite">${favorite?'♥':'♡'}</button></div>
   <div class="nft-meta"><div class="nft-title-row"><div style="min-width:0"><h3 class="nft-title">${escapeHTML(nft.name)}</h3><p class="nft-collection"><span class="card-collection-dot"></span>${escapeHTML(nft.collectionName||'Gno.land collection')}</p></div></div>
   <div class="nft-price"><div><div class="price-label">${real&&nft.listed?'Current price':'Status'}</div></div>${price}</div></div>
 </article>`;
}

function lockedTile(id, options={}){
  const price=Number(options.priceUgnot||0);
  const supply=Number(options.supply||1111);
  const reason=options.reason||'Public minting is not enabled by this server yet.';
  const footer=price?`<div class="nft-price"><div><div class="price-label">Mint price</div><span class="price-value">${displayGnot(price)}</span></div>${options.mintLabel?`<button class="btn btn-ghost btn-sm" data-action="mint-moonbound" ${options.mintLive?'':`disabled title="${escapeHTML(reason)}"`}>${escapeHTML(options.mintLabel)}</button>`:''}</div>`:'';
  const traitRow=options.traits?Object.entries(options.traits).filter(([,v])=>v).slice(0,3).map(([k,v])=>`<span class="chip" title="${escapeHTML(k)}">${escapeHTML(String(v))}</span>`).join(''):'';
  return `<article class="nft-card" data-open-nft="${pad(id)}" data-collection-path="">
   <div class="nft-image-wrap"><div class="locked-tile"><span class="lock">🔒</span><div class="edition">#${pad(id)}</div><div class="lock-text">Art reveals on mint</div></div></div>
   <div class="nft-meta"><h3 class="nft-title">Moonbound Keepers</h3><p class="nft-collection"><span class="card-collection-dot"></span>Edition ${pad(id)} · ${num(supply)} supply</p>${traitRow?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${traitRow}</div>`:''}${footer}</div>
 </article>`;
}

function renderHero(){
  const colls=state.market.collections||[];
  const moon=state.config?.moonbound||{};
  const featured=colls.find(c=>c.slug==='moonbound')||colls[0]||null;
  const image=featured?.image||'/collection-assets/images/0001.webp';
  const name=featured?.name||moon.name||'Moonbound Keepers';
  const minted=Number(featured?.minted??moon.minted??0);
  const supply=Number(featured?.maxSupply??moon.maxSupply??1111);
  const mintReady=!!moon.mintEnabled&&!!featured&&featured.slug==='moonbound';
  const pct=supply?((minted/supply)*100).toFixed(1):'0';
  const progress=`<div class="progress"><div class="progress-top"><span><b>${num(minted)}</b> of ${num(supply)} minted</span><span>${pct}% revealed</span></div><div class="bar"><i style="width:${Math.min(100,Number(pct)||0)}%"></i></div><p class="small" style="margin-top:9px;color:var(--muted)">Art reveals on mint · one edition per transaction · the contract enforces a supply cap, not a per-wallet limit.</p></div>`;
  const featuredAction=mintReady
   ? `<button class="btn btn-dark" data-action="open-moonbound-drop">Mint for ${displayGnot(moon.mintPriceUgnot)} <span>↗</span></button>`
   : `<button class="btn btn-dark" data-action="open-moonbound-drop">View the drop <span>↗</span></button>`;
  return `<section class="hero">
   <div class="hero-copy"><div class="hero-overline"><span class="star">✳</span> ${featured?'Live drop · '+escapeHTML(name):'Featured drop · launch pending'}</div><h1 class="hero-title">${escapeHTML(name)}<br><em>${num(supply)} editions.</em></h1><p>Every edition is numbered on-chain from the first mint. Art and traits stay hidden until an edition is minted, and secondary sales settle seller, royalty and fee inside the collection realm in one transaction.</p><div class="hero-actions">${featuredAction}<button class="btn btn-outline" data-route="create">Create a collection <span>＋</span></button></div><div class="hero-stats"><div class="hero-stat"><b>${colls.length.toLocaleString('en-US')}</b><span>registered collections</span></div><div class="hero-stat"><b>${(state.market.listings||[]).length.toLocaleString('en-US')}</b><span>active listings</span></div><div class="hero-stat"><b>2.5%</b><span>Morrow sale fee</span></div></div>${progress}</div>
   <div class="stack"><figure class="s1"><img src="${ART.moon}" alt="Moonbound Keepers key art" onerror="this.onerror=null;this.src='${ART.glass}'"><figcaption><b>Key art</b><span>900 × 900 source</span></figcaption></figure><figure class="s2"><img src="${escapeHTML(imageSrc(image))}" alt="${escapeHTML(name)} edition 0001" onerror="this.onerror=null;this.src='${ART.moon}'"><figcaption><b>${escapeHTML(name)}</b><span>${num(supply)} editions · Gno.land</span></figcaption></figure><figure class="s3"><img src="/collection-assets/images/0003.webp" alt="Moonbound Keepers edition 0003" onerror="this.onerror=null;this.src='${ART.sun}'"><figcaption><b>Pinned before mint</b><span>IPFS art + metadata</span></figcaption></figure></div>
  </section>${!state.config?.registryConfigured?`<div class="inline-info" style="margin:18px 0"><strong>Morrow is in setup mode.</strong> Live listings, minting and launch transactions activate after the independent registry is deployed and configured. The code does not pretend that test assets are already on-chain.</div>`:''}`;
}

function renderUnrevealedGrid(){
  if((state.market.collections||[]).length>0)return '';
  const moon=state.config?.moonbound||{};
  const tiles=[...Array(Math.min(12, Number(moon.maxSupply||1111)))].map((_,i)=>lockedTile(i+1)).join('');
  return `<section><div class="section-head"><div><div class="eyebrow"><span class="eyedot"></span> Moonbound Keepers · unrevealed</div><h2>1,111 editions</h2><p>The whole drop is visible as numbered editions. Art and traits appear one by one as they are minted — nothing is pre-revealed.</p></div><button class="text-action" data-action="open-moonbound-drop">Open mint page ↗</button></div><div class="nft-grid">${tiles}</div></section>`;
}

// Drops: the next editions of the featured collection at the configured mint price.
function renderDrops(){
  const colls=state.market.collections||[];
  const moon=state.config?.moonbound||{};
  const featured=colls.find(c=>c.slug==='moonbound')||colls[0]||null;
  const name=featured?.name||moon.name||'Moonbound Keepers';
  const minted=Number(featured?.minted??moon.minted??0);
  const supply=Number(featured?.maxSupply??moon.maxSupply??1111);
  const price=Number(featured?.mintPriceUgnot??moon.mintPriceUgnot??0);
  const mintLive=!!moon.mintEnabled&&!!featured&&featured.slug==='moonbound';
  const nextId=minted+1;
  const tiles=[0,1,2].map(i=>{const id=nextId+i;return id<=supply?lockedTile(id,{priceUgnot:price,supply,mintLive,mintLabel:i===0?`Mint #${pad(id)}`:''}):'';}).join('');
  return `<section><div class="section-head"><div><div class="eyebrow"><span class="eyedot"></span> Drops</div><h2>${escapeHTML(name)}</h2><p>${minted?`${num(minted)} of ${num(supply)} editions minted. The next edition is <b>#${pad(Math.min(nextId,supply))}</b>.`:`Nothing is minted yet, so the drop opens at edition <b>#0001</b>.`} Minting calls the collection realm from your wallet; art and traits appear with the mint.</p></div><button class="text-action" data-action="open-moonbound-drop">Open the drop ↗</button></div><div class="nft-grid">${tiles}</div></section>`;
}

// Compact collections strip for explore, including the launch card priced from the real registry fee.
function renderExploreCollections(){
  const colls=state.market.collections||[];
  const fee=Number(state.config?.collectionServiceFeeUgnot||0);
  const bps=Number(state.config?.marketplaceFeeBps||0);
  const createCard=`<article class="collection-card" data-route="create"><div class="collection-cover" style="display:grid;place-items:center;font-size:34px;color:var(--muted-2)">＋</div><div class="collection-body"><div class="collection-title-row"><div><h3 class="collection-title">Create a collection</h3><div class="collection-creator">Pin the art, deploy from your own wallet</div></div><span class="status-chip onchain">Open</span></div><div class="collection-stats"><div><strong>${fee?displayGnot(fee):'—'}</strong><span>Launch fee</span></div><div><strong>${bps?(bps/100).toFixed(1)+'%':'—'}</strong><span>Sale fee</span></div><div><strong>1,111</strong><span>Editions / drop</span></div></div><button class="btn btn-dark" data-route="create">Start ↗</button></div></article>`;
  return `<section><div class="section-head"><div><div class="eyebrow"><span class="eyedot"></span> On-chain identities</div><h2>Collections</h2><p>Registered Gno.land realms. ${colls.length?'':'None are registered in the configured registry yet, so the launch card below is the only live path.'}</p></div><button class="text-action" data-route="collections">All collections ↗</button></div><div class="collection-grid">${colls.slice(0,2).map(c=>`<article class="collection-card" data-action="open-collection" data-path="${escapeHTML(c.path)}"><div class="collection-cover"><img loading="lazy" src="${escapeHTML(imageSrc(c.image||'/collection-assets/images/0001.webp'))}" alt="${escapeHTML(c.name)} cover" onerror="this.onerror=null;this.src='${ART.glass}'"><span class="collection-count">${Number(c.minted||0).toLocaleString('en-US')}${c.maxSupply?` / ${Number(c.maxSupply).toLocaleString('en-US')}`:''} minted</span></div><div class="collection-body"><div class="collection-title-row"><div><h3 class="collection-title">${escapeHTML(c.name)}</h3><div class="collection-creator">${escapeHTML(c.creator==='Morrow Studio'?c.creator:shortAddr(c.creator))}</div></div>${c.verified?'<span class="status-chip good">Verified</span>':'<span class="status-chip pending">Unverified</span>'}</div><div class="collection-stats"><div><strong>${c.maxSupply?Number(c.maxSupply).toLocaleString('en-US'):'—'}</strong><span>Supply</span></div><div><strong>${(Number(c.royaltyBps||0)/100).toFixed(1)}%</strong><span>Royalty</span></div><div><strong>${Number(c.minted||0).toLocaleString('en-US')}</strong><span>Minted</span></div></div><button class="btn btn-soft" data-action="open-collection" data-path="${escapeHTML(c.path)}">Open collection ↗</button></div></article>`).join('')}${createCard}</div></section>`;
}

function renderListings(){
  const q=state.query.trim().toLowerCase();
  let listings=[...(state.market.listings||[])];
  if(q) listings=listings.filter(x=>`${x.name} ${x.collectionName} ${x.seller}`.toLowerCase().includes(q));
  const cards=listings.map(x=>({...x,preview:false}));
  const liveMarkup=cards.length?`<div class="nft-grid">${cards.slice(0,12).map(x=>artCard(x)).join('')}</div>`:`<div class="empty-state"><div class="empty-art">⌁</div><h3>No live listings yet</h3><p>This section reads current asks from Morrow-registered collection realms. When the first seller lists an NFT, the actual on-chain item and price appear here.</p><button class="btn btn-outline" data-route="collections">Browse collections</button></div>`;
  return `<section><div class="section-head"><div><div class="eyebrow"><span class="eyedot"></span> Secondary market</div><h2>Live listings</h2><p>Current asks, on-chain ownership and wallet-approved purchases. No fictional listings or sample prices.</p></div><button class="text-action" data-action="refresh-market">Refresh listings ↻</button></div>
   <div class="filter-row"><div class="filter-pills">${['All items','Listed'].map(x=>`<button class="filter-pill ${state.status===x.toLowerCase()?'active':''}" data-action="status" data-value="${x.toLowerCase()}">${x}</button>`).join('')}</div><div class="filter-tools"><select class="select-control" id="sortSelect"><option value="ed" ${state.sort==='ed'?'selected':''}>Edition: low to high</option><option value="rar" ${state.sort==='rar'?'selected':''}>Rarity: rarest first</option></select></div></div>${liveMarkup}</section>`;
}

function renderCollections(){
  const query=state.query.toLowerCase();
  const colls=(state.market.collections||[]).filter(c=>!query||`${c.name} ${c.slug} ${c.creator} ${c.path}`.toLowerCase().includes(query));
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> On-chain identities</div><h1>Collections</h1><p>Explore Morrow-registered Gno.land collections and the official external Guardians project link. Registration confirms an on-chain path—not artistic rights or project safety.</p></div><div class="heading-actions"><button class="btn btn-dark" data-route="create">＋ Create collection</button></div></div>
  <div class="collection-grid">${colls.map(c=>`<article class="collection-card"><div class="collection-cover"><img loading="lazy" src="${escapeHTML(imageSrc(c.image||'/collection-assets/images/0001.webp'))}" alt="${escapeHTML(c.name)} cover" onerror="this.onerror=null;this.src='${ART.glass}'"><span class="collection-count">${c.slug==='moonbound'?'1111 EDITIONS':`${Number(c.minted||0).toLocaleString('en-US')}${c.maxSupply?` / ${Number(c.maxSupply).toLocaleString('en-US')}`:''} minted`}</span></div><div class="collection-body"><div class="collection-title-row"><div><h3 class="collection-title">${escapeHTML(c.name)}</h3><div class="collection-creator">${escapeHTML(c.creator==='Morrow Studio'?c.creator:shortAddr(c.creator))}</div></div>${c.verified?'<span class="status-chip good">Verified</span>':c.path===(state.market?.featuredCollectionPath||state.config?.featuredCollectionPath)?'<span class="status-chip onchain">Homepage feature</span>':'<span class="status-chip pending">Unverified</span>'}</div><p class="collection-description">${escapeHTML(c.description||`On-chain realm: ${c.path||'not deployed yet'}.`)}</p><div class="collection-stats"><div><strong>${c.maxSupply?Number(c.maxSupply).toLocaleString('en-US'):'—'}</strong><span>Supply</span></div><div><strong>${(Number(c.royaltyBps||0)/100).toFixed(1)}%</strong><span>Royalty</span></div><div><strong>${Number(c.minted||0).toLocaleString('en-US')}</strong><span>Minted</span></div></div>${c.slug==='moonbound'?`<button class="btn btn-soft" data-action="open-moonbound-drop">Open mint page ↗</button>`:`<button class="btn btn-soft" data-action="open-collection" data-path="${escapeHTML(c.path)}">Open collection ↗</button>`}</div></article>`).join('')}</div><div class="inline-info" style="margin-top:18px">Trust rule: registry registration and IPFS persistence do not make a collection authentic. New collections are unverified by default, and Morrow blocks purchases until a human review checks official links, creator control and contract behavior. No decentralized marketplace can prevent every scam collection from being created elsewhere.</div>`;
}

// Compact collection card used by the portfolio tab; the explore grid keeps its longer marketing card.
function renderCollectionCards(colls){
  const cards=(colls||[]).map(c=>`<article class="collection-card" data-action="open-collection" data-path="${escapeHTML(c.path)}"><div class="collection-cover"><img loading="lazy" src="${escapeHTML(imageSrc(c.image||'/collection-assets/images/0001.webp'))}" alt="${escapeHTML(c.name)} cover" onerror="this.onerror=null;this.src='${ART.glass}'"><span class="collection-count">${Number(c.minted||0).toLocaleString('en-US')}${c.maxSupply?` / ${Number(c.maxSupply).toLocaleString('en-US')}`:''} minted</span></div><div class="collection-body"><div class="collection-title-row"><div><h3 class="collection-title">${escapeHTML(c.name)}</h3><div class="collection-creator">${escapeHTML(shortAddr(c.creator))}</div></div>${c.verified?'<span class="status-chip good">Verified</span>':'<span class="status-chip pending">Unverified</span>'}</div><div class="collection-stats"><div><strong>${c.maxSupply?Number(c.maxSupply).toLocaleString('en-US'):'—'}</strong><span>Supply</span></div><div><strong>${Number(c.minted||0).toLocaleString('en-US')}</strong><span>Minted</span></div></div></div></article>`).join('');
  return `<div class="collection-grid">${cards}</div>`;
}

function renderExplore(){
  return `${renderHero()}${renderDrops()}${renderUnrevealedGrid()}${renderListings()}${renderExploreCollections()}`;
}

async function openCollection(path){
  const collection=(state.market.collections||[]).find(c=>c.path===path);
  if(!collection){toast('This collection was not found in the configured Morrow registry.','error');return}
  state.collectionPath=path; state.collectionItems=[]; state.collectionOffset=0; state.collectionHasMore=false; state.collectionTab='items'; state.unrevealedShown=24; state.route='collection'; render();
  loadFacets();
  await loadCollectionItems(true);
}
async function loadCollectionItems(reset=false){
  const path=state.collectionPath;if(!path)return;
  const offset=reset?0:state.collectionOffset;
  const result=await api(`/api/collection-items?pkg=${encodeURIComponent(path)}&offset=${offset}&limit=24`);
  if(reset)state.collectionItems=result.items||[];else state.collectionItems.push(...(result.items||[]));
  state.collectionOffset=offset+(result.items||[]).length;
  state.collectionHasMore=!!result.hasMore;
  render();
}
async function realmRead(pkg,func,args=[]){
  const query=new URLSearchParams({pkg,func});args.forEach(a=>query.append('arg',String(a)));
  try{return (await api(`/api/realm-read?${query.toString()}`)).value}catch{return null}
}

function renderItemDetail(){
  const id=state.itemId; const pkg=state.itemPkg;
  const c=(state.market.collections||[]).find(x=>x.path===pkg);
  // Unminted editions have no token yet, but the pinned metadata already fixes their traits,
  // so the item page can show the real trait table instead of a dash.
  const pinned=/\/moonbound$/.test(pkg||'')?(state.traits?.editions||{})[pad(Number(id)||0)]:null;
  const meta=state.itemMeta||(pinned?{name:`Moonbound Keepers #${pad(Number(id)||0)}`,image:null,attributes:Object.entries(pinned).filter(([key])=>key!=='Edition').map(([trait_type,value])=>({trait_type,value}))}:null);
  const listed=(state.market.listings||[]).find(x=>sameId(x.id,id)&&x.collectionPath===pkg);
  const owned=(state.portfolio.tokens||[]).find(x=>sameId(x.id,id)&&x.collectionPath===pkg);
  const isMoonbound=pkg===(state.config?.moonbound?.collectionPath||'')||c?.slug==='moonbound';
  const mintable=isMoonbound&&!!state.config?.moonbound?.mintEnabled&&!listed&&!owned&&Number((c||{minted:0}).minted||0)<Number((c||{maxSupply:1111}).maxSupply||1111);
  const priceUgnot=Number((c||{mintPriceUgnot:0}).mintPriceUgnot||state.config?.moonbound?.mintPriceUgnot||0);
  const hasImage=meta&&meta.image;
  const sellerIsWallet=!!(state.wallet&&listed&&listed.seller&&listed.seller===state.wallet.address);
  const ownerIsWallet=!!(state.wallet&&owned&&owned.owner&&owned.owner===state.wallet.address);
  const {total}=saleTotal(listed?listed.priceUgnot:0);
  const itemAction=listed
   ?(sellerIsWallet?`<button class="btn btn-dark btn-full" data-action="cancel-item">Cancel listing</button>`
     :`<button class="btn btn-dark btn-full" data-action="buy-item" ${(!state.wallet||!state.config?.transactionsEnabled)?'disabled':''}>${state.wallet?`Buy for ${displayGnot(total)} ↗`:'Connect Adena to buy'}</button>`)
   :ownerIsWallet?`<button class="btn btn-dark btn-full" data-action="list-item">List for sale</button>`
   :mintable?`<button class="btn btn-dark btn-full" data-action="mint-item">Mint next edition ↗</button>`
   :`<button class="btn btn-dark btn-full" disabled>${owned?'Owned':'Not for sale'}</button>`;
  const itemNote=listed
   ?`The buyer pays ${displayGnot(total)}: the ${displayGnot(listed.priceUgnot)} ask plus the contract-enforced 2.5% Morrow fee, settled inside the collection realm in one transaction.`
   :mintable?'Public minting issues the next unrevealed edition; the edition number is assigned on-chain in the order transactions confirm.'
   :'This edition has not been minted yet. Art and traits are pinned to IPFS before the drop; the image appears the moment the edition is minted.';
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Item</div><h1>${escapeHTML(meta?.name||`Moonbound Keepers #${id}`)}</h1><p>Collection ${escapeHTML(c?.name||'Moonbound Keepers')} · edition ${pad(id)} of ${Number((c||{maxSupply:1111}).maxSupply||1111)}</p></div><div class="heading-actions">${isMoonbound?`<a class="btn btn-outline" href="${collectionLink(pkg)}" target="_blank" rel="noreferrer">View realm ↗</a>`:''}</div></div>
  <div class="item">
   <div>
    <div class="art-shell">
     ${hasImage?`<div class="blur" style="background-image:url('${escapeHTML(imageSrc(meta.image))}')"></div><img src="${escapeHTML(imageSrc(meta.image))}" alt="${escapeHTML(meta.name||'')}">`:`<div class="locked-tile-big"><span class="lock">🔒</span><div class="edition">#${pad(id)}</div><div class="lock-text">Art reveals on mint</div></div>`}
    </div>
    <div class="art-foot"><span>${escapeHTML(meta?.name||`Moonbound Keepers #${id}`)}</span><span>${hasImage?'Pinned to IPFS':'Unrevealed'}</span></div>
    ${!mintable&&!listed&&!owned?`<p class="note" style="margin-top:11px">This edition has not been minted yet. Art and traits are pinned to IPFS before the drop; the image appears the moment the edition is minted.</p>`:''}
    <div class="panel" style="margin-top:16px">
     <div class="eyebrow" style="color:var(--muted)">Traits</div>
     <div class="trait-grid">${renderTraits(meta)}</div>
    </div>
   </div>
   <div>
    <div style="display:flex;align-items:center;gap:10px">${isMoonbound?`<span class="chip good">Verified</span>`:''}${isMoonbound&&traitOf(Number(id),'Rarity')?`<span class="chip">${escapeHTML(traitOf(Number(id),'Rarity'))}</span>`:''}<span style="font-size:11px;color:var(--muted-2)">Edition ${pad(id)}</span></div>
    <h1 style="font-size:27px;margin:10px 0 6px">${escapeHTML(meta?.name||`Moonbound Keepers #${id}`)}</h1>
    <div class="note">Owner ${owned?escapeHTML(shortAddr(owned.owner)):'not minted'} · ${listed?'listed':'not listed'}</div>
    <div class="mint-price" style="margin:16px 0"><div class="l">Mint price</div><div class="v">${displayGnot(priceUgnot)}</div></div>
    <div style="display:flex;gap:10px">${itemAction}<button class="btn btn-ghost" data-action="favorite" data-id="${escapeHTML(String(Number(id)||0))}" aria-label="Toggle favorite">${state.favorites.has(favKey(id))?'♥':'♡'}</button></div>
    <p class="note" style="margin-top:12px">${itemNote}</p>
    <div class="panel" style="margin-top:18px">
     <div class="eyebrow" style="color:var(--muted)">Details</div>
     <div style="margin-top:11px">
      <div class="kv"><span>Contract</span><b class="mono">${escapeHTML(pkg||'r/morrow/moonbound')}</b></div>
      <div class="kv"><span>Token standard</span><b>GRC-721 (Gno.land)</b></div>
      <div class="kv"><span>Token ID</span><b class="mono">${escapeHTML(id)}</b></div>
      <div class="kv"><span>Metadata</span><b class="mono">${meta?(state.config?.moonbound?.metadataBaseUri?`ipfs://…/${pad(id)}.json`:'pinned copy · base URI not configured'):'not yet'}</b></div>
      <div class="kv"><span>Chain</span><b>Gno.land</b></div>
      <div class="kv"><span>Royalty</span><b>${(Number((c||{royaltyBps:0}).royaltyBps||0)/100).toFixed(1)}% · enforced by contract</b></div>
     </div>
    </div>
    <div class="panel" style="margin-top:14px">
     <div class="eyebrow" style="color:var(--muted)">Price history</div>
     <div style="margin-top:11px">
      <div class="kv"><span>Mint · ${displayGnot(priceUgnot)}</span><b>${listed||owned?'confirmed':'not yet'}</b></div>
      <div class="kv"><span>Listings</span><b>${listed?1:0}</b></div>
      <div class="kv"><span>Sales</span><b>none</b></div>
     </div>
     <p class="note" style="margin-top:10px">History is read from contract events. Until then it stays empty rather than showing invented sales.</p>
    </div>
   </div>
  </div>`;
}

function renderTraits(meta){
  if(!meta||!meta.attributes)return '<div class="trait"><span>Rarity</span><b>—</b><em>traits pinned on reveal</em></div>';
  const order=['Keeper','Realm','Aura','Relic','Frame','Palette','Rarity','Edition'];
  const attrs=[...meta.attributes].sort((a,b)=>order.indexOf(a.trait_type)-order.indexOf(b.trait_type));
  return attrs.map(a=>`<div class="trait"><span>${escapeHTML(a.trait_type)}</span><b>${escapeHTML(a.value)}</b><em>pinned to IPFS</em></div>`).join('');
}

function renderPortfolio(){
  if(!state.wallet)return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Your space</div><h1>Portfolio</h1><p>Your collectibles, collection realms and token balances, directly connected to your wallet.</p></div></div><div class="empty-state"><div class="empty-art">▦</div><h3>Your collection belongs here</h3><p>Connect Adena to read the wallet address, balances and known Gno.land NFT holdings. Morrow never stores your private key or seed phrase.</p><button class="btn btn-dark" data-action="connect">Connect Adena</button></div>`;
  const holdings=state.portfolio.tokens||[];const colls=state.portfolio.collections||[];
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Your space</div><h1>Portfolio</h1><p>Only the public wallet address is used to read balances and NFTs from Morrow-registered Gno.land collections.</p></div><div class="heading-actions"><button class="btn btn-outline" data-action="refresh-wallet">Refresh portfolio ↻</button></div></div>
  <div class="wallet-hero"><div><div class="eyebrow" style="color:#d9ef9d">Connected with Adena</div><h2>Looking good.</h2><p>Your keys stay with you. Morrow never takes custody.</p><div class="wallet-address mono">${escapeHTML(state.wallet.address)}</div></div><div><div class="tiny-label" style="color:#c2c9b9">Native balance</div><div class="wallet-balance">${displayGnot((state.balances.find(x=>x.denom==='ugnot')||{}).amount||0)}</div></div></div>
  <div class="stat-grid"><div class="stat-card"><span class="stat-label">NFTs found</span><strong>${holdings.length}</strong><span class="stat-foot">Morrow-registered collections</span></div><div class="stat-card"><span class="stat-label">Collections held</span><strong>${colls.length}</strong><span class="stat-foot">With indexed NFTs</span></div><div class="stat-card"><span class="stat-label">Morrow points</span><strong>${Number(state.points.total||0).toLocaleString('en-US')}</strong><span class="stat-foot">Verified on-chain actions</span></div><div class="stat-card"><span class="stat-label">Wallet custody</span><strong>100%</strong><span class="stat-foot">Self-custodied in Adena</span></div></div>
  <div class="tabs-row"><button class="tab-btn ${state.activePortfolioTab==='nfts'?'active':''}" data-action="portfolio-tab" data-value="nfts">My NFTs (${holdings.length})</button><button class="tab-btn ${state.activePortfolioTab==='collections'?'active':''}" data-action="portfolio-tab" data-value="collections">My collections (${colls.length})</button><button class="tab-btn ${state.activePortfolioTab==='tokens'?'active':''}" data-action="portfolio-tab" data-value="tokens">Tokens (${state.balances.length})</button></div>
  ${state.activePortfolioTab==='nfts'?(holdings.length?`<div class="nft-grid">${holdings.map(n=>artCard({...n,preview:false})).join('')}</div>`:`<div class="empty-state"><div class="empty-art">◈</div><h3>No NFTs found in indexed collections</h3><p>Morrow scans its own on-chain registry. It does not claim to index every independent NFT realm on Gno.land.</p><button class="btn btn-outline" data-route="collections">Browse collections</button></div>`):state.activePortfolioTab==='collections'?(colls.length?renderCollectionCards(colls):`<div class="empty-state"><h3>No collection NFTs found</h3><p>Launch your first collection and it will appear here after the registry confirms it.</p><button class="btn btn-dark" data-route="create">Create collection</button></div>`):`<div class="activity-list">${state.balances.map(b=>`<div class="activity-row"><div class="activity-icon">◈</div><div><strong>${escapeHTML(b.denom==='ugnot'?'GNOT':b.denom)}</strong><span class="mono">${escapeHTML(b.denom)}</span></div><div class="activity-value">${Number(b.amount).toLocaleString('en-US',{maximumFractionDigits:6})}</div></div>`).join('')}</div>`}
  <div class="inline-info" style="margin-top:16px">Portfolio indexing is read-only and limited to collections registered in the Morrow registry. For the complete account history, check <a href="https://gnoscan.io/" target="_blank" rel="noreferrer"><strong>Gnoscan ↗</strong></a>.</div>`;
}

function renderRewards(){
  const total=Number(state.points.total||0);const events=state.points.events||[];
  const ranks=[{name:'Newcomer',min:0,mark:'01'},{name:'Collector',min:100,mark:'02'},{name:'Curator',min:500,mark:'03'},{name:'Gno Guardian',min:2000,mark:'04'}];
  const rankIndex=Math.max(0,ranks.reduce((found,r,i)=>total>=r.min?i:found,0));
  const rank=ranks[rankIndex], nextRank=ranks[rankIndex+1];
  const rankProgress=nextRank?Math.max(0,Math.min(100,Math.round((total-rank.min)/(nextRank.min-rank.min)*100))):100;
  const quests=[
   {id:'buy',icon:'✦',name:'First collectible',description:'Buy a listed NFT from a supported on-chain collection. The tx must be confirmed.',points:10,action:'Buy event'},
   {id:'list',icon:'↗',name:'Put it on the floor',description:'List an NFT you own at a fixed price. Points arrive after the List event is confirmed.',points:5,action:'List event'},
   {id:'mint',icon:'✳',name:'Make something yours',description:'Mint an NFT from a supported collection with metadata pinned to IPFS.',points:8,action:'Mint event'},
   {id:'launch',icon:'▦',name:'Your first collection',description:'Deploy and initialize a collection realm registered by the Morrow registry.',points:15,action:'Init event'},
   {id:'explore',icon:'⌕',name:'Explore the ecosystem',description:'More discovery quests, partner tasks and seasonal campaigns will be added here.',points:0,action:'Coming soon'},
   {id:'creator',icon:'◉',name:'Creator streak',description:'Quest rules can be expanded later; only confirmed chain actions can award points.',points:0,action:'Coming soon'}
  ];
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Actions with meaning</div><h1>Rewards & quests</h1><p>Points are earned for verified on-chain actions—not page views or buttons. The quests shelf is ready for future campaigns.</p></div><div class="heading-actions">${state.wallet?'<button class="btn btn-outline" data-action="refresh-wallet">Refresh points ↻</button>':'<button class="btn btn-dark" data-action="connect">Connect wallet</button>'}</div></div>
  <div class="reward-hero"><div><div class="eyebrow"><span class="eyedot"></span> Morrow points</div><h2>Good moves deserve<br>to be remembered.</h2><p>Collect, create and contribute. When a supported transaction is confirmed by Gno.land, Morrow verifies the event and credits your public wallet address. No private keys and no trust in a client-side counter.</p><div class="action-inline"><span class="status-chip ${state.wallet?'good':'subtle'}">${state.wallet?'Wallet connected':'Wallet not connected'}</span><span class="status-chip subtle">On-chain verification</span></div></div><div class="points-orbit"><strong>${total.toLocaleString('en-US')}</strong><span>MORROW POINTS</span></div></div>
  <div class="rank-panel"><div class="rank-emblem">${rank.mark}</div><div class="rank-main"><div class="tiny-label">Your community rank</div><h3>${rank.name}</h3><p>${nextRank?`${(nextRank.min-total).toLocaleString('en-US')} more points to ${nextRank.name}.`:'Top rank reached — thank you for contributing.'} Rank progress is a non-transferable reputation indicator, not a token or financial promise.</p><div class="rank-track"><span style="width:${rankProgress}%"></span></div></div><div class="rank-numbers"><strong>${total.toLocaleString('en-US')}</strong><span>verified points</span></div></div>
  <div class="section-head"><div><h2>Earn points</h2><p>These rewards are tied to supported contract events and unique transaction hashes.</p></div></div><div class="quest-grid">${quests.map(q=>`<article class="quest-card"><div class="quest-icon">${q.icon}</div><h3>${q.name}</h3><p>${q.description}</p><div class="quest-bottom"><span class="points-tag">${q.points?`+${q.points} points`:q.action}</span><span class="tiny-label">${q.points?'Auto-verify':'Coming soon'}</span></div></article>`).join('')}</div>
  <div class="section-head"><div><h2>Verify an action</h2><p>Paste the transaction hash returned by Adena if auto-refresh did not pick up your points.</p></div></div><div class="panel"><div class="field"><label for="rewardTxHash">Gno.land transaction hash</label><input id="rewardTxHash" class="mono" placeholder="Paste transaction hash…" ${!state.wallet?'disabled':''}></div><div class="action-inline" style="margin-top:12px"><button class="btn btn-dark" data-action="verify-points" ${!state.wallet?'disabled':''}>Verify transaction</button><span class="muted" style="font-size:10px">One award per confirmed transaction hash.</span></div></div>
  <div class="section-head"><div><h2>Points history</h2><p>Only transactions validated by the RPC are listed.</p></div></div>${events.length?`<div class="panel activity-list">${events.map(e=>`<div class="activity-row"><div class="activity-icon">✳</div><div><strong>${escapeHTML(e.label)}</strong><span>${new Date(e.time).toLocaleString('en-US')} · <a href="https://gnoscan.io/" target="_blank" rel="noreferrer" class="mono">${escapeHTML(shortAddr(e.txHash))}</a></span></div><div class="activity-value">+${Number(e.points||0)} pts</div></div>`).join('')}</div>`:`<div class="empty-state"><div class="empty-art">✳</div><h3>Your first reward is waiting</h3><p>When a supported transaction confirms, its on-chain event can be verified here and credited to your address.</p></div>`}`;
}

function renderActivity(){
  const listings=state.market.listings||[];
  const events=state.points.events||[];
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> The living record</div><h1>Activity</h1><p>Current asking prices from the collection realms and your verified Morrow reward history. Full chain activity remains public in Gnoscan.</p></div><div class="heading-actions"><a class="btn btn-outline" href="https://gnoscan.io/" target="_blank" rel="noreferrer">Open Gnoscan ↗</a></div></div>
  <div class="two-col"><div class="panel"><h3>Live listings</h3><p>Read from each collection's current ListOpen() response. This is current state, not a complete historical feed.</p>${listings.length?`<div class="activity-list">${listings.slice(0,20).map(n=>`<div class="activity-row"><div class="activity-icon">◈</div><div><strong>${escapeHTML(n.name)}</strong><span>${escapeHTML(n.collectionName)} · seller ${escapeHTML(shortAddr(n.seller))}</span></div><div class="activity-value">${displayGnot(n.priceUgnot)}</div></div>`).join('')}</div>`:`<div class="empty-state" style="padding:28px"><h3>No active listing data</h3><p>RPC may be unavailable, or Morrow-registered realms currently have no public listings.</p></div>`}</div><div class="panel"><h3>Your reward activity</h3><p>Only verified contract events are credited.</p>${events.length?`<div class="activity-list">${events.slice(0,12).map(e=>`<div class="activity-row"><div class="activity-icon">✳</div><div><strong>${escapeHTML(e.label)}</strong><span>${new Date(e.time).toLocaleDateString('en-US')}</span></div><div class="activity-value">+${Number(e.points)} pts</div></div>`).join('')}</div>`:`<div class="empty-state" style="padding:28px"><div class="empty-art">◌</div><h3>No reward history yet</h3><p>Connect a wallet and start collecting or creating.</p></div>`}</div></div>`;
}

function computeLaunchDue(){
  const launchFeeGnot=Number(state.config?.launchFeeGnot||2000);
  const adminWallet=String(state.config?.adminWallet||'');
  const isAdmin=!!state.wallet&&adminWallet&&state.wallet.address.toLowerCase()===adminWallet.toLowerCase();
  return {fee:launchFeeGnot, isAdmin, due:isAdmin?0:launchFeeGnot};
}
function createPreviewMarkup(){
  const img=state.activeUpload?.gatewayUrl||'/collection-assets/images/0001.webp';
  const {fee,isAdmin,due}=computeLaunchDue();
  return `<aside class="preview-card"><img id="collectionPreviewImage" class="preview-image" src="${escapeHTML(imageSrc(img))}" alt="NFT collection preview"><div class="preview-info"><div class="tiny-label">Live preview</div><h3 id="previewName">${escapeHTML($('#collectionName')?.value||'Your collection')}</h3><p id="previewSymbol">${escapeHTML($('#collectionSymbol')?.value||'SYMBOL')} · Connected wallet as creator</p><div class="fee-breakdown"><div class="fee-line"><span>One-time collection launch</span><strong id="serviceFeeValue">${fee.toLocaleString('en-US')} GNOT</strong></div><div class="fee-line"><span>${isAdmin?'Admin wallet override':'Your wallet'}</span><strong>${due.toLocaleString('en-US')} GNOT</strong></div><div class="fee-line"><span>Morrow fee on secondary sales</span><strong>2.5%</strong></div><div class="fee-line"><span>Network gas + package storage</span><strong>Wallet estimate</strong></div><div class="fee-total"><span>Due now</span><span>${due.toLocaleString('en-US')} GNOT + gas</span></div></div><p class="modal-note">The launch fee goes to the Morrow treasury once. ${isAdmin?'Admin deployment: the registry contract currently requires exactly 2,000 GNOT per launch; admin fee exemption is a policy value awaiting contract support.':'Fee is a server config value.'} Gas and package storage are estimated by Adena separately.</p></div></aside>`;
}
function renderCreate(){
  const active=state.activeCreateTab;
  const canUpload=!!state.config?.pinningConfigured;
  const transactionNote=state.config?.transactionsEnabled?`Morrow transactions are enabled on ${escapeHTML(state.config.chainId)}. Adena will show the registry, fee and network gas before approval.`:`Transactions are in read-only mode until the Morrow registry, treasury and explicit network-write setting are configured.`;
  const {fee,isAdmin,due}=computeLaunchDue();
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Creator studio</div><h1>Make it real.</h1><p>Deploy your own Gno.land collection realm, pin artwork and metadata to IPFS, then mint. The collection registers in Morrow's independent registry; no third-party marketplace contract is required.</p></div><div class="heading-actions"><span class="status-chip ${canUpload?'good':'pending'}">${canUpload?'IPFS ready':'IPFS setup needed'}</span><span class="status-chip ${state.config?.transactionsEnabled?'good':'pending'}">${state.config?.transactionsEnabled?'Transactions enabled':'Read-only mode'}</span></div></div>
  ${!state.config?.registryConfigured?`<div class="panel registry-setup"><div class="eyebrow"><span class="eyedot"></span> One-time marketplace setup</div><h3>Morrow registry is not deployed/configured</h3><p>Set <code>MORROW_TREASURY_ADDRESS</code> and explicitly enable writes for the target network in the server's <code>.env</code>. If the network settings allow it, deploy the independent Morrow registry with Adena, then set <code>MORROW_REGISTRY_PATH</code> to the confirmed realm path and restart the server.</p><div class="action-inline"><button class="btn btn-dark" data-action="bootstrap-registry" ${(!state.wallet||!state.config?.bootstrapEnabled)?'disabled':''}>Deploy Morrow registry in Adena ↗</button><span class="muted">${state.config?.bootstrapEnabled?'Wallet-signed deployment is enabled.':'Requires treasury + explicit network-write configuration.'}</span></div></div>`:''}
  ${!state.config?.moonbound?.collectionConfigured?`<div class="panel registry-setup"><div class="eyebrow"><span class="eyedot"></span> Featured launch · original collection</div><h3>Moonbound Keepers · 1,111 editions</h3><p>The artwork and numbered metadata are included in this project. Before the first mint, pin both directories to public IPFS using <code>npm run pin:moonbound</code>, put the returned <code>ipfs://…</code> directory URIs into <code>MOONBOUND_IMAGE_BASE_URI</code> and <code>MOONBOUND_METADATA_BASE_URI</code> in <code>.env</code>, and restart the server. Then this button deploys the collection with its exact 1,111 supply and 575 GNOT mint price.</p><div class="action-inline"><button class="btn btn-dark" data-action="launch-moonbound" ${(!state.wallet||!state.config?.moonbound?.launchEnabled)?'disabled':''}>${state.config?.moonbound?.launchEnabled?'Launch Moonbound Keepers · 2,000 GNOT':'Moonbound launch setup incomplete'}</button><span class="muted">${state.config?.moonbound?.launchEnabled?'All server-side gates passed. Adena will sign the 2,000 GNOT launch payment.':!state.config?.transactionsEnabled?'Needs live registry, treasury and explicit network-write setting.':!state.config?.pinningConfigured?'Needs server-side PINATA_JWT.':!state.config?.moonbound?.assetsConfigured?'Needs both IPFS directory URIs and a server restart.':'Connect Adena, then retry.'}</span></div></div>`:!state.config?.moonbound?.mintEnabled?`<div class="inline-info danger-info" style="margin-bottom:18px"><strong>Moonbound is registered but minting is still blocked.</strong> The server requires a verified collection with exactly 1,111 supply, 575 GNOT price and on-chain IPFS bases, plus enabled transaction settings. Review the registry and current contract parameters before opening the mint.</div>`:''}
  <div class="tabs-row"><button class="tab-btn ${active==='collection'?'active':''}" data-action="create-tab" data-value="collection">Create collection</button><button class="tab-btn ${active==='mint'?'active':''}" data-action="create-tab" data-value="mint">Mint an NFT</button><button class="tab-btn ${active==='trust'?'active':''}" data-action="create-tab" data-value="trust">Trust & safety</button></div>
  ${active==='collection'?renderCollectionForm(transactionNote,canUpload,fee,isAdmin,due):active==='mint'?renderMintForm(transactionNote,canUpload):renderTrustForm()}`;
}
function renderCollectionForm(transactionNote,canUpload,launchFeeGnot,isAdmin,due){
  return `<form id="collectionForm" class="form-layout"><div class="panel"><div class="form-stack"><div><div class="tiny-label">01 / Identity</div><h3 style="margin-top:5px">Create your collection</h3><p style="margin-top:5px">A concise name, a unique realm slug, and IPFS-pinned artwork. Your collection begins unverified until reviewed.</p></div>
  <div class="field"><label for="collectionName">Collection name *</label><input id="collectionName" name="name" required maxlength="64" placeholder="e.g. Garden Guardians"><span class="helper">Displayed across the marketplace and wallet.</span></div>
  <div class="field-grid"><div class="field"><label for="collectionSymbol">Ticker / symbol *</label><input id="collectionSymbol" name="symbol" required maxlength="11" pattern="[A-Za-z0-9]{1,11}" placeholder="GARDEN"><span class="helper">1–11 letters or numbers.</span></div><div class="field"><label for="collectionSlug">Realm slug *</label><input id="collectionSlug" name="slug" required maxlength="11" pattern="[a-z][a-z0-9]{1,10}" placeholder="gardens"><span class="helper">Lowercase letters/numbers, 2–11 chars.</span></div></div>
  <div class="field"><label for="collectionNamespace">Your Gno.land namespace *</label><input id="collectionNamespace" name="namespace" required value="${escapeHTML(state.wallet?.address||'')}" readonly placeholder="Connect Adena to fill your wallet address"><span class="helper">The realm namespace is the connected wallet address. Connect Adena first; no custom namespace is guessed.</span></div>
  <div class="field"><label for="collectionDescription">Description</label><textarea id="collectionDescription" name="description" maxlength="1000" placeholder="What makes this collection special?"></textarea></div>
  <label class="upload-drop" for="collectionCover"><span class="upload-icon">↥</span><span><strong id="coverLabel">Upload collection cover</strong><span>PNG, JPEG, WEBP or GIF · max ${Number(state.config?.maxUploadMB||15)} MB · uploaded to public IPFS</span></span><span class="btn btn-outline upload-choose">Choose file</span><input id="collectionCover" name="cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required></label>
  <div class="field"><label for="maxSupply">Supply cap</label><input id="maxSupply" type="number" min="1" max="1000000" value="1111" required><span class="helper">Finite cap from 1 to 1,000,000 creator-minted items.</span></div>
  <div class="inline-info">Standard collections start as creator-minted collections. Public fixed-edition minting is enabled only when a collection realm is initialized with pinned image and metadata directories; Moonbound Keepers has its own 1,111-edition setup flow below.</div>
  <div class="field"><label for="royalty">Creator royalty (%)</label><select id="royalty"><option value="2" selected>2% — recommended</option><option value="0">0% — no secondary royalty</option><option value="5">5%</option><option value="7.5">7.5%</option><option value="10">10% — protocol maximum</option></select><span class="helper">Applied by this collection's Buy contract. Royalty is separate from platform fees.</span></div>
  <label class="checkbox-row"><input id="confirmRights" type="checkbox" required><span>I own or have permission to publish this artwork and collection name. I understand that IPFS is public and immutable.</span></label>
  <div class="inline-info">${escapeHTML(transactionNote)}</div>
  <div class="fee-card">
   <div class="eyebrow" style="color:var(--lime)">Launch cost</div>
   <div class="row"><span>Collection deploy <em style="font-style:normal;color:var(--muted-2)">(config)</em></span><span>${launchFeeGnot.toLocaleString('en-US')} GNOT</span></div>
   <div class="row"><span>${isAdmin?'Admin wallet override':'Your wallet'}</span><span>${due.toLocaleString('en-US')} GNOT</span></div>
   <div class="row tot"><span>Due now</span><span>${due.toLocaleString('en-US')} GNOT + gas</span></div>
   <div class="note" style="margin-top:9px">The launch fee goes to the Morrow treasury once. Gas and package storage are estimated by Adena separately. ${isAdmin?'Admin deployment: the registry contract currently requires exactly 2,000 GNOT per launch; admin fee exemption is a policy value awaiting contract support.':'Fee is a server config value.'}</div>
  </div>
  <div class="panel" style="margin-top:12px"><div class="tiny-label">Launch rules · enforced in code</div><div style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
   <div class="kv"><span>Paid deploy</span><b>Register refuses a realm whose 2,000 GNOT launch fee was not settled to the registry fee sink</b></div>
   <div class="kv"><span>Free launches</span><b>None — the registry contract has no admin exemption</b></div>
   <div class="kv"><span>Slug &amp; realm</span><b>One collection per slug and per package; duplicates are rejected on-chain</b></div>
   <div class="kv"><span>Supply cap</span><b>1 to 1,000,000 items, validated by the registry</b></div>
   <div class="kv"><span>Royalty</span><b>0% to 10%, validated by the registry</b></div>
   <div class="kv"><span>Art &amp; metadata</span><b>Both IPFS directory bases must be set, or neither; non-IPFS URIs are rejected</b></div>
   <div class="kv"><span>Uploads</span><b>PNG, JPEG, WEBP or GIF only — SVG and HTML are refused — one file per request, ${Number(state.config?.maxUploadMB||15)} MB max, server rate limits on writes</b></div>
   <div class="kv"><span>Review</span><b>New collections are unverified by default and cannot be bought until a human review checks the official links</b></div>
  </div></div>
  <button class="btn btn-dark" type="submit" id="launchCollectionButton" ${(!canUpload||!state.wallet||!state.config?.transactionsEnabled||!state.config?.treasuryConfigured)?'disabled':''}>Pin to IPFS & launch collection <span>↗</span></button>
  ${!state.wallet?'<div class="inline-info">Connect Adena before creating a collection. The deployment will be signed by your own wallet.</div>':''}${!canUpload?'<div class="inline-info danger-info">IPFS upload is not configured. Set PINATA_JWT on the server; never paste a Pinata JWT into this page.</div>':''}${!state.config?.treasuryConfigured?'<div class="inline-info danger-info">Morrow treasury is not configured. Collection launch service fee collection remains disabled.</div>':''}</div></div>${createPreviewMarkup()}</form>`;
}
function renderMintForm(transactionNote,canUpload){
  const ownPaths=new Set((state.localCollections||[]).map(c=>c.path));
  const local=(state.localCollections||[]).map(c=>`<option value="${escapeHTML(c.path)}">${escapeHTML(c.name)} · Your recent launch</option>`).join('');
  const collections=(state.market.collections||[]).filter(c=>state.wallet && c.creator===state.wallet.address && !ownPaths.has(c.path)).map(c=>`<option value="${escapeHTML(c.path)}">${escapeHTML(c.name)} · creator wallet</option>`).join('');
  return `<form id="mintForm" class="form-layout"><div class="panel"><div class="form-stack"><div><div class="tiny-label">02 / Create an item</div><h3 style="margin-top:5px">Mint an NFT</h3><p style="margin-top:5px">Upload the artwork to IPFS, pin standard metadata JSON, then ask Adena to approve the Mint transaction.</p></div><div class="field"><label for="mintCollection">Collection realm *</label><select id="mintCollection" required><option value="">Choose a collection you control</option>${local}${collections}</select><span class="helper">The collection must expose a compatible Mint(cur, name, imageURL, metadataURI) method. The Morrow template exposes this interface.</span></div><div class="field"><label for="mintName">NFT name *</label><input id="mintName" required maxlength="64" placeholder="e.g. Garden Guardian #01"></div><div class="field"><label for="mintDescription">Description</label><textarea id="mintDescription" maxlength="1000" placeholder="Describe this item…"></textarea></div><label class="upload-drop" for="mintImage"><span class="upload-icon">▧</span><span><strong id="mintFileLabel">Upload artwork</strong><span>PNG, JPEG, WEBP or GIF · stored on IPFS</span></span><span class="btn btn-outline upload-choose">Choose file</span><input id="mintImage" type="file" required accept="image/png,image/jpeg,image/webp,image/gif"></label><label class="checkbox-row"><input id="mintRights" type="checkbox" required><span>I have the rights to publish this artwork and its metadata publicly.</span></label><div class="inline-info">${escapeHTML(transactionNote)}</div><button class="btn btn-dark" type="submit" ${(!canUpload||!state.wallet||!state.config?.transactionsEnabled)?'disabled':''}>Pin metadata & mint with Adena ↗</button>${!canUpload?'<div class="inline-info danger-info">Pinata is not configured. Add PINATA_JWT to the server .env.</div>':''}</div></div><aside class="preview-card"><img class="preview-image" id="mintPreview" src="${ART.moon}" alt="NFT artwork preview... (truncated for brevity)">
</aside></div></form>`;
}
function renderTrustForm(){
  return `<div class="two-col"><div class="panel"><div class="eyebrow"><span class="eyedot"></span> Trust by design</div><h3 style="margin-top:8px">IPFS is storage, not a trust certificate.</h3><p>Content addressing means the bytes referenced by a CID cannot silently change, but anyone can upload a scam, impersonation or stolen image. Morrow therefore combines pinned media with on-chain identity checks and human review.</p><div class="divider"></div><div class="safety-points"><div class="safety-row"><span class="safety-check">✓</span><span><strong>Content-addressed media.</strong> Uploaded image and metadata JSON are pinned to the public IPFS network via a server-side Pinata credential.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>Wallet-signed deployment.</strong> The user deploys the collection realm from Adena; the application never sees private keys.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>On-chain registry registration.</strong> The marketplace indexes collection realms registered in the Morrow on-chain registry, not arbitrary lookalike labels.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>Verified badge is manual.</strong> A collection is unverified by default; the badge is reserved for explicit allowlisted realm paths after review.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>Report flow.</strong> Users can report a realm for impersonation or rights abuse and moderation can review it.</span></div></div></div><div class="panel"><h3>What Morrow never asks for</h3><div class="safety-points" style="margin-top:14px"><div class="safety-row"><span class="safety-check">×</span><span>No seed phrase</span></div><div class="safety-row"><span class="safety-check">×</span><span>No private key</span></div><div class="safety-row"><span class="safety-check">×</span><span>No secret token in browser code</span></div></div></div></div>`;
}
function render(){
  const main=$('#mainContent'); updateHeader();
  switch(state.route){
   case 'explore':main.innerHTML=renderExplore();break;
   case 'collections':main.innerHTML=renderCollections();break;
   case 'collection':main.innerHTML=renderCollectionDetail();break;
   case 'item':main.innerHTML=renderItemDetail();break;
   case 'activity':main.innerHTML=renderActivity();break;
   case 'portfolio':main.innerHTML=renderPortfolio();break;
   case 'rewards':main.innerHTML=renderRewards();break;
   case 'create':main.innerHTML=renderCreate();break;
   default:main.innerHTML=renderExplore();
  }
  wireDynamicInputs();
}
function routeTo(route){state.route=route;closeModal();render();window.scrollTo({top:0,behavior:'smooth'})}
function wireDynamicInputs(){
  const sort=$('#sortSelect'); if(sort)sort.addEventListener('change',e=>{state.sort=e.target.value;render()});
  const collectionSort=$('#collectionSortSelect'); if(collectionSort)collectionSort.addEventListener('change',e=>{state.collectionSort=e.target.value;render()});
  document.querySelectorAll('[data-facet]').forEach(input=>input.addEventListener('change',()=>{
    const set=state.facetFilters[input.dataset.facet]||(state.facetFilters[input.dataset.facet]=new Set());
    if(input.checked)set.add(input.dataset.value);else set.delete(input.dataset.value);
    state.unrevealedShown=24;render();
  }));
  const name=$('#collectionName');if(name)name.addEventListener('input',()=>{const p=$('#previewName');if(p)p.textContent=name.value||'Your collection'});
  const symbol=$('#collectionSymbol');if(symbol)symbol.addEventListener('input',()=>{const p=$('#previewSymbol');if(p)p.textContent=`${symbol.value||'SYMBOL'} · Your wallet is the creator`});
  const cover=$('#collectionCover');if(cover)cover.addEventListener('change',()=>{const f=cover.files?.[0];if(!f)return;$('#coverLabel').textContent=f.name; const p=$('#collectionPreviewImage');if(p)p.src=URL.createObjectURL(f)});
  const nameMint=$('#mintName');if(nameMint)nameMint.addEventListener('input',()=>{$('#mintPreviewName').textContent=nameMint.value||'Your NFT'});
  const imgMint=$('#mintImage');if(imgMint)imgMint.addEventListener('change',()=>{const f=imgMint.files?.[0];if(!f)return;$('#mintFileLabel').textContent=f.name;$('#mintPreview').src=URL.createObjectURL(f)});
  const namespace=$('#collectionNamespace');if(namespace) namespace.value=state.wallet?.address||'';
  const globalSearch=$('#globalSearch');if(globalSearch){globalSearch.value=state.query;globalSearch.oninput=e=>{state.query=e.target.value;const pos=e.target.selectionStart;if(['explore','collections'].includes(state.route)){render();const next=$('#globalSearch');if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch{}}}};}
}
async function uploadImage(file, name){
  if(!file)throw new Error('Choose an image before continuing.');
  const form=new FormData();form.append('file',file);form.append('name',name||file.name);
  return api('/api/ipfs/image',{method:'POST',body:form});
}
async function pinMetadata(name,description,imageUri,extra={}){
  return api('/api/ipfs/metadata',{method:'POST',body:JSON.stringify({name,description,image:imageUri,attributes:extra.attributes||[]})});
}
function toUgnot(gnot){const amount=Number(gnot);if(!Number.isFinite(amount)||amount<0)throw new Error('Enter a valid non-negative GNOT amount.');const val=Math.round(amount*1_000_000);if(!Number.isSafeInteger(val))throw new Error('Amount is too large.');return val;}
function slugSafe(value){return /^[a-z][a-z0-9]{1,10}$/.test(value)}



async function loadFacets(){
  if(state.traitsLoaded)return;
  state.traitsLoaded=true;
  try{ state.traits=await api('/api/traits?collection=moonbound'); }
  catch{ state.traits={ok:false,groups:[],editions:{},total:0}; }
  if(state.route==='collection'||state.route==='item')render();
}
function traitOf(edition,type){ return (state.traits?.editions||{})[pad(edition)]?.[type]||''; }
function rarityGroups(){ return state.traits?.groups||[]; }
function rarityRank(edition){
  const group=rarityGroups().find(g=>/^rarity$/i.test(g.trait_type));if(!group)return 0;
  const index=group.values.findIndex(v=>v.value===traitOf(edition,'Rarity'));
  return index<0?0:index;
}
// Numbered editions that exist in the pinned metadata but are not minted yet. Traits are public
// in that metadata; the art is not, which is why these render as locked numbered tiles.
function unrevealedEditions(){
  const c=(state.market.collections||[]).find(x=>x.path===state.collectionPath)||{};
  const supply=Number(c.maxSupply||state.config?.moonbound?.maxSupply||1111);
  const minted=Number(c.minted||0);
  const active=Object.entries(state.facetFilters).filter(([,set])=>set&&set.size);
  const list=[];
  for(let edition=minted+1;edition<=supply;edition++){
    const traits=(state.traits?.editions||{})[pad(edition)]||{};
    if(active.some(([type,set])=>!set.has(traits[type])))continue;
    list.push({edition,traits});
  }
  if(state.collectionSort==='rar')list.sort((a,b)=>rarityRank(b.edition)-rarityRank(a.edition)||a.edition-b.edition);
  return list;
}
function renderFacetPanel(){
  if(!state.traitsLoaded)return '<div class="panel"><h3>Traits</h3><p class="note">Loading pinned trait counts…</p></div>';
  const groups=rarityGroups().filter(g=>g.values.length<=40);
  if(!groups.length)return '<div class="panel"><h3>Traits</h3><p class="note">Trait counts ship with the pinned Moonbound metadata, so they are not available for this collection. Nothing is invented to fill the panel.</p></div>';
  const body=groups.map(g=>`<div class="facet"><h4>${escapeHTML(g.trait_type)}<span>${g.values.length}</span></h4>${g.values.map(v=>`<label class="chk"><input type="checkbox" data-facet="${escapeHTML(g.trait_type)}" data-value="${escapeHTML(v.value)}" ${(state.facetFilters[g.trait_type]||new Set()).has(v.value)?'checked':''}>${escapeHTML(v.value)}<em>${num(v.count)}</em></label>`).join('')}</div>`).join('');
  const activeCount=Object.values(state.facetFilters).reduce((n,set)=>n+(set?set.size:0),0);
  return `<div class="panel"><h3>Traits · pinned metadata</h3>${body}${activeCount?`<button class="btn btn-ghost btn-sm btn-full" data-action="clear-facets">Clear ${activeCount} filter${activeCount===1?'':'s'}</button>`:''}<p class="note" style="margin-top:10px">Counts cover all ${num(state.traits?.total||0)} pinned editions, minted or not. Selection filters the numbered editions below.</p></div>`;
}
function renderCollectionStatsPanel(c){
  const minted=Number(c.minted||0),supply=Number(c.maxSupply||1111);
  return `<div class="panel"><h3>Drop status</h3><div class="kv"><span>Editions</span><b>${num(supply)}</b></div><div class="kv"><span>Minted</span><b>${num(minted)}</b></div><div class="kv"><span>Unrevealed</span><b>${num(Math.max(0,supply-minted))}</b></div><div class="kv"><span>Reveal</span><b>On mint</b></div><div class="kv"><span>Per wallet</span><b>No contract limit</b></div><div class="bar" style="margin-top:12px"><i style="width:${supply?Math.min(100,(minted/supply)*100).toFixed(1):0}%"></i></div></div>`;
}
function renderRarityView(){
  if(!state.traitsLoaded)return '<div class="panel"><p class="note">Loading pinned rarity…</p></div>';
  const groups=rarityGroups();
  if(!groups.length)return `<div class="empty-state"><h3>Rarity data unavailable</h3><p>Rarity counts ship with the pinned Moonbound metadata. This collection does not expose them, and Morrow does not guess.</p></div>`;
  return `<div class="panel"><h3>Rarity distribution · ${num(state.traits?.total||0)} pinned editions</h3>${groups.map(g=>`<div class="facet"><h4>${escapeHTML(g.trait_type)}</h4>${g.values.map(v=>`<div class="kv"><span>${escapeHTML(v.value)}</span><b>${num(v.count)} · ${((v.count/(state.traits?.total||1))*100).toFixed(1)}%</b></div>`).join('')}</div>`).join('')}<p class="note">Read from the pinned metadata that was published before the drop. Minting does not change a trait.</p></div>`;
}
function renderCollectionAboutView(c){
  return `<div class="panel"><h3>About this collection</h3><p class="note">${escapeHTML(c.description||'No description was published with the registration.')}</p><div style="margin-top:12px"><div class="kv"><span>Realm</span><b class="mono">${escapeHTML(c.path)}</b></div><div class="kv"><span>Creator</span><b class="mono">${escapeHTML(c.creator||'unknown')}</b></div><div class="kv"><span>Registration</span><b>${c.verified?'Verified through Morrow review':'Unverified — Morrow blocks purchases until a human review checks official links'}</b></div><div class="kv"><span>Marketplace fee</span><b>2.5% · settled inside the realm</b></div><div class="kv"><span>Royalty</span><b>${(Number(c.royaltyBps||0)/100).toFixed(1)}% · paid to the creator</b></div><div class="kv"><span>Metadata</span><b class="mono">${escapeHTML(c.metadataBaseURI||state.config?.moonbound?.metadataBaseUri||'not published')}</b></div></div><p class="note" style="margin-top:12px">Registry registration and IPFS persistence do not make a collection authentic. New collections are unverified by default.</p></div>`;
}
function renderCollectionItemsView(c){
  const inventory=(state.collectionItems||[]).filter(x=>!x.preview);
  const supply=Number(c.maxSupply||state.config?.moonbound?.maxSupply||1111);
  const unrevealed=unrevealedEditions();
  const shown=unrevealed.slice(0,state.unrevealedShown);
  const revealedGrid=inventory.length?`<div class="section-head" style="margin-top:0"><div><div class="eyebrow"><span class="eyedot"></span> Revealed</div><h2>${num(inventory.length)} minted editions</h2><p>Owner, price and listing state read straight from the collection realm.</p></div></div><div class="grid">${inventory.slice(0,12).map(x=>artCard({...x,preview:false})).join('')}</div>${state.collectionHasMore?`<div style="text-align:center;margin-top:18px"><button class="btn btn-ghost" data-action="load-more">Load 24 more minted</button></div>`:''}`:'';
  const filtered=Object.values(state.facetFilters).some(set=>set&&set.size);
  return `${revealedGrid}<div class="layout" style="margin-top:${inventory.length?'32px':'0'}">
   <aside class="rail">${renderFacetPanel()}${renderCollectionStatsPanel(c)}</aside>
   <div>
    <div class="section-head" style="margin-top:0"><div><div class="eyebrow"><span class="eyedot"></span> Unrevealed</div><h2>${num(unrevealed.length)} editions${filtered?' match':''}</h2><p>Traits are public in the pinned metadata; art appears the moment an edition is minted. Select traits to narrow the drop.</p></div><select class="select-control" id="collectionSortSelect" aria-label="Sort editions"><option value="ed" ${state.collectionSort==='ed'?'selected':''}>Edition: first to last</option><option value="rar" ${state.collectionSort==='rar'?'selected':''}>Rarity: rarest first</option></select></div>
    <div class="grid">${shown.length?shown.map(x=>lockedTile(x.edition,{traits:x.traits,supply})).join(''):`<div class="empty-state" style="grid-column:1/-1"><div class="empty-art">⌕</div><h3>No edition matches those filters</h3><p>Nothing in the pinned metadata carries that combination. Clear a filter to widen the search.</p>${filtered?`<button class="btn btn-outline" data-action="clear-facets">Clear filters</button>`:''}</div>`}</div>
    ${unrevealed.length>shown.length?`<div style="text-align:center;margin-top:22px"><button class="btn btn-ghost" data-action="show-more-unrevealed">Show ${num(Math.min(24,unrevealed.length-shown.length))} more editions</button></div>`:''}
   </div></div>`;
}
function renderActivityView(){
  return `<div class="empty-state"><div class="empty-art">⌁</div><h3>Morrow does not index chain events yet</h3><p>Mint and sale events live in Gno.land blocks. Rather than invent a feed, this tab stays empty until an indexer exists — every edition can be checked on Gnoscan from its item page.</p><button class="btn btn-outline" data-route="activity">Open the activity page</button></div>`;
}
function renderCollectionDetail(){
  const c=(state.market.collections||[]).find(x=>x.path===state.collectionPath);if(!c)return `<div class="empty-state"><h3>Collection unavailable</h3><button class="btn btn-outline" data-route="collections">Back to collections</button></div>`;
  const isMoonbound=c.slug==='moonbound';
  const inventory=state.collectionItems||[];
  const moon=state.config?.moonbound||{};
  const mintPriceUgnot=Number(c.mintPriceUgnot||moon.mintPriceUgnot||0);
  const mintEnabled=isMoonbound&&!!moon.mintEnabled&&Number(c.minted||0)<Number(c.maxSupply||1111);
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Collection realm</div><h1>${escapeHTML(c.name)}</h1><p>Creator ${escapeHTML(c.creator||'Unknown')} · ${escapeHTML(c.path)}</p></div><div class="heading-actions"><a class="btn btn-outline" href="${collectionLink(c.path)}" target="_blank" rel="noreferrer">View on Gno.land ↗</a>${isMoonbound&&mintEnabled?`<button class="btn btn-dark" data-action="mint-moonbound">Mint for ${displayGnot(mintPriceUgnot)} ↗</button>`:''}</div></div>
  <div class="drop-head">
   <div><div class="cover" style="background-image:url('${escapeHTML(imageSrc(c.image||'/collection-assets/images/0001.webp'))}')"></div>
   <div class="drop-id"><div class="drop-avatar"><img src="${escapeHTML(imageSrc(c.cover||'/collection-assets/images/0001.webp'))}" alt=""></div><div style="padding-bottom:6px"><div style="display:flex;align-items:center;gap:10px"><h1 style="font-size:28px">${escapeHTML(c.name)}</h1>${c.verified?'<span class="chip good">Verified</span>':''}<span class="chip ${mintEnabled?'live':''}">${mintEnabled?'Mint live':'Sold out'}</span></div><div class="note" style="margin-top:5px">By ${escapeHTML(shortAddr(c.creator))} · realm ${escapeHTML(c.path)}</div></div></div></div>
   <aside class="mint-box">
    <div class="top"><span class="chip ${mintEnabled?'live':''}">${mintEnabled?'Mint live':'Sold out'}</span><span style="margin-left:auto">${Number(c.minted||0)} / ${Number(c.maxSupply||1111)} minted</span></div>
    <div class="mint-price"><div class="l">Mint price</div><div class="v">${displayGnot(mintPriceUgnot)}</div></div>
    <div class="qty"><span class="note">Per wallet</span><span class="note">No contract limit · 1 edition per transaction</span></div>
    <div class="total"><span>Total</span><b>${displayGnot(mintPriceUgnot)}</b></div>
    <button class="btn btn-accent btn-full" id="mintBtn" data-action="mint-moonbound" ${!mintEnabled?'disabled':''}>${!mintEnabled?(Number(c.minted||0)>=Number(c.maxSupply||1111)?'Sold out':'Mint not enabled'):'Mint now ↗'}</button>
    <div style="margin-top:11px">
     <div class="fee-line"><span>Marketplace fee on resale</span><span>2.5%</span></div>
     <div class="fee-line"><span>Creator royalty</span><span>${(Number(c.royaltyBps||0)/100).toFixed(1)}%</span></div>
     <div class="fee-line"><span>Network gas + storage</span><span>estimated by Adena</span></div>
    </div>
    ${!mintEnabled?`<div class="reason-note">Minting is not available for this collection yet. The collection realm, IPFS directories and transaction settings must be configured first.</div>`:''}
   </aside>
  </div>
  <div class="stats">
   <div class="stat"><span>Items</span><b>${Number(c.maxSupply||1111).toLocaleString('en-US')}</b></div>
   <div class="stat"><span>Minted</span><b>${Number(c.minted||0).toLocaleString('en-US')}</b></div>
   <div class="stat"><span>Owners</span><b>—</b></div>
   <div class="stat"><span>Mint price</span><b>${displayGnot(mintPriceUgnot)}</b></div>
   <div class="stat"><span>Per wallet</span><b>No contract limit</b></div>
   <div class="stat"><span>Reveal</span><b>On mint</b></div>
  </div>
  <div class="tabs">${[['items','Items'],['rarity','Rarity'],['activity','Activity'],['about','About']].map(([key,label])=>`<button class="${state.collectionTab===key?'on':''}" data-action="collection-tab" data-value="${key}">${label}</button>`).join('')}</div>
  ${state.collectionTab==='rarity'?renderRarityView():state.collectionTab==='activity'?renderActivityView():state.collectionTab==='about'?renderCollectionAboutView(c):renderCollectionItemsView(c)}
  `;
}

async function api(url, options={}) {
  const res=await fetch(url,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})}});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok || data.ok===false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------------
// Interaction layer: routing, wallet actions, marketplace flows and the forms.
// ---------------------------------------------------------------------------

// The collection contract charges the buyer exactly ask + floor(ask/40) (2.5%).
function saleTotal(priceUgnot){const price=Number(priceUgnot||0);const fee=Math.floor(price/40);const total=price+fee;return {price,fee,total}}

async function refreshMarket(){
  try{
    state.market=await api('/api/market');
  }catch(e){
    // A read-only server without a configured registry answers ok:false; that is a state, not a failure.
    state.market={ok:false,collections:[],listings:[],warning:state.config?.registryError||e.message};
  }
  if(!state.market.collections)state.market.collections=[];
  if(!state.market.listings)state.market.listings=[];
  render();
  if(state.market.ok===false)toast(state.market.warning||'The Morrow registry is not reachable. The market stays empty instead of showing sample listings.','error',7000);
  else toast('Registry and listings refreshed.');
}

function openWalletModal(){
  const balances=state.balances||[];
  modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Your wallet</div><h2 class="detail-title">Your keys. Your call.</h2><p class="detail-info">Connected through Adena. Morrow keeps only this public address in the browser session and never receives your seed phrase or private key.</p><div class="detail-price"><label>Connected account</label><div class="mono" style="word-break:break-all">${escapeHTML(state.wallet.address)}</div><div class="fee-line"><span>GNOT balance</span><strong>${displayGnot((balances.find(x=>x.denom==='ugnot')||{}).amount||0)}</strong></div></div><div class="detail-actions"><button class="btn btn-dark" data-route="portfolio">Open portfolio</button><button class="btn btn-outline" data-action="refresh-wallet">Refresh</button><button class="btn btn-outline" data-action="disconnect">Disconnect page</button></div><p class="modal-note">Disconnecting removes the address from this page. It does not lock or change Adena itself.</p></div>`);
}

function currentItem(){
  const id=String(state.itemId||''); const pkg=state.itemPkg||'';
  const pool=[...(state.market.listings||[]),...(state.collectionItems||[]),...((state.portfolio&&state.portfolio.tokens)||[])];
  return pool.find(x=>sameId(x.id,id)&&x.collectionPath===pkg)
    || {id:String(Number(id)||0),collectionPath:pkg,name:(state.itemMeta&&state.itemMeta.name)||`Edition ${pad(Number(id)||0)}`,priceUgnot:0,listed:false,owner:''};
}

async function openItemPage(id,pkg){
  const pool=[...(state.collectionItems||[]),...(state.market.listings||[]),...((state.portfolio&&state.portfolio.tokens)||[])];
  const known=pool.find(x=>sameId(x.id,id)&&(!pkg||x.collectionPath===pkg));
  const path=pkg||state.config?.moonbound?.collectionPath||'';
  const minted=Number(((state.market.collections||[]).find(c=>c.path===path)||{}).minted||0);
  const padded=pad(Number(id)||0);
  let meta=known?{name:known.name,image:known.image,attributes:null}:null;
  // Unminted editions stay locked by design, so local art only fills in for an already-minted edition
  // that sits outside the loaded inventory page.
  if(!meta&&path&&Number(id)<=minted){
    try{const r=await fetch(metaUri(padded));meta=r.ok?await r.json():null}catch{meta=null}
    // Pinned JSON still carries the IMAGE_DIRECTORY_CID placeholder until the directories are pinned;
    // the numbered asset served from this build is the same artwork, so show it instead of a dead gateway URL.
    if(meta&&/IMAGE_DIRECTORY_CID/.test(String(meta.image||'')))meta.image=imageUri(padded);
  }
  state.route='item'; state.itemId=padded; state.itemPkg=path; state.itemMeta=meta;
  loadFacets();
  closeModal(); render(); window.scrollTo({top:0,behavior:'smooth'});
}

async function openMoonboundDrop(){
  const path=state.config?.moonbound?.collectionPath||'';
  if(path&&(state.market.collections||[]).some(c=>c.path===path)){await openCollection(path);return}
  routeTo('create');
  toast('Moonbound Keepers is not registered yet. The creator studio lists the exact launch requirements.');
}

async function buyItem(nft){
  if(!nft||!nft.listed||!nft.collectionPath)throw new Error('That item is not an active on-chain listing.');
  if(!state.wallet)throw new Error('Connect Adena before buying an NFT.');
  if(!state.config?.transactionsEnabled)throw new Error('Buying is paused until the Morrow registry, treasury and explicit network-write setting are configured.');
  const {price,fee,total}=saleTotal(nft.priceUgnot);
  modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Secure checkout · Adena</div><h2 class="detail-title">One last look.</h2><p class="detail-info">You are about to buy <strong>${escapeHTML(nft.name||'this edition')}</strong>. Morrow submits one contract call; the collection realm transfers the NFT and settles seller, royalty and its 2.5% fee in the same transaction.</p><div class="detail-price"><label>Total sent from your wallet (excluding network gas)</label><strong>${displayGnot(total)}</strong><div class="fee-breakdown"><div class="fee-line"><span>Seller asking price</span><strong>${displayGnot(price)}</strong></div><div class="fee-line"><span>Morrow sale fee · 2.5%</span><strong>${displayGnot(fee)}</strong></div><div class="fee-line"><span>Creator royalty</span><strong>${(Number(nft.royaltyBps||0)/100).toFixed(1)}% of the ask, paid by the seller side</strong></div></div></div><div class="detail-actions"><button class="btn btn-dark" data-action="confirm-buy" data-id="${escapeHTML(String(nft.id))}" data-path="${escapeHTML(nft.collectionPath)}">Buy with Adena ↗</button><button class="btn btn-outline" data-action="close-modal">Not now</button></div><p class="modal-note">Confirm the exact amount and realm in Adena before approving. Morrow never takes custody.</p></div>`);
}

async function executeBuy(id,pkg){
  const nft=(state.market.listings||[]).find(x=>x.collectionPath===pkg&&sameId(x.id,id));
  if(!nft)throw new Error('That listing is no longer open. Refresh the market.');
  const {total}=saleTotal(nft.priceUgnot);
  setBusy(true);
  try{
    const result=await sendTx([transactionMessage(pkg,'Buy',[String(nft.id)],`${total}ugnot`)],`Morrow purchase: ${nft.name}`);
    closeModal();
    toast('Purchase submitted to Adena. The collection realm moves the NFT once the transaction confirms.','ok',8000);
    if(result.hash)verifyPoints(result.hash);
    await refreshMarket(); await refreshWalletData(); render();
  } finally { setBusy(false) }
}

function openListing(nft){
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!state.config?.transactionsEnabled)throw new Error('Listing is paused by the current network configuration.');
  if(!nft||!nft.collectionPath)throw new Error('This item is not from a supported on-chain collection.');
  state.nft=nft;
  modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Fixed-price listing</div><h2 class="detail-title">Put it on the floor.</h2><p class="detail-info">Your NFT moves into the collection contract's escrow. You can cancel later to return it to your wallet as long as it has not sold.</p><div class="field"><label for="listingPrice">Asking price (GNOT)</label><input id="listingPrice" type="number" min="0.000001" step="0.000001" value="10" required><span class="helper">The contract requires a positive fixed price. Morrow charges no listing fee.</span></div><div class="detail-price"><div class="fee-line"><span>Morrow listing fee</span><strong>0%</strong></div><div class="fee-line"><span>Buyer pays on sale</span><strong>2.5% Morrow fee, on top of your ask</strong></div><div class="fee-line"><span>Creator royalty</span><strong>Deducted from your proceeds by the contract</strong></div></div><label class="checkbox-row"><input id="listingConfirm" type="checkbox" required><span>I understand the NFT is escrowed by this collection contract until it sells or I cancel.</span></label><div class="detail-actions"><button class="btn btn-dark" data-action="submit-listing">Approve listing in Adena ↗</button><button class="btn btn-outline" data-action="close-modal">Not now</button></div></div>`);
}

async function submitListing(){
  if(!state.nft)throw new Error('Choose an NFT to list.');
  if(!$('#listingConfirm')?.checked)throw new Error('Confirm the escrow notice before listing.');
  const price=toUgnot($('#listingPrice')?.value||0);
  if(price<=0)throw new Error('Listing price must be greater than zero.');
  const nft=state.nft;
  setBusy(true);
  try{
    const result=await sendTx([transactionMessage(nft.collectionPath,'List',[String(nft.id),String(price)])],`Morrow listing: ${nft.name}`);
    closeModal(); toast('Listing submitted. It appears in the market once the transaction confirms.');
    if(result.hash)verifyPoints(result.hash);
    await refreshMarket(); await refreshWalletData(); render();
  } finally { setBusy(false) }
}

async function cancelListing(nft){
  if(!nft||!nft.collectionPath)throw new Error('This item is not a supported on-chain listing.');
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!state.config?.transactionsEnabled)throw new Error('Cancelling is paused by the current network configuration.');
  setBusy(true);
  try{
    await sendTx([transactionMessage(nft.collectionPath,'Cancel',[String(nft.id)])],`Morrow cancel listing: ${nft.name}`);
    toast('Cancel submitted. The collection realm returns the NFT after confirmation.');
    await refreshMarket(); await refreshWalletData(); render();
  } finally { setBusy(false) }
}

async function mintPublicEdition(){
  const moon=state.config?.moonbound||{}; const pkg=moon.collectionPath||'';
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!moon.mintEnabled||!pkg)throw new Error('Public minting is not enabled by this server yet.');
  setBusy(true);
  try{
    const result=await sendTx([transactionMessage(pkg,'PublicMint',[],`${Number(moon.mintPriceUgnot)}ugnot`)],`${moon.name} public mint`);
    toast('Mint submitted to Adena. Editions are minted in transaction order, so your number is assigned on-chain.','ok',8000);
    if(result.hash)verifyPoints(result.hash);
    await refreshMarket(); await refreshWalletData(); render();
  } finally { setBusy(false) }
}

async function contractSource(route,label,replacements){
  const res=await fetch(route);
  if(!res.ok)throw new Error(`Could not load the ${label} source from this server.`);
  let source=await res.text();
  for(const [from,to] of Object.entries(replacements))source=source.replaceAll(from,to);
  return source;
}

async function launchCollection(form){
  if(!state.wallet)throw new Error('Connect Adena before creating a collection.');
  if(!state.config?.transactionsEnabled)throw new Error('Collection deployment is paused while transactions are disabled for this network.');
  if(!state.config?.pinningConfigured)throw new Error('IPFS pinning is not configured. Set PINATA_JWT on the server.');
  const fd=new FormData(form);
  const name=String(fd.get('name')||'').trim();
  const symbol=String(fd.get('symbol')||'').trim().toUpperCase();
  const slug=String(fd.get('slug')||'').trim();
  const namespace=String(fd.get('namespace')||'').trim();
  const description=String(fd.get('description')||'').trim();
  const coverFile=$('#collectionCover')?.files?.[0];
  const maxSupply=Number($('#maxSupply')?.value);
  const royaltyBps=Math.round(Number($('#royalty')?.value||0)*100);
  if(!name||name.length>64)throw new Error('Collection name must be between 1 and 64 characters.');
  if(!/^[A-Z0-9]{1,11}$/.test(symbol))throw new Error('Symbol must contain 1–11 letters or numbers.');
  if(!slugSafe(slug))throw new Error('Slug must be lowercase, start with a letter and contain 2–11 letters/numbers.');
  if(!/^[a-zA-Z0-9._-]{2,80}$/.test(namespace)||namespace.includes('..'))throw new Error('Connect Adena so your realm namespace is filled in.');
  if(!Number.isInteger(maxSupply)||maxSupply<1||maxSupply>1_000_000)throw new Error('Supply must be from 1 to 1,000,000.');
  if(!coverFile)throw new Error('Choose a cover image.');
  if(!$('#confirmRights')?.checked)throw new Error('Confirm that you own or have permission to publish this artwork.');
  const protectedNames=['guardians','gno foundation','gno land','adena','gnoscan','morrow marketplace','opensea','rarible'];
  const normalizedName=name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  if(protectedNames.some(term=>normalizedName===term||normalizedName.startsWith(term+' ')))throw new Error('This name is reserved in Morrow to reduce brand impersonation. Use the official project link instead.');
  const levenshtein=(a,b)=>{const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return row[b.length]};
  const collision=(state.market.collections||[]).find(c=>{const existing=String(c.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(existing===normalizedName)return true;const maxLen=Math.max(existing.length,normalizedName.length);return maxLen>=8&&1-levenshtein(existing,normalizedName)/maxLen>=0.88});
  if(collision)throw new Error(`This name is identical or too close to the registered collection ${collision.name} (${collision.path}). Choose a clearly distinct identity.`);
  if((state.market.collections||[]).some(c=>c.slug===slug))throw new Error('That realm slug is already registered. Choose another one.');
  const pkgPath=`gno.land/r/${namespace}/${slug}`;
  const button=$('#launchCollectionButton');
  setBusy(true); if(button)button.textContent='Pinning cover and metadata to IPFS…';
  try{
    const cover=await uploadImage(coverFile,`${slug}-cover`);
    const manifest=await pinMetadata(name,description,cover.uri,{attributes:[{trait_type:'Network',value:state.config.chainId}]});
    const source=await contractSource('/api/contracts/collection-template','collection contract',{'__PACKAGE__':slug,'__REGISTRY_PATH__':String(state.config.registryPath||'')});
    const launchFee=Number(state.config.collectionServiceFeeUgnot||2_000_000_000);
    const messages=[
      {type:'/vm.m_addpkg',value:{creator:state.wallet.address,deposit:'1ugnot',package:{name:slug,path:pkgPath,files:[{name:`${slug}.gno`,body:source}]}}},
      transactionMessage(pkgPath,'Init',[name,symbol,cover.gatewayUrl,manifest.uri,String(maxSupply),'0',String(royaltyBps),'',''],`${launchFee}ugnot`)
    ];
    if(button)button.textContent='Waiting for Adena approval…';
    const result=await sendTx(messages,'Morrow collection launch — package, IPFS metadata and the fixed GNOT launch fee');
    state.localCollections.unshift({name,symbol,slug,path:pkgPath,image:cover.gatewayUrl,metadataURI:manifest.uri,txHash:result.hash});
    state.localCollections=state.localCollections.slice(0,40);
    localStorage.setItem('morrow_created_collections',JSON.stringify(state.localCollections));
    if(result.hash)state.txHistory.unshift({hash:result.hash,type:'Collection launch',time:Date.now()});
    toast('Launch submitted to Adena. The collection appears in the registry after the transaction confirms.','ok',9000);
    if(result.hash)verifyPoints(result.hash);
    await refreshMarket(); state.activeCreateTab='mint'; render();
  } finally { setBusy(false) }
}

async function mintNFT(form){
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!state.config?.transactionsEnabled)throw new Error('Transactions are currently disabled for this network.');
  if(!state.config?.pinningConfigured)throw new Error('IPFS pinning is not configured.');
  const pkg=$('#mintCollection')?.value;
  const name=($('#mintName')?.value||'').trim();
  const desc=($('#mintDescription')?.value||'').trim();
  const file=$('#mintImage')?.files?.[0];
  if(!pkg||!name||!file)throw new Error('Choose a collection, a name and an image.');
  if(!$('#mintRights')?.checked)throw new Error('Confirm that you have the rights to publish this artwork.');
  setBusy(true);
  try{
    const image=await uploadImage(file,`${name.replace(/[^a-zA-Z0-9-_]/g,'-')}-artwork`);
    const metadata=await pinMetadata(name,desc,image.uri);
    const result=await sendTx([transactionMessage(pkg,'Mint',[name,image.gatewayUrl,metadata.uri])],`Morrow mint: ${name}`);
    toast('Mint submitted to Adena. The item appears after the transaction confirms.');
    if(result.hash)verifyPoints(result.hash);
    await refreshMarket(); await refreshWalletData(); render();
  } finally { setBusy(false) }
}

async function launchMoonbound(){
  const moon=state.config?.moonbound||{};
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!moon.launchEnabled)throw new Error('Moonbound launch is not enabled yet. The server needs the live registry, treasury, IPFS pinning and both pinned IPFS directory URIs.');
  const slug='moonbound';
  const pkgPath=`gno.land/r/${state.wallet.address}/${slug}`;
  const imageBase=String(moon.imageBaseUri||'');
  const metadataBase=String(moon.metadataBaseUri||'');
  setBusy(true);
  try{
    const cover=`${imageBase}/0001.webp`;
    const manifest=await pinMetadata(moon.name,'Moonbound Keepers — 1,111 fixed editions on Gno.land.',cover,{attributes:[{trait_type:'Network',value:state.config.chainId},{trait_type:'Editions',value:String(moon.maxSupply)}]});
    const source=await contractSource('/api/contracts/collection-template','collection contract',{'__PACKAGE__':slug,'__REGISTRY_PATH__':String(state.config.registryPath||'')});
    const launchFee=Number(state.config.collectionServiceFeeUgnot||2_000_000_000);
    const messages=[
      {type:'/vm.m_addpkg',value:{creator:state.wallet.address,deposit:'1ugnot',package:{name:slug,path:pkgPath,files:[{name:`${slug}.gno`,body:source}]}}}
    ];
    messages.push(transactionMessage(pkgPath,'Init',[moon.name,moon.symbol,cover,manifest.uri,String(moon.maxSupply),String(Number(moon.mintPriceUgnot)),'250',imageBase,metadataBase],`${launchFee}ugnot`));
    const result=await sendTx(messages,'Moonbound Keepers launch — package, IPFS bases and the fixed GNOT launch fee');
    toast(`Moonbound launch submitted. After confirmation set MOONBOUND_COLLECTION_PATH=${pkgPath} in .env and restart the server.`,'ok',12000);
    if(result.hash)state.txHistory.unshift({hash:result.hash,type:'Moonbound launch',time:Date.now()});
    await refreshMarket(); render();
  } finally { setBusy(false) }
}

async function bootstrapRegistry(){
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!state.config?.bootstrapEnabled)throw new Error('Registry deployment is disabled. Set MORROW_TREASURY_ADDRESS and explicitly enable writes for this network.');
  const treasury=String(state.config.treasuryAddress||'');
  if(!treasury)throw new Error('MORROW_TREASURY_ADDRESS is not configured on this server.');
  const slug='morrowmarket';
  const pkgPath=`gno.land/r/${state.wallet.address}/${slug}`;
  setBusy(true);
  try{
    const source=await contractSource('/api/contracts/registry-template','Morrow registry',{});
    const messages=[
      {type:'/vm.m_addpkg',value:{creator:state.wallet.address,deposit:'1ugnot',package:{name:slug,path:pkgPath,files:[{name:`${slug}.gno`,body:source}]}}},
      transactionMessage(pkgPath,'Init',[treasury])
    ];
    const result=await sendTx(messages,'Morrow registry deployment — wallet-signed',true);
    toast(`Registry deployment submitted. After it confirms, set MORROW_REGISTRY_PATH=${pkgPath} in .env and restart the server.`,'ok',14000);
    if(result.hash)state.txHistory.unshift({hash:result.hash,type:'Registry deployment',time:Date.now()});
  } finally { setBusy(false) }
}

async function verifyPointsForm(){
  const hash=($('#rewardTxHash')?.value||'').trim();
  if(!hash)throw new Error('Paste the transaction hash first.');
  if(!state.wallet)throw new Error('Connect Adena first.');
  const result=await api('/api/rewards/verify',{method:'POST',body:JSON.stringify({address:state.wallet.address,txHash:hash})});
  await refreshWalletData(); render();
  toast(result.awarded?`+${result.awarded} Morrow points · ${result.label||'verified action'}`:'That transaction was already claimed.');
}

document.addEventListener('click',async event=>{
  const route=event.target.closest('[data-route]');
  if(route){event.preventDefault();routeTo(route.dataset.route);return}
  if(event.target.closest('a[href="#explore"]')){event.preventDefault();routeTo('explore');return}
  const action=event.target.closest('[data-action]');
  if(action){
    event.preventDefault();
    try{
      switch(action.dataset.action){
        case 'close-modal':{closeModal();return}
        case 'backdrop':{if(event.target===action)closeModal();return}
        case 'connect':{await connectWallet();return}
        case 'disconnect':{closeModal();disconnectWallet();return}
        case 'refresh-wallet':{await refreshWalletData();render();toast('Wallet data refreshed.');return}
        case 'refresh-market':{await refreshMarket();return}
        case 'status':{state.status=action.dataset.value||'all';render();return}
        case 'favorite':{
          const key=favKey(action.dataset.id);
          if(state.favorites.has(key))state.favorites.delete(key);else state.favorites.add(key);
          localStorage.setItem('morrow_favorites',JSON.stringify([...state.favorites]));render();return;
        }
        case 'create-tab':{state.activeCreateTab=action.dataset.value||'collection';render();return}
        case 'portfolio-tab':{state.activePortfolioTab=action.dataset.value||'nfts';render();return}
        case 'open-collection':{await openCollection(action.dataset.path);return}
        case 'open-moonbound-drop':{await openMoonboundDrop();return}
        case 'load-more':{await loadCollectionItems(false);return}
        case 'show-more-unrevealed':{state.unrevealedShown+=24;render();return}
        case 'collection-tab':{state.collectionTab=action.dataset.value||'items';render();return}
        case 'clear-facets':{state.facetFilters={};state.unrevealedShown=24;render();return}
        case 'mint-item': case 'mint-moonbound':{await mintPublicEdition();return}
        case 'launch-moonbound':{await launchMoonbound();return}
        case 'bootstrap-registry':{await bootstrapRegistry();return}
        case 'verify-points':{await verifyPointsForm();return}
        case 'buy-item':{await buyItem(currentItem());return}
        case 'confirm-buy':{await executeBuy(action.dataset.id,action.dataset.path);return}
        case 'list-item':{openListing(currentItem());return}
        case 'cancel-item':{await cancelListing(currentItem());return}
        case 'submit-listing':{await submitListing();return}
        default:return;
      }
    }catch(err){toast(err.message||'That action failed.','error',7500)}
    return;
  }
  const card=event.target.closest('[data-open-nft]');
  if(card){await openItemPage(card.dataset.openNft,card.dataset.collectionPath||'');return}
});

document.addEventListener('submit',async event=>{
  if(event.target.id==='collectionForm'){event.preventDefault();try{await launchCollection(event.target)}catch(err){toast(err.message||'Collection creation failed.','error',7500)}return}
  if(event.target.id==='mintForm'){event.preventDefault();try{await mintNFT(event.target)}catch(err){toast(err.message||'Mint failed.','error',7500)}return}
});

$('#walletButton').addEventListener('click',connectWallet);
$('#mobileMenu').addEventListener('click',()=>$('.main-nav').classList.toggle('open'));
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closeModal();
  if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){event.preventDefault();$('#globalSearch').focus()}
});

bootstrap();

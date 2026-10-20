const ART = {
  moon: '/collection-assets/images/0001.webp',
  glass: '/assets/art/glass-spirit.webp',
  sun: '/assets/art/sun-orbit.webp',
  frog: '/assets/art/frog-cosmos.webp',
  keepers: '/collection-assets/images/0001.webp'
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
  itemMeta:null, itemId:null, itemPkg:null, activePortfolioTab:'nfts',
  gallery:{query:'',rarity:'all',traitType:'all',traitValue:'all',sort:'ed',status:'all',limit:6},
  trending:'all', mintsUsed:0, upcomingFilter:'all', upcomingSort:'time-asc'
};

const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortAddr = a => a ? `${a.slice(0,7)}…${a.slice(-5)}` : '';
const displayGnot = ugnot => `${(Number(ugnot||0)/1_000_000).toLocaleString('en-US',{maximumFractionDigits:4})} GNOT`;
const slugOf = p => String(p||'').split('/').pop() || '';
const imageSrc = url => {
  if (!url || typeof url !== 'string') return ART.moon;
  if (url.startsWith('/collections/') || url.startsWith('/assets/') || url.startsWith('/collection-assets/') || /^https:\/\//i.test(url)) return url;
  if (url.startsWith('ipfs://')) {
    if (url.includes('PENDING_IMAGE_CID') || url.includes('bafybeiowl') || url.includes('bafybeitrees') || url.includes('bafybeineonsouls')) {
      const parts = url.split('/');
      const filename = parts.pop() || '';
      if (url.includes('owl')) return `/collections/owl-collection/images/${filename}`;
      if (url.includes('trees')) return `/collections/the-trees/images/${filename}`;
      if (url.includes('neonsouls') || url.includes('souls')) return `/collections/neon-souls/images/${filename}`;
    }
    const g = (state.config?.collectionGateway || state.config?.pinataGateway || 'https://ipfs.io/ipfs/').replace(/\/$/,'');
    return g + '/' + url.slice(7).replace(/^ipfs\//,'');
  }
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
  node.textContent=text; const pulse=$('.status-pulse'); if(pulse) pulse.style.background=tone==='bad'?'#E66C76':tone==='good'?'#7BC8A4':'#405CFF';
}
// Only operator-configured https links or official project fallbacks reach the DOM.
function socialLinksMarkup(){
  const socials = state.config?.socials || {};
  const x = (typeof socials.x === 'string' && /^https:\/\//i.test(socials.x)) ? socials.x : 'https://x.com/gnoland';
  const gh = (typeof socials.github === 'string' && /^https:\/\//i.test(socials.github)) ? socials.github : 'https://github.com/gnolang/gno';
  return [
    `<a class="footer-social" href="${escapeHTML(x)}" target="_blank" rel="noopener noreferrer" aria-label="Gnotbook on X" title="X"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.78 7.75L23.2 22h-6.25l-4.9-7.42L5.56 22H2.43l7.25-8.29L1.8 2h6.41l4.43 6.77L18.9 2Zm-1.1 17.86h1.73L7.27 4.03H5.42L17.8 19.86Z"/></svg></a>`,
    `<a class="footer-social" href="${escapeHTML(gh)}" target="_blank" rel="noopener noreferrer" aria-label="Gnotbook on GitHub" title="GitHub"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.68-3.75-1.31-3.75-1.31-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.63 1.21 3.27.92.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.11-1.44 3.05-1.14 3.05-1.14.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3.01 0 4.29-2.61 5.23-5.1 5.51.4.35.75 1.02.75 2.06v3.07c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg></a>`
  ];
}
function renderFooterSocials() {
  const host = $('#footerSocials'); if(!host) return;
  const links = socialLinksMarkup();
  host.innerHTML = links.join('');
  host.hidden = links.length === 0;
}
function updateHeader() {
  const btn=$('#walletButtonText'); const walletButton=$('#walletButton');
  const netName=$('#activeNetworkName');
  if(netName) netName.textContent = state.activeNetwork === 'atomone' ? 'AtomOne' : 'Gno.land';
  if(state.wallet){
    const icon = state.wallet.network === 'atomone' ? '⚛ ' : '⚡ ';
    btn.textContent = icon + shortAddr(state.wallet.address);
    walletButton.title = state.wallet.address;
    walletButton.classList.add('connected');
  }
  else {btn.textContent='Connect wallet';walletButton.title='Connect wallet';walletButton.classList.remove('connected')}
  $$('.nav-link').forEach(x=>{const active=x.dataset.route===state.route || (state.route==='collection'&&x.dataset.route==='collections') || (state.route==='item'&&x.dataset.route==='explore');x.classList.toggle('active',active);if(active)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')});
}
async function bootstrap() {
  try { state.config=await api('/api/config'); }
  catch(e) { state.config={chainId:'gnoland-1',registryConfigured:false,bootstrapEnabled:false,tradingEnabled:false,transactionsEnabled:false,treasuryConfigured:false,pinningConfigured:false,collectionServiceFeeUgnot:5_000_000,marketplaceFeeBps:250,adminWallet:'',launchFeeGnot:5,moonbound:{name:'GNO PUNK',symbol:'GNP',maxSupply:1000,mintPriceUgnot:5_000_000,mintEnabled:false,assetsConfigured:false,collectionPath:''},points:{buy:10,list:5,mint:8,launch:15,cancel:2}}; toast('Marketplace settings are not reachable; read-only mode is active.','error'); }
  try { state.market=await api('/api/market'); } catch(e) {state.market={collections:[],listings:[],ok:false,error:e.message}}
  if(!state.market.collections)state.market.collections=[]; if(!state.market.listings)state.market.listings=[];
  if(sessionStorage.getItem('morrow_wallet')) {
    try { const saved=JSON.parse(sessionStorage.getItem('morrow_wallet')); if(saved?.address) {state.wallet=saved; await refreshWalletData();} } catch {sessionStorage.removeItem('morrow_wallet')}
  }
  await loadFacets();
  await restoreRouteLocation(); updateHeader(); renderFooterSocials();
  const interval=setInterval(async()=>{ try{state.market=await api('/api/market'); if(['explore','market','collections','activity','rewards','portfolio','collection','create','item','upcoming'].includes(state.route))render();}catch{} },60_000);
  window.addEventListener('beforeunload',()=>clearInterval(interval),{once:true});
}
// The contract caps public mints per wallet. The limit is read from the chain, so the UI can never
// promise more than the contract enforces, and the used count comes from MintsByWallet.
function walletMintLimit(){return Number(state.config?.moonbound?.mintsPerWallet||0)}
function walletMintCapReached(){const limit=walletMintLimit();return !!state.wallet&&limit>0&&Number(state.mintsUsed||0)>=limit}
function walletMintAllowanceCopy(){
  const limit=walletMintLimit();
  if(!limit)return 'Not published';
  return state.wallet?`Max ${limit} per wallet · ${Number(state.mintsUsed||0)}/${limit} used`:`Max ${limit} per wallet`;
}
async function refreshMintAllowance(){
  const pkg=String(state.config?.moonbound?.collectionPath||'');
  if(!pkg||!state.wallet?.address){state.mintsUsed=0;return}
  const used=await realmRead(pkg,'MintsByWallet',[state.wallet.address]);
  state.mintsUsed=Number(used)||0;
}
async function refreshWalletData() {
  if(!state.wallet?.address)return;
  const addr=state.wallet.address;
  const tasks=await Promise.allSettled([
    api(`/api/wallet/${encodeURIComponent(addr)}/balances`),
    api(`/api/portfolio/${encodeURIComponent(addr)}`),
    api(`/api/points/${encodeURIComponent(addr)}`),
    refreshMintAllowance()
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
function openNetworkModal(){
  modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Network &amp; Wallets</div><h2 class="detail-title">Choose your ecosystem</h2><p class="detail-info">Gnotbook connects seamlessly to Gno.land via Adena and AtomOne via Keplr.</p>
  <div class="network-cards" style="display:flex;flex-direction:column;gap:12px;margin:20px 0">
    <div class="network-card ${state.activeNetwork==='gnoland'?'selected':''}" style="display:flex;align-items:center;justify-content:space-between;padding:16px;border:1px solid var(--line-2);border-radius:12px;background:var(--panel-2)">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:24px">⚡</span>
        <div><b>Gno.land Mainnet</b><small style="display:block;color:var(--muted)">Adena Wallet · GNOT currency · GRC721</small></div>
      </div>
      <button class="btn btn-sm btn-dark" data-action="connect-adena">Connect Adena</button>
    </div>
    <div class="network-card ${state.activeNetwork==='atomone'?'selected':''}" style="display:flex;align-items:center;justify-content:space-between;padding:16px;border:1px solid var(--line-2);border-radius:12px;background:var(--panel-2)">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:24px">⚛</span>
        <div><b>AtomOne IBC Chain</b><small style="display:block;color:var(--muted)">Keplr Wallet · ATONE currency · Cosmos SDK</small></div>
      </div>
      <button class="btn btn-sm btn-dark" data-action="connect-keplr">Connect Keplr</button>
    </div>
  </div>
  <button class="btn btn-outline btn-full" data-action="close-modal">Close</button>
  </div>`);
}

async function connectKeplr(){
  closeModal();
  if(!window.keplr){
    modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Keplr Wallet</div><h2 class="detail-title">Keplr is needed</h2><p class="detail-info">To interact with AtomOne, install Keplr from the official website or Chrome Web Store.</p><div class="detail-actions"><a class="btn btn-dark" href="https://www.keplr.app/download" target="_blank" rel="noreferrer">Get Keplr ↗</a><button class="btn btn-outline" data-action="close-modal">Not now</button></div></div>`);
    return;
  }
  try{
    const chainId='atomone-1';
    try{
      await window.keplr.enable(chainId);
    }catch(err){
      if(window.keplr.experimentalSuggestChain){
        await window.keplr.experimentalSuggestChain({
          chainId:'atomone-1',
          chainName:'AtomOne Mainnet',
          rpc:'https://rpc.atomone.helixbox.io',
          rest:'https://api.atomone.helixbox.io',
          bip44:{coinType:118},
          bech32Config:{
            bech32PrefixAccAddr:'atone',
            bech32PrefixAccPub:'atonepub',
            bech32PrefixValAddr:'atonevaloper',
            bech32PrefixValPub:'atonevaloperpub',
            bech32PrefixConsAddr:'atonevalcons',
            bech32PrefixConsPub:'atonevalconspub'
          },
          currencies:[{coinDenom:'ATONE',coinMinimalDenom:'uatone',coinDecimals:6}],
          feeCurrencies:[{coinDenom:'ATONE',coinMinimalDenom:'uatone',coinDecimals:6,gasPriceStep:{low:0.025,average:0.03,high:0.04}}],
          stakeCurrency:{coinDenom:'ATONE',coinMinimalDenom:'uatone',coinDecimals:6}
        });
        await window.keplr.enable(chainId);
      }
    }
    const key=await window.keplr.getKey(chainId);
    state.activeNetwork='atomone';
    sessionStorage.setItem('morrow_network','atomone');
    state.wallet={address:key.bech32Address,name:key.name||'Keplr',chainId:'atomone-1',network:'atomone'};
    state.balances=[{denom:'uatone',amount:'1000000'}];
    sessionStorage.setItem('morrow_wallet',JSON.stringify(state.wallet));
    updateHeader(); render(); toast(`Connected Keplr on AtomOne: ${shortAddr(key.bech32Address)}`,'ok');
  }catch(e){toast(e.message||'Keplr connection failed.','error')}
}

async function connectAdena(){
  closeModal();
  const adena=window.adena;
  if(!adena){modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Wallet connection</div><h2 class="detail-title">Adena is needed</h2><p class="detail-info">Gnotbook never asks for a seed phrase or private key. Install Adena from its official site, create or import a wallet there, then come back and connect it.</p><div class="detail-actions"><a class="btn btn-dark" href="https://adena.app/" target="_blank" rel="noreferrer">Get Adena ↗</a><button class="btn btn-outline" data-action="close-modal">Not now</button></div><p class="modal-note">Only approve transactions that clearly show the intended Gno.land realm, price, fee and destination.</p></div>`);return}
  try{
    let establish;
    if(typeof adena.AddEstablish==='function') establish=await adena.AddEstablish('Gnotbook NFT Marketplace');
    // Adena reports an account that already approved this site as a failure. The session is still
    // usable, and GetAccount below proves it, so only a real rejection may stop the connection.
    if((establish?.status==='failure'||establish?.code>0)&&!/already connected/i.test(String(establish.message||''))) throw new Error(establish.message||'Wallet connection was rejected.');
    const result=typeof adena.GetAccount==='function'?await adena.GetAccount():null;
    const data=result?.data||result?.account||result||{};
    const address=data.address||data.account?.address||data.account_address||result?.address;
    if(!address) throw new Error('Adena did not return a wallet address. Unlock Adena and try again.');
    state.activeNetwork='gnoland';
    sessionStorage.setItem('morrow_network','gnoland');
    state.wallet={address,network:null,connectedAt:Date.now()};
    try{if(typeof adena.GetNetwork==='function'){const n=await adena.GetNetwork();state.wallet.network=(n?.data||n)?.chainId||(n?.data||n)?.chain_id||''}}catch{}
    sessionStorage.setItem('morrow_wallet',JSON.stringify(state.wallet));
    await refreshWalletData(); render(); toast(`Connected ${shortAddr(address)}. Your keys stay in Adena.`);
  }catch(e){toast(e.message||'Wallet connection failed.','error')}
}

async function connectWallet() {
  if(state.wallet){openWalletModal();return}
  openNetworkModal();
}
function disconnectWallet(){state.wallet=null;state.balances=[];state.portfolio={collections:[],tokens:[]};state.points={total:0,events:[]};sessionStorage.removeItem('morrow_wallet');updateHeader();render();toast('Wallet disconnected from this page. Adena remains in control of your keys.')}
async function sendTx(messages,memo='Gnotbook marketplace transaction',allowBootstrap=false) {
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
  if(activeChain!==state.config?.chainId) throw new Error(`Network mismatch: this Gnotbook server is configured for ${state.config?.chainId}, but Adena is on ${activeChain}. Switch networks before signing.`);
  state.wallet.network=activeChain;
  let response;
  try { response=await adena.DoContract({messages,memo}); }
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
      if(result.awarded)toast(`+${result.awarded} Gnotbook points · ${result.label}`);
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
  const fallbackArt = (nft.collectionPath && !/moonbound$/i.test(nft.collectionPath)) ? ART.glass : ART.moon;
  return `<article class="nft-card" data-open-nft="${escapeHTML(String(nft.id))}" data-preview="${nft.preview?'1':'0'}" data-collection-path="${escapeHTML(nft.collectionPath||'')}">
   <div class="nft-image-wrap"><img loading="lazy" class="nft-image" src="${escapeHTML(imageSrc(nft.image))}" alt="${escapeHTML(nft.name||'NFT collectible')}" onerror="this.onerror=null;this.src='${fallbackArt}'">${badge}<button class="favorite-btn ${favorite?'active':''}" data-action="favorite" data-id="${escapeHTML(String(nft.id))}" aria-label="Toggle favorite">${favorite?'♥':'♡'}</button></div>
   <div class="nft-meta"><div class="nft-title-row"><div style="min-width:0"><h3 class="nft-title">${escapeHTML(nft.name)}</h3><p class="nft-collection"><span class="card-collection-dot"></span>${escapeHTML(nft.collectionName||'Gno.land collection')}</p></div></div>
   <div class="nft-price"><div><div class="price-label">${real&&nft.listed?'Current price':'Status'}</div></div>${price}</div></div>
 </article>`;
}

function lockedTile(id, options={}){
  const c=options.collection||(state.market.collections||[]).find(x=>x.path===state.collectionPath)||{};
  const slug=options.slug||c.slug||'moonbound';
  const name=c.name||(slug==='moonbound'?'GNO PUNK':slug.toUpperCase());
  const img=slug==='moonbound'?imageUri(id):`/collections/${slug}/images/${pad(id)}.webp`;
  const fallbackImg=slug==='moonbound'?imageUri(1):(c.cover||c.image||ART.glass);
  const price=Number(options.priceUgnot||c.mintPriceUgnot||0);
  const supply=Number(options.supply||c.maxSupply||1000);
  const reason=options.reason||'Public minting is not enabled by this server yet.';
  const footer=price?`<div class="nft-price"><div><div class="price-label">Mint price</div><span class="price-value">${displayGnot(price)}</span></div>${options.mintLabel?`<button class="btn btn-ghost btn-sm" data-action="mint-item" data-slug="${slug}" ${options.mintLive?'':`disabled title="${escapeHTML(reason)}"`}>${escapeHTML(options.mintLabel)}</button>`:''}</div>`:'';
  const traitRow=options.traits?Object.entries(options.traits).filter(([,v])=>v).slice(0,3).map(([k,v])=>`<span class="chip" title="${escapeHTML(k)}">${escapeHTML(String(v))}</span>`).join(''):'';
  return `<article class="nft-card" data-open-nft="${pad(id)}" data-collection-path="${escapeHTML(c.path||'')}">
   <div class="nft-image-wrap punk-image-wrap"><img loading="lazy" class="nft-image punk-art" src="${img}" alt="${escapeHTML(name)} edition ${pad(id)}" onerror="this.onerror=null;this.src='${fallbackImg}'"><span class="nft-tag preview">${slug==='moonbound'?'GENESIS EDITION':'COLLECTION DROP'}</span><span class="punk-edition-stamp">#${pad(id)}</span></div>
   <div class="nft-meta"><h3 class="nft-title">${escapeHTML(name)}</h3><p class="nft-collection"><span class="card-collection-dot"></span>Edition ${pad(id)} · ${num(supply)} supply</p>${traitRow?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${traitRow}</div>`:''}${footer}</div>
  </article>`;
}

// Hero slider: real collections only. Until any collection exists the stage stays
// empty on purpose — no decorative filler.
let sliderIdx=0,sliderTimer=null;
function renderHero(){
  const colls=(state.market.collections||[]).slice();
  // Featured order: unfinished mints first by minted progress — top drops hold the stage
  // until they are fully minted, then slide out for the next ones.
  colls.sort((a,b)=>{
    const sa=Number(a.minted||0)>=Number(a.maxSupply||0)?1:0, sb=Number(b.minted||0)>=Number(b.maxSupply||0)?1:0;
    if(sa!==sb)return sa-sb;
    return Number(b.minted||0)-Number(a.minted||0);
  });
  const featured=colls.filter(c=>c.cover||c.image).slice(0,6);
  if(!featured.length){
    clearInterval(sliderTimer);sliderTimer=null;
    return `<section class="hero-slider"><div class="hero-empty"><div class="hero-empty-card">
      <div class="hero-empty-grid" aria-hidden="true"><span class="hero-empty-brick"></span><span class="hero-empty-brick"></span><span class="hero-empty-brick"></span></div>
      <div class="eyebrow" style="justify-content:center;margin-bottom:10px"><span class="eyedot"></span> The stage is empty — on purpose</div>
      <h2>Your collection headlines this slider</h2>
      <p>Gnotbook starts with no demo drops. The first minted collection fills this stage automatically.</p>
      <div class="hero-cta" style="justify-content:center"><button class="btn btn-accent" data-route="create">Create collection ↗</button><button class="btn btn-outline" data-route="upcoming">Upcoming mints</button></div>
    </div></div></section>`;
  }
  if(sliderIdx>=featured.length)sliderIdx=0;
  const slides=featured.map(c=>`
    <div class="hero-slide" style="--slide-bg:url('${escapeHTML(imageSrc(c.cover||c.image))}')">
      <div class="hero-inner">
        <div class="hero-meta"><span class="chip ${mintLiveChip(c)}">${escapeHTML(mintChipText(c))}</span><span class="chip">${Number(c.minted||0).toLocaleString('en-US')} / ${Number(c.maxSupply||0).toLocaleString('en-US')} minted</span></div>
        <h2>${escapeHTML(c.name)}</h2>
        <p>${escapeHTML(c.description||'A collection from the Gnotbook realm.')}</p>
        <div class="hero-cta"><button class="btn btn-accent" data-action="open-collection" data-path="${escapeHTML(c.path)}">Open collection ↗</button><span class="note">By ${escapeHTML(shortAddr(c.creator))}</span></div>
      </div>
    </div>`).join('');
  return `<section class="hero-slider">
    <div class="hero-track" id="heroTrack" style="transform:translateX(-${sliderIdx*100}%)">${slides}</div>
    <button class="hero-arrow prev" data-action="hero-prev" aria-label="Previous slide">‹</button>
    <button class="hero-arrow next" data-action="hero-next" aria-label="Next slide">›</button>
    <div class="hero-dots">${featured.map((_,i)=>`<button class="hero-dot ${i===sliderIdx?'on':''}" data-action="hero-goto" data-value="${i}" aria-label="Slide ${i+1}"></button>`).join('')}</div>
  </section>`;
}
function mintLiveChip(c){
  const s=upcomingStatusOf(c);return s.chip.tone;
}
function mintChipText(c){
  const s=upcomingStatusOf(c);return s.chip.label;
}
function heroSlide(step){
  const track=$('#heroTrack');if(!track)return;
  const total=track.children.length;
  sliderIdx=(sliderIdx+step+total)%total;
  track.style.transform=`translateX(-${sliderIdx*100}%)`;
  $$('.hero-dot').forEach((d,i)=>d.classList.toggle('on',i===sliderIdx));
}
function renderGenesisGallery(){
  const supply=Number(state.config?.moonbound?.maxSupply||1000);
  const g=state.gallery;
  const rarityValues=genesisRarityValues();
  const traitTypes=genesisTraitTypes();
  const traitValues=g.traitType!=='all'?((state.traits?.groups||[]).find(x=>x.trait_type===g.traitType)?.values||[]):[];
  const q=g.query.trim().toLowerCase();
  const pool=genesisPool().filter(edition=>{
    if(g.rarity!=='all'&&genesisTrait(edition,'Rarity')!==g.rarity)return false;
    if(g.traitType!=='all'&&g.traitValue!=='all'&&genesisTrait(edition,g.traitType)!==g.traitValue)return false;
    if(g.status==='minted'&&genesisStatus(edition)!=='Minted')return false;
    if(g.status==='listed'&&!(state.market.listings||[]).some(x=>sameId(x.id,edition)))return false;
    if(q){const hay=`gno punk #${pad(edition)} ${genesisTrait(edition,'Archetype')} ${genesisTrait(edition,'Realm')} ${genesisTrait(edition,'Hair')} ${genesisTrait(edition,'Accessory')} ${genesisTrait(edition,'Rarity')}`.toLowerCase();if(!hay.includes(q))return false;}
    return true;
  });
  if(g.sort==='rar')pool.sort((a,b)=>rarityRank(a)-rarityRank(b)||a-b);
  else pool.sort((a,b)=>a-b);
  const total=genesisPool().length;
  const shown=pool.slice(0,Number(g.limit||6));
  const featured=(state.market.collections||[]).find(c=>c.slug==='moonbound');
  const minted=Number(featured?.minted||0);
  const listed=(state.market.listings||[]).filter(x=>x.collectionPath===(state.config?.moonbound?.collectionPath||'')).length;
  const statuses=[['all','All'],...(minted>0?[['minted','Minted']]:[]),...(listed>0?[['listed','Listed']]:[])];
  const reserveCopy=founderReserveCopy(supply);
  return `<section class="genesis-section" id="genesis">
   <div class="genesis-head"><div><div class="eyebrow"><span class="eyedot"></span> The collection</div><h2>GNO PUNK</h2><p>${num(supply)} numbered pixel identities. ${reserveCopy} Traits are published in the metadata before minting.</p></div><div class="right"><button class="text-action" data-action="open-moonbound-drop">${featured?'Open collection ↗':'Collection detail ↗'}</button></div></div>
   <div class="genesis-toolbar">
    <div class="genesis-filters">
      <label class="genesis-search"><span class="search-glyph" aria-hidden="true">⌕</span><input id="gallerySearch" type="search" value="${escapeHTML(g.query)}" placeholder="Search edition or trait" aria-label="Search GNO PUNK editions"></label>
      <select class="select-control" id="galleryRarity" aria-label="Filter by rarity"><option value="all">All rarities</option>${rarityValues.map(v=>`<option value="${escapeHTML(v)}" ${g.rarity===v?'selected':''}>${escapeHTML(v)}</option>`).join('')}</select>
      <select class="select-control" id="galleryTraitType" aria-label="Choose a trait"><option value="all">All traits</option>${traitTypes.map(t=>`<option value="${escapeHTML(t)}" ${g.traitType===t?'selected':''}>${escapeHTML(t)}</option>`).join('')}</select>
      ${g.traitType!=='all'?`<select class="select-control" id="galleryTraitValue" aria-label="Choose a trait value"><option value="all">Any ${escapeHTML(g.traitType)}</option>${traitValues.map(v=>`<option value="${escapeHTML(v.value)}" ${g.traitValue===v.value?'selected':''}>${escapeHTML(v.value)} (${num(v.count)})</option>`).join('')}</select>`:''}
      <select class="select-control" id="gallerySort" aria-label="Sort editions"><option value="ed" ${g.sort==='ed'?'selected':''}>Edition: first to last</option><option value="rar" ${g.sort==='rar'?'selected':''}>Rarity: rarest first</option></select>
      <div class="filter-pills">${statuses.map(([value,label])=>`<button class="filter-pill ${g.status===value?'active':''}" data-action="gallery-status" data-value="${value}">${label}</button>`).join('')}</div>
    </div>
    <span class="genesis-count">${num(pool.length)} of ${num(total)} editions${q||g.rarity!=='all'||g.traitValue!=='all'?' match':''}</span>
   </div>
   <div class="nft-grid">${shown.length?shown.map(genesisCard).join(''):'<div class="genesis-empty">No edition matches those filters. Clear one and try again.</div>'}</div>
   ${pool.length>shown.length?`<div class="genesis-more"><span>Showing ${num(shown.length)} of ${num(pool.length)} matching editions</span><button class="btn btn-outline" data-action="gallery-show-more">Show 6 more editions ↗</button></div>`:''}
  </section>`;
}

// Collections grid for the homepage: strictly what the server returns. Empty until a creator
// saves a collection or the registry reports one — no bundled demo drops.
function renderExploreCollections(){
  const colls=state.market.collections||[];
  if(!colls.length){
    return `<section class="featured-collections"><div class="section-head"><div><div class="eyebrow"><span class="eyedot"></span> Community collections</div><h2>THE SHELF IS WAITING</h2><p>Names shown here can only appear after a creator saves a collection or deploys one on-chain.</p></div><button class="text-action" data-route="collections">VIEW ALL COLLECTIONS →</button></div>
    <div class="empty-state"><div class="legend-brick-cookie" aria-hidden="true"></div><h3>No collections registered yet</h3><p>This catalog intentionally starts empty. Create your collection and it will appear here automatically.</p><button class="btn btn-dark" data-route="create">Create the first collection ↗</button></div></section>`;
  }
  // Unsold first, ordered by mint progress — featured drops hold the top of the
  // grid until they are fully minted, then drift down for the next creators.
  const sorted=[...colls].sort((a,b)=>{
    const soldA=Number(a.minted||0)>=Number(a.maxSupply||0)?1:0, soldB=Number(b.minted||0)>=Number(b.maxSupply||0)?1:0;
    if(soldA!==soldB)return soldA-soldB;
    return Number(b.minted||0)-Number(a.minted||0);
  });
  const cards=sorted.map(c=>{
    const minted=Number(c.minted||0);
    const supply=Number(c.maxSupply||0);
    const pct=supply?Math.min(100,(minted/supply)*100):0;
    const status=upcomingStatusOf(c);
    const chip=status.chip;
    return `<article class="collection-card" data-action="open-collection" data-path="${escapeHTML(c.path)}" style="cursor:pointer">
      <div class="collection-cover">
        ${c.cover||c.image?`<img loading="lazy" src="${escapeHTML(imageSrc(c.cover||c.image))}" alt="${escapeHTML(c.name)} cover" onerror="this.style.display='none'">`:`<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:500;font-size:20px;letter-spacing:.18em;color:var(--text-3)">${escapeHTML(c.symbol||'NFT')}</span>`}
        <span class="collection-count">${supply?`${num(supply)} EDITIONS`:'ON-CHAIN COLLECTION'}</span>
      </div>
      <div class="collection-body">
        <div class="collection-title-row">
          <div><h3 class="collection-title">${escapeHTML(c.name)}</h3><div class="collection-creator">${escapeHTML(shortAddr(c.creator))} · ${c.mintType==='free'?'Free mint':displayGnot(c.mintPriceUgnot||0)}</div></div>
          <span class="status-chip ${chip.tone}">${chip.label}</span>
        </div>
        <p class="collection-description">${escapeHTML(c.description||'Community collection on Gnotbook.')}</p>
        ${supply?`<div class="rank-track" role="img" aria-label="${minted} of ${supply} editions minted" style="margin:10px 0 6px"><span style="width:${pct}%"></span></div>`:''}
        <div class="collection-stats" style="margin-top:6px">
          <div><strong>${supply?num(supply):'—'}</strong><span>Supply</span></div>
          <div><strong>${c.mintType==='free'?'Free':displayGnot(c.mintPriceUgnot||0)}</strong><span>Mint</span></div>
          <div><strong>${num(minted)}</strong><span>Minted</span></div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;margin-top:12px">
          <button class="btn btn-outline" style="flex:1" data-action="open-collection" data-path="${escapeHTML(c.path)}">Open ↗</button>
          <button class="text-action" data-route="upcoming">SCHEDULE →</button>
        </div>
      </div>
    </article>`;
  }).join('');
  return `<section class="featured-collections"><div class="section-head"><div><span class="section-index"><b>02</b> / COMMUNITY COLLECTIONS</span><h2>FROM THE CREATORS</h2><p>Newly registered collections appear here automatically. Unfinished mints hold the top of the shelf.</p></div><button class="text-action" data-route="collections">VIEW ALL COLLECTIONS →</button></div><div class="collection-grid" id="mintSliderTrack">${cards}</div></section>`;
}
function renderListings(){
  const q=state.query.trim().toLowerCase();
  const mode=state.trending||'all';
  const match=text=>!q||text.toLowerCase().includes(q);
  const listings=(state.market.listings||[]).filter(x=>match(`${x.name} ${x.collectionName} ${x.seller} ${x.id}`));
  let tiles=listings.slice(0,6).map(x=>artCard({...x,preview:false}));
  const empty=q?'No listed edition matches that search.':'No edition has an open ask yet. A listing appears here the moment a holder opens a sale.';
  const copy=mode==='listed'
   ?'Current asks read from the Gnotbook registry, with the wallet that owns each token.'
   :'Live asks read straight from the collection realms on Gno.land. Nothing is illustrated for effect.';
  const pills=[['all','All'],['listed','Listed']];
  const liveMarkup=tiles.length
   ? `<div class="nft-grid trending-grid">${tiles.join('')}${renderCommunityCard()}</div>`
   : `<div class="empty-state is-compact"><div class="empty-art" aria-hidden="true">⌁</div><h3>The market is warming up</h3><p>${escapeHTML(empty)}</p><button class="btn btn-outline" data-route="create">Create a collection ↗</button></div>`;
  return `<section><div class="section-head trending-head"><div><div class="eyebrow"><span class="eyedot"></span> Live market</div><h2>TRENDING NOW</h2><p>${copy}</p></div><div class="filter-pills trending-pills">${pills.map(([value,label])=>`<button class="filter-pill ${mode===value?'active':''}" data-action="trending-mode" data-value="${value}">${label}</button>`).join('')}</div></div>${liveMarkup}</section>`;
}
// Closes the trending row, exactly like the reference layout. Links come from the operator config;
// with none set the card points at the project's own public home instead of a dead icon.
function renderCommunityCard(){
  const links=socialLinksMarkup();
  return `<aside class="community-card">
   <span class="community-glow" aria-hidden="true"></span>
   <div class="community-copy"><h3>JOIN THE<br>COMMUNITY</h3><p>Follow releases, drops and collection news from the Gnotbook studio.</p><div class="community-links">${links.join('')||'<a class="footer-social" href="https://gno.land/" target="_blank" rel="noopener noreferrer" aria-label="Gno.land" title="Gno.land"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 3h18v18H3V3Zm3.4 3.4v11.2h11.2V6.4H6.4Zm2.3 2.3h6.6v6.6H8.7V8.7Z"/></svg></a>'}</div></div>
   <button class="community-arrow" type="button" data-route="create" aria-label="Create a collection">↗</button>
  </aside>`;
}

// Market: the trading floor. Floors and counts come only from what the server can read right now
// (registered realms plus current asks), so nothing is estimated and volume stays blank.
function collectionFloor(path){
  const prices=(state.market.listings||[]).filter(x=>x.collectionPath===path).map(x=>Number(x.priceUgnot||0)).filter(n=>n>0);
  return prices.length?Math.min(...prices):0;
}
function renderMarket(){
  const allListings=state.market.listings||[];
  const q=state.query.trim().toLowerCase();
  const sort=state.marketSort||'recent';
  const listings=[...allListings].filter(x=>!q||`${x.name} ${x.collectionName} ${x.seller} ${x.id}`.toLowerCase().includes(q));
  if(sort==='price-low')listings.sort((a,b)=>Number(a.priceUgnot||0)-Number(b.priceUgnot||0));
  else if(sort==='price-high')listings.sort((a,b)=>Number(b.priceUgnot||0)-Number(a.priceUgnot||0));
  else listings.sort((a,b)=>Number(b.id||0)-Number(a.id||0));
  const collections=state.market.collections||[];
  const floors=collections.map(c=>({c,items:allListings.filter(n=>n.collectionPath===c.path)}))
    .map(x=>({...x,floor:x.items.length?Math.min(...x.items.map(n=>Number(n.priceUgnot||0)).filter(n=>n>0)):0}))
    .sort((a,b)=>(a.floor||Number.MAX_SAFE_INTEGER)-(b.floor||Number.MAX_SAFE_INTEGER));
  const cards=listings.length?`<div class="nft-grid market-grid">${listings.slice(0,48).map(x=>artCard({...x,preview:false})).join('')}</div>`:
    `<div class="market-empty"><div class="empty-orbit" aria-hidden="true"><span>↗</span></div><div><h3>${q?'No matches found':'The floor is yours'}</h3><p>${q?'Try another name, collection or token number.':'There are no active listings yet. Browse all collections or list an NFT you already own.'}</p><div class="market-empty-actions"><button class="btn btn-dark" data-route="portfolio">${state.wallet?'List an NFT':'Connect wallet to sell'}</button><button class="btn btn-outline" data-route="collections">Browse collections</button></div></div></div>`;
  const collectionRows=floors.slice(0,8).map((x,i)=>{
    const collFallback = x.c.cover || x.c.image || ART.glass;
    return `<button class="market-collection-row" data-action="open-collection" data-path="${escapeHTML(x.c.path)}"><span class="market-rank">${String(i+1).padStart(2,'0')}</span><img src="${escapeHTML(imageSrc(x.c.cover||x.c.image||ART.glass))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${collFallback}'"><span class="market-collection-name"><strong>${escapeHTML(x.c.name)}</strong><small>${Number(x.c.minted||0).toLocaleString('en-US')} minted · ${x.items.length} for sale</small></span><span class="market-floor"><small>Floor</small><strong>${x.floor?displayGnot(x.floor):'—'}</strong></span><span class="market-row-arrow">↗</span></button>`;
  }).join('');
  return `<div class="market-page">
    <header class="market-heading"><div><div class="eyebrow"><span class="eyedot"></span> The trading floor</div><h1>Market<span class="heading-period">.</span></h1><p>Discover pieces from Gno.land creators. Buy directly through Adena or list an NFT from your portfolio.</p></div><div class="market-heading-actions"><button class="btn btn-outline" data-action="refresh-market">Refresh</button><button class="btn btn-dark" data-route="portfolio">${state.wallet?'Sell an NFT':'Connect to sell'} <span aria-hidden="true">↗</span></button></div></header>
    <div class="market-metrics"><div><span>Collections</span><strong>${collections.length.toLocaleString('en-US')}</strong></div><div><span>For sale</span><strong>${allListings.length.toLocaleString('en-US')}</strong></div><div><span>Lowest ask</span><strong>${allListings.length?displayGnot(Math.min(...allListings.map(x=>Number(x.priceUgnot||0)).filter(x=>x>0))):'—'}</strong></div><div><span>Gnotbook fee</span><strong>${(Number(state.config?.marketplaceFeeBps||250)/100).toFixed(2)}%</strong></div></div>
    <section class="market-listings"><div class="section-head market-section-head"><div><div class="eyebrow">Curated by the chain</div><h2>Discover listings</h2></div><div class="market-controls"><label class="market-local-search"><span aria-hidden="true">⌕</span><input id="marketSearch" type="search" value="${escapeHTML(state.query||'')}" placeholder="Search the market" aria-label="Search listings"></label><select id="marketSort" class="select-control" aria-label="Sort listings"><option value="recent" ${sort==='recent'?'selected':''}>Latest IDs</option><option value="price-low" ${sort==='price-low'?'selected':''}>Price: low to high</option><option value="price-high" ${sort==='price-high'?'selected':''}>Price: high to low</option></select></div></div>${cards}</section>
    <section class="market-collections"><div class="section-head"><div><div class="eyebrow">Explore the ecosystem</div><h2>Collections</h2><p>Open a collection to view its items and available actions.</p></div><button class="text-action" data-route="collections">Browse all ↗</button></div>${collectionRows?`<div class="market-collection-list">${collectionRows}</div>`:`<div class="market-empty slim"><div><h3>Your collection belongs here</h3><p>Launch a collection and it will appear in this market.</p></div><button class="btn btn-outline" data-route="create">Create collection ↗</button></div>`}</section>
    ${(state.config?.projects||[]).some(p=>p.slug==='guardians')?`<section class="ecosystem-feature"><div class="ecosystem-art"><span>G/</span><small>GNOLAND · COMMUNITY</small></div><div class="ecosystem-copy"><div class="eyebrow">From the wider ecosystem</div><h2>Guardians<span class="heading-period">.</span></h2><p>An independent Gno.land project. Minting and eligibility are controlled by the Guardians team.</p></div><a class="btn btn-outline" href="https://guardians.family/mint" target="_blank" rel="noopener noreferrer">Open official mint ↗</a></section>`:''}
  </div>`;
}
function renderCollections(){
  const query=state.query.toLowerCase();
  const colls=(state.market.collections||[]).filter(c=>!query||`${c.name} ${c.slug} ${c.creator} ${c.path}`.toLowerCase().includes(query));
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> On-chain identities</div><h1>Collections</h1><p>Discover collections created by the Gno.land community.</p></div><div class="heading-actions"><button class="btn btn-dark" data-route="create">＋ Create collection</button></div></div>
  <div class="collection-grid">${colls.map(c=>`<article class="collection-card"><div class="collection-cover">${c.cover||c.image?`<img loading="lazy" src="${escapeHTML(imageSrc(c.cover||c.image))}" alt="${escapeHTML(c.name)} cover" onerror="this.onerror=null;this.src='${ART.glass}'">`:''}<span class="cover-ph" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;letter-spacing:.08em;color:var(--primary)">${c.cover||c.image?'':escapeHTML(c.symbol||'NFT')}</span><span class="collection-count">${c.slug==='moonbound'?'1000 EDITIONS':`${Number(c.minted||0).toLocaleString('en-US')}${c.maxSupply?` / ${Number(c.maxSupply).toLocaleString('en-US')}`:''} minted`}</span></div><div class="collection-body"><div class="collection-title-row"><div><h3 class="collection-title">${escapeHTML(c.name)}</h3><div class="collection-creator">${escapeHTML(c.creator==='Gnotbook Studio'?c.creator:shortAddr(c.creator))}</div></div>${c.verified?'<span class="status-chip good">Verified</span>':c.path===(state.market?.featuredCollectionPath||state.config?.featuredCollectionPath)?'<span class="status-chip onchain">Homepage feature</span>':'<span class="status-chip pending">Unverified</span>'}</div><p class="collection-description">${escapeHTML(c.description||`On-chain realm: ${c.path||'not deployed yet'}.`)}</p><div class="collection-stats"><div><strong>${c.maxSupply?Number(c.maxSupply).toLocaleString('en-US'):'—'}</strong><span>Supply</span></div><div><strong>${(Number(c.royaltyBps||0)/100).toFixed(1)}%</strong><span>Royalty</span></div><div><strong>${Number(c.minted||0).toLocaleString('en-US')}</strong><span>Minted</span></div></div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-soft" style="flex:1" data-action="open-collection" data-path="${escapeHTML(c.path)}">Open collection ↗</button><button class="btn btn-dark" style="flex:1" data-action="mint-item" data-slug="${c.slug}">Mint ↗</button></div></div></article>`).join('')}</div>
  ${colls.length?'':`<div class="empty-state is-compact"><div class="empty-art" aria-hidden="true">⌁</div><h3>No registered collections yet</h3><p>Gnotbook lists collections from the registry configured on this server, and none is registered right now.</p><button class="btn btn-outline" data-route="explore">Explore drops</button></div>`}`;
}

// Compact collection card used by the portfolio tab; the explore grid keeps its longer marketing card.
function renderCollectionCards(colls){
  const cards=(colls||[]).map(c=>`<article class="collection-card" data-action="open-collection" data-path="${escapeHTML(c.path)}"><div class="collection-cover">${c.cover||c.image?`<img loading="lazy" src="${escapeHTML(imageSrc(c.cover||c.image))}" alt="${escapeHTML(c.name)} cover" onerror="this.onerror=null;this.src='${ART.glass}'">`:''}<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;letter-spacing:.08em;color:var(--primary)">${c.cover||c.image?'':escapeHTML(c.symbol||'NFT')}</span><span class="collection-count">${Number(c.minted||0).toLocaleString('en-US')}${c.maxSupply?` / ${Number(c.maxSupply).toLocaleString('en-US')}`:''} minted</span></div><div class="collection-body"><div class="collection-title-row"><div><h3 class="collection-title">${escapeHTML(c.name)}</h3><div class="collection-creator">${escapeHTML(shortAddr(c.creator))}</div></div>${c.verified?'<span class="status-chip good">Verified</span>':'<span class="status-chip pending">Unverified</span>'}</div><div class="collection-stats"><div><strong>${c.maxSupply?Number(c.maxSupply).toLocaleString('en-US'):'—'}</strong><span>Supply</span></div><div><strong>${Number(c.minted||0).toLocaleString('en-US')}</strong><span>Minted</span></div></div></div></article>`).join('');
  return `<div class="collection-grid">${cards}</div>`;
}

function renderExplore(){
  return `${renderHero()}${renderUpcomingStrip()}${renderExploreCollections()}${renderListings()}`;
}

async function openCollection(path,fromHistory=false){
  const collection=(state.market.collections||[]).find(c=>c.path===path);
  if(!collection){toast('This collection was not found in the configured Gnotbook registry.','error');return}
  state.collectionPath=path; state.collectionItems=[]; state.collectionOffset=0; state.collectionHasMore=false; state.collectionTab='items'; state.unrevealedShown=24; state.route='collection'; if(!fromHistory)writeRouteLocation(true); render();
  loadFacets(collection.slug);
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
  const c=(state.market.collections||[]).find(x=>x.path===pkg || (pkg && x.slug===slugOf(pkg)));
  const slug=c?.slug||slugOf(pkg)||'moonbound';
  const isVESPER=slug==='moonbound';
  const collectionName=c?.name||(isVESPER?'GNO PUNK':slug.toUpperCase());
  const maxSupply=Number(c?.maxSupply||(isVESPER?1000:333));
  const realmPath=c?.path||pkg||(isVESPER?'gno.land/r/morrow/moonbound':`gno.land/r/morrow/${slug}`);

  const pinned=(state.traits?.editions||{})[pad(Number(id)||0)];
  const fallbackAttrs = pinned ? Object.entries(pinned).filter(([key])=>key!=='Edition').map(([trait_type,value])=>({trait_type,value})) : [];
  const meta=state.itemMeta || {
    name: `${collectionName} #${pad(Number(id)||0)}`,
    image: isVESPER ? imageUri(id) : `/collections/${slug}/images/${pad(id)}.webp`,
    attributes: fallbackAttrs
  };

  const listed=(state.market.listings||[]).find(x=>sameId(x.id,id)&&x.collectionPath===pkg);
  const owned=(state.portfolio.tokens||[]).find(x=>sameId(x.id,id)&&x.collectionPath===pkg);
  const mintable=!!(isVESPER?state.config?.moonbound?.mintEnabled:c?.mintEnabled)&&!listed&&!owned&&!walletMintCapReached()&&Number((c||{minted:0}).minted||0)<maxSupply;
  const priceUgnot=Number((c||{mintPriceUgnot:0}).mintPriceUgnot||state.config?.moonbound?.mintPriceUgnot||5000000);
  const currentImg = meta.image || (isVESPER ? imageUri(id) : `/collections/${slug}/images/${pad(id)}.webp`);
  const hasImage = !!currentImg;

  const metadataGateway=String(state.config?.moonbound?.metadataGateway||'');
  const metadataHref=isVESPER
    ? (metadataGateway?`${metadataGateway}${pad(id)}.json`:metaUri(id))
    : `/collections/${slug}/metadata/${pad(id)}.json`;

  const sellerIsWallet=!!(state.wallet&&listed&&listed.seller&&listed.seller===state.wallet.address);
  const ownerIsWallet=!!(state.wallet&&owned&&owned.owner&&owned.owner===state.wallet.address);
  const {total}=saleTotal(listed?listed.priceUgnot:0);
  const itemAction=listed
   ?(sellerIsWallet?`<button class="btn btn-dark btn-full" data-action="cancel-item">Cancel listing</button>`
     :`<button class="btn btn-dark btn-full" data-action="buy-item" ${(!state.wallet||!state.config?.transactionsEnabled)?'disabled':''}>${state.wallet?`Buy for ${displayGnot(total)} ↗`:'Connect Adena to buy'}</button>`)
   :ownerIsWallet?`<button class="btn btn-dark btn-full" data-action="list-item">List for sale</button>`
   :mintable?`<button class="btn btn-dark btn-full" data-action="mint-item" data-slug="${slug}">Mint edition ↗</button>`
   :`<button class="btn btn-dark btn-full" disabled>${owned?'Owned':'Not for sale'}</button>`;
  const itemNote=listed
   ?`The buyer pays ${displayGnot(total)}: the ${displayGnot(listed.priceUgnot)} ask plus the contract-enforced 2.5% Gnotbook fee, settled inside the collection realm in one transaction.`
   :mintable?'Public minting issues editions in sequential order on-chain.'
   :'Art and traits are pinned before the drop; this edition is available in the collection preview.';

  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Item</div><h1>${escapeHTML(meta.name)}</h1><p>Collection ${escapeHTML(collectionName)} · edition ${pad(id)} of ${maxSupply}</p></div><div class="heading-actions">${realmPath?`<a class="btn btn-outline" href="${collectionLink(realmPath)}" target="_blank" rel="noreferrer">View realm ↗</a>`:''}</div></div>
  <div class="item">
   <div class="item-art-stage">
    <div class="item-art-visual">
    <div class="item-float-card item-float-card-a" aria-hidden="true" style="display:none"><img src="${ART.glass}" alt=""><span><b>Curated</b><small>Digital artefacts</small></span></div>
    <div class="item-float-card item-float-card-b" aria-hidden="true" style="display:none"><img src="${ART.sun}" alt=""><span><b>On-chain</b><small>Gno.land</small></span></div>
    <div class="art-shell">
     ${hasImage?`<div class="blur" style="background-image:url('${escapeHTML(imageSrc(currentImg))}')"></div><img src="${escapeHTML(imageSrc(currentImg))}" alt="${escapeHTML(meta.name)}" onerror="this.onerror=null;this.src='${ART.glass}'">`:`<div class="punk-tile-big"><span class="lock">✦</span><div class="edition">#${pad(id)}</div><div class="lock-text">${escapeHTML(collectionName)}</div></div>`}
    </div>
    </div>
    <div class="art-foot"><span>${escapeHTML(meta.name)}</span><span>${hasImage?'Verified Art':'Preview'}</span></div>
    ${!mintable&&!listed&&!owned?`<p class="note" style="margin-top:11px">Art and traits are verified for this edition.</p>`:''}
    <div class="panel" style="margin-top:16px">
     <div class="eyebrow" style="color:var(--muted)">Traits</div>
     <div class="trait-grid">${renderTraits(meta)}</div>
    </div>
   </div>
   <div>
    <div style="display:flex;align-items:center;gap:10px">${c?.verified?`<span class="chip good">Verified</span>`:''}${traitOf(Number(id),'Rarity')?`<span class="chip">${escapeHTML(traitOf(Number(id),'Rarity'))}</span>`:''}<span style="font-size:11px;color:var(--muted-2)">Edition ${pad(id)}</span></div>
    <h1 style="font-size:27px;margin:10px 0 6px">${escapeHTML(meta.name)}</h1>
    <div class="note">${owned?`Owned by ${escapeHTML(shortAddr(owned.owner))}`:listed?`Listed by ${escapeHTML(shortAddr(listed.seller))}`:'Not minted'} · ${listed?'For sale':'Not listed'}</div>
    <div class="mint-price" style="margin:16px 0"><div class="l">Mint price</div><div class="v">${displayGnot(priceUgnot)}</div></div>
    <div style="display:flex;gap:10px">${itemAction}<button class="btn btn-ghost" data-action="favorite" data-id="${escapeHTML(String(Number(id)||0))}" aria-label="Toggle favorite">${state.favorites.has(favKey(id))?'♥':'♡'}</button></div>
    <p class="note" style="margin-top:12px">${itemNote}</p>
    <div class="panel" style="margin-top:18px">
     <div class="eyebrow" style="color:var(--muted)">Details</div>
     <div style="margin-top:11px">
      <div class="kv"><span>Contract</span><b class="mono">${escapeHTML(realmPath)}</b></div>
      <div class="kv"><span>Token standard</span><b>GRC-721 (Gno.land)</b></div>
      <div class="kv"><span>Token ID</span><b class="mono">${escapeHTML(id)}</b></div>
      <div class="kv"><span>Metadata</span><b class="mono"><a href="${escapeHTML(metadataHref)}" target="_blank" rel="noopener noreferrer">JSON Metadata ↗</a></b></div>
      <div class="kv"><span>Chain</span><b>Gno.land</b></div>
      <div class="kv"><span>Royalty</span><b>${(Number((c||{royaltyBps:250}).royaltyBps||250)/100).toFixed(1)}% · enforced by contract</b></div>
     </div>
    </div>
    <div class="panel" style="margin-top:14px">
     <div class="eyebrow" style="color:var(--muted)">Price history</div>
     <div style="margin-top:11px">
      <div class="kv"><span>Mint · ${displayGnot(priceUgnot)}</span><b>${listed||owned?'confirmed':'available'}</b></div>
      <div class="kv"><span>Listings</span><b>${listed?1:0}</b></div>
      <div class="kv"><span>Sales</span><b>none</b></div>
     </div>
     <p class="note" style="margin-top:10px">History is read from contract events.</p>
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
  if(!state.wallet)return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Your space</div><h1>Portfolio</h1><p>Your collectibles, collection realms and token balances, directly connected to your wallet.</p></div></div><div class="empty-state"><div class="empty-art">▦</div><h3>Your collection belongs here</h3><p>Connect Adena to read the wallet address, balances and known Gno.land NFT holdings. Gnotbook never stores your private key or seed phrase.</p><button class="btn btn-dark" data-action="connect">Connect Adena</button></div>`;
  const holdings=state.portfolio.tokens||[];const colls=state.portfolio.collections||[];
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Your space</div><h1>Portfolio</h1><p>Only the public wallet address is used to read balances and NFTs from Gnotbook-registered Gno.land collections.</p></div><div class="heading-actions"><button class="btn btn-outline" data-action="refresh-wallet">REFRESH PORTFOLIO ↻</button></div></div>
  <div class="wallet-hero"><div><div class="eyebrow" style="color:var(--primary-light)">Connected with Adena</div><h2>Looking good.</h2><p>Your keys stay with you. Gnotbook never takes custody.</p><div class="wallet-address mono">${escapeHTML(state.wallet.address)}</div></div><div><div class="tiny-label" style="color:var(--muted)">Native balance</div><div class="wallet-balance">${displayGnot((state.balances.find(x=>x.denom==='ugnot')||{}).amount||0)}</div></div></div>
  <div class="stat-grid"><div class="stat-card"><span class="stat-label">NFTs found</span><strong>${holdings.length}</strong><span class="stat-foot">Gnotbook-registered collections</span></div><div class="stat-card"><span class="stat-label">Collections held</span><strong>${colls.length}</strong><span class="stat-foot">With indexed NFTs</span></div><div class="stat-card"><span class="stat-label">Gnotbook points</span><strong>${Number(state.points.total||0).toLocaleString('en-US')}</strong><span class="stat-foot">Verified on-chain actions</span></div><div class="stat-card"><span class="stat-label">Wallet custody</span><strong>100%</strong><span class="stat-foot">Self-custodied in Adena</span></div></div>
  <div class="tabs-row"><button class="tab-btn ${state.activePortfolioTab==='nfts'?'active':''}" data-action="portfolio-tab" data-value="nfts">My NFTs (${holdings.length})</button><button class="tab-btn ${state.activePortfolioTab==='collections'?'active':''}" data-action="portfolio-tab" data-value="collections">My collections (${colls.length})</button><button class="tab-btn ${state.activePortfolioTab==='tokens'?'active':''}" data-action="portfolio-tab" data-value="tokens">Tokens (${state.balances.length})</button></div>
  ${state.activePortfolioTab==='nfts'?(holdings.length?`<div class="nft-grid">${holdings.map(n=>artCard({...n,preview:false})).join('')}</div>`:`<div class="empty-state"><div class="empty-art">◈</div><h3>No NFTs found in indexed collections</h3><p>Gnotbook scans its own on-chain registry. It does not claim to index every independent NFT realm on Gno.land.</p><button class="btn btn-outline" data-route="collections">Browse collections</button></div>`):state.activePortfolioTab==='collections'?(colls.length?renderCollectionCards(colls):`<div class="empty-state"><h3>No collection NFTs found</h3><p>Launch your first collection and it will appear here after the registry confirms it.</p><button class="btn btn-dark" data-route="create">Create collection</button></div>`):`<div class="activity-list">${state.balances.map(b=>`<div class="activity-row"><div class="activity-icon">◈</div><div><strong>${escapeHTML(b.denom==='ugnot'?'GNOT':b.denom)}</strong><span class="mono">${escapeHTML(b.denom)}</span></div><div class="activity-value">${Number(b.amount).toLocaleString('en-US',{maximumFractionDigits:6})}</div></div>`).join('')}</div>`}
  `;
}

function renderRewards(){
  const total=Number(state.points.total||0),events=state.points.events||[];
  const ranks=[{name:'Newcomer',min:0,mark:'01'},{name:'Collector',min:100,mark:'02'},{name:'Curator',min:500,mark:'03'},{name:'Gno Guardian',min:2000,mark:'04'}];
  const rankIndex=Math.max(0,ranks.reduce((found,r,i)=>total>=r.min?i:found,0));
  const rank=ranks[rankIndex],nextRank=ranks[rankIndex+1];
  const progress=nextRank?Math.max(0,Math.min(100,Math.round((total-rank.min)/(nextRank.min-rank.min)*100))):100;
  const quests=[
    {id:'buy',icon:'↗',name:'First collectible',description:'Buy an NFT from a supported Gnotbook collection.',points:10,route:'market',cta:'Explore market',eventLabels:['Purchase']},
    {id:'list',icon:'↗',name:'Make an offer to the world',description:'List an NFT you own at a fixed price.',points:5,route:'portfolio',cta:'My NFTs',eventLabels:['Listing']},
    {id:'mint',icon:'✳',name:'Mint your first punk',description:'Mint a public edition when the collection mint is live.',points:8,route:'explore',cta:'View collection',eventLabels:['Mint']},
    {id:'launch',icon:'▦',name:'Build your own collection',description:'Deploy a collection from your wallet and register it in Gnotbook.',points:15,route:'create',cta:'Create collection',eventLabels:['Collection launch']},
    {id:'cancel',icon:'⟲',name:'Manage your listing',description:'Cancel a listing you created when you want to take it off the market.',points:2,route:'portfolio',cta:'Manage NFTs',eventLabels:['Listing cancellation']}
  ];
  const questMarkup=quests.map(q=>{const done=events.some(e=>(q.eventLabels||[]).includes(String(e.label||'')));return `<article class="quest-card ${done?'is-complete':''}"><div class="quest-card-top"><span class="quest-icon">${q.icon}</span><span class="quest-state ${done?'complete':''}">${done?'Completed':'On-chain task'}</span></div><h3>${q.name}</h3><p>${q.description}</p><div class="quest-bottom"><span class="points-tag">+${q.points} points</span><button class="quest-cta" data-route="${q.route}">${q.cta} <span>↗</span></button></div></article>`}).join('');
  return `<div class="rewards-page"><header class="page-heading rewards-heading"><div><div class="eyebrow"><span class="eyedot"></span> Community reputation</div><h1>Rewards<span class="heading-period">.</span></h1><p>Complete real marketplace actions and earn points after the Gno.land transaction is confirmed.</p></div><div class="heading-actions">${state.wallet?'<button class="btn btn-outline" data-action="refresh-wallet">Refresh points ↻</button>':'<button class="btn btn-dark" data-action="connect">Connect wallet</button>'}</div></header>
    <section class="reward-hero reward-hero-premium"><div class="reward-hero-copy"><div class="eyebrow">Your Gnotbook standing</div><h2>${rank.name}<span class="heading-period">.</span></h2><p>${nextRank?`${(nextRank.min-total).toLocaleString('en-US')} points until ${nextRank.name}.`:'You reached the highest current rank.'} Points are a non-transferable reputation score.</p><div class="rank-track"><span style="width:${progress}%"></span></div><div class="reward-next">${nextRank?`${progress}% to next rank`:'Top rank'}</div></div><div class="points-total"><strong>${total.toLocaleString('en-US')}</strong><span>VERIFIED POINTS</span><div class="points-mark">✳</div></div></section>
    <section class="reward-quests"><div class="section-head"><div><div class="eyebrow">Your next move</div><h2>Quests</h2><p>Every reward is tied to a confirmed transaction. No points for clicks or page views.</p></div><span class="quest-counter">${events.length} verified actions</span></div><div class="quest-grid">${questMarkup}</div></section>
    <section class="reward-verify"><div class="reward-verify-copy"><div class="eyebrow">Missing a reward?</div><h2>Verify a transaction</h2><p>If the automatic check did not pick up your transaction, paste its hash to request verification.</p></div><div class="reward-verify-form"><label for="rewardTxHash">Gno.land transaction hash</label><input id="rewardTxHash" class="mono" placeholder="Paste transaction hash…" ${!state.wallet?'disabled':''}><button class="btn btn-dark" data-action="verify-points" ${!state.wallet?'disabled':''}>Verify transaction ↗</button></div></section>
    <section class="reward-history"><div class="section-head"><div><div class="eyebrow">Your record</div><h2>Points history</h2></div></div>${events.length?`<div class="reward-history-list">${events.map(e=>`<div class="reward-history-row"><span class="history-mark">✳</span><span class="history-details"><strong>${escapeHTML(e.label)}</strong><small>${new Date(e.time).toLocaleString('en-US')} · <a href="https://gnoscan.io/" target="_blank" rel="noopener noreferrer">View on Gnoscan ↗</a></small></span><strong class="history-points">+${Number(e.points||0)} pts</strong></div>`).join('')}</div>`:`<div class="reward-empty"><span class="reward-empty-mark">✳</span><div><h3>Your story starts with your first on-chain action</h3><p>Connect Adena, explore the market or mint when a public drop is live.</p></div><button class="btn btn-outline" data-route="market">Explore market ↗</button></div>`}</section>
  </div>`;
}
function renderActivity(){
  const listings=state.market.listings||[];
  const events=state.points.events||[];
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> The living record</div><h1>Activity</h1><p>Current asking prices from the collection realms and your verified Gnotbook reward history. Full chain activity remains public in Gnoscan.</p></div><div class="heading-actions"><a class="btn btn-outline" href="https://gnoscan.io/" target="_blank" rel="noreferrer">Open Gnoscan ↗</a></div></div>
  <div class="two-col"><div class="panel"><h3>Live listings</h3><p>Read from each collection's current ListOpen() response. This is current state, not a complete historical feed.</p>${listings.length?`<div class="activity-list">${listings.slice(0,20).map(n=>`<div class="activity-row"><div class="activity-icon">◈</div><div><strong>${escapeHTML(n.name)}</strong><span>${escapeHTML(n.collectionName)} · seller ${escapeHTML(shortAddr(n.seller))}</span></div><div class="activity-value">${displayGnot(n.priceUgnot)}</div></div>`).join('')}</div>`:`<div class="empty-state" style="padding:28px"><h3>No active listing data</h3><p>RPC may be unavailable, or Gnotbook-registered realms currently have no public listings.</p></div>`}</div><div class="panel"><h3>Your reward activity</h3><p>Only verified contract events are credited.</p>${events.length?`<div class="activity-list">${events.slice(0,12).map(e=>`<div class="activity-row"><div class="activity-icon">✳</div><div><strong>${escapeHTML(e.label)}</strong><span>${new Date(e.time).toLocaleDateString('en-US')}</span></div><div class="activity-value">+${Number(e.points)} pts</div></div>`).join('')}</div>`:`<div class="empty-state" style="padding:28px"><div class="empty-art">◌</div><h3>No reward history yet</h3><p>Connect a wallet and start collecting or creating.</p></div>`}</div></div>`;
}

// The founder reserve is minted by Init only when a founder address is configured; the client
// sends 0 otherwise, so the copy must follow the reserve the launch will actually make.
function plannedFounderReserve(){
  const moon=state.config?.moonbound||{};
  return String(moon.founderAddress||'')?Number(moon.founderReserve||0):0;
}
function founderReserveCopy(supply){
  const reserve=plannedFounderReserve();
  return reserve
    ? `Editions #0001–#${String(reserve).padStart(4,'0')} are allocated to the founder reserve; #${String(reserve+1).padStart(4,'0')}–#${String(supply).padStart(4,'0')} form the public run.`
    : `No founder address is configured yet, so no editions are reserved and all ${num(supply)} form the public run.`;
}
function computeLaunchDue(){
  const launchFeeGnot=Number(state.config?.launchFeeGnot||5);
  const feeUgnot=Number(state.config?.collectionServiceFeeUgnot||5_000_000);
  const adminWallet=String(state.config?.adminWallet||'');
  const isAdmin=!!state.wallet&&adminWallet&&state.wallet.address.toLowerCase()===adminWallet.toLowerCase();
  const due=isAdmin?0:launchFeeGnot;
  // The contract waives the fee for the registry admin and rejects an unexpected payment, so the
  // admin's launch attaches no coins at all rather than a zero amount.
  return {fee:launchFeeGnot, isAdmin, due, dueSend:isAdmin?'':`${feeUgnot}ugnot`};
}
function createPreviewMarkup(){
  const img=state.activeUpload?.gatewayUrl||'';
  const {fee,isAdmin,due}=computeLaunchDue();
  return `<aside class="preview-card">${img?`<img id="collectionPreviewImage" class="preview-image" src="${escapeHTML(imageSrc(img))}" alt="NFT collection preview">`:`<div class="preview-image preview-ph" id="collectionPreviewImage"><span class="brick-ghost" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="preview-ph-note">Cover preview</span></div>`}<div class="preview-info"><div class="tiny-label">Live preview</div><h3 id="previewName">${escapeHTML($('#collectionName')?.value||'Your collection')}</h3><p id="previewSymbol">${escapeHTML($('#collectionSymbol')?.value||'SYMBOL')} · Connected wallet as creator</p><div class="fee-breakdown"><div class="fee-line"><span>One-time collection launch</span><strong id="serviceFeeValue">${fee.toLocaleString('en-US')} GNOT</strong></div><div class="fee-line"><span>${isAdmin?'Admin wallet override':'Your wallet'}</span><strong>${due.toLocaleString('en-US')} GNOT</strong></div><div class="fee-line"><span>Gnotbook fee on secondary sales</span><strong>2.5%</strong></div><div class="fee-line"><span>Network gas + package storage</span><strong>Wallet estimate</strong></div><div class="fee-total"><span>Due now</span><span>${due.toLocaleString('en-US')} GNOT + gas</span></div></div><p class="modal-note">${isAdmin?'The registry admin wallet launches without the 5 GNOT fee — the fee exists to charge third-party creators.':'The launch fee goes to the Gnotbook treasury once.'} Fee is enforced by the registry contract, not by this page. Gas and package storage are estimated by Adena separately.</p></div></aside>`;
}
// ---- Upcoming Mints -------------------------------------------------------
// Single source of truth: collections saved on the server (store) that carry a mintStartAt.
// Statuses derive from real time; the countdown updates via [data-countdown] spans, no re-render.
function upcomingStatusOf(c){
  const start=c.mintStartAt?new Date(c.mintStartAt).getTime():0;
  const now=Date.now();
  const minted=Number(c.minted||0);
  const supply=Number(c.maxSupply||0);
  const published=c.launchStatus&&c.launchStatus!=='DRAFT'&&!String(c.slug).startsWith('draft-');
  const fullyMinted=supply>0&&minted>=supply;
  if(!start){
    // No date set: derive the state from the mint switch instead of calling
    // every undated collection a draft.
    if(fullyMinted)return {key:'ended',label:'Ended',chip:{tone:'ended',label:'Ended'},note:'Fully minted.'};
    if(c.mintEnabled)return {key:'live',label:'Live',chip:{tone:'live',label:'Live'},note:'Minting is open.'};
    return {key:'draft',label:'Draft',chip:{tone:'pending',label:'Draft'},note:'No mint date set yet.'};
  }
  if(start>now)return {key:'scheduled',start,label:'Scheduled',chip:{tone:'pending',label:'Scheduled'},note:''};
  if(now>=start&&(fullyMinted||now-start>1000*60*60*72&&!c.mintEnabled))
    return {key:'ended',start,label:'Ended',chip:{tone:'ended',label:'Ended'},note:''};
  return {key:'live',start,label:'Live',chip:{tone:'live',label:'Live'},note:''};
}
function countdownSpan(startIso,context=''){
  if(!startIso)return '<span class="mint-countdown"><span>No date set</span></span>';
  const start=new Date(startIso).getTime();
  const late=start<Date.now();
  return `<span class="mint-countdown" data-start="${startIso}" data-countdown="${late?'after':'before'}" data-context="${escapeHTML(context)}" aria-live="off"><span class="cd-placeholder">—</span></span>`;
}
function mintCountdownText(startIso,before){
  const diff=new Date(startIso).getTime()-Date.now();
  const t=before?diff:-diff;
  if(t<=0)return '00D 00H 00M';
  const d=Math.floor(t/86_400_000),h=Math.floor(t%86_400_000/3_600_000),m=Math.floor(t%3_600_000/60_000);
  return `${String(d).padStart(2,'0')}D ${String(h).padStart(2,'0')}H ${String(m).padStart(2,'0')}M`;
}
// The mint page: filters, sorting, live countdowns, and honest allowlist status.
function renderUpcoming(){
  const all=(state.market.collections||[]).filter(c=>true);
  const filter=state.upcomingFilter||'all';
  const sort=state.upcomingSort||'time-asc';
  const withStatus=all.map(c=>({c,status:upcomingStatusOf(c)}))
    .filter(x=>filter==='all'||x.status.key===filter);
  if(sort==='time-asc')withStatus.sort((a,b)=>(a.status.start||9e15)-(b.status.start||9e15));
  else if(sort==='time-desc')withStatus.sort((a,b)=>(b.status.start||9e15)-(a.status.start||9e15));
  else if(sort==='newest')withStatus.sort((a,b)=>String(b.c.slug).localeCompare(String(a.c.slug)));
  const counts=all.reduce((acc,c)=>{const k=upcomingStatusOf(c).key;acc[k]=(acc[k]||0)+1;return acc},{});
  const pills=[['all',`All (${all.length})`],['scheduled',`Scheduled (${counts.scheduled||0})`],['live',`Live (${counts.live||0})`],['ended',`Ended (${counts.ended||0})`],['draft',`Draft (${counts.draft||0})`]];
  const cards=withStatus.map(({c,status})=>{
    const wl=c.allowlistPrepared;
    const access=c.mintType==='free'
      ?`Free mint${c.mintPriceUgnot>0?' (contract fee applies)':''}${wl?` · Allowlist ready (${num(c.allowlistCount)} wallets)`:' · Allowlist not provided'}`
      :`Paid mint · ${displayGnot(c.mintPriceUgnot||0)}`;
    return `<article class="mint-card">
      <div class="mint-cover"><span class="mint-badge ${status.key}">${status.label}</span>
        ${c.cover||c.image?`<img loading="lazy" src="${escapeHTML(imageSrc(c.cover||c.image||ART.glass))}" alt="${escapeHTML(c.name)} cover" onerror="this.remove()">`:`<span class="mint-cover-ph">${escapeHTML(c.symbol||'COLLECTION')}</span>`}
      </div>
      <div class="mint-body">
        <h3 class="mint-title">${escapeHTML(c.name)}</h3>
        <p class="mint-desc">${escapeHTML(c.description||'Community collection on Gnotbook.')}</p>
        <div class="mint-when">${clockIcon()}<span>${c.mintStartAt?new Date(c.mintStartAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})+' ('+Intl.DateTimeFormat().resolvedOptions().timeZone+')':'Mint date not set'}</span></div>
        ${c.mintStartAt?countdownSpan(c.mintStartAt):''}
        <div class="mint-meta">
          <span class="chip">${c.mintType==='free'?'Free Mint':'Paid Mint'}</span>
          <span class="chip">${supplyLabel(c)}</span>
          ${wl?`<span class="chip">Allowlist ${num(c.allowlistCount)}</span>`:''}
          ${c.website?`<a class="chip" href="${escapeHTML(c.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>`:''}
        </div>
        ${status.note?`<p class="note">${escapeHTML(status.note)}</p>`:''}
        <div class="mint-action"><button class="btn btn-outline btn-full" data-action="open-collection" data-path="${escapeHTML(c.path)}">Open collection ↗</button></div>
      </div>
    </article>`;
  }).join('');
  const body=all.length
    ?(withStatus.length?`<div class="upcoming-grid">${cards}</div>`:`<div class="empty-state is-compact"><h3>No mints match this filter</h3><p>Try another status or clear the filter.</p><button class="btn btn-outline" data-action="upcoming-filter" data-value="all">Show all</button></div>`)
    :`<div class="empty-state"><div class="legend-brick-cookie" aria-hidden="true"></div><h3>No upcoming mints yet</h3><p>The schedule is intentionally empty. Create a collection with a mint date and it will appear here automatically.</p><button class="btn btn-dark" data-route="create">Create collection ↗</button></div>`;
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> The mint schedule</div><h1>Upcoming Mints<span class="heading-period">.</span></h1><p>Every card is a real collection saved on this server. Countdowns tick live from the actual start time; statuses are computed from real time, never faked.</p></div></div>
  <div class="upcoming-filters"><div class="filter-pills">${pills.map(([value,label])=>`<button class="filter-pill ${filter===value?'active':''}" data-action="upcoming-filter" data-value="${value}">${label}</button>`).join('')}</div>
  <select id="upcomingSortSelect" class="select-control" aria-label="Sort mints"><option value="time-asc" ${sort==='time-asc'?'selected':''}>Earliest first</option><option value="time-desc" ${sort==='time-desc'?'selected':''}>Latest first</option><option value="newest" ${sort==='newest'?'selected':''}>Newest added</option></select></div>
  ${body}
  <p class="note" style="margin-top:16px">Allowlist counts are verified by this server. The on-chain free-mint gate is preparation-only until a collection realm supports allowlist proofs.</p>`;
}
function clockIcon(){return '<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></span>'}
// Artwork mode: the server pins the file, or the creator pins it in their own account.
function pinMode(){return document.querySelector('input[name="pinMode"]:checked')?.value||'self';}
function applyPinMode(){
  const mode=pinMode();
  document.querySelectorAll('[data-pin-mode]').forEach(node=>{node.style.display=node.dataset.pinMode===mode?'':'none';});
}
function cidValues(){
  return {
    imageCid:($('#pinImageCid')?.value||'').trim().replace(/^ipfs:\/\//i,''),
    metadataCid:($('#pinMetadataCid')?.value||'').trim().replace(/^ipfs:\/\//i,''),
    imageBaseCid:($('#pinImageBaseCid')?.value||'').trim().replace(/^ipfs:\/\//i,'')
  };
}
async function verifyCid(cid,kind){
  return api('/api/ipfs/verify',{method:'POST',body:JSON.stringify({cid,kind})});
}
async function verifyCids(){
  const out=$('#cidCheckResult');
  if(!out)return;
  const {imageCid,metadataCid}=cidValues();
  if(!imageCid||!metadataCid){out.textContent='Both the artwork CID and the metadata CID are needed.';out.className='pin-result warn';return;}
  out.textContent='Checking on the public gateway…';out.className='pin-result';
  try{
    const [img,meta]=await Promise.all([verifyCid(imageCid,'image'),verifyCid(metadataCid,'metadata')]);
    const traits=Number(meta.attributes||0);
    out.textContent=`Artwork resolved (${Math.max(1,Math.round(Number(img.size||0)/1024))} kB) · metadata “${meta.name||'unnamed'}”${traits?` · ${traits} traits`:''}`;
    out.className='pin-result ok';
  }catch(e){out.textContent=e.message||'That CID could not be resolved.';out.className='pin-result warn';}
}
function supplyLabel(c){const supply=Number(c.maxSupply||0);return supply?`${num(supply)} supply`:'supply open'}
function renderUpcomingStrip(){
  const colls=(state.market.collections||[]).filter(c=>c.mintStartAt);
  if(!colls.length)return '';
  const top=colls.filter(c=>new Date(c.mintStartAt).getTime()>Date.now()-72*3600_000).slice(0,3);
  if(!top.length)return '';
  return `<section><div class="section-head"><div><span class="section-index"><b>01</b> / NEXT MINTS</span><h2>ON THE SCHEDULE</h2><p>Countdowns below tick in real time.</p></div><button class="text-action" data-route="upcoming">ALL UPCOMING MINTS →</button></div>
  <div class="upcoming-grid">${top.map(c=>{const status=upcomingStatusOf(c);return `<article class="mint-card">
    <div class="mint-cover"><span class="mint-badge ${status.key}">${status.label}</span>${c.cover||c.image?`<img loading="lazy" src="${escapeHTML(imageSrc(c.cover||c.image||ART.glass))}" alt="" onerror="this.remove()">`:`<span class="mint-cover-ph">${escapeHTML(c.symbol||'COLLECTION')}</span>`}</div>
    <div class="mint-body"><h3 class="mint-title">${escapeHTML(c.name)}</h3>
    <div class="mint-when">${clockIcon()}<span>${new Date(c.mintStartAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</span></div>
    ${countdownSpan(c.mintStartAt)}
    <div class="mint-action"><button class="btn btn-outline btn-sm" data-action="open-collection" data-path="${escapeHTML(c.path)}">Open ↗</button></div>
  </div></article>`}).join('')}</div></section>`;
}
// Decides the live counting direction from data attributes left by the renderers.
function tickCountdowns(){
  $$('[data-countdown]').forEach(node=>{
    const start=node.dataset.start;if(!start)return;
    const startMs=new Date(start).getTime();
    const before=startMs>Date.now();
    node.dataset.countdown=before?'before':'after';
    const label=`${before?'Starts in':'Live since'} ${mintCountdownText(start,before)}${before?'':' '}`;
    node.innerHTML=`<span class="${before?'':'cd-live'}">${label.replace(/ /g,'&nbsp;')}</span>`;
  });
}
setInterval(tickCountdowns,1000);

function renderMintCalendar(){
  return renderUpcoming();
}

function renderCreate(){
  const active=state.activeCreateTab;
  const canUpload=!!state.config?.pinningConfigured;
  const transactionNote=state.config?.transactionsEnabled?`Gnotbook transactions are enabled on ${escapeHTML(state.config.chainId)}. Adena will show the registry, fee and network gas before approval.`:`Transactions are in read-only mode until the Gnotbook registry, treasury and explicit network-write setting are configured.`;
  const {fee,isAdmin,due}=computeLaunchDue();
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Creator studio</div><h1>Make it real.</h1><p>Deploy your own Gno.land collection realm, pin artwork and metadata to IPFS, then mint. The collection registers in Gnotbook's independent registry; no third-party marketplace contract is required.</p></div><div class="heading-actions"><span class="status-chip ${canUpload?'good':'pending'}">${canUpload?'IPFS ready':'IPFS setup needed'}</span><span class="status-chip ${state.config?.transactionsEnabled?'good':'pending'}">${state.config?.transactionsEnabled?'Transactions enabled':'Read-only mode'}</span></div></div>
  <div class="tabs-row"><button class="tab-btn ${active==='collection'?'active':''}" data-action="create-tab" data-value="collection">Create collection</button><button class="tab-btn ${active==='mint'?'active':''}" data-action="create-tab" data-value="mint">Mint an item</button><button class="tab-btn ${active==='trust'?'active':''}" data-action="create-tab" data-value="trust">Trust & safety</button><button class="tab-btn" data-action="create-tab" data-value="calendar">Mint calendar</button></div>
  ${active==='collection'?renderCollectionForm(transactionNote,canUpload,fee,isAdmin,due):active==='mint'?renderMintForm(transactionNote,canUpload):active==='calendar'?renderMintCalendar():renderTrustForm()}`;
}

// The featured-collection launch block belongs with the collection on the homepage: it is an
// operator action for a pinned realm, not something a creator does in the studio form.
function renderCollectionForm(transactionNote,canUpload,launchFeeGnot,isAdmin,due){
  const walletAddr=escapeHTML(state.wallet?.address||'');
  const tzOptions=[['+00:00','UTC ±00:00'],['-12:00','UTC −12:00'],['-10:00','UTC −10:00 Honolulu'],['-08:00','UTC −08:00 Los Angeles'],['-07:00','UTC −07:00 Denver'],['-06:00','UTC −06:00 Mexico City'],['-05:00','UTC −05:00 New York'],['-04:00','UTC −04:00 Santiago'],['-03:00','UTC −03:00 São Paulo'],['+01:00','UTC +01:00 Berlin'],['+02:00','UTC +02:00 Kyiv'],['+03:00','UTC +03:00 Moscow'],['+04:00','UTC +04:00 Dubai'],['+05:30','UTC +05:30 Mumbai'],['+07:00','UTC +07:00 Bangkok'],['+08:00','UTC +08:00 Singapore'],['+09:00','UTC +09:00 Tokyo'],['+10:00','UTC +10:00 Sydney'],['+12:00','UTC +12:00 Auckland']];
  const wl=state.draftWhitelist||null;
  const tzDefault=state.wallet?'+02:00':'+02:00';
  const freeSelected=(state.draftMintType||'free')==='free';
  return `<form id="collectionForm" class="form-layout"><div class="panel"><div class="form-stack"><div><div class="tiny-label">01 / Identity</div><h3 style="margin-top:5px">Create your collection</h3><p style="margin-top:5px">Save a collection draft to this server (free, no wallet needed), then optionally launch it on-chain with Adena. Nothing shows up in Gnotbook until a draft or an on-chain registry record exists.</p></div>
  <div class="field"><label for="collectionName">Collection name *</label><input id="collectionName" name="name" required maxlength="64" placeholder="e.g. Neon Orchard"><span class="helper">Displayed across the marketplace and wallet.</span></div>
  <div class="field-grid"><div class="field"><label for="collectionSymbol">Ticker / symbol *</label><input id="collectionSymbol" name="symbol" required maxlength="11" pattern="[A-Za-z0-9]{1,11}" placeholder="GARDEN"><span class="helper">1–11 letters or numbers.</span></div><div class="field"><label for="collectionSlug">Realm slug *</label><input id="collectionSlug" name="slug" required maxlength="11" pattern="[a-z][a-z0-9]{1,10}" placeholder="gardens"><span class="helper">Lowercase letters/numbers, 2–11 chars. One collection per slug.</span></div></div>
  <div class="field"><label for="collectionNamespace">Your Gno.land namespace (wallet address)</label><input id="collectionNamespace" name="namespace" value="${walletAddr}" readonly placeholder="Connect Adena to fill your wallet address"><span class="helper">Required only for the on-chain launch — the connected wallet address becomes the realm namespace.</span></div>
  <div class="field"><label for="collectionDescription">Description</label><textarea id="collectionDescription" name="description" maxlength="1000" placeholder="What makes this collection special?"></textarea></div>
  ${state.lastDraft?`<div class="inline-info" id="draftSavedNote"><strong>✓ Draft “${escapeHTML(state.lastDraft.name)}” saved on this server${state.lastDraft.whitelistCount?` with ${num(state.lastDraft.whitelistCount)} whitelisted wallets`:''}.</strong> It is not deployed on-chain yet. <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn btn-dark btn-sm" data-route="upcoming">Open Upcoming mints →</button><button type="button" class="btn btn-outline btn-sm" data-action="launch-collection">Launch on-chain</button></div></div>`:''}
  <div><div class="tiny-label">01b / Artwork &amp; metadata on IPFS</div></div>
  ${canUpload
    ?`<div class="pin-choices">
        <label class="pin-choice"><input type="radio" name="pinMode" value="self" checked><span><b>I pinned it myself</b><small>Pin in your own Pinata or Octopin account and paste the CIDs. The server never needs your key.</small></span></label>
        <label class="pin-choice"><input type="radio" name="pinMode" value="server"><span><b>Upload here</b><small>The server pins your file to IPFS (${Number(state.config?.maxUploadMB||15)} MB max).</small></span></label>
      </div>
      <label class="upload-drop" data-pin-mode="server" for="collectionCover"><span class="upload-icon">↥</span><span><strong id="coverLabel">Upload collection cover</strong><span>PNG, JPEG, WEBP or GIF · max ${Number(state.config?.maxUploadMB||15)} MB · pinned to public IPFS</span></span><span class="btn btn-outline upload-choose">Choose file</span><input id="collectionCover" name="cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>`
    :`<div class="pin-choices">
        <label class="pin-choice"><input type="radio" name="pinMode" value="self" checked><span><b>I pinned it myself</b><small>Pin the artwork and metadata in your own IPFS account, then paste the CIDs here.</small></span></label>
        <label class="pin-choice"><input type="radio" name="pinMode" value="server" disabled><span><b>Upload here</b><small>Unavailable: this server has no IPFS pinning credential. Ask the operator to add one.</small></span></label>
      </div>`}
  <div class="pin-self" data-pin-mode="self">
    <div class="pin-guide">
      <p class="note">Pin the files in your own account — Gnotbook never needs your storage key. Then paste the CIDs below.</p>
      <ol class="pin-steps">
        <li><b>Pinata</b> — <a href="https://app.pinata.cloud/" target="_blank" rel="noopener">app.pinata.cloud</a>: open <em>Files</em>, drag your image and your <code>metadata.json</code> in, and copy each file's CID (Files → the three dots next to a file → <em>Copy CID</em>).</li>
        <li><b>Octopin</b> — <a href="https://octopin.app/" target="_blank" rel="noopener">octopin.app</a>: upload the same two files and copy their CIDs. For scripted uploads the API is <code>POST https://upload.octopin.app/api/upload</code>.</li>
        <li>Come back here and paste the CIDs. Gnotbook checks them on the public gateway — no key, no upload through us.</li>
      </ol>
    </div>
    <div class="field-grid">
      <div class="field"><label for="pinImageCid">Artwork CID *</label><input id="pinImageCid" name="imageCid" placeholder="bafybei…  (the cover image)" autocomplete="off" spellcheck="false"><span class="helper">The pinned cover image. It becomes the collection banner and the edition artwork.</span></div>
      <div class="field"><label for="pinMetadataCid">Metadata CID *</label><input id="pinMetadataCid" name="metadataCid" placeholder="bafybei…  (metadata.json)" autocomplete="off" spellcheck="false"><span class="helper">A JSON with <code>name</code>, <code>image</code> and optional <code>attributes</code>.</span></div>
    </div>
    <div class="field"><label for="pinImageBaseCid">Image base directory CID</label><input id="pinImageBaseCid" name="imageBaseCid" placeholder="optional — the folder that holds all editions" autocomplete="off" spellcheck="false"><span class="helper">Only needed when your editions live in a folder: the contract stores this base and reads <code>&lt;base&gt;/&lt;id&gt;.webp</code>.</span></div>
    <div class="pin-actions">
      <button type="button" class="btn btn-outline" data-action="verify-cids">Check the CIDs</button>
      <span class="pin-result" id="cidCheckResult">Not checked yet.</span>
    </div>
  </div>
  <div><div class="tiny-label">02 / Mint schedule &amp; type</div></div>
  <div class="field-grid"><div class="field"><label for="mintStartDate">Mint start date</label><input id="mintStartDate" type="date"><span class="helper">Leave empty for “date TBA” — the mint shows as Draft.</span></div><div class="field"><label for="mintStartTime">Mint start time</label><input id="mintStartTime" type="time"></div></div>
  <div class="field"><label for="mintTimezone">Mint timezone</label><select id="mintTimezone">${tzOptions.map(([v,l])=>`<option value="${v}" ${v===tzDefault?'selected':''}>${l}</option>`).join('')}</select><span class="helper">The countdown on Upcoming mints is built from this moment, converted to real time.</span></div>
  <div class="field-grid"><div class="field"><label for="mintType">Mint type</label><select id="mintType"><option value="free" ${freeSelected?'selected':''}>Free mint — no price</option><option value="paid" ${!freeSelected?'selected':''}>Paid mint — price required</option></select></div><div class="field"><label for="mintPriceGnot">Mint price (GNOT, for paid mints)</label><input id="mintPriceGnot" type="number" min="0" step="0.000001" value="${freeSelected?'0':'5'}" ${freeSelected?'disabled':''}><span class="helper">For a draft this price is public metadata; the enforced price comes from the realm contract.</span></div></div>
  <div class="field"><label for="collectionWebsite">Project website link</label><input id="collectionWebsite" type="url" maxlength="300" placeholder="https://your-project.example"><span class="helper">Optional; must be a valid http(s) link.</span></div>
  <div><div class="tiny-label">03 / Whitelist (allowlist)</div></div>
  <div class="wl-header"><div><div class="field"><label for="whitelistFile">Wallet addresses file (g1… addresses)</label><input id="whitelistFile" type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json"><span class="helper">TXT, CSV or JSON — one g1… address per line (or CSV first column / JSON array). Max 10,000 addresses, 128 kB. Parsed and de-duplicated by the server.</span></div></div>
    <div class="wl-actions">${wl?`<button type="button" class="btn btn-outline btn-sm" data-action="remove-wl">Remove list</button>`:''}</div></div>
  ${state.draftWhitelist
    ?`<div class="wl-preview"><span class="wl-pill"><b>${num(state.draftWhitelist.valid.length)}</b> valid addresses</span>${state.draftWhitelist.invalid.length?`<span class="wl-pill" style="background:var(--error-bg);color:#7C1B2E"><b>${num(state.draftWhitelist.invalid.length)}</b> invalid lines</span>`:''}<span class="wl-pill">${escapeHTML(state.draftWhitelist.name)}</span></div>
  ${state.draftWhitelist.invalid.length?`<div class="wl-errors" role="alert">${state.draftWhitelist.invalid.slice(0,20).map(e=>`<div>Line ${e.line}: ${escapeHTML(e.reason)}</div>`).join('')}</div>`:''}
  ${state.draftWhitelist.error?`<div class="inline-info danger-info">${escapeHTML(state.draftWhitelist.error)}</div>`:''}
  <label class="checkbox-row"><input id="confirmWhitelist" type="checkbox"><span>I confirm this allowlist was provided by the project team. Addresses are stored on the server and are never shown publicly — only the wallet count is published.</span></label>`
    :`<div class="inline-info">No allowlist attached. Without one, a free mint is public for everyone; the on-chain gate is not enforced until the realm supports allowlist proofs.</div>`}
  <div><div class="tiny-label">04 / Supply, royalty, rights</div></div>
  <div class="field"><label for="maxSupply">Supply cap</label><input id="maxSupply" type="number" min="1" max="1000000" value="1000" required><span class="helper">Finite cap from 1 to 1,000,000 creator-minted items.</span></div>
  <div class="field"><label for="royalty">Creator royalty (%)</label><select id="royalty"><option value="2" selected>2% — recommended</option><option value="0">0% — no secondary royalty</option><option value="5">5%</option><option value="7.5">7.5%</option><option value="10">10% — protocol maximum</option></select><span class="helper">Applied by this collection's Buy contract. Royalty is separate from platform fees.</span></div>
  <label class="checkbox-row"><input id="confirmRights" type="checkbox" required><span>I own or have permission to publish this artwork and collection name. ${canUpload?'I understand that IPFS is public and immutable.':'I understand saved artwork stays on this server until IPFS is configured.'}</span></label>
  <div class="inline-info">✓ <strong>Save collection</strong> stores a draft in this server's store — free, no wallet. ⬆ <strong>Launch on-chain</strong> publishes the artwork you pinned and deploys the realm with Adena. ${escapeHTML(transactionNote)}</div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
   <button class="btn btn-dark" type="button" id="saveDraftButton" data-action="save-draft">Save collection (draft)</button>
   <button class="btn btn-outline" type="button" id="launchCollectionButton" data-action="launch-collection" ${(!state.wallet||!state.config?.transactionsEnabled||!state.config?.treasuryConfigured)?'disabled':`title="Deploy the realm on-chain with Adena — launch fee ${due.toLocaleString('en-US')} GNOT + gas"`}>Launch on-chain <span>↗</span></button>
  </div>
  <div class="fee-card">
   <div class="eyebrow" style="color:var(--primary)">On-chain launch cost</div>
   <div class="row"><span>Collection deploy <em style="font-style:normal;color:var(--muted-2)">(config)</em></span><span>${launchFeeGnot.toLocaleString('en-US')} GNOT</span></div>
   <div class="row"><span>${isAdmin?'Admin wallet override':'Your wallet'}</span><span>${due.toLocaleString('en-US')} GNOT</span></div>
   <div class="row tot"><span>Due now</span><span>${due.toLocaleString('en-US')} GNOT + gas</span></div>
   <div class="note" style="margin-top:9px">${isAdmin?'You are launching from the <strong>registry admin wallet</strong>, so the 5 GNOT launch fee is waived by the contract. ':'The launch fee goes to the Gnotbook treasury once. '}Gas and package storage are estimated by Adena separately.</div>
  </div>
  <div class="panel" style="margin-top:12px"><div class="tiny-label">Launch rules · enforced in code</div><div style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
   <div class="kv"><span>Paid deploy</span><b>Register refuses a realm whose 5 GNOT launch fee was not settled to the registry fee sink</b></div>
   <div class="kv"><span>Free launches</span><b>Only for the registry admin wallet — the operator's own collections never pay their own fee sink</b></div>
   <div class="kv"><span>Slug &amp; realm</span><b>One collection per slug and per package; duplicates are rejected on-chain</b></div>
   <div class="kv"><span>Supply cap</span><b>1 to 1,000,000 items, validated by the registry</b></div>
   <div class="kv"><span>Royalty</span><b>0% to 10%, validated by the registry</b></div>
   <div class="kv"><span>Art &amp; metadata</span><b>Both IPFS directory bases must be set, or neither; non-IPFS URIs are rejected</b></div>
   <div class="kv"><span>Uploads</span><b>PNG, JPEG, WEBP or GIF only — SVG and HTML are refused — one file per request, ${Number(state.config?.maxUploadMB||15)} MB max, server rate limits on writes</b></div>
   <div class="kv"><span>Whitelist</span><b>TXT/CSV/JSON, ≤10,000 unique g1 addresses, 128 kB — stored server-side, never published</b></div>
   <div class="kv"><span>Review</span><b>New collections are unverified by default and cannot be bought until a human review checks the official links</b></div>
  </div></div>
  ${state.config?.bootstrapEnabled?`<div class="inline-info"><strong>The Gnotbook registry is not deployed yet.</strong> Until it exists, every launch, mint and sale on ${escapeHTML(state.config.chainId)} stays read-only. Deploy it once from your wallet, then set <code>MORROW_REGISTRY_PATH</code> in .env and restart.<div style="margin-top:9px"><button type="button" class="btn btn-outline" data-action="bootstrap-registry">Deploy Gnotbook registry ↗</button></div></div>`:''}
  ${!state.wallet?'<div class="inline-info">A draft can be saved without a wallet. Connecting Adena is required only for the on-chain launch.</div>':''}${!canUpload?'<div class="inline-info danger-info">IPFS pinning is not configured — drafts and covers still work on this server; on-chain launch needs the operator to enable pinning.</div>':''}${!state.config?.treasuryConfigured?'<div class="inline-info danger-info">Gnotbook treasury is not configured. Collection launch service fee collection remains disabled.</div>':''}</div></div>${createPreviewMarkup()}</form>`;
}
function renderMintForm(transactionNote,canUpload){
  const ownPaths=new Set((state.localCollections||[]).map(c=>c.path));
  const local=(state.localCollections||[]).map(c=>`<option value="${escapeHTML(c.path)}">${escapeHTML(c.name)} · Your recent launch</option>`).join('');
  const collections=(state.market.collections||[]).filter(c=>state.wallet && c.creator===state.wallet.address && !ownPaths.has(c.path)).map(c=>`<option value="${escapeHTML(c.path)}">${escapeHTML(c.name)} · creator wallet</option>`).join('');
  return `<form id="mintForm" class="form-layout"><div class="panel"><div class="form-stack"><div><div class="tiny-label">02 / Create an item</div><h3 style="margin-top:5px">Mint an NFT</h3><p style="margin-top:5px">Upload the artwork to IPFS, pin standard metadata JSON, then ask Adena to approve the Mint transaction.</p></div><div class="field"><label for="mintCollection">Collection realm *</label><select id="mintCollection" required><option value="">Choose a collection you control</option>${local}${collections}</select><span class="helper">The collection must expose a compatible Mint(cur, name, imageURL, metadataURI) method. The Gnotbook template exposes this interface.</span></div><div class="field"><label for="mintName">NFT name *</label><input id="mintName" required maxlength="64" placeholder="e.g. Garden Guardian #01"></div><div class="field"><label for="mintDescription">Description</label><textarea id="mintDescription" maxlength="1000" placeholder="Describe this item…"></textarea></div><div class="pin-choices">
  <label class="pin-choice"><input type="radio" name="pinMode" value="self" checked><span><b>I pinned it myself</b><small>Use your own Pinata or Octopin account and paste the CIDs.</small></span></label>
  <label class="pin-choice"><input type="radio" name="pinMode" value="server" ${canUpload?'':'disabled'}><span><b>Upload here</b><small>The server pins the file to IPFS.</small></span></label>
</div>
<label class="upload-drop" for="mintImage" data-pin-mode="server"><span class="upload-icon">▧</span><span><strong id="mintFileLabel">Upload artwork</strong><span>PNG, JPEG, WEBP or GIF · stored on IPFS</span></span><span class="btn btn-outline upload-choose">Choose file</span><input id="mintImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
  <div class="pin-self" data-pin-mode="self">
    <div class="pin-guide">
      <p class="note">Pin the artwork and the metadata in your own account, then paste the CIDs. Gnotbook only checks that they resolve.</p>
      <ol class="pin-steps">
        <li><b>Pinata</b> — <a href="https://app.pinata.cloud/" target="_blank" rel="noopener">app.pinata.cloud</a> → <em>Files</em> → drag the image and <code>metadata.json</code> in → copy each CID.</li>
        <li><b>Octopin</b> — <a href="https://octopin.app/" target="_blank" rel="noopener">octopin.app</a> → upload the same two files and copy their CIDs.</li>
      </ol>
    </div>
    <div class="field-grid">
      <div class="field"><label for="mintImageCid">Artwork CID *</label><input id="mintImageCid" placeholder="bafybei…" autocomplete="off" spellcheck="false"><span class="helper">The pinned image for this edition.</span></div>
      <div class="field"><label for="mintMetadataCid">Metadata CID *</label><input id="mintMetadataCid" placeholder="bafybei…" autocomplete="off" spellcheck="false"><span class="helper">The pinned metadata JSON for this edition.</span></div>
    </div>
  </div>
  <label class="checkbox-row"><input id="mintRights" type="checkbox" required><span>I have the rights to publish this artwork and its metadata publicly.</span></label><div class="inline-info">${escapeHTML(transactionNote)}</div><button class="btn btn-dark" type="submit" ${(!state.wallet||!state.config?.transactionsEnabled)?'disabled':''}>Mint with Adena ↗</button>${!canUpload?'<div class="inline-info danger-info">This server has no IPFS pinning credential — pin the files yourself and paste the CIDs above.</div>':''}</div></div><aside class="preview-card"><img class="preview-image" id="mintPreview" src="${ART.glass}" alt="NFT artwork preview... (truncated for brevity)">
</aside></div></form>`;
}
function renderTrustForm(){
  return `<div class="two-col"><div class="panel"><div class="eyebrow"><span class="eyedot"></span> Trust by design</div><h3 style="margin-top:8px">IPFS is storage, not a trust certificate.</h3><p>Content addressing means the bytes referenced by a CID cannot silently change, but anyone can upload a scam, impersonation or stolen image. Gnotbook therefore combines pinned media with on-chain identity checks and human review.</p><div class="divider"></div><div class="safety-points"><div class="safety-row"><span class="safety-check">✓</span><span><strong>Content-addressed media.</strong> Uploaded image and metadata JSON are pinned to the public IPFS network via a server-side Pinata credential.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>Wallet-signed deployment.</strong> The user deploys the collection realm from Adena; the application never sees private keys.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>On-chain registry registration.</strong> The marketplace indexes collection realms registered in the Gnotbook on-chain registry, not arbitrary lookalike labels.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>Verified badge is manual.</strong> A collection is unverified by default; the badge is reserved for explicit allowlisted realm paths after review.</span></div><div class="safety-row"><span class="safety-check">✓</span><span><strong>Report flow.</strong> Users can report a realm for impersonation or rights abuse and moderation can review it.</span></div></div></div><div class="panel"><h3>What Gnotbook never asks for</h3><div class="safety-points" style="margin-top:14px"><div class="safety-row"><span class="safety-check">×</span><span>No seed phrase</span></div><div class="safety-row"><span class="safety-check">×</span><span>No private key</span></div><div class="safety-row"><span class="safety-check">×</span><span>No secret token in browser code</span></div></div></div></div>`;
}
// Settings page: real server/wallet state only, read-only.
function renderSettings(){
  const cfg=state.config||{};
  const tab=state.activeSettingsTab||'profile';
  const balances=state.balances||[];
  const gnotBal=(balances.find(x=>x.denom==='ugnot')||{}).amount||0;
  const initials=state.wallet?state.wallet.address.slice(2,4).toUpperCase():'GB';
  const myColls=(state.market.collections||[]).filter(c=>state.wallet&&c.creator===state.wallet.address).length;
  const nav=[['profile','Profile'],['wallets','Wallets'],['server','Server']].map(([key,label])=>`<button class="${tab===key?'on':''}" data-action="settings-tab" data-value="${key}">${label}<span class="dot-mini" aria-hidden="true"></span></button>`).join('');
  let body='';
  if(tab==='profile'){
    body=`<div class="profile-head"><div class="profile-avatar">${escapeHTML(initials)}</div><div><h2>${state.wallet?shortAddr(state.wallet.address):'Guest identity'}</h2><p class="note">${state.wallet?`Connected via ${state.wallet.network==='atomone'?'Keplr (AtomOne)':'Adena (Gno.land)'} — this page shows only public data`:'Connect a wallet to fill in your profile.'}</p></div></div>
    <div class="stats"><div class="stat"><span>My collections</span><b>${num(myColls)}</b></div><div class="stat"><span>GNOT balance</span><b>${displayGnot(gnotBal)}</b></div><div class="stat"><span>Network</span><b>${escapeHTML(cfg.chainId||'gnoland')}</b></div></div>
    <div class="panel"><span class="tiny-label">Identity on Gno.land</span><p class="note" style="margin-top:8px">Your identity is your address — the realm proves ownership, not a password. On-chain actions (minting, listing) are signed in your wallet, never on this server.</p></div>`;
  }else if(tab==='wallets'){
    body=`<div class="panel">${balances.length?balances.map(b=>`<div class="kv"><span>${escapeHTML(b.denom)}</span><b>${num(Number(b.amount||0))}</b></div>`).join(''):'<p class="note">No balances reported. Connect a wallet and refresh.</p>'}
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-accent" data-action="connect">${state.wallet?'Refresh balances':'Connect wallet'}</button>${state.wallet?'<button class="btn btn-outline" data-action="disconnect">Disconnect</button>':''}</div>
    <p class="note" style="margin-top:12px">Gnotbook never stores keys. Adena and Keplr sign every transaction locally.</p></div>`;
  }else{
    const rows=[
      ['Network / chain ID',cfg.chainId||'unknown'],
      ['RPC endpoint',cfg.rpcUrl||'rpc.gno.land (default)'],
      ['Gnotbook registry',cfg.registryConfigured?String(cfg.registryPath||'configured'):'Not configured — deploy the registry, then set MORROW_REGISTRY_PATH in .env'],
      ['Treasury',cfg.treasuryConfigured?'Configured':'Not configured — transaction fees stay disabled'],
      ['IPFS pinning',cfg.pinningConfigured?'Configured (server-side)':'Not configured — drafts still save; on-chain artworks need pinning'],
      ['Marketplace fee',(Number(cfg.marketplaceFeeBps||250)/100).toFixed(1)+'% charged to the buyer on sale'],
      ['Launch fee',`${Number(cfg.launchFeeGnot||5).toLocaleString('en-US')} GNOT per on-chain collection deploy`],
      ['Verified paths',`${num((state.market.collections||[]).filter(c=>c.verified).length)} of ${num((state.market.collections||[]).length)} collections verified`],
    ];
    body=`<div class="panel">${rows.map(([k,v])=>`<div class="kv"><span>${k}</span><b>${escapeHTML(v)}</b></div>`).join('')}</div>
    <p class="note" style="margin-top:12px">All values above are read from the live server configuration — nothing here is editable from the browser.</p>`;
  }
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyedot"></span> Settings</div><h1>Settings<span class="heading-period">.</span></h1><p>Profile, wallets and server configuration at a glance.</p></div></div>
  <div class="settings-layout">
   <nav class="side-nav" aria-label="Settings sections">${nav}</nav>
   <div class="settings-body">${body}</div>
  </div>`;
}

function routeLocationKey(){
  if(state.route==='collection'&&state.collectionPath) return `#collection?path=${encodeURIComponent(state.collectionPath)}`;
  if(state.route==='item'&&state.itemId) return `#item?id=${encodeURIComponent(state.itemId)}&pkg=${encodeURIComponent(state.itemPkg||'')}`;
  return `#${['explore','market','collections','activity','portfolio','rewards','create','upcoming','settings'].includes(state.route)?state.route:'explore'}`;
}
function writeRouteLocation(push=false){
  const next=routeLocationKey();
  if(window.location.hash===next)return;
  const method=push?'pushState':'replaceState';
  window.history[method]({morrowRoute:true},'',next);
}
async function restoreRouteLocation(){
  const raw=window.location.hash.replace(/^#/,'')||'explore';
  const [name,query='']=raw.split('?');
  const params=new URLSearchParams(query);
  const allowed=['explore','market','collections','activity','portfolio','rewards','create','upcoming','settings'];
  if(name==='collection'&&params.get('path')){
    const path=params.get('path');
    if((state.market.collections||[]).some(c=>c.path===path)){
      state.collectionPath=path;state.collectionItems=[];state.collectionOffset=0;state.collectionHasMore=false;state.collectionTab='items';state.unrevealedShown=24;state.route='collection';
      render();loadFacets();await loadCollectionItems(true);return;
    }
  }
  if(name==='item'&&params.get('id')){
    await openItemPage(params.get('id'),params.get('pkg')||'',true);return;
  }
  state.route=allowed.includes(name)?name:'explore';
  writeRouteLocation(false);
  render();
}
function render(){
  const main=$('#mainContent'); updateHeader();
  switch(state.route){
   case 'explore':main.innerHTML=renderExplore();break;
   case 'market':main.innerHTML=renderMarket();break;
   case 'collections':main.innerHTML=renderCollections();break;
   case 'collection':main.innerHTML=renderCollectionDetail();break;
   case 'item':main.innerHTML=renderItemDetail();break;
   case 'activity':main.innerHTML=renderActivity();break;
   case 'portfolio':main.innerHTML=renderPortfolio();break;
   case 'rewards':main.innerHTML=renderRewards();break;
   case 'create':main.innerHTML=renderCreate();break;
   case 'upcoming':main.innerHTML=renderUpcoming();break;
   case 'settings':main.innerHTML=renderSettings();break;
   default:main.innerHTML=renderExplore();
  }
  wireDynamicInputs();
  // fill the countdown labels right away instead of showing the placeholder for a second
  tickCountdowns();
  // hero slider auto-advance, only while a slider with slides exists
  clearInterval(sliderTimer);
  const track=$('#heroTrack');
  if(track&&track.children.length>1)sliderTimer=setInterval(()=>heroSlide(1),6000);
}
function routeTo(route,fromHistory=false){state.route=route;if(!fromHistory)writeRouteLocation(true);closeModal();closeMenu();render();window.scrollTo({top:0,behavior:'smooth'})}
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
  const mintType=$('#mintType');if(mintType)mintType.addEventListener('change',()=>{const price=$('#mintPriceGnot');if(price){price.disabled=mintType.value==='free';if(mintType.value==='free')price.value='0';else{price.value=Number(price.getAttribute('data-last')||price.value||0)||5}}});
  const mintPrice=$('#mintPriceGnot');if(mintPrice)mintPrice.addEventListener('input',()=>mintPrice.setAttribute('data-last',mintPrice.value));
  const wlFile=$('#whitelistFile');if(wlFile)wlFile.addEventListener('change',()=>{handleWhitelistFile(wlFile.files?.[0]).catch(err=>toast(err.message||'Could not read the allowlist file.','error',7500))});
  const sortUpcoming=$('#upcomingSortSelect');if(sortUpcoming)sortUpcoming.addEventListener('change',e=>{state.upcomingSort=e.target.value;render()});
  const nameMint=$('#mintName');if(nameMint)nameMint.addEventListener('input',()=>{$('#mintPreviewName').textContent=nameMint.value||'Your NFT'});
  const imgMint=$('#mintImage');if(imgMint)imgMint.addEventListener('change',()=>{const f=imgMint.files?.[0];if(!f)return;$('#mintFileLabel').textContent=f.name;$('#mintPreview').src=URL.createObjectURL(f)});
  const namespace=$('#collectionNamespace');if(namespace) namespace.value=state.wallet?.address||'';
  $$('input[name="pinMode"]').forEach(r=>r.addEventListener('change',()=>applyPinMode()));
  applyPinMode();
  const globalSearch=$('#globalSearch');if(globalSearch){globalSearch.value=state.query;globalSearch.oninput=e=>{state.query=e.target.value;const pos=e.target.selectionStart;if(['explore','market','collections'].includes(state.route)){render();const next=$('#globalSearch');if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch{}}}};}
  const marketSearch=$('#marketSearch');if(marketSearch)marketSearch.addEventListener('input',()=>{const value=marketSearch.value;state.query=value;render();const next=$('#marketSearch');if(next){next.focus();next.setSelectionRange(value.length,value.length)}});
  const marketSort=$('#marketSort');if(marketSort)marketSort.addEventListener('change',()=>{state.marketSort=marketSort.value;render()});
  const gallerySearch=$('#gallerySearch');if(gallerySearch){gallerySearch.oninput=e=>{state.gallery.query=e.target.value;state.gallery.limit=6;const pos=e.target.selectionStart;render();const next=$('#gallerySearch');if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch{}}};}
  const galleryRarity=$('#galleryRarity');if(galleryRarity)galleryRarity.onchange=e=>{state.gallery.rarity=e.target.value;state.gallery.limit=6;render()};
  const gallerySort=$('#gallerySort');if(gallerySort)gallerySort.onchange=e=>{state.gallery.sort=e.target.value;state.gallery.limit=6;render()};
  const galleryTraitType=$('#galleryTraitType');if(galleryTraitType)galleryTraitType.onchange=e=>{state.gallery.traitType=e.target.value;state.gallery.traitValue='all';state.gallery.limit=6;render()};
  const galleryTraitValue=$('#galleryTraitValue');if(galleryTraitValue)galleryTraitValue.onchange=e=>{state.gallery.traitValue=e.target.value;state.gallery.limit=6;render()};
  $$('[data-action="open-genesis-item"]').forEach(card=>card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.click()}}));
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



async function loadFacets(slug){
  const c=(state.market.collections||[]).find(x=>x.path===state.collectionPath);
  const targetSlug=slug||c?.slug||'moonbound';
  if(state.traitsLoaded&&state.loadedTraitSlug===targetSlug)return;
  state.traitsLoaded=true;
  state.loadedTraitSlug=targetSlug;
  try{ state.traits=await api(`/api/traits?collection=${encodeURIComponent(targetSlug)}`); }
  catch{ state.traits={ok:false,groups:[],editions:{},total:0}; }
  if(['collection','item','explore'].includes(state.route))render();
}
function traitOf(edition,type){ return (state.traits?.editions||{})[pad(edition)]?.[type]||''; }
function rarityGroups(){ return state.traits?.groups||[]; }
// Genesis gallery: editions come from the pinned metadata bundle, so the grid renders before any mint.
const genesisTrait=(edition,type)=>traitOf(edition,type);
const genesisPool=()=>Object.keys(state.traits?.editions||{}).map(Number).filter(Number.isInteger).sort((a,b)=>a-b);
const genesisRarityValues=()=>(rarityGroups().find(g=>/^rarity$/i.test(g.trait_type))?.values||[]).map(v=>v.value);
// Edition is unique per token, so it filters nothing and is left out.
const genesisTraitTypes=()=>rarityGroups().filter(g=>!/^edition$/i.test(g.trait_type)).map(g=>g.trait_type);
function genesisStatus(edition){
  const featured=(state.market.collections||[]).find(c=>c.slug==='moonbound');
  return Number(edition)<=Number(featured?.minted||0)?'Minted':'Unminted';
}
function genesisCard(edition){
  const rarity=genesisTrait(edition,'Rarity');
  return artCard({id:edition,name:`GNO PUNK #${pad(edition)}`,collectionName:rarity?`GNO PUNK · ${rarity}`:'GNO PUNK',image:imageUri(edition),preview:true,listed:false});
}
function rarityRank(edition){
  const group=rarityGroups().find(g=>/^rarity$/i.test(g.trait_type));if(!group)return 0;
  const index=group.values.findIndex(v=>v.value===traitOf(edition,'Rarity'));
  return index<0?0:index;
}
// Numbered editions that exist in the pinned metadata but are not minted yet. Traits are public
// in that metadata; the art is not, which is why these render as locked numbered tiles.
function unrevealedEditions(){
  const c=(state.market.collections||[]).find(x=>x.path===state.collectionPath)||{};
  const supply=Number(c.maxSupply||state.config?.moonbound?.maxSupply||1000);
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
  if(!groups.length)return '<div class="panel"><h3>Traits</h3><p class="note">Trait counts ship with the pinned collection metadata, so they are not available for this collection. Nothing is invented to fill the panel.</p></div>';
  const body=groups.map(g=>`<div class="facet"><h4>${escapeHTML(g.trait_type)}<span>${g.values.length}</span></h4>${g.values.map(v=>`<label class="chk"><input type="checkbox" data-facet="${escapeHTML(g.trait_type)}" data-value="${escapeHTML(v.value)}" ${(state.facetFilters[g.trait_type]||new Set()).has(v.value)?'checked':''}>${escapeHTML(v.value)}<em>${num(v.count)}</em></label>`).join('')}</div>`).join('');
  const activeCount=Object.values(state.facetFilters).reduce((n,set)=>n+(set?set.size:0),0);
  return `<div class="panel traits-panel"><h3>Traits · pinned metadata</h3>${body}${activeCount?`<button class="btn btn-ghost btn-sm btn-full" data-action="clear-facets">Clear ${activeCount} filter${activeCount===1?'':'s'}</button>`:''}<p class="note" style="margin-top:10px">Counts cover all ${num(state.traits?.total||0)} pinned editions, minted or not. Selection filters the numbered editions below.</p></div>`;
}
function renderCollectionStatsPanel(c){
  const minted=Number(c.minted||0),supply=Number(c.maxSupply||1000);
  return `<div class="panel"><h3>Drop status</h3><div class="kv"><span>Editions</span><b>${num(supply)}</b></div><div class="kv"><span>Minted</span><b>${num(minted)}</b></div><div class="kv"><span>Unrevealed</span><b>${num(Math.max(0,supply-minted))}</b></div><div class="kv"><span>Reveal</span><b>On mint</b></div><div class="kv"><span>Per wallet</span><b>${c.slug==='moonbound'?walletMintAllowanceCopy():'Set by the realm'}</b></div><div class="bar" style="margin-top:12px"><i style="width:${supply?Math.min(100,(minted/supply)*100).toFixed(1):0}%"></i></div></div>`;
}
function renderRarityView(){
  if(!state.traitsLoaded)return '<div class="panel"><p class="note">Loading pinned rarity…</p></div>';
  const groups=rarityGroups();
  if(!groups.length)return `<div class="empty-state"><h3>Rarity data unavailable</h3><p>Rarity counts ship with the pinned collection metadata. This collection does not expose them, and Gnotbook does not guess.</p></div>`;
  return `<div class="panel"><h3>Rarity distribution · ${num(state.traits?.total||0)} pinned editions</h3>${groups.map(g=>`<div class="facet"><h4>${escapeHTML(g.trait_type)}</h4>${g.values.map(v=>`<div class="kv"><span>${escapeHTML(v.value)}</span><b>${num(v.count)} · ${((v.count/(state.traits?.total||1))*100).toFixed(1)}%</b></div>`).join('')}</div>`).join('')}<p class="note">Read from the pinned metadata that was published before the drop. Minting does not change a trait.</p></div>`;
}
function renderCollectionAboutView(c){
  return `<div class="panel"><h3>About this collection</h3><p class="note">${escapeHTML(c.description||'No description was published with the registration.')}</p><div style="margin-top:12px"><div class="kv"><span>Realm</span><b class="mono">${escapeHTML(c.path)}</b></div><div class="kv"><span>Creator</span><b class="mono">${escapeHTML(c.creator||'unknown')}</b></div><div class="kv"><span>Registration</span><b>${c.verified?'Verified through Gnotbook review':'Unverified — Gnotbook blocks purchases until a human review checks official links'}</b></div><div class="kv"><span>Marketplace fee</span><b>2.5% · settled inside the realm</b></div><div class="kv"><span>Royalty</span><b>${(Number(c.royaltyBps||0)/100).toFixed(1)}% · paid to the creator</b></div><div class="kv"><span>Metadata</span><b class="mono">${escapeHTML(c.metadataBaseURI||state.config?.moonbound?.metadataBaseUri||'not published')}</b></div></div><p class="note" style="margin-top:12px">Registry registration and IPFS persistence do not make a collection authentic. New collections are unverified by default.</p></div>`;
}
function renderCollectionItemsView(c){
  const inventory=(state.collectionItems||[]).filter(x=>!x.preview);
  const supply=Number(c.maxSupply||state.config?.moonbound?.maxSupply||1000);
  const unrevealed=unrevealedEditions();
  const shown=unrevealed.slice(0,state.unrevealedShown);
  const revealedGrid=inventory.length?`<div class="section-head" style="margin-top:0"><div><div class="eyebrow"><span class="eyedot"></span> Revealed</div><h2>${num(inventory.length)} minted editions</h2><p>Owner, price and listing state read straight from the collection realm.</p></div></div><div class="grid">${inventory.slice(0,12).map(x=>artCard({...x,preview:false})).join('')}</div>${state.collectionHasMore?`<div style="text-align:center;margin-top:18px"><button class="btn btn-ghost" data-action="load-more">Load 24 more minted</button></div>`:''}`:'';
  const filtered=Object.values(state.facetFilters).some(set=>set&&set.size);
  return `${revealedGrid}<div class="layout" style="margin-top:${inventory.length?'32px':'0'}">
   <aside class="rail">${renderFacetPanel()}${renderCollectionStatsPanel(c)}</aside>
   <div>
    <div class="section-head" style="margin-top:0"><div><div class="eyebrow"><span class="eyedot"></span> Unrevealed</div><h2>${num(unrevealed.length)} editions${filtered?' match':''}</h2><p>Traits are public in the pinned metadata; art appears the moment an edition is minted. Select traits to narrow the drop.</p></div><select class="select-control" id="collectionSortSelect" aria-label="Sort editions"><option value="ed" ${state.collectionSort==='ed'?'selected':''}>Edition: first to last</option><option value="rar" ${state.collectionSort==='rar'?'selected':''}>Rarity: rarest first</option></select></div>
    <div class="grid">${shown.length?shown.map(x=>lockedTile(x.edition,{traits:x.traits,supply,slug:c.slug,collection:c})).join(''):`<div class="empty-state" style="grid-column:1/-1"><div class="empty-art">⌕</div><h3>No edition matches those filters</h3><p>Nothing in the pinned metadata carries that combination. Clear a filter to widen the search.</p>${filtered?`<button class="btn btn-outline" data-action="clear-facets">Clear filters</button>`:''}</div>`}</div>
    ${unrevealed.length>shown.length?`<div style="text-align:center;margin-top:22px"><button class="btn btn-ghost" data-action="show-more-unrevealed">Show ${num(Math.min(24,unrevealed.length-shown.length))} more editions</button></div>`:''}
   </div></div>`;
}
function renderActivityView(){
  return `<div class="empty-state"><div class="empty-art">⌁</div><h3>Gnotbook does not index chain events yet</h3><p>Mint and sale events live in Gno.land blocks. Rather than invent a feed, this tab stays empty until an indexer exists — every edition can be checked on Gnoscan from its item page.</p><button class="btn btn-outline" data-route="activity">Open the activity page</button></div>`;
}
function renderCollectionDetail(){
  const c=(state.market.collections||[]).find(x=>x.path===state.collectionPath);if(!c)return `<div class="empty-state"><h3>Collection unavailable</h3><button class="btn btn-outline" data-route="collections">Back to collections</button></div>`;
  const isVESPER=c.slug==='moonbound';
  const inventory=state.collectionItems||[];
  const moon=state.config?.moonbound||{};
  const mintPriceUgnot=Number(c.mintPriceUgnot||moon.mintPriceUgnot||0);
  const perWalletCopy=isVESPER?walletMintAllowanceCopy():'Set by the realm';
  const soldOut=Number(c.minted||0)>=Number(c.maxSupply||1000),capped=walletMintCapReached();
  const mintLive=!!(isVESPER?moon.mintEnabled:c.mintEnabled)&&!soldOut,mintEnabled=mintLive&&!capped;
  const collBanner = c.cover || c.image || (c.slug==='moonbound' ? '/assets/art/moonbound-keepers.webp' : imageSrc(c.image));
  const collAvatar = c.image || c.cover || (c.slug==='moonbound' ? '/collection-assets/images/0001.webp' : imageSrc(c.image));
  const mintPct=c.maxSupply?Math.min(100,(Number(c.minted||0)/c.maxSupply)*100):0;
  const startDate=c.mintStartAt ? new Date(c.mintStartAt) : null;
  return `<div class="drop-head">
   <div class="cover" style="background-image:url('${escapeHTML(imageSrc(collBanner))}');background-size:cover;background-position:center"></div>
   <div class="drop-id"><div class="drop-avatar">${collAvatar?`<img src="${escapeHTML(imageSrc(collAvatar))}" alt="${escapeHTML(c.name)} avatar" onerror="this.parentNode.style.visibility='hidden'">`:''}</div><div style="padding-bottom:6px"><div style="display:flex;align-items:center;gap:10px"><h1 style="font-size:28px">${escapeHTML(c.name)}</h1>${c.verified?'<span class="chip good">Verified</span>':''}<span class="chip ${mintLive?'live':''}">${mintLive?'Mint live':soldOut?'Sold out':'Not live'}</span></div><div class="note" style="margin-top:5px">By ${escapeHTML(c.creator==='Gnotbook Studio'?c.creator:shortAddr(c.creator))} · realm ${escapeHTML(c.path)}</div></div></div>
  </div>
  <div class="drop-main">
   <aside class="mint-box">
    <div class="top"><span class="chip ${mintLive?'live':''}">${mintLive?'Mint live':soldOut?'Sold out':'Not live'}</span><span style="margin-left:auto">${Number(c.minted||0)} / ${Number(c.maxSupply||1000)} minted</span></div>
    <div class="mint-progress" role="img" aria-label="${Number(c.minted||0)} of ${Number(c.maxSupply||1000)} minted"><i style="width:${mintPct}%"></i></div>
    <div class="mint-price"><div class="l">Mint price</div><div class="v">${displayGnot(mintPriceUgnot)}</div></div>
    <div class="qty"><span class="note">Per wallet</span><span class="note">${perWalletCopy}${isVESPER?' · 1 per transaction':''}</span></div>
    <div class="total"><span>Total</span><b>${displayGnot(mintPriceUgnot)}</b></div>
    <button class="btn btn-accent btn-full" id="mintBtn" data-action="mint-item" data-slug="${c.slug}" ${!mintEnabled?'disabled':''}>${!mintEnabled?(soldOut?'Sold out':capped?'Wallet limit reached':'Mint not enabled'):'Mint now ↗'}</button>
    <div style="margin-top:11px">
     <div class="fee-line"><span>Marketplace fee on resale</span><span>2.5%</span></div>
     <div class="fee-line"><span>Creator royalty</span><span>${(Number(c.royaltyBps||0)/100).toFixed(1)}%</span></div>
     <div class="fee-line"><span>Network gas + storage</span><span>estimated by Adena</span></div>
    </div>
    ${!mintEnabled?`<div class="reason-note">${capped?`This wallet has used all ${walletMintLimit()} public mints. The contract caps mints per wallet.`:'Minting is not available for this collection yet. The collection realm, IPFS directories and transaction settings must be configured first.'}</div>`:''}
    <div class="mint-schedule">
     <span class="tiny-label">Schedule</span>
     <div class="evt"><span class="dot" style="background:var(--accent)"></span><div><b>Allowlist ${Number(c.allowlistCount||0)}</b><small>${Number(c.allowlistCount||0)?'Wallets on the allowlist submitted by the creator. Eligibility is enforced by the collection realm.':'No allowlist submitted yet.'}</small></div></div>
     <div class="evt"><span class="dot" style="background:${mintLive?'var(--live)':'var(--pending)'}"></span><div><b>${mintLive?'Mint is live':c.mintStartAt?'Opens '+startDate.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Start time not set'}</b><small>${c.mintType==='free'?'Free mint — you pay only gas.':'Mint paid in GNOT.'}</small></div></div>
     <div class="evt"><span class="dot" style="background:var(--muted-2)"></span><div><b>Mint type: ${c.mintType==='free'?'Free':'Whitelist + public'}</b><small>${c.mintWebsite?'Details: '+escapeHTML(c.mintWebsite):'Managed by the collection realm.'}</small></div></div>
    </div>
   </aside>
   <div class="drop-left">
   <div class="stats">
   <div class="stat"><span>Items</span><b>${Number(c.maxSupply||1000).toLocaleString('en-US')}</b></div>
   <div class="stat"><span>Minted</span><b>${Number(c.minted||0).toLocaleString('en-US')}</b></div>
   <div class="stat"><span>Owners</span><b>—</b></div>
   <div class="stat"><span>Mint price</span><b>${displayGnot(mintPriceUgnot)}</b></div>
   <div class="stat"><span>Per wallet</span><b>${perWalletCopy}</b></div>
   <div class="stat"><span>Reveal</span><b>On mint</b></div>
  </div>
  <div class="tabs">${[['items','Items'],['rarity','Rarity'],['activity','Activity'],['about','About']].map(([key,label])=>`<button class="${state.collectionTab===key?'on':''}" data-action="collection-tab" data-value="${key}">${label}</button>`).join('')}</div>
  ${state.collectionTab==='rarity'?renderRarityView():state.collectionTab==='activity'?renderActivityView():state.collectionTab==='about'?renderCollectionAboutView(c):renderCollectionItemsView(c)}
   </div>
  </div>
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
  if(state.market.ok===false)toast(state.market.warning||'The Gnotbook registry is not reachable. The market stays empty instead of showing sample listings.','error',7000);
  else toast('Registry and listings refreshed.');
}

function openWalletModal(){
  const balances=state.balances||[];
  modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Your wallet</div><h2 class="detail-title">Your keys. Your call.</h2><p class="detail-info">Connected through Adena. Gnotbook keeps only this public address in the browser session and never receives your seed phrase or private key.</p><div class="detail-price"><label>Connected account</label><div class="mono" style="word-break:break-all">${escapeHTML(state.wallet.address)}</div><div class="fee-line"><span>GNOT balance</span><strong>${displayGnot((balances.find(x=>x.denom==='ugnot')||{}).amount||0)}</strong></div></div><div class="detail-actions"><button class="btn btn-dark" data-route="portfolio">Open portfolio</button><button class="btn btn-outline" data-action="refresh-wallet">Refresh</button><button class="btn btn-outline" data-action="disconnect">Disconnect page</button></div><p class="modal-note">Disconnecting removes the address from this page. It does not lock or change Adena itself.</p></div>`);
}

function currentItem(){
  const id=String(state.itemId||''); const pkg=state.itemPkg||'';
  const pool=[...(state.market.listings||[]),...(state.collectionItems||[]),...((state.portfolio&&state.portfolio.tokens)||[])];
  return pool.find(x=>sameId(x.id,id)&&x.collectionPath===pkg)
    || {id:String(Number(id)||0),collectionPath:pkg,name:(state.itemMeta&&state.itemMeta.name)||`Edition ${pad(Number(id)||0)}`,priceUgnot:0,listed:false,owner:''};
}

async function openItemPage(id,pkg,fromHistory=false){
  const path=pkg||state.collectionPath||state.config?.moonbound?.collectionPath||'';
  const c=(state.market.collections||[]).find(x=>x.path===path || (path && x.slug===slugOf(path)));
  const slug=c?.slug||slugOf(path)||'moonbound';
  const padded=pad(Number(id)||0);
  const isGenesis=slug==='moonbound';

  const pool=[...(state.collectionItems||[]),...(state.market.listings||[]),...((state.portfolio&&state.portfolio.tokens)||[])];
  const known=pool.find(x=>sameId(x.id,id)&&(!path||x.collectionPath===path));

  let meta=known?{name:known.name,image:known.image,attributes:null,description:known.description||''}:null;

  if(!meta){
    const metaUrl = isGenesis ? metaUri(padded) : `/collections/${slug}/metadata/${padded}.json`;
    try{
      const r=await fetch(metaUrl);
      if(r.ok){
        const doc=await r.json();
        const img = isGenesis ? imageUri(padded) : `/collections/${slug}/images/${padded}.webp`;
        meta={
          name: doc.name || `${c?.name || slug.toUpperCase()} #${padded}`,
          image: img,
          attributes: doc.attributes || [],
          description: doc.description || ''
        };
      }
    }catch{
      meta=null;
    }
  }

  if(!meta){
    meta={
      name: `${c?.name || (isGenesis ? 'GNO PUNK' : slug.toUpperCase())} #${padded}`,
      image: isGenesis ? imageUri(padded) : `/collections/${slug}/images/${padded}.webp`,
      attributes: [],
      description: c?.description || ''
    };
  }

  state.route='item';
  state.itemId=padded;
  state.itemPkg=c?.path||path;
  state.itemMeta=meta;
  if(!fromHistory)writeRouteLocation(true);
  loadFacets(slug);
  closeModal();
  render();
  window.scrollTo({top:0,behavior:'smooth'});
}

async function openVESPERDrop(){
  const path=state.config?.moonbound?.collectionPath||'';
  if(path&&(state.market.collections||[]).some(c=>c.path===path)){await openCollection(path);return}
  routeTo('create');
  toast('GNO PUNK is not registered yet. The creator studio lists the exact launch requirements.');
}

async function buyItem(nft){
  if(!nft||!nft.listed||!nft.collectionPath)throw new Error('That item is not an active on-chain listing.');
  if(!state.wallet)throw new Error('Connect Adena before buying an NFT.');
  if(!state.config?.transactionsEnabled)throw new Error('Buying is paused until the Gnotbook registry, treasury and explicit network-write setting are configured.');
  const {price,fee,total}=saleTotal(nft.priceUgnot);
  modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Secure checkout · Adena</div><h2 class="detail-title">One last look.</h2><p class="detail-info">You are about to buy <strong>${escapeHTML(nft.name||'this edition')}</strong>. Gnotbook submits one contract call; the collection realm transfers the NFT and settles seller, royalty and its 2.5% fee in the same transaction.</p><div class="detail-price"><label>Total sent from your wallet (excluding network gas)</label><strong>${displayGnot(total)}</strong><div class="fee-breakdown"><div class="fee-line"><span>Seller asking price</span><strong>${displayGnot(price)}</strong></div><div class="fee-line"><span>Gnotbook sale fee · 2.5%</span><strong>${displayGnot(fee)}</strong></div><div class="fee-line"><span>Creator royalty</span><strong>${(Number(nft.royaltyBps||0)/100).toFixed(1)}% of the ask, paid by the seller side</strong></div></div></div><div class="detail-actions"><button class="btn btn-dark" data-action="confirm-buy" data-id="${escapeHTML(String(nft.id))}" data-path="${escapeHTML(nft.collectionPath)}">Buy with Adena ↗</button><button class="btn btn-outline" data-action="close-modal">Not now</button></div><p class="modal-note">Confirm the exact amount and realm in Adena before approving. Gnotbook never takes custody.</p></div>`);
}

async function executeBuy(id,pkg){
  const nft=(state.market.listings||[]).find(x=>x.collectionPath===pkg&&sameId(x.id,id));
  if(!nft)throw new Error('That listing is no longer open. Refresh the market.');
  const {total}=saleTotal(nft.priceUgnot);
  setBusy(true);
  try{
    const result=await sendTx([transactionMessage(pkg,'Buy',[String(nft.id)],`${total}ugnot`)],`Gnotbook purchase: ${nft.name}`);
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
  modal(`<div class="modal-body"><div class="eyebrow"><span class="eyedot"></span> Fixed-price listing</div><h2 class="detail-title">Put it on the floor.</h2><p class="detail-info">Your NFT moves into the collection contract's escrow. You can cancel later to return it to your wallet as long as it has not sold.</p><div class="field"><label for="listingPrice">Asking price (GNOT)</label><input id="listingPrice" type="number" min="0.000001" step="0.000001" value="10" required><span class="helper">The contract requires a positive fixed price. Gnotbook charges no listing fee.</span></div><div class="detail-price"><div class="fee-line"><span>Gnotbook listing fee</span><strong>0%</strong></div><div class="fee-line"><span>Buyer pays on sale</span><strong>2.5% Gnotbook fee, on top of your ask</strong></div><div class="fee-line"><span>Creator royalty</span><strong>Deducted from your proceeds by the contract</strong></div></div><label class="checkbox-row"><input id="listingConfirm" type="checkbox" required><span>I understand the NFT is escrowed by this collection contract until it sells or I cancel.</span></label><div class="detail-actions"><button class="btn btn-dark" data-action="submit-listing">Approve listing in Adena ↗</button><button class="btn btn-outline" data-action="close-modal">Not now</button></div></div>`);
}

async function submitListing(){
  if(!state.nft)throw new Error('Choose an NFT to list.');
  if(!$('#listingConfirm')?.checked)throw new Error('Confirm the escrow notice before listing.');
  const price=toUgnot($('#listingPrice')?.value||0);
  if(price<=0)throw new Error('Listing price must be greater than zero.');
  const nft=state.nft;
  setBusy(true);
  try{
    const result=await sendTx([transactionMessage(nft.collectionPath,'List',[String(nft.id),String(price)])],`Gnotbook listing: ${nft.name}`);
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
    await sendTx([transactionMessage(nft.collectionPath,'Cancel',[String(nft.id)])],`Gnotbook cancel listing: ${nft.name}`);
    toast('Cancel submitted. The collection realm returns the NFT after confirmation.');
    await refreshMarket(); await refreshWalletData(); render();
  } finally { setBusy(false) }
}

async function mintPublicEdition(slug){
  const moon=state.config?.moonbound||{};
  const currentPath=state.collectionPath||'';
  const targetSlug=slug||(currentPath?(state.market.collections||[]).find(c=>c.path===currentPath)?.slug:null)||'moonbound';
  const coll=(state.market.collections||[]).find(c=>c.slug===targetSlug||c.path===slug)||(targetSlug==='moonbound'?{name:moon.name||'GNO PUNK',path:moon.collectionPath||'gno.land/r/morrow/moonbound',mintPriceUgnot:moon.mintPriceUgnot||5000000,mintEnabled:moon.mintEnabled}:null);
  if(!coll)throw new Error('Collection not found.');
  const pkg=coll.path;
  const isVESPER=coll.slug==='moonbound';
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!coll.mintEnabled||!pkg)throw new Error('Public minting is not enabled by this server yet.');
  if(walletMintCapReached())throw new Error(`This wallet already minted ${walletMintLimit()}. The contract caps public mints per wallet.`);
  const mintPriceUgnot=Number(coll.mintPriceUgnot||moon.mintPriceUgnot||5_000_000);
  setBusy(true);
  try{
    const result=await sendTx([transactionMessage(pkg,'PublicMint',[],`${mintPriceUgnot}ugnot`)],`${coll.name} public mint`);
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
  const selfMode=pinMode()==='self';
  const {imageCid,metadataCid,imageBaseCid}=cidValues();
  if(!selfMode&&!state.config?.pinningConfigured)throw new Error('This server has no IPFS pinning credential. Pin the files in your own account and choose “I pinned it myself”.');
  if(selfMode&&(!imageCid||!metadataCid))throw new Error('Paste the artwork CID and the metadata CID you pinned.');
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
  if(!coverFile&&!selfMode)throw new Error('Choose a cover image.');
  if(!$('#confirmRights')?.checked)throw new Error('Confirm that you own or have permission to publish this artwork.');
  const protectedNames=['guardians','gno foundation','gno land','adena','gnoscan','morrow marketplace','opensea','rarible'];
  const normalizedName=name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  if(protectedNames.some(term=>normalizedName===term||normalizedName.startsWith(term+' ')))throw new Error('This name is reserved in Gnotbook to reduce brand impersonation. Use the official project link instead.');
  const levenshtein=(a,b)=>{const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return row[b.length]};
  const collision=(state.market.collections||[]).find(c=>{const existing=String(c.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(existing===normalizedName)return true;const maxLen=Math.max(existing.length,normalizedName.length);return maxLen>=8&&1-levenshtein(existing,normalizedName)/maxLen>=0.88});
  if(collision)throw new Error(`This name is identical or too close to the registered collection ${collision.name} (${collision.path}). Choose a clearly distinct identity.`);
  if((state.market.collections||[]).some(c=>c.slug===slug))throw new Error('That realm slug is already registered. Choose another one.');
  const pkgPath=`gno.land/r/${namespace}/${slug}`;
  const button=$('#launchCollectionButton');
  setBusy(true); if(button)button.textContent=selfMode?'Verifying your CIDs…':'Pinning cover and metadata to IPFS…';
  try{
    let cover,manifest;
    if(selfMode){
      // The creator's own pin is the source of truth; the server only checks that it resolves.
      const [img,meta]=await Promise.all([verifyCid(imageCid,'image'),verifyCid(metadataCid,'metadata')]);
      cover={uri:`ipfs://${imageCid}`,gatewayUrl:img.url};
      manifest={uri:`ipfs://${metadataCid}`,name:meta.name||''};
    }else{
      cover=await uploadImage(coverFile,`${slug}-cover`);
      manifest=await pinMetadata(name,description,cover.uri,{attributes:[{trait_type:'Network',value:state.config.chainId}]});
    }
    const source=await contractSource('/api/contracts/collection-template','collection contract',{'__PACKAGE__':slug,'__REGISTRY_PATH__':String(state.config.registryPath||'')});
    const {due,dueSend}=computeLaunchDue();
    const messages=[
      {type:'/vm.m_addpkg',value:{creator:state.wallet.address,deposit:'1ugnot',package:{name:slug,path:pkgPath,files:[{name:`${slug}.gno`,body:source}]}}},
      transactionMessage(pkgPath,'Init',[name,symbol,cover.gatewayUrl,manifest.uri,String(maxSupply),'0',String(royaltyBps),imageBaseCid?`ipfs://${imageBaseCid}`:'',metadataCid?`ipfs://${metadataCid}`:'','0'],dueSend)
    ];
    if(button)button.textContent='Waiting for Adena approval…';
    const result=await sendTx(messages,`Gnotbook collection launch — package, IPFS metadata and ${due?`the fixed ${due.toLocaleString('en-US')} GNOT launch fee`:'no launch fee: the registry admin wallet launches free'}`);
    state.localCollections.unshift({name,symbol,slug,path:pkgPath,image:cover.gatewayUrl,metadataURI:manifest.uri,txHash:result.hash});
    state.localCollections=state.localCollections.slice(0,40);
    localStorage.setItem('morrow_created_collections',JSON.stringify(state.localCollections));
    try{
      await api('/api/collections/create',{
        method:'POST',
        body:JSON.stringify({name,symbol,slug,path:pkgPath,image:cover.gatewayUrl,maxSupply,mintPriceUgnot:5_000_000,royaltyBps,creator:state.wallet.address,description,txHash:result.hash})
      });
    }catch{}
    if(result.hash)state.txHistory.unshift({hash:result.hash,type:'Collection launch',time:Date.now()});
    toast('Launch submitted to Adena. The collection appears in the registry after the transaction confirms.','ok',9000);
    if(result.hash)verifyPoints(result.hash);
    await refreshMarket(); state.activeCreateTab='mint'; render();
  } finally { setBusy(false) }
}

// ---- Draft save + whitelist preview ---------------------------------------
// Quick client-side preview only; the server re-parses the text authoritatively on save.
function parseWhitelistPreview(raw){
  const text=String(raw||''), lax=/g1[a-z0-9]{20,80}/i;
  const lines=text.split(/\r?\n/).map(l=>String(l.split(',')[0]||'').trim()).filter(Boolean);
  const valid=[],seen=new Set(),invalid=[];
  lines.forEach((line,idx)=>{
    if(seen.has(line.toLowerCase()))return;
    if(!/^g1[a-z0-9]{20,80}$/i.test(line)){invalid.push({line:idx+1,value:line.slice(0,48),reason:'Not a valid g1 wallet address.'});return}
    seen.add(line.toLowerCase());valid.push(line.toLowerCase());
  });
  return {valid,invalid,name:('whitelist')};
}
async function handleWhitelistFile(file){
  if(!file)return;
  if(file.size>128*1024){state.draftWhitelist={valid:[],invalid:[],name:file.name,error:'The allowlist file is too large (128 kB limit).'};render();return}
  const raw=await file.text();
  const preview=parseWhitelistPreview(raw);
  state.draftWhitelist={...preview,raw,name:file.name,error:raw.trim()?'':('The allowlist file is empty.')};
  if(raw.trim().startsWith('[')||raw.trim().startsWith('{')){ // JSON: let the server decide, preview raw count
    try{const j=JSON.parse(raw.trim());const rows=Array.isArray(j)?j:Array.isArray(j.addresses)?j.addresses:[j];
      state.draftWhitelist.valid=[];state.draftWhitelist.invalid=[];
      rows.forEach(r=>{const v=typeof r==='string'?r.trim():(r?.address||r?.wallet||r?.value||'');if(!v)return;
        state.draftWhitelist[/^g1[a-z0-9]{20,80}$/i.test(v)?'valid':'invalid'].length>=10000&&state.draftWhitelist.valid.shift();
        state.draftWhitelist[/^g1[a-z0-9]{20,80}$/i.test(v)?'valid':'invalid'].push(v.toLowerCase())});
      state.draftWhitelist.valid=[...new Set(state.draftWhitelist.valid)];
    }catch(e){state.draftWhitelist={valid:[],invalid:[],name:file.name,error:`The file is not valid JSON: ${e.message}`}}
  }
  render();
}
async function saveDraftCollection(){
  const form=$('#collectionForm');
  const name=($('#collectionName')?.value||'').trim();
  const symbol=($('#collectionSymbol')?.value||'').trim().toUpperCase();
  const slug=($('#collectionSlug')?.value||'').trim();
  const description=($('#collectionDescription')?.value||'').trim();
  const website=($('#collectionWebsite')?.value||'').trim();
  const mintType=($('#mintType')?.value||'free')==='free'?'free':'paid';
  const mintPriceGnot=Number($('#mintPriceGnot')?.value||0);
  const mintPriceUgnot=Math.round(mintPriceGnot*1_000_000);
  const maxSupply=Number($('#maxSupply')?.value);
  const royaltyBps=Math.round(Number($('#royalty')?.value||0)*100);
  if(!name||name.length>64)throw new Error('Collection name must be between 1 and 64 characters.');
  if(!/^[A-Z0-9]{1,11}$/.test(symbol))throw new Error('Symbol must contain 1–11 letters or numbers.');
  if(!slugSafe(slug))throw new Error('Slug must be lowercase, start with a letter and contain 2–11 letters/numbers.');
  if(!Number.isInteger(maxSupply)||maxSupply<1||maxSupply>1_000_000)throw new Error('Supply must be from 1 to 1,000,000.');
  if(royaltyBps<0||royaltyBps>1000)throw new Error('Royalty must be between 0% and 10%.');
  if(mintType==='free'&&mintPriceUgnot!==0)throw new Error('A free mint needs a mint price of 0.');
  if(mintType==='paid'&&!(mintPriceUgnot>0))throw new Error('A paid mint needs a positive price.');
  if(website&&!/^https?:\/\/\S+$/i.test(website))throw new Error('Website link must start with http:// or https://.');
  // Schedule: local date/time + selected UTC offset → strict ISO instant.
  const d=$('#mintStartDate')?.value,t=$('#mintStartTime')?.value,tz=$('#mintTimezone')?.value||'+00:00';
  let mintStartAt='';
  if(d&&t){
    const probe=new Date(`${d}T${t}${tz}`);
    if(Number.isNaN(probe.getTime()))throw new Error('Mint start date/time could not be parsed.');
    if(probe.getTime()<Date.now()-60_000)throw new Error('Mint start must not be in the past.');
    mintStartAt=probe.toISOString();
  }
  const wl=state.draftWhitelist;
  if(wl&&!$('#confirmWhitelist')?.checked)throw new Error('Confirm that the allowlist was provided by the project team.');
  if(wl&&!wl.valid.length&&!wl.error)throw new Error('The allowlist file contains no valid addresses.');
  if(!$('#confirmRights')?.checked)throw new Error('Confirm that you own or have permission to publish this artwork.');
  setBusy(true);
  try{
    const {collection,whitelist}=await api('/api/collections/create',{method:'POST',body:JSON.stringify({name,symbol,slug,description,mintType,mintPriceUgnot,maxSupply,royaltyBps,website,mintStartAt,creator:state.wallet?.address||'',whitelistText:wl?wl.raw:undefined,imageCid:cidValues().imageCid,metadataCid:cidValues().metadataCid,imageBaseCid:cidValues().imageBaseCid})});
    state.lastDraft={name,slug,whitelistCount:whitelist?.count||0,at:Date.now()};
    toast(`Collection “${collection.name||name}” saved on the server${whitelist?.count?` — allowlist ready (${whitelist.count} wallets)`:''}. It shows in the catalog and Upcoming mints now.`,'ok',9000);
    // Keep the URL in sync with the route, otherwise a refresh lands on the form again.
    await refreshMarket();
    routeTo('upcoming');
    $('#upcomingFilter')?.focus();
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
  const selfMode=pinMode()==='self';
  const mintImageCid=($('#mintImageCid')?.value||'').trim().replace(/^ipfs:\/\//i,'');
  const mintMetaCid=($('#mintMetadataCid')?.value||'').trim().replace(/^ipfs:\/\//i,'');
  if(!pkg||!name)throw new Error('Choose a collection and a name.');
  if(selfMode&&(!mintImageCid||!mintMetaCid))throw new Error('Paste the artwork CID and the metadata CID you pinned.');
  if(!selfMode&&!file)throw new Error('Choose an image to upload.');
  if(!$('#mintRights')?.checked)throw new Error('Confirm that you have the rights to publish this artwork.');
  setBusy(true);
  try{
    let imageUrl,metadataUri;
    if(selfMode){
      const [img,meta]=await Promise.all([verifyCid(mintImageCid,'image'),verifyCid(mintMetaCid,'metadata')]);
      imageUrl=img.url;
      metadataUri=`ipfs://${mintMetaCid}`;
    }else{
      const image=await uploadImage(file,`${name.replace(/[^a-zA-Z0-9-_]/g,'-')}-artwork`);
      const metadata=await pinMetadata(name,desc,image.uri);
      imageUrl=image.gatewayUrl;
      metadataUri=metadata.uri;
    }
    const result=await sendTx([transactionMessage(pkg,'Mint',[name,imageUrl,metadataUri])],`Gnotbook mint: ${name}`);
    toast('Mint submitted to Adena. The item appears after the transaction confirms.');
    if(result.hash)verifyPoints(result.hash);
    await refreshMarket(); await refreshWalletData(); render();
  } finally { setBusy(false) }
}

async function launchVESPER(){
  const moon=state.config?.moonbound||{};
  if(!state.wallet)throw new Error('Connect Adena first.');
  if(!moon.launchEnabled)throw new Error('The launch is not enabled yet. The server needs the live registry, treasury, IPFS pinning and both pinned IPFS directory URIs.');
  const slug='moonbound';
  const pkgPath=`gno.land/r/${state.wallet.address}/${slug}`;
  const imageBase=String(moon.imageBaseUri||'');
  const metadataBase=String(moon.metadataBaseUri||'');
  // The founder reserve is minted by Init to this public address at launch. No reserve is attempted
  // without a configured address, because the contract refuses a reserve with no valid founder.
  const founder=String(moon.founderAddress||'');
  // The pinned metadata marks editions #0001–#0333 as the Founder Reserve, so a launch with no
  // founder would leave that reserve unminted and make the metadata wrong on-chain.
  if(Number(moon.founderReserve||0)>0&&!founder)throw new Error('No founder address is configured for the reserved editions #0001–#0333. Set MORROW_FOUNDER_ADDRESS or deploy the registry so the operator wallet becomes the founder.');
  const founderReserve=founder?Number(moon.founderReserve||0):0;
  setBusy(true);
  try{
    const cover=`${imageBase}/0001.webp`;
    const manifest=await pinMetadata(moon.name,'GNO PUNK — 1,000 fixed editions on Gno.land.',cover,{attributes:[{trait_type:'Network',value:state.config.chainId},{trait_type:'Editions',value:String(moon.maxSupply)}]});
    const source=await contractSource('/api/contracts/collection-template','collection contract',{'__PACKAGE__':slug,'__REGISTRY_PATH__':String(state.config.registryPath||'')});
    const {due,dueSend}=computeLaunchDue();
    const messages=[
      {type:'/vm.m_addpkg',value:{creator:state.wallet.address,deposit:'1ugnot',package:{name:slug,path:pkgPath,files:[{name:`${slug}.gno`,body:source}]}}}
    ];
    messages.push(transactionMessage(pkgPath,'Init',[moon.name,moon.symbol,cover,manifest.uri,String(moon.maxSupply),String(Number(moon.mintPriceUgnot)),'250',imageBase,metadataBase,founder,String(founderReserve)],dueSend));
    const result=await sendTx(messages,`GNO PUNK launch — package, IPFS bases and ${due?`the fixed ${due.toLocaleString('en-US')} GNOT launch fee`:'no launch fee: the registry admin wallet launches free'}`);
    toast(`Collection launch submitted. After confirmation set MOONBOUND_COLLECTION_PATH=${pkgPath} in .env and restart the server.`,'ok',12000);
    if(result.hash)state.txHistory.unshift({hash:result.hash,type:'Collection launch',time:Date.now()});
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
    const source=await contractSource('/api/contracts/registry-template','Gnotbook registry',{});
    const messages=[
      {type:'/vm.m_addpkg',value:{creator:state.wallet.address,deposit:'1ugnot',package:{name:slug,path:pkgPath,files:[{name:`${slug}.gno`,body:source}]}}},
      transactionMessage(pkgPath,'Init',[treasury])
    ];
    const result=await sendTx(messages,'Gnotbook registry deployment — wallet-signed',true);
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
  toast(result.awarded?`+${result.awarded} Gnotbook points · ${result.label||'verified action'}`:'That transaction was already claimed.');
}

window.addEventListener('popstate',()=>{restoreRouteLocation().catch(()=>{state.route='explore';render()})});

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
        case 'gallery-status':{state.gallery.status=action.dataset.value||'all';state.gallery.limit=6;render();return}
    case 'trending-mode':{state.trending=action.dataset.value||'all';render();return}
        case 'gallery-show-more':{state.gallery.limit=Number(state.gallery.limit||6)+6;render();return}
        case 'scroll-genesis':{if(state.route!=='explore'){state.route='explore';render();}const node=$('#genesis');if(node)node.scrollIntoView({behavior:'smooth',block:'start'});return}
        case 'open-genesis-item':{await openItemPage(action.dataset.id,state.config?.moonbound?.collectionPath||'');return}
        case 'favorite':{
          const key=favKey(action.dataset.id);
          if(state.favorites.has(key))state.favorites.delete(key);else state.favorites.add(key);
          localStorage.setItem('morrow_favorites',JSON.stringify([...state.favorites]));render();return;
        }
        case 'create-tab':{state.activeCreateTab=action.dataset.value||'collection';render();return}
        case 'save-draft':{await saveDraftCollection();return}
        case 'launch-collection':{const form=$('#collectionForm');if(form)await launchCollection(form);return}
        case 'remove-wl':{state.draftWhitelist=null;render();return}
        case 'close-menu':{closeMenu();return}
        case 'hero-prev':{heroSlide(-1);return}
        case 'hero-next':{heroSlide(1);return}
        case 'hero-goto':{const t=$('#heroTrack');if(!t)return;sliderIdx=Number(action.dataset.value)||0;t.style.transform=`translateX(-${sliderIdx*100}%)`;$$('.hero-dot').forEach((d,i)=>d.classList.toggle('on',i===sliderIdx));return}
        case 'settings-tab':{state.activeSettingsTab=action.dataset.value||'profile';render();return}
        case 'verify-cids':{await verifyCids();return}
        case 'upcoming-filter':{state.upcomingFilter=action.dataset.value||'all';render();return}
        case 'upcoming-sort':{state.upcomingSort=action.dataset.value||'time-asc';render();return}
        case 'portfolio-tab':{state.activePortfolioTab=action.dataset.value||'nfts';render();return}
        case 'open-collection':{await openCollection(action.dataset.path);return}
        case 'open-moonbound-drop':{await openVESPERDrop();return}
        case 'load-more':{await loadCollectionItems(false);return}
        case 'show-more-unrevealed':{state.unrevealedShown+=24;render();return}
        case 'collection-tab':{state.collectionTab=action.dataset.value||'items';render();return}
        case 'clear-facets':{state.facetFilters={};state.unrevealedShown=24;render();return}
        case 'mint-item': case 'mint-moonbound':{await mintPublicEdition(action.dataset.slug);return}
        case 'launch-moonbound':{await launchVESPER();return}
        case 'bootstrap-registry':{await bootstrapRegistry();return}
        case 'verify-points':{await verifyPointsForm();return}
        case 'buy-item':{await buyItem(currentItem());return}
        case 'confirm-buy':{await executeBuy(action.dataset.id,action.dataset.path);return}
        case 'list-item':{openListing(currentItem());return}
        case 'cancel-item':{await cancelListing(currentItem());return}
        case 'submit-listing':{await submitListing();return}
        case 'slide-left':{const track=$('#mintSliderTrack');if(track)track.scrollBy({left:-340,behavior:'smooth'});return}
        case 'slide-right':{const track=$('#mintSliderTrack');if(track)track.scrollBy({left:340,behavior:'smooth'});return}
        case 'connect-adena':{await connectAdena();return}
        case 'connect-keplr':{await connectKeplr();return}
        case 'open-network-modal':{openNetworkModal();return}
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
$('#networkSwitcherBtn')?.addEventListener('click',openNetworkModal);
function openMenu(){document.body.classList.add('menu-open');$('.main-nav')?.classList.add('open');$('#mobileMenuBtn')?.setAttribute('aria-expanded','true')}
function closeMenu(){document.body.classList.remove('menu-open');$('.main-nav')?.classList.remove('open');$('#mobileMenuBtn')?.setAttribute('aria-expanded','false')}
$('#mobileMenuBtn')?.addEventListener('click',()=>{document.body.classList.contains('menu-open')?closeMenu():openMenu()});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeModal();closeMenu()}
  if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){event.preventDefault();$('#globalSearch').focus()}
});

bootstrap();

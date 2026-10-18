/* Concept mock-up. Traits and rarity counts come from the real
   nft-collection/metadata (1111 files) — nothing about an edition is invented.
   Rule this mock-up demonstrates: traits are public (pinned metadata), art
   reveals on mint, so unminted editions render as numbered tiles. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const TOTAL = 1111, PRICE = 575, PER_WALLET = 3, PAGE = 24;
const pad = n => String(n).padStart(4, '0');
const num = n => n.toLocaleString('en-US');

const COUNTS = {
  Rarity: { Common: 546, Rare: 333, Epic: 166, Legendary: 55, Mythic: 11 },
  Keeper: { 'Moon Keeper':70,'Moss Warden':70,'Ivory Oracle':70,'Ember Scribe':70,'Dawn Herald':70,'Night Astronomer':70,'Mushroom Seer':70,'Frost Sentinel':69,'Amber Lantern':69,'Violet Dreamer':69,'Ashen Pilgrim':69,'Lunar Cartographer':69,'Crystal Watcher':69,'Briar Sage':69,'Cloud Voyager':69,'Astral Keeper':69 },
  Aura: { Moonlit:70,Verdant:70,Celestial:70,Ember:70,Dawn:70,Void:70,Mycelial:70,Glacial:69,Amber:69,Dream:69,Twilight:69,Lunar:69,Crystal:69,Wildwood:69,Cloudborne:69,Astral:69 },
  Frame: { Starlit:223, Filigree:222, Orbit:222, Glyph:222, Runic:222 }
};
const RARITY_ORDER = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Common'];

/* ---------- metadata (real files) ---------- */
const cache = {};
async function meta(id) {
  if (cache[id]) return cache[id];
  const fallback = { id, name: 'Moonbound Keepers #' + id, t: {} };
  try {
    const j = await (await fetch(`/collection-assets/metadata/${id}.json`)).json();
    const t = {};
    for (const a of j.attributes || []) t[a.trait_type] = a.value;
    cache[id] = { id, name: j.name || fallback.name, t };
  } catch {
    cache[id] = fallback; // offline: show the number, claim nothing
  }
  return cache[id];
}

/* ---------- cards ---------- */
const traitLine = t => [t.Keeper, t.Realm, t.Aura, t.Frame && t.Frame + ' frame'].filter(Boolean).join(' · ');

function lockedHTML(n, it) {
  const id = pad(n);
  return `<article class="card" data-tile="${id}" data-goto="drop">
    <div class="locked"><span class="lock">🔒</span><b>#${id}</b><span>Unminted</span></div>
    <div class="card-body"><h3>Moonbound Keepers</h3>
      <div class="sub">${traitLine(it.t) || 'Traits pinned · art reveals on mint'}</div>
      <div class="buy-row"><div class="price"><span>Mint price</span><b>${PRICE} GNOT</b></div>
        <button class="btn btn-ghost btn-sm">Mint</button></div></div>
  </article>`;
}
function card(it) {
  const t = it.t, r = t.Rarity || '';
  return `<article class="card" data-tile="${it.id}">
    <div class="thumb"><div class="blur" style="background-image:url('/collection-assets/images/${it.id}.webp')"></div>
      <img src="/collection-assets/images/${it.id}.webp" alt="${it.name}" loading="lazy">
      ${r ? `<span class="rarity ${r.toLowerCase()}">${r}</span>` : ''}</div>
    <div class="card-body"><h3>#${it.id}${t.Keeper ? ' · ' + t.Keeper : ''}</h3><div class="sub">${traitLine(t)}</div>
      <div class="buy-row"><div class="price"><span>Minted · you (demo)</span><b class="closed">Not listed</b></div>
        <button class="btn btn-ghost btn-sm" data-goto="item">View</button></div></div>
  </article>`;
}

/* ---------- facets ---------- */
function facetHTML(type, data) {
  return Object.entries(data).map(([v, c]) =>
    `<label class="chk"><input type="checkbox" name="f-${type}-${v}" data-type="${type}" data-value="${v}"><span>${v}</span><em>${c}</em></label>`).join('');
}
function mountFacets() {
  $('#rarityFacet').innerHTML = facetHTML('Rarity', COUNTS.Rarity);
  $('#keeperFacet').innerHTML = facetHTML('Keeper', COUNTS.Keeper);
  $('#auraFacet').innerHTML = facetHTML('Aura', COUNTS.Aura);
  $('#frameFacet').innerHTML = facetHTML('Frame', COUNTS.Frame);
}

/* ---------- collection grid ---------- */
const picked = {}, mintedIds = new Set();
let status = 'all', page = 0, loaded = [], exhausted = false;

const matches = it => {
  for (const type in picked) {
    const set = picked[type];
    if (set.size && !set.has(it.t[type])) return false;
  }
  if (status === 'minted' || status === 'listed') return false; // nothing minted, nobody can list
  return true;
};
const tile = it => mintedIds.has(it.id) ? card(it) : lockedHTML(+it.id, it);

function renderCollection() {
  const order = { ed: (a, b) => a.id.localeCompare(b.id), rar: (a, b) => RARITY_ORDER.indexOf(a.t.Rarity) - RARITY_ORDER.indexOf(b.t.Rarity) };
  const list = loaded.filter(matches).sort(order[$('#sortSel').value] || order.ed);
  $('#collectionGrid').innerHTML = list.map(tile).join('') ||
    `<div class="panel" style="grid-column:1/-1;text-align:center;color:var(--muted)">
      Nothing here matches yet. ${status === 'minted' || status === 'listed'
        ? 'That state becomes reachable after the first mint.' : 'Clear a filter to widen the search.'}</div>`;
}
async function loadPage() {
  if (exhausted) return;
  const from = page * PAGE + 1, ids = [];
  for (let n = from; n < from + PAGE && n <= TOTAL; n++) ids.push(pad(n));
  page++;
  if (!ids.length) { exhausted = true; return; }
  loaded = loaded.concat(await Promise.all(ids.map(meta)));
  exhausted = from + PAGE - 1 >= TOTAL;
  $('#moreBtn').textContent = exhausted ? `All ${num(TOTAL)} editions loaded` : 'Load 24 more';
  $('#moreBtn').disabled = exhausted;
  renderCollection();
}

/* ---------- drop page ---------- */
let minted = 0, qty = 1;
function syncMint() {
  const left = Math.max(0, PER_WALLET - minted);
  qty = Math.min(qty, Math.max(1, left));
  $('#qty').textContent = qty;
  $('#total').textContent = num(qty * PRICE) + ' GNOT';
  $('#mintedStat').textContent = num(minted);
  $('#collMinted').textContent = num(minted);
  $('#ownersStat').textContent = minted ? '1 · you (demo)' : '0';
  $('#revealedCount').textContent = num(minted);
  $('#mintedLine').textContent = `${num(minted)} / ${num(TOTAL)} minted`;
  $('#heroMinted').textContent = num(minted);
  const pct = (minted / TOTAL * 100).toFixed(1);
  $('#heroPct').textContent = pct + '%';
  $('#heroBar').style.width = pct + '%';
  const btn = $('#mintBtn');
  btn.disabled = left === 0;
  btn.textContent = left === 0 ? 'Wallet limit reached (3)' : 'Mint now ↗';
}
async function mintOne() {
  if (minted >= PER_WALLET) return;
  const id = pad(++minted);
  const it = await meta(id);
  mintedIds.add(id);
  const holder = document.createElement('div');
  holder.innerHTML = card(it);
  const el = holder.firstElementChild;
  el.classList.add('reveal');
  $$(`[data-tile="${id}"]`).forEach(t => t.replaceWith(el.cloneNode(true)));
  renderCollection();
  syncMint();
}

/* ---------- screens ---------- */
function show(name) {
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === 'screen-' + name));
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.screen === name));
  $$('#switcher button').forEach(b => b.classList.toggle('on', b.dataset.screen === name));
  window.scrollTo(0, 0);
}

/* ---------- wiring ---------- */
document.addEventListener('click', e => {
  const sw = e.target.closest('#switcher button, #nav button');
  if (sw) return show(sw.dataset.screen);
  const q = e.target.closest('[data-qty]');
  if (q) { qty = Math.min(PER_WALLET - minted, Math.max(1, qty + Number(q.dataset.qty))); syncMint(); return; }
  const p = e.target.closest('#statusPills .pill');
  if (p) {
    status = p.dataset.status;
    $$('#statusPills .pill').forEach(x => x.classList.toggle('on', x === p));
    renderCollection();
    return;
  }
  const jump = e.target.closest('[data-goto]');
  if (jump && !jump.dataset.tile) return show(jump.dataset.goto);
  if (jump && jump.dataset.tile) return show('drop'); // tapping an unminted tile opens the mint page
});
document.addEventListener('change', e => {
  const box = e.target.closest('input[data-type]');
  if (!box) return;
  const set = picked[box.dataset.type] || (picked[box.dataset.type] = new Set());
  box.checked ? set.add(box.dataset.value) : set.delete(box.dataset.value);
  renderCollection();
});
$('#sortSel').addEventListener('change', renderCollection);
$('#moreBtn').addEventListener('click', loadPage);
$('#mintBtn').addEventListener('click', mintOne);

(async () => {
  mountFacets();
  await loadPage();                                   // first 24 editions, real traits
  $('#dropGrid').innerHTML = loaded.slice(0, 12).map(tile).join('');
  $('#unrevealedGrid').innerHTML = loaded.slice(12, 20).map(tile).join('');
  syncMint();
})();

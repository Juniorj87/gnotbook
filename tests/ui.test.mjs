import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, css, server] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
]);

test('desktop navigation exposes the requested marketplace sections', () => {
  for (const route of ['explore','upcoming','market','collections','portfolio','create','activity','settings']) {
    assert.match(html, new RegExp(`data-route="${route}"`));
  }
  assert.match(html, /rail-label/);
  assert.match(html, /main-background|main-nav/);
});

test('frontend assets use a cache-busting version so deployed UI changes are fetched', () => {
  assert.match(html, /styles\.css\?v=20261022-flat-5/);
  assert.match(html, /app\.js\?v=20261022-flat-5/);
});

test('navigation preserves route state across refresh and browser history', () => {
  assert.match(app, /function routeLocationKey\(\)/);
  assert.match(app, /function writeRouteLocation\(push=false\)/);
  assert.match(app, /async function restoreRouteLocation\(\)/);
  assert.match(app, /window\.addEventListener\('popstate'/);
  assert.match(app, /#collection\?path=/);
  assert.match(app, /#item\?id=/);
});

test('the flat technical visual system and reduced-motion accessibility are present', () => {
  assert.match(css, /--accent:#F0B429/);
  assert.match(css, /--radius:4px/);
  assert.match(css, /--font-display:"Inter Tight"/);
  assert.match(css, /--font-mono:"JetBrains Mono"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('the portfolio route is reachable from the rail and the footer', () => {
  assert.match(html, /data-route="portfolio"/);
  assert.match(app, /function renderPortfolio\(\)/);
  assert.match(app, /'portfolio'/);
});

test('the quests page and the footer social links are reachable', () => {
  assert.match(html, /data-route="rewards"/);
  assert.match(html, /id="footerSocials"/);
  assert.match(app, /function renderRewards\(\)/);
  assert.match(app, /function renderFooterSocials\(/);
});

test('creators can pin their own artwork and hand over the CIDs', () => {
  // The server can read a public gateway without holding a storage credential.
  assert.match(server, /app\.post\('\/api\/ipfs\/verify'/);
  assert.match(server, /function resolveCid\(/);
  // The create form offers the self-service route with links to both providers.
  assert.match(app, /app\.pinata\.cloud/);
  assert.match(app, /octopin\.app/);
  assert.match(app, /id="pinImageCid"/);
  assert.match(app, /id="pinMetadataCid"/);
  assert.match(app, /data-action="verify-cids"/);
  // The server stores a creator-pinned collection with its IPFS bases.
  assert.match(server, /imageCid/);
  assert.match(server, /metadataBaseURI/);
});

test('the drawer menu toggles with scroll lock, backdrop and Escape close', () => {
  assert.match(app, /function openMenu\(\)\{document\.body\.classList\.add\('menu-open'\)/);
  assert.match(app, /function closeMenu\(\)\{document\.body\.classList\.remove\('menu-open'\)/);
  assert.match(app, /if\(event\.key==='Escape'\)\{closeModal\(\);closeMenu\(\)\}/);
  assert.match(css, /body\.menu-open\{overflow:hidden\}/);
  assert.match(html, /data-action="close-menu"/);
});

test('item page uses the LEGO art stage with plastic shadow', () => {
  assert.match(app, /item-art-stage/);
  assert.match(css, /\.item-art-stage\{/);
});

test('homepage shows the server-backed Upcoming Mints and excludes the legacy featured drop block', () => {
  assert.match(app, /function renderUpcoming\(/);
  assert.match(app, /function renderMintCalendar\(\)\{\s*return renderUpcoming\(\);\s*\}/);
  assert.match(app, /renderExplore\(\)\{\s*return `\$\{renderHero\(\)\}\$\{renderUpcomingStrip\(\)\}/);
  // The old demo entry points (genesis drop grid, GNO PUNK launch panel) must not be
  // reachable from the homepage assembly anymore.
  assert.doesNotMatch(app, /renderDrops\(\)|renderUnrevealedGrid\(\)|renderGenesisLaunch\(\)/);
});

test('upcoming mints derive status from real time and tick countdowns without re-render', () => {
  assert.match(app, /function upcomingStatusOf\(c\)/);
  assert.match(app, /setInterval\(tickCountdowns,1000\)/);
  assert.match(app, /data-countdown/);
  assert.doesNotMatch(app, /localStorage\.getItem\('gnotbook_mints'/, 'the mint calendar must not come from browser storage anymore');
});

test('the public catalog starts empty and contains no bundled demo drops', () => {
  for (const marker of ['OWL COLLECTION', 'THE TREES', 'NEON SOULS', 'GNO PUNK #0001', "localStorage.getItem('gnotbook_mints')"]) {
    assert.ok(!app.includes(marker), `demo artifact "${marker}" must not be rendered by the homepage code`);
  }
  assert.match(app, /No collections registered yet/);
});

test('Punk browsing starts with a compact gallery and progressively reveals more editions', () => {
  assert.match(app, /limit:6/);
  assert.match(app, /pool\.slice\(0,Number\(g\.limit\|\|6\)\)/);
  assert.match(app, /data-action="gallery-show-more"/);
  assert.match(app, /case 'gallery-show-more'/);
});

test('the launch fee is waived for the registry admin wallet in the client transaction', () => {
  assert.match(app, /dueSend:isAdmin\?'':/);
  assert.equal((app.match(/dueSend\)/g) || []).length, 2, 'both launch paths must send the waived amount');
  assert.ok(!/launchFee\}ugnot/.test(app), 'no launch path may send the raw fee directly');
});

test('the creator studio exposes the one-time registry deployment once network writes are enabled', () => {
  assert.match(app, /state\.config\?\.bootstrapEnabled\?/);
  assert.match(app, /data-action="bootstrap-registry"/);
  assert.match(app, /case 'bootstrap-registry'/);
});

test('the per-wallet mint cap comes from the chain and gates every mint entry point', () => {
  assert.match(app, /function walletMintLimit\(\)\{return Number\(state\.config\?\.moonbound\?\.mintsPerWallet\|\|0\)\}/);
  assert.match(app, /function walletMintCapReached\(\)/);
  assert.match(app, /function walletMintAllowanceCopy\(\)/);
  assert.match(app, /refreshMintAllowance\(\)\n/);
  assert.match(app, /if\(walletMintCapReached\(\)\)throw new Error/);
  assert.equal((app.match(/walletMintCapReached\(\)/g) || []).length, 4, 'the cap helper must gate the tile, the collection box, and the mint call');
  assert.match(app, /!listed&&!owned&&!walletMintCapReached\(\)/, 'the gallery tile respects the cap');
  assert.match(app, /mintLive=mintLive&&!capped;|,mintEnabled=mintLive&&!capped;/, 'the collection mint box respects the cap');
  assert.match(app, /'Wallet limit reached'/);
  assert.ok(!/No contract limit/.test(app), 'the UI must not claim an unlimited mint the contract does not allow');
});

test('the creator form saves a server draft with schedule, website, mint type and whitelist', () => {
  assert.match(app, /async function saveDraftCollection\(\)/);
  assert.match(app, /id="mintStartDate"/);
  assert.match(app, /id="mintTimezone"/);
  assert.match(app, /id="whitelistFile"/);
  assert.match(app, /id="saveDraftButton"/);
  assert.match(app, /data-action="launch-collection"/);
  // The old on-chain launch flow keeps reading the same element IDs.
  assert.match(app, /const coverFile=\$\('#collectionCover'\)\?\.files\?\.\[0\]/);
  assert.match(app, /id="launchCollectionButton"/);
  assert.match(app, /id="confirmRights"/);
});

test('an Adena session that already approved this site still connects', () => {
  assert.match(app, /&&!\/already connected\/i\.test\(String\(establish\.message\|\|''\)\)/, 'only a real rejection may stop the connection');
});

test('a signing request uses the transaction parameters Adena actually validates', () => {
  assert.match(app, /adena\.DoContract\(\{messages,memo\}\)/, 'Adena reads messages and memo off the transaction params, not a tx wrapper');
  assert.ok(!/DoContract\(\{tx:/.test(app), 'a tx wrapper makes Adena answer INVALID_FORMAT before the approval popup opens');
});

test('marketplace actions keep their wiring with the honest mint dispatcher', () => {
  assert.match(app, /data-action="mint-item"/);
  assert.match(app, /case 'mint-item': case 'mint-moonbound':/);
});

test('public minting is generalized for any registered or active collection slug', () => {
  assert.match(app, /async function mintPublicEdition\(slug\)/);
  assert.match(app, /transactionMessage\(pkg,'PublicMint',\[\],`\$\{mintPriceUgnot\}ugnot`\)/);
});

import fs from 'node:fs/promises';
import vm from 'node:vm';
const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
if (!scripts.length) throw new Error('Standalone preview has no interactive script.');
for (const [i, source] of scripts.entries()) new vm.Script(source, { filename: `index.html:inline-script-${i + 1}` });
for (const asset of ['public/assets/art/moon-keeper.webp','public/assets/art/glass-spirit.webp','public/assets/art/sun-orbit.webp','public/assets/art/frog-cosmos.webp']) {
  if (!html.includes(asset)) throw new Error(`Standalone preview does not reference expected relative asset: ${asset}`);
}
if (!html.includes('DESIGN PREVIEW') || !html.includes('static visual preview')) throw new Error('Standalone preview must disclose that it is not the live app.');
console.log(`Standalone preview syntax passed (${scripts.length} inline script(s)); local art paths and preview disclosure present.`);

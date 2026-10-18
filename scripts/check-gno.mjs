// Checks that the Morrow Gno contracts compile with an installed official Gno toolchain.
// Usage: node scripts/check-gno.mjs   (requires `gno` on PATH or GNO_BIN set)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const gno = process.env.GNO_BIN || 'gno';
const probe = spawnSync(gno, ['version'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.log('Gno toolchain not found; skipping contract compilation check.');
  console.log('Install from https://github.com/gnolang/gno/releases and set GNO_BIN if needed.');
  process.exit(0);
}
console.log('Gno:', probe.stdout.trim() || probe.stderr.trim());

const work = join(process.env.TEMP || '/tmp', 'morrow-gno-check');
if (existsSync(work)) rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// Registry (self-contained, no external deps).
const regDir = join(work, 'registry');
mkdirSync(regDir, { recursive: true });
writeFileSync(join(regDir, 'gnomod.toml'), 'module = "gno.land/r/morrow/morrowmarket"\ngno = "1.0"\n');
copyFileSync('contracts/registry/morrowmarket.gno', join(regDir, 'morrowmarket.gno'));

function run(args, cwd) {
  const r = spawnSync(gno, args, { cwd, encoding: 'utf8', timeout: 300000 });
  return r;
}

let failed = false;
const r1 = run(['test', '.'], regDir);
console.log('--- registry: gno test ---');
console.log((r1.stdout || '') + (r1.stderr || ''));
if (r1.status !== 0) failed = true;

// Collection template: syntax check via gno fmt (full compile needs stdlib resolution,
// which is environment-dependent on Windows; fmt at least parses the AST).
const tplRaw = (await import('node:fs')).readFileSync('contracts/templates/morrow-collection.gno', 'utf8')
  .replace(/__PACKAGE__/g, 'moonbound')
  .replace(/__REGISTRY_PATH__/g, 'gno.land/r/morrow/morrowmarket');
const tplDir = join(work, 'template');
mkdirSync(tplDir, { recursive: true });
writeFileSync(join(tplDir, 'gnomod.toml'), 'module = "gno.land/r/morrow/moonbound"\ngno = "1.0"\n');
writeFileSync(join(tplDir, 'moonbound.gno'), tplRaw);
const r2 = run(['fmt', '.'], tplDir);
console.log('--- template: gno fmt ---');
console.log((r2.stdout || '') + (r2.stderr || ''));
if (r2.status !== 0) failed = true;

process.exit(failed ? 1 : 0);
// One-shot Neon setup: create a project, a branch and a database, then print the
// pooled connection string for the Vercel deployment.
//
// Usage:  NEON_API_KEY=... node scripts/setup-neon.mjs [--region aws-eu-central-1] [--name gnotbook]
//
// The API key is only read from the environment and never written to disk.

const API = 'https://api.neon.tech/v2';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const key = process.env.NEON_API_KEY;
if (!key) {
  console.error('NEON_API_KEY is missing. Create one in the Neon console (Account settings → API keys) and export it.');
  process.exit(1);
}

const name = arg('name', 'gnotbook');
const region = arg('region', 'aws-eu-central-1');
const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: auth,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.message || data.error || text.slice(0, 300)}`);
  return data;
}

const project = await call('POST', '/projects', { name });
const projectId = project.id;
console.log(`project: ${projectId} (${name})`);

const branch = await call('POST', `/projects/${projectId}/branches`, { name: 'main' });
console.log(`branch:  ${branch.id}`);

const endpoint = await call('POST', `/projects/${projectId}/endpoints`, { branch_id: branch.id, type: 'read-write' });
console.log(`endpoint: ${endpoint.host}`);

await call('POST', `/projects/${projectId}/databases`, { branch_id: branch.id, name: 'gnotbook' });

const uris = await call('POST', `/projects/${projectId}/connection_uris`, {
  branch_id: branch.id,
  database_name: 'gnotbook',
  role_name: 'neondb_owner',
  pooled: true
});

const pooled = (uris.uris || []).find((u) => u.connection_uri) || uris.uris?.[0];
console.log('\n--- DATABASE_URL (pooled, для Vercel) ---');
console.log(pooled?.connection_uri || '(none)');
console.log('\nPGSSL=true');

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { dashboardAuthEnabled } from '../lib/auth-config.mjs';

const mode = process.env.COSMO_DATA_MODE || 'history';
if (!['history', 'realtime'].includes(mode)) throw new Error('COSMO_DATA_MODE must be history or realtime.');
const authEnabled = dashboardAuthEnabled(process.env.DASHBOARD_AUTH_ENABLED);
const collectorToken = authEnabled ? undefined : randomBytes(32).toString('hex');
for (const key of ['COSMO_EMAIL', 'COSMO_PASSWORD', ...(authEnabled ? ['DASHBOARD_USERNAME', 'DASHBOARD_PASSWORD'] : [])]) {
    if (!process.env[key]) throw new Error(`Missing ${key}.`);
}
if (authEnabled && (!/^[\x21-\x7e]+$/.test(process.env.DASHBOARD_USERNAME) || process.env.DASHBOARD_USERNAME.includes(':') || !/^[\x20-\x7e]+$/.test(process.env.DASHBOARD_PASSWORD))) {
    throw new Error('Dashboard Basic-auth credentials must be printable ASCII; username cannot contain a colon.');
}
const root = process.cwd(), runtime = mkdtempSync(path.join(tmpdir(), 'cosmo-runtime-')), state = process.env.COSMO_STATE_DIR || '/data';
mkdirSync(state, { recursive: true });
const config = JSON.parse(readFileSync(path.join(root, 'dist/server/wrangler.json'), 'utf8'));
config.main = path.join(root, 'dist/server', config.main);
config.assets = { ...config.assets, directory: path.join(root, 'dist/client') };
config.vars = { COSMO_DATA_MODE: mode, SELF_HOSTED: 'true', DASHBOARD_AUTH_ENABLED: String(authEnabled) };
config.d1_databases = mode === 'history' ? [{ binding: 'DB', database_name: 'cosmo-history', database_id: '00000000-0000-4000-8000-000000000000', migrations_dir: path.join(root, 'drizzle') }] : [];
delete config.build;
config.observability = { enabled: false };
const configPath = path.join(runtime, 'wrangler.json');
writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
// Wrangler reads secrets next to its config. They live only in the container's
// temporary filesystem, never the image, persisted database volume, or argv.
const secrets = { COSMO_EMAIL: process.env.COSMO_EMAIL, COSMO_PASSWORD: process.env.COSMO_PASSWORD,
    ...(authEnabled ? { DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME, DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD } : { COSMO_COLLECTOR_TOKEN: collectorToken }) };
writeFileSync(path.join(runtime, '.dev.vars'), Object.entries(secrets).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const env = { ...process.env, WRANGLER_LOG_PATH: runtime, WRANGLER_REGISTRY_PATH: runtime, MINIFLARE_REGISTRY_PATH: runtime, CLOUDFLARE_CF_FETCH_ENABLED: 'false' };
if (mode === 'history') {
    const result = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', state], { env, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Database migration failed.');
}
const server = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--persist-to', state, '--ip', '0.0.0.0', '--port', '8080', '--inspector-port', '0'], { env, stdio: 'inherit' });
let busy = false;
const collectorEnabled = mode === 'history' && process.env.COSMO_COLLECTOR_ENABLED !== 'false';
async function collect() {
    if (busy || mode !== 'history') return;
    busy = true;
    try {
        const headers = authEnabled ? { Authorization: 'Basic ' + Buffer.from(`${process.env.DASHBOARD_USERNAME}:${process.env.DASHBOARD_PASSWORD}`).toString('base64') } : { 'x-cosmo-collector-token': collectorToken };
        const response = await fetch('http://127.0.0.1:8080/api/collect', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(150_000), headers });
        console.log(`Collector HTTP status: ${response.status}`);
    } catch { console.warn('Collector unavailable; will retry.'); }
    finally { busy = false; }
}
const first = collectorEnabled ? setTimeout(collect, 10_000) : undefined;
const timer = collectorEnabled ? setInterval(collect, 300_000) : undefined;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
server.on('error', () => { console.error('Runtime failed to start.'); process.exit(1); });
server.on('exit', code => { clearTimeout(first); clearInterval(timer); rmSync(runtime, { recursive: true, force: true }); process.exit(code ?? 1); });

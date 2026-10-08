import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataMode } from '../lib/data-mode.ts';
import { loadDashboard } from '../lib/dashboard-loader.server.ts';
import { selfhostRequest } from '../lib/selfhost-auth.ts';
import { runCollector } from '../lib/collector.server.ts';
import { dashboardAuthEnabled } from '../lib/auth-config.mjs';

test('dashboard authentication is enabled unless explicitly disabled; invalid values fail closed', () => {
    assert.equal(dashboardAuthEnabled(), true);
    assert.equal(dashboardAuthEnabled('true'), true);
    assert.equal(dashboardAuthEnabled('false'), false);
    for (const value of ['0', 'FALSE', 'off']) assert.throws(() => dashboardAuthEnabled(value), /DASHBOARD_AUTH_ENABLED/);
});

test('disabled visitor authentication opens read requests without credentials and strips spoofed identity', async () => {
    const result = await selfhostRequest(new Request('https://example.test/api/history', { headers: { 'oai-authenticated-user-id': 'attacker', 'oai-authenticated-user-email': 'attacker@example.test' } }), { SELF_HOSTED: 'true', DASHBOARD_AUTH_ENABLED: 'false' });
    assert.ok(result instanceof Request);
    assert.equal(result.headers.get('oai-authenticated-user-id'), null);
    assert.equal(result.headers.get('oai-authenticated-user-email'), null);
});

test('disabled visitor authentication keeps collection and MCP protected, even with encoded paths', async () => {
    const config = { SELF_HOSTED: 'true', DASHBOARD_AUTH_ENABLED: 'false', COSMO_COLLECTOR_TOKEN: 'fictional-internal-token' };
    for (const url of ['/api/collect', '/api/%63ollect', '/mcp', '/mcp/']) {
        for (const token of [undefined, 'wrong']) {
            const denied = await selfhostRequest(new Request('https://example.test' + url, { method: 'POST', headers: token ? { 'x-cosmo-collector-token': token } : {} }), config);
            assert.ok(denied instanceof Response); assert.equal(denied.status, 401);
        }
        const allowed = await selfhostRequest(new Request('https://example.test' + url, { method: 'POST', headers: { 'x-cosmo-collector-token': config.COSMO_COLLECTOR_TOKEN } }), config);
        assert.ok(allowed instanceof Request);
        assert.equal(allowed.headers.get('x-cosmo-collector-token'), null);
    }
});

test('history remains the default and invalid deployment modes fail closed', () => {
    assert.equal(dataMode(), 'history');
    assert.equal(dataMode('history'), 'history');
    assert.equal(dataMode('realtime'), 'realtime');
    assert.throws(() => dataMode('real-time'), /COSMO_DATA_MODE/);
});

test('realtime works without DB and never touches even an existing DB or daily archive endpoint', async () => {
    const original = globalThis.fetch, calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init: RequestInit) => {
        const path = new URL(String(url)).pathname;
        calls.push(path);
        assert.ok(init.method === 'GET' || path === '/v2/token');
        const data = path === '/v2/token' ? { accessToken: 'fictional-token' }
            : path === '/v2/map' ? { Devices: [{ id: 123, firstName: 'Example', hardwareName: 'watch' }] }
            : path === '/v2/stepcounter' ? { devices: [{ id: 123, InfomarkStepcounters: [{ count: 50, startTime: '2026-10-07T00:00:00Z', endTime: '2026-10-07T12:00:00Z' }] }] }
            : path.includes('/goals/') ? { goal: 1000 } : [];
        return Response.json({ status: 0, data });
    }) as typeof fetch;
    try {
        const config = { COSMO_DATA_MODE: 'realtime', COSMO_EMAIL: 'example@example.test', COSMO_PASSWORD: 'fictional' };
        for (const DB of [undefined, new Proxy({}, { get() { throw new Error('Database accessed'); } }) as D1Database]) {
            const data = await loadDashboard({ ...config, DB });
            assert.equal(data.dataMode, 'realtime');
            assert.equal(data.watches[0].steps?.count, 50);
            assert.equal(data.collection, undefined);
            assert.equal(data.historyWatches, undefined);
        }
        assert.ok(!calls.some(path => path.includes('/list/daily/')));
    } finally { globalThis.fetch = original; }
});

test('history requires configured storage instead of silently serving realtime', async () => {
    await assert.rejects(() => loadDashboard({}), /Database unavailable/);
    await assert.rejects(() => loadDashboard({ COSMO_DATA_MODE: 'realtime' }), /Connection not configured/);
});

test('realtime collector refuses collection even when credentials and a DB remain bound', async () => {
    const DB = new Proxy({}, { get() { throw new Error('Database accessed'); } }) as D1Database;
    await assert.rejects(() => runCollector({ COSMO_DATA_MODE: 'realtime', COSMO_EMAIL: 'example@example.test', COSMO_PASSWORD: 'fictional', DB }), /Collection disabled/);
});

test('container authentication rejects spoofed Sites identity and missing credentials', async () => {
    const request = new Request('https://example.test/api/dashboard', { headers: { 'oai-authenticated-user-id': 'attacker', 'oai-authenticated-user-email': 'attacker@example.test' } });
    const missing = await selfhostRequest(request, { SELF_HOSTED: 'true' });
    assert.ok(missing instanceof Response); assert.equal(missing.status, 503);
    const denied = await selfhostRequest(request, { SELF_HOSTED: 'true', DASHBOARD_USERNAME: 'owner', DASHBOARD_PASSWORD: 'fictional' });
    assert.ok(denied instanceof Response); assert.equal(denied.status, 401);
    const authenticated = await selfhostRequest(new Request(request, { headers: { ...Object.fromEntries(request.headers), Authorization: 'Basic ' + btoa('owner:fictional') } }), { SELF_HOSTED: 'true', DASHBOARD_USERNAME: 'owner', DASHBOARD_PASSWORD: 'fictional' });
    assert.ok(authenticated instanceof Request);
    assert.equal(authenticated.headers.get('oai-authenticated-user-id'), 'selfhost-owner');
    assert.equal(authenticated.headers.get('oai-authenticated-user-email'), 'owner@localhost');
    assert.equal(await selfhostRequest(request, {}), request);
});

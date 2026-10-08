import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionRpc } from '../lib/mcp.server.ts';
const rpc = (method: string, params: unknown = {}, id: number | undefined = 1) => new Request('https://example.test/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
test('MCP initializes and discovers only bounded collection tools without exposing account data', async () => {
    const call = async () => { throw new Error('must not collect during discovery'); };
    const init = await collectionRpc(rpc('initialize', { protocolVersion: '2025-03-26' }), call);
    assert.equal((await init.json() as { result: { protocolVersion: string } }).result.protocolVersion, '2025-03-26');
    const tools = await collectionRpc(rpc('tools/list'), call), body = await tools.text();
    assert.match(body, /collect_watch_reports/); assert.match(body, /collection_status/); assert.doesNotMatch(body, /password|latitude|longitude|token/);
});
test('MCP rejects supplied payloads and unknown tools before calling the collector', async () => {
    let calls = 0;
    for (const params of [{ name: 'raw' }, { name: 'collect_watch_reports', arguments: { watchId: '123' } }, { name: 'collect_watch_reports', arguments: [] }]) {
        const response = await collectionRpc(rpc('tools/call', params), async () => { calls++; return {}; });
        assert.match(await response.text(), /Invalid tool or arguments/);
    }
    assert.equal(calls, 0);
});
test('MCP collection results and failures are private and sanitized', async () => {
    const response = await collectionRpc(rpc('tools/call', { name: 'collect_watch_reports', arguments: {} }), async () => ({ status: 'ok', records: 2 }));
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.match(await response.text(), /records/);
    const failed = await collectionRpc(rpc('tools/call', { name: 'collect_watch_reports' }), async () => { throw new Error('PRIVATE-TOKEN'); });
    const body = await failed.text(); assert.match(body, /isError/); assert.doesNotMatch(body, /PRIVATE/);
});
test('MCP notifications have no response body and malformed requests are rejected', async () => {
    const notification = new Request('https://example.test/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal((await collectionRpc(notification, async () => ({}))).status, 202);
    const malformed = new Request('https://example.test/mcp', { method: 'POST', body: 'broken' });
    assert.equal((await collectionRpc(malformed, async () => ({}))).status, 400);
});

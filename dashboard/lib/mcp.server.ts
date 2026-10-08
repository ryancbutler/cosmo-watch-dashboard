export const collectionTools = [
    { name: 'collect_watch_reports', description: 'Collect latest COSMO watch reports and save them in the private dashboard database. Uses only upstream reads and authentication. Returns collection status and record counts; no personal data.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'collection_status', description: 'Read the last attempt and successful collection timestamps and collection status. Returns no watch details or locations.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: unknown } };
export async function collectionRpc(request: Request, call: (name: string) => Promise<unknown>): Promise<Response> {
    const headers = { 'Cache-Control': 'private, no-store' };
    let message: Rpc;
    try { message = await request.json() as Rpc; }
    catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }, { status: 400, headers }); }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, { status: 400, headers });
    if (message.id === undefined) return new Response(null, { status: 202, headers });
    let result: unknown;
    if (message.method === 'initialize') {
        const requested = message.params?.protocolVersion;
        result = { protocolVersion: requested && ['2024-11-05','2025-03-26','2025-06-18'].includes(requested) ? requested : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'cosmo-private-collector', version: '1.0.0' } };
    } else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: collectionTools };
    else if (message.method === 'tools/call') {
        const name = message.params?.name, args = message.params?.arguments;
        if (!collectionTools.some(t => t.name === name) || (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length))) return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid tool or arguments' } }, { headers });
        try { result = { content: [{ type: 'text', text: JSON.stringify(await call(name!)) }] }; }
        catch { result = { isError: true, content: [{ type: 'text', text: 'Collection is temporarily unavailable.' }] }; }
    } else return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }, { headers });
    return Response.json({ jsonrpc: '2.0', id: message.id, result }, { headers });
}

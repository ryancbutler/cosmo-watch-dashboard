import { dataMode } from '../../../lib/data-mode';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { readHistory } from '../../../lib/archive.server';
import { parseHistoryQuery } from '../../../lib/history';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, oai-authenticated-user-id' };
    if (!await getChatGPTUser()) return Response.json({ error: 'Sign in to view history.' }, { status: 401, headers });
    if (dataMode(env.COSMO_DATA_MODE) === 'realtime') return Response.json({ error: 'Saved history is disabled.' }, { status: 404, headers });
    let query;
    try { query = parseHistoryQuery(new URL(request.url).searchParams); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Invalid history request.' }, { status: 400, headers }); }
    try {
        if (!env.DB) throw new Error();
        return Response.json(await readHistory(env.DB, query), { headers });
    } catch { return Response.json({ error: 'Saved history is temporarily unavailable.' }, { status: 503, headers }); }
}

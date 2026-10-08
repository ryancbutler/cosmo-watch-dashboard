import { dataMode } from '../../../lib/data-mode';
import { env } from 'cloudflare:workers';
import { runCollector } from '../../../lib/collector.server';
import { getChatGPTUser } from '../../chatgpt-auth';

export const dynamic = 'force-dynamic';
export async function POST() {
    // The owner-private Sites dispatch authenticates service calls before this route.
    // This endpoint cannot accept supplied data, resource IDs, or upstream write paths.
    const headers = { 'Cache-Control': 'private, no-store' };
    if (import.meta.env.DEV && !await getChatGPTUser()) return Response.json({ error: 'Sign in to collect reports locally.' }, { status: 401, headers });
    if (dataMode(env.COSMO_DATA_MODE) === 'realtime') return Response.json({ error: 'Collection is disabled in realtime mode.' }, { status: 409, headers });
    if (!env.DB || !env.COSMO_EMAIL || !env.COSMO_PASSWORD) return Response.json({ error: 'Collection is not configured.' }, { status: 503, headers });
    const result = await runCollector(env);
    return Response.json(result, { status: result.status === 'failed' ? 502 : 200, headers });
}

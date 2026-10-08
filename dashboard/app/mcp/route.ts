import { dataMode } from '../../lib/data-mode';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../chatgpt-auth';
import { collectionRpc } from '../../lib/mcp.server';
import { runCollector } from '../../lib/collector.server';
import { readDashboard } from '../../lib/archive.server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
    // Hosted requests must pass owner-private Sites dispatch (OAuth or service access).
    // No visitor-specific data or connected apps are accessed by these shared tools.
    if (import.meta.env.DEV && !await getChatGPTUser()) return Response.json({ error: 'Sign in locally.' }, { status: 401 });
    if (dataMode(env.COSMO_DATA_MODE) === 'realtime') return Response.json({ error: 'Collection tools are disabled in realtime mode.' }, { status: 409 });
    return collectionRpc(request, async name => {
        if (name === 'collect_watch_reports') {
            const result = await runCollector(env);
            if (result.status === 'failed') throw new Error('Collection failed');
            return result;
        }
        if (!env.DB) throw new Error('Database unavailable');
        return (await readDashboard(env.DB)).collection;
    });
}

import { dashboardAuthEnabled } from './auth-config.mjs';

async function matchesSecret(actual: string, expected: string): Promise<boolean> {
    const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    const [a, b] = await Promise.all([digest(actual), digest(expected)]);
    let difference = 0;
    for (let i = 0; i < b.length; i++) difference |= a[i] ^ b[i];
    return difference === 0;
}

// Sites keeps its platform access boundary. Containers authenticate at the Worker
// boundary before assets, page rendering, APIs, or MCP can return family data.
export async function selfhostRequest(request: Request, config: { SELF_HOSTED?: string; DASHBOARD_AUTH_ENABLED?: string; COSMO_COLLECTOR_TOKEN?: string; DASHBOARD_USERNAME?: string; DASHBOARD_PASSWORD?: string }): Promise<Request | Response> {
    if (config.SELF_HOSTED !== 'true') return request;
    const headers = new Headers(request.headers);
    for (const name of Array.from(headers.keys())) if (name.startsWith('oai-')) headers.delete(name);
    if (!dashboardAuthEnabled(config.DASHBOARD_AUTH_ENABLED)) {
        // Disabling visitor login opens pages and read APIs. Collection still
        // requires an internal runtime token, including for MCP calls.
        if (!['GET', 'HEAD'].includes(request.method)) {
            if (!config.COSMO_COLLECTOR_TOKEN || !await matchesSecret(request.headers.get('x-cosmo-collector-token') ?? '', config.COSMO_COLLECTOR_TOKEN)) {
                return new Response('Collector authentication required.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
            }
        }
        headers.delete('x-cosmo-collector-token');
        return new Request(request, { headers });
    }
    if (!config.DASHBOARD_USERNAME || !config.DASHBOARD_PASSWORD) return new Response('Dashboard access is not configured.', { status: 503 });
    const expected = 'Basic ' + btoa(`${config.DASHBOARD_USERNAME}:${config.DASHBOARD_PASSWORD}`);
    if (!await matchesSecret(request.headers.get('Authorization') ?? '', expected)) return new Response('Sign in to your family dashboard.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="COSMO family", charset="UTF-8"', 'Cache-Control': 'no-store' } });
    headers.set('oai-authenticated-user-id', 'selfhost-owner');
    headers.set('oai-authenticated-user-email', 'owner@localhost');
    return new Request(request, { headers });
}

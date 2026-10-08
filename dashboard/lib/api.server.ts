import type { DashboardData } from './types.ts';
export async function dashboardResponse(authenticated: boolean, load: () => Promise<DashboardData>): Promise<Response> {
    const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json', 'Vary': 'Cookie, oai-authenticated-user-id' };
    if (!authenticated) return Response.json({ error: 'Sign in to view your family dashboard.' }, { status: 401, headers });
    try { return Response.json(await load(), { headers }); }
    catch (error) {
        const category = error instanceof Error && ['Connection not configured', 'Sign-in failed', 'Unsupported response', 'Access denied'].includes(error.message) ? error.message : error instanceof Error ? error.name : 'Unknown';
        console.warn('Dashboard connection:', category);
        return Response.json({ error: 'We could not connect to your watches. Please try again.' }, { status: 502, headers });
    }
}

import { getChatGPTUser } from '../../chatgpt-auth';
import { dashboardResponse } from '../../../lib/api.server';
import { loadDashboard } from '../../../lib/dashboard-loader.server';
import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
export async function GET() {
    const user = await getChatGPTUser();
    return dashboardResponse(!!user, async () => {
        return loadDashboard(env);
    });
}

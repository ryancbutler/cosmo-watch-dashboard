import { env } from 'cloudflare:workers';
import { dataMode } from '../lib/data-mode';
import { dashboardAuthEnabled } from '../lib/auth-config.mjs';
import { requireChatGPTUser } from './chatgpt-auth';
import Dashboard from './dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
    await requireChatGPTUser('/');
    return <Dashboard mode={dataMode(env.COSMO_DATA_MODE)} authEnabled={dashboardAuthEnabled(env.DASHBOARD_AUTH_ENABLED)} />;
}

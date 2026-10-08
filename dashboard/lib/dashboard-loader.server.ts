import { dataMode } from './data-mode.ts';
import { readDashboard } from './archive.server.ts';
import { FilipClient, fetchRealtimeDashboard } from './filip.server.ts';

export async function loadDashboard(config: { COSMO_DATA_MODE?: string; COSMO_EMAIL?: string; COSMO_PASSWORD?: string; DB?: D1Database }) {
    const mode = dataMode(config.COSMO_DATA_MODE);
    if (mode === 'history') {
        if (!config.DB) throw new Error('Database unavailable');
        return { ...await readDashboard(config.DB), dataMode: mode };
    }
    if (!config.COSMO_EMAIL || !config.COSMO_PASSWORD) throw new Error('Connection not configured');
    const client = new FilipClient(config.COSMO_EMAIL, config.COSMO_PASSWORD, (...args) => fetch(...args), AbortSignal.timeout(120_000));
    return { ...await fetchRealtimeDashboard(client), dataMode: mode };
}

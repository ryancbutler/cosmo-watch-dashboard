import { dataMode } from './data-mode.ts';
import { collectArchive } from './archive.server.ts';
import { FilipClient, fetchCollection } from './filip.server.ts';

export async function runCollector(config: { COSMO_DATA_MODE?: string; DB?: D1Database; COSMO_EMAIL?: string; COSMO_PASSWORD?: string }) {
    if (dataMode(config.COSMO_DATA_MODE) === 'realtime') throw new Error('Collection disabled');
    if (!config.DB || !config.COSMO_EMAIL || !config.COSMO_PASSWORD) throw new Error('Collection is not configured.');
    const client = new FilipClient(config.COSMO_EMAIL, config.COSMO_PASSWORD, (...args) => fetch(...args), AbortSignal.timeout(120_000));
    return collectArchive(config.DB, () => fetchCollection(client));
}

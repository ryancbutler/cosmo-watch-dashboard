export type DataMode = 'history' | 'realtime';

export function dataMode(value?: string): DataMode {
    if (!value || value === 'history') return 'history';
    if (value === 'realtime') return 'realtime';
    throw new Error('COSMO_DATA_MODE must be history or realtime.');
}

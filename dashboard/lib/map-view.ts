import type { Watch } from './types';

export function selectedMapPosition(watches: Watch[], selected: string | null): string | null {
    const location = watches.find(watch => watch.id === selected)?.location;
    return location ? `${location.latitude},${location.longitude}` : null;
}

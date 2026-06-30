import { useEffect, useState } from 'react';
import { getRelayStatus, probeRelays, subscribeRelayStatus } from './nostr';

export type RelayConnectionStatus = 'checking' | 'connected' | 'error';

export interface RelayInfo {
    url: string;
    status: RelayConnectionStatus;
}

export interface RelayStatusResult {
    relays: RelayInfo[];
    /** True once every relay has been checked (no longer 'checking'). */
    allChecked: boolean;
    /** True if at least one relay responded successfully. */
    anyConnected: boolean;
}

export function aggregateRelayStatus(result: RelayStatusResult): 'checking' | 'connected' | 'partial' | 'offline' {
    if (!result.allChecked) return 'checking';
    if (!result.anyConnected) return 'offline';
    return result.relays.some((r) => r.status === 'error') ? 'partial' : 'connected';
}

/**
 * Subscribes to the shared relay status updated by every nostr operation.
 * Triggers a lightweight probe on mount to populate initial status.
 * Multiple instances share the same underlying state — no duplicate probing.
 */
export function useRelayStatus(): RelayStatusResult {
    const [relays, setRelays] = useState<RelayInfo[]>(() => getRelayStatus());

    useEffect(() => {
        const unsub = subscribeRelayStatus(() => setRelays(getRelayStatus()));
        probeRelays(); // fire-and-forget; deduped in nostr.ts
        return unsub;
    }, []);

    const allChecked = relays.every((r) => r.status !== 'checking');
    const anyConnected = relays.some((r) => r.status === 'connected');
    return { relays, allChecked, anyConnected };
}

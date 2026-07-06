import { useSyncExternalStore } from 'react';
import { getFetchStatus, subscribeFetchStatus } from './nostr';
import { RelayStatusResult } from './useRelayStatus';

/**
 * Subscribes to the live per-relay progress of whichever `fanGet` call is currently in flight
 * (e.g. opening a plan) — distinct from {@link useRelayStatus}, which reflects general relay
 * connectivity rather than a specific fetch's progress.
 *
 * `fanGet` kicks off (and resets fetch status) synchronously from a render — e.g. `use()`d inside
 * `useSceneFromUrl` — so this uses `useSyncExternalStore` rather than `useState`+`useEffect`,
 * which would risk a "setState while rendering a different component" warning.
 */
export function useFetchStatus(): RelayStatusResult {
    const relays = useSyncExternalStore(subscribeFetchStatus, getFetchStatus);

    const allChecked = relays.every((r) => r.status !== 'checking');
    const anyConnected = relays.some((r) => r.status === 'connected');
    return { relays, allChecked, anyConnected };
}

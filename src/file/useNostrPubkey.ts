import { useEffect, useState } from 'react';
import { getCachedPubkey, refreshNostrPubkey, subscribePubkey } from './nostr';

/**
 * Subscribes to the shared signing pubkey. Multiple instances share the same underlying state,
 * so importing or generating a new key updates every consumer in place — no page reload needed.
 * Returns undefined until the key has been read from IDB at least once.
 */
export function useNostrPubkey(): string | undefined {
    const [pubkey, setPubkey] = useState<string | undefined>(getCachedPubkey);

    useEffect(() => {
        const unsub = subscribePubkey(() => setPubkey(getCachedPubkey()));
        if (getCachedPubkey() === undefined) refreshNostrPubkey();
        return unsub;
    }, []);

    return pubkey;
}

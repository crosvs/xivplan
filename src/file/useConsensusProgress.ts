import { useSyncExternalStore } from 'react';
import {
    ConsensusProgress,
    getConsensusProgress,
    getPublishProgress,
    subscribeConsensusProgress,
    subscribePublishProgress,
} from './nostr';

/**
 * Subscribes to the live consensus progress of whichever `fanGet` call is currently in flight —
 * how many relays agree on the leading candidate so far, out of how many are required.
 */
export function useConsensusProgress(): ConsensusProgress {
    return useSyncExternalStore(subscribeConsensusProgress, getConsensusProgress);
}

/**
 * Subscribes to the live progress of whichever `publishEventPair` call is currently in flight —
 * how many relays have confirmed the write so far, out of how many are required.
 */
export function usePublishProgress(): ConsensusProgress {
    return useSyncExternalStore(subscribePublishProgress, getPublishProgress);
}

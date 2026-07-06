import { RelayHealth } from './nostr';

/** Generic connectivity wording — default for contexts with no more specific meaning (e.g. general relay health). */
export const CONNECTIVITY_STATUS_LABELS: Record<RelayHealth, string> = {
    connected: 'connected',
    error: 'unreachable',
    checking: 'checking…',
    skipped: 'not needed',
    stale: 'outdated version',
    incomplete: 'incomplete data',
};

/** Wording for {@link CircularRelayIndicator}'s tooltip and{@link RelayFetchList}'s rows during a fetch. */
export const FETCH_STATUS_LABELS: Record<RelayHealth, string> = {
    connected: 'responded',
    error: 'failed',
    checking: 'waiting…',
    skipped: 'not needed',
    stale: 'outdated version',
    incomplete: 'incomplete data',
};

/** Wording for {@link CircularRelayIndicator}'s tooltip and{@link RelayPublishList}'s rows during a publish. */
export const PUBLISH_STATUS_LABELS: Record<RelayHealth, string> = {
    connected: 'saved',
    error: 'failed',
    checking: 'pending…',
    skipped: 'too large',
    stale: 'outdated version',
    incomplete: 'incomplete data',
};

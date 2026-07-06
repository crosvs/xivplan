/**
 * Nostr plan storage — two-event architecture.
 *
 * Each plan is stored as a pair of NIP-78 parameterized replaceable events:
 *   - Index (kind 30078): lightweight metadata + reference to the data event.
 *     Vault queries only fetch this kind, keeping list operations fast.
 *   - Data (kind 30079): full plan content (plaintext or NIP-44 encrypted).
 *     Only fetched when opening a specific plan.
 *
 * Same pubkey + d-tag + kind = always the latest version (replaceable).
 * Keys are stored in IDB (via localforage), never exposed beyond the browser.
 */

import localforage from 'localforage';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, verifyEvent } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { AbstractSimplePool } from 'nostr-tools/pool';
import { jsonToScene, sceneToJson } from '../file';
import type { NostrFileSource } from '../SceneProvider';
import type { Scene } from '../scene';

export const NOSTR_RELAYS = [
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nostr.mom',
];

/**
 * Number of relays that must agree on the same event (with no higher-`created_at` challenger)
 * before {@link fanGet} stops waiting on stragglers. A strict majority means a plan is only ever
 * treated as "properly" saved/read once more relays hold that version than don't — anything short
 * of that leaves room for a stale-relay minority to look like consensus.
 */
export function consensusThreshold(relayCount: number): number {
    return Math.floor(relayCount / 2) + 1;
}

/** Kind for index events — metadata and pointer to the data event. */
export const PLAN_KIND = 30078;

/** Kind for data events — full plan content. Separate kind keeps vault queries index-only. */
export const PLAN_DATA_KIND = 30079;

/** Incremented when the event structure changes in a backwards-incompatible way. */
export const XIVPLAN_FORMAT_VERSION = 1;

/**
 * Per-relay timeout for read operations (ms). Also the pool's `maxWaitForConnection` budget (see
 * `_pool` below) — every other relay-facing timeout in this file derives from this one constant so
 * they can't drift out of sync with each other the way the hardcoded values here once did.
 */
const RELAY_TIMEOUT_MS = 5000;

/**
 * Extra time {@link fanGet} (for reads) and the publish race (for writes) wait beyond
 * RELAY_TIMEOUT_MS before giving up. RELAY_TIMEOUT_MS is also the pool's `maxWaitForConnection`
 * budget, so a relay that takes the full RELAY_TIMEOUT_MS just to open its WebSocket would
 * otherwise have no time left to actually answer — this grace period is what's left over for the
 * query/response (or the publish OK) after a maximal-length connection.
 */
const QUERY_GRACE_MS = 2000;

/** Outer race timeout for a single relay's publish attempt — see {@link QUERY_GRACE_MS}. */
const PUBLISH_TIMEOUT_MS = RELAY_TIMEOUT_MS + QUERY_GRACE_MS;

// Single long-lived pool — connections are reused across operations.
// Built on AbstractSimplePool rather than SimplePool because SimplePool's constructor type
// only exposes enablePing/enableReconnect — it hardcodes maxWaitForConnection to 3000ms, which
// (once a per-call `maxWait` exceeds it) derives the actual connection timeout as
// max(maxWait * 0.8, maxWait - 1000). For our 6000ms maxWait that silently caps the WebSocket
// handshake at 5000ms. Passing maxWaitForConnection explicitly keeps the full RELAY_TIMEOUT_MS
// budget available for slow-to-connect relays.
const _pool = new AbstractSimplePool({
    verifyEvent,
    maxWaitForConnection: RELAY_TIMEOUT_MS,
    onRelayConnectionSuccess: (url) => _setHealth(url, 'connected'),
    onRelayConnectionFailure: (url) => _setHealth(url, 'error'),
});

// ── Shared relay status ───────────────────────────────────────────────────────

export type RelayHealth = 'checking' | 'connected' | 'skipped' | 'stale' | 'incomplete' | 'error';

const _health = new Map<string, RelayHealth>(NOSTR_RELAYS.map((url) => [url, 'checking']));
const _listeners = new Set<() => void>();

// Cached snapshot array — getRelayStatus() feeds React's useSyncExternalStore, which requires a
// stable (Object.is-equal) reference between calls unless the store actually changed. Some
// updates (e.g. the pool's onRelayConnectionSuccess/Failure hooks) can fire synchronously from
// deep inside another component's render, so relying on useState+useEffect here would risk a
// "setState while rendering a different component" warning; useSyncExternalStore is the pattern
// React provides specifically for stores that may mutate outside of React's own render cycle.
let _healthSnapshot: Array<{ url: string; status: RelayHealth }> | null = null;

function _setHealth(url: string, h: RelayHealth): void {
    if (_health.get(url) === h) return;
    _health.set(url, h);
    _healthSnapshot = null;
    for (const fn of _listeners) fn();
}

export function subscribeRelayStatus(fn: () => void): () => void {
    _listeners.add(fn);
    return () => {
        _listeners.delete(fn);
    };
}

export function getRelayStatus(): Array<{ url: string; status: RelayHealth }> {
    _healthSnapshot ??= NOSTR_RELAYS.map((url) => ({ url, status: _health.get(url) ?? 'checking' }));
    return _healthSnapshot;
}

// ── Live fetch status ────────────────────────────────────────────────────────
// Tracks the in-progress `fanGet` call, if any — distinct from `_health` above, which reflects
// general relay connectivity rather than "did this specific fetch hear back from this relay".
// Reset at the start of each fanGet call, so only the most recent fetch's progress is visible.

const _fetchStatus = new Map<string, RelayHealth>();
const _fetchListeners = new Set<() => void>();
let _fetchSnapshot: Array<{ url: string; status: RelayHealth }> | null = null;

// Bumped by every UI-tracked fanGet call on start, so an older call whose fetch is still running
// can tell it's no longer the latest and stop writing to the shared stores above — otherwise two
// concurrent tracked fetches (e.g. opening a second plan before the first resolves) would each
// think they own `_fetchStatus`/`_fetchProgress` and stomp each other's display.
let _fetchGeneration = 0;

function _resetFetchStatus(relays: string[]): void {
    _fetchStatus.clear();
    for (const relay of relays) _fetchStatus.set(relay, 'checking');
    _fetchSnapshot = null;
    for (const fn of _fetchListeners) fn();
}

function _setFetchStatus(relay: string, status: RelayHealth): void {
    _fetchStatus.set(relay, status);
    _fetchSnapshot = null;
    for (const fn of _fetchListeners) fn();
}

export function subscribeFetchStatus(fn: () => void): () => void {
    _fetchListeners.add(fn);
    return () => {
        _fetchListeners.delete(fn);
    };
}

export function getFetchStatus(): Array<{ url: string; status: RelayHealth }> {
    _fetchSnapshot ??= NOSTR_RELAYS.map((url) => ({ url, status: _fetchStatus.get(url) ?? 'checking' }));
    return _fetchSnapshot;
}

// ── Live consensus progress ──────────────────────────────────────────────────
// A staged view of an in-progress fetch or publish: how many relays currently agree/confirmed,
// out of how many are needed. `createProgressStore` is shared between the two — a fetch (fanGet)
// and a publish (publishEventPair) are both "wait for enough relays to agree" operations, just
// with a different source of truth for what counts as agreement.

export interface ConsensusProgress {
    /** Relays currently agreeing/confirmed so far. */
    agreeing: number;
    /** Relays required to treat this as settled. */
    threshold: number;
    /** Total relays queried. */
    total: number;
    status: 'pending' | 'reached' | 'short';
}

function createProgressStore() {
    let progress: ConsensusProgress = { agreeing: 0, threshold: 0, total: 0, status: 'pending' };
    const listeners = new Set<() => void>();

    function notify(): void {
        for (const fn of listeners) fn();
    }

    return {
        reset(total: number, threshold: number): void {
            progress = { agreeing: 0, threshold, total, status: 'pending' };
            notify();
        },
        update(agreeing: number): void {
            if (progress.status !== 'pending' || agreeing <= progress.agreeing) return;
            progress = { ...progress, agreeing };
            notify();
        },
        finish(outcome: 'reached' | 'short', agreeing: number): void {
            progress = { ...progress, agreeing, status: outcome };
            notify();
        },
        subscribe(fn: () => void): () => void {
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
            };
        },
        get(): ConsensusProgress {
            return progress;
        },
    };
}

const _fetchProgress = createProgressStore();
export const subscribeConsensusProgress = _fetchProgress.subscribe;
export const getConsensusProgress = _fetchProgress.get;

const _publishProgress = createProgressStore();
export const subscribePublishProgress = _publishProgress.subscribe;
export const getPublishProgress = _publishProgress.get;

// ── Relay size limits (NIP-11) ─────────────────────────────────────────────────
// Relays advertise a max message size via their NIP-11 info document. Checking it before
// publishing lets us skip a relay we already know will reject the event on size, instead of
// spending a full publish round-trip just to get an `OK false "invalid: event too large"` back.
// That NIP-11 figure is only a hint, though — nos.lol/nostr.mom have both been observed rejecting
// events well under their advertised max_message_length, so `learnSizeLimitFromRejection` tightens
// a relay's cached limit from real rejections as they happen, on top of whatever NIP-11 claims.

interface RelayLimits {
    /** Max size, in bytes, of a full `["EVENT", {...}]` wire message. Undefined if unknown. */
    maxMessageLength?: number;
}

const _relayLimitsCache = new Map<string, RelayLimits>();

function relayInfoUrl(relay: string): string {
    return relay.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

async function fetchRelayLimits(relay: string): Promise<RelayLimits> {
    const cached = _relayLimitsCache.get(relay);
    if (cached) return cached;
    let limits: RelayLimits = {};
    try {
        const res = await fetch(relayInfoUrl(relay), {
            headers: { Accept: 'application/nostr+json' },
            signal: AbortSignal.timeout(2500),
        });
        const info = await res.json();
        if (typeof info?.limitation?.max_message_length === 'number') {
            limits = { maxMessageLength: info.limitation.max_message_length };
        }
    } catch {
        // No NIP-11 info available — leave unset. We simply won't be able to skip this relay
        // proactively; it still gets a normal publish/fetch attempt like any other.
    }
    _relayLimitsCache.set(relay, limits);
    return limits;
}

/**
 * Cache-only lookup — never triggers a network request. Publish/fetch's size-based skip must
 * never block the hot path on a fresh NIP-11 round-trip (a relay that's slow or unreachable for
 * *that* would defeat the entire point of skipping it quickly); it only benefits from limits
 * `probeRelays()` has already warmed in the background. Unknown relays just don't get skipped.
 */
function peekRelayLimits(relay: string): RelayLimits {
    return _relayLimitsCache.get(relay) ?? {};
}

/** The exact bytes a relay receives for this event — matches nostr-tools' own `publish()` framing. */
function wireEventSize(event: NostrEvent): number {
    return new TextEncoder().encode('["EVENT",' + JSON.stringify(event) + ']').length;
}

/** Matches a NIP-01 `OK false <reason>` reason that rejects an event specifically for its size. */
const SIZE_REJECTION_PATTERN = /too large|too big|max.{0,20}(size|length)|size.{0,20}(exceed|limit)/i;

/**
 * A relay's advertised NIP-11 `max_message_length` is only ever a hint — some relays enforce a
 * tighter limit in practice than the one they publish (or publish none at all). When a publish is
 * rejected with a size-related reason, tighten this relay's cached limit to just below the size we
 * know it just refused, so later publish/fetch calls skip it instead of repeating a doomed attempt.
 */
function learnSizeLimitFromRejection(relay: string, event: NostrEvent, reason: string): void {
    if (!SIZE_REJECTION_PATTERN.test(reason)) return;
    const learned = wireEventSize(event) - 1;
    const existing = _relayLimitsCache.get(relay)?.maxMessageLength;
    if (existing === undefined || learned < existing) {
        _relayLimitsCache.set(relay, { maxMessageLength: learned });
    }
}

// ── Data-event chunking ─────────────────────────────────────────────────────────
// A relay that rejects a plan's data event for being too large will often still accept the exact
// same bytes split across several smaller NIP-33 events ("chunks") — this is purely a per-relay,
// reactive fallback (try the whole event first; only chunk for a relay that actually rejects it),
// never a deliberate data-distribution strategy. Chunk 1 of N reuses the plan's ordinary `d`-tag
// (planId) — the same slot the unchunked event always used; chunks 2..N use `${planId}:${i}`. These
// d-tags are *reused* across publish generations (ordinary NIP-33 overwrite-latest-created_at
// semantics), not versioned — this is safe because every consumer of a non-primary chunk must
// reject it unless its `created_at` exactly matches the already-established winning primary
// event's `created_at`. A relay caught mid-publish (some chunks updated, some still old) then just
// looks like "doesn't have a valid matching chunk yet," never a silent old+new splice, and shrinking
// chunk counts is safe for free since old high-index chunks are simply never queried once the
// current version's primary slot declares a smaller N.

/** Hard cap on the publish retry ladder (2 → 4 → 8 → 16 chunks). Beyond this, a relay is treated as
 *  permanently unable to hold this plan, the same terminal state as today's pre-chunking exclusion. */
const MAX_CHUNKS = 16;

/**
 * Splits a string into `n` roughly-equal pieces by character index. Each piece is independently
 * signed and UTF-8-encoded for the wire, so a boundary landing between the two UTF-16 code units of
 * a surrogate pair (any character outside the Basic Multilingual Plane — most emoji, some CJK) would
 * leave each half holding an unpaired surrogate; standard UTF-8 encoders replace those with U+FFFD
 * independently on each side, before the pieces are ever rejoined — silent, unrecoverable data loss
 * that {@link joinChunks} could never undo. Nudging the boundary back by one code unit when it would
 * split a pair avoids this; pieces are only ever concatenated back in order, never parsed
 * individually, so an unevenly-sized piece here has no other effect.
 */
function splitIntoChunks(content: string, n: number): string[] {
    const size = Math.ceil(content.length / n);
    const pieces: string[] = [];
    let start = 0;
    for (let i = 0; i < n; i++) {
        let end = i === n - 1 ? content.length : Math.min(content.length, start + size);
        const endsMidSurrogatePair =
            end > start + 1 &&
            end < content.length &&
            content.charCodeAt(end - 1) >= 0xd800 &&
            content.charCodeAt(end - 1) <= 0xdbff &&
            content.charCodeAt(end) >= 0xdc00 &&
            content.charCodeAt(end) <= 0xdfff;
        if (endsMidSurrogatePair) end -= 1;
        pieces.push(content.slice(start, end));
        start = end;
    }
    return pieces;
}

/** Inverse of {@link splitIntoChunks} — trivial concatenation in order. */
function joinChunks(pieces: string[]): string {
    return pieces.join('');
}

/** Reads a data event's declared chunk count. A missing `chunk` tag (all data published before this
 *  feature existed) implies '1/1' — the ordinary unchunked case. */
function chunkCountOf(event: NostrEvent): number {
    const tag = event.tags.find((t) => t[0] === 'chunk')?.[1];
    const n = tag ? Number(tag.split('/')[1]) : 1;
    return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * A short random per-publish tag, carried on every chunk of one publish (including the whole-event
 * case) as `['gen', ...]`. `created_at` alone has only 1-second resolution, so two publishes that
 * land within the same second (a rapid rename right after a save, or just an automated test with no
 * artificial delay) would otherwise be indistinguishable as "versions" once fetches group relay
 * responses by created_at rather than event id — this tag is what keeps those genuinely different
 * publishes from being merged into one group. A missing `gen` tag (any data published before this
 * existed) has no such protection from `genOf` alone — callers doing version-grouping must fall back
 * to the event's own id in that case (see the groupKey in `fetchPlanData`), which exactly restores
 * the old id-based separation for legacy data instead of merging same-second legacy events together.
 */
function randomNonce(): string {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

/** Reads a data event's `gen` tag (see {@link randomNonce}) — `''` if absent (legacy, pre-chunking
 *  data, or the index event, which never carries one). Callers that need a collision-safe version
 *  key must not use this value alone when it's empty — see the doc comment above. */
function genOf(event: NostrEvent): string {
    return event.tags.find((t) => t[0] === 'gen')?.[1] ?? '';
}

/** Smallest power of 2 that is `>= n`. */
function nextPow2(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

/**
 * Starting chunk count for a relay's *first* chunked attempt (never for the always-first whole-event
 * try). Uses this relay's cached size limit, if any, to jump straight to a plausible N instead of
 * always restarting the ladder at 2 — the same cache `learnSizeLimitFromRejection` populates, just
 * repurposed from "exclude this relay" to "guess a good starting chunk count."
 */
function startingChunkCount(dataSize: number, cachedLimit: number | undefined): number {
    if (cachedLimit === undefined) return 2;
    return Math.min(MAX_CHUNKS, Math.max(2, nextPow2(Math.ceil(dataSize / cachedLimit))));
}

/**
 * Builds `n` signed PLAN_DATA_KIND events for one relay's attempt — `n=1` is just the ordinary
 * whole-event case. `sharedTags` (name/v/comp?/enc?) live only on chunk 1; chunks 2..N carry only
 * `d`/`chunk`/`gen`, since nothing ever reads metadata off a non-primary chunk and duplicating it
 * would waste exactly the bytes this feature exists to save. Every piece carries the same `gen`
 * (see {@link randomNonce}) — that's what lets a fetch recognize them as the same publish.
 */
function buildChunkSet(
    sk: Uint8Array,
    planId: string,
    createdAt: number,
    gen: string,
    sharedTags: string[][],
    content: string,
    n: number,
): NostrEvent[] {
    const pieces = n === 1 ? [content] : splitIntoChunks(content, n);
    return pieces.map((piece, index) => {
        const i = index + 1;
        const tags: string[][] = i === 1 ? [['d', planId], ...sharedTags] : [['d', `${planId}:${i}`]];
        tags.push(['chunk', `${i}/${n}`], ['gen', gen]);
        return finalizeEvent({ kind: PLAN_DATA_KIND, created_at: createdAt, tags, content: piece }, sk);
    });
}

/** The whole (unchunked) attempt is always exactly one event — a thin wrapper around
 *  {@link buildChunkSet} so callers don't need a non-null assertion on the always-length-1 result. */
function buildWholeEvent(
    sk: Uint8Array,
    planId: string,
    createdAt: number,
    gen: string,
    sharedTags: string[][],
    content: string,
): NostrEvent {
    const [wholeEvent] = buildChunkSet(sk, planId, createdAt, gen, sharedTags, content, 1);
    if (!wholeEvent) throw new Error('unreachable: buildChunkSet(n=1) always returns exactly one event');
    return wholeEvent;
}

let _probing = false;
let _lastProbeTime = 0;
const PROBE_COOLDOWN_MS = 5 * 60 * 1000;

export async function probeRelays(): Promise<void> {
    const now = Date.now();
    if (_probing || now - _lastProbeTime < PROBE_COOLDOWN_MS) return;
    _probing = true;
    _lastProbeTime = now;
    const futureTs = Math.floor(now / 1000) + 365 * 24 * 3600;
    try {
        await Promise.allSettled(
            NOSTR_RELAYS.map(async (relay) => {
                try {
                    await _pool.get([relay], { kinds: [PLAN_KIND], since: futureTs }, { maxWait: RELAY_TIMEOUT_MS });
                    _setHealth(relay, 'connected');
                } catch {
                    _setHealth(relay, 'error');
                }
                // Fire-and-forget — warms the limits cache so a later publish doesn't have to wait
                // on NIP-11 round-trips before it can even start.
                void fetchRelayLimits(relay);
            }),
        );
    } finally {
        _probing = false;
    }
}

// ── IDB storage ───────────────────────────────────────────────────────────────

const nostrStore = localforage.createInstance({ name: 'XIVPlan', storeName: 'nostr' });

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

// ── Compression ───────────────────────────────────────────────────────────────
// Some public relays silently drop events over a size limit well under what a complex plan's
// JSON serializes to (confirmed: nos.lol and nostr.mom close the connection with no error message
// for a ~390KB event, while relay.damus.io/relay.primal.net accept it fine). Gzipping the JSON
// before it goes into `content` buys real headroom for repetitive plan data without touching the
// event/consensus model at all.

/** Compression Streams API support (Chrome/Edge 80+, Firefox 113+, Safari 16.4+). */
function supportsCompression(): boolean {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function gzipCompress(text: string): Promise<Uint8Array> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzipDecompress(bytes: Uint8Array): Promise<string> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

/**
 * Gzips `json` and base64url-encodes it for storage in an event's `content`, but only when that's
 * actually smaller — gzip's framing overhead can make already-tiny plans larger, not smaller.
 * Falls back to the plain JSON (uncompressed) on unsupported browsers or any compression failure.
 */
async function compressForStorage(json: string): Promise<{ content: string; compressed: boolean }> {
    if (!supportsCompression()) return { content: json, compressed: false };
    try {
        const gzipped = bytesToBase64Url(await gzipCompress(json));
        return gzipped.length < json.length
            ? { content: gzipped, compressed: true }
            : { content: json, compressed: false };
    } catch {
        return { content: json, compressed: false };
    }
}

/** Random 8-byte plan id (16 hex chars) — used as the Nostr d-tag. Unique enough within one author's namespace. */
function randomPlanId(): string {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

export async function getOrCreateSecretKey(): Promise<Uint8Array> {
    const stored = await nostrStore.getItem<string>('sk');
    if (stored) return hexToBytes(stored);
    const sk = generateSecretKey();
    await nostrStore.setItem('sk', bytesToHex(sk));
    return sk;
}

export async function getNostrPubkey(): Promise<string> {
    return getPublicKey(await getOrCreateSecretKey());
}

export async function hasStoredKey(): Promise<boolean> {
    return (await nostrStore.getItem<string>('sk')) !== null;
}

// ── Reactive pubkey ─────────────────────────────────────────────────────────────
// Lets the UI update in place when the signing key changes (import/generate) instead of
// requiring a full page reload — components subscribe here instead of fetching once on mount.

let _cachedPubkey: string | undefined;
const _pubkeyListeners = new Set<() => void>();

export function subscribePubkey(fn: () => void): () => void {
    _pubkeyListeners.add(fn);
    return () => {
        _pubkeyListeners.delete(fn);
    };
}

export function getCachedPubkey(): string | undefined {
    return _cachedPubkey;
}

/** (Re-)fetches the pubkey and broadcasts it to subscribers. Safe to call anytime — the initial
 *  fetch on mount and post key-switch refreshes both go through here. */
export async function refreshNostrPubkey(): Promise<string> {
    _cachedPubkey = await getNostrPubkey();
    for (const fn of _pubkeyListeners) fn();
    return _cachedPubkey;
}

/** Replaces the stored key with a freshly generated one. Irreversible — export first. */
export async function generateNewKey(): Promise<void> {
    const sk = generateSecretKey();
    await nostrStore.setItem('sk', bytesToHex(sk));
    await refreshNostrPubkey();
    // A retry against stashed publish state signed under the old key would republish a data event
    // under the new key while the already-published index event stays signed by the old one —
    // ending any in-flight publish session's retry option is this function's job, not retryRelay's.
    _lastPublishedPlan = null;
}

/** Accepts a 64-char hex private key (contents of the exported .txt file). */
export async function importSecretKey(text: string): Promise<void> {
    const hex = text.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) {
        throw new Error('Invalid key: expected 64 hex characters.');
    }
    await nostrStore.setItem('sk', hex);
    await refreshNostrPubkey();
    _lastPublishedPlan = null;
}

/** Returns a Blob containing the hex private key, suitable for saving as .txt. */
export async function exportSecretKeyBlob(): Promise<Blob> {
    const sk = await getOrCreateSecretKey();
    return new Blob([bytesToHex(sk)], { type: 'text/plain' });
}

// ── Encoding helpers ──────────────────────────────────────────────────────────

export function pubkeyToNpub(pubkey: string): string {
    return nip19.npubEncode(pubkey);
}

/** Decodes a bare base64url pubkey token (the format used in share URLs) back to hex. */
function decodePubkeyToken(token: string): string | undefined {
    try {
        const bytes = base64UrlToBytes(token);
        return bytes.length === 32 ? bytesToHex(bytes) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Accepts anything a user might reasonably paste when asked for an author: an npub, a raw hex
 * pubkey, just the pubkey segment copied out of a share URL, or the whole share URL/link.
 */
export function parseInputPubkey(input: string): string {
    input = input.trim();

    const hashIdx = input.indexOf('#/nostr/');
    if (hashIdx !== -1) {
        const rest = input.slice(hashIdx + '#/nostr/'.length);
        const slash = rest.indexOf('/');
        const pubSegment = slash > 0 ? rest.slice(0, slash) : rest;
        const decoded = decodePubkeyToken(pubSegment);
        if (decoded) return decoded;
    }

    if (input.startsWith('npub1')) {
        try {
            const decoded = nip19.decode(input);
            if (decoded.type === 'npub') return decoded.data;
        } catch {
            // fall through
        }
    }

    if (/^[0-9a-f]{64}$/i.test(input)) {
        return input.toLowerCase();
    }

    return decodePubkeyToken(input) ?? input;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

export function getNostrShareUrl(pubkey: string, id: string): string {
    const pubToken = bytesToBase64Url(hexToBytes(pubkey));
    const idToken = bytesToBase64Url(hexToBytes(id));
    return `${location.protocol}//${location.host}${location.pathname}#/nostr/${pubToken}/${idToken}`;
}

/** Decodes the two base64url URL segments back to hex pubkey/id. Returns undefined on any malformed input. */
export function decodeNostrUrlSegments(pubToken: string, idToken: string): { pubkey: string; id: string } | undefined {
    try {
        const pubkeyBytes = base64UrlToBytes(pubToken);
        const idBytes = base64UrlToBytes(idToken);
        if (pubkeyBytes.length !== 32 || idBytes.length === 0) return undefined;
        return { pubkey: bytesToHex(pubkeyBytes), id: bytesToHex(idBytes) };
    } catch {
        return undefined;
    }
}

/** Strips characters that are unsafe in a URL path segment or Nostr d-tag. Spaces are allowed. */
export function sanitizePlanName(name: string): string {
    return name.replace(/[^a-zA-Z0-9 \-_]/g, '');
}

// ── Fan-fetch helpers (parallel, deduplicated, status-tracking) ───────────────

export interface FanGetResult {
    event: NostrEvent | null;
    /** Number of relays (out of `totalRelays`) that agreed on `event`. 0 if `event` is null. */
    agreeingRelays: number;
    /** Total relays queried. */
    totalRelays: number;
    /**
     * This call's own final per-relay labels — computed regardless of `trackUiStatus`, so a caller
     * that needs to act on them (e.g. read-repair) can use data intrinsic to *this* fetch instead of
     * re-reading the shared `_fetchStatus` store, which a concurrently-running fetch for a different
     * plan could have already overwritten by the time the caller gets around to reading it.
     */
    relayStatuses: Map<string, RelayHealth>;
    /**
     * Each agreeing relay's *own* event from the winning group (not necessarily the same object as
     * `event`, though for the default id-based grouping it's always byte-identical to it). Needed
     * when `groupKey` groups by something looser than id — e.g. plan-data chunking, where relays
     * agreeing on the same version can each hold a physically different "chunk 1" event.
     */
    relayEvents: Map<string, NostrEvent>;
    /**
     * The UI-ownership generation this call captured (see `_fetchGeneration`), or -1 if
     * `trackUiStatus` was false. A caller that needs to correct a relay's status in the shared
     * `_fetchStatus` store *after* this call has already resolved (e.g. `fetchPlanData` downgrading
     * a relay to `'incomplete'` post-reconstruction) must compare this against the current
     * `_fetchGeneration` first — otherwise a stale, superseded fetch could stomp on whatever newer
     * fetch's status is now actually being displayed.
     */
    uiGeneration: number;
}

/**
 * Fetches from all relays in parallel, but stops waiting as soon as a strict majority of `relays`
 * have delivered the same event and no other relay has delivered one with a higher `created_at`
 * that would outrank it.
 *
 * Each relay gets its own `subscribeMany` call (rather than one call shared across all relays) so
 * that nostr-tools' internal dedup-by-id (`_knownIds`, scoped per call) stays isolated per relay.
 * A single relay's own subscription can't shadow another relay's genuine delivery of the same
 * event id — sharing one call across relays would let a misbehaving relay claim an id first (its
 * raw "id" field is checked before the event is parsed or verified) and silently suppress the
 * real delivery from every other relay.
 *
 * Reacting to `onevent` directly (rather than the `get()`/`querySync()` convenience wrappers)
 * matters too: those only resolve a given relay's promise once *that relay* reaches EOSE (or times
 * out), so a slow-to-EOSE relay would gate consensus-checking even after its event had already
 * arrived on the wire.
 */
async function fanGet(
    filter: Parameters<AbstractSimplePool['subscribeMany']>[1],
    relays: string[] = NOSTR_RELAYS,
    fallbackTimeoutMs: number = RELAY_TIMEOUT_MS + QUERY_GRACE_MS,
    // Lets a caller end a specific still-pending relay's subscription mid-flight (e.g. once a
    // concurrently-running lookup learns that relay can't possibly have the answer) without
    // restarting anything — the relays that already responded keep their answers, and consensus
    // is rechecked against the shrunken set. Called synchronously with the prune function before
    // this Promise otherwise settles.
    registerPruner?: (prune: (relay: string) => void) => void,
    // False for internal/auxiliary lookups that shouldn't drive the user-visible fetch-status UI
    // (e.g. the index size-hint lookup fetchPlan runs alongside its real data fetch) — without
    // this, two fanGet calls running concurrently would stomp on the same shared status/progress
    // stores, and the auxiliary one finishing first would wrongly freeze the UI as "done".
    trackUiStatus: boolean = true,
    // Identifies which events count as "the same thing" for consensus purposes. Defaults to id —
    // correct whenever every relay holding "the same version" holds byte-identical content. Plan
    // data's chunked fetch overrides this to group by created_at instead, since relays can legitimately
    // hold the same version as physically different chunk-1 events (different chunk count -> different
    // bytes -> different id) — see the "Data-event chunking" section above.
    groupKey: (event: NostrEvent) => string = (e) => e.id,
): Promise<FanGetResult> {
    // Captured once up front: this call "owns" the shared UI stores only as long as no newer
    // UI-tracked fanGet call has started since. A stale call whose fetch is still running when a
    // fresher one begins silently stops writing to `_fetchStatus`/`_fetchProgress` instead of
    // fighting the newer call for control of what the user is currently looking at.
    const myGeneration = trackUiStatus ? ++_fetchGeneration : -1;
    function uiActive(): boolean {
        return trackUiStatus && myGeneration === _fetchGeneration;
    }

    return new Promise((resolve) => {
        // Keyed by groupKey(event) — for the default id-based grouping this behaves exactly like the
        // old id-keyed maps. `events` holds one representative per group (its created_at is all that
        // ever gets compared); `relaysByKey` holds each individual relay's own event within a group,
        // since under a looser groupKey (e.g. created_at) two relays agreeing on "the same version"
        // can still be holding physically different event objects.
        const events = new Map<string, NostrEvent>();
        const relaysByKey = new Map<string, Map<string, NostrEvent>>();
        const active = new Set(relays);
        const prunedRelays = new Set<string>();
        let resolved = false;

        function threshold(): number {
            return consensusThreshold(relays.length - prunedRelays.size);
        }

        function bestSoFar(): NostrEvent | null {
            let best: NostrEvent | null = null;
            for (const event of events.values()) {
                if (!best || event.created_at > best.created_at) best = event;
            }
            return best;
        }

        // This call's own view of each relay's label, independent of `trackUiStatus`/`uiActive()` —
        // callers that need to act on the result (e.g. read-repair) key off this instead of the
        // shared, mutable `_fetchStatus` store. `best: null` means no event has arrived yet.
        function relayLabels(best: NostrEvent | null): Map<string, RelayHealth> {
            const labels = new Map<string, RelayHealth>();
            if (!best) return labels;
            const bestKey = groupKey(best);
            for (const [key, supporters] of relaysByKey) {
                const label = key === bestKey ? 'connected' : 'stale';
                for (const relay of supporters.keys()) labels.set(relay, label);
            }
            return labels;
        }

        // Once the fetch concludes, every relay still 'checking' gets a terminal status: 'skipped'
        // if we stopped listening because consensus was already reached elsewhere (not a failure),
        // or 'error' if we simply ran out of patience without ever hearing from it. Pruned relays
        // already got their own (equally non-failure) 'skipped' status when they were pruned.
        function settleStragglers(outcome: 'consensus' | 'timeout'): void {
            if (!uiActive()) return;
            for (const relay of relays) {
                if (_fetchStatus.get(relay) === 'checking') {
                    _setFetchStatus(relay, outcome === 'consensus' ? 'skipped' : 'error');
                }
            }
        }

        // A relay marked 'connected' answered with *some* matching event, but that doesn't mean
        // it's the (currently) leading one — a relay serving a stale (superseded) version still
        // delivers a real event and would otherwise look identical to one actually contributing
        // to the result. Called every time a new event arrives (not just once at the end), so the
        // live tooltip never shows "4/5 responded" while quietly meaning "only 2 of those 4 agree
        // with each other" — relays get relabeled the moment a newer competing event outranks
        // theirs, same rule `bestSoFar()`/the timeout fallback would use if it resolved right now.
        function updateRelayLabels(): void {
            if (!uiActive()) return;
            for (const [relay, label] of relayLabels(bestSoFar())) _setFetchStatus(relay, label);
        }

        function finish(best: NostrEvent | null, agreeingRelays: number, outcome: 'consensus' | 'timeout'): void {
            if (resolved) return;
            resolved = true;
            clearTimeout(fallbackHandle);
            settleStragglers(outcome);
            updateRelayLabels();
            if (uiActive()) _fetchProgress.finish(outcome === 'consensus' ? 'reached' : 'short', agreeingRelays);
            resolve({
                event: best,
                agreeingRelays,
                totalRelays: relays.length - prunedRelays.size,
                relayStatuses: relayLabels(best),
                relayEvents: best ? (relaysByKey.get(groupKey(best)) ?? new Map()) : new Map(),
                uiGeneration: myGeneration,
            });
            for (const closer of closers.values()) closer.close('fanGet: resolved');
        }

        function checkConsensus(): void {
            if (resolved) return;
            updateRelayLabels();
            const currentThreshold = threshold();
            let bestAgreement = 0;
            for (const [key, event] of events) {
                const agreeingRelays = relaysByKey.get(key)?.size ?? 0;
                bestAgreement = Math.max(bestAgreement, agreeingRelays);
                if (agreeingRelays < currentThreshold) continue;
                const challenged = [...events.values()].some(
                    (other) => groupKey(other) !== key && other.created_at > event.created_at,
                );
                if (!challenged) {
                    finish(event, agreeingRelays, 'consensus');
                    return;
                }
            }
            if (uiActive()) _fetchProgress.update(bestAgreement);
            // Pruning can shrink `active` to nothing without ever reaching consensus (e.g. every
            // remaining relay turned out too small) — nothing else will ever call finish() in that
            // case, so resolve now with whatever's on hand instead of waiting out the full timeout.
            if (active.size === 0) {
                finish(bestSoFar(), bestAgreement, 'timeout');
            }
        }

        function pruneRelay(relay: string): void {
            if (resolved || !active.has(relay)) return;
            active.delete(relay);
            prunedRelays.add(relay);
            if (uiActive() && _fetchStatus.get(relay) === 'checking') _setFetchStatus(relay, 'skipped');
            closers.get(relay)?.close('fanGet: pruned');
            checkConsensus();
        }

        registerPruner?.(pruneRelay);

        // No consensus reached — fall back to whatever the best response was once every relay
        // has had its full connect+query budget (mirrors the previous wait-for-all behavior).
        const fallbackHandle = setTimeout(() => {
            const best = bestSoFar();
            finish(best, best ? (relaysByKey.get(groupKey(best))?.size ?? 0) : 0, 'timeout');
        }, fallbackTimeoutMs);

        if (uiActive()) {
            _resetFetchStatus(relays);
            _fetchProgress.reset(relays.length, threshold());
        }

        const closers = new Map(
            relays.map((relay) => [
                relay,
                _pool.subscribeMany([relay], filter, {
                    maxWait: RELAY_TIMEOUT_MS,
                    onevent: (event) => {
                        active.delete(relay);
                        if (uiActive()) _setFetchStatus(relay, 'connected');
                        const key = groupKey(event);
                        events.set(key, event);
                        let relayMap = relaysByKey.get(key);
                        if (!relayMap) {
                            relayMap = new Map();
                            relaysByKey.set(key, relayMap);
                        }
                        relayMap.set(relay, event);
                        checkConsensus();
                    },
                    onclose: (reasons) => {
                        // Only a genuine per-relay failure/timeout should read as an error — closing
                        // relays we simply stopped waiting on (consensus reached, or pruned as too
                        // small) shouldn't retroactively look like they failed.
                        if (reasons[0] !== 'fanGet: resolved' && reasons[0] !== 'fanGet: pruned') {
                            active.delete(relay);
                            if (uiActive() && _fetchStatus.get(relay) === 'checking') _setFetchStatus(relay, 'error');
                            checkConsensus();
                        }
                    },
                }),
            ]),
        );
    });
}

/**
 * Internal/auxiliary lookup — same fan-out/consensus logic as {@link fanGet}, but for a call that
 * is never itself the operation the user is watching progress for (a verification round-trip after
 * publishing, a rename's pre-read, a size-hint lookup alongside a real fetch). Always opts out of
 * the shared fetch-status/progress UI so it can never be mistaken for — or stomp on — whichever
 * fetch actually is user-visible right now.
 */
function fanGetInternal(
    filter: Parameters<AbstractSimplePool['subscribeMany']>[1],
    relays: string[] = NOSTR_RELAYS,
    fallbackTimeoutMs?: number,
): Promise<FanGetResult> {
    return fanGet(filter, relays, fallbackTimeoutMs, undefined, false);
}

async function fanQuery(filter: Parameters<AbstractSimplePool['querySync']>[1]): Promise<NostrEvent[]> {
    const results = await Promise.allSettled(
        NOSTR_RELAYS.map(async (relay) => {
            try {
                const events = await _pool.querySync([relay], filter, { maxWait: RELAY_TIMEOUT_MS });
                _setHealth(relay, 'connected');
                return events;
            } catch {
                _setHealth(relay, 'error');
                return [] as NostrEvent[];
            }
        }),
    );
    // Merge events from all relays, deduplicating by event ID first.
    const seen = new Set<string>();
    const merged: NostrEvent[] = [];
    for (const r of results) {
        for (const ev of r.status === 'fulfilled' ? r.value : []) {
            if (!seen.has(ev.id)) {
                seen.add(ev.id);
                merged.push(ev);
            }
        }
    }

    // NIP-33 parameterized replaceable events (kind 30000–39999): a stale relay may
    // return an older version under a different event ID. Keep only the newest event
    // per pubkey+kind+d-tag so the vault never shows duplicates.
    const newest = new Map<string, NostrEvent>();
    for (const ev of merged) {
        if (ev.kind < 30000 || ev.kind >= 40000) continue;
        const dtag = ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        const key = `${ev.pubkey}:${ev.kind}:${dtag}`;
        const existing = newest.get(key);
        if (!existing || ev.created_at > existing.created_at) {
            newest.set(key, ev);
        }
    }
    return merged.filter((ev) => {
        if (ev.kind < 30000 || ev.kind >= 40000) return true;
        const dtag = ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        return newest.get(`${ev.pubkey}:${ev.kind}:${dtag}`) === ev;
    });
}

// ── Publish ───────────────────────────────────────────────────────────────────

let _lastPublishedPlan: {
    planId: string;
    createdAt: number;
    gen: string;
    sharedTags: string[][];
    content: string;
    indexEvent: NostrEvent;
} | null = null;

/**
 * Publishes every event in a set to one relay in parallel — `events.length > 1` means this is a
 * chunked attempt (already-split pieces), `=== 1` the ordinary whole-event attempt, each using the
 * matching outer race timeout (see {@link QUERY_GRACE_MS}'s doc comment: later ladder rungs publish
 * much smaller pieces, so a size rejection or OK should come back fast — no need for the full
 * whole-event budget on every rung of a relay that needs the full ladder). Feeds every rejection
 * through `learnSizeLimitFromRejection` so the cache keeps improving even from a partial-set failure.
 */
async function tryPublishSet(relay: string, events: NostrEvent[]): Promise<{ ok: boolean; sizeRejected: boolean }> {
    const timeoutMs = events.length > 1 ? RELAY_TIMEOUT_MS : PUBLISH_TIMEOUT_MS;
    const results = await Promise.allSettled(
        events.map((event) =>
            Promise.race([
                _pool.publish([relay], event)[0],
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('publish timed out')), timeoutMs)),
            ]),
        ),
    );
    let sizeRejected = false;
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
            learnSizeLimitFromRejection(relay, events[i]!, reason);
            if (SIZE_REJECTION_PATTERN.test(reason)) sizeRejected = true;
        }
    });
    return { ok: results.every((r) => r.status === 'fulfilled'), sizeRejected };
}

/**
 * One relay's full reactive-chunking attempt for the plan's data: try the whole event first, and
 * only chunk — starting from a cache-informed guess, doubling on further rejection, capped at
 * {@link MAX_CHUNKS} — if *this* relay rejects it for size. See the "Data-event chunking" section
 * above for why this is always per-relay and reactive, never a pre-emptive exclusion.
 */
async function publishDataToRelay(
    relay: string,
    sk: Uint8Array,
    planId: string,
    createdAt: number,
    gen: string,
    sharedTags: string[][],
    content: string,
    wholeEvent: NostrEvent,
): Promise<'connected' | 'skipped' | 'error'> {
    const first = await tryPublishSet(relay, [wholeEvent]);
    if (first.ok) return 'connected';
    if (!first.sizeRejected) return 'error';

    let n = startingChunkCount(wireEventSize(wholeEvent), peekRelayLimits(relay).maxMessageLength);
    for (;;) {
        const set = buildChunkSet(sk, planId, createdAt, gen, sharedTags, content, n);
        const result = await tryPublishSet(relay, set);
        if (result.ok) return 'connected';
        if (!result.sizeRejected) return 'error';
        if (n >= MAX_CHUNKS) return 'skipped';
        n = Math.min(MAX_CHUNKS, n * 2);
    }
}

/** The index never chunks (it's always small) — a plain single-event publish against the outer
 *  whole-event race timeout. */
async function publishIndexToRelay(relay: string, indexEvent: NostrEvent): Promise<boolean> {
    return (await tryPublishSet(relay, [indexEvent])).ok;
}

/**
 * Publishes a plan's data+index across every configured relay — each relay gets its own reactive
 * chunking attempt for the data event via {@link publishDataToRelay}; nobody is pre-excluded upfront
 * the way the old `computeEligibleRelays`/`publishEventPair` once did, since every relay can hold
 * *something* via the retry ladder.
 */
async function publishChunkedPlan(
    pk: string,
    sk: Uint8Array,
    planId: string,
    createdAt: number,
    sharedTags: string[][],
    content: string,
    indexEvent: NostrEvent,
): Promise<void> {
    const gen = randomNonce();
    _lastPublishedPlan = { planId, createdAt, gen, sharedTags, content, indexEvent };
    const wholeEvent = buildWholeEvent(sk, planId, createdAt, gen, sharedTags, content);

    const threshold = consensusThreshold(NOSTR_RELAYS.length);
    _publishProgress.reset(NOSTR_RELAYS.length, threshold);

    let confirmed = 0;
    const perRelay = await Promise.allSettled(
        NOSTR_RELAYS.map(async (relay) => {
            _setHealth(relay, 'checking');
            const [dataOutcome, indexOk] = await Promise.all([
                publishDataToRelay(relay, sk, planId, createdAt, gen, sharedTags, content, wholeEvent),
                publishIndexToRelay(relay, indexEvent),
            ]);
            const success = dataOutcome === 'connected' && indexOk;
            _setHealth(relay, success ? 'connected' : dataOutcome === 'skipped' ? 'skipped' : 'error');
            if (success) _publishProgress.update(++confirmed);
            return { success, dataOutcome };
        }),
    );

    const accepted = perRelay.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const skipped = perRelay.filter((r) => r.status === 'fulfilled' && r.value.dataOutcome === 'skipped').length;
    // A relay that exhausted the retry ladder was never going to hold this plan, the same way an
    // excluded relay never counted against the majority under the old pre-filtered eligible-relays
    // model — eligibility just isn't knowable in advance anymore under reactive chunking, only after
    // the fact. Judging the outcome against every configured relay instead of just the ones that
    // could ever succeed would report a misleading 'short' status for a publish that reached every
    // relay actually able to hold it.
    const effectiveThreshold = consensusThreshold(NOSTR_RELAYS.length - skipped);
    _publishProgress.finish(accepted >= effectiveThreshold ? 'reached' : 'short', accepted);
    if (accepted === 0) {
        const allSkipped = skipped === NOSTR_RELAYS.length;
        if (allSkipped) {
            throw new Error(
                `This plan is too large for every configured relay (${Math.ceil(wireEventSize(wholeEvent) / 1024)}KB even after splitting into up to ${MAX_CHUNKS} pieces). Try removing some content.`,
            );
        }
        throw new Error('Could not publish — no relays responded. Check your internet connection and try again.');
    }

    const { event: stored } = await fanGetInternal({ kinds: [PLAN_KIND], authors: [pk], '#d': [planId] }, NOSTR_RELAYS);
    if (!stored) {
        throw new Error('Verification failed — the plan was not found on any relay after publishing.');
    }
    if (stored.id !== indexEvent.id) {
        throw new Error(
            'Another version was saved at the same time. ' +
                'If you have multiple tabs open, close the others and try again.',
        );
    }
}

/** Retry publishing the last plan to a specific relay — re-runs the exact same reactive chunking
 *  ladder {@link publishChunkedPlan} uses, rather than a single verbatim republish, so a relay that
 *  needs chunking gets a real chance to succeed. */
export async function retryRelay(relay: string): Promise<void> {
    if (!_lastPublishedPlan) return;
    const { planId, createdAt, gen, sharedTags, content, indexEvent } = _lastPublishedPlan;
    _setHealth(relay, 'checking');

    const sk = await getOrCreateSecretKey();
    const wholeEvent = buildWholeEvent(sk, planId, createdAt, gen, sharedTags, content);
    const [dataOutcome, indexOk] = await Promise.all([
        publishDataToRelay(relay, sk, planId, createdAt, gen, sharedTags, content, wholeEvent),
        publishIndexToRelay(relay, indexEvent),
    ]);
    const success = dataOutcome === 'connected' && indexOk;
    _setHealth(relay, success ? 'connected' : dataOutcome === 'skipped' ? 'skipped' : 'error');
}

/**
 * Optimistically updates the vault cache so a just-published/renamed plan appears immediately
 * in the list without needing a relay round-trip to re-fetch what was just published.
 */
function upsertVaultCacheEntry(pk: string, entry: NostrPlanInfo): void {
    const existing = _vaultCache.get(pk);
    if (existing) {
        // No slicing to VAULT_PAGE_SIZE here — the cache holds everything loaded so far (which
        // may span multiple "Load more" pages), not just the first page.
        const filtered = existing.plans.filter((p) => p.id !== entry.id);
        _vaultCache.set(pk, { plans: [entry, ...filtered], hasMore: existing.hasMore, fetchedAt: Date.now() });
        _saveVaultCache();
    } else {
        invalidateVaultCache(pk);
    }
}

function visibilityFromTags(tags: string[][]): 'public' | 'private' {
    return tags.some((t) => t[0] === 'enc') ? 'private' : 'public';
}

export async function publishPlan(
    scene: Scene,
    name: string,
    visibility: 'public' | 'private',
    id?: string,
): Promise<NostrFileSource> {
    const sk = await getOrCreateSecretKey();
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);
    const planId = id ?? randomPlanId();

    const planJson = sceneToJson(scene);
    const { content: storedJson, compressed } = await compressForStorage(planJson);

    // Encrypt content for private plans (NIP-44 self-encryption — only this key can decrypt).
    // Compress-then-encrypt, never the other way — encrypted bytes are high-entropy and won't
    // compress at all.
    let dataContent: string;
    if (visibility === 'private') {
        const convKey = nip44.getConversationKey(sk, pk);
        dataContent = nip44.encrypt(storedJson, convKey);
    } else {
        dataContent = storedJson;
    }

    // Shared metadata tags carried on the data event's chunk 1 (or the whole event, when it fits in
    // one piece) — see buildChunkSet.
    const sharedTags: string[][] = [
        ['name', name],
        ['v', String(XIVPLAN_FORMAT_VERSION)],
    ];
    if (compressed) {
        sharedTags.push(['comp', 'gzip']);
    }
    if (visibility === 'private') {
        sharedTags.push(['enc', 'nip44-self']);
    }

    // Index event (kind 30078) — pure vault-listing metadata. Never touched by the read path for
    // opening a specific plan: every relay can hold *something* of the data event via the reactive
    // chunking ladder, so there's no longer a need to pre-prune relays the way the (now removed)
    // size/relays hint tags once did.
    const indexTags: string[][] = [
        ['d', planId],
        ['name', name],
        ['v', String(XIVPLAN_FORMAT_VERSION)],
    ];
    if (visibility === 'private') {
        indexTags.push(['enc', 'nip44-self']);
    }
    const indexEvent = finalizeEvent(
        {
            kind: PLAN_KIND,
            created_at: now,
            tags: indexTags,
            content: '',
        },
        sk,
    );

    await publishChunkedPlan(pk, sk, planId, now, sharedTags, dataContent, indexEvent);

    upsertVaultCacheEntry(pk, { id: planId, name, publishedAt: new Date(now * 1000), visibility });

    return { type: 'nostr', id: planId, name, pubkey: pk, visibility };
}

/**
 * Label for a publish/save action driven by a NostrVaultList selection: "Publish" for the New
 * row, "Update" when the selection is the plan already open, "Overwrite" for any other plan.
 */
export function getPublishActionLabel(
    selectedId: string | undefined,
    currentOpenId: string | undefined,
): 'Publish' | 'Update' | 'Overwrite' {
    if (!selectedId) return 'Publish';
    return selectedId === currentOpenId ? 'Update' : 'Overwrite';
}

// ── Rename ────────────────────────────────────────────────────────────────────

/**
 * Republishes a plan's metadata under a new display name and/or access level, keeping the same
 * id/d-tag/content. Re-encrypts or decrypts the content only when the access level actually
 * changes — otherwise the existing (possibly encrypted) data is reused byte-for-byte.
 */
export async function renamePlan(
    id: string,
    newName: string,
    newVisibility: 'public' | 'private',
): Promise<NostrPlanInfo> {
    const sk = await getOrCreateSecretKey();
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const { primary: existingData, content: existingContent } = await fetchPlanData(pk, id, false);

    const version = existingData.tags.find((t) => t[0] === 'v')?.[1] ?? String(XIVPLAN_FORMAT_VERSION);
    const currentVisibility = visibilityFromTags(existingData.tags);
    const compTag = existingData.tags.find((t) => t[0] === 'comp')?.[1];

    let content = existingContent;
    if (newVisibility !== currentVisibility) {
        const convKey = nip44.getConversationKey(sk, pk);
        content = currentVisibility === 'private' ? nip44.decrypt(content, convKey) : nip44.encrypt(content, convKey);
    }

    // Content is reused byte-for-byte (see doc comment above), so whatever compression it already
    // carries is preserved as-is — just forward the same comp tag rather than re-deciding it.
    const sharedTags: string[][] = [
        ['name', newName],
        ['v', version],
    ];
    if (compTag) {
        sharedTags.push(['comp', compTag]);
    }
    if (newVisibility === 'private') {
        sharedTags.push(['enc', 'nip44-self']);
    }

    const indexTags: string[][] = [
        ['d', id],
        ['name', newName],
        ['v', version],
    ];
    if (newVisibility === 'private') {
        indexTags.push(['enc', 'nip44-self']);
    }
    const indexEvent = finalizeEvent(
        {
            kind: PLAN_KIND,
            created_at: now,
            tags: indexTags,
            content: '',
        },
        sk,
    );

    await publishChunkedPlan(pk, sk, id, now, sharedTags, content, indexEvent);

    const entry: NostrPlanInfo = { id, name: newName, publishedAt: new Date(now * 1000), visibility: newVisibility };
    upsertVaultCacheEntry(pk, entry);
    return entry;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export interface FetchPlanResult {
    scene: Scene;
    visibility: 'public' | 'private';
    name: string;
    /** Number of relays that agreed on the fetched data, out of totalRelays queried. */
    agreeingRelays: number;
    totalRelays: number;
}

/**
 * Single relay, single query: collects whichever of `${planId}:2`..`${planId}:n` this relay has.
 * Not built on {@link fanGet} — this isn't "pick a winner among relays," it's "collect N siblings
 * from one relay we already know is holding the current winning version's primary chunk."
 */
async function fetchRemainingChunks(
    relay: string,
    pubkey: string,
    planId: string,
    n: number,
): Promise<Map<number, NostrEvent>> {
    const dTagToIndex = new Map<string, number>();
    for (let i = 2; i <= n; i++) dTagToIndex.set(`${planId}:${i}`, i);
    const result = new Map<number, NostrEvent>();
    try {
        const events = await _pool.querySync(
            [relay],
            { kinds: [PLAN_DATA_KIND], authors: [pubkey], '#d': [...dTagToIndex.keys()] },
            { maxWait: RELAY_TIMEOUT_MS },
        );
        for (const event of events) {
            const d = event.tags.find((t) => t[0] === 'd')?.[1];
            const index = d ? dTagToIndex.get(d) : undefined;
            if (index !== undefined) result.set(index, event);
        }
    } catch {
        // No response from this relay — caller treats a partial/empty result as incomplete.
    }
    return result;
}

/**
 * Fetches a plan's data, transparently reconstructing it from chunks when needed. Consensus is only
 * load-bearing once — deciding which `created_at` (version) wins at the primary slot (`planId`),
 * grouped by version rather than event id since relays can legitimately hold the same version as
 * physically different chunk-1 events (different declared chunk count -> different bytes ->
 * different id). Once a version wins, fetching its remaining chunks needs no further cross-relay
 * confirmation for trust — every chunk is signed by the same key, so a relay can't forge content or
 * lie about its own `chunk` tag. Reconstruction always pulls a complete set from *one* relay's own
 * declared chunk count — chunks are never spliced across relays that used a different count for the
 * same version.
 */
async function fetchPlanData(
    pubkey: string,
    planId: string,
    trackUiStatus = true,
): Promise<{
    primary: NostrEvent;
    /** The reconstructed relay's own full, ordered chunk set (length === chunkCountOf(primary)) —
     *  repair republishes this verbatim, so it must be exactly what one relay actually holds. */
    chunks: NostrEvent[];
    content: string;
    agreeingRelays: number;
    totalRelays: number;
    relayStatuses: Map<string, RelayHealth>;
}> {
    const {
        event: primary,
        agreeingRelays,
        totalRelays,
        relayStatuses,
        relayEvents,
        uiGeneration,
    } = await fanGet(
        { kinds: [PLAN_DATA_KIND], authors: [pubkey], '#d': [planId] },
        NOSTR_RELAYS,
        undefined,
        undefined,
        trackUiStatus,
        // created_at alone has only 1-second resolution — two genuinely different publishes landing
        // in the same second would otherwise be merged into one group. `gen` (see randomNonce) is
        // what actually disambiguates them for anything published by this feature — but legacy data
        // (published before `gen` existed) has none, so `genOf(e) || e.id` falls back to the event's
        // own id in that case, exactly restoring the old id-based separation instead of merging two
        // different legacy events that happen to share a created_at.
        (e) => `${e.created_at}:${genOf(e) || e.id}`,
    );
    if (!primary) throw new Error(`Plan not found on any relay.`);

    // Cheapest first: a relay whose own primary chunk is already '1/1' needs zero extra round trips.
    const candidates = [...relayEvents.entries()].sort((a, b) => chunkCountOf(a[1]) - chunkCountOf(b[1]));
    let content: string | undefined;
    let chunks: NostrEvent[] | undefined;
    for (const [relay, chunk1] of candidates) {
        const n = chunkCountOf(chunk1);
        if (n === 1) {
            content = chunk1.content;
            chunks = [chunk1];
            break;
        }
        const rest = await fetchRemainingChunks(relay, pubkey, planId, n);
        // A chunk only belongs to this relay's reconstruction if it matches the primary on version
        // (created_at + gen) AND on the split itself (its own declared chunk count). The version
        // check alone isn't enough: the retry ladder reuses the same created_at/gen across every
        // rung of one publish attempt (2 -> 4 -> 8 chunks), so if a relay's per-d-tag replaceable-
        // event tie-break (equal created_at resolves to lowest event id, not "most recent write")
        // ever retains a stale rung's chunk alongside newer siblings, its `chunk` tag still declares
        // the OLD rung's n — checking it here is what actually catches that, not just timestamp/gen.
        const complete =
            rest.size === n - 1 &&
            [...rest.values()].every(
                (c) => c.created_at === primary.created_at && genOf(c) === genOf(primary) && chunkCountOf(c) === n,
            );
        if (complete) {
            const ordered = [chunk1, ...Array.from({ length: n - 1 }, (_, index) => rest.get(index + 2)!)];
            content = joinChunks(ordered.map((e) => e.content));
            chunks = ordered;
            break;
        }
        // Holds the right version but couldn't deliver every chunk — distinct from 'stale' (wrong
        // version) and 'error' (no response at all), and a repair target in its own right.
        relayStatuses.set(relay, 'incomplete');
        // Also correct the shared, user-visible store — fanGet already resolved by this point, so
        // its own uiActive()-gated writes can't reach this late; the generation check here is the
        // same guard, applied post-resolution, so a superseded fetch can't stomp a newer one's UI.
        if (uiGeneration === _fetchGeneration) _setFetchStatus(relay, 'incomplete');
    }
    if (content === undefined || chunks === undefined) {
        throw new Error('Plan data could not be fully retrieved from any relay — try again.');
    }

    return { primary, chunks, content, agreeingRelays, totalRelays, relayStatuses };
}

/**
 * Minimum independently-agreeing relays required before a fetch's winning event gets propagated
 * to relays that don't have it. Guards against a single relay's claim (wrong, or an outright lie)
 * being blindly broadcast everywhere via repair — two independent relays agreeing is real
 * corroboration; one relay's unconfirmed report isn't, even if it's all we have.
 */
const REPAIR_MIN_AGREEMENT = 2;

/**
 * One relay's repair attempt, two-tier. Tier 1 (always available, any plan whether owned or not):
 * verbatim-republish the exact chunk set we reconstructed from — same ids/sigs/content, zero
 * re-signing, so a stale version can never outrank a genuinely newer one we simply haven't seen yet
 * (see the doc comment on {@link repairStaleRelays}). Tier 2 (owned plans only, `sk` available):
 * if the verbatim set still doesn't fit this relay (it's more size-constrained than the relay we
 * reconstructed from), fall back to the same reactive chunking ladder a fresh publish uses —
 * reusing the *original* winning `created_at` exactly, never a fresh timestamp, so the repair never
 * looks newer than the version it's actually repairing.
 */
async function repairOneRelay(
    relay: string,
    sk: Uint8Array | null,
    planId: string,
    createdAt: number,
    gen: string,
    sharedTags: string[][],
    content: string,
    chunks: NostrEvent[],
): Promise<void> {
    // Skip the doomed verbatim attempt outright if we already know this relay can't hold even the
    // largest piece we're holding — but still give tier 2 (below) a chance to chunk further down.
    const maxLen = peekRelayLimits(relay).maxMessageLength;
    const maxChunkSize = Math.max(...chunks.map(wireEventSize));
    const verbatim =
        maxLen !== undefined && maxChunkSize > maxLen
            ? { ok: false, sizeRejected: true }
            : await tryPublishSet(relay, chunks);
    if (verbatim.ok || !verbatim.sizeRejected || !sk) return;
    const wholeEvent = buildWholeEvent(sk, planId, createdAt, gen, sharedTags, content);
    await publishDataToRelay(relay, sk, planId, createdAt, gen, sharedTags, content, wholeEvent);
}

/**
 * Read repair: fire-and-forget republish of a fetch's winning chunk set to every relay that's
 * *confirmed* behind — one we actually heard back from with a different (older) version ('stale'),
 * or the right version but an incomplete chunk set ('incomplete') — self-healing relays that missed
 * an update, got pruned, or came back online with outdated/partial data. Deliberately excludes
 * 'skipped'/'error' relays: we have no evidence at all about what they currently hold (we either
 * never heard from them, or gave up before they answered) — pushing to them assumes they're behind,
 * but they could just as easily be sitting on a genuinely newer version we simply failed to fetch in
 * time, and relying on every relay to correctly discard an incoming write that's older than what it
 * already has isn't a safe assumption to build on. Never awaited by the caller and never throws;
 * this is opportunistic housekeeping, not something the user asked for, so a failed repair attempt
 * should be invisible.
 *
 * `sk` is the *plan owner's* secret key, or null if the current session doesn't hold it (repairing
 * someone else's public plan) — gates tier 2 above, since re-chunking requires signing new events as
 * that pubkey.
 *
 * `relayStatuses` must be the calling {@link fetchPlanData}'s own `relayStatuses` — never the shared
 * `getFetchStatus()` store, which a different, concurrently-running fetch could have already
 * overwritten with an unrelated plan's relay labels by the time this runs.
 */
function repairStaleRelays(
    sk: Uint8Array | null,
    planId: string,
    createdAt: number,
    gen: string,
    sharedTags: string[][],
    content: string,
    chunks: NostrEvent[],
    agreeingRelays: number,
    relayStatuses: Map<string, RelayHealth>,
): void {
    if (agreeingRelays < REPAIR_MIN_AGREEMENT) return;
    const targets = [...relayStatuses]
        .filter(([, status]) => status === 'stale' || status === 'incomplete')
        .map(([url]) => url);
    for (const relay of targets) {
        void repairOneRelay(relay, sk, planId, createdAt, gen, sharedTags, content, chunks);
    }
}

export async function fetchPlan(pubkey: string, id: string): Promise<FetchPlanResult> {
    const {
        primary: dataEvent,
        chunks,
        content: reconstructed,
        agreeingRelays,
        totalRelays,
        relayStatuses,
    } = await fetchPlanData(pubkey, id);

    // Repair can only re-chunk (tier 2) as the plan's actual owner, since that means signing new
    // chunk events under this pubkey — for someone else's public plan, only the verbatim tier 1
    // republish (already-signed, zero re-signing) is available.
    const ownSk = await getOrCreateSecretKey();
    const repairSk = getPublicKey(ownSk) === pubkey ? ownSk : null;
    const sharedTags = dataEvent.tags.filter((t) => t[0] !== 'd' && t[0] !== 'chunk' && t[0] !== 'gen');
    repairStaleRelays(
        repairSk,
        id,
        dataEvent.created_at,
        genOf(dataEvent),
        sharedTags,
        reconstructed,
        chunks,
        agreeingRelays,
        relayStatuses,
    );

    const name = dataEvent.tags.find((t) => t[0] === 'name')?.[1] ?? id;

    // Visibility from enc tag on data event (new format, added alongside the enc tag on the index).
    // Older plans lack enc on data — for those, NIP-44 ciphertext is not valid JSON, so sniff the
    // content to detect private plans without an extra index round-trip. A comp tag with no enc
    // tag is decisive on its own (compressed bytes don't parse as JSON either, so the old sniff
    // would misread them as private) — no plan published with compression predates the comp tag.
    const encTag = dataEvent.tags.find((t) => t[0] === 'enc')?.[1];
    const compTag = dataEvent.tags.find((t) => t[0] === 'comp')?.[1];
    let visibility: 'public' | 'private';
    if (encTag !== undefined) {
        visibility = encTag === 'nip44-self' ? 'private' : 'public';
    } else if (compTag !== undefined) {
        visibility = 'public';
    } else {
        let looksLikeJson = false;
        try {
            JSON.parse(reconstructed);
            looksLikeJson = true;
        } catch {
            /* encrypted */
        }
        visibility = looksLikeJson ? 'public' : 'private';
    }

    let content = reconstructed;
    if (visibility === 'private') {
        const sk = await getOrCreateSecretKey();
        const ownPk = getPublicKey(sk);
        if (ownPk !== pubkey) {
            throw new Error('This plan is private and can only be opened with the key that published it.');
        }
        const convKey = nip44.getConversationKey(sk, ownPk);
        try {
            content = nip44.decrypt(content, convKey);
        } catch {
            throw new Error(
                'Failed to decrypt the plan — the stored key may be corrupted or the plan data is invalid.',
            );
        }
    }

    if (compTag === 'gzip') {
        try {
            content = await gzipDecompress(base64UrlToBytes(content));
        } catch {
            throw new Error('Failed to decompress the plan — the stored data may be corrupted.');
        }
    }

    return { scene: jsonToScene(content), visibility, name, agreeingRelays, totalRelays };
}

// ── Delete (NIP-09) ───────────────────────────────────────────────────────────

/**
 * Sends a kind 5 deletion request for the index event and every possible data-event chunk slot.
 * A chunked plan's chunks 2..N live at different d-tags (`${id}:2`..`${id}:MAX_CHUNKS`) than the
 * primary (`id`), and different relays may have settled on different N for the same plan — there's
 * no single record of "the max N any relay ever used" anywhere else, so this covers every d-tag a
 * relay could possibly be holding rather than just the primary one.
 */
export async function deletePlan(id: string): Promise<void> {
    const sk = await getOrCreateSecretKey();
    const pk = getPublicKey(sk);

    const tags: string[][] = [
        ['a', `${PLAN_KIND}:${pk}:${id}`], // index event
        ['a', `${PLAN_DATA_KIND}:${pk}:${id}`], // data event, chunk 1 (or the whole event, if unchunked)
    ];
    for (let i = 2; i <= MAX_CHUNKS; i++) {
        tags.push(['a', `${PLAN_DATA_KIND}:${pk}:${id}:${i}`]);
    }

    const event = finalizeEvent(
        {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: '',
        },
        sk,
    );

    await Promise.any(_pool.publish(NOSTR_RELAYS, event));
    invalidateVaultCache(pk);
}

// ── Duplicate ─────────────────────────────────────────────────────────────────

/**
 * Fetch a plan and republish it under a new name and a fresh id in the current user's vault.
 * Works for own private plans and other users' public plans.
 * Fails if the source plan is private and not owned by the current key.
 */
export async function duplicatePlan(sourcePubkey: string, sourceId: string, newName: string): Promise<NostrFileSource> {
    const { scene, visibility } = await fetchPlan(sourcePubkey, sourceId);
    return publishPlan(scene, newName, visibility);
}

// ── Vault listing ─────────────────────────────────────────────────────────────

export interface NostrPlanInfo {
    id: string;
    name: string;
    publishedAt: Date;
    visibility: 'public' | 'private';
}

const VAULT_PAGE_SIZE = 20;

interface VaultCachePage {
    plans: NostrPlanInfo[];
    hasMore: boolean;
    fetchedAt: number;
}

const VAULT_CACHE_TTL = 5 * 60 * 1000;
const VAULT_CACHE_STORAGE_KEY = 'xivplan:vault-cache';

interface StoredVaultCachePage {
    plans: Array<{ id: string; name: string; publishedAt: number; visibility: 'public' | 'private' }>;
    hasMore: boolean;
    fetchedAt: number;
}

function _loadVaultCache(): Map<string, VaultCachePage> {
    try {
        const raw = localStorage.getItem(VAULT_CACHE_STORAGE_KEY);
        if (!raw) return new Map();
        const stored = JSON.parse(raw) as Record<string, StoredVaultCachePage>;
        return new Map(
            Object.entries(stored).map(([pubkey, page]) => [
                pubkey,
                {
                    plans: page.plans.map((p) => ({
                        id: p.id,
                        name: p.name,
                        publishedAt: new Date(p.publishedAt),
                        visibility: p.visibility,
                    })),
                    hasMore: page.hasMore,
                    fetchedAt: page.fetchedAt,
                },
            ]),
        );
    } catch {
        return new Map();
    }
}

function _saveVaultCache(): void {
    try {
        const stored: Record<string, StoredVaultCachePage> = {};
        for (const [pubkey, page] of _vaultCache.entries()) {
            stored[pubkey] = {
                plans: page.plans.map((p) => ({
                    id: p.id,
                    name: p.name,
                    publishedAt: p.publishedAt.getTime(),
                    visibility: p.visibility,
                })),
                hasMore: page.hasMore,
                fetchedAt: page.fetchedAt,
            };
        }
        localStorage.setItem(VAULT_CACHE_STORAGE_KEY, JSON.stringify(stored));
    } catch {
        // Ignore storage errors (private browsing, quota exceeded)
    }
}

const _vaultCache = _loadVaultCache();

/** Evict cached vault page(s). Call after publish or delete to force a fresh fetch. */
export function invalidateVaultCache(pubkey?: string): void {
    if (pubkey) _vaultCache.delete(pubkey);
    else _vaultCache.clear();
    _saveVaultCache();
}

/**
 * List plans for any pubkey with pagination.
 * First-page results are cached per pubkey for VAULT_CACHE_TTL (5 min).
 * Returns `cached: true` when the result came from cache (no relay traffic).
 * Queries only kind 30078 (index events) — data events (kind 30079) never appear.
 */
export async function listPlans(
    pubkey: string,
    opts: { until?: number; id?: string } = {},
): Promise<{ plans: NostrPlanInfo[]; hasMore: boolean; cached: boolean; stale: boolean }> {
    const isFirstPage = opts.until === undefined && !opts.id;

    if (isFirstPage) {
        const cached = _vaultCache.get(pubkey);
        if (cached) {
            const withinTTL = Date.now() - cached.fetchedAt < VAULT_CACHE_TTL;
            return { plans: cached.plans, hasMore: cached.hasMore, cached: true, stale: !withinTTL };
        }
    }

    // Relays apply `limit` before fanQuery's cross-relay dedup, and per-relay storage of
    // superseded replaceable-event versions isn't guaranteed to be purged promptly — a relay's
    // own top-N-by-recency slice can include stale copies of plans already counted elsewhere,
    // silently shrinking the deduped result below what's actually available. Requesting well
    // beyond one page's worth gives dedup enough headroom to still surface a full page (and an
    // accurate hasMore) even when some of what came back turns out to be duplicates.
    const fetchLimit = (VAULT_PAGE_SIZE + 1) * 4;
    const events = await fanQuery({
        kinds: [PLAN_KIND],
        authors: [pubkey],
        limit: fetchLimit,
        ...(opts.until !== undefined && { until: opts.until }),
        ...(opts.id && { '#d': [opts.id] }),
    });

    const result = buildPage(events);

    if (isFirstPage) {
        _vaultCache.set(pubkey, { ...result, fetchedAt: Date.now() });
        _saveVaultCache();
    } else if (!opts.id) {
        // "Load more" — extend the cached list (keeping the first page's fetchedAt for TTL
        // purposes) so a later remount/reload restores everything already loaded instead of
        // snapping back to just the first page.
        const existing = _vaultCache.get(pubkey);
        if (existing) {
            const seen = new Set(existing.plans.map((p) => p.id));
            const appended = result.plans.filter((p) => !seen.has(p.id));
            _vaultCache.set(pubkey, {
                plans: [...existing.plans, ...appended],
                hasMore: result.hasMore,
                fetchedAt: existing.fetchedAt,
            });
            _saveVaultCache();
        }
    }

    return { ...result, cached: false, stale: false };
}

/** Convenience wrapper — lists the current user's own plans. */
export async function listOwnPlans(
    opts: { until?: number; id?: string } = {},
): Promise<{ plans: NostrPlanInfo[]; hasMore: boolean; cached: boolean }> {
    return listPlans(await getNostrPubkey(), opts);
}

function buildPage(events: NostrEvent[]): { plans: NostrPlanInfo[]; hasMore: boolean } {
    events.sort((a, b) => b.created_at - a.created_at);
    const hasMore = events.length > VAULT_PAGE_SIZE;
    const page = events.slice(0, VAULT_PAGE_SIZE);
    const plans = page
        .map((e) => {
            const id = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
            return {
                id,
                name: e.tags.find((t) => t[0] === 'name')?.[1] ?? id,
                publishedAt: new Date(e.created_at * 1000),
                visibility: visibilityFromTags(e.tags),
            };
        })
        .filter((p) => p.id);
    return { plans, hasMore };
}

// ── Suspense-compatible fetch for URL loading ─────────────────────────────────

let _cacheKey = '';
let _cachedPromise: Promise<Scene | undefined> | undefined;
let _cachedVisibility: 'public' | 'private' | undefined;
let _cachedName: string | undefined;
let _cachedError: unknown;
let _cachedAgreeingRelays: number | undefined;
let _cachedTotalRelays: number | undefined;

export function getNostrFetchPromise(pubkey: string, id: string): Promise<Scene | undefined> {
    const key = `${pubkey}|${id}`;
    if (key === _cacheKey && _cachedPromise) return _cachedPromise;

    _cacheKey = key;
    _cachedError = undefined;
    _cachedVisibility = undefined;
    _cachedName = undefined;
    _cachedAgreeingRelays = undefined;
    _cachedTotalRelays = undefined;
    _cachedPromise = fetchPlan(pubkey, id)
        .then((result) => {
            _cachedVisibility = result.visibility;
            _cachedName = result.name;
            _cachedAgreeingRelays = result.agreeingRelays;
            _cachedTotalRelays = result.totalRelays;
            return result.scene;
        })
        .catch((ex) => {
            console.error('Failed to fetch Nostr plan', ex);
            _cachedError = ex;
            return undefined;
        });

    return _cachedPromise;
}

export function getNostrFetchError(): unknown {
    return _cachedError;
}

export function getNostrFetchedVisibility(): 'public' | 'private' | undefined {
    return _cachedVisibility;
}

export function getNostrFetchedName(): string | undefined {
    return _cachedName;
}

/**
 * Consensus info for the last completed URL fetch, if any — used to warn when it fell short of
 * {@link consensusThreshold}. Consuming (clears the cache after reading): this is meant to be
 * read exactly once, to show exactly one warning per fetch. A plain non-consuming getter would
 * fire twice under React StrictMode's intentional double-invoke of effects in development —
 * harmless in production (where that double-invoke doesn't happen) but confusing in dev, since
 * the second read would otherwise still find the same cached result and warn again.
 */
export function consumeNostrFetchedConsensus(): { agreeingRelays: number; totalRelays: number } | undefined {
    if (_cachedAgreeingRelays === undefined || _cachedTotalRelays === undefined) return undefined;
    const result = { agreeingRelays: _cachedAgreeingRelays, totalRelays: _cachedTotalRelays };
    _cachedAgreeingRelays = undefined;
    _cachedTotalRelays = undefined;
    return result;
}

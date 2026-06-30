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
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, SimplePool } from 'nostr-tools';
import type { NostrEvent } from 'nostr-tools';
import { jsonToScene, sceneToJson } from '../file';
import type { NostrFileSource } from '../SceneProvider';
import type { Scene } from '../scene';

export const NOSTR_RELAYS = ['wss://relay.nostr.band', 'wss://nos.lol', 'wss://relay.damus.io'];

/** Kind for index events — metadata and pointer to the data event. */
export const PLAN_KIND = 30078;

/** Kind for data events — full plan content. Separate kind keeps vault queries index-only. */
export const PLAN_DATA_KIND = 30079;

/** Incremented when the event structure changes in a backwards-incompatible way. */
export const XIVPLAN_FORMAT_VERSION = 1;

/** Per-relay timeout for read operations (ms). */
const RELAY_TIMEOUT_MS = 6000;

// Single long-lived pool — connections are reused across operations.
const _pool = new SimplePool();

// ── Shared relay status ───────────────────────────────────────────────────────

export type RelayHealth = 'checking' | 'connected' | 'error';

const _health = new Map<string, RelayHealth>(NOSTR_RELAYS.map((url) => [url, 'checking']));
const _listeners = new Set<() => void>();

function _setHealth(url: string, h: RelayHealth): void {
    if (_health.get(url) === h) return;
    _health.set(url, h);
    for (const fn of _listeners) fn();
}

export function subscribeRelayStatus(fn: () => void): () => void {
    _listeners.add(fn);
    return () => {
        _listeners.delete(fn);
    };
}

export function getRelayStatus(): Array<{ url: string; status: RelayHealth }> {
    return NOSTR_RELAYS.map((url) => ({ url, status: _health.get(url) ?? 'checking' }));
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
                    await _pool.get([relay], { kinds: [PLAN_KIND], since: futureTs }, { maxWait: 5000 });
                    _setHealth(relay, 'connected');
                } catch {
                    _setHealth(relay, 'error');
                }
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

/** Replaces the stored key with a freshly generated one. Irreversible — export first. */
export async function generateNewKey(): Promise<void> {
    const sk = generateSecretKey();
    await nostrStore.setItem('sk', bytesToHex(sk));
}

/** Accepts a 64-char hex private key (contents of the exported .txt file). */
export async function importSecretKey(text: string): Promise<void> {
    const hex = text.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) {
        throw new Error('Invalid key: expected 64 hex characters.');
    }
    await nostrStore.setItem('sk', hex);
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

export function parseInputPubkey(input: string): string {
    input = input.trim();
    if (input.startsWith('npub1')) {
        try {
            const decoded = nip19.decode(input);
            if (decoded.type === 'npub') return decoded.data;
        } catch {
            // fall through to hex
        }
    }
    return input;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

export function getNostrShareUrl(pubkey: string, dtag: string): string {
    return `${location.protocol}//${location.host}${location.pathname}#/nostr/${pubkey}/${dtag}`;
}

// ── Fan-fetch helpers (parallel, deduplicated, status-tracking) ───────────────

async function fanGet(
    filter: Parameters<SimplePool['get']>[1],
    relays: string[] = NOSTR_RELAYS,
): Promise<NostrEvent | null> {
    const results = await Promise.allSettled(
        relays.map(async (relay) => {
            try {
                const event = await _pool.get([relay], filter, { maxWait: RELAY_TIMEOUT_MS });
                _setHealth(relay, 'connected');
                return event;
            } catch {
                _setHealth(relay, 'error');
                return null;
            }
        }),
    );
    for (const r of results) {
        if (r.status === 'fulfilled' && r.value) return r.value;
    }
    return null;
}

async function fanQuery(filter: Parameters<SimplePool['querySync']>[1]): Promise<NostrEvent[]> {
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
    return merged;
}

// ── Publish ───────────────────────────────────────────────────────────────────

let _lastPublishedEvents: { index: NostrEvent; data: NostrEvent } | null = null;

/** Retry publishing the last pair of signed events to a specific relay. */
export async function retryRelay(relay: string): Promise<void> {
    if (!_lastPublishedEvents) return;
    _setHealth(relay, 'checking');
    const { index, data } = _lastPublishedEvents;
    const dataPromises = _pool.publish([relay], data);
    const indexPromises = _pool.publish([relay], index);
    try {
        await Promise.race([
            Promise.all([dataPromises[0], indexPromises[0]]),
            new Promise<never>((_, reject) => setTimeout(reject, 10000)),
        ]);
        _setHealth(relay, 'connected');
    } catch {
        _setHealth(relay, 'error');
    }
}

export async function publishPlan(
    scene: Scene,
    name: string,
    visibility: 'public' | 'private',
): Promise<NostrFileSource> {
    const sk = await getOrCreateSecretKey();
    const pk = getPublicKey(sk);
    const now = Math.floor(Date.now() / 1000);

    const planJson = sceneToJson(scene);

    // Encrypt content for private plans (NIP-44 self-encryption — only this key can decrypt)
    let dataContent: string;
    if (visibility === 'private') {
        const convKey = nip44.getConversationKey(sk, pk);
        dataContent = nip44.encrypt(planJson, convKey);
    } else {
        dataContent = planJson;
    }

    // Data event (kind 30079) — full plan content, self-describing visibility via enc tag
    const dataTags: string[][] = [
        ['d', name],
        ['v', String(XIVPLAN_FORMAT_VERSION)],
    ];
    if (visibility === 'private') {
        dataTags.push(['enc', 'nip44-self']);
    }
    const dataEvent = finalizeEvent(
        {
            kind: PLAN_DATA_KIND,
            created_at: now,
            tags: dataTags,
            content: dataContent,
        },
        sk,
    );

    // Index event (kind 30078) — metadata + pointer to data event
    const indexTags: string[][] = [
        ['d', name],
        ['v', String(XIVPLAN_FORMAT_VERSION)],
        ['e', dataEvent.id],
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

    _lastPublishedEvents = { index: indexEvent, data: dataEvent };

    // Publish both events in parallel — data first so it's available when index arrives
    const dataPublish = _pool.publish(NOSTR_RELAYS, dataEvent);
    const indexPublish = _pool.publish(NOSTR_RELAYS, indexEvent);

    const relayResults = await Promise.allSettled(
        NOSTR_RELAYS.map(async (relay, i) => {
            try {
                await Promise.race([
                    Promise.all([dataPublish[i], indexPublish[i]]),
                    new Promise<never>((_, reject) => setTimeout(reject, 10000)),
                ]);
                _setHealth(relay, 'connected');
            } catch (ex) {
                _setHealth(relay, 'error');
                throw ex;
            }
        }),
    );

    const accepted = relayResults.filter((r) => r.status === 'fulfilled').length;
    if (accepted === 0) {
        throw new Error('Could not publish — no relays responded. Check your internet connection and try again.');
    }

    const stored = await fanGet({ kinds: [PLAN_KIND], authors: [pk], '#d': [name] });

    if (!stored) {
        throw new Error('Verification failed — the plan was not found on any relay after publishing.');
    }
    if (stored.id !== indexEvent.id) {
        throw new Error(
            'Another version was saved at the same time. ' +
                'If you have multiple tabs open, close the others and try again.',
        );
    }

    // Optimistically update the vault cache so the plan appears immediately in the list
    // without needing a relay round-trip to re-fetch what we just published.
    const existing = _vaultCache.get(pk);
    if (existing) {
        const newEntry: NostrPlanInfo = { dtag: name, publishedAt: new Date(now * 1000), visibility };
        const filtered = existing.plans.filter((p) => p.dtag !== name);
        const merged = [newEntry, ...filtered].slice(0, VAULT_PAGE_SIZE);
        _vaultCache.set(pk, { plans: merged, hasMore: existing.hasMore, fetchedAt: Date.now() });
        _saveVaultCache();
    } else {
        invalidateVaultCache(pk);
    }
    return { type: 'nostr', name, pubkey: pk, visibility };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export interface FetchPlanResult {
    scene: Scene;
    visibility: 'public' | 'private';
}

export async function fetchPlan(pubkey: string, name: string): Promise<FetchPlanResult> {
    // Fetch data event directly by dtag — kind 30079 is a NIP-33 parameterized replaceable event,
    // so the relay always returns the latest version. No index round-trip needed for new plans.
    const dataEvent = await fanGet({ kinds: [PLAN_DATA_KIND], authors: [pubkey], '#d': [name] });
    if (!dataEvent) throw new Error(`Plan "${name}" not found on any relay.`);

    // Visibility from enc tag on data event (new format, added alongside the enc tag on the index).
    // Older plans lack enc on data — for those, NIP-44 ciphertext is not valid JSON, so sniff the
    // content to detect private plans without an extra index round-trip.
    const encTag = dataEvent.tags.find((t) => t[0] === 'enc')?.[1];
    let visibility: 'public' | 'private';
    if (encTag !== undefined) {
        visibility = encTag === 'nip44-self' ? 'private' : 'public';
    } else {
        let looksLikeJson = false;
        try {
            JSON.parse(dataEvent.content);
            looksLikeJson = true;
        } catch {
            /* encrypted */
        }
        visibility = looksLikeJson ? 'public' : 'private';
    }

    let content = dataEvent.content;
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

    return { scene: jsonToScene(content), visibility };
}

// ── Delete (NIP-09) ───────────────────────────────────────────────────────────

/** Sends a kind 5 deletion request for both the index and data events. */
export async function deletePlan(dtag: string): Promise<void> {
    const sk = await getOrCreateSecretKey();
    const pk = getPublicKey(sk);

    const event = finalizeEvent(
        {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['a', `${PLAN_KIND}:${pk}:${dtag}`], // index event
                ['a', `${PLAN_DATA_KIND}:${pk}:${dtag}`], // data event
            ],
            content: '',
        },
        sk,
    );

    await Promise.any(_pool.publish(NOSTR_RELAYS, event));
    invalidateVaultCache(pk);
}

// ── Duplicate ─────────────────────────────────────────────────────────────────

/**
 * Fetch a plan and republish it under a new name in the current user's vault.
 * Works for own private plans and other users' public plans.
 * Fails if the source plan is private and not owned by the current key.
 */
export async function duplicatePlan(
    sourcePubkey: string,
    sourceDtag: string,
    newName: string,
): Promise<NostrFileSource> {
    const { scene, visibility } = await fetchPlan(sourcePubkey, sourceDtag);
    return publishPlan(scene, newName, visibility);
}

// ── Vault listing ─────────────────────────────────────────────────────────────

export interface NostrPlanInfo {
    dtag: string;
    publishedAt: Date;
    visibility: 'public' | 'private';
}

const VAULT_PAGE_SIZE = 5;

interface VaultCachePage {
    plans: NostrPlanInfo[];
    hasMore: boolean;
    fetchedAt: number;
}

const VAULT_CACHE_TTL = 5 * 60 * 1000;
const VAULT_CACHE_STORAGE_KEY = 'xivplan:vault-cache';

interface StoredVaultCachePage {
    plans: Array<{ dtag: string; publishedAt: number; visibility: 'public' | 'private' }>;
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
                        dtag: p.dtag,
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
                    dtag: p.dtag,
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
    opts: { until?: number; dtag?: string } = {},
): Promise<{ plans: NostrPlanInfo[]; hasMore: boolean; cached: boolean; stale: boolean }> {
    const isFirstPage = opts.until === undefined && !opts.dtag;

    if (isFirstPage) {
        const cached = _vaultCache.get(pubkey);
        if (cached) {
            const withinTTL = Date.now() - cached.fetchedAt < VAULT_CACHE_TTL;
            return { plans: cached.plans, hasMore: cached.hasMore, cached: true, stale: !withinTTL };
        }
    }

    const fetchLimit = VAULT_PAGE_SIZE + 1;
    const events = await fanQuery({
        kinds: [PLAN_KIND],
        authors: [pubkey],
        limit: fetchLimit,
        ...(opts.until !== undefined && { until: opts.until }),
        ...(opts.dtag && { '#d': [opts.dtag] }),
    });

    const result = buildPage(events);

    if (isFirstPage) {
        _vaultCache.set(pubkey, { ...result, fetchedAt: Date.now() });
        _saveVaultCache();
    }

    return { ...result, cached: false, stale: false };
}

/** Convenience wrapper — lists the current user's own plans. */
export async function listOwnPlans(
    opts: { until?: number; dtag?: string } = {},
): Promise<{ plans: NostrPlanInfo[]; hasMore: boolean; cached: boolean }> {
    return listPlans(await getNostrPubkey(), opts);
}

function buildPage(events: NostrEvent[]): { plans: NostrPlanInfo[]; hasMore: boolean } {
    events.sort((a, b) => b.created_at - a.created_at);
    const hasMore = events.length > VAULT_PAGE_SIZE;
    const page = events.slice(0, VAULT_PAGE_SIZE);
    const plans = page
        .map((e) => ({
            dtag: e.tags.find((t) => t[0] === 'd')?.[1] ?? '',
            publishedAt: new Date(e.created_at * 1000),
            visibility: (e.tags.some((t) => t[0] === 'enc') ? 'private' : 'public') as 'public' | 'private',
        }))
        .filter((p) => p.dtag);
    return { plans, hasMore };
}

// ── Suspense-compatible fetch for URL loading ─────────────────────────────────

let _cacheKey = '';
let _cachedPromise: Promise<Scene | undefined> | undefined;
let _cachedVisibility: 'public' | 'private' | undefined;
let _cachedError: unknown;

export function getNostrFetchPromise(pubkey: string, dtag: string): Promise<Scene | undefined> {
    const key = `${pubkey}|${dtag}`;
    if (key === _cacheKey && _cachedPromise) return _cachedPromise;

    _cacheKey = key;
    _cachedError = undefined;
    _cachedVisibility = undefined;
    _cachedPromise = fetchPlan(pubkey, dtag)
        .then((result) => {
            _cachedVisibility = result.visibility;
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

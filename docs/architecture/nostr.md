# Nostr storage — current implementation

Living reference for `src/file/nostr.ts` (and the `FileDialogNostr.tsx`/`useFetchStatus.ts`/etc. UI it feeds) as it actually behaves today. Keep this in sync with the code as it changes.

## Two-event model

Each plan is a pair of NIP-33 parameterized-replaceable events, both keyed by `(pubkey, kind, d=planId)`:

- **Index** (`PLAN_KIND = 30078`) — lightweight metadata only (`name`, `v`, `enc?`). Vault listing only ever fetches this kind, so browsing plans stays cheap regardless of plan size.
- **Data** (`PLAN_DATA_KIND = 30079`) — the full plan content (compressed, and encrypted for private plans), fetched only when opening a specific plan.

## Relay pool

`NOSTR_RELAYS` (currently `nos.lol`, `nostr.mom`, `relay.nostr.net`, `nostr.bitcoiner.social`, `nostr.oxtr.dev`) is a hardcoded list, no NIP-65 relay-list discovery. **This list is expected to change over time** as individual relays prove unreliable (see "Relay churn" below) — check the actual array in `nostr.ts`, not this prose, for the current members.

A single module-level `AbstractSimplePool` (not the `SimplePool` convenience wrapper — that hardcodes `maxWaitForConnection` to 3000ms and silently derives a shorter effective connection timeout once a per-call `maxWait` exceeds it) is reused for the page's lifetime, with `maxWaitForConnection: RELAY_TIMEOUT_MS`.

Three timeout constants, all in `nostr.ts`:

| Constant           | Value | Purpose                                                                                                                                                                                                                                          |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RELAY_TIMEOUT_MS` | 12000 | Per-relay connect+query budget; also the pool's `maxWaitForConnection`.                                                                                                                                                                          |
| `QUERY_GRACE_MS`   | 2000  | Extra time beyond `RELAY_TIMEOUT_MS` before a read/publish gives up entirely — since `RELAY_TIMEOUT_MS` is _also_ the connection budget, a relay that spends the whole thing just opening its WebSocket needs this left over to actually answer. |
| `IDLE_TIMEOUT_MS`  | 4000  | How long `fanGet` waits after the _most recent new relay response_ before conceding without consensus — see "Adaptive read timeout" below. Independent of the two above.                                                                         |

## Consensus: strict majority

```ts
consensusThreshold(relayCount) = Math.floor(relayCount / 2) + 1;
```

A read or write only counts as "properly" settled once more relays hold that version than don't (3 of 5 today). This is the one rule both the publish path and `fanGet` build on.

## `fanGet` — parallel fetch with early-exit consensus

The core read primitive, used by plan-data fetch and publish verification alike. Per relay, it opens its own `subscribeMany` call (keeps `nostr-tools`' dedup-by-id scoped per relay — a misbehaving relay can't shadow another relay's genuine delivery) and reacts to `onevent` directly rather than `get()`/`querySync()` (those gate on that specific relay's own EOSE, which would block consensus-checking even after the event already arrived).

On every new event, it recomputes: is there a group (by `groupKey`, default event id) with `agreeingRelays >= consensusThreshold(activeRelays)` and no rival group with a higher `created_at` that could still outrank it? If so, it resolves immediately — the common case finishes in well under a second, regardless of `RELAY_TIMEOUT_MS`.

**Adaptive read timeout.** When consensus is _not_ reached, two timers race to eventually give up and resolve with whatever's on hand:

- The absolute `fallbackHandle` (`RELAY_TIMEOUT_MS + QUERY_GRACE_MS` ≈ 14s) — a hard ceiling that fires regardless of anything else, covering the case where _no_ relay has responded at all.
- The idle timer (`IDLE_TIMEOUT_MS` = 4s), armed only inside the `onevent` handler and reset on every new event. Once at least one relay has answered, if 4s pass with no further new information, `fanGet` concedes early rather than waiting out the full ceiling. It's deliberately _not_ reset by pruning or a relay's `onclose` — those aren't new content that could move consensus, and resetting on them would let a relay that keeps failing to connect indefinitely postpone giving up.

`fanGet`'s returned `relayStatuses` map covers every relay passed in, not just ones that answered — relays that never delivered a matching event are backfilled as `'skipped'` (we stopped listening once consensus was reached elsewhere or it was pruned — not a failure) or `'error'` (we ran out of patience without hearing from it at all), via `terminalLabelFor`.

Supports mid-flight pruning (`registerPruner`, currently unused by any caller) and a custom `groupKey` — the data-event fetch groups by `created_at + gen` rather than event id, since two relays can legitimately hold byte-different chunk-1 events (different declared chunk count) for what's conceptually the same version.

`fanGetInternal` is a thin wrapper for auxiliary lookups (e.g. post-publish verification) that opts out of the shared UI status stores.

## Compression and chunking

Plan JSON is gzipped (Compression Streams API) before going into an event's `content`, kept only if actually smaller than plain JSON. Some relays close the connection with no error for events well under their advertised NIP-11 `max_message_length` (`nos.lol`/`nostr.mom`, confirmed) — gzip buys real headroom without touching the event/consensus model.

If a relay still rejects a data event for size, `publishDataToRelay` reactively chunks it per-relay: try the whole event, then split into `n` pieces (starting from a NIP-11/rejection-derived guess, doubling on further rejection, capped at `MAX_CHUNKS = 16`). Chunks are never spliced across relays — a fetch always reconstructs from one relay's own complete, self-consistent set, checked via each piece's `chunk: i/N` tag against the primary chunk's declared `N`.

## Publish (`publishChunkedPlan`)

Publishes index + data to every relay in parallel, each relay running its own independent chunking ladder. Judges success against relays actually capable of holding the plan (`NOSTR_RELAYS.length - skipped`, where `skipped` = relays whose ladder maxed out at `MAX_CHUNKS`) rather than the full configured count, so a plan too large for one relay doesn't misreport an otherwise-complete publish as merely "short." After publishing, verifies by reading back the index event and comparing ids — catches the case where two sessions publish under the same `(pubkey, planId)` at nearly the same instant and a relay's replaceable-event tie-break (equal `created_at` → lowest id wins) silently kept the other write.

## Fetch and read-repair (`fetchPlan` / `fetchPlanData` / `repairStaleRelays`)

`fetchPlanData` runs `fanGet` for the data event, then reconstructs the winning version's full chunk set from whichever agreeing relay is cheapest (already unchunked, if any). `fetchPlan` then triggers **read-repair**, fire-and-forget, gated on `agreeingRelays >= REPAIR_MIN_AGREEMENT` (2 — guards against blindly trusting one relay's unconfirmed claim):

- **Confirmed targets** — relays labeled `'stale'` (wrong/older version) or `'incomplete'` (right version, missing chunks) — always repaired. Tier 1: verbatim republish of the exact chunk set reconstructed (same ids/sigs, zero re-signing — works for anyone, not just the plan's owner, since a relay only checks `sig` against the embedded `pubkey`). Tier 2 (owner only, needs `sk`): re-chunk via the normal ladder, reusing the _original_ `created_at`/`gen` so the repair can never outrank a genuinely newer version.
- **Speculative targets** — relays labeled `'skipped'`/`'error'` (no evidence at all about what they hold) — repaired too, but cooldown-gated (`SPECULATIVE_REPAIR_COOLDOWN_MS` = 30 min per relay URL, via `tryClaimSpeculativeRepair`) and tier-1-only (`allowRechunk: false` — withholds the signing/ladder cost from a relay we have zero confirmation is even reachable). This exists because a relay that silently evicts a plan's data (see "Relay churn" below) would otherwise never get healed unless the _author_ specifically re-publishes — since tier 1 needs no signing, any viewer opening a shared plan can trigger it.

Safety argument for pushing to relays with zero confirmation: tier 1 always republishes the exact winning `created_at`, never a fresh one. Every relay in `NOSTR_RELAYS` runs `strfry`, which — per NIP-01/33 — retains only the highest-`created_at` event for a given replaceable key, so the worst case is a no-op, not a regression.

## Relay churn

Public relays are not a stable foundation to assume forever:

- `relay.snort.social` (removed) turned out to run `memlay`, an explicitly in-memory (non-persistent) relay — unsuitable for long-term storage by design, not a bug on our end.
- `relay.damus.io`/`relay.primal.net` (removed) are real persistent (`strfry`) relays but were empirically observed pruning parameterized-replaceable event data after some weeks of inactivity — normal free-relay storage housekeeping, just too aggressive/unpredictable for this use case.
- Current replacements (`relay.nostr.net`, `nostr.bitcoiner.social`) were picked for verified independent operatorship (distinct NIP-11 `pubkey` from every other configured relay) and, for `nostr.bitcoiner.social`, an explicit operational claim of "monitored server availability and nightly off-site backups."
- `nos.lol` and `nostr.mom` share the same NIP-11 `pubkey` — i.e. the same operator/infra under two hostnames. They count as 2 relays toward `consensusThreshold`, but not as 2 _independent_ opinions.

When picking a relay to add, check its NIP-11 doc (`GET https://<host>/` with `Accept: application/nostr+json`) for `software` (avoid non-persistent relays like `memlay`) and `pubkey` (avoid duplicating an operator already in the list).

## Relay-health UI stores

Three independent pub/sub stores (`Map` + listener `Set` + `Object.is`-stable cached snapshot, for `useSyncExternalStore`):

1. **Relay health** (`subscribeRelayStatus`/`getRelayStatus`) — general connectivity, from the pool's connection hooks and `probeRelays()` (rate-limited to once per 5 min, also warms the NIP-11 size-limit cache in the background).
2. **Fetch status** (`subscribeFetchStatus`/`getFetchStatus`) — per-relay status for the _in-progress_ `fanGet` call specifically. Guarded by a monotonic `_fetchGeneration` counter so a stale, still-running fetch can't stomp a newer one's on-screen status.
3. **Consensus progress** (`createProgressStore`, one instance each for fetch and publish) — `{ agreeing, threshold, total, status }`.

The `RelayHealth` union (`'checking'|'connected'|'skipped'|'stale'|'incomplete'|'error'`) is threaded through several `Record<RelayHealth, ...>` exhaustiveness maps in the UI layer (`relayStatusLabels.ts`, `RelayStatusRow.tsx`, `CircularRelayIndicator.tsx`) — adding a new status value means updating all of them, or the build fails.

## Vault listing

`listPlans`/`listOwnPlans` page through index events only (`VAULT_PAGE_SIZE = 20`), over-fetching (`(PAGE_SIZE + 1) * 4`) to compensate for relay-side `limit` application happening before cross-relay dedup. Backed by a `localStorage`-persisted cache (`VAULT_CACHE_STORAGE_KEY`, `VAULT_CACHE_TTL` = 5 min) that publish/rename optimistically update in place, so a just-saved plan appears without a relay round-trip.

## Key management

A random secret key is generated on first use and stored in IndexedDB via `localforage` (`getOrCreateSecretKey`) — never transmitted anywhere except as a signature. Exportable as a 64-hex-char `.txt` file; importable the same way. Switching keys (`generateNewKey`/`importSecretKey`) clears `_lastPublishedPlan`, since a retry under the old key's stashed state would sign a new data event under the new key while the already-published index event stays signed by the old one.

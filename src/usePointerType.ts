import { useSyncExternalStore } from 'react';

type PointerKind = 'touch' | 'mouse';

let currentPointerType: PointerKind = 'mouse';
const listeners = new Set<() => void>();

function handlePointerDown(e: PointerEvent) {
    const next: PointerKind = e.pointerType === 'touch' ? 'touch' : 'mouse';
    if (next !== currentPointerType) {
        currentPointerType = next;
        listeners.forEach((listener) => listener());
    }
}

let listenerAttached = false;

function subscribe(listener: () => void): () => void {
    if (!listenerAttached) {
        listenerAttached = true;
        window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot(): PointerKind {
    return currentPointerType;
}

/**
 * Tracks whether the most recently used pointer was touch or mouse/pen, so components can
 * adapt gesture handling (e.g. object drag gating) to the active input method. A single shared
 * window listener backs every caller instead of one per instance.
 */
export function usePointerType(): PointerKind {
    return useSyncExternalStore(subscribe, getSnapshot);
}

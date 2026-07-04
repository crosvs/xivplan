import { RefObject, useLayoutEffect, useState } from 'react';

export interface ElementSize {
    width: number;
    height: number;
}

/** Tracks the rendered content-box size of the given element, updating as it resizes. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): ElementSize {
    const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }

        setSize({ width: el.clientWidth, height: el.clientHeight });

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) {
                return;
            }
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(el);

        return () => observer.disconnect();
    }, [ref]);

    return size;
}

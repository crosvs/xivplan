import { useCallback, useEffect, useRef, useState } from 'react';

export interface PanDrag {
    isPanning: boolean;
    startPanning: (x: number, y: number) => void;
}

/**
 * Tracks a mouse-drag gesture and reports its screen-pixel delta via `onPan` as it moves.
 * Listens on the window (rather than whatever element the gesture started on) so a fast
 * drag that briefly leaves the stage, or a mouseup outside it, doesn't get stuck mid-pan.
 */
export function usePanDrag(onPan: (dx: number, dy: number) => void): PanDrag {
    const [isPanning, setIsPanning] = useState(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    const startPanning = useCallback((x: number, y: number) => {
        setIsPanning(true);
        lastPointRef.current = { x, y };
    }, []);

    useEffect(() => {
        if (!isPanning) {
            return;
        }

        const onWindowMouseMove = (e: MouseEvent) => {
            if (!lastPointRef.current) {
                return;
            }
            const dx = e.clientX - lastPointRef.current.x;
            const dy = e.clientY - lastPointRef.current.y;
            lastPointRef.current = { x: e.clientX, y: e.clientY };
            onPan(dx, dy);
        };
        const onWindowMouseUp = () => {
            setIsPanning(false);
            lastPointRef.current = null;
        };

        window.addEventListener('mousemove', onWindowMouseMove);
        window.addEventListener('mouseup', onWindowMouseUp);
        return () => {
            window.removeEventListener('mousemove', onWindowMouseMove);
            window.removeEventListener('mouseup', onWindowMouseUp);
        };
    }, [isPanning, onPan]);

    return { isPanning, startPanning };
}

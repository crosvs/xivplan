import { KonvaEventObject } from 'konva/lib/Node';
import React, { useLayoutEffect } from 'react';
import { Rect } from 'react-konva';
import { useDefaultCursor } from '../cursor';
import { useSpacebarHeld } from '../useSpacebarHeld';
import { useStage } from './stage';
import { usePanDrag } from './usePanDrag';

export interface PanTargetProps {
    onPan: (dx: number, dy: number) => void;
    /** Whether a middle/right-click drag pan (tracked outside this component, at the Stage
     * level so it works even when starting on top of an object) is currently in progress. */
    isButtonPanning?: boolean;
}

/**
 * While the spacebar is held, covers the whole stage (topmost layer, so it takes
 * priority over object dragging/selection and the draw tool) and translates the view
 * by however far the mouse moves, like the hand tool in most drawing/design apps.
 *
 * Also owns the "grab"/"grabbing" cursor for middle/right-click panning, since that lives
 * outside this component but needs the same DefaultCursorContext, which is only reachable
 * from inside the Stage's provider subtree.
 */
export const PanTarget: React.FC<PanTargetProps> = ({ onPan, isButtonPanning }) => {
    const spaceHeld = useSpacebarHeld();
    const stage = useStage();
    const [, setDefaultCursor] = useDefaultCursor();
    const { isPanning, startPanning } = usePanDrag(onPan);
    const activelyPanning = isPanning || isButtonPanning;

    useLayoutEffect(() => {
        if (!stage || !(spaceHeld || isButtonPanning)) {
            return;
        }

        setDefaultCursor('grab');
        stage.container().style.cursor = activelyPanning ? 'grabbing' : 'grab';

        return () => {
            setDefaultCursor('default');
            stage.container().style.cursor = 'default';
        };
    }, [stage, spaceHeld, isButtonPanning, activelyPanning, setDefaultCursor]);

    if (!spaceHeld || !stage) {
        return null;
    }

    const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
        startPanning(e.evt.clientX, e.evt.clientY);
        e.cancelBubble = true;
    };

    return (
        <Rect
            width={stage.width()}
            height={stage.height()}
            fill="transparent"
            onMouseDown={onMouseDown}
            onClick={(e) => (e.cancelBubble = true)}
        />
    );
};

import { KonvaEventObject } from 'konva/lib/Node';
import { Vector2d } from 'konva/lib/types';
import React, { PropsWithChildren, useRef } from 'react';
import { Group } from 'react-konva';
import { useIsAllowedConnectionTarget, useUpdateConnectedIdsAction } from '../connections';
import { EditMode } from '../editMode';
import { isMoveable, SceneObject } from '../scene';
import { useScene } from '../SceneProvider';
import {
    addSelection,
    removeSelection,
    selectNone,
    selectSingle,
    toggleSelection,
    useSelection,
    useSpotlight,
} from '../selection';
import { TOUCH_MOVE_SLOP } from '../touchTuning';
import { useEditMode } from '../useEditMode';
import { usePointerType } from '../usePointerType';
import { usePreviewMode } from '../usePreviewMode';

// How long a touch must be held in place before it selects the object.
const HOLD_DURATION_MS = 450;

/** Konva node name marking every selectable scene object, so other code (SceneRenderer's touch
 * handling) can recognize "this is a scene object" from a raw Konva event target. */
export const SELECTABLE_OBJECT_NAME = 'selectable-object';

export interface SelectableObjectProps extends PropsWithChildren {
    object: SceneObject;
}

export const SelectableObject: React.FC<SelectableObjectProps> = ({ object, children }) => {
    const [selection, setSelection] = useSelection();
    const [spotlight, setSpotlight] = useSpotlight();
    const [editMode, setEditMode] = useEditMode();
    const [previewMode] = usePreviewMode();
    const { dispatch } = useScene();
    const isAllowedConnectionTarget = useIsAllowedConnectionTarget(object.id);
    const getUpdateConnectionIdsAction = useUpdateConnectedIdsAction();
    const isSelectable = !previewMode && (editMode === EditMode.Normal || editMode === EditMode.SelectConnection);
    const isTouch = usePointerType() === 'touch';

    const holdTimerRef = useRef<number | null>(null);
    const holdStartRef = useRef<Vector2d | null>(null);

    const cancelHold = () => {
        if (holdTimerRef.current !== null) {
            window.clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
        holdStartRef.current = null;
    };

    const onClick = (e: KonvaEventObject<MouseEvent>) => {
        if (editMode == EditMode.SelectConnection) {
            if (isMoveable(object) && isAllowedConnectionTarget) {
                dispatch(getUpdateConnectionIdsAction(object));
                setEditMode(EditMode.Normal);
            }
            // If an object is clicked that is not a valid connection while in this mode, do nothing.
        } else if (isTouch) {
            // Touch selects via a deliberate hold (see onTouchStart/Move/End below) instead of a
            // quick tap, so a tap-and-drag gesture starting on an object can still be interpreted
            // as panning the canvas (see SceneRenderer) rather than always hijacking selection.
        } else if (e.evt.shiftKey) {
            setSelection(addSelection(selection, object.id));
        } else if (e.evt.ctrlKey) {
            setSelection(toggleSelection(selection, object.id));
        } else {
            setSelection(selectSingle(object.id));
        }

        e.cancelBubble = true;
    };

    const onMouseEnter = () => {
        if (editMode == EditMode.SelectConnection) {
            if (isAllowedConnectionTarget) {
                setSpotlight(selectSingle(object.id));
            } else {
                setSpotlight(selectNone());
            }
        }
    };
    const onMouseLeave = () => {
        // don't selectNone() to avoid overriding another object's onMouseEnter
        setSpotlight(removeSelection(spotlight, object.id));
    };

    const onTouchStart = (e: KonvaEventObject<TouchEvent>) => {
        // Not a single-finger tap, already selected (Konva's own drag takes over instead -- see
        // DraggableObject), or connecting tethers (always immediate, no hold needed there).
        if (editMode === EditMode.SelectConnection || e.evt.touches.length !== 1 || selection.has(object.id)) {
            return;
        }

        const touch = e.evt.touches[0]!;
        holdStartRef.current = { x: touch.clientX, y: touch.clientY };
        if (holdTimerRef.current !== null) {
            window.clearTimeout(holdTimerRef.current);
        }
        holdTimerRef.current = window.setTimeout(() => {
            holdTimerRef.current = null;
            setSelection(selectSingle(object.id));
        }, HOLD_DURATION_MS);
    };

    const onTouchMove = (e: KonvaEventObject<TouchEvent>) => {
        const start = holdStartRef.current;
        if (!start || e.evt.touches.length !== 1) {
            cancelHold();
            return;
        }
        const touch = e.evt.touches[0]!;
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TOUCH_MOVE_SLOP) {
            cancelHold();
        }
    };

    return (
        <Group
            // Lets SceneRenderer's touch handling distinguish "tapped a scene object" (e.g. the
            // arena background, a separate non-interactive shape) from a true empty-space tap,
            // since touch events aren't consumed the way onClick's cancelBubble stops a mouse
            // click from ever reaching the Stage.
            name={SELECTABLE_OBJECT_NAME}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={isSelectable ? onClick : undefined}
            onTouchStart={isSelectable ? onTouchStart : undefined}
            onTouchMove={isSelectable ? onTouchMove : undefined}
            onTouchEnd={isSelectable ? cancelHold : undefined}
        >
            {children}
        </Group>
    );
};

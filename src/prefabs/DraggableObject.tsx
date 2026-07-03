import { KonvaEventObject } from 'konva/lib/Node';
import React, { Dispatch, ReactNode, useRef } from 'react';
import { omitInterconnectedObjects } from '../connections';
import { getCanvasCoord, getSceneCoord, makeRelative, Position } from '../coord';
import { CrossStepSelection } from '../CrossStepContext';
import { CursorGroup } from '../CursorGroup';
import { EditMode } from '../editMode';
import { moveObjectsBy } from '../groupOperations';
import { isMoveable, MoveableObject, Scene, SceneObject, SceneStep, UnknownObject } from '../scene';
import { SceneAction, useScene } from '../SceneProvider';
import {
    getNewDragSelection,
    getSelectedObjects,
    selectNone,
    selectSingle,
    useCrossStepSelection,
    useDragSelection,
    useSelection,
} from '../selection';
import { SceneSelection } from '../SelectionContext';
import { useEditMode } from '../useEditMode';
import { usePreviewMode } from '../usePreviewMode';
import { vecSub } from '../vector';
import { SelectableObject } from './SelectableObject';
import { TetherTarget } from './TetherTarget';

export interface DraggableObjectProps {
    object: MoveableObject & UnknownObject;
    children?: ReactNode;
}

export const DraggableObject: React.FC<DraggableObjectProps> = ({ object, children }) => {
    const [editMode] = useEditMode();
    const [previewMode] = usePreviewMode();
    const { scene, step, stepIndex, dispatch } = useScene();
    const [selection, setSelection] = useSelection();
    const [dragSelection, setDragSelection] = useDragSelection();
    const { selection: crossStepSelection } = useCrossStepSelection();
    const center = getCanvasCoord(scene, object);

    // Position of the dragged object at the start of the current drag, used to
    // compute the total start-to-end translation once the drag finishes so it
    // can be applied to the selected objects on other (non-visible) pages.
    const dragStartPos = useRef<Position | null>(null);

    const isDraggable = !object.pinned && !previewMode && editMode === EditMode.Normal;

    const handleDragStart = (e: KonvaEventObject<DragEvent>) => {
        let newSelection: SceneSelection;
        if (editMode == EditMode.SelectConnection) {
            return;
        }

        // If we start dragging an object that isn't selected, it should
        // become the new selection.
        if (!selection.has(object.id)) {
            newSelection = selectSingle(object.id);
            setSelection(newSelection);
        } else {
            newSelection = getNewDragSelection(step, selection);
        }

        setDragSelection(newSelection);
        dragStartPos.current = { x: object.x, y: object.y, positionParentId: object.positionParentId };

        updatePosition(scene, step, object, dragSelection, e, dispatch);
    };

    const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
        updatePosition(scene, step, object, dragSelection, e, dispatch);
    };

    const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
        updatePosition(scene, step, object, dragSelection, e, dispatch);

        // Only now, once the drag is finished, apply the same start-to-end
        // translation to the matching objects selected on other pages. Doing
        // this on every drag-move frame would require touching every page's
        // objects on each mouse move, which is wasted work since those pages
        // aren't visible during the drag anyway.
        if (dragStartPos.current) {
            applyCrossStepDrag(
                scene,
                stepIndex,
                dragSelection,
                crossStepSelection,
                object,
                dragStartPos.current,
                e,
                dispatch,
            );
        }
        dragStartPos.current = null;

        dispatch({ type: 'commit' });

        setDragSelection(selectNone());
    };

    // TODO: Konva moves the shape immediately before calling the dragMove event,
    // so the object being dragged is always one frame ahead of the rest of the
    // state. Is there any way to delay the render until the event is handled,
    // or do we need to implement our own drag logic to replace Konva's?
    return (
        <SelectableObject object={object}>
            <TetherTarget object={object}>
                <CursorGroup
                    {...center}
                    cursor={editMode === EditMode.SelectConnection ? 'pointer' : isDraggable ? 'move' : undefined}
                    draggable={isDraggable}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                >
                    {children}
                </CursorGroup>
            </TetherTarget>
        </SelectableObject>
    );
};

function updatePosition(
    scene: Scene,
    step: SceneStep,
    targetObject: MoveableObject & UnknownObject,
    dragSelection: SceneSelection,
    e: KonvaEventObject<DragEvent>,
    dispatch: Dispatch<SceneAction>,
) {
    // Konva automatically moves the object to e.target.position() in canvas
    // coordinates. Subtracting the object's original position gives the offset
    // that needs to be applied to all objects being dragged.
    const pos = makeRelative(scene, getSceneCoord(scene, e.target.position()), targetObject.positionParentId);
    const offset = vecSub(pos, targetObject);

    if (offset.x === 0 && offset.y === 0) {
        return;
    }

    const draggedObjects = omitInterconnectedObjects(scene, getSelectedObjects(step, dragSelection).filter(isMoveable));
    const value = moveObjectsBy(draggedObjects, offset);

    dispatch({ type: 'update', value, transient: true });
}

/**
 * Applies the total start-to-end translation of a finished drag to the
 * matching objects selected on other pages via the cross-step ("select
 * similar on all pages") selection. Only runs once, at drag end, since those
 * pages aren't visible during the drag itself.
 */
function applyCrossStepDrag(
    scene: Scene,
    currentStepIndex: number,
    dragSelection: SceneSelection,
    crossStepSelection: CrossStepSelection,
    targetObject: MoveableObject & UnknownObject,
    dragStartPos: Position,
    e: KonvaEventObject<DragEvent>,
    dispatch: Dispatch<SceneAction>,
) {
    if (crossStepSelection.size === 0) {
        return;
    }

    // Only propagate to other pages if the objects being dragged on this page
    // are actually part of the cross-step selection -- otherwise this is just
    // an unrelated drag that happens to occur while a cross-step selection is
    // active elsewhere.
    const currentStepCrossSelection = crossStepSelection.get(currentStepIndex);
    if (!currentStepCrossSelection || ![...dragSelection].some((id) => currentStepCrossSelection.has(id))) {
        return;
    }

    const finalPos = makeRelative(scene, getSceneCoord(scene, e.target.position()), targetObject.positionParentId);
    const offset = vecSub(finalPos, dragStartPos);

    if (offset.x === 0 && offset.y === 0) {
        return;
    }

    const value: SceneObject[] = [];
    for (const [stepIdx, ids] of crossStepSelection) {
        if (stepIdx === currentStepIndex) {
            continue;
        }

        const otherStep = scene.steps[stepIdx];
        if (!otherStep) {
            continue;
        }

        const objects = omitInterconnectedObjects(
            scene,
            otherStep.objects.filter((o) => ids.has(o.id)).filter(isMoveable),
        );
        value.push(...moveObjectsBy(objects, offset));
    }

    if (value.length > 0) {
        dispatch({ type: 'update', value, transient: true });
    }
}

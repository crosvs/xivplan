import { Dispatch } from 'react';
import { CrossStepSelection } from './CrossStepContext';
import { SceneAction } from './SceneProvider';
import { Scene, SceneObject } from './scene';

/**
 * Applies `applyChange` to every object matching the target object's cross-step ("select
 * similar objects on other pages") selection, on every other step, committing them all in one
 * dispatch. No-ops unless the target object is itself part of an active cross-step selection on
 * the current step -- mirrors DraggableObject's applyCrossStepDrag, generalized for changes other
 * than a plain position offset (e.g. resize, rotate).
 */
export function applyCrossStepChange(
    scene: Scene,
    currentStepIndex: number,
    crossStepSelection: CrossStepSelection,
    targetObjectId: number,
    applyChange: (object: SceneObject) => SceneObject,
    dispatch: Dispatch<SceneAction>,
): void {
    if (crossStepSelection.size === 0) {
        return;
    }

    const currentStepCrossSelection = crossStepSelection.get(currentStepIndex);
    if (!currentStepCrossSelection || !currentStepCrossSelection.has(targetObjectId)) {
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

        for (const object of otherStep.objects) {
            if (ids.has(object.id)) {
                value.push(applyChange(object));
            }
        }
    }

    if (value.length > 0) {
        dispatch({ type: 'update', value, transient: true });
    }
}

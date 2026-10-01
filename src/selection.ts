import { use, useMemo } from 'react';
import { CrossStepContext, type CrossStepContextValue, type SimilarityFilters } from './CrossStepContext';
import { useScene } from './SceneProvider';
import {
    DragSelectionContext,
    type SceneSelection,
    SelectionContext,
    type SelectionState,
    SpotlightContext,
} from './SelectionContext';
import { getAbsoluteRotationInStep } from './coord';
import { isMoveable, isRotateable, isTether, type Scene, type SceneObject, type SceneStep } from './scene';
import { mod360 } from './util';

/**
 * State for selected objects.
 */
export function useSelection(): SelectionState {
    return use(SelectionContext);
}

/**
 * State for objects that should be highlighted in the scene.
 */
export function useSpotlight(): SelectionState {
    return use(SpotlightContext);
}

/**
 * State for objects currently being dragged.
 */
export function useDragSelection(): SelectionState {
    return use(DragSelectionContext);
}

/**
 * Gets whether the given object is in the drag selection.
 */
export function useIsDragging(object: SceneObject) {
    return useDragSelection()[0].has(object.id);
}

/**
 * Gets the objects in the given step whose IDs are in the given selection.
 */
export function getSelectedObjects(step: SceneStep, selection: SceneSelection): readonly SceneObject[] {
    return step.objects.filter((object) => selection.has(object.id));
}

/**
 * Gets the objects in the given step and selection which should be set as the
 * drag selection when starting a drag operation.
 */
export function getNewDragSelection(step: SceneStep, selection: SceneSelection): SceneSelection {
    return new Set(
        getSelectedObjects(step, selection)
            .filter(isMoveable)
            .map((obj) => obj.id),
    );
}

/**
 * Gets a new selection with only the given ID.
 */
export function selectSingle(id: number): SceneSelection {
    return new Set([id]);
}

/**
 * Gets a new, empty selection.
 */
export function selectNone(): SceneSelection {
    return new Set();
}

/**
 * Gets a new selection which contains all of the given objects.
 */
export function selectAll(objects: readonly SceneObject[]): SceneSelection {
    return new Set(objects.map((object) => object.id));
}

/**
 * Gets a new selection which contains a given number of objects which have yet
 * to be created. Use this when creating new objects in order to make them be
 * selected after they are created.
 */
export function selectNewObjects(scene: Scene, newObjectCount: number): SceneSelection {
    return new Set(Array.from({ length: newObjectCount }).map((_, i) => scene.nextId + i));
}

/**
 * Gets a new selection from the given selection with a new ID added.
 */
export function addSelection(selection: SceneSelection, id: number): SceneSelection {
    return new Set(selection).add(id);
}

/**
 * Gets a new selection from the given selection with an ID removed if it was
 * in the selection.
 */
export function removeSelection(selection: SceneSelection, id: number): SceneSelection {
    const newSelection = new Set(selection);
    newSelection.delete(id);
    return newSelection;
}

/**
 * Gets a new selection from the given selection with an ID added if it was not
 * in the selection or removed if it was.
 */
export function toggleSelection(selection: SceneSelection, id: number): SceneSelection {
    if (selection.has(id)) {
        return removeSelection(selection, id);
    } else {
        return addSelection(selection, id);
    }
}

/**
 * Returns the full cross-step selection context (selection map, mode, tolerance, setters).
 */
export function useCrossStepSelection(): CrossStepContextValue {
    return use(CrossStepContext);
}

/**
 * Returns the objects to edit in the Properties panel.
 * When a cross-step selection is active, returns objects from all selected steps.
 * Otherwise returns the selected objects on the current step.
 *
 * The current step's objects are read from the live (transient) scene so values
 * update as the user drags. Other steps are read from the canonical (pre-transient)
 * scene, since they never change mid-drag -- this keeps a drag on the current step
 * from re-filtering every other selected step's objects on every mouse-move frame.
 */
export function useEditableObjects(): readonly SceneObject[] {
    const { canonicalScene, step, stepIndex } = useScene();
    const [selection] = useSelection();
    const { selection: crossStep } = use(CrossStepContext);

    const currentStepObjects = useMemo(() => {
        const ids = crossStep.get(stepIndex);
        if (ids) {
            return step.objects.filter((o) => ids.has(o.id));
        }
        return crossStep.size > 0 ? [] : getSelectedObjects(step, selection);
    }, [step, stepIndex, selection, crossStep]);

    const otherStepsObjects = useMemo(() => {
        if (crossStep.size === 0) {
            return [];
        }

        const result: SceneObject[] = [];
        for (const [stepIdx, ids] of crossStep) {
            if (stepIdx === stepIndex) {
                continue;
            }
            const s = canonicalScene.steps[stepIdx];
            if (s) {
                result.push(...s.objects.filter((o) => ids.has(o.id)));
            }
        }
        return result;
    }, [canonicalScene, stepIndex, crossStep]);

    return useMemo(
        () => (otherStepsObjects.length > 0 ? [...currentStepObjects, ...otherStepsObjects] : currentStepObjects),
        [currentStepObjects, otherStepsObjects],
    );
}

/**
 * Fields that describe an object's identity, placement, or relationships rather than its size and
 * shape, so the "Size & Shape" filter ignores them. Placement and relationships have their own
 * filters (position, rotation, linked to).
 */
const NON_SHAPE_FIELDS: ReadonlySet<string> = new Set([
    'id',
    'type',
    'trackId',
    'animation',
    'opacity',
    'pinned',
    'name',
    'text',
    'x',
    'y',
    'rotation',
    'positionParentId',
    'facingId',
    'facingOffset',
    'startId',
    'endId',
]);

type ShapeValue = string | number | boolean;

/**
 * Gets the scalar size/shape/style fields of an object, e.g. width, height, radius, length, color,
 * tether style, arrowheads, or hollow. Every scalar field not in NON_SHAPE_FIELDS is included, so
 * object-specific settings are compared without having to list them for each object type.
 */
function getShapeFields(obj: SceneObject): Map<string, ShapeValue> {
    const fields = new Map<string, ShapeValue>();
    for (const [key, value] of Object.entries(obj)) {
        if (NON_SHAPE_FIELDS.has(key)) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            fields.set(key, value);
        }
    }
    return fields;
}

/** A missing optional field is treated the same as `false`, e.g. `hide`, `hollow`, or `arrowBegin`. */
function shapeFieldValue(fields: ReadonlyMap<string, ShapeValue>, key: string): ShapeValue {
    return fields.get(key) ?? false;
}

/**
 * Gets the shape fields that all of the given objects agree on. Fields the objects disagree on are
 * left out, so they don't restrict which objects are considered similar.
 */
function getTemplateShapeKey(objects: readonly SceneObject[]): ReadonlyMap<string, ShapeValue> | null {
    const first = objects[0];
    if (!first || !objects.every((o) => o.type === first.type)) return null;

    const allFields = objects.map(getShapeFields);
    const keys = new Set(allFields.flatMap((fields) => [...fields.keys()]));
    const firstFields = allFields[0]!;

    const key = new Map<string, ShapeValue>();
    for (const k of keys) {
        const value = shapeFieldValue(firstFields, k);
        if (allFields.every((fields) => shapeFieldValue(fields, k) === value)) {
            key.set(k, value);
        }
    }
    return key;
}

function matchesShapeKey(obj: SceneObject, key: ReadonlyMap<string, ShapeValue>): boolean {
    const fields = getShapeFields(obj);
    for (const [k, value] of key) {
        if (shapeFieldValue(fields, k) !== value) return false;
    }
    return true;
}

/** Gets the IDs of every object this object is linked to: tether ends, position parent, and facing target. */
function getLinkTargets(obj: SceneObject): number[] {
    const targets: number[] = [];
    if (isTether(obj)) {
        targets.push(obj.startId, obj.endId);
    }
    if (isMoveable(obj) && obj.positionParentId !== undefined) {
        targets.push(obj.positionParentId);
    }
    if (isRotateable(obj) && obj.facingId !== undefined) {
        targets.push(obj.facingId);
    }
    return targets;
}

/** Absolute rotation of an object within its own step, or undefined if it can't be rotated. */
function getStepRotation(step: SceneStep, obj: SceneObject): number | undefined {
    return isRotateable(obj) && isMoveable(obj) ? getAbsoluteRotationInStep(step, obj) : undefined;
}

/** Smallest difference between two angles in degrees, in the range [0, 180]. */
function angleDifference(a: number, b: number): number {
    const diff = Math.abs(mod360(a) - mod360(b));
    return Math.min(diff, 360 - diff);
}

export type AvailableFilters = SimilarityFilters;

const NO_FILTERS_AVAILABLE: AvailableFilters = {
    trackId: false,
    properties: false,
    position: false,
    rotation: false,
    linkedTo: false,
};

/**
 * Returns which filter pills are applicable for the current selection.
 * trackId: any selected object has a trackId.
 * properties: all selected objects share the same type.
 * position: same as properties and at least one selected object is moveable.
 * rotation: same as properties and at least one selected object is rotateable.
 * linkedTo: same as properties and at least one selected object is linked to another object.
 */
export function useAvailableFilters(): AvailableFilters {
    const { step } = useScene();
    const [selection] = useSelection();

    return useMemo(() => {
        const selected = getSelectedObjects(step, selection);
        if (!selected.length) return NO_FILTERS_AVAILABLE;

        const firstType = selected[0]!.type;
        const homogeneous = selected.every((o) => o.type === firstType);

        return {
            trackId: selected.some((o) => Boolean(o.trackId)),
            properties: homogeneous,
            position: homogeneous && selected.some(isMoveable),
            rotation: homogeneous && selected.some((o) => getStepRotation(step, o) !== undefined),
            linkedTo: homogeneous && selected.some((o) => getLinkTargets(o).length > 0),
        };
    }, [step, selection]);
}

export interface SimilarityTolerances {
    /** Maximum distance in X and Y for the position filter. */
    position: number;
    /** Maximum difference in degrees for the rotation filter. */
    rotation: number;
}

/**
 * Finds similar objects across all steps based on the active similarity filters.
 * Returns a map of stepIndex → set of matching objectIds.
 * Returns an empty map when no filters are active or the selection is empty/heterogeneous.
 *
 * Reads from the canonical (pre-transient) scene rather than the live scene, since
 * this is a read-only UI derivation that doesn't need to track a drag frame-by-frame --
 * doing so would re-scan every object on every selected step on every mouse-move.
 */
export function useSimilarObjects(
    filters: SimilarityFilters,
    tolerances: SimilarityTolerances,
): ReadonlyMap<number, ReadonlySet<number>> {
    const { canonicalScene, stepIndex } = useScene();
    const [selection] = useSelection();
    const {
        trackId: filterTrackId,
        properties: filterProperties,
        position: filterPosition,
        rotation: filterRotation,
        linkedTo: filterLinkedTo,
    } = filters;
    const { position: positionTolerance, rotation: rotationTolerance } = tolerances;

    return useMemo(() => {
        if (!filterTrackId && !filterProperties && !filterPosition && !filterRotation && !filterLinkedTo) {
            return new Map();
        }

        const step = canonicalScene.steps[stepIndex];
        if (!step) return new Map();

        const selectedObjects = getSelectedObjects(step, selection);
        if (!selectedObjects.length) return new Map();

        const firstType = selectedObjects[0]!.type;
        if (!selectedObjects.every((o) => o.type === firstType)) return new Map();

        const trackIds = filterTrackId
            ? new Set(selectedObjects.map((o) => o.trackId).filter((id): id is string => Boolean(id)))
            : null;
        if (filterTrackId && (!trackIds || !trackIds.size)) return new Map();

        const shapeKey = filterProperties ? getTemplateShapeKey(selectedObjects) : null;
        if (filterProperties && !shapeKey) return new Map();

        const moveableTemplates = filterPosition ? selectedObjects.filter(isMoveable) : null;

        const templateRotations = filterRotation
            ? selectedObjects.map((o) => getStepRotation(step, o)).filter((r) => r !== undefined)
            : null;

        // Objects on other steps are copies with different IDs, so a link target is recognized
        // there by its trackId. Targets without one can only be matched on the current step.
        const linkTargetIds = filterLinkedTo ? new Set(selectedObjects.flatMap(getLinkTargets)) : null;
        const linkTargetTrackIds = linkTargetIds
            ? new Set(
                  step.objects
                      .filter((o) => linkTargetIds.has(o.id))
                      .map((o) => o.trackId)
                      .filter((id): id is string => Boolean(id)),
              )
            : null;

        const result = new Map<number, Set<number>>();

        canonicalScene.steps.forEach((s, stepIdx) => {
            let stepLinkTargets: ReadonlySet<number> | null = null;
            if (linkTargetIds && linkTargetTrackIds) {
                stepLinkTargets =
                    stepIdx === stepIndex
                        ? linkTargetIds
                        : new Set(
                              s.objects
                                  .filter((o) => o.trackId !== undefined && linkTargetTrackIds.has(o.trackId))
                                  .map((o) => o.id),
                          );
            }

            const matches = s.objects.filter((o) => {
                if (o.type !== firstType) return false;
                if (trackIds !== null && (!o.trackId || !trackIds.has(o.trackId))) return false;
                if (shapeKey !== null && !matchesShapeKey(o, shapeKey)) return false;
                if (moveableTemplates !== null) {
                    if (!isMoveable(o)) return false;
                    if (
                        !moveableTemplates.some(
                            (t) => Math.abs(o.x - t.x) <= positionTolerance && Math.abs(o.y - t.y) <= positionTolerance,
                        )
                    )
                        return false;
                }
                if (templateRotations !== null) {
                    const rotation = getStepRotation(s, o);
                    if (rotation === undefined) return false;
                    if (!templateRotations.some((t) => angleDifference(rotation, t) <= rotationTolerance)) return false;
                }
                if (stepLinkTargets !== null && !getLinkTargets(o).some((id) => stepLinkTargets.has(id))) {
                    return false;
                }
                return true;
            });
            if (matches.length) {
                result.set(stepIdx, new Set(matches.map((m) => m.id)));
            }
        });

        return result;
    }, [
        canonicalScene,
        stepIndex,
        selection,
        filterTrackId,
        filterProperties,
        filterPosition,
        filterRotation,
        filterLinkedTo,
        positionTolerance,
        rotationTolerance,
    ]);
}

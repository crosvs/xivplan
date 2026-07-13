import Konva from 'konva';
import { KonvaEventObject } from 'konva/lib/Node';
import { Vector2d } from 'konva/lib/types';
import React, { PropsWithChildren, RefAttributes, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Layer, Stage } from 'react-konva';
import { DefaultCursorProvider } from '../DefaultCursorProvider';
import { getDropAction } from '../DropHandler';
import { SceneHotkeyHandler } from '../HotkeyHandler';
import { EditorState, SceneAction, SceneContext, useCurrentStep, useScene } from '../SceneProvider';
import { SelectionContext, SelectionState, SpotlightContext } from '../SelectionContext';
import { getCanvasSize, getSceneCoord } from '../coord';
import { EditMode } from '../editMode';
import { Scene } from '../scene';
import { selectNewObjects, selectNone, useCrossStepSelection, useSelection } from '../selection';
import { UndoContext } from '../undo/undoContext';
import { CONTROL_POINT_NAME } from '../prefabs/ControlPoint';
import { SELECTABLE_OBJECT_NAME } from '../prefabs/SelectableObject';
import { TOUCH_MOVE_SLOP } from '../touchTuning';
import { useEditMode } from '../useEditMode';
import { useElementSize } from '../useElementSize';
import { usePanelDrag } from '../usePanelDrag';
import { usePreviewMode } from '../usePreviewMode';
import { clamp } from '../util';
import { MAX_ZOOM, MIN_ZOOM, ViewTransform } from '../ViewTransformContext';
import { useViewTransform } from '../useViewTransform';
import { StaticPlaybackProvider, useDisplayObjects, useOptionalPlayback } from '../playback/PlaybackContext';
import { ArenaRenderer } from './ArenaRenderer';
import { DisplayObjectsContext } from './DisplayObjectsContext';
import { DrawTarget } from './DrawTarget';
import { ObjectRenderer } from './ObjectRenderer';
import { PanTarget } from './PanTarget';
import { StageContext } from './StageContext';
import { TetherEditRenderer } from './TetherEditRenderer';
import { usePanDrag } from './usePanDrag';
import { LayerName } from './layers';

const WHEEL_ZOOM_SPEED = 1.05;

function getTouchDistance(touches: TouchList): number {
    return Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
}

function getTouchMidpoint(touches: TouchList): Vector2d {
    return {
        x: (touches[0]!.clientX + touches[1]!.clientX) / 2,
        y: (touches[0]!.clientY + touches[1]!.clientY) / 2,
    };
}

/** Walks up from `target` through Konva ancestors (up to but excluding the Stage), returning
 * true if any node along the way satisfies `predicate`. */
function hasAncestorMatching(target: Konva.Node, predicate: (node: Konva.Node) => boolean): boolean {
    let node: Konva.Node | null = target;
    while (node && !(node instanceof Konva.Stage)) {
        if (predicate(node)) {
            return true;
        }
        node = node.getParent();
    }
    return false;
}

/** Whether this node or one of its ancestors will claim the gesture as a drag. */
function isDraggableTarget(target: Konva.Node): boolean {
    return hasAncestorMatching(target, (node) => node.draggable());
}

/**
 * Whether this node or one of its ancestors is a scene object (as opposed to background/arena
 * decoration, which isn't the literal Stage but should still count as "empty" for tap-to-deselect
 * purposes -- unlike a mouse click, a touch isn't stopped from reaching the Stage by an object's
 * own handler, so target identity has to be checked explicitly instead of relying on bubbling.
 */
function isSelectableObjectTarget(target: Konva.Node): boolean {
    return hasAncestorMatching(target, (node) => node.hasName(SELECTABLE_OBJECT_NAME));
}

/**
 * Whether this node or one of its ancestors is a control-point handle (arc/star/donut/line
 * resize/rotate handles etc.) -- these implement their own manual pointer-drag tracking rather
 * than Konva's declarative `draggable`, so they need their own check to keep a touch on them
 * from also arming canvas panning.
 */
function isControlPointTarget(target: Konva.Node): boolean {
    return hasAncestorMatching(target, (node) => node.hasName(CONTROL_POINT_NAME));
}

/** Rescales/repositions the view so the given screen point stays under the cursor/fingers. */
function zoomAroundPoint(transform: ViewTransform, point: Vector2d, newScale: number): ViewTransform {
    const scale = clamp(newScale, MIN_ZOOM, MAX_ZOOM);
    const scenePoint = { x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale };

    return {
        scale,
        x: point.x - scenePoint.x * scale,
        y: point.y - scenePoint.y * scale,
    };
}

export const SceneRenderer: React.FC = () => {
    const { scene } = useScene();
    const [, setSelection] = useContext(SelectionContext);
    const { setSelection: setCrossStep } = useCrossStepSelection();
    const arenaSize = getCanvasSize(scene);
    const containerRef = useRef<HTMLDivElement>(null);
    const { width: containerWidth, height: containerHeight } = useElementSize(containerRef);
    const [stage, stageRef] = useState<Konva.Stage | null>(null);
    const [editMode] = useEditMode();
    const [previewMode] = usePreviewMode();
    const [transform, setTransform] = useViewTransform();

    // Tracks in-progress single-finger pan / two-finger pinch gestures between touch events.
    const touchPanRef = useRef<Vector2d | null>(null);
    const touchPinchRef = useRef<{ distance: number; midpoint: Vector2d } | null>(null);
    // Start point of the current single-finger touch gesture, and whether it began on empty
    // canvas -- used to detect "this was a tap on empty space" at touch-end, independent of
    // Konva's own click/tap synthesis (which real touch jitter can make unreliable).
    const touchStartRef = useRef<{ point: Vector2d; onEmpty: boolean } | null>(null);

    // The Stage itself always fills the available container (so panels appearing/disappearing,
    // e.g. toggling preview mode, or the window resizing, immediately uses the freed-up space)
    // instead of being fixed at the arena's native pixel size. Whenever that container or the
    // arena's own size changes, refit the view so the whole arena is visible and centered --
    // this intentionally resets any manual pan/zoom, since the available space just changed
    // out from under it anyway.
    //
    // This has to be an effect (not adjusted during render) because the transform now lives
    // in ViewTransformProvider, an ancestor of this component -- React disallows updating an
    // ancestor's state during a descendant's render.
    useEffect(() => {
        if (containerWidth === 0 || containerHeight === 0) {
            return;
        }

        const scale = clamp(
            Math.min(containerWidth / arenaSize.width, containerHeight / arenaSize.height),
            MIN_ZOOM,
            MAX_ZOOM,
        );

        setTransform({
            scale,
            x: (containerWidth - arenaSize.width * scale) / 2,
            y: (containerHeight - arenaSize.height * scale) / 2,
        });
    }, [containerWidth, containerHeight, arenaSize.width, arenaSize.height, setTransform]);

    // Preview mode preserves whatever was selected when it was turned on, so clicking/tapping
    // around the canvas while previewing shouldn't change it. Likewise, clicking/tapping on
    // nothing while selecting a connection target should keep the current selection to better
    // keep the visuals of which objects are going to get connected.
    const deselectAll = () => {
        if (previewMode || editMode === EditMode.SelectConnection) {
            return;
        }
        setSelection(selectNone());
        setCrossStep(new Map());
    };

    const onClickStage = (e: KonvaEventObject<MouseEvent>) => {
        // Clicking on nothing (with no modifier keys held) should cancel all selections.
        if (!e.evt.ctrlKey && !e.evt.shiftKey) {
            deselectAll();
        }
    };

    const onPan = useCallback(
        (dx: number, dy: number) => {
            setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
        },
        [setTransform],
    );

    // Middle/right-click drag pans from anywhere, including on top of objects, regardless
    // of the spacebar. This is handled at the Stage level (rather than via a topmost overlay
    // like the spacebar-pan does) because an always-mounted overlay would swallow every
    // click -- Konva always resolves hit-testing to the topmost shape at a point, with no
    // click-through -- which would break normal left-click object selection/dragging.
    const buttonPan = usePanDrag(onPan);
    const onStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
        if (e.evt.button === 1 || e.evt.button === 2) {
            e.evt.preventDefault();
            buttonPan.startPanning(e.evt.clientX, e.evt.clientY);
        }
    };

    const onWheel = (e: KonvaEventObject<WheelEvent>) => {
        e.evt.preventDefault();
        const pointer = e.target.getStage()?.getPointerPosition();
        if (!pointer) {
            return;
        }

        setTransform((t) => {
            const direction = e.evt.deltaY > 0 ? -1 : 1;
            const newScale = direction > 0 ? t.scale * WHEEL_ZOOM_SPEED : t.scale / WHEEL_ZOOM_SPEED;
            return zoomAroundPoint(t, pointer, newScale);
        });
    };

    const onTouchStart = (e: KonvaEventObject<TouchEvent>) => {
        const touches = e.evt.touches;
        if (touches.length === 1) {
            // A touch that starts on an object which is actually draggable (only true for
            // objects already selected -- see DraggableObject), or on a control-point handle
            // (arc/star/donut/line resize/rotate handles etc., which track their own drag), is
            // left alone so that gesture can take over. Anything else -- empty canvas, or an
            // unselected object -- pans instead, so panning is never blocked by objects in the way.
            if (isDraggableTarget(e.target) || isControlPointTarget(e.target)) {
                touchPanRef.current = null;
                touchPinchRef.current = null;
                touchStartRef.current = null;
                return;
            }
            touchPinchRef.current = null;
            const point = { x: touches[0]!.clientX, y: touches[0]!.clientY };
            touchPanRef.current = point;
            touchStartRef.current = { point, onEmpty: !isSelectableObjectTarget(e.target) };
        } else if (touches.length === 2) {
            e.evt.preventDefault();
            touchPanRef.current = null;
            touchStartRef.current = null;
            touchPinchRef.current = { distance: getTouchDistance(touches), midpoint: getTouchMidpoint(touches) };
        }
    };

    const onTouchMove = (e: KonvaEventObject<TouchEvent>) => {
        const touches = e.evt.touches;
        if (touches.length === 1 && touchPanRef.current) {
            e.evt.preventDefault();
            const point = { x: touches[0]!.clientX, y: touches[0]!.clientY };
            onPan(point.x - touchPanRef.current.x, point.y - touchPanRef.current.y);
            touchPanRef.current = point;
        } else if (touches.length === 2 && touchPinchRef.current) {
            e.evt.preventDefault();
            const stageNode = e.target.getStage();
            const rect = stageNode?.container().getBoundingClientRect();
            if (!rect) {
                return;
            }

            const distance = getTouchDistance(touches);
            const midpoint = getTouchMidpoint(touches);
            const pointer = { x: midpoint.x - rect.left, y: midpoint.y - rect.top };
            const scaleFactor = distance / touchPinchRef.current.distance;
            // Two fingers moving together (not just apart/together) translates the view by the
            // same screen-pixel delta, so a pinch can pan and zoom in the same gesture.
            const dx = midpoint.x - touchPinchRef.current.midpoint.x;
            const dy = midpoint.y - touchPinchRef.current.midpoint.y;

            setTransform((t) => {
                const panned = { ...t, x: t.x + dx, y: t.y + dy };
                return zoomAroundPoint(panned, pointer, t.scale * scaleFactor);
            });
            touchPinchRef.current = { distance, midpoint };
        }
    };

    const onTouchEnd = (e: KonvaEventObject<TouchEvent>) => {
        const touches = e.evt.touches;
        if (touches.length === 0) {
            // A tap (minimal movement) that started on empty canvas deselects. Handled
            // explicitly here, rather than relying solely on Konva's own click/tap synthesis
            // for the Stage, since real touch jitter can make that unreliable.
            const start = touchStartRef.current;
            const last = touchPanRef.current;
            if (
                start?.onEmpty &&
                last &&
                Math.hypot(last.x - start.point.x, last.y - start.point.y) < TOUCH_MOVE_SLOP
            ) {
                deselectAll();
            }
            touchPanRef.current = null;
            touchPinchRef.current = null;
            touchStartRef.current = null;
        } else if (touches.length === 1) {
            // Transitioning from a pinch down to one finger -- resume as a pan.
            touchPinchRef.current = null;
            const point = { x: touches[0]!.clientX, y: touches[0]!.clientY };
            touchPanRef.current = point;
            touchStartRef.current = { point, onEmpty: false };
        }
    };

    return (
        <div
            ref={containerRef}
            style={{ width: '100%', height: '100%' }}
            // Right-click drag pans instead of opening the browser's context menu.
            onContextMenu={(e) => e.preventDefault()}
        >
            {/* Wait for a real measurement before mounting the Stage -- mounting it at 0x0
                while the ResizeObserver hasn't reported yet breaks the react-konva-utils
                Portal components (used for resize handles/text editing) that look up a
                target layer via the stage as soon as they mount. */}
            {containerWidth > 0 && containerHeight > 0 && (
                <DropTarget stage={stage}>
                    <Stage
                        width={containerWidth}
                        height={containerHeight}
                        x={transform.x}
                        y={transform.y}
                        scaleX={transform.scale}
                        scaleY={transform.scale}
                        ref={stageRef}
                        onClick={onClickStage}
                        onMouseDown={onStageMouseDown}
                        onWheel={onWheel}
                        onTouchStart={onTouchStart}
                        onTouchMove={onTouchMove}
                        onTouchEnd={onTouchEnd}
                    >
                        <StageContext value={stage}>
                            <DefaultCursorProvider>
                                <SceneContents onPan={onPan} isButtonPanning={buttonPan.isPanning} />
                            </DefaultCursorProvider>
                        </StageContext>
                    </Stage>
                </DropTarget>
            )}
        </div>
    );
};

export interface ScenePreviewProps extends RefAttributes<Konva.Stage> {
    scene: Scene;
    stepIndex?: number;
    /** Fractional playback time (0 to steps.length-1). Overrides stepIndex for interpolated previews. */
    playbackTime?: number;
    /** Pulse time in seconds for pulse animations. Only relevant when playbackTime is provided. */
    pulseTime?: number;
    width?: number;
    height?: number;
    backgroundColor?: string;
    /** Do not draw complex objects that may slow down rendering. Useful for small previews. */
    simple?: boolean;
    /**
     * Caps the backing canvas resolution of each layer to this device pixel ratio instead of the
     * browser's real one. Konva otherwise sizes every layer's canvas at `window.devicePixelRatio`
     * regardless of how small the Stage is displayed, so a thumbnail-sized preview still rasterizes
     * (and redraws) at full display resolution -- costly when many previews render at once, e.g. a
     * list of per-step thumbnails. Applied via each layer's canvas as soon as the Stage mounts, so
     * the first draw happens at the reduced resolution rather than redoing it after the fact.
     */
    pixelRatio?: number;
}

export const ScenePreview: React.FC<ScenePreviewProps> = ({
    ref,
    scene,
    stepIndex,
    playbackTime,
    pulseTime,
    width,
    height,
    backgroundColor,
    simple,
    pixelRatio: previewPixelRatio,
}) => {
    const handleStageRef = useCallback(
        (stage: Konva.Stage | null) => {
            if (stage && previewPixelRatio) {
                stage.getLayers().forEach((layer) => layer.getCanvas().setPixelRatio(previewPixelRatio));
            }
            if (typeof ref === 'function') {
                ref(stage);
            } else if (ref) {
                ref.current = stage;
            }
        },
        [ref, previewPixelRatio],
    );

    const size = getCanvasSize(scene);
    let scale = 1;
    let x = 0;
    let y = 0;

    if (width) {
        scale = Math.min(scale, width / size.width);
    }
    if (height) {
        scale = Math.min(scale, height / size.height);
    }

    size.width *= scale;
    size.height *= scale;

    if (width) {
        x = (width - size.width) / 2;
    }
    if (height) {
        y = (height - size.height) / 2;
    }

    const resolvedPlaybackTime = playbackTime ?? stepIndex ?? 0;
    const currentStep = Math.min(Math.floor(resolvedPlaybackTime), scene.steps.length - 1);

    const present: EditorState = {
        scene,
        currentStep,
    };

    const sceneContext: UndoContext<EditorState, SceneAction> = [
        {
            present,
            transientPresent: present,
            past: [],
            future: [],
        },
        () => undefined,
    ];

    const selectionContext: SelectionState = [new Set<number>(), () => {}];
    const spotlightContext: SelectionState = [new Set<number>(), () => {}];

    return (
        <Stage ref={handleStageRef} x={x} y={y} width={width} height={height} scaleX={scale} scaleY={scale}>
            <DefaultCursorProvider>
                <SceneContext value={sceneContext}>
                    <SelectionContext value={selectionContext}>
                        <SpotlightContext value={spotlightContext}>
                            <StaticPlaybackProvider playbackTime={resolvedPlaybackTime} pulseTime={pulseTime}>
                                <SceneContents listening={false} simple={simple} backgroundColor={backgroundColor} />
                            </StaticPlaybackProvider>
                        </SpotlightContext>
                    </SelectionContext>
                </SceneContext>
            </DefaultCursorProvider>
        </Stage>
    );
};

interface SceneContentsProps {
    listening?: boolean;
    simple?: boolean;
    backgroundColor?: string;
    /** Called with the screen-pixel delta of a spacebar-held pan drag. Omitted for read-only previews. */
    onPan?: (dx: number, dy: number) => void;
    /** Whether a middle/right-click drag pan (tracked at the Stage level) is in progress. */
    isButtonPanning?: boolean;
}

const SceneContents: React.FC<SceneContentsProps> = ({
    listening,
    simple,
    backgroundColor,
    onPan,
    isButtonPanning,
}) => {
    listening = listening ?? true;

    const { scene, stepIndex } = useScene();
    const step = useCurrentStep();

    // In playback mode, useDisplayObjects returns interpolated objects.
    // In edit mode (or when used outside PlaybackProvider, e.g. ScenePreview), returns step.objects.
    const objects = useDisplayObjects(scene, step.objects);

    // Entering objects (tagged _ceilOnly by useDisplayObjects) only exist in the "next" step of the
    // current transition, so they should only be hit-testable once the reducer's currentStep has
    // actually caught up to that step (see getCurrentStepIndex) -- otherwise clicking one would
    // select/drag an object that isn't part of the step currently being edited.
    const playback = useOptionalPlayback();
    const enteringObjectsSelectable = playback ? stepIndex === Math.ceil(playback.state.playbackTime) : true;

    return (
        <DisplayObjectsContext value={objects}>
            {listening && <SceneHotkeyHandler />}

            <Layer name={LayerName.Ground} listening={listening}>
                <ArenaRenderer backgroundColor={backgroundColor} simple={simple} />
                <ObjectRenderer
                    objects={objects}
                    layer={LayerName.Ground}
                    enteringObjectsSelectable={enteringObjectsSelectable}
                />
            </Layer>
            <Layer name={LayerName.Default} listening={listening}>
                <ObjectRenderer
                    objects={objects}
                    layer={LayerName.Default}
                    enteringObjectsSelectable={enteringObjectsSelectable}
                />
            </Layer>
            <Layer name={LayerName.Foreground} listening={listening}>
                <ObjectRenderer
                    objects={objects}
                    layer={LayerName.Foreground}
                    enteringObjectsSelectable={enteringObjectsSelectable}
                />

                <TetherEditRenderer />
            </Layer>
            <Layer name={LayerName.Active} listening={listening}>
                <DrawTarget />
            </Layer>
            {/* Topmost layer: a held spacebar renders a full-stage pan-capture rect here so
                it takes priority over object dragging/selection and the draw tool below. */}
            <Layer name={LayerName.Controls} listening={listening}>
                {listening && onPan && <PanTarget onPan={onPan} isButtonPanning={isButtonPanning} />}
            </Layer>
        </DisplayObjectsContext>
    );
};

interface DropTargetProps extends PropsWithChildren {
    stage: Konva.Stage | null;
}

const DropTarget: React.FC<DropTargetProps> = ({ stage, children }) => {
    const { scene, dispatch } = useScene();
    const [, setSelection] = useSelection();
    const [dragObject, setDragObject] = usePanelDrag();

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();

        if (!dragObject || !stage) {
            return;
        }

        setDragObject(null);
        stage.setPointersPositions(e);

        // getRelativePointerPosition() (rather than getPointerPosition()) accounts for
        // the stage's own pan/zoom transform, so drops still land under the cursor.
        const position = stage.getRelativePointerPosition();
        if (!position) {
            return;
        }

        position.x -= dragObject.offset.x / stage.scaleX();
        position.y -= dragObject.offset.y / stage.scaleY();

        const action = getDropAction(dragObject, getSceneCoord(scene, position));
        if (action) {
            dispatch(action);
            setSelection(selectNewObjects(scene, 1));
        }
    };

    return (
        <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
            {children}
        </div>
    );
};

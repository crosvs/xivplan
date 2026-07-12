/**
 * PlaybackTimeline — shown in place of StepSelect when playback mode is active.
 *
 * Renders a fractional slider (0 → steps.length-1), step markers, play/pause,
 * speed control, and an "Exit Playback" button.
 */

import {
    Button,
    Label,
    Select,
    Slider,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
    typographyStyles,
} from '@fluentui/react-components';
import { PauseRegular, PlayRegular } from '@fluentui/react-icons';
import React, { memo, ReactNode, useEffect, useRef } from 'react';
import { CrossStepSelection } from '../CrossStepContext';
import { useScene } from '../SceneProvider';
import { AddStepButton, RemoveStepButton, ReorderStepsButton } from '../StepSelect';
import { useCrossStepSelection, useSelection, useSimilarObjects } from '../selection';
import { useElementSize } from '../useElementSize';
import { useIsDirty } from '../useIsDirty';
import { useViewTransform } from '../useViewTransform';
import { removeFileExtension } from '../util';
import { MAX_ZOOM, MIN_ZOOM } from '../ViewTransformContext';
import { getCurrentStepIndex, usePlayback, usePlaybackDispatch } from './PlaybackContext';

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].filter((z) => z >= MIN_ZOOM && z <= MAX_ZOOM);

export const PlaybackTimeline: React.FC = () => {
    const classes = useStyles();
    const { scene, source } = useScene();
    const { state, setPlaybackTime, togglePlay, setSpeed, updateMaxStep } = usePlayback();
    const { isPlaying, playbackTime, speed } = state;
    const [transform, setTransform] = useViewTransform();
    const isDirty = useIsDirty();

    // The label sits between the two button groups when everything fits on one line, but needs
    // to move to its own full-width row above them when it doesn't -- not just reordering, since
    // its position in the row structure itself differs between the two layouts. A hidden clone of
    // the single-row layout (below) measures whether it would actually fit, since that depends on
    // the (variable-length) plan name and isn't something CSS alone can decide here.
    const containerRef = useRef<HTMLDivElement>(null);
    const { width: containerWidth } = useElementSize(containerRef);
    const measureRef = useRef<HTMLDivElement>(null);
    const { width: neededWidth } = useElementSize(measureRef);
    const isStacked = containerWidth > 0 && neededWidth > containerWidth;

    const stepCount = scene.steps.length;
    const maxStep = stepCount - 1;
    const currentStepIndex = getCurrentStepIndex(playbackTime, maxStep);
    // Whether the slider has actually reached the end, as opposed to just being closer to the
    // last step than the previous one -- currentStepIndex alone can't tell these apart since it
    // rounds to the nearest step (see getCurrentStepIndex), but "restart instead of resume" should
    // only kick in once there's no play left to resume.
    const atEnd = playbackTime >= maxStep;

    // Keep RAF loop aware of current maxStep
    useEffect(() => {
        updateMaxStep(maxStep);
    }, [maxStep, updateMaxStep]);

    const handleSliderChange = (_: React.ChangeEvent<HTMLInputElement>, data: { value: number }) => {
        setPlaybackTime(data.value);
    };

    // Pressing Play at (or past) the last step restarts from the beginning instead of
    // being a no-op -- there's no separate "reset to start" button anymore.
    const handlePlayClick = () => {
        if (!isPlaying && atEnd) {
            setPlaybackTime(0);
        }
        togglePlay();
    };

    const handleSpeedChange = (_: React.ChangeEvent<HTMLSelectElement>) => {
        setSpeed(parseFloat(_.target.value));
    };

    // Zooms around the canvas's own origin rather than the current viewport center --
    // simple to compute without needing this component to know the canvas's pixel size,
    // and wheel/pinch zoom already cover the "zoom toward what I'm looking at" case.
    const handleZoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newScale = parseFloat(e.target.value);
        setTransform((t) => ({
            scale: newScale,
            x: t.x * (newScale / t.scale),
            y: t.y * (newScale / t.scale),
        }));
    };

    const zoomPercent = Math.round(transform.scale * 100);
    const isZoomPreset = ZOOM_PRESETS.some((z) => Math.round(z * 100) === zoomPercent);

    const planName = source ? removeFileExtension(source.name) : undefined;
    const stepLabel = planName
        ? `Step ${currentStepIndex + 1} / ${stepCount} - ${planName}${isDirty ? ' ●' : ''}`
        : `Step ${currentStepIndex + 1} / ${stepCount}`;

    const primaryButtons = (
        <div className={classes.primaryButtons}>
            <AddStepButton size="small" />

            <Tooltip
                content={!isPlaying && atEnd ? 'Restart' : isPlaying ? 'Pause' : 'Play'}
                relationship="label"
                withArrow
            >
                <Button
                    appearance="subtle"
                    icon={isPlaying ? <PauseRegular /> : <PlayRegular />}
                    onClick={handlePlayClick}
                    size="small"
                />
            </Tooltip>
        </div>
    );

    const stepLabelEl = (
        <Tooltip
            content={planName ? (isDirty ? `${planName} (unsaved changes)` : planName) : stepLabel}
            relationship="label"
            withArrow
        >
            <Label className={classes.stepLabel}>{stepLabel}</Label>
        </Tooltip>
    );

    const speedControlsChildren = (
        <>
            <Label className={classes.speedLabel}>Zoom</Label>
            <Select
                value={(zoomPercent / 100).toString()}
                onChange={handleZoomChange}
                size="small"
                className={classes.speedSelect}
            >
                {!isZoomPreset && <option value={zoomPercent / 100}>{zoomPercent}%</option>}
                {ZOOM_PRESETS.map((z) => (
                    <option key={z} value={z}>
                        {Math.round(z * 100)}%
                    </option>
                ))}
            </Select>

            <Label className={classes.speedLabel}>Speed</Label>
            <Select value={speed.toString()} onChange={handleSpeedChange} size="small" className={classes.speedSelect}>
                <option value="0.25">0.25×</option>
                <option value="0.5">0.5×</option>
                <option value="0.75">0.75×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="4">4×</option>
            </Select>
            <ReorderStepsButton />
            <RemoveStepButton />
        </>
    );

    // Plain version for the stacked buttons row, which relies on its own justifyContent to push
    // this group to the far right -- that row keeps flexWrap as a last-resort safety net, and an
    // auto margin combined with flexWrap can make a flex container overflow instead of wrapping
    // cleanly, so marginLeft: auto is only safe to use where wrapping never happens (the inline
    // row below, which is always nowrap).
    const speedControls = <div className={classes.speedWrapper}>{speedControlsChildren}</div>;

    // Buttons stay clustered together and leftmost either way; the label sits between the two
    // button groups when it fits on one line, or moves to its own full-width row above the
    // buttons when it doesn't (decided by isStacked, computed from the hidden measurement clone
    // below rather than by CSS, since whether it fits depends on the plan name's length).
    const inlineRow: ReactNode = (
        <div className={classes.inlineRow}>
            {primaryButtons}
            {stepLabelEl}
            <div className={mergeClasses(classes.speedWrapper, classes.pushRight)}>{speedControlsChildren}</div>
        </div>
    );

    return (
        <div className={classes.root}>
            <div ref={containerRef} className={classes.controls}>
                {isStacked ? (
                    <>
                        {stepLabelEl}
                        <div className={classes.buttonsRow}>
                            {primaryButtons}
                            {speedControls}
                        </div>
                    </>
                ) : (
                    inlineRow
                )}
            </div>

            {/* Hidden clone of the single-row layout, purely to measure whether it would fit --
                kept mounted (and re-measured) even while stacked, so we can switch back to the
                single row once there's room again. */}
            <div ref={measureRef} className={classes.measure} aria-hidden="true">
                {inlineRow}
            </div>

            {/* Timeline slider */}
            <div className={classes.sliderRow}>
                <Slider
                    className={classes.slider}
                    min={0}
                    max={maxStep}
                    step={0.01}
                    value={playbackTime}
                    onChange={handleSliderChange}
                />
            </div>

            {/* Step markers — isolated component so that:
                  - memo() skips re-renders when currentStepIndex doesn't change (most 60fps frames)
                  - selection/similar changes don't re-render the slider/controls above */}
            {stepCount > 1 && (
                <PlaybackStepMarkers stepCount={stepCount} maxStep={maxStep} currentStepIndex={currentStepIndex} />
            )}
        </div>
    );
};

interface PlaybackStepMarkersProps {
    stepCount: number;
    maxStep: number;
    currentStepIndex: number;
}

const PlaybackStepMarkers = memo(function PlaybackStepMarkers({
    stepCount,
    maxStep,
    currentStepIndex,
}: PlaybackStepMarkersProps) {
    const classes = useStyles();
    const { dispatch } = useScene();
    const { setPlaybackTime } = usePlaybackDispatch();
    const { filters, positionTolerance, selection: crossStep, setSelection: setCrossStep } = useCrossStepSelection();
    const similar = useSimilarObjects(filters, positionTolerance);
    const [, setSelection] = useSelection();

    const handleStepClick = (i: number, e: React.MouseEvent) => {
        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        if ((isCtrl || isShift) && similar.has(i)) {
            if (isCtrl) {
                const next = new Map(crossStep);
                if (next.has(i)) {
                    next.delete(i);
                } else {
                    next.set(i, similar.get(i)!);
                }
                setCrossStep(next as CrossStepSelection);
            } else {
                const from = Math.min(currentStepIndex, i);
                const to = Math.max(currentStepIndex, i);
                const next = new Map(crossStep);
                for (let j = from; j <= to; j++) {
                    const ids = similar.get(j);
                    if (ids) next.set(j, ids);
                }
                setCrossStep(next as CrossStepSelection);
            }
            return;
        }

        setPlaybackTime(i);
        dispatch({ type: 'setStep', index: i });

        const stepCrossSelection = crossStep.get(i);
        if (stepCrossSelection) {
            setSelection(stepCrossSelection);
        }
    };

    return (
        <div className={classes.markers}>
            {Array.from({ length: stepCount }, (_, i) => {
                const pct = maxStep > 0 ? (i / maxStep) * 100 : 0;
                const isActive = i === currentStepIndex;
                const hasSimilar = similar.has(i);
                const isInCrossStep = crossStep.has(i);
                const tooltip = isInCrossStep
                    ? `Step ${i + 1} — in cross-page selection (Ctrl+click to remove)`
                    : hasSimilar
                      ? `Step ${i + 1} — has matching objects (Ctrl+click to add)`
                      : `Step ${i + 1}`;
                return (
                    <button
                        key={i}
                        className={mergeClasses(
                            classes.marker,
                            isActive && classes.markerActive,
                            hasSimilar && !isInCrossStep && classes.markerHasSimilar,
                            isInCrossStep && classes.markerInCrossStep,
                        )}
                        style={{ left: `${pct}%` }}
                        onClick={(e) => handleStepClick(i, e)}
                        title={tooltip}
                    >
                        {i + 1}
                    </button>
                );
            })}
        </div>
    );
});

const useStyles = makeStyles({
    root: {
        position: 'relative',
        display: 'flex',
        flexFlow: 'column',
        width: '100%',
        boxSizing: 'border-box',
        gap: tokens.spacingVerticalXS,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
        borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        userSelect: 'none',
    },

    // Column layout: either one child (the single inline row) or two (the label's own row, then
    // the buttons' own row) -- flex column items stretch to fill the full width by default, which
    // is exactly what both the label and the buttons row need when stacked.
    controls: {
        display: 'flex',
        flexFlow: 'column',
        gap: tokens.spacingVerticalXS,
    },

    inlineRow: {
        display: 'flex',
        flexFlow: 'row',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
    },

    // Absolutely positioned and hidden so it never affects visible layout or is reachable/
    // interactive, but still participates in layout enough to report its natural (unwrapped,
    // unconstrained) width via ResizeObserver -- used to decide whether the real inline row would
    // actually fit (see isStacked). width: max-content is essential here: a plain `auto` width on
    // an absolutely positioned element is shrink-to-fit *clamped by the containing block's
    // available space* per the CSS spec, so once the page got narrow enough, this would silently
    // report a capped (too-small) width instead of the row's true unwrapped width -- exactly
    // masking the "should stack now" signal `isStacked` depends on. max-content explicitly sizes
    // to the content's preferred width regardless of how little space is actually available.
    measure: {
        position: 'absolute',
        visibility: 'hidden',
        pointerEvents: 'none',
        top: 0,
        left: 0,
        width: 'max-content',
    },

    stepLabel: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
        minWidth: '80px',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },

    // Only ever rendered as a full-width child of `controls` (when stacked), with its own two
    // groups pushed to opposite ends -- flexWrap here is just a last-resort safety net for
    // extremely narrow screens where even a full-width row isn't enough for both groups.
    buttonsRow: {
        display: 'flex',
        flexFlow: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
    },

    primaryButtons: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },

    speedWrapper: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },

    // Pushes this group (and only this group) to the far right, leaving whatever precedes it
    // clustered together at the start with normal gaps -- used for the inline row, where
    // justifyContent alone can't express "cluster the first two, push the third" with 3 children.
    pushRight: {
        marginLeft: 'auto',
    },

    speedLabel: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },

    speedSelect: {
        minWidth: '70px',
    },

    sliderRow: {
        display: 'flex',
        alignItems: 'center',
        paddingLeft: tokens.spacingHorizontalXS,
        paddingRight: tokens.spacingHorizontalXS,
    },

    slider: {
        width: '100%',
    },

    markers: {
        position: 'relative',
        height: '20px',
        // Offset to align with the slider thumb track area (Fluent slider adds ~12px padding each side)
        marginLeft: '14px',
        marginRight: '14px',
    },

    marker: {
        position: 'absolute',
        transform: 'translateX(-50%)',
        padding: '0 2px',
        border: 'none',
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorNeutralBackground4,
        color: tokens.colorNeutralForeground2,
        cursor: 'pointer',
        ...typographyStyles.caption2,
        lineHeight: '18px',

        ':hover': {
            backgroundColor: tokens.colorNeutralBackground4Hover,
            color: tokens.colorNeutralForeground1,
        },
    },

    markerActive: {
        backgroundColor: tokens.colorBrandBackground,
        color: tokens.colorNeutralForegroundOnBrand,

        ':hover': {
            backgroundColor: tokens.colorBrandBackgroundHover,
            color: tokens.colorNeutralForegroundOnBrand,
        },
    },

    markerHasSimilar: {
        outline: `2px dashed ${tokens.colorBrandStroke2}`,
        outlineOffset: '1px',
    },

    markerInCrossStep: {
        outline: `2px solid ${tokens.colorBrandStroke1}`,
        outlineOffset: '1px',
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground1,

        ':hover': {
            backgroundColor: tokens.colorBrandBackground2Hover,
            color: tokens.colorBrandForeground1,
        },
    },
});

import { makeStyles, tokens } from '@fluentui/react-components';
import React, { useEffect, useRef } from 'react';
import { useMedia, useWindowSize } from 'react-use';
import { EditModeProvider } from './EditModeProvider';
import { RegularHotkeyHandler } from './HotkeyHandler';
import { MainToolbar } from './MainToolbar';
import { PanelDragProvider } from './PanelDragProvider';
import { SceneLoadErrorNotifier } from './SceneLoadErrorNotifier';
import { useScene } from './SceneProvider';
import { SelectionProvider } from './SelectionProvider';
import { CombinedPanel } from './panel/CombinedPanel';
import { DetailsPanel } from './panel/DetailsPanel';
import { MainPanel } from './panel/MainPanel';
import { getPanelStageCount } from './panel/panelStages';
import { PortraitPanels } from './panel/PortraitPanels';
import { getCurrentStepIndex, PlaybackProvider, usePlayback, usePlaybackDispatch } from './playback/PlaybackContext';
import { PlaybackTimeline } from './playback/PlaybackTimeline';
import { SceneRenderer } from './render/SceneRenderer';
import { MIN_STAGE_WIDTH, MIN_STAGE_WIDTH_PX } from './theme';
import { useIsDirty } from './useIsDirty';
import { usePreviewMode } from './usePreviewMode';
import { removeFileExtension } from './util';
import { ViewTransformProvider } from './ViewTransformProvider';

export const MainPage: React.FC = () => {
    return (
        <PlaybackProvider>
            <EditModeProvider>
                <SelectionProvider>
                    <PanelDragProvider>
                        <ViewTransformProvider>
                            <MainPageContent />
                        </ViewTransformProvider>
                    </PanelDragProvider>
                </SelectionProvider>
            </EditModeProvider>
        </PlaybackProvider>
    );
};

/**
 * Null-rendering bridge: subscribes to PlaybackContext and dispatches setStep as
 * playbackTime crosses each step's midpoint, so SceneProvider's currentStep tracks
 * getCurrentStepIndex(playbackTime). Lives as a sibling of the main content so its
 * 60fps re-renders during playback don't cascade to the entire page subtree.
 */
const PlaybackSyncer: React.FC = () => {
    const { scene, dispatch } = useScene();
    const { state } = usePlayback();
    const { playbackTime, isPlaying } = state;
    const maxStep = scene.steps.length - 1;
    const currentStep = getCurrentStepIndex(playbackTime, maxStep);
    useEffect(() => {
        // During auto-play the renderer interpolates directly from scene.steps[], so
        // SceneProvider's currentStep doesn't need to track every step boundary.
        // We only sync on scrub/pause so editing interactions use the right step.
        if (!isPlaying) {
            dispatch({ type: 'setStep', index: currentStep, transient: true });
        }
    }, [currentStep, isPlaying, dispatch]);
    return null;
};

const MainPageContent: React.FC = () => {
    const classes = useStyles();
    const title = usePageTitle();
    const { scene, dispatch, stepIndex } = useScene();
    // Use dispatch context (stable, never re-renders on playbackTime changes)
    // instead of usePlayback() so the entire page subtree doesn't re-render at 60fps.
    const { setPlaybackTime, togglePlay, isPlayingRef } = usePlaybackDispatch();
    const maxStep = scene.steps.length - 1;
    const [previewMode] = usePreviewMode();
    const isPortrait = useMedia('(orientation: portrait)');

    // Landscape's panel columns auto-size to their own content rather than splitting a directly
    // measurable "available" share (the canvas's 1fr column absorbs whatever the panels don't
    // use), so there's no element whose width alone tells us "how much room is there for
    // panels" the way portrait's shared row does. Approximate it instead: whatever the window
    // doesn't need for the canvas's own minimum is what's available for panels to grow into.
    const { width: windowWidth } = useWindowSize();
    const landscapeStage = getPanelStageCount(windowWidth - MIN_STAGE_WIDTH_PX);

    // stepIndexRef captures the step the reducer committed to (e.g. addStep → new step index).
    const stepIndexRef = useRef(stepIndex);
    useEffect(() => {
        stepIndexRef.current = stepIndex;
    });

    // When the user edits the scene, snap playbackTime to the reducer's current step and stop
    // playing. Using stepIndexRef means addStep (which sets currentStep = newStep) will jump the
    // slider to the new step, while normal edits (drag etc.) keep playbackTime as-is since
    // PlaybackSyncer already keeps stepIndex = getCurrentStepIndex(playbackTime) during scrub/play.
    const initialSceneRef = useRef(scene);
    useEffect(() => {
        if (scene !== initialSceneRef.current) {
            const target = Math.min(stepIndexRef.current, maxStep);
            setPlaybackTime(target);
            dispatch({ type: 'setStep', index: target, transient: true });
            if (isPlayingRef.current) {
                togglePlay();
            }
        }
        initialSceneRef.current = scene;
        // dispatch/isPlayingRef/maxStep/setPlaybackTime/togglePlay are stable — intentionally omitted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scene]);

    return (
        <>
            <title>{title}</title>

            {/* Keeps SceneProvider's currentStep = getCurrentStepIndex(playbackTime) during play/scrub.
                Rendered as a sibling so its 60fps subscription doesn't cascade to the page. */}
            <PlaybackSyncer />

            <RegularHotkeyHandler />
            <SceneLoadErrorNotifier />

            <MainToolbar />

            {!previewMode && !isPortrait && landscapeStage !== 1 && <MainPanel />}

            <div className={classes.steps}>
                <PlaybackTimeline />
            </div>

            <div className={classes.stage}>
                <SceneRenderer />
            </div>

            {!previewMode &&
                (isPortrait ? (
                    <PortraitPanels />
                ) : landscapeStage === 1 ? (
                    <CombinedPanel maxWidth={windowWidth - MIN_STAGE_WIDTH_PX} />
                ) : (
                    <DetailsPanel split={landscapeStage === 3} />
                ))}
        </>
    );
};

const TITLE = 'XIVPlan';

function usePageTitle() {
    const { source } = useScene();
    const isDirty = useIsDirty();

    let title = TITLE;
    if (source) {
        title += ': ';
        title += removeFileExtension(source?.name);
    }
    if (isDirty) {
        title += ' ●';
    }
    return title;
}

const useStyles = makeStyles({
    steps: {
        gridArea: 'steps',
        display: 'flex',
        flexFlow: 'column',
        // Without this, content that's wider than the column (e.g. the playback
        // controls row on a narrow arena) can overflow into the neighboring panel
        // instead of wrapping/clipping within this grid area.
        overflow: 'hidden',
        minWidth: MIN_STAGE_WIDTH,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    stage: {
        gridArea: 'content',
        display: 'flex',
        flexFlow: 'row',
        // The canvas now always fills this container itself (see SceneRenderer's
        // ResizeObserver-driven fit-to-view), so there's no leftover space to center
        // within, and no oversized content to natively scroll -- panning/zooming is
        // handled internally instead, so a native scrollbar here would just be inert.
        overflow: 'hidden',
        minWidth: MIN_STAGE_WIDTH,
        backgroundColor: tokens.colorNeutralBackground1,
    },
});

import {
    Button,
    DialogActions,
    DialogTrigger,
    Field,
    Select,
    makeStyles,
    Portal,
    Toast,
    ToastTitle,
    useToastController,
} from '@fluentui/react-components';
import Konva from 'konva';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { HtmlPortalNode, InPortal } from 'react-reverse-portal';
import { useLocalStorage, useTimeoutFn } from 'react-use';
import { getCanvasSize } from './coord';
import { MessageToast } from './MessageToast';
import { ObjectLoadingContext } from './ObjectLoadingContext';
import { ObjectLoadingProvider } from './ObjectLoadingProvider';
import { ScenePreview } from './render/SceneRenderer';
import { useScene } from './SceneProvider';
import { ToastDismissButton } from './ToastDismissButton';
import { useCancelConnectionSelection } from './useEditMode';
import { useHotkeys } from './useHotkeys';

const SCREENSHOT_TIMEOUT = 1000;

/**
 * Shared screenshot-capture state, used both by the always-available ctrl+shift+c
 * hotkey and by the Share dialog's Screenshot tab. Each caller gets its own
 * independent instance -- harmless since only one can ever be actively capturing
 * at a time in practice.
 */
function useScreenshotCapture() {
    const classes = useStyles();
    const [scale, setScale] = useLocalStorage('screenshotPixelRatio', 1);
    const [takingScreenshot, setTakingScreenshot] = useState(false);
    const { dispatchToast } = useToastController();
    const cancelConnectionSelection = useCancelConnectionSelection();

    const handleScreenshotDone = (error?: unknown) => {
        setTakingScreenshot(false);

        if (error) {
            dispatchToast(<MessageToast title="Error" message={error} />, { intent: 'error' });
        } else {
            dispatchToast(<ScreenshotSuccessToast />, { intent: 'success', timeout: 2000 });
        }
    };

    // Cancel the screenshot if it takes too long so it can't get stuck.
    const handleTimeout = () => {
        if (!takingScreenshot) {
            return;
        }

        setTakingScreenshot(false);
        dispatchToast(<MessageToast title="Error" message="Screenshot timed out" />, { intent: 'error' });
    };

    const [, , startTimeout] = useTimeoutFn(handleTimeout, SCREENSHOT_TIMEOUT);

    const startScreenshot = () => {
        cancelConnectionSelection();
        setTakingScreenshot(true);
        startTimeout();
    };

    const portal = takingScreenshot ? (
        <Portal mountNode={{ className: classes.screenshot }}>
            <ObjectLoadingProvider>
                <ScreenshotComponent scale={scale} onScreenshotDone={handleScreenshotDone} />
            </ObjectLoadingProvider>
        </Portal>
    ) : null;

    return { scale, setScale, takingScreenshot, startScreenshot, portal };
}

/** Keeps the ctrl+shift+c screenshot shortcut working regardless of whether the Share dialog is open. */
export const ScreenshotHotkeyHandler: React.FC = () => {
    const { startScreenshot, portal } = useScreenshotCapture();

    useHotkeys(
        'ctrl+shift+c',
        { category: '7.Steps', help: 'Screenshot current step' },
        (ev) => {
            startScreenshot();
            ev.preventDefault();
        },
        [startScreenshot],
    );

    return portal;
};

export interface ScreenshotTabProps {
    actions: HtmlPortalNode;
}

/** Screenshot tab content for the Share dialog. */
export const ScreenshotTab: React.FC<ScreenshotTabProps> = ({ actions }) => {
    const { scale, setScale, takingScreenshot, startScreenshot, portal } = useScreenshotCapture();

    return (
        <>
            <Field label="Scale">
                <Select value={scale?.toString() ?? '1'} onChange={(_, d) => setScale(parseInt(d.value))} size="small">
                    <option value="1">1×</option>
                    <option value="2">2×</option>
                    <option value="4">4×</option>
                </Select>
            </Field>
            <p>Copies an image of the current step to your clipboard.</p>

            <InPortal node={actions}>
                <DialogActions fluid>
                    <Button appearance="primary" onClick={startScreenshot} disabled={takingScreenshot}>
                        {takingScreenshot ? 'Copying…' : 'Take screenshot'}
                    </Button>
                    <DialogTrigger disableButtonEnhancement>
                        <Button>Close</Button>
                    </DialogTrigger>
                </DialogActions>
            </InPortal>

            {portal}
        </>
    );
};

const ScreenshotSuccessToast = () => {
    return (
        <Toast>
            <ToastTitle action={<ToastDismissButton />}>Screenshot copied to clipboard</ToastTitle>
        </Toast>
    );
};

interface ScreenshotComponentProps {
    scale?: number;
    onScreenshotDone: (error?: unknown) => void;
}

const ScreenshotComponent: React.FC<ScreenshotComponentProps> = ({ scale, onScreenshotDone }) => {
    const { isLoading } = useContext(ObjectLoadingContext);
    const { scene, stepIndex } = useScene();
    const [frozenScene] = useState(scene);
    const [frozenStepIndex] = useState(stepIndex);
    const ref = useRef<Konva.Stage>(null);

    // https://github.com/reactwg/react-compiler/discussions/18
    const takeScreenshot = useCallback(async () => {
        if (!ref.current) {
            onScreenshotDone(new Error('Stage missing'));
            return;
        }

        try {
            await copyToClipboard(ref.current, scale);
            onScreenshotDone();
        } catch (ex) {
            onScreenshotDone(ex);
        }
    }, [scale, onScreenshotDone]);

    // Delay screenshot by at least one render to make sure any objects that need
    // to load resources have reported that they are loading.
    const [firstRender, setFirstRender] = useState(true);
    useEffect(() => {
        setTimeout(() => setFirstRender(false));
    }, [setFirstRender]);

    // Avoid double screenshot in development builds.
    const screenshotTaken = useRef(false);

    useEffect(() => {
        if (!firstRender && !isLoading && !screenshotTaken.current) {
            takeScreenshot();

            return () => {
                screenshotTaken.current = true;
            };
        }
    }, [firstRender, isLoading, takeScreenshot]);

    const size = getCanvasSize(frozenScene);

    return (
        <ScenePreview
            ref={ref}
            scene={frozenScene}
            stepIndex={frozenStepIndex}
            width={size.width}
            height={size.height}
        />
    );
};

async function copyToClipboard(stage: Konva.Stage, pixelRatio = 2) {
    const blob = (await stage.toBlob({ mimeType: 'image/png', pixelRatio })) as Blob;

    await navigator.clipboard.write([
        new ClipboardItem({
            [blob.type]: blob,
        }),
    ]);
}

const useStyles = makeStyles({
    screenshot: {
        visibility: 'hidden',
    },
});

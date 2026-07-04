import { makeStyles, mergeClasses, Spinner, Toaster, tokens } from '@fluentui/react-components';
import React, { PropsWithChildren, Suspense } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { createBrowserRouter, createRoutesFromElements, Outlet, Route, RouterProvider } from 'react-router-dom';
import { DirtyProvider } from './DirtyProvider';
import { useSceneFromUrl, useSourceFromUrl } from './file/share';
import { FileOpenPage } from './FileOpenPage';
import { HelpProvider } from './HelpProvider';
import { MainPage } from './MainPage';
import { PreviewModeProvider } from './PreviewModeProvider';
import { SceneProvider } from './SceneProvider';
import { SiteHeader } from './SiteHeader';
import { ThemeProvider } from './ThemeProvider';
import { useFileLoaderDropTarget } from './useFileLoader';
import { HotkeyScopes } from './useHotkeys';
import { usePreviewMode } from './usePreviewMode';

const useStyles = makeStyles({
    root: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'grid',
        // The steps/timeline row always spans the full width, above the panels/scene row.
        // The scene column ('1fr') gets all leftover space; panel columns size to their own
        // content ('auto') instead of splitting remaining space, which used to leave the
        // right panel's column much wider than the panel itself.
        gridTemplateColumns: `auto 1fr auto`,
        gridTemplateRows: `min-content min-content 1fr`,
        gridTemplateAreas: `
                "header     header  header"
                "steps      steps   steps"
                "left-panel content right-panel"
            `,

        // In portrait orientation, panels no longer frame the scene left/right -- they
        // move below it, stacked side by side across the lower half of the screen.
        '@media (orientation: portrait)': {
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: `min-content min-content 1fr 1fr`,
            gridTemplateAreas: `
                    "header      header"
                    "steps       steps"
                    "content     content"
                    "left-panel  right-panel"
                `,
        },

        background: tokens.colorNeutralBackground3,
    },
    // Applied in preview mode, on top of `root`, to collapse the editor panel columns/rows
    // so the steps/content area fills the full width regardless of orientation.
    rootPreviewMode: {
        gridTemplateColumns: '1fr',
        gridTemplateRows: `min-content min-content 1fr`,
        gridTemplateAreas: `
                "header"
                "steps"
                "content"
            `,
    },
    header: {
        gridArea: 'header',
    },

    loading: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: tokens.colorNeutralBackground3,
    },
});

const BaseProviders: React.FC<PropsWithChildren> = ({ children }) => {
    const sceneFromUrl = useSceneFromUrl();
    const sourceFromUrl = useSourceFromUrl();

    return (
        <HotkeysProvider initiallyActiveScopes={[HotkeyScopes.Default, HotkeyScopes.AlwaysEnabled]}>
            <HelpProvider>
                <SceneProvider initialScene={sceneFromUrl} initialSource={sourceFromUrl}>
                    {/* A plan loaded from a share URL starts in preview mode, hiding the editor panels. */}
                    <PreviewModeProvider initialValue={!!sceneFromUrl}>
                        <DirtyProvider>{children}</DirtyProvider>
                    </PreviewModeProvider>
                </SceneProvider>
            </HelpProvider>
        </HotkeysProvider>
    );
};

const LoadingFallback: React.FC = () => {
    const classes = useStyles();

    return (
        <div className={classes.loading}>
            <p>Fetching plan</p>
            <Spinner />
        </div>
    );
};

const Layout: React.FC = () => {
    return (
        <ThemeProvider>
            <Suspense fallback={<LoadingFallback />}>
                <BaseProviders>
                    <Root />
                </BaseProviders>
            </Suspense>
        </ThemeProvider>
    );
};

const Root: React.FC = () => {
    const classes = useStyles();
    const [previewMode] = usePreviewMode();
    const { onDragOver, onDrop, renderModal } = useFileLoaderDropTarget();

    return (
        <>
            <div
                className={mergeClasses(classes.root, previewMode && classes.rootPreviewMode)}
                onDragOver={onDragOver}
                onDrop={onDrop}
            >
                <Toaster position="top" />
                <SiteHeader className={classes.header} />
                <Outlet />
            </div>
            {renderModal()}
        </>
    );
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route path="/" element={<Layout />}>
            <Route index element={<MainPage />} />
            <Route path="open" element={<FileOpenPage />} />
        </Route>,
    ),
    { basename: import.meta.env.BASE_URL },
);

export const App: React.FC = () => {
    return <RouterProvider router={router} />;
};

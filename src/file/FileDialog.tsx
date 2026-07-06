import {
    Dialog,
    DialogActions,
    DialogContent,
    DialogProps,
    DialogSurface,
    DialogTitle,
    Tab,
    TabList,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import React, { useEffect, useState } from 'react';
import { OutPortal, createHtmlPortalNode } from 'react-reverse-portal';
import { HotkeyBlockingDialogBody } from '../HotkeyBlockingDialogBody';
import { TabActivity } from '../TabActivity';
import { FileSource, useScene } from '../SceneProvider';
import { FileSystemNotSupportedMessage, OpenFileSystem, SaveFileSystem } from './FileDialogFileSystem';
import { OpenLocalStorage, SaveLocalStorage } from './FileDialogLocalStorage';
import { OpenNostr, SaveNostr } from './FileDialogNostr';
import { ImportFromString } from './FileDialogShare';
import { supportsFs } from './filesystem';

type Tabs = 'file' | 'localStorage' | 'nostr' | 'import' | 'fileUnsupported';

/**
 * Defaults the dialog's tab to however the currently-loaded plan was opened/saved, so switching
 * back and forth doesn't require re-navigating to the same tab every time. Falls back to Local
 * file (or Browser storage, if the File System Access API isn't supported) for plans with no
 * matching source yet — e.g. loaded via a Direct Link, or a fresh unsaved scene.
 */
function getInitialTab(sourceType: FileSource['type'] | undefined): Tabs {
    if (sourceType === 'nostr') return 'nostr';
    if (sourceType === 'local') return 'localStorage';
    return supportsFs ? 'file' : 'localStorage';
}

export type OpenDialogProps = Omit<DialogProps, 'children'>;

export const OpenDialog: React.FC<OpenDialogProps> = (props) => {
    const classes = useStyles();
    const { source } = useScene();
    const [tab, setTab] = useState<Tabs>(() => getInitialTab(source?.type));
    // The dialog stays mounted between opens (only `open` toggles), so re-derive the default tab
    // each time it opens rather than just once at initial mount — otherwise loading a different
    // plan mid-session wouldn't be reflected the next time this dialog is opened.
    useEffect(() => {
        if (props.open) setTab(getInitialTab(source?.type));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open]);
    const portalNode = createHtmlPortalNode({ attributes: { class: classes.actionsPortal } });

    return (
        <Dialog {...props}>
            <DialogSurface>
                <HotkeyBlockingDialogBody>
                    <DialogTitle>Open file</DialogTitle>
                    <DialogContent className={classes.openContent}>
                        <TabList
                            size="small"
                            className={classes.tabs}
                            selectedValue={tab}
                            onTabSelect={(ev, data) => setTab(data.value as Tabs)}
                        >
                            {supportsFs && <Tab value="file">Local file</Tab>}
                            <Tab value="localStorage">Browser storage</Tab>
                            <Tab value="nostr">Nostr Vault</Tab>
                            <Tab value="import">Import plan link</Tab>
                            {!supportsFs && <Tab value="fileUnsupported">Local file</Tab>}
                        </TabList>
                        <TabActivity value="file" activeTab={tab}>
                            <OpenFileSystem actions={portalNode} />
                        </TabActivity>
                        <TabActivity value="localStorage" activeTab={tab}>
                            <OpenLocalStorage actions={portalNode} />
                        </TabActivity>
                        <TabActivity value="nostr" activeTab={tab}>
                            <OpenNostr actions={portalNode} />
                        </TabActivity>
                        <TabActivity value="import" activeTab={tab}>
                            <ImportFromString actions={portalNode} />
                        </TabActivity>
                        <TabActivity value="fileUnsupported" activeTab={tab}>
                            <FileSystemNotSupportedMessage actions={portalNode} />
                        </TabActivity>
                    </DialogContent>
                    <DialogActions fluid className={classes.actionsPortal}>
                        <OutPortal node={portalNode} />
                    </DialogActions>
                </HotkeyBlockingDialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export type SaveAsDialogProps = Omit<DialogProps, 'children'>;

export const SaveAsDialog: React.FC<SaveAsDialogProps> = (props) => {
    const classes = useStyles();
    const { source } = useScene();
    const [tab, setTab] = useState<Tabs>(() => getInitialTab(source?.type));
    useEffect(() => {
        if (props.open) setTab(getInitialTab(source?.type));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open]);
    const portalNode = createHtmlPortalNode();

    return (
        <Dialog {...props}>
            <DialogSurface>
                <HotkeyBlockingDialogBody>
                    <DialogTitle>Save file</DialogTitle>
                    <DialogContent className={classes.saveContent}>
                        <TabList
                            size="small"
                            className={classes.tabs}
                            selectedValue={tab}
                            onTabSelect={(ev, data) => setTab(data.value as Tabs)}
                        >
                            {supportsFs && <Tab value="file">Local file</Tab>}
                            <Tab value="localStorage">Browser storage</Tab>
                            <Tab value="nostr">Nostr Vault</Tab>
                            {!supportsFs && <Tab value="fileUnsupported">Local file</Tab>}
                        </TabList>
                        <TabActivity value="file" activeTab={tab}>
                            <SaveFileSystem actions={portalNode} />
                        </TabActivity>
                        <TabActivity value="localStorage" activeTab={tab}>
                            <SaveLocalStorage actions={portalNode} />
                        </TabActivity>
                        <TabActivity value="nostr" activeTab={tab}>
                            <SaveNostr actions={portalNode} open={!!props.open} />
                        </TabActivity>
                        <TabActivity value="fileUnsupported" activeTab={tab}>
                            <FileSystemNotSupportedMessage actions={portalNode} download />
                        </TabActivity>
                    </DialogContent>
                    <DialogActions>
                        <OutPortal node={portalNode} />
                    </DialogActions>
                </HotkeyBlockingDialogBody>
            </DialogSurface>
        </Dialog>
    );
};

const useStyles = makeStyles({
    openContent: {
        minHeight: '200px',
    },

    saveContent: {
        minHeight: '140px',
    },

    tabs: {
        marginBottom: tokens.spacingVerticalM,
    },

    actionsPortal: {
        display: 'flex',
        justifyContent: 'end',
        width: '100%',
    },
});

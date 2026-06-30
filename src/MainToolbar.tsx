import {
    Menu,
    MenuButtonProps,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Spinner,
    Toolbar,
    ToolbarDivider,
    makeStyles,
} from '@fluentui/react-components';
import {
    ArrowDownloadRegular,
    ArrowRedoRegular,
    ArrowUndoRegular,
    CloudArrowUpRegular,
    OpenRegular,
    SaveEditRegular,
    SaveRegular,
} from '@fluentui/react-icons';
import React, { ReactElement, useContext, useEffect, useRef, useState } from 'react';
import { InPortal } from 'react-reverse-portal';
import { CollapsableSplitButton, CollapsableToolbarButton } from './CollapsableToolbarButton';
import { FileSource, useScene, useSceneUndoRedoPossible, useSetSource } from './SceneProvider';
import { StepScreenshotButton } from './StepScreenshotButton';
import { VideoExportButton } from './export/VideoExportButton';
import { ToolbarContext } from './ToolbarContext';
import { saveFile } from './file';
import { OpenDialog, SaveAsDialog } from './file/FileDialog';
import { ShareDialogButton } from './file/ShareDialogButton';
import { downloadScene, getBlobSource } from './file/blob';
import { getNostrPubkey, publishPlan } from './file/nostr';
import { DialogOpenContext } from './useCloseDialog';
import { useCancelConnectionSelection } from './useEditMode';
import { useHotkeys } from './useHotkeys';
import { useIsDirty, useSetSavedState } from './useIsDirty';

const useStyles = makeStyles({
    toolbar: {
        paddingLeft: 0,
        paddingRight: 0,
    },
});

export const MainToolbar: React.FC = () => {
    const classes = useStyles();
    const toolbarNode = useContext(ToolbarContext);
    const { dispatch } = useScene();
    const [undoPossible, redoPossible] = useSceneUndoRedoPossible();
    const [openFileOpen, setOpenFileOpen] = useState(false);
    const cancelConnectionSelection = useCancelConnectionSelection();

    const undo = () => {
        cancelConnectionSelection();
        dispatch({ type: 'undo' });
    };
    const redo = () => {
        cancelConnectionSelection();
        dispatch({ type: 'redo' });
    };

    useHotkeys(
        'ctrl+o',
        { category: '2.File', help: 'Open' },
        (e) => {
            setOpenFileOpen(true);
            e.preventDefault();
        },
        [setOpenFileOpen],
    );

    return (
        <>
            <DialogOpenContext value={setOpenFileOpen}>
                <OpenDialog open={openFileOpen} onOpenChange={(ev, data) => setOpenFileOpen(data.open)} />
            </DialogOpenContext>

            <InPortal node={toolbarNode}>
                <Toolbar className={classes.toolbar}>
                    {/* <CollapsableToolbarButton icon={<NewRegular />}>New</CollapsableToolbarButton> */}
                    <CollapsableToolbarButton icon={<OpenRegular />} onClick={() => setOpenFileOpen(true)}>
                        Open
                    </CollapsableToolbarButton>

                    <SaveButton />

                    <CollapsableToolbarButton icon={<ArrowUndoRegular />} onClick={undo} disabled={!undoPossible}>
                        Undo
                    </CollapsableToolbarButton>
                    <CollapsableToolbarButton icon={<ArrowRedoRegular />} onClick={redo} disabled={!redoPossible}>
                        Redo
                    </CollapsableToolbarButton>

                    <ToolbarDivider />

                    <ShareDialogButton>Share</ShareDialogButton>

                    <StepScreenshotButton>Screenshot</StepScreenshotButton>
                    <VideoExportButton>Export video</VideoExportButton>
                </Toolbar>
            </InPortal>
        </>
    );
};

interface SaveButtonState {
    type: 'save' | 'saveas' | 'nostr' | 'download';
    text: string;
    icon: ReactElement;
    disabled?: boolean;
}

function getSaveButtonState(
    source: FileSource | undefined,
    isDirty: boolean,
    ownPubkey: string | undefined,
): SaveButtonState {
    if (!source) {
        return { type: 'saveas', text: 'Save as', icon: <SaveEditRegular /> };
    }

    if (source.type === 'blob') {
        return { type: 'download', text: 'Download', icon: <ArrowDownloadRegular /> };
    }

    if (source.type === 'nostr') {
        // Only allow re-publishing if this plan belongs to the user's own key.
        // ownPubkey may still be loading (undefined) — disable until resolved.
        if (!ownPubkey || source.pubkey !== ownPubkey) {
            return { type: 'saveas', text: 'Save as', icon: <SaveEditRegular /> };
        }
        return { type: 'nostr', text: 'Publish', icon: <CloudArrowUpRegular />, disabled: !isDirty };
    }

    return { type: 'save', text: 'Save', icon: <SaveRegular />, disabled: !isDirty };
}

const SaveButton: React.FC = () => {
    const isDirty = useIsDirty();
    const setSavedState = useSetSavedState();
    const [saveAsOpen, setSaveAsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const savingRef = useRef(false);
    const { canonicalScene, source } = useScene();
    const setSource = useSetSource();

    // Load own pubkey from IDB to determine whether a nostr plan belongs to us.
    const [ownPubkey, setOwnPubkey] = useState<string | undefined>();
    useEffect(() => {
        getNostrPubkey().then(setOwnPubkey);
    }, []);

    const { type, text, icon, disabled } = getSaveButtonState(source, isDirty, ownPubkey);

    const save = async () => {
        if (savingRef.current) return;
        if (!source) {
            setSaveAsOpen(true);
        } else if (source.type === 'nostr') {
            savingRef.current = true;
            setIsSaving(true);
            try {
                await publishPlan(canonicalScene, source.name, source.visibility ?? 'public');
                setSavedState(canonicalScene);
            } finally {
                savingRef.current = false;
                setIsSaving(false);
            }
        } else if (isDirty) {
            await saveFile(canonicalScene, source);
            setSavedState(canonicalScene);
        }
    };

    const download = () => {
        downloadScene(canonicalScene, source?.name);
        if (!source) {
            setSource(getBlobSource());
        }
    };

    const handleClick = () => {
        switch (type) {
            case 'save':
            case 'nostr':
                save();
                break;

            case 'saveas':
                setSaveAsOpen(true);
                break;

            case 'download':
                download();
                break;
        }
    };

    useHotkeys(
        'ctrl+s',
        { category: '2.File', help: 'Save' },
        (e) => {
            save();
            e.preventDefault();
        },
        [save],
    );
    useHotkeys(
        'ctrl+shift+s',
        { category: '2.File', help: 'Save as' },
        (e) => {
            setSaveAsOpen(true);
            e.preventDefault();
        },
        [setSaveAsOpen],
    );

    return (
        <>
            <Menu positioning="below-end">
                <MenuTrigger disableButtonEnhancement>
                    {(triggerProps: MenuButtonProps) => (
                        <CollapsableSplitButton
                            menuButton={triggerProps}
                            primaryActionButton={{ onClick: handleClick, disabled: disabled || isSaving }}
                            icon={isSaving ? <Spinner size="tiny" /> : icon}
                            appearance="subtle"
                        >
                            {isSaving ? 'Publishing…' : text}
                        </CollapsableSplitButton>
                    )}
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        {type !== 'saveas' && (
                            <MenuItem icon={<SaveEditRegular />} onClick={() => setSaveAsOpen(true)}>
                                Save as...
                            </MenuItem>
                        )}
                        {type !== 'download' && (
                            <MenuItem icon={<ArrowDownloadRegular />} onClick={download}>
                                Download
                            </MenuItem>
                        )}
                    </MenuList>
                </MenuPopover>
            </Menu>
            <DialogOpenContext value={setSaveAsOpen}>
                <SaveAsDialog open={saveAsOpen} onOpenChange={(ev, data) => setSaveAsOpen(data.open)} />
            </DialogOpenContext>
        </>
    );
};

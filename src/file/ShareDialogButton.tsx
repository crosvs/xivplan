import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Field,
    MessageBar,
    MessageBarBody,
    Spinner,
    Tab,
    TabList,
    Textarea,
    Toast,
    ToastTitle,
    makeStyles,
    tokens,
    useToastController,
} from '@fluentui/react-components';
import { CopyRegular, ShareRegular } from '@fluentui/react-icons';
import React, { ReactNode, useState } from 'react';
import { HtmlPortalNode, InPortal, OutPortal, createHtmlPortalNode } from 'react-reverse-portal';
import { useAsyncFn } from 'react-use';
import { CollapsableToolbarButton } from '../CollapsableToolbarButton';
import { VideoExportTab } from '../export/VideoExportButton';
import { HotkeyBlockingDialogBody } from '../HotkeyBlockingDialogBody';
import { ScreenshotTab } from '../StepScreenshotButton';
import { TabActivity } from '../TabActivity';
import type { FileSource } from '../SceneProvider';
import { useScene, useSetSource } from '../SceneProvider';
import { sceneToText } from '../file';
import type { Scene } from '../scene';
import { useIsDirty, useSetSavedState } from '../useIsDirty';
import { getNostrShareUrl, getPublishActionLabel, NostrPlanInfo, publishPlan } from './nostr';
import { KeySection } from './FileDialogNostr';
import { NostrVaultList } from './NostrVaultList';
import { RelayPublishList } from './RelayPublishList';
import { RelayStatusDot } from './RelayStatusDot';
import { useRelayStatus } from './useRelayStatus';
import { useNostrPubkey } from './useNostrPubkey';
import { DownloadButton } from './DownloadButton';

export interface ShareDialogButtonProps {
    children?: ReactNode | undefined;
}

export const ShareDialogButton: React.FC<ShareDialogButtonProps> = ({ children }) => {
    const [open, setOpen] = useState(false);
    // Video export has its own in-progress state that must not be silently aborted by
    // closing the dialog -- mirrors the guard the old standalone VideoExportButton dialog had.
    const [videoExporting, setVideoExporting] = useState(false);

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!videoExporting) setOpen(data.open);
            }}
        >
            <DialogTrigger>
                <CollapsableToolbarButton icon={<ShareRegular />}>{children}</CollapsableToolbarButton>
            </DialogTrigger>
            <DialogSurface>
                <ShareDialogBody onVideoExportingChange={setVideoExporting} />
            </DialogSurface>
        </Dialog>
    );
};

type ShareTab = 'link' | 'nostr' | 'screenshot' | 'video';

interface ShareDialogBodyProps {
    onVideoExportingChange: (exporting: boolean) => void;
}

const ShareDialogBody: React.FC<ShareDialogBodyProps> = ({ onVideoExportingChange }) => {
    const classes = useStyles();
    const { canonicalScene, source } = useScene();
    const isNostr = source?.type === 'nostr';
    const [tab, setTab] = useState<ShareTab>(isNostr ? 'nostr' : 'link');
    const portalNode = createHtmlPortalNode({ attributes: { class: classes.actionsPortal } });

    return (
        <HotkeyBlockingDialogBody>
            <DialogTitle>Share</DialogTitle>
            <DialogContent className={classes.content}>
                <TabList
                    size="small"
                    className={classes.tabs}
                    selectedValue={tab}
                    onTabSelect={(_, d) => setTab(d.value as ShareTab)}
                >
                    <Tab value="link">Direct Link</Tab>
                    <Tab value="nostr">Nostr Link</Tab>
                    <Tab value="screenshot">Screenshot</Tab>
                    <Tab value="video">Video</Tab>
                </TabList>
                <TabActivity value="link" activeTab={tab}>
                    <ShareLinkTab scene={canonicalScene} actions={portalNode} />
                </TabActivity>
                <TabActivity value="nostr" activeTab={tab}>
                    <NostrTab scene={canonicalScene} source={source} actions={portalNode} />
                </TabActivity>
                <TabActivity value="screenshot" activeTab={tab}>
                    <ScreenshotTab actions={portalNode} />
                </TabActivity>
                <TabActivity value="video" activeTab={tab}>
                    <VideoExportTab actions={portalNode} onExportingChange={onVideoExportingChange} />
                </TabActivity>
            </DialogContent>
            <DialogActions fluid className={classes.actionsPortal}>
                <OutPortal node={portalNode} />
            </DialogActions>
        </HotkeyBlockingDialogBody>
    );
};

// ── Share Link tab ────────────────────────────────────────────────────────────

interface ShareLinkTabProps {
    scene: Scene;
    actions: HtmlPortalNode;
}

const ShareLinkTab: React.FC<ShareLinkTabProps> = ({ scene, actions }) => {
    const { dispatchToast } = useToastController();
    const url = getSceneUrl(scene);

    const copyToClipboard = async () => {
        await navigator.clipboard.writeText(url);
        dispatchToast(<CopySuccessToast />, { intent: 'success' });
    };

    return (
        <>
            <Field label="Link to this plan">
                <Textarea value={url} contentEditable={false} appearance="filled-darker" rows={6} />
            </Field>
            <p>
                If your browser won&apos;t open the link, paste the text into{' '}
                <strong>Open &gt; Import Plan Link</strong> instead, or download the plan and drag and drop the file
                onto the page to open it.
            </p>
            <InPortal node={actions}>
                <DialogActions fluid>
                    <DownloadButton appearance="primary" style={{ marginRight: 'auto' }} />
                    <Button appearance="primary" icon={<CopyRegular />} onClick={copyToClipboard}>
                        Copy to clipboard
                    </Button>
                    <DialogTrigger disableButtonEnhancement>
                        <Button>Close</Button>
                    </DialogTrigger>
                </DialogActions>
            </InPortal>
        </>
    );
};

// ── Nostr tab ─────────────────────────────────────────────────────────────────

interface NostrTabProps {
    scene: Scene;
    source?: FileSource;
    actions: HtmlPortalNode;
}

const NostrTab: React.FC<NostrTabProps> = ({ scene, source, actions }) => {
    const classes = useStyles();
    const isNostr = source?.type === 'nostr';
    const isDirty = useIsDirty();
    const setSource = useSetSource();
    const setSavedState = useSetSavedState();
    const relayStatus = useRelayStatus();
    const { dispatchToast } = useToastController();
    const ownPubkey = useNostrPubkey();

    const [newName, setNewName] = useState('');
    const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
    const [selectedPlan, setSelectedPlan] = useState<NostrPlanInfo | undefined>(undefined);
    const [publishedUrl, setPublishedUrl] = useState('');

    // getNostrPubkey() resolves asynchronously (reads the key from IDB), so we don't yet know
    // whether the open plan is the user's own on first render — pre-select it once the pubkey
    // comparison becomes possible, but only the first time, so it doesn't clobber a selection the
    // user already made meanwhile. Adjusted directly during render (React's sanctioned pattern
    // for this) rather than in an effect, to avoid an extra cascading render.
    const [hasPreselected, setHasPreselected] = useState(false);
    if (!hasPreselected && ownPubkey !== undefined) {
        setHasPreselected(true);
        if (source?.type === 'nostr' && source.pubkey === ownPubkey) {
            setSelectedId(source.id);
            setNewName(source.name);
            setSelectedPlan({
                id: source.id,
                name: source.name,
                publishedAt: new Date(),
                visibility: source.visibility ?? 'public',
            });
        }
    }
    const [visibility, setVisibility] = useState<'public' | 'private'>(() =>
        isNostr && source.visibility === 'private' ? 'private' : 'public',
    );
    const [refreshToken, setRefreshToken] = useState(0);

    // The name field doubles as an inline rename for the selected existing plan (see
    // NostrVaultList's renameSelectedInline) — whatever's typed here is what gets published.
    const shareUrl = ownPubkey && selectedId ? getNostrShareUrl(ownPubkey, selectedId) : '';
    const currentOpenId = isNostr ? source.id : undefined;
    const actionLabel = getPublishActionLabel(selectedId, currentOpenId);
    const nameChanged = selectedPlan !== undefined && newName.trim() !== selectedPlan.name;
    const visibilityChanged = selectedPlan !== undefined && visibility !== selectedPlan.visibility;

    // Nothing pending to upload only when the selection is exactly the plan already open and
    // published, with no unsaved edits, no rename, and no access change pending. Every other case
    // (new plan, a different existing plan picked, dirty, renamed, or access changed) has
    // something meaningful to publish.
    const targetIsCurrentPublishedSource = selectedId !== undefined && selectedId === currentOpenId;
    const canUpload =
        !!newName.trim() &&
        relayStatus.anyConnected &&
        (!targetIsCurrentPublishedSource || isDirty || nameChanged || visibilityChanged);
    const canCopyLink = !!shareUrl;

    const [publishState, publish] = useAsyncFn(async () => {
        if (!canUpload) return;
        const nostrSource = await publishPlan(scene, newName.trim(), visibility, selectedId);
        const url = getNostrShareUrl(nostrSource.pubkey, nostrSource.id);
        history.replaceState(null, '', url);
        setSource(nostrSource);
        setSavedState(scene);
        setSelectedId(nostrSource.id);
        setSelectedPlan({
            id: nostrSource.id,
            name: nostrSource.name,
            publishedAt: new Date(),
            visibility: nostrSource.visibility ?? visibility,
        });
        setRefreshToken((t) => t + 1);
        setPublishedUrl(url);
    }, [scene, newName, visibility, selectedId, canUpload, setSource, setSavedState]);

    const copyUrl = async () => {
        await navigator.clipboard.writeText(publishedUrl || shareUrl);
        dispatchToast(<CopySuccessToast />, { intent: 'success' });
    };

    return (
        <>
            {!publishedUrl && <KeySection />}

            {!publishedUrl && isDirty && (
                <MessageBar intent="warning" className={classes.dirtyWarning}>
                    <MessageBarBody>
                        {isNostr
                            ? 'You have unsaved changes since the last publish.'
                            : 'You have unsaved changes. They will be included in the published plan.'}
                    </MessageBarBody>
                </MessageBar>
            )}

            {!publishedUrl && (
                <NostrVaultList
                    ownVaultOnly
                    showPublishAsNew
                    renameSelectedInline
                    newPlanName={newName}
                    onNewPlanNameChange={setNewName}
                    visibility={visibility}
                    onVisibilityChange={setVisibility}
                    selectedId={selectedId}
                    onSelectedChange={(item) => {
                        setSelectedPlan(item);
                        setSelectedId(item?.id);
                        if (item) {
                            setVisibility(item.visibility);
                            setNewName(item.name);
                        } else {
                            setNewName('');
                        }
                    }}
                    refreshToken={refreshToken}
                    onSubmit={publish}
                    disabled={publishState.loading}
                />
            )}

            {!publishedUrl && shareUrl && (
                <Field label="Nostr link">
                    <Textarea value={shareUrl} contentEditable={false} appearance="filled-darker" rows={3} />
                </Field>
            )}

            {publishedUrl && (
                <div className={classes.successBlock}>
                    <MessageBar intent="success">
                        <MessageBarBody>Published to Nostr.</MessageBarBody>
                    </MessageBar>
                    <Field label="Share link">
                        <Textarea value={publishedUrl} contentEditable={false} appearance="filled-darker" rows={3} />
                    </Field>
                    <RelayPublishList />
                </div>
            )}

            {publishState.error && (
                <MessageBar intent="error" className={classes.dirtyWarning}>
                    <MessageBarBody>{String(publishState.error)}</MessageBarBody>
                </MessageBar>
            )}

            <InPortal node={actions}>
                <DialogActions fluid>
                    {publishedUrl ? (
                        <>
                            <Button icon={<CopyRegular />} onClick={copyUrl} style={{ marginRight: 'auto' }}>
                                Copy link
                            </Button>
                            <DialogTrigger disableButtonEnhancement>
                                <Button appearance="primary">Done</Button>
                            </DialogTrigger>
                        </>
                    ) : (
                        <>
                            <RelayStatusDot status={relayStatus} style={{ marginRight: 'auto' }} />
                            <Button
                                appearance="primary"
                                disabled={!canUpload || publishState.loading}
                                icon={publishState.loading ? <Spinner size="tiny" /> : undefined}
                                onClick={publish}
                            >
                                {publishState.loading ? 'Uploading…' : actionLabel}
                            </Button>
                            <Button
                                appearance="primary"
                                icon={<CopyRegular />}
                                disabled={!canCopyLink}
                                onClick={copyUrl}
                            >
                                Copy share link
                            </Button>
                            <DialogTrigger disableButtonEnhancement>
                                <Button>Close</Button>
                            </DialogTrigger>
                        </>
                    )}
                </DialogActions>
            </InPortal>
        </>
    );
};

// ── Utilities ─────────────────────────────────────────────────────────────────

const CopySuccessToast = () => (
    <Toast>
        <ToastTitle>Link copied</ToastTitle>
    </Toast>
);

function getSceneUrl(scene: Scene) {
    const data = sceneToText(scene);
    return `${location.protocol}//${location.host}${location.pathname}#/plan/${data}`;
}

const useStyles = makeStyles({
    content: {
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
    dirtyWarning: {
        marginBottom: tokens.spacingVerticalS,
    },
    successBlock: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        margin: 0,
    },
});

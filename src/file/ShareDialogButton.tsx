import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Radio,
    RadioGroup,
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
import React, { KeyboardEvent, ReactNode, useState } from 'react';
import { HtmlPortalNode, InPortal, OutPortal, createHtmlPortalNode } from 'react-reverse-portal';
import { useAsync, useAsyncFn } from 'react-use';
import { CollapsableToolbarButton } from '../CollapsableToolbarButton';
import { HotkeyBlockingDialogBody } from '../HotkeyBlockingDialogBody';
import { TabActivity } from '../TabActivity';
import type { FileSource } from '../SceneProvider';
import { useScene, useSetSource } from '../SceneProvider';
import { sceneToText } from '../file';
import type { Scene } from '../scene';
import { useIsDirty, useSetSavedState } from '../useIsDirty';
import { getNostrPubkey, getNostrShareUrl, publishPlan } from './nostr';
import { KeySection } from './FileDialogNostr';
import { RelayPublishList } from './RelayPublishList';
import { RelayStatusDot } from './RelayStatusDot';
import { useRelayStatus } from './useRelayStatus';
import { DownloadButton } from './DownloadButton';

export interface ShareDialogButtonProps {
    children?: ReactNode | undefined;
}

export const ShareDialogButton: React.FC<ShareDialogButtonProps> = ({ children }) => {
    return (
        <Dialog>
            <DialogTrigger>
                <CollapsableToolbarButton icon={<ShareRegular />}>{children}</CollapsableToolbarButton>
            </DialogTrigger>
            <DialogSurface>
                <ShareDialogBody />
            </DialogSurface>
        </Dialog>
    );
};

type ShareTab = 'link' | 'nostr';

const ShareDialogBody: React.FC = () => {
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
                </TabList>
                <TabActivity value="link" activeTab={tab}>
                    <ShareLinkTab scene={canonicalScene} actions={portalNode} />
                </TabActivity>
                <TabActivity value="nostr" activeTab={tab}>
                    <NostrTab scene={canonicalScene} source={source} actions={portalNode} />
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
    const ownPubkeyState = useAsync(getNostrPubkey);

    const [name, setName] = useState(source?.name ?? '');
    const [visibility, setVisibility] = useState<'public' | 'private'>(() =>
        isNostr && source.visibility === 'private' ? 'private' : 'public',
    );
    const [publishedUrl, setPublishedUrl] = useState<string>('');

    const isOwnPlan = isNostr && ownPubkeyState.value !== undefined && ownPubkeyState.value === source.pubkey;

    // Existing plan URL (before any publish in this session) or post-publish URL
    const shareUrl = publishedUrl || (isNostr ? getNostrShareUrl(source.pubkey, source.name) : '');
    const canPublish = !!name.trim() && relayStatus.anyConnected;

    const [publishState, publish] = useAsyncFn(async () => {
        const nostrSource = await publishPlan(scene, name.trim(), visibility);
        const url = getNostrShareUrl(nostrSource.pubkey, nostrSource.name);
        history.replaceState(null, '', url);
        setSource(nostrSource);
        setSavedState(scene);
        setPublishedUrl(url);
    }, [scene, name, visibility, setSource, setSavedState]);

    const copyUrl = async () => {
        await navigator.clipboard.writeText(shareUrl);
        dispatchToast(<CopySuccessToast />, { intent: 'success' });
    };

    const onKeyUp = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && canPublish && !publishState.loading) {
            e.preventDefault();
            publish();
        }
    };

    return (
        <>
            <KeySection />

            {isDirty && (
                <MessageBar intent="warning" className={classes.dirtyWarning}>
                    <MessageBarBody>
                        {isNostr
                            ? 'You have unsaved changes since the last publish.'
                            : 'You have unsaved changes. They will be included in the published plan.'}
                    </MessageBarBody>
                </MessageBar>
            )}

            {publishedUrl && (
                <MessageBar intent="success" className={classes.dirtyWarning}>
                    <MessageBarBody>Published to Nostr.</MessageBarBody>
                </MessageBar>
            )}

            <Field label="Plan name">
                <Input
                    value={name}
                    placeholder="e.g. p1-progression-week1"
                    onChange={(_, d) => setName(d.value)}
                    onKeyUp={onKeyUp}
                    disabled={publishState.loading}
                    autoFocus={!isNostr}
                />
            </Field>
            <Field label="Visibility">
                <RadioGroup
                    value={visibility}
                    onChange={(_, d) => setVisibility(d.value as 'public' | 'private')}
                    layout="horizontal"
                    disabled={publishState.loading}
                >
                    <Radio value="public" label="Public" />
                    <Radio value="private" label="Private" />
                </RadioGroup>
            </Field>
            {visibility === 'private' && (
                <p className={classes.hint}>Content is encrypted — only you (with your key) can open this plan.</p>
            )}
            {isOwnPlan && !publishedUrl && (
                <p className={classes.hint}>
                    Publishing with the same name overwrites the previous version — the share URL stays the same.
                </p>
            )}

            {shareUrl && (
                <Field label="Nostr link">
                    <Textarea value={shareUrl} contentEditable={false} appearance="filled-darker" rows={3} />
                </Field>
            )}

            {publishedUrl && <RelayPublishList />}

            {publishState.error && (
                <MessageBar intent="error" className={classes.dirtyWarning}>
                    <MessageBarBody>{String(publishState.error)}</MessageBarBody>
                </MessageBar>
            )}

            <InPortal node={actions}>
                <DialogActions fluid>
                    {shareUrl && (
                        <Button icon={<CopyRegular />} onClick={copyUrl} style={{ marginRight: 'auto' }}>
                            Copy link
                        </Button>
                    )}
                    <RelayStatusDot status={relayStatus} style={{ marginRight: tokens.spacingHorizontalXS }} />
                    <Button
                        appearance="primary"
                        disabled={!canPublish || publishState.loading}
                        icon={publishState.loading ? <Spinner size="tiny" /> : undefined}
                        onClick={publish}
                    >
                        {publishState.loading ? 'Publishing…' : isOwnPlan ? 'Update plan' : 'Publish to Nostr'}
                    </Button>
                    <DialogTrigger disableButtonEnhancement>
                        <Button>Close</Button>
                    </DialogTrigger>
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
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        margin: 0,
    },
});

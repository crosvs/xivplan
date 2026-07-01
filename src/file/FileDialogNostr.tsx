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
    Textarea,
    Toast,
    ToastTitle,
    Tooltip,
    makeStyles,
    tokens,
    useToastController,
} from '@fluentui/react-components';
import {
    ArrowCounterclockwiseRegular,
    ArrowDownloadRegular,
    ArrowUploadRegular,
    CopyRegular,
    KeyRegular,
} from '@fluentui/react-icons';
import React, { useRef, useState } from 'react';
import { HtmlPortalNode, InPortal } from 'react-reverse-portal';
import { useAsyncFn } from 'react-use';
import { RelayPublishList } from './RelayPublishList';
import { RelayStatusDot } from './RelayStatusDot';
import { useRelayStatus } from './useRelayStatus';
import { useNostrPubkey } from './useNostrPubkey';
import { useLoadScene, useScene, useSetSource } from '../SceneProvider';
import { useCloseDialog } from '../useCloseDialog';
import { useIsDirty, useSetSavedState } from '../useIsDirty';
import { useConfirmUnsavedChanges } from './confirm';
import { NostrVaultList } from './NostrVaultList';
import {
    NostrPlanInfo,
    exportSecretKeyBlob,
    fetchPlan,
    generateNewKey,
    getNostrShareUrl,
    getPublishActionLabel,
    importSecretKey,
    publishPlan,
    pubkeyToNpub,
} from './nostr';

// ── Shared styles ─────────────────────────────────────────────────────────────

const useStyles = makeStyles({
    section: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        marginBottom: tokens.spacingVerticalM,
    },
    sectionLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        color: tokens.colorNeutralForeground3,
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase200,
    },
    keyRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    npub: {
        fontFamily: 'monospace',
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
        overflowWrap: 'anywhere',
        flexGrow: 1,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        margin: 0,
    },
});

// ── Key section (shared between Open and Save) ────────────────────────────────

export const KeySection: React.FC = () => {
    const classes = useStyles();
    const importRef = useRef<HTMLInputElement>(null);
    const [importError, setImportError] = useState('');
    const [showNewKeyConfirm, setShowNewKeyConfirm] = useState(false);
    const [keySaved, setKeySaved] = useState(false);

    const pubkey = useNostrPubkey();

    const saveKey = async () => {
        const blob = await exportSecretKeyBlob();
        const npubPrefix = pubkey ? pubkeyToNpub(pubkey).slice(0, 12) : 'key';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xivplan-key-${npubPrefix}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // The pubkey is reactive (useNostrPubkey), so switching keys updates every open dialog in
    // place — no page reload, and nothing about the current scene is at risk.
    const handleImportFile = async (file: File) => {
        setImportError('');
        try {
            const text = await file.text();
            await importSecretKey(text);
        } catch (ex) {
            setImportError(ex instanceof Error ? ex.message : String(ex));
        }
    };

    const doGenerateNew = async () => {
        await generateNewKey();
        setShowNewKeyConfirm(false);
    };

    const handleSaveInDialog = async () => {
        await saveKey();
        setKeySaved(true);
    };

    const npub = pubkey ? pubkeyToNpub(pubkey) : undefined;
    const npubShort = npub ? `${npub.slice(0, 12)}…${npub.slice(-8)}` : '…';

    return (
        <div className={classes.section}>
            <span className={classes.sectionLabel}>
                <KeyRegular />
                Vault Key
            </span>
            <div className={classes.keyRow}>
                <Tooltip content={npub ?? 'Loading…'} relationship="description" withArrow>
                    <span className={classes.npub}>{npubShort}</span>
                </Tooltip>
                <Button size="small" icon={<ArrowDownloadRegular />} onClick={saveKey}>
                    Save key
                </Button>
                <Button size="small" icon={<ArrowUploadRegular />} onClick={() => importRef.current?.click()}>
                    Load key
                </Button>
                <Button
                    size="small"
                    icon={<ArrowCounterclockwiseRegular />}
                    onClick={() => {
                        setKeySaved(false);
                        setShowNewKeyConfirm(true);
                    }}
                >
                    New key
                </Button>
                <input
                    ref={importRef}
                    type="file"
                    accept=".txt"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
                />
            </div>
            {importError && (
                <MessageBar intent="error">
                    <MessageBarBody>{importError}</MessageBarBody>
                </MessageBar>
            )}
            <p className={classes.hint}>
                Your key signs plans you publish. Save it to back up or transfer to another device. Anyone with your key
                can publish plans under your identity — keep it private.
            </p>

            <Dialog open={showNewKeyConfirm} onOpenChange={(_, d) => setShowNewKeyConfirm(d.open)}>
                <DialogSurface>
                    <DialogTitle>Generate new key?</DialogTitle>
                    <DialogContent>
                        <p style={{ margin: `0 0 ${tokens.spacingVerticalS} 0` }}>
                            Your current key will be permanently replaced. Plans published with the old key can no
                            longer be updated from this browser.
                        </p>
                        <p style={{ margin: 0 }}>Save your current key first if you want to keep it.</p>
                        {keySaved && (
                            <MessageBar intent="success" style={{ marginTop: tokens.spacingVerticalS }}>
                                <MessageBarBody>Key saved — you can now generate a new one.</MessageBarBody>
                            </MessageBar>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button icon={<ArrowDownloadRegular />} onClick={handleSaveInDialog}>
                            {keySaved ? 'Save again' : 'Save current key'}
                        </Button>
                        <Button appearance="primary" onClick={doGenerateNew}>
                            Generate new key
                        </Button>
                        <DialogTrigger disableButtonEnhancement>
                            <Button>Cancel</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogSurface>
            </Dialog>
        </div>
    );
};

// ── Save to Nostr ─────────────────────────────────────────────────────────────

function getInitialVisibility(source: ReturnType<typeof useScene>['source']): 'public' | 'private' {
    return source?.type === 'nostr' && source.visibility === 'private' ? 'private' : 'public';
}

export interface SaveNostrProps {
    actions: HtmlPortalNode;
}

export const SaveNostr: React.FC<SaveNostrProps> = ({ actions }) => {
    const classes = useStyles();
    const isDirty = useIsDirty();
    const setSavedState = useSetSavedState();
    const setSource = useSetSource();
    const { canonicalScene, source } = useScene();
    const currentOpenId = source?.type === 'nostr' ? source.id : undefined;

    // This dialog is always reached via "Save As" — the "New plan" row is the default selection
    // even when a nostr plan is already open, so publishing without picking a row always forks a
    // new plan rather than silently overwriting the one that happens to be open.
    const [newName, setNewName] = useState('');
    const [planId, setPlanId] = useState<string | undefined>(undefined);
    const [selectedPlan, setSelectedPlan] = useState<NostrPlanInfo | undefined>(undefined);
    const [visibility, setVisibility] = useState<'public' | 'private'>(() => getInitialVisibility(source));
    const relayStatus = useRelayStatus();
    const { dispatchToast } = useToastController();
    const [publishedUrl, setPublishedUrl] = useState('');

    // The name field doubles as an inline rename for the selected existing plan (see
    // NostrVaultList's renameSelectedInline) — whatever's typed here is what gets published.
    const actionLabel = getPublishActionLabel(planId, currentOpenId);
    const nameChanged = selectedPlan !== undefined && newName.trim() !== selectedPlan.name;
    const visibilityChanged = selectedPlan !== undefined && visibility !== selectedPlan.visibility;
    // Nothing to save only when the target is exactly the plan already open, with no edits, no
    // rename, and no access change pending.
    const targetIsCurrentOpenPlan = planId !== undefined && planId === currentOpenId;
    const canSave =
        !!newName.trim() &&
        relayStatus.anyConnected &&
        (!targetIsCurrentOpenPlan || isDirty || nameChanged || visibilityChanged);

    const [saveState, save] = useAsyncFn(async () => {
        if (!canSave) return;
        const nostrSource = await publishPlan(canonicalScene, newName.trim(), visibility, planId);
        const url = getNostrShareUrl(nostrSource.pubkey, nostrSource.id);
        history.replaceState(null, '', url);
        setSource(nostrSource);
        setSavedState(canonicalScene);
        setPublishedUrl(url);
    }, [canonicalScene, newName, planId, visibility, canSave, setSource, setSavedState]);

    const copyUrl = async () => {
        await navigator.clipboard.writeText(publishedUrl);
        dispatchToast(
            <Toast>
                <ToastTitle>Link copied</ToastTitle>
            </Toast>,
            { intent: 'success' },
        );
    };

    return (
        <>
            {!publishedUrl && <KeySection />}

            {!publishedUrl && (
                <NostrVaultList
                    ownVaultOnly
                    showPublishAsNew
                    renameSelectedInline
                    newPlanName={newName}
                    onNewPlanNameChange={setNewName}
                    visibility={visibility}
                    onVisibilityChange={setVisibility}
                    selectedId={planId}
                    onSelectedChange={(item) => {
                        setSelectedPlan(item);
                        setPlanId(item?.id);
                        if (item) {
                            setVisibility(item.visibility);
                            setNewName(item.name);
                        } else {
                            setNewName('');
                        }
                    }}
                    disabled={saveState.loading}
                />
            )}

            {publishedUrl && (
                <div className={classes.section}>
                    <MessageBar intent="success">
                        <MessageBarBody>Published to Nostr.</MessageBarBody>
                    </MessageBar>
                    <Field label="Share link">
                        <Textarea value={publishedUrl} contentEditable={false} appearance="filled-darker" rows={2} />
                    </Field>
                    <RelayPublishList />
                </div>
            )}

            {saveState.error && (
                <MessageBar intent="error">
                    <MessageBarBody>{String(saveState.error)}</MessageBarBody>
                </MessageBar>
            )}

            <InPortal node={actions}>
                <DialogActions>
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
                            <RelayStatusDot status={relayStatus} style={{ marginRight: tokens.spacingHorizontalXS }} />
                            <Button
                                appearance="primary"
                                disabled={!canSave || saveState.loading}
                                icon={saveState.loading ? <Spinner size="tiny" /> : undefined}
                                onClick={save}
                            >
                                {saveState.loading ? 'Publishing…' : actionLabel}
                            </Button>
                            <DialogTrigger disableButtonEnhancement>
                                <Button>Cancel</Button>
                            </DialogTrigger>
                        </>
                    )}
                </DialogActions>
            </InPortal>
        </>
    );
};

// ── Open from Nostr ───────────────────────────────────────────────────────────

export interface OpenNostrProps {
    actions: HtmlPortalNode;
}

export const OpenNostr: React.FC<OpenNostrProps> = ({ actions }) => {
    const isDirty = useIsDirty();
    const loadScene = useLoadScene();
    const setSource = useSetSource();
    const dismissDialog = useCloseDialog();
    const [confirmUnsavedChanges, renderModal] = useConfirmUnsavedChanges();

    const ownPubkey = useNostrPubkey();

    const [selectedItem, setSelectedItem] = useState<NostrPlanInfo | undefined>(undefined);
    const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
    const selectedIsLocked =
        selectedItem !== undefined && selectedItem.visibility === 'private' && selectedPubkey !== ownPubkey;

    const [openState, openPlan] = useAsyncFn(
        async (pubkey: string, id: string) => {
            if (isDirty && !(await confirmUnsavedChanges())) return;

            const { scene, visibility, name } = await fetchPlan(pubkey, id);
            const nostrSource = { type: 'nostr' as const, id, name, pubkey, visibility };

            history.replaceState(null, '', getNostrShareUrl(pubkey, id));

            loadScene(scene);
            setSource(nostrSource);
            dismissDialog();
        },
        [isDirty, loadScene, setSource, dismissDialog, confirmUnsavedChanges],
    );

    return (
        <>
            <KeySection />

            <NostrVaultList
                selectedId={selectedItem?.id}
                onSelectedChange={(item, pubkey) => {
                    setSelectedItem(item);
                    setSelectedPubkey(pubkey);
                }}
                onRowDoubleClick={(item, pubkey) => openPlan(pubkey, item.id)}
                disabled={openState.loading}
            />

            {openState.error && (
                <MessageBar intent="error">
                    <MessageBarBody>{String(openState.error)}</MessageBarBody>
                </MessageBar>
            )}

            {renderModal()}

            <InPortal node={actions}>
                <DialogActions>
                    <Button
                        appearance="primary"
                        disabled={!selectedItem || openState.loading || !selectedPubkey || selectedIsLocked}
                        icon={openState.loading ? <Spinner size="tiny" /> : undefined}
                        onClick={() => {
                            if (selectedItem && selectedPubkey) {
                                openPlan(selectedPubkey, selectedItem.id);
                            }
                        }}
                    >
                        Open
                    </Button>
                    <DialogTrigger>
                        <Button>Cancel</Button>
                    </DialogTrigger>
                </DialogActions>
            </InPortal>
        </>
    );
};

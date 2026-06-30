import {
    Badge,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Radio,
    RadioGroup,
    Spinner,
    TableColumnDefinition,
    TableColumnId,
    TableRowId,
    Text,
    Toast,
    ToastTitle,
    Tooltip,
    createTableColumn,
    makeStyles,
    tokens,
    useToastController,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, ArrowCounterclockwiseRegular, ArrowDownloadRegular, ArrowUploadRegular, CopyRegular, DeleteFilled, DeleteRegular, DocumentCopyRegular, KeyRegular, LockClosedRegular, bundleIcon } from '@fluentui/react-icons';
import React, { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HtmlPortalNode, InPortal } from 'react-reverse-portal';
import { useAsync, useAsyncFn } from 'react-use';
import { RelayPublishList } from './RelayPublishList';
import { RelayStatusDot } from './RelayStatusDot';
import { useRelayStatus } from './useRelayStatus';
import { useLoadScene, useScene, useSetSource } from '../SceneProvider';
import { useCloseDialog } from '../useCloseDialog';
import { useIsDirty, useSetSavedState } from '../useIsDirty';
import { useConfirmUnsavedChanges } from './confirm';
import {
    NostrPlanInfo,
    deletePlan,
    duplicatePlan,
    exportSecretKeyBlob,
    fetchPlan,
    generateNewKey,
    getNostrPubkey,
    getNostrShareUrl,
    importSecretKey,
    invalidateVaultCache,
    listPlans,
    parseInputPubkey,
    publishPlan,
    pubkeyToNpub,
} from './nostr';

const DeleteIcon = bundleIcon(DeleteFilled, DeleteRegular);

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
    fileList: {
        height: '30vh',
        overflowY: 'auto',
    },
    loadMoreRow: {
        display: 'flex',
        justifyContent: 'center',
        paddingTop: tokens.spacingVerticalS,
    },
    actions: {
        width: '100%',
    },
    ownedBadge: {
        marginLeft: tokens.spacingHorizontalXS,
    },
    vaultError: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    vaultHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    staleLabel: {
        fontSize: tokens.fontSizeBase100,
        color: tokens.colorNeutralForeground4,
        marginLeft: tokens.spacingHorizontalXS,
    },
    overwriteList: {
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '130px',
        overflowY: 'auto',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    overwriteRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        cursor: 'pointer',
        border: 'none',
        backgroundColor: 'transparent',
        width: '100%',
        textAlign: 'left',
        fontSize: tokens.fontSizeBase200,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground2Hover,
        },
    },
    overwriteRowSelected: {
        backgroundColor: tokens.colorBrandBackground2,
        ':hover': {
            backgroundColor: tokens.colorBrandBackground2Hover,
        },
    },
    overwriteRowName: {
        flexGrow: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    overwriteRowDate: {
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase100,
    },
});

// ── Key section (shared between Open and Save) ────────────────────────────────

export const KeySection: React.FC = () => {
    const classes = useStyles();
    const importRef = useRef<HTMLInputElement>(null);
    const [importError, setImportError] = useState('');
    const [showNewKeyConfirm, setShowNewKeyConfirm] = useState(false);
    const [keySaved, setKeySaved] = useState(false);

    const pubkeyState = useAsync(getNostrPubkey);

    const saveKey = async () => {
        const blob = await exportSecretKeyBlob();
        const pubkey = pubkeyState.value;
        const npubPrefix = pubkey ? pubkeyToNpub(pubkey).slice(0, 12) : 'key';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xivplan-key-${npubPrefix}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportFile = async (file: File) => {
        setImportError('');
        try {
            const text = await file.text();
            await importSecretKey(text);
            window.location.reload();
        } catch (ex) {
            setImportError(ex instanceof Error ? ex.message : String(ex));
        }
    };

    const doGenerateNew = async () => {
        await generateNewKey();
        window.location.reload();
    };

    const handleSaveInDialog = async () => {
        await saveKey();
        setKeySaved(true);
    };

    const npub = pubkeyState.value ? pubkeyToNpub(pubkeyState.value) : undefined;
    const npubShort = npub ? `${npub.slice(0, 12)}…${npub.slice(-8)}` : '…';

    return (
        <div className={classes.section}>
            <span className={classes.sectionLabel}>
                <KeyRegular />
                Key
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
                    onClick={() => { setKeySaved(false); setShowNewKeyConfirm(true); }}
                >
                    New key
                </Button>
                <input
                    ref={importRef}
                    type="file"
                    accept=".txt"
                    style={{ display: 'none' }}
                    onChange={e => e.target.files?.[0] && handleImportFile(e.target.files[0])}
                />
            </div>
            {importError && (
                <MessageBar intent="error">
                    <MessageBarBody>{importError}</MessageBarBody>
                </MessageBar>
            )}
            <p className={classes.hint}>
                Your key signs plans you publish. Save it to back up or transfer to another device. Anyone with your
                key can publish plans under your identity — keep it private.
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

function getInitialName(source: ReturnType<typeof useScene>['source']) {
    return source?.type === 'nostr' ? source.name : '';
}

function getInitialVisibility(source: ReturnType<typeof useScene>['source']): 'public' | 'private' {
    return source?.type === 'nostr' && source.visibility === 'private' ? 'private' : 'public';
}

export interface SaveNostrProps {
    actions: HtmlPortalNode;
}

export const SaveNostr: React.FC<SaveNostrProps> = ({ actions }) => {
    const classes = useStyles();
    const setSavedState = useSetSavedState();
    const setSource = useSetSource();
    const { canonicalScene, source } = useScene();
    const [name, setName] = useState(getInitialName(source));
    const [visibility, setVisibility] = useState<'public' | 'private'>(() => getInitialVisibility(source));
    const relayStatus = useRelayStatus();

    // Own vault — for selecting an existing plan to overwrite
    const ownPubkeyState = useAsync(getNostrPubkey);
    const [vaultState, refreshVault] = useAsyncFn(async (pubkey: string, bust = false) => {
        if (bust) invalidateVaultCache(pubkey);
        return listPlans(pubkey);
    }, []);
    useEffect(() => {
        if (ownPubkeyState.value) refreshVault(ownPubkeyState.value);
    }, [ownPubkeyState.value, refreshVault]);

    const selectVaultItem = (item: NostrPlanInfo) => {
        setName(item.dtag);
        setVisibility(item.visibility);
    };

    const canSave = !!name.trim() && relayStatus.anyConnected;

    const [saveState, save] = useAsyncFn(async () => {
        if (!canSave) return;

        const nostrSource = await publishPlan(canonicalScene, name.trim(), visibility);

        // Update state and URL — but keep dialog open so user sees relay result.
        history.replaceState(null, '', getNostrShareUrl(nostrSource.pubkey, nostrSource.name));
        setSource(nostrSource);
        setSavedState(canonicalScene);

        return true; // signals success for conditional rendering below
    }, [canonicalScene, name, visibility, canSave, setSource, setSavedState]);

    const onKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            save();
        }
    };

    // Post-publish: show per-relay results with retry buttons.
    if (saveState.value) {
        return (
            <>
                <MessageBar intent="success">
                    <MessageBarBody>Published to Nostr.</MessageBarBody>
                </MessageBar>
                <RelayPublishList />
                <InPortal node={actions}>
                    <DialogActions>
                        <DialogTrigger>
                            <Button appearance="primary">Done</Button>
                        </DialogTrigger>
                    </DialogActions>
                </InPortal>
            </>
        );
    }

    const vaultPlans = vaultState.value?.plans ?? [];
    const vaultCached = vaultState.value?.cached ?? false;

    return (
        <>
            <KeySection />

            <div className={classes.section}>
                <span className={classes.sectionLabel}>
                    <span className={classes.vaultHeader}>
                        Vault
                        <RelayStatusDot status={relayStatus} />
                        {vaultCached && <span className={classes.staleLabel}>cached</span>}
                        {ownPubkeyState.value && (
                            <Tooltip content="Refresh vault" relationship="label" withArrow>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<ArrowClockwiseRegular />}
                                    disabled={vaultState.loading}
                                    onClick={() => refreshVault(ownPubkeyState.value!, true)}
                                />
                            </Tooltip>
                        )}
                    </span>
                </span>

                {vaultPlans.length > 0 && (
                    <div className={classes.overwriteList}>
                        {vaultPlans.map(item => (
                            <button
                                key={item.dtag}
                                className={`${classes.overwriteRow} ${item.dtag === name ? classes.overwriteRowSelected : ''}`}
                                onClick={() => selectVaultItem(item)}
                                type="button"
                            >
                                {item.visibility === 'private' && (
                                    <LockClosedRegular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
                                )}
                                <span className={classes.overwriteRowName}>{item.dtag}</span>
                                <span className={classes.overwriteRowDate}>
                                    {item.publishedAt.toLocaleDateString()}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                <Field label="Plan name">
                    <Input
                        type="text"
                        autoFocus
                        value={name}
                        placeholder="e.g. p1-progression-week1"
                        onChange={(ev, data) => setName(data.value)}
                        onKeyUp={onKeyUp}
                    />
                </Field>
                <Field label="Visibility">
                    <RadioGroup
                        value={visibility}
                        onChange={(_, d) => setVisibility(d.value as 'public' | 'private')}
                        layout="horizontal"
                    >
                        <Radio value="public" label="Public" />
                        <Radio value="private" label="Private" />
                    </RadioGroup>
                </Field>
                {visibility === 'private' && (
                    <p className={classes.hint}>
                        Content is encrypted — only you (with your key) can open this plan.
                    </p>
                )}
                <p className={classes.hint}>
                    Publishing with the same name overwrites the previous version — the share URL stays the same.
                </p>
            </div>

            {saveState.error && (
                <MessageBar intent="error">
                    <MessageBarBody>{String(saveState.error)}</MessageBarBody>
                </MessageBar>
            )}

            <InPortal node={actions}>
                <DialogActions>
                    <Button
                        appearance="primary"
                        disabled={!canSave || saveState.loading}
                        icon={saveState.loading ? <Spinner size="tiny" /> : undefined}
                        onClick={save}
                    >
                        {saveState.loading ? 'Publishing…' : 'Publish to Nostr'}
                    </Button>
                    <DialogTrigger disableButtonEnhancement>
                        <Button>Cancel</Button>
                    </DialogTrigger>
                </DialogActions>
            </InPortal>
        </>
    );
};

// ── Open from Nostr ───────────────────────────────────────────────────────────

const getCellFocusMode = (columnId: TableColumnId) => (columnId === 'actions' ? 'none' : 'cell');

export interface OpenNostrProps {
    actions: HtmlPortalNode;
}

export const OpenNostr: React.FC<OpenNostrProps> = ({ actions }) => {
    const classes = useStyles();
    const isDirty = useIsDirty();
    const loadScene = useLoadScene();
    const setSource = useSetSource();
    const dismissDialog = useCloseDialog();
    const [confirmUnsavedChanges, renderModal] = useConfirmUnsavedChanges();
    const relayStatus = useRelayStatus();
    const { dispatchToast } = useToastController();

    const ownPubkeyState = useAsync(getNostrPubkey);
    const ownPubkey = ownPubkeyState.value;

    // Author filter — empty means own vault; valid npub/hex switches to that author
    const [authorInput, setAuthorInput] = useState('');
    const parsedBrowsePubkey = useMemo(() => {
        const trimmed = authorInput.trim();
        if (!trimmed) return null;
        const parsed = parseInputPubkey(trimmed);
        return /^[0-9a-f]{64}$/.test(parsed) ? parsed : null;
    }, [authorInput]);

    const currentPubkey = parsedBrowsePubkey ?? ownPubkey ?? null;
    const isOwnVault = !parsedBrowsePubkey || parsedBrowsePubkey === ownPubkey;

    // Vault listing
    const [vaultPlans, setVaultPlans] = useState<NostrPlanInfo[]>([]);
    const [vaultHasMore, setVaultHasMore] = useState(false);
    const [vaultUntil, setVaultUntil] = useState<number | undefined>();
    const [vaultCached, setVaultCached] = useState(false);
    const [selectedVaultRow, setSelectedVaultRow] = useState<TableRowId | undefined>();

    const [vaultState, loadVault] = useAsyncFn(
        async (pubkey: string, until?: number, bust = false) => {
            if (bust) invalidateVaultCache(pubkey);
            const { plans, hasMore, cached } = await listPlans(pubkey, { until });
            setVaultPlans(prev => (until === undefined ? plans : [...prev, ...plans]));
            setVaultHasMore(hasMore);
            setVaultCached(cached);
            if (plans.length) {
                setVaultUntil(Math.floor(plans[plans.length - 1].publishedAt.getTime() / 1000) - 1);
            }
        },
        [],
    );

    // Reload vault when the active pubkey changes
    const prevPubkeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!currentPubkey) return;
        if (currentPubkey === prevPubkeyRef.current) return;
        prevPubkeyRef.current = currentPubkey;
        setVaultPlans([]);
        setVaultHasMore(false);
        setVaultUntil(undefined);
        setSelectedVaultRow(undefined);
        loadVault(currentPubkey);
    }, [currentPubkey, loadVault]);

    // Duplicate dialog state
    const [duplicateSource, setDuplicateSource] = useState<NostrPlanInfo | null>(null);
    const [duplicateName, setDuplicateName] = useState('');
    const [duplicateState, startDuplicate] = useAsyncFn(async () => {
        if (!duplicateSource || !currentPubkey) return;
        await duplicatePlan(currentPubkey, duplicateSource.dtag, duplicateName.trim());
        setDuplicateSource(null);
        setDuplicateName('');
        if (ownPubkey) loadVault(ownPubkey, undefined, true);
    }, [duplicateSource, duplicateName, currentPubkey, ownPubkey, loadVault]);

    const [openState, openPlan] = useAsyncFn(
        async (pubkey: string, dtag: string) => {
            if (isDirty && !(await confirmUnsavedChanges())) return;

            const { scene, visibility } = await fetchPlan(pubkey, dtag);
            const nostrSource = { type: 'nostr' as const, name: dtag, pubkey, visibility };

            history.replaceState(null, '', getNostrShareUrl(pubkey, dtag));

            loadScene(scene);
            setSource(nostrSource);
            dismissDialog();
        },
        [isDirty, loadScene, setSource, dismissDialog, confirmUnsavedChanges],
    );

    const handleDelete = useCallback(
        async (dtag: string) => {
            await deletePlan(dtag);
            setVaultPlans(prev => prev.filter(p => p.dtag !== dtag));
            if (selectedVaultRow === dtag) setSelectedVaultRow(undefined);
        },
        [selectedVaultRow],
    );

    const handleCopyLink = useCallback(
        async (item: NostrPlanInfo) => {
            if (!currentPubkey) return;
            await navigator.clipboard.writeText(getNostrShareUrl(currentPubkey, item.dtag));
            dispatchToast(<Toast><ToastTitle>Link copied</ToastTitle></Toast>, { intent: 'success' });
        },
        [currentPubkey, dispatchToast],
    );

    const vaultColumns: TableColumnDefinition<NostrPlanInfo>[] = [
        createTableColumn<NostrPlanInfo>({
            columnId: 'name',
            renderHeaderCell: () => 'Plan name',
            renderCell: item => (
                <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}>
                    {item.visibility === 'private' && (
                        <Tooltip content="Private — encrypted" relationship="label" withArrow>
                            <LockClosedRegular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
                        </Tooltip>
                    )}
                    {item.dtag}
                </span>
            ),
        }),
        createTableColumn<NostrPlanInfo>({
            columnId: 'date',
            renderHeaderCell: () => 'Published',
            renderCell: item => item.publishedAt.toLocaleString(),
        }),
        createTableColumn<NostrPlanInfo>({
            columnId: 'actions',
            renderHeaderCell: () => 'Actions',
            renderCell: item => (
                <div style={{ display: 'flex' }}>
                    <Tooltip content="Copy link" appearance="inverted" relationship="label" withArrow>
                        <Button
                            appearance="subtle"
                            aria-label="Copy link"
                            icon={<CopyRegular />}
                            onClick={e => { e.stopPropagation(); handleCopyLink(item); }}
                        />
                    </Tooltip>
                    <Tooltip content="Duplicate as…" appearance="inverted" relationship="label" withArrow>
                        <Button
                            appearance="subtle"
                            aria-label="Duplicate"
                            icon={<DocumentCopyRegular />}
                            onClick={e => {
                                e.stopPropagation();
                                setDuplicateName(`${item.dtag}-copy`);
                                setDuplicateSource(item);
                            }}
                        />
                    </Tooltip>
                    {isOwnVault && (
                        <Tooltip content={`Delete ${item.dtag}`} appearance="inverted" relationship="label" withArrow>
                            <Button
                                appearance="subtle"
                                aria-label="Delete"
                                icon={<DeleteIcon />}
                                onClick={e => { e.stopPropagation(); handleDelete(item.dtag); }}
                            />
                        </Tooltip>
                    )}
                </div>
            ),
        }),
    ];

    return (
        <>
            <KeySection />

            <div className={classes.section}>
                <span className={classes.sectionLabel}>
                    <span className={classes.vaultHeader}>
                        <KeyRegular />
                        {isOwnVault ? 'Your Vault' : 'Browsing'}
                        <RelayStatusDot status={relayStatus} />
                        {vaultCached && <span className={classes.staleLabel}>cached</span>}
                        {currentPubkey && (
                            <Tooltip content="Refresh vault" relationship="label" withArrow>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<ArrowClockwiseRegular />}
                                    disabled={vaultState.loading}
                                    onClick={() => currentPubkey && loadVault(currentPubkey, undefined, true)}
                                />
                            </Tooltip>
                        )}
                    </span>
                </span>

                <Field label={isOwnVault ? 'Browse another author' : 'Author'}>
                    <Input
                        value={authorInput}
                        placeholder="npub1… or hex pubkey (empty = your vault)"
                        onChange={(_, d) => setAuthorInput(d.value)}
                    />
                </Field>

                {vaultState.loading && vaultPlans.length === 0 ? (
                    <Spinner size="small" label="Loading vault…" />
                ) : vaultState.error && vaultPlans.length === 0 ? (
                    <div className={classes.vaultError}>
                        <MessageBar intent="error">
                            <MessageBarBody>
                                {vaultState.error instanceof Error ? vaultState.error.message : String(vaultState.error)}
                            </MessageBarBody>
                        </MessageBar>
                        <Button size="small" onClick={() => currentPubkey && loadVault(currentPubkey)}>Retry</Button>
                    </div>
                ) : vaultPlans.length > 0 ? (
                    <>
                        <DataGrid
                            items={vaultPlans}
                            columns={vaultColumns}
                            getRowId={(item: NostrPlanInfo) => item.dtag}
                            size="small"
                            selectionMode="single"
                            selectedItems={selectedVaultRow !== undefined ? new Set([selectedVaultRow]) : new Set()}
                            onSelectionChange={(_, data) => setSelectedVaultRow([...data.selectedItems][0])}
                            subtleSelection
                        >
                            <DataGridHeader>
                                <DataGridRow>
                                    {({ renderHeaderCell }) => (
                                        <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                                    )}
                                </DataGridRow>
                            </DataGridHeader>
                            <DataGridBody<NostrPlanInfo> className={classes.fileList}>
                                {({ item, rowId }) => (
                                    <DataGridRow<NostrPlanInfo>
                                        key={rowId}
                                        selectionCell={{ radioIndicator: { 'aria-label': 'Select plan' } }}
                                        onDoubleClick={() => currentPubkey && openPlan(currentPubkey, item.dtag)}
                                    >
                                        {({ renderCell, columnId }) => (
                                            <DataGridCell focusMode={getCellFocusMode(columnId)}>
                                                {renderCell(item)}
                                            </DataGridCell>
                                        )}
                                    </DataGridRow>
                                )}
                            </DataGridBody>
                        </DataGrid>
                        {vaultState.error && (
                            <MessageBar intent="error">
                                <MessageBarBody>
                                    {vaultState.error instanceof Error ? vaultState.error.message : String(vaultState.error)}
                                </MessageBarBody>
                            </MessageBar>
                        )}
                        {vaultHasMore && !vaultState.error && (
                            <div className={classes.loadMoreRow}>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    disabled={vaultState.loading}
                                    onClick={() => currentPubkey && loadVault(currentPubkey, vaultUntil)}
                                >
                                    {vaultState.loading ? <Spinner size="tiny" /> : 'Load more'}
                                </Button>
                            </div>
                        )}
                    </>
                ) : !vaultState.loading ? (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        No plans found.
                    </Text>
                ) : null}
            </div>

            {openState.error && (
                <MessageBar intent="error">
                    <MessageBarBody>{String(openState.error)}</MessageBarBody>
                </MessageBar>
            )}

            {/* Duplicate dialog */}
            <Dialog open={!!duplicateSource} onOpenChange={(_, d) => { if (!d.open) setDuplicateSource(null); }}>
                <DialogSurface>
                    <DialogTitle>Duplicate plan</DialogTitle>
                    <DialogContent>
                        <p style={{ margin: `0 0 ${tokens.spacingVerticalS} 0` }}>
                            Copy <strong>{duplicateSource?.dtag}</strong> to your vault under a new name.
                        </p>
                        <Field label="New plan name">
                            <Input
                                autoFocus
                                value={duplicateName}
                                onChange={(_, d) => setDuplicateName(d.value)}
                                placeholder="e.g. p1-copy"
                                onKeyUp={e => e.key === 'Enter' && duplicateName.trim() && startDuplicate()}
                            />
                        </Field>
                        {duplicateState.error && (
                            <MessageBar intent="error" style={{ marginTop: tokens.spacingVerticalS }}>
                                <MessageBarBody>{String(duplicateState.error)}</MessageBarBody>
                            </MessageBar>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            disabled={!duplicateName.trim() || duplicateState.loading}
                            icon={duplicateState.loading ? <Spinner size="tiny" /> : undefined}
                            onClick={startDuplicate}
                        >
                            {duplicateState.loading ? 'Duplicating…' : 'Duplicate'}
                        </Button>
                        <DialogTrigger disableButtonEnhancement>
                            <Button>Cancel</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogSurface>
            </Dialog>

            {renderModal()}

            <InPortal node={actions}>
                <DialogActions fluid className={classes.actions}>
                    <Button
                        appearance="primary"
                        disabled={selectedVaultRow === undefined || openState.loading || !currentPubkey}
                        icon={openState.loading ? <Spinner size="tiny" /> : undefined}
                        onClick={() => {
                            if (selectedVaultRow !== undefined && currentPubkey) {
                                openPlan(currentPubkey, selectedVaultRow as string);
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

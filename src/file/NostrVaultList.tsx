import {
    Button,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
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
    Spinner,
    TableColumnDefinition,
    TableColumnId,
    TableRowIdContextProvider,
    Text,
    Toast,
    ToastTitle,
    ToggleButton,
    Tooltip,
    createTableColumn,
    makeStyles,
    tokens,
    useToastController,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    DeleteFilled,
    DeleteRegular,
    DocumentCopyRegular,
    EditFilled,
    EditRegular,
    LockClosedRegular,
    LockOpenRegular,
    PersonRegular,
    ShareRegular,
    bundleIcon,
} from '@fluentui/react-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAsync, useAsyncFn } from 'react-use';
import {
    NostrPlanInfo,
    deletePlan,
    duplicatePlan,
    getNostrPubkey,
    getNostrShareUrl,
    invalidateVaultCache,
    listPlans,
    parseInputPubkey,
    pubkeyToNpub,
    renamePlan,
    sanitizePlanName,
} from './nostr';
import { ReturnKeyIcon } from '@fluentui/react-icons-mdl2';

const DeleteIcon = bundleIcon(DeleteFilled, DeleteRegular);
const EditIcon = bundleIcon(EditFilled, EditRegular);

/** Sentinel row id for the pinned "New plan" row — internal to this component, never leaves it. */
export const NEW_PLAN_ID = '__new__';

const getCellFocusMode = (columnId: TableColumnId) => (columnId === 'actions' ? 'none' : 'cell');

/** Tracks whether an element's text is actually clipped, re-checking on resize. */
function useIsTruncated<T extends HTMLElement>(dep: unknown): [React.RefCallback<T>, boolean] {
    const [isTruncated, setIsTruncated] = useState(false);
    const elementRef = useRef<T | null>(null);
    const check = useCallback(() => {
        const el = elementRef.current;
        if (el) setIsTruncated(el.scrollWidth > el.clientWidth);
    }, []);
    const ref = useCallback(
        (el: T | null) => {
            elementRef.current = el;
            check();
        },
        [check],
    );
    useEffect(() => {
        const el = elementRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(check);
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [check, dep]);
    return [ref, isTruncated];
}

const truncatedNameStyle: React.CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flexGrow: 1,
};

/** Ellipsis-truncated plan name — only wraps in a Tooltip when the text is actually clipped, and
 * only on a deliberate hover (not while quickly panning across rows), so it doesn't pop up for
 * names that already fit or linger and block hovering whatever's behind it. */
const TruncatedName: React.FC<{ text: string }> = ({ text }) => {
    const [ref, isTruncated] = useIsTruncated<HTMLSpanElement>(text);
    const span = (
        <span ref={ref} style={truncatedNameStyle}>
            {text}
        </span>
    );
    if (!isTruncated) return span;
    return (
        <Tooltip content={text} relationship="label" withArrow showDelay={500} hideDelay={0}>
            {span}
        </Tooltip>
    );
};

const useStyles = makeStyles({
    section: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    vaultHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        color: tokens.colorNeutralForeground3,
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase200,
    },
    staleLabel: {
        fontSize: tokens.fontSizeBase100,
        color: tokens.colorNeutralForeground4,
        marginLeft: tokens.spacingHorizontalXS,
    },
    scrollArea: {
        height: '30vh',
        overflowY: 'auto',
    },
    loadMoreRow: {
        display: 'flex',
        justifyContent: 'center',
        padding: `${tokens.spacingVerticalS} 0`,
    },
    lockedRow: {
        opacity: 0.45,
        pointerEvents: 'none',
    },
    vaultError: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    nameCell: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        width: '100%',
        minWidth: 0,
    },
    nameInput: {
        flexGrow: 1,
        minWidth: 0,
    },
    visibilityToggle: {
        minWidth: 'auto',
        padding: 0,
        flexShrink: 0,
    },
    newRowPlaceholder: {
        color: tokens.colorNeutralForeground3,
        fontStyle: 'italic',
    },
    editAccessRow: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: tokens.spacingVerticalXS,
        marginTop: tokens.spacingVerticalM,
    },
    editAccessLabel: {
        fontWeight: tokens.fontWeightSemibold,
    },
});

/**
 * Label for a publish/save action driven by this list's selection: "Publish" for the New row,
 * "Update" when the selection is the plan already open, "Overwrite" for any other existing plan.
 */
export function getPublishActionLabel(
    selectedId: string | undefined,
    currentOpenId: string | undefined,
): 'Publish' | 'Update' | 'Overwrite' {
    if (!selectedId) return 'Publish';
    return selectedId === currentOpenId ? 'Update' : 'Overwrite';
}

export interface NostrVaultListProps {
    /** Hide "browse another author" and always operate on the signed-in user's own vault. */
    ownVaultOnly?: boolean;
    /** Adds a pinned "New plan" row at the top with an inline editable name. */
    showPublishAsNew?: boolean;
    newPlanName?: string;
    onNewPlanNameChange?: (value: string) => void;
    /** Also makes the *selected* existing row's name editable inline, using the same
     *  newPlanName/onNewPlanNameChange value — Save As / Share only. The typed name is what gets
     *  published under that row's id; there's no separate "rename" step for this flow. Open
     *  doesn't set this since it has no publish action to commit a rename through. */
    renameSelectedInline?: boolean;
    /** Pending visibility for the New row / the inline-rename-selected row, shown and toggled via
     *  the same lock icon used elsewhere in the list to indicate a plan's visibility — Save
     *  As / Share only, paired with showPublishAsNew/renameSelectedInline. */
    visibility?: 'public' | 'private';
    onVisibilityChange?: (value: 'public' | 'private') => void;
    selectedId: string | undefined;
    /** Fires on selection change. `item` undefined = the "New plan" row is selected. */
    onSelectedChange: (item: NostrPlanInfo | undefined, pubkey: string | null) => void;
    /** Double-click a row to act immediately (Open dialog only). Never fires for the New row. */
    onRowDoubleClick?: (item: NostrPlanInfo, pubkey: string) => void;
    /** Bump after publishing/renaming from outside the list to re-sync from the (already
     *  optimistically-updated) vault cache — no network round-trip needed for that. */
    refreshToken?: number;
    /** Pressing Enter in the New row / inline-rename name input calls this instead of just
     *  stopping there — Save As / Share wire their publish/upload action through it. */
    onSubmit?: () => void;
    disabled?: boolean;
}

export const NostrVaultList: React.FC<NostrVaultListProps> = ({
    ownVaultOnly = false,
    showPublishAsNew = false,
    newPlanName = '',
    onNewPlanNameChange,
    renameSelectedInline = false,
    visibility = 'public',
    onVisibilityChange,
    selectedId,
    onSelectedChange,
    onRowDoubleClick,
    refreshToken,
    onSubmit,
    disabled,
}) => {
    const classes = useStyles();
    const { dispatchToast } = useToastController();

    const ownPubkeyState = useAsync(getNostrPubkey);
    const ownPubkey = ownPubkeyState.value;

    // Author filter — empty means own vault; valid npub/hex/share-link switches to that author.
    // Disabled entirely when ownVaultOnly, since publishing always signs with the user's own key.
    // Set via a separate dialog (see below) rather than inline, so it doesn't read as a live
    // filter box for the current vault.
    const [authorInput, setAuthorInput] = useState('');
    const parsedBrowsePubkey = useMemo(() => {
        if (ownVaultOnly) return null;
        const trimmed = authorInput.trim();
        if (!trimmed) return null;
        const parsed = parseInputPubkey(trimmed);
        return /^[0-9a-f]{64}$/.test(parsed) ? parsed : null;
    }, [ownVaultOnly, authorInput]);

    const [showAuthorDialog, setShowAuthorDialog] = useState(false);
    const [authorInputDraft, setAuthorInputDraft] = useState('');
    const draftTrimmed = authorInputDraft.trim();
    const draftIsValid = draftTrimmed === '' || /^[0-9a-f]{64}$/.test(parseInputPubkey(draftTrimmed));

    const currentPubkey = parsedBrowsePubkey ?? ownPubkey ?? null;
    const isOwnVault = ownVaultOnly || !parsedBrowsePubkey || parsedBrowsePubkey === ownPubkey;

    // Vault listing
    const [vaultPlans, setVaultPlans] = useState<NostrPlanInfo[]>([]);
    const [vaultHasMore, setVaultHasMore] = useState(false);
    const [vaultUntil, setVaultUntil] = useState<number | undefined>();
    const [vaultCached, setVaultCached] = useState(false);
    const [isVaultStale, setIsVaultStale] = useState(false);

    const [vaultState, loadVault] = useAsyncFn(async (pubkey: string, until?: number, bust = false) => {
        if (bust) invalidateVaultCache(pubkey);
        const { plans, hasMore, cached, stale } = await listPlans(pubkey, { until });
        setVaultPlans((prev) => (until === undefined ? plans : [...prev, ...plans]));
        setVaultHasMore(hasMore);
        setVaultCached(cached);
        setIsVaultStale(stale && until === undefined);
        const lastPlan = plans.at(-1);
        if (lastPlan) {
            setVaultUntil(Math.floor(lastPlan.publishedAt.getTime() / 1000) - 1);
        }
    }, []);

    // Reload vault when the active pubkey changes
    const prevPubkeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!currentPubkey) return;
        if (currentPubkey === prevPubkeyRef.current) return;
        prevPubkeyRef.current = currentPubkey;
        setVaultPlans([]);
        setVaultHasMore(false);
        setVaultUntil(undefined);
        setIsVaultStale(false);
        loadVault(currentPubkey);
    }, [currentPubkey, loadVault]);

    // When stale data is shown, immediately kick off a background refresh.
    useEffect(() => {
        if (!isVaultStale || !currentPubkey) return;
        invalidateVaultCache(currentPubkey);
        loadVault(currentPubkey);
        // loadVault is stable (useAsyncFn with [] deps); currentPubkey changes reset isVaultStale first.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVaultStale, currentPubkey]);

    // External refresh trigger — e.g. a consumer just published/renamed a plan itself. publishPlan
    // and renamePlan already write the result straight into the vault cache (upsertVaultCacheEntry),
    // so re-reading it (bust=false) picks that up immediately with no relay round-trip.
    const prevRefreshTokenRef = useRef(refreshToken);
    useEffect(() => {
        if (refreshToken === undefined || refreshToken === prevRefreshTokenRef.current) return;
        prevRefreshTokenRef.current = refreshToken;
        if (currentPubkey) loadVault(currentPubkey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshToken, currentPubkey]);

    // Duplicate dialog state. duplicatePlan already writes the result into the vault cache
    // (upsertVaultCacheEntry) — splice it straight into the visible list instead of busting and
    // re-fetching the whole vault over the network just to show one new row. The copy always lands
    // in the signed-in user's own vault, so only splice it in when that's the vault being shown.
    const [duplicateSource, setDuplicateSource] = useState<NostrPlanInfo | null>(null);
    const [duplicateName, setDuplicateName] = useState('');
    const [duplicateState, startDuplicate] = useAsyncFn(async () => {
        if (!duplicateSource || !currentPubkey || !ownPubkey) return;
        const result = await duplicatePlan(currentPubkey, duplicateSource.id, duplicateName.trim());
        setDuplicateSource(null);
        setDuplicateName('');
        if (currentPubkey === ownPubkey) {
            const newEntry: NostrPlanInfo = {
                id: result.id,
                name: result.name,
                publishedAt: new Date(),
                visibility: result.visibility ?? duplicateSource.visibility,
            };
            setVaultPlans((prev) => [newEntry, ...prev.filter((p) => p.id !== newEntry.id)]);
        }
    }, [duplicateSource, duplicateName, currentPubkey, ownPubkey]);

    // Edit dialog state — renames and/or changes access in one go
    const [editSource, setEditSource] = useState<NostrPlanInfo | null>(null);
    const [editName, setEditName] = useState('');
    const [editVisibility, setEditVisibility] = useState<'public' | 'private'>('public');
    const editHasChanges =
        editSource !== null && (editName.trim() !== editSource.name || editVisibility !== editSource.visibility);
    const [editState, startEdit] = useAsyncFn(async () => {
        if (!editSource) return;
        const updated = await renamePlan(editSource.id, editName.trim(), editVisibility);
        setVaultPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        if (updated.id === selectedId && currentPubkey) {
            onSelectedChange(updated, currentPubkey);
        }
        setEditSource(null);
        setEditName('');
    }, [editSource, editName, editVisibility, selectedId, currentPubkey, onSelectedChange]);

    const handleDelete = useCallback(
        async (id: string) => {
            await deletePlan(id);
            setVaultPlans((prev) => prev.filter((p) => p.id !== id));
            if (selectedId === id && currentPubkey) {
                onSelectedChange(undefined, currentPubkey);
            }
        },
        [selectedId, currentPubkey, onSelectedChange],
    );

    const handleCopyLink = useCallback(
        async (item: NostrPlanInfo) => {
            if (!currentPubkey) return;
            await navigator.clipboard.writeText(getNostrShareUrl(currentPubkey, item.id));
            dispatchToast(
                <Toast>
                    <ToastTitle>Link copied</ToastTitle>
                </Toast>,
                { intent: 'success' },
            );
        },
        [currentPubkey, dispatchToast],
    );

    const newRow: NostrPlanInfo = { id: NEW_PLAN_ID, name: newPlanName, publishedAt: new Date(0), visibility: 'public' };
    // Rendered as its own standalone DataGridRow above the column header (see below) rather than
    // as part of the scrollable items list.
    const selectedRowId = selectedId ?? (showPublishAsNew ? NEW_PLAN_ID : undefined);

    // The lock icon doubles as the visibility toggle for whichever row's name is currently
    // editable (the New row, or the inline-rename-selected row) — otherwise it's a static
    // indicator of that plan's actual on-chain visibility.
    const visibilityControl = onVisibilityChange && (
        <Tooltip
            content={visibility === 'private' ? 'Private — click to make public' : 'Public — click to make private'}
            relationship="label"
            withArrow
        >
            <Button
                appearance="transparent"
                size="small"
                className={classes.visibilityToggle}
                icon={visibility === 'private' ? <LockClosedRegular /> : <LockOpenRegular />}
                onClick={(e) => {
                    e.stopPropagation();
                    onVisibilityChange(visibility === 'private' ? 'public' : 'private');
                }}
            />
        </Tooltip>
    );

    // Always stop the keydown from reaching the DataGridRow's own keyboard handling (Space/Enter
    // there toggles row selection) — Enter additionally confirms the pending publish/upload.
    const handleNameInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') onSubmit?.();
    };

    const vaultColumns: TableColumnDefinition<NostrPlanInfo>[] = [
        createTableColumn<NostrPlanInfo>({
            columnId: 'name',
            renderHeaderCell: () => 'Plan name',
            renderCell: (item) => {
                if (item.id === NEW_PLAN_ID) {
                    const isSelected = selectedRowId === NEW_PLAN_ID;
                    return (
                        <span className={classes.nameCell}>
                            {isSelected && visibilityControl}
                            {isSelected ? (
                                <Input
                                    size="small"
                                    autoFocus
                                    className={classes.nameInput}
                                    value={newPlanName}
                                    placeholder="New plan name"
                                    onKeyDown={handleNameInputKeyDown}
                                    onChange={(_, d) => onNewPlanNameChange?.(sanitizePlanName(d.value))}
                                />
                            ) : (
                                <Text className={classes.newRowPlaceholder}>New plan…</Text>
                            )}
                        </span>
                    );
                }
                const isRenamingThis = renameSelectedInline && selectedRowId === item.id;
                return (
                    <span className={classes.nameCell}>
                        {isRenamingThis ? (
                            visibilityControl
                        ) : (
                            item.visibility === 'private' && (
                                <Tooltip content="Private — encrypted" relationship="label" withArrow>
                                    <LockClosedRegular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
                                </Tooltip>
                            )
                        )}
                        {isRenamingThis ? (
                            <Input
                                size="small"
                                className={classes.nameInput}
                                value={newPlanName}
                                onKeyDown={handleNameInputKeyDown}
                                onChange={(_, d) => onNewPlanNameChange?.(sanitizePlanName(d.value))}
                            />
                        ) : (
                            <TruncatedName text={item.name} />
                        )}
                    </span>
                );
            },
        }),
        createTableColumn<NostrPlanInfo>({
            columnId: 'date',
            renderHeaderCell: () => 'Published',
            renderCell: (item) => (item.id === NEW_PLAN_ID ? '' : item.publishedAt.toLocaleString()),
        }),
        createTableColumn<NostrPlanInfo>({
            columnId: 'actions',
            renderHeaderCell: () => 'Actions',
            renderCell: (item) => {
                if (item.id === NEW_PLAN_ID) return null;
                return (
                    <div style={{ display: 'flex' }}>
                        <Tooltip content="Share link" appearance="inverted" relationship="label" withArrow>
                            <Button
                                appearance="subtle"
                                aria-label="Share link"
                                icon={<ShareRegular />}
                                disabled={disabled}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyLink(item);
                                }}
                            />
                        </Tooltip>
                        <Tooltip content="Duplicate as…" appearance="inverted" relationship="label" withArrow>
                            <Button
                                appearance="subtle"
                                aria-label="Duplicate"
                                icon={<DocumentCopyRegular />}
                                disabled={isVaultStale || disabled}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDuplicateName(`${item.name}-copy`);
                                    setDuplicateSource(item);
                                }}
                            />
                        </Tooltip>
                        {isOwnVault && !renameSelectedInline && (
                            <Tooltip content={`Edit ${item.name}`} appearance="inverted" relationship="label" withArrow>
                                <Button
                                    appearance="subtle"
                                    aria-label="Edit"
                                    icon={<EditIcon />}
                                    disabled={isVaultStale || disabled}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setEditName(item.name);
                                        setEditVisibility(item.visibility);
                                        setEditSource(item);
                                    }}
                                />
                            </Tooltip>
                        )}
                        {isOwnVault && (
                            <Tooltip content={`Delete ${item.name}`} appearance="inverted" relationship="label" withArrow>
                                <Button
                                    appearance="subtle"
                                    aria-label="Delete"
                                    icon={<DeleteIcon />}
                                    disabled={isVaultStale || disabled}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(item.id);
                                    }}
                                />
                            </Tooltip>
                        )}
                    </div>
                );
            },
        }),
    ];

    return (
        <div className={classes.section} style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
            <span className={classes.vaultHeader}>
                {currentPubkey && (
                    <Tooltip content="Refresh vault" relationship="label" withArrow>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={vaultState.loading ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />}
                            disabled={vaultState.loading}
                            onClick={() => currentPubkey && loadVault(currentPubkey, undefined, true)}
                        />
                    </Tooltip>
                )}
                {!ownVaultOnly && isOwnVault && (
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<PersonRegular />}
                        onClick={() => {
                            setAuthorInputDraft(authorInput);
                            setShowAuthorDialog(true);
                        }}
                    >
                        Your Vault
                    </Button>
                )}
                {ownVaultOnly && isOwnVault && <span>Your Vault</span>}
                {!ownVaultOnly && !isOwnVault && (
                    <Tooltip content="Back to your vault" relationship="label" withArrow>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ReturnKeyIcon />}
                            onClick={() => setAuthorInput('')}
                        >
                            {`Browsing ${currentPubkey ? `${pubkeyToNpub(currentPubkey).slice(0, 12)}…` : ''}`}
                        </Button>
                    </Tooltip>
                )}
                {vaultCached && !isVaultStale && <span className={classes.staleLabel}>cached</span>}
            </span>

            {/* Browse-another-author dialog — kept separate from the vault view itself so it
                doesn't read as a live filter box for the current list. */}
            {!ownVaultOnly && (
                <Dialog open={showAuthorDialog} onOpenChange={(_, d) => setShowAuthorDialog(d.open)}>
                    <DialogSurface>
                        <DialogTitle>Browse another author&apos;s vault</DialogTitle>
                        <DialogContent>
                            <p style={{ margin: `0 0 ${tokens.spacingVerticalS} 0` }}>
                                Paste an <strong>npub</strong>, a hex public key, or a plan&apos;s{' '}
                                <strong>share link</strong> (the whole link, or just the author part) — this lets you
                                browse their public plans.
                            </p>
                            <Field
                                label="Author"
                                validationState={draftIsValid ? 'none' : 'error'}
                                validationMessage={
                                    draftIsValid ? undefined : 'Not a recognized npub, hex key, or share link.'
                                }
                            >
                                <Input
                                    autoFocus
                                    value={authorInputDraft}
                                    placeholder="npub1…, hex pubkey, or a share link"
                                    onChange={(_, d) => setAuthorInputDraft(d.value)}
                                    onKeyUp={(e) => {
                                        if (e.key === 'Enter' && draftIsValid) {
                                            setAuthorInput(draftTrimmed);
                                            setShowAuthorDialog(false);
                                        }
                                    }}
                                />
                            </Field>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="primary"
                                disabled={!draftIsValid}
                                onClick={() => {
                                    setAuthorInput(draftTrimmed);
                                    setShowAuthorDialog(false);
                                }}
                            >
                                Browse
                            </Button>
                            <DialogTrigger disableButtonEnhancement>
                                <Button>Cancel</Button>
                            </DialogTrigger>
                        </DialogActions>
                    </DialogSurface>
                </Dialog>
            )}

            {vaultState.loading && vaultPlans.length === 0 ? (
                <Spinner size="small" label="Loading vault…" />
            ) : vaultState.error && vaultPlans.length === 0 ? (
                <div className={classes.vaultError}>
                    <MessageBar intent="error">
                        <MessageBarBody>
                            {vaultState.error instanceof Error ? vaultState.error.message : String(vaultState.error)}
                        </MessageBarBody>
                    </MessageBar>
                    <Button size="small" onClick={() => currentPubkey && loadVault(currentPubkey)}>
                        Retry
                    </Button>
                </div>
            ) : vaultPlans.length > 0 || showPublishAsNew ? (
                <>
                    <DataGrid
                        items={vaultPlans}
                        columns={vaultColumns}
                        getRowId={(item: NostrPlanInfo) => item.id}
                        columnSizingOptions={{
                            name: { minWidth: 140, idealWidth: 220 },
                            date: { minWidth: 90, idealWidth: 130, defaultWidth: 130 },
                            actions: { minWidth: 96, idealWidth: 130, defaultWidth: 130 },
                        }}
                        size="small"
                        selectionMode="single"
                        selectedItems={selectedRowId !== undefined ? new Set([selectedRowId]) : new Set()}
                        onSelectionChange={(_, data) => {
                            if (!currentPubkey) return;
                            const raw = [...data.selectedItems][0] as string | undefined;
                            if (raw === undefined || raw === NEW_PLAN_ID) {
                                onSelectedChange(undefined, currentPubkey);
                                return;
                            }
                            const item = vaultPlans.find((p) => p.id === raw);
                            if (item) onSelectedChange(item, currentPubkey);
                        }}
                        subtleSelection
                    >
                        {/* Standalone row above the header — not part of `items`, so it's always
                            visible and never competes for a spot in the scrollable list below. */}
                        {showPublishAsNew && (
                            <TableRowIdContextProvider value={NEW_PLAN_ID}>
                                <DataGridRow<NostrPlanInfo>
                                    selectionCell={{ radioIndicator: { 'aria-label': 'Select plan' } }}
                                >
                                    {({ renderCell, columnId }) => (
                                        <DataGridCell focusMode={getCellFocusMode(columnId)}>
                                            {renderCell(newRow)}
                                        </DataGridCell>
                                    )}
                                </DataGridRow>
                            </TableRowIdContextProvider>
                        )}
                        <DataGridHeader>
                            <DataGridRow>
                                {({ renderHeaderCell }) => (
                                    <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                                )}
                            </DataGridRow>
                        </DataGridHeader>
                        <div className={classes.scrollArea}>
                            {vaultPlans.length > 0 ? (
                                <DataGridBody<NostrPlanInfo>>
                                    {({ item, rowId }) => (
                                        <DataGridRow<NostrPlanInfo>
                                            key={rowId}
                                            className={
                                                item.visibility === 'private' && !isOwnVault
                                                    ? classes.lockedRow
                                                    : undefined
                                            }
                                            selectionCell={{ radioIndicator: { 'aria-label': 'Select plan' } }}
                                            onDoubleClick={() => {
                                                if (currentPubkey && onRowDoubleClick)
                                                    onRowDoubleClick(item, currentPubkey);
                                            }}
                                        >
                                            {({ renderCell, columnId }) => (
                                                <DataGridCell focusMode={getCellFocusMode(columnId)}>
                                                    {renderCell(item)}
                                                </DataGridCell>
                                            )}
                                        </DataGridRow>
                                    )}
                                </DataGridBody>
                            ) : (
                                <Text
                                    size={200}
                                    style={{ color: tokens.colorNeutralForeground3, padding: tokens.spacingVerticalM }}
                                >
                                    No plans found.
                                </Text>
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
                        </div>
                    </DataGrid>
                    {vaultState.error && (
                        <MessageBar intent="error">
                            <MessageBarBody>
                                {vaultState.error instanceof Error
                                    ? vaultState.error.message
                                    : String(vaultState.error)}
                            </MessageBarBody>
                        </MessageBar>
                    )}
                </>
            ) : !vaultState.loading ? (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    No plans found.
                </Text>
            ) : null}

            {/* Duplicate dialog */}
            <Dialog
                open={!!duplicateSource}
                onOpenChange={(_, d) => {
                    if (!d.open) setDuplicateSource(null);
                }}
            >
                <DialogSurface>
                    <DialogTitle>Duplicate plan</DialogTitle>
                    <DialogContent>
                        <p style={{ margin: `0 0 ${tokens.spacingVerticalS} 0` }}>
                            Copy <strong>{duplicateSource?.name}</strong> to your vault under a new name.
                        </p>
                        <Field label="New plan name">
                            <Input
                                autoFocus
                                value={duplicateName}
                                onChange={(_, d) => setDuplicateName(sanitizePlanName(d.value))}
                                placeholder="e.g. p1-copy"
                                onKeyUp={(e) => e.key === 'Enter' && duplicateName.trim() && startDuplicate()}
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

            {/* Edit dialog — not reachable when renameSelectedInline is set, since renaming and
                changing access happen through the inline row controls instead. */}
            <Dialog
                open={!renameSelectedInline && !!editSource}
                onOpenChange={(_, d) => {
                    if (!d.open) setEditSource(null);
                }}
            >
                <DialogSurface>
                    <DialogTitle>Edit plan</DialogTitle>
                    <DialogContent>
                        <p style={{ margin: `0 0 ${tokens.spacingVerticalS} 0` }}>
                            Renaming <strong>{editSource?.name}</strong> or changing its access does not change its
                            share link.
                        </p>
                        <Field label="Name">
                            <Input
                                autoFocus
                                value={editName}
                                onChange={(_, d) => setEditName(sanitizePlanName(d.value))}
                                onKeyUp={(e) => e.key === 'Enter' && editName.trim() && editHasChanges && startEdit()}
                            />
                        </Field>
                        <div className={classes.editAccessRow}>
                            <Text className={classes.editAccessLabel}>Access</Text>
                            <Tooltip
                                content={
                                    editVisibility === 'private'
                                        ? 'Private — encrypted, only your key can open it'
                                        : 'Public — anyone can view it'
                                }
                                relationship="label"
                                withArrow
                            >
                                <ToggleButton
                                    checked={editVisibility === 'private'}
                                    icon={editVisibility === 'private' ? <LockClosedRegular /> : <LockOpenRegular />}
                                    onClick={() =>
                                        setEditVisibility(editVisibility === 'private' ? 'public' : 'private')
                                    }
                                >
                                    {editVisibility === 'private' ? 'Private' : 'Public'}
                                </ToggleButton>
                            </Tooltip>
                        </div>
                        {editState.error && (
                            <MessageBar intent="error" style={{ marginTop: tokens.spacingVerticalS }}>
                                <MessageBarBody>{String(editState.error)}</MessageBarBody>
                            </MessageBar>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            disabled={!editName.trim() || editState.loading || !editHasChanges}
                            icon={editState.loading ? <Spinner size="tiny" /> : undefined}
                            onClick={startEdit}
                        >
                            {editState.loading ? 'Saving…' : 'Save'}
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

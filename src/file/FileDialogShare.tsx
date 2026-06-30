import {
    Button,
    DialogActions,
    DialogTrigger,
    Field,
    MessageBar,
    MessageBarBody,
    Spinner,
    Textarea,
    TextareaOnChangeData,
} from '@fluentui/react-components';
import React, { ChangeEvent, useState } from 'react';
import { HtmlPortalNode, InPortal } from 'react-reverse-portal';
import { useLoadScene, useSetSource } from '../SceneProvider';
import { textToScene } from '../file';
import type { Scene } from '../scene';
import { useCloseDialog } from '../useCloseDialog';
import { useIsDirty } from '../useIsDirty';
import { useConfirmUnsavedChanges } from './confirm';
import { fetchPlan, getNostrShareUrl } from './nostr';
import { parseSceneLink } from './share';

const NOSTR_PREFIX = '#/nostr/';

export interface ImportFromStringProps {
    actions: HtmlPortalNode;
}

export const ImportFromString: React.FC<ImportFromStringProps> = ({ actions }) => {
    const isDirty = useIsDirty();
    const loadScene = useLoadScene();
    const setSource = useSetSource();
    const dismissDialog = useCloseDialog();

    const [confirmUnsavedChanges, renderModal] = useConfirmUnsavedChanges();
    const [data, setData] = useState('');
    const [error, setError] = useState<string | undefined>();
    const [loading, setLoading] = useState(false);

    const importLink = async () => {
        const text = data.trim();
        if (!text) return;

        if (isDirty && !(await confirmUnsavedChanges())) return;

        // Try parsing as a URL first — could be a Nostr link or embedded-data link
        try {
            const url = new URL(text);
            if (url.hash.startsWith(NOSTR_PREFIX)) {
                const rest = url.hash.slice(NOSTR_PREFIX.length);
                const slash = rest.indexOf('/');
                if (slash > 0) {
                    const pubkey = decodeURIComponent(rest.slice(0, slash));
                    const dtag = decodeURIComponent(rest.slice(slash + 1));
                    if (pubkey && dtag) {
                        setLoading(true);
                        setError(undefined);
                        try {
                            const { scene, visibility } = await fetchPlan(pubkey, dtag);
                            history.replaceState(null, '', getNostrShareUrl(pubkey, dtag));
                            setSource({ type: 'nostr', name: dtag, pubkey, visibility });
                            loadScene(scene);
                            dismissDialog();
                        } catch (ex) {
                            setError(ex instanceof Error ? ex.message : 'Failed to load Nostr plan.');
                        } finally {
                            setLoading(false);
                        }
                        return;
                    }
                }
            }
        } catch {
            // Not a valid URL — fall through to scene data decode
        }

        const scene = decodeScene(text);
        if (!scene) {
            setError('Invalid link');
            return;
        }

        loadScene(scene);
        dismissDialog();
    };

    const onChange = (ev: ChangeEvent<HTMLTextAreaElement>, d: TextareaOnChangeData) => {
        setData(d.value);
        setError(undefined);
    };

    const onKeyUp = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            importLink();
        }
    };

    return (
        <>
            <Field label="Enter plan link" validationState={error ? 'error' : 'none'} validationMessage={error}>
                <Textarea rows={4} onChange={onChange} onKeyUp={onKeyUp} autoFocus />
            </Field>
            {loading && (
                <MessageBar intent="info">
                    <MessageBarBody>Loading plan from Nostr relays…</MessageBarBody>
                </MessageBar>
            )}

            {renderModal()}

            <InPortal node={actions}>
                <DialogActions>
                    <Button
                        appearance="primary"
                        disabled={!data.trim() || loading}
                        icon={loading ? <Spinner size="tiny" /> : undefined}
                        onClick={importLink}
                    >
                        Import
                    </Button>
                    <DialogTrigger>
                        <Button>Cancel</Button>
                    </DialogTrigger>
                </DialogActions>
            </InPortal>
        </>
    );
};

function decodeScene(text: string): Scene | undefined {
    try {
        return parseSceneLink(new URL(text));
    } catch (ex) {
        if (!(ex instanceof TypeError)) {
            console.error('Invalid plan data', ex);
            return undefined;
        }
    }

    // Not a URL — try as plain base64/encoded data
    try {
        return textToScene(decodeURIComponent(text));
    } catch (ex) {
        console.error('Invalid plan data', ex);
    }

    return undefined;
}

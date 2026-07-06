import { Button, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import React from 'react';
import { useAsyncFn } from 'react-use';
import { RelayHealth, retryRelay } from './nostr';
import { RelayStatusRow } from './RelayStatusRow';
import { PUBLISH_STATUS_LABELS } from './relayStatusLabels';
import { useRelayStatus } from './useRelayStatus';

const useStyles = makeStyles({
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        padding: `${tokens.spacingVerticalS} 0`,
    },
});

interface RelayRowProps {
    url: string;
    status: RelayHealth;
}

const RelayRow: React.FC<RelayRowProps> = ({ url, status }) => {
    const [retryState, retry] = useAsyncFn(() => retryRelay(url), [url]);

    return (
        <RelayStatusRow url={url} status={status} label={PUBLISH_STATUS_LABELS[status]}>
            {status === 'error' && (
                <Button
                    size="small"
                    appearance="subtle"
                    disabled={retryState.loading}
                    icon={retryState.loading ? <Spinner size="tiny" /> : undefined}
                    onClick={retry}
                >
                    {retryState.loading ? '' : 'Retry'}
                </Button>
            )}
        </RelayStatusRow>
    );
};

export const RelayPublishList: React.FC = () => {
    const classes = useStyles();
    const { relays } = useRelayStatus();

    return (
        <div className={classes.list}>
            {relays.map(({ url, status }) => (
                <RelayRow key={url} url={url} status={status} />
            ))}
        </div>
    );
};

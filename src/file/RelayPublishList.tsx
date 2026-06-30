import { Button, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import React from 'react';
import { useAsyncFn } from 'react-use';
import { RelayHealth, retryRelay } from './nostr';
import { useRelayStatus } from './useRelayStatus';

const useStyles = makeStyles({
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        padding: `${tokens.spacingVerticalS} 0`,
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
    dot: {
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        flexShrink: 0,
    },
    url: {
        flexGrow: 1,
        fontSize: tokens.fontSizeBase200,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: tokens.colorNeutralForeground2,
    },
    statusText: {
        fontSize: tokens.fontSizeBase100,
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
    },
});

const STATUS_COLORS: Record<RelayHealth, string> = {
    connected: tokens.colorPaletteGreenBackground3,
    error: tokens.colorPaletteRedBackground3,
    checking: tokens.colorPaletteYellowBackground3,
};

const STATUS_LABELS: Record<RelayHealth, string> = {
    connected: 'saved',
    error: 'failed',
    checking: 'pending…',
};

interface RelayRowProps {
    url: string;
    status: RelayHealth;
}

const RelayRow: React.FC<RelayRowProps> = ({ url, status }) => {
    const classes = useStyles();
    const [retryState, retry] = useAsyncFn(() => retryRelay(url), [url]);

    return (
        <div className={classes.row}>
            {status === 'checking' ? (
                <Spinner size="extra-tiny" />
            ) : (
                <span className={classes.dot} style={{ backgroundColor: STATUS_COLORS[status] }} />
            )}
            <span className={classes.url}>{url.replace('wss://', '')}</span>
            <span className={classes.statusText}>{STATUS_LABELS[status]}</span>
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
        </div>
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

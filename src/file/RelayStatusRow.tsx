import { Spinner, makeStyles, tokens } from '@fluentui/react-components';
import React from 'react';
import { RelayHealth } from './nostr';

const useStyles = makeStyles({
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
    skipped: tokens.colorNeutralForeground3,
    stale: tokens.colorPaletteMarigoldBackground3,
    incomplete: tokens.colorPaletteMarigoldBackground3,
};

export interface RelayStatusRowProps {
    url: string;
    status: RelayHealth;
    label: string;
    children?: React.ReactNode;
}

/** One relay's row in a status breakdown list — a dot/spinner, the relay name, a label, and an optional trailing action. */
export const RelayStatusRow: React.FC<RelayStatusRowProps> = ({ url, status, label, children }) => {
    const classes = useStyles();

    return (
        <div className={classes.row}>
            {status === 'checking' ? (
                <Spinner size="extra-tiny" />
            ) : (
                <span className={classes.dot} style={{ backgroundColor: STATUS_COLORS[status] }} />
            )}
            <span className={classes.url}>{url.replace('wss://', '')}</span>
            <span className={classes.statusText}>{label}</span>
            {children}
        </div>
    );
};

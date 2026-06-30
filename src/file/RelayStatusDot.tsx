import { Spinner, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import React from 'react';
import { RelayInfo, RelayStatusResult, aggregateRelayStatus } from './useRelayStatus';

const useStyles = makeStyles({
    dot: {
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        flexShrink: 0,
        cursor: 'default',
        verticalAlign: 'middle',
    },
    tooltipContent: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        minWidth: '180px',
    },
    relayRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        fontSize: tokens.fontSizeBase100,
    },
    relayDot: {
        display: 'inline-block',
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        flexShrink: 0,
    },
    relayName: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
});

const STATUS_COLORS = {
    connected: tokens.colorPaletteGreenBackground3,
    error: tokens.colorPaletteRedBackground3,
    checking: tokens.colorPaletteYellowBackground3,
} as const;

const STATUS_LABELS = {
    connected: 'connected',
    error: 'unreachable',
    checking: 'checking…',
} as const;

const RelayTooltipContent: React.FC<{ relays: RelayInfo[] }> = ({ relays }) => {
    const classes = useStyles();
    return (
        <div className={classes.tooltipContent}>
            {relays.map((relay) => (
                <div key={relay.url} className={classes.relayRow}>
                    <span className={classes.relayDot} style={{ backgroundColor: STATUS_COLORS[relay.status] }} />
                    <span className={classes.relayName}>{relay.url.replace('wss://', '')}</span>
                    <span style={{ color: tokens.colorNeutralForeground3, marginLeft: 'auto' }}>
                        {STATUS_LABELS[relay.status]}
                    </span>
                </div>
            ))}
        </div>
    );
};

export interface RelayStatusDotProps {
    status: RelayStatusResult;
    className?: string;
    style?: React.CSSProperties;
}

export const RelayStatusDot: React.FC<RelayStatusDotProps> = ({ status, className, style }) => {
    const classes = useStyles();
    const agg = aggregateRelayStatus(status);

    if (agg === 'checking') {
        return <Spinner size="extra-tiny" className={className} style={style} />;
    }

    const color =
        agg === 'connected'
            ? tokens.colorPaletteGreenBackground3
            : agg === 'partial'
              ? tokens.colorPaletteYellowBackground3
              : tokens.colorPaletteRedBackground3;

    return (
        <Tooltip content={<RelayTooltipContent relays={status.relays} />} relationship="description" withArrow>
            <span
                className={`${classes.dot} ${className ?? ''}`}
                style={{ backgroundColor: color, ...style }}
                role="img"
                aria-label={`Relay status: ${agg}`}
            />
        </Tooltip>
    );
};

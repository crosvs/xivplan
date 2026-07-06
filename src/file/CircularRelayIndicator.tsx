import { Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import React from 'react';
import { ConsensusProgress, RelayHealth } from './nostr';
import { RelayInfo, RelayStatusResult, aggregateRelayStatus } from './useRelayStatus';

const SIZE = 20;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const useStyles = makeStyles({
    svg: {
        display: 'block',
        flexShrink: 0,
        verticalAlign: 'middle',
    },
    spin: {
        transformOrigin: '50% 50%',
        transformBox: 'fill-box',
        animationDuration: '1.1s',
        animationIterationCount: 'infinite',
        animationTimingFunction: 'linear',
        animationName: {
            from: { transform: 'rotate(0deg)' },
            to: { transform: 'rotate(360deg)' },
        },
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

const DOT_COLORS: Record<RelayHealth, string> = {
    connected: tokens.colorPaletteGreenBackground3,
    error: tokens.colorPaletteRedBackground3,
    checking: tokens.colorPaletteYellowBackground3,
    skipped: tokens.colorNeutralForeground3,
    stale: tokens.colorPaletteMarigoldBackground3,
};

function aggregateColor(agg: ReturnType<typeof aggregateRelayStatus>): string {
    switch (agg) {
        case 'connected':
            return tokens.colorPaletteGreenBackground3;
        case 'partial':
            return tokens.colorPaletteYellowBackground3;
        case 'offline':
            return tokens.colorPaletteRedBackground3;
        default:
            return tokens.colorBrandBackground;
    }
}

const RelayTooltipContent: React.FC<{ relays: RelayInfo[]; labels: Record<RelayHealth, string> }> = ({
    relays,
    labels,
}) => {
    const classes = useStyles();
    return (
        <div className={classes.tooltipContent}>
            {relays.map((relay) => (
                <div key={relay.url} className={classes.relayRow}>
                    <span className={classes.relayDot} style={{ backgroundColor: DOT_COLORS[relay.status] }} />
                    <span className={classes.relayName}>{relay.url.replace('wss://', '')}</span>
                    <span style={{ color: tokens.colorNeutralForeground3, marginLeft: 'auto' }}>
                        {labels[relay.status]}
                    </span>
                </div>
            ))}
        </div>
    );
};

export interface CircularRelayIndicatorProps {
    /** Omit for an indeterminate operation with no consensus target (e.g. loading the vault list). */
    progress?: ConsensusProgress;
    /** Per-relay breakdown shown in the hover tooltip. */
    relayStatus: RelayStatusResult;
    /** Wording for the tooltip rows. */
    labels: Record<RelayHealth, string>;
    /** Rendered width/height in px — the internal geometry always scales to fit. Defaults to 20 (button-icon size). */
    size?: number;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * A single compact element combining relay status (fill color, hover for per-relay detail) with
 * consensus progress (the ring around it) — meant to sit wherever a loading Spinner would, inside
 * a button or next to a list, so a plan open/publish/vault-load always shows both at a glance.
 */
export const CircularRelayIndicator: React.FC<CircularRelayIndicatorProps> = ({
    progress,
    relayStatus,
    labels,
    size = SIZE,
    className,
    style,
}) => {
    const classes = useStyles();
    const agg = aggregateRelayStatus(relayStatus);
    const dotColor = aggregateColor(agg);

    const determinate = progress !== undefined && progress.threshold > 0;
    const fraction = determinate ? Math.min(progress.agreeing, progress.threshold) / progress.threshold : 0;
    const ringColor =
        determinate && progress.status === 'short' ? tokens.colorPaletteMarigoldBackground3 : tokens.colorBrandBackground;

    return (
        <Tooltip
            content={<RelayTooltipContent relays={relayStatus.relays} labels={labels} />}
            relationship="description"
            withArrow
        >
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className={`${classes.svg} ${className ?? ''}`}
                style={style}
                role="img"
                aria-label={`Relay status: ${agg}`}
            >
                <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={tokens.colorNeutralStroke2}
                    strokeWidth={STROKE}
                />
                <circle
                    className={determinate ? undefined : classes.spin}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={determinate ? CIRCUMFERENCE : `${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}`}
                    strokeDashoffset={determinate ? CIRCUMFERENCE * (1 - fraction) : 0}
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                />
                <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS - STROKE - 1.5} fill={dotColor} />
            </svg>
        </Tooltip>
    );
};

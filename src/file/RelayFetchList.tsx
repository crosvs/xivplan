import { makeStyles, tokens } from '@fluentui/react-components';
import React from 'react';
import { RelayStatusRow } from './RelayStatusRow';
import { FETCH_STATUS_LABELS } from './relayStatusLabels';
import { useFetchStatus } from './useFetchStatus';

const useStyles = makeStyles({
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        padding: `${tokens.spacingVerticalS} 0`,
    },
});

/** Live per-relay breakdown of the plan fetch currently in progress (opening a plan by URL or from the vault). */
export const RelayFetchList: React.FC = () => {
    const classes = useStyles();
    const { relays } = useFetchStatus();

    return (
        <div className={classes.list}>
            {relays.map(({ url, status }) => (
                <RelayStatusRow key={url} url={url} status={status} label={FETCH_STATUS_LABELS[status]} />
            ))}
        </div>
    );
};

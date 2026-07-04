import { makeStyles } from '@fluentui/react-components';
import React, { useRef } from 'react';
import { useElementSize } from '../useElementSize';
import { CombinedPanel } from './CombinedPanel';
import { DetailsPanel, PropertiesSection, SceneSection } from './DetailsPanel';
import { MainPanel } from './MainPanel';
import { getPanelStageCount } from './panelStages';

/**
 * Portrait-only: the shared bottom panel row follows the same 3-stage priority system as
 * landscape (see panelStages.ts), reactive to the row's actual measured width rather than a
 * static portrait-vs-landscape switch -- so a wide portrait window (e.g. a resized desktop
 * browser) still splits into multiple panels. Unlike landscape, portrait's panels always take
 * equal widths, since there's no canvas to keep primary alongside them here.
 */
export const PortraitPanels: React.FC = () => {
    const classes = useStyles();
    const containerRef = useRef<HTMLDivElement>(null);
    const { width } = useElementSize(containerRef);
    const stage = width > 0 ? getPanelStageCount(width) : 1;

    return (
        <div ref={containerRef} className={classes.container}>
            {stage === 1 && <CombinedPanel fill />}
            {stage === 2 && (
                <>
                    <MainPanel fill />
                    <DetailsPanel split={false} fill />
                </>
            )}
            {stage === 3 && (
                <>
                    <MainPanel fill />
                    <PropertiesSection fill />
                    <SceneSection fill />
                </>
            )}
        </div>
    );
};

const useStyles = makeStyles({
    container: {
        gridArea: 'panel',
        display: 'flex',
        flexFlow: 'row',
        gap: '8px',
        minWidth: 0,
        overflow: 'hidden',
    },
});

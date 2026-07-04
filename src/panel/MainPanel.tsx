import { makeStyles, mergeClasses, Tab, TabList, tokens } from '@fluentui/react-components';
import React, { useState } from 'react';
import { EditMode } from '../editMode';
import { TabActivity } from '../TabActivity';
import { useEditMode } from '../useEditMode';
import { ArenaPanel } from './ArenaPanel';
import { DrawPanel } from './DrawPanel';
import { PANEL_PADDING, PANEL_WIDTH } from './PanelStyles';
import { PrefabsPanel } from './PrefabsPanel';
import { StatusPanel } from './StatusPanel';

type Tabs = 'arena' | 'objects' | 'status' | 'draw';

export interface MainPanelProps {
    /** Stretches to fill the available width instead of using its fixed natural width, and adds
     * top padding -- used when shown side by side with DetailsPanel in portrait's shared panel
     * row (see PortraitPanels) instead of framing the canvas as its own dedicated grid column. */
    fill?: boolean;
}

export const MainPanel: React.FC<MainPanelProps> = ({ fill }) => {
    const classes = useStyles();
    const [tab, setTab] = useState<Tabs>('objects');
    const [, setEditMode] = useEditMode();

    const handleTabChanged = (tab: Tabs) => {
        setTab(tab);

        // Cancel any special edit mode when changing tabs.
        // Draw tab should always default to draw mode.
        const newMode = tab === 'draw' ? EditMode.Draw : EditMode.Normal;
        setEditMode(newMode);
    };

    return (
        <div className={mergeClasses(classes.wrapper, fill && classes.fill)}>
            <TabList selectedValue={tab} onTabSelect={(ev, data) => handleTabChanged(data.value as Tabs)}>
                <Tab value="arena">Arena</Tab>
                <Tab value="objects">Objects</Tab>
                <Tab value="status">Icons</Tab>
                <Tab value="draw">Draw</Tab>
            </TabList>
            <div className={classes.container}>
                <TabActivity value="arena" activeTab={tab}>
                    <ArenaPanel />
                </TabActivity>
                <TabActivity value="objects" activeTab={tab}>
                    <PrefabsPanel />
                </TabActivity>
                <TabActivity value="status" activeTab={tab}>
                    <StatusPanel />
                </TabActivity>
                <TabActivity value="draw" activeTab={tab}>
                    <DrawPanel />
                </TabActivity>
            </div>
        </div>
    );
};

const useStyles = makeStyles({
    // gridArea only takes effect in landscape, where this is a direct grid child framing the
    // canvas -- in portrait's side-by-side mode (fill) it's nested inside a flex row instead, so
    // the gridArea assignment is simply inert there.
    wrapper: {
        gridArea: 'left-panel',
        width: `${PANEL_WIDTH}px`,
        userSelect: 'none',
        backgroundColor: tokens.colorNeutralBackground2,
        overflow: 'hidden',
    },

    fill: {
        width: 'auto',
        minWidth: `${PANEL_WIDTH}px`,
        flex: '1 1 0',
        // Butts directly against the canvas above (no header/steps row in between like in
        // landscape), so it needs its own top padding for breathing room.
        paddingTop: `${PANEL_PADDING}px`,
    },

    container: {
        height: 'calc(100% - 44px)',
        overflow: 'auto',
    },
});

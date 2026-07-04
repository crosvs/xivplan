import { makeStyles, mergeClasses, Tab, TabList, tokens } from '@fluentui/react-components';
import React, { useState } from 'react';
import { TabActivity } from '../TabActivity';
import { EditMode } from '../editMode';
import { useEditMode } from '../useEditMode';
import { ArenaPanel } from './ArenaPanel';
import { DrawPanel } from './DrawPanel';
import { COMBINED_PANEL_WIDTH, PANEL_PADDING } from './PanelStyles';
import { PrefabsPanel } from './PrefabsPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SceneObjectsPanel } from './SceneObjectsPanel';
import { StatusPanel } from './StatusPanel';

type Tabs = 'arena' | 'objects' | 'status' | 'draw' | 'properties' | 'scene';

export interface CombinedPanelProps {
    /** Stretches to fill the available width and adds top padding -- used for portrait's Stage 1
     * (see PortraitPanels), where this is nested in a flex row rather than a dedicated grid
     * column. Without it, this renders at its own natural width in the `right-panel` grid area,
     * for landscape's Stage 1 (see MainPage), where there's only room for one merged panel and
     * no separate left-side MainPanel at all. */
    fill?: boolean;
}

/**
 * Stage-1 stand-in for MainPanel + DetailsPanel side by side, merging every tab from both into
 * one panel -- used whenever there isn't room for two panels side by side at their minimum
 * comfortable width, in either orientation (see panelStages.ts).
 */
export const CombinedPanel: React.FC<CombinedPanelProps> = ({ fill }) => {
    const classes = useStyles();
    const [tab, setTab] = useState<Tabs>('objects');
    const [, setEditMode] = useEditMode();

    const handleTabChanged = (value: Tabs) => {
        setTab(value);

        // Cancel any special edit mode when changing tabs.
        // Draw tab should always default to draw mode.
        const newMode = value === 'draw' ? EditMode.Draw : EditMode.Normal;
        setEditMode(newMode);
    };

    return (
        <div className={mergeClasses(classes.wrapper, fill && classes.fill)}>
            <TabList size="small" selectedValue={tab} onTabSelect={(ev, data) => handleTabChanged(data.value as Tabs)}>
                <Tab value="objects">Objects</Tab>
                <Tab value="properties">Properties</Tab>
                <Tab value="scene">Scene</Tab>
                <Tab value="status">Icons</Tab>
                <Tab value="draw">Draw</Tab>
                <Tab value="arena">Arena</Tab>
            </TabList>
            <div className={classes.container}>
                <TabActivity value="properties" activeTab={tab}>
                    <PropertiesPanel />
                </TabActivity>
                <TabActivity value="scene" activeTab={tab}>
                    <SceneObjectsPanel />
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
                <TabActivity value="arena" activeTab={tab}>
                    <ArenaPanel />
                </TabActivity>
            </div>
        </div>
    );
};

const useStyles = makeStyles({
    // Default (landscape Stage 1): a direct grid child, wide enough for all 6 merged tab labels
    // (see COMBINED_PANEL_WIDTH) -- unlike MainPanel/DetailsPanel's own default width, which only
    // ever needs to fit one group's worth of tabs.
    wrapper: {
        gridArea: 'right-panel',
        width: `${COMBINED_PANEL_WIDTH}px`,
        userSelect: 'none',
        backgroundColor: tokens.colorNeutralBackground2,
        overflow: 'hidden',
    },

    // Portrait Stage 1: nested in PortraitPanels' flex row instead, so it fills whatever width
    // that row gives it, and needs its own top padding since it butts directly against the
    // canvas above (no header/steps row in between like in landscape).
    fill: {
        gridArea: 'unset',
        width: 'auto',
        minWidth: 0,
        flex: '1 1 0',
        paddingTop: `${PANEL_PADDING}px`,
    },

    container: {
        height: 'calc(100% - 44px)',
        overflow: 'auto',
    },
});

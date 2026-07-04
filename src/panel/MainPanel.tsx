import { makeStyles, Tab, TabList, tokens } from '@fluentui/react-components';
import React, { useState } from 'react';
import { EditMode } from '../editMode';
import { TabActivity } from '../TabActivity';
import { useEditMode } from '../useEditMode';
import { ArenaPanel } from './ArenaPanel';
import { DrawPanel } from './DrawPanel';
import { PANEL_WIDTH } from './PanelStyles';
import { PrefabsPanel } from './PrefabsPanel';
import { StatusPanel } from './StatusPanel';

type Tabs = 'arena' | 'objects' | 'status' | 'draw';

export const MainPanel: React.FC = () => {
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
        <div className={classes.wrapper}>
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
    wrapper: {
        gridArea: 'left-panel',
        width: `${PANEL_WIDTH}px`,
        userSelect: 'none',
        backgroundColor: tokens.colorNeutralBackground2,
        // Without this, this grid item's automatic minimum height defaults to its
        // content's full (unscrolled) height, which -- in portrait mode, where this
        // shares a fractional row with the scene -- lets it balloon past its fair
        // share of the row and squeeze the scene out instead of scrolling internally.
        overflow: 'hidden',

        // In portrait mode this panel shares a row with the right panel instead of
        // framing the scene, so it needs to fill whatever width that half gives it.
        '@media (orientation: portrait)': {
            width: '100%',
        },
    },

    container: {
        height: 'calc(100% - 44px)',
        overflow: 'auto',
    },
});

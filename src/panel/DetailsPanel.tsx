import { Divider, makeStyles, mergeClasses, Tab, TabList, tokens, typographyStyles } from '@fluentui/react-components';
import React, { PropsWithChildren, useState } from 'react';
import { TabActivity } from '../TabActivity';
import { useControlStyles } from '../useControlStyles';
import { PANEL_PADDING, PANEL_WIDTH, WIDE_PANEL_WIDTH } from './PanelStyles';
import { PropertiesPanel } from './PropertiesPanel';
import { SceneObjectsPanel } from './SceneObjectsPanel';

const PROPERTIES_TITLE = 'Properties';
const OBJECTS_TITLE = 'Scene';

export interface DetailsPanelProps {
    /** Whether to split Properties/Scene into two side-by-side panels instead of one tabbed
     * panel -- an explicit decision from the caller's own panel-stage calculation (see
     * panelStages.ts), rather than a heuristic this component computes for itself, since whether
     * there's room depends on how many *other* panels are also being shown alongside it. */
    split: boolean;
    /** Stretches to fill the available width instead of using its fixed natural width, and adds
     * top padding -- used when shown side by side with MainPanel in portrait's shared panel row
     * (see PortraitPanels) instead of framing the canvas as its own dedicated grid column. */
    fill?: boolean;
}

/**
 * Bundles Properties+Scene together, either as one tabbed panel or (when split) as two panels
 * with an internal divider, both at their natural landscape width, or filling their container
 * split into equal halves. Used directly by landscape (both split states) and by portrait's
 * Stage 2 (unsplit only) -- portrait's Stage 3 instead renders PropertiesSection/SceneSection
 * independently as full top-level peers of MainPanel, since making all three panels equal width
 * requires them to be siblings rather than one bundled 2/3-width unit (see PortraitPanels).
 */
export const DetailsPanel: React.FC<DetailsPanelProps> = ({ split, fill }) => {
    if (split) {
        return <WideDetailsPanel fill={fill} />;
    }

    return <ShortDetailsPanel fill={fill} />;
};

const WideDetailsPanel: React.FC<{ fill?: boolean }> = ({ fill }) => {
    const classes = useStyles();
    const controlClasses = useControlStyles();

    return (
        <div className={mergeClasses(classes.widePanel, fill && classes.fill)}>
            <DetailsSection title={PROPERTIES_TITLE}>
                <PropertiesPanel />
            </DetailsSection>

            <Divider inset vertical className={controlClasses.divider} />

            <DetailsSection title={OBJECTS_TITLE} wide>
                <SceneObjectsPanel />
            </DetailsSection>
        </div>
    );
};

type Tabs = 'properties' | 'objects';

const ShortDetailsPanel: React.FC<{ fill?: boolean }> = ({ fill }) => {
    const classes = useStyles();
    const [tab, setTab] = useState<Tabs>('properties');

    return (
        <div className={mergeClasses(classes.wrapper, fill && classes.fill)}>
            <TabList selectedValue={tab} onTabSelect={(ev, data) => setTab(data.value as Tabs)}>
                <Tab value="properties">{PROPERTIES_TITLE}</Tab>
                <Tab value="objects">{OBJECTS_TITLE}</Tab>
            </TabList>
            <TabActivity value="properties" activeTab={tab}>
                <PropertiesPanel className={classes.shortPanelContent} />
            </TabActivity>
            <TabActivity value="objects" activeTab={tab}>
                <SceneObjectsPanel className={classes.shortPanelContent} />
            </TabActivity>
        </div>
    );
};

interface DetailsSectionProps extends PropsWithChildren {
    title: string;
    /** Slightly wider than the default PANEL_WIDTH -- matches WideDetailsPanel's existing
     * landscape proportions, where Scene gets a bit more room than Properties. Ignored when
     * `fill` is set, since a fill section always takes an equal share instead. */
    wide?: boolean;
    /** Equal-flex sizing instead of a fixed natural width, as a fully independent top-level
     * panel rather than bundled inside WideDetailsPanel -- used by portrait's Stage 3
     * (PropertiesSection/SceneSection below), which needs Group A and both halves of Group B to
     * all end up the same width, not Group A equal to the *pair* of them combined. */
    fill?: boolean;
}

const DetailsSection: React.FC<DetailsSectionProps> = ({ title, wide, fill, children }) => {
    const classes = useStyles();

    return (
        <section
            className={mergeClasses(classes.section, wide && !fill && classes.wideSection, fill && classes.sectionFill)}
        >
            <header className={classes.header}>{title}</header>
            <div className={classes.scrollable}>{children}</div>
        </section>
    );
};

export interface DetailsSubPanelProps {
    fill?: boolean;
}

/** Properties, as a standalone top-level panel -- see DetailsSection. */
export const PropertiesSection: React.FC<DetailsSubPanelProps> = ({ fill }) => (
    <DetailsSection title={PROPERTIES_TITLE} fill={fill}>
        <PropertiesPanel />
    </DetailsSection>
);

/** Scene, as a standalone top-level panel -- see DetailsSection. */
export const SceneSection: React.FC<DetailsSubPanelProps> = ({ fill }) => (
    <DetailsSection title={OBJECTS_TITLE} fill={fill}>
        <SceneObjectsPanel />
    </DetailsSection>
);

const useStyles = makeStyles({
    // gridArea only takes effect in landscape, where this is a direct grid child framing the
    // canvas -- in portrait's side-by-side mode (fill) it's nested inside a flex row instead, so
    // the gridArea assignment is simply inert there.
    wrapper: {
        gridArea: 'right-panel',
        flexShrink: '0 !important',
        width: `${PANEL_WIDTH}px`,
        backgroundColor: tokens.colorNeutralBackground2,
        overflow: 'hidden',
    },

    widePanel: {
        display: 'flex',
        flexFlow: 'row',

        gridArea: 'right-panel',
        flexShrink: '0 !important',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: tokens.colorNeutralBackground2,
    },

    fill: {
        width: 'auto',
        minWidth: `${PANEL_WIDTH}px`,
        flex: '1 1 0',
        // Butts directly against the canvas above (no header/steps row in between like in
        // landscape), so it needs its own top padding for breathing room.
        paddingTop: `${PANEL_PADDING}px`,
    },

    header: {
        ...typographyStyles.subtitle2,
        padding: `0 ${PANEL_PADDING}px`,
    },

    section: {
        width: `${PANEL_WIDTH}px`,
        display: 'flex',
        flexFlow: 'column',
    },

    wideSection: {
        width: `${WIDE_PANEL_WIDTH}px`,
    },

    // Used when a DetailsSection is rendered as its own independent top-level panel (portrait
    // Stage 3) rather than bundled inside widePanel -- needs its own background/height/overflow
    // and top padding, matching MainPanel/DetailsPanel's own `fill` treatment, since there's no
    // longer a shared wrapper providing those.
    sectionFill: {
        width: 'auto',
        minWidth: `${PANEL_WIDTH}px`,
        flex: '1 1 0',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: tokens.colorNeutralBackground2,
        paddingTop: `${PANEL_PADDING}px`,
    },

    scrollable: {
        overflowY: 'auto',
    },

    shortPanelContent: {
        // This panel's own grid area is now sized by its grid row/cell rather than
        // spanning from just below the header to the bottom of the viewport, so its
        // content only needs to account for the TabList's own height, not the header.
        height: 'calc(100% - 44px)',
        overflow: 'auto',
    },
});

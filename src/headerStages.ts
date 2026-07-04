import { useWindowSize } from 'react-use';

/**
 * Priority collapse system for the site header, mirroring panelStages.ts's approach: rather than
 * every button collapsing to icon-only at once (or the Help/About/GitHub/theme group collapsing
 * into a menu only when the *layout* goes portrait, regardless of whether there's actually room),
 * each group collapses independently, in priority order, as real window width gets tight enough
 * to need it -- so buttons that comfortably fit stay expanded even while others don't.
 *
 * Collapse priority (first to go first): E > C > D > B > A. The logo (Group 0) never collapses.
 *
 * Widths below are measured-and-rounded estimates (Fluent's rendered button sizes for this app's
 * specific labels), not exact -- like PANEL_WIDTH elsewhere in this codebase, "close enough to
 * avoid premature collapse or overflow" is the goal, not pixel-perfect layout math.
 */

const LOGO_WIDTH = 90; // "XIVPlan" at its natural (portrait, non grid-aligned) width
const CHROME_OVERHEAD = 130; // header padding + toolbar dividers + inter-item gaps

interface GroupWidths {
    expanded: number;
    collapsed: number;
}

const GROUP_A: GroupWidths = { expanded: 101, collapsed: 32 }; // Preview/Editor
const GROUP_B: GroupWidths = { expanded: 219, collapsed: 88 }; // Open, Save/Save as/Publish/Download
const GROUP_C: GroupWidths = { expanded: 192, collapsed: 64 }; // Undo, Redo
const GROUP_D: GroupWidths = { expanded: 96, collapsed: 32 }; // Share
const GROUP_E: GroupWidths = { expanded: 241, collapsed: 32 }; // Help, About, GitHub, theme toggle

export interface HeaderCollapseState {
    collapseA: boolean;
    collapseB: boolean;
    collapseC: boolean;
    collapseD: boolean;
    collapseE: boolean;
}

// Ordered from least to most collapsed, following the E > C > D > B > A priority.
const STAGES: readonly HeaderCollapseState[] = [
    { collapseE: false, collapseC: false, collapseD: false, collapseB: false, collapseA: false },
    { collapseE: true, collapseC: false, collapseD: false, collapseB: false, collapseA: false },
    { collapseE: true, collapseC: true, collapseD: false, collapseB: false, collapseA: false },
    { collapseE: true, collapseC: true, collapseD: true, collapseB: false, collapseA: false },
    { collapseE: true, collapseC: true, collapseD: true, collapseB: true, collapseA: false },
    { collapseE: true, collapseC: true, collapseD: true, collapseB: true, collapseA: true },
];

function widthOf(state: HeaderCollapseState): number {
    return (
        LOGO_WIDTH +
        CHROME_OVERHEAD +
        (state.collapseA ? GROUP_A.collapsed : GROUP_A.expanded) +
        (state.collapseB ? GROUP_B.collapsed : GROUP_B.expanded) +
        (state.collapseC ? GROUP_C.collapsed : GROUP_C.expanded) +
        (state.collapseD ? GROUP_D.collapsed : GROUP_D.expanded) +
        (state.collapseE ? GROUP_E.collapsed : GROUP_E.expanded)
    );
}

export function getHeaderCollapseState(availableWidth: number): HeaderCollapseState {
    for (const stage of STAGES) {
        if (widthOf(stage) <= availableWidth) {
            return stage;
        }
    }
    return STAGES[STAGES.length - 1]!;
}

export function useHeaderCollapseState(): HeaderCollapseState {
    const { width } = useWindowSize();
    return getHeaderCollapseState(width);
}

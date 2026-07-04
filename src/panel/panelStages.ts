import { PANEL_WIDTH } from './PanelStyles';

// Rough allowance for the gap between adjacent panels.
export const PANEL_STAGE_GAP = 8;

/**
 * Priority system shared by portrait (bottom panel row) and landscape (left/right columns):
 * Group A (Arena/Objects/Icons/Draw) never splits -- it's always one tabbed panel. Group B
 * (Properties/Scene) is the one that gets to split into two side-by-side panels, since it's
 * more frequently useful than Group A's tabs. Both groups only ever get as many "slots" (each
 * roughly PANEL_WIDTH wide) as comfortably fit:
 *   1 slot  -- Group A and Group B merge into a single combined panel (CombinedPanel).
 *   2 slots -- Group A and Group B (still merged/tabbed) show side by side.
 *   3 slots -- Group A shows alongside Group B split into its own two panels.
 */
export type PanelStage = 1 | 2 | 3;

export function getPanelStageCount(availableWidth: number): PanelStage {
    const twoSlots = PANEL_WIDTH * 2 + PANEL_STAGE_GAP;
    const threeSlots = PANEL_WIDTH * 3 + PANEL_STAGE_GAP * 2;

    if (availableWidth >= threeSlots) {
        return 3;
    }
    if (availableWidth >= twoSlots) {
        return 2;
    }
    return 1;
}

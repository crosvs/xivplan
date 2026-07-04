import { PREFAB_ICON_SIZE } from '../prefabs/PrefabIconStyles';

export const PANEL_COLUMNS = 6;
export const PANEL_PADDING = 8;
export const SCROLLBAR_MARGIN = 20;
export const PANEL_WIDTH = (PREFAB_ICON_SIZE + PANEL_PADDING) * PANEL_COLUMNS + PANEL_PADDING + SCROLLBAR_MARGIN;
export const WIDE_PANEL_WIDTH = PANEL_WIDTH + 32;

// Wide enough that all 6 of CombinedPanel's merged tab labels (Properties/Scene/Objects/Icons/
// Draw/Arena, ~349px measured end to end) fit without clipping or scrolling -- PANEL_WIDTH alone
// is sized for a single group's worth of tabs, not all of them combined into one TabList.
export const COMBINED_PANEL_WIDTH = 350;

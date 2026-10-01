import {
    Button,
    Field,
    SpinButton,
    type SpinButtonChangeEvent,
    type SpinButtonOnChangeData,
    Text,
    ToggleButton,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
    typographyStyles,
} from '@fluentui/react-components';
import React, { useEffect } from 'react';
import { DEFAULT_FILTERS, type SimilarityFilters } from '../CrossStepContext';
import { useScene } from '../SceneProvider';
import { useAvailableFilters, useCrossStepSelection, useSelection, useSimilarObjects } from '../selection';
import { useControlStyles } from '../useControlStyles';
import { ObjectList } from './ObjectList';

const FILTER_KEYS = [
    'trackId',
    'properties',
    'position',
    'rotation',
    'linkedTo',
] as const satisfies readonly (keyof SimilarityFilters)[];

const FILTER_INFO: Record<keyof SimilarityFilters, { label: string; description: string }> = {
    trackId: { label: 'Track ID', description: 'Objects with the same Track ID' },
    properties: {
        label: 'Size & Shape',
        description: 'Objects with the same size, shape, and style, e.g. width, length, radius, color, or tether style',
    },
    position: { label: '+ Position', description: 'Objects at the same position, within the tolerance' },
    rotation: { label: '+ Rotation', description: 'Objects facing the same direction, within the tolerance' },
    linkedTo: {
        label: 'Linked to',
        description:
            'Objects tethered, attached, or facing the same object. On other pages, the linked object must have a Track ID.',
    },
};

export interface SceneObjectsPanelProps {
    className?: string;
}

export const SceneObjectsPanel: React.FC<SceneObjectsPanelProps> = ({ className }) => {
    const classes = useStyles();
    const controlClasses = useControlStyles();
    const { dispatch, step, stepIndex } = useScene();
    const [selection, setSelection] = useSelection();
    const available = useAvailableFilters();
    const {
        filters,
        setFilters,
        positionTolerance,
        setPositionTolerance,
        rotationTolerance,
        setRotationTolerance,
        setSelection: setCrossStep,
    } = useCrossStepSelection();

    // Clear all filters when selection is empty
    useEffect(() => {
        if (selection.size === 0) {
            setFilters(DEFAULT_FILTERS);
        }
    }, [selection, setFilters]);

    // Clear any filters that are no longer applicable to the current selection.
    // Return prev if values are unchanged to avoid a spurious context re-render.
    useEffect(() => {
        setFilters((prev) => {
            const next = { ...prev };
            for (const key of FILTER_KEYS) {
                next[key] = prev[key] && available[key];
            }
            return FILTER_KEYS.every((key) => next[key] === prev[key]) ? prev : next;
        });
    }, [available, setFilters]);

    const similar = useSimilarObjects(filters, { position: positionTolerance, rotation: rotationTolerance });
    const filterMatches = similar.get(stepIndex);

    const anyFilterActive = FILTER_KEYS.some((key) => filters[key]);
    const hasSelection = selection.size > 0;
    const showFilters = hasSelection;
    const showActions = anyFilterActive && similar.size > 0;

    const handleToleranceChange = (_: SpinButtonChangeEvent, data: SpinButtonOnChangeData) => {
        setPositionTolerance(data.value ?? 0);
    };

    const handleRotationToleranceChange = (_: SpinButtonChangeEvent, data: SpinButtonOnChangeData) => {
        setRotationTolerance(data.value ?? 0);
    };

    const toggleFilter = (key: keyof SimilarityFilters) => setFilters((f) => ({ ...f, [key]: !f[key] }));

    const handleSelectOnThisPage = () => {
        if (filterMatches) {
            setSelection(new Set(filterMatches));
        }
    };

    const handleSelectOnAllPages = () => {
        setCrossStep(similar);
        // Also select the matches on this page, so they are highlighted and moved together like the
        // matches on other pages, rather than only the original selection.
        if (filterMatches) {
            setSelection(new Set(filterMatches));
        }
    };

    const moveObject = (from: number, to: number) => {
        dispatch({ type: 'move', from, to });
    };

    return (
        <div className={mergeClasses(controlClasses.panel, controlClasses.noSelect, className)}>
            {showFilters && (
                <div className={classes.filterSection}>
                    <div className={classes.filterRow}>
                        <Text className={classes.filterLabel}>Select by:</Text>
                        <div className={classes.pillRow}>
                            {FILTER_KEYS.filter((key) => available[key]).map((key) => (
                                <Tooltip key={key} content={FILTER_INFO[key].description} relationship="description">
                                    <ToggleButton size="small" checked={filters[key]} onClick={() => toggleFilter(key)}>
                                        {FILTER_INFO[key].label}
                                    </ToggleButton>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                    {filters.position && (
                        <Field label="Tolerance (px)" orientation="horizontal" className={classes.toleranceField}>
                            <SpinButton
                                size="small"
                                value={positionTolerance}
                                min={0}
                                step={1}
                                onChange={handleToleranceChange}
                            />
                        </Field>
                    )}
                    {filters.rotation && (
                        <Field
                            label="Rotation tolerance (°)"
                            orientation="horizontal"
                            className={classes.toleranceField}
                        >
                            <SpinButton
                                size="small"
                                value={rotationTolerance}
                                min={0}
                                max={180}
                                step={1}
                                onChange={handleRotationToleranceChange}
                            />
                        </Field>
                    )}
                    {showActions && (
                        <div className={classes.actionRow}>
                            <Button
                                size="small"
                                appearance="subtle"
                                onClick={handleSelectOnThisPage}
                                disabled={!filterMatches?.size}
                            >
                                Select on this page
                            </Button>
                            <Button size="small" appearance="subtle" onClick={handleSelectOnAllPages}>
                                Select on all pages
                            </Button>
                        </div>
                    )}
                </div>
            )}
            <ObjectList objects={step.objects} onMove={moveObject} filterMatches={filterMatches} />
        </div>
    );
};

const useStyles = makeStyles({
    filterSection: {
        display: 'flex',
        flexFlow: 'column',
        gap: tokens.spacingVerticalXS,
        paddingBottom: tokens.spacingVerticalS,
        borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        marginBottom: tokens.spacingVerticalXS,
    },

    filterRow: {
        display: 'flex',
        flexFlow: 'row',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },

    filterLabel: {
        ...typographyStyles.caption1Strong,
        color: tokens.colorNeutralForeground2,
        whiteSpace: 'nowrap',
    },

    pillRow: {
        display: 'flex',
        flexFlow: 'row',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalXS,
    },

    toleranceField: {
        marginTop: tokens.spacingVerticalXXS,
    },

    actionRow: {
        display: 'flex',
        flexFlow: 'row',
        gap: tokens.spacingHorizontalXS,
        flexWrap: 'wrap',
    },
});

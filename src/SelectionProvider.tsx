import React, { type PropsWithChildren, useMemo, useState } from 'react';
import { CrossStepContext, type CrossStepSelection, DEFAULT_FILTERS, type SimilarityFilters } from './CrossStepContext';
import { DragSelectionContext, type SceneSelection, SelectionContext, SpotlightContext } from './SelectionContext';

export const SelectionProvider: React.FC<PropsWithChildren> = ({ children }) => {
    const state = useState<SceneSelection>(() => new Set());
    const dragState = useState<SceneSelection>(() => new Set());
    const spotlightState = useState<SceneSelection>(() => new Set());
    const [crossStepSelection, setCrossStepSelection] = useState<CrossStepSelection>(() => new Map());
    const [filters, setFilters] = useState<SimilarityFilters>(DEFAULT_FILTERS);
    const [positionTolerance, setPositionTolerance] = useState(0);
    const [rotationTolerance, setRotationTolerance] = useState(0);

    const crossStepContextValue = useMemo(
        () => ({
            selection: crossStepSelection,
            setSelection: setCrossStepSelection,
            filters,
            setFilters,
            positionTolerance,
            setPositionTolerance,
            rotationTolerance,
            setRotationTolerance,
        }),
        [
            crossStepSelection,
            setCrossStepSelection,
            filters,
            setFilters,
            positionTolerance,
            setPositionTolerance,
            rotationTolerance,
            setRotationTolerance,
        ],
    );

    return (
        <SelectionContext value={state}>
            <SpotlightContext value={spotlightState}>
                <DragSelectionContext value={dragState}>
                    <CrossStepContext value={crossStepContextValue}>{children}</CrossStepContext>
                </DragSelectionContext>
            </SpotlightContext>
        </SelectionContext>
    );
};

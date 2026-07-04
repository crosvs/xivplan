import React, { PropsWithChildren, useState } from 'react';
import { DEFAULT_VIEW_TRANSFORM, ViewTransform, ViewTransformContext } from './ViewTransformContext';

export const ViewTransformProvider: React.FC<PropsWithChildren> = ({ children }) => {
    const state = useState<ViewTransform>(DEFAULT_VIEW_TRANSFORM);

    return <ViewTransformContext value={state}>{children}</ViewTransformContext>;
};

import { useContext } from 'react';
import { ViewTransformContext, ViewTransformState } from './ViewTransformContext';

export function useViewTransform(): ViewTransformState {
    return useContext(ViewTransformContext);
}

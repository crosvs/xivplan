import { use } from 'react';
import { ViewTransformContext, type ViewTransformState } from './ViewTransformContext';

export function useViewTransform(): ViewTransformState {
    return use(ViewTransformContext);
}

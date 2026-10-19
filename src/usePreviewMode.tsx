import { use } from 'react';
import { PreviewModeContext, type PreviewModeState } from './PreviewModeContext';

export function usePreviewMode(): PreviewModeState {
    return use(PreviewModeContext);
}

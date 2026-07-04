import { useContext } from 'react';
import { PreviewModeContext, PreviewModeState } from './PreviewModeContext';

export function usePreviewMode(): PreviewModeState {
    return useContext(PreviewModeContext);
}

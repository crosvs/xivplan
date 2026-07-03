import React, { PropsWithChildren, useState } from 'react';
import { PreviewModeContext } from './PreviewModeContext';

export interface PreviewModeProviderProps extends PropsWithChildren {
    /** Whether the plan should start in preview mode, e.g. when loaded from a share URL. */
    initialValue?: boolean;
}

export const PreviewModeProvider: React.FC<PreviewModeProviderProps> = ({ initialValue = false, children }) => {
    const state = useState<boolean>(initialValue);

    return <PreviewModeContext value={state}>{children}</PreviewModeContext>;
};

import { createContext, Dispatch, SetStateAction } from 'react';

export type PreviewModeState = [boolean, Dispatch<SetStateAction<boolean>>];

export const PreviewModeContext = createContext<PreviewModeState>([false, () => undefined]);

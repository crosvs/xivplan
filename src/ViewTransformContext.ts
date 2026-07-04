import { createContext, Dispatch, SetStateAction } from 'react';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 5;

export interface ViewTransform {
    scale: number;
    x: number;
    y: number;
}

export const DEFAULT_VIEW_TRANSFORM: ViewTransform = { scale: 1, x: 0, y: 0 };

export type ViewTransformState = [ViewTransform, Dispatch<SetStateAction<ViewTransform>>];

export const ViewTransformContext = createContext<ViewTransformState>([DEFAULT_VIEW_TRANSFORM, () => undefined]);

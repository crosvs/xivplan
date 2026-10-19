import { createContext, use } from 'react';
import { type SceneObject } from '../scene';

export const DisplayObjectsContext = createContext<readonly SceneObject[]>([]);

export function useDisplayObjectsList(): readonly SceneObject[] {
    return use(DisplayObjectsContext);
}

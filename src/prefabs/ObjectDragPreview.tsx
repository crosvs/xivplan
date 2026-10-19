import React from 'react';
import { ScenePreview } from '../render/SceneRenderer';
import { ArenaShape, GridType, type Arena, type Scene, type SceneObjectPrototype } from '../scene';
import { getObjectPreviewPosition, getObjectPreviewSize } from './objectDragUtil';

export interface ObjectDragPreviewProps {
    object: SceneObjectPrototype;
    /**
     * The canvas zoom level the preview will be CSS-scaled by. Rendering at a matching pixel ratio
     * keeps it sharp when zoomed in instead of upscaling a 100% rendering.
     */
    scale?: number;
}

export const ObjectDragPreview: React.FC<ObjectDragPreviewProps> = ({ object, scale = 1 }) => {
    const size = getObjectPreviewSize(object);
    const position = getObjectPreviewPosition(object);

    const arena: Arena = {
        shape: ArenaShape.None,
        width: size.x,
        height: size.y,
        padding: 0,
        grid: { type: GridType.None },
    };

    const scene: Scene = {
        arena,
        nextId: 0,
        steps: [
            {
                objects: [{ id: 0, ...object, ...position }],
            },
        ],
    };

    return (
        <ScenePreview
            scene={scene}
            arena={arena}
            width={size.x}
            height={size.y}
            backgroundColor="transparent"
            simple
            pixelRatio={window.devicePixelRatio * Math.max(1, scale)}
        />
    );
};

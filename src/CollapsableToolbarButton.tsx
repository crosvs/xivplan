import { SplitButton, SplitButtonProps, ToolbarButton, ToolbarButtonProps, Tooltip } from '@fluentui/react-components';
import React from 'react';

export interface CollapsableToolbarButtonProps extends ToolbarButtonProps {
    /** Hides the text label, keeping only the icon -- an explicit decision from the caller's own
     * header-stage calculation (see headerStages.ts), rather than a single shared breakpoint,
     * since each button group now collapses independently in priority order. */
    collapsed?: boolean;
}

export const CollapsableToolbarButton: React.FC<CollapsableToolbarButtonProps> = ({
    children,
    collapsed,
    ...props
}) => {
    if (!collapsed) {
        return <ToolbarButton {...props}>{children}</ToolbarButton>;
    }

    return (
        <Tooltip content={<div>{children}</div>} relationship="label" withArrow>
            <ToolbarButton {...props} />
        </Tooltip>
    );
};

export interface CollapsableSplitButtonProps extends SplitButtonProps {
    /** See CollapsableToolbarButtonProps.collapsed. */
    collapsed?: boolean;
}

export const CollapsableSplitButton: React.FC<CollapsableSplitButtonProps> = ({ children, collapsed, ...props }) => {
    if (!collapsed) {
        return <SplitButton {...props}>{children}</SplitButton>;
    }

    return (
        <Tooltip content={<div>{children}</div>} relationship="label" withArrow>
            <SplitButton {...props} />
        </Tooltip>
    );
};

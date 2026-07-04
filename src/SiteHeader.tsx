import {
    Button,
    Link,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    InfoRegular,
    NavigationRegular,
    QuestionCircleRegular,
    WeatherMoonFilled,
    WeatherSunnyFilled,
} from '@fluentui/react-icons';
import React, { HTMLAttributes, useContext, useState } from 'react';
import { OutPortal } from 'react-reverse-portal';
import { useMedia } from 'react-use';
import { AboutDialog } from './AboutDialog';
import { ExternalLink } from './ExternalLink';
import { HelpContext } from './HelpContext';
import { PANEL_WIDTH } from './panel/PanelStyles';
import { DarkModeContext } from './ThemeContext';
import { ToolbarContext } from './ToolbarContext';

const GAP = tokens.spacingHorizontalL;
const HEADER_HEIGHT = '48px';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexFlow: 'row',
        alignItems: 'center',
        columnGap: GAP,
        minHeight: HEADER_HEIGHT,
        paddingInlineEnd: '30px',
    },
    title: {
        display: 'flex',
        alignItems: 'baseline',
        boxSizing: 'border-box',
        paddingLeft: tokens.spacingHorizontalM,
        gap: GAP,
        width: `calc(${PANEL_WIDTH}px - ${GAP})`,
        textDecoration: 'none',
    },
    commandBar: {
        flexGrow: 1,
    },
    link: {
        color: tokens.colorNeutralForeground2,
    },
    toggleLabel: {
        color: tokens.colorNeutralForeground2,
        fontWeight: 500,
    },
    themeButton: {
        minWidth: '130px',
    },
    moreButton: {
        minWidth: 'auto',
    },
});

export const SiteHeader: React.FC<HTMLAttributes<HTMLElement>> = ({ className, ...props }) => {
    const classes = useStyles();
    const toolbarNode = useContext(ToolbarContext);
    const [, setHelpOpen] = useContext(HelpContext);
    const [darkMode, setDarkMode] = useContext(DarkModeContext);
    const [aboutOpen, setAboutOpen] = useState(false);
    // Same breakpoint used for the portrait panel layout -- collapse these into a menu
    // wherever screen space is tight enough that the layout itself goes portrait/mobile.
    const isCompact = useMedia('(orientation: portrait)');

    return (
        <header className={mergeClasses(classes.root, className)} {...props}>
            <div className={classes.title}>
                <Text size={500} weight="semibold">
                    XIVPlan
                </Text>
            </div>
            <div className={classes.commandBar}>
                <OutPortal node={toolbarNode} />
            </div>

            {isCompact ? (
                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <Button
                            appearance="subtle"
                            className={classes.moreButton}
                            icon={<NavigationRegular />}
                            aria-label="More options"
                        />
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem icon={<QuestionCircleRegular />} onClick={() => setHelpOpen(true)}>
                                Help
                            </MenuItem>
                            <MenuItem icon={<InfoRegular />} onClick={() => setAboutOpen(true)}>
                                About
                            </MenuItem>
                            <MenuItem as="a" href="https://github.com/Crosvs/xivplan" target="_blank" rel="noreferrer">
                                GitHub
                            </MenuItem>
                            <MenuItem
                                icon={darkMode ? <WeatherMoonFilled /> : <WeatherSunnyFilled />}
                                onClick={() => setDarkMode(!darkMode)}
                            >
                                {darkMode ? 'Dark theme' : 'Light theme'}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            ) : (
                <>
                    <Link onClick={() => setHelpOpen(true)} className={classes.link}>
                        Help
                    </Link>
                    <Link onClick={() => setAboutOpen(true)} className={classes.link}>
                        About
                    </Link>
                    <ExternalLink className={classes.link} href="https://github.com/Crosvs/xivplan" noIcon>
                        GitHub
                    </ExternalLink>
                    <div>
                        <Button
                            appearance="subtle"
                            className={classes.themeButton}
                            icon={darkMode ? <WeatherMoonFilled /> : <WeatherSunnyFilled />}
                            onClick={() => setDarkMode(!darkMode)}
                        >
                            {darkMode ? 'Dark theme' : 'Light theme'}
                        </Button>
                    </div>
                </>
            )}

            <AboutDialog open={aboutOpen} onOpenChange={(ev, data) => setAboutOpen(data.open)} />
        </header>
    );
};

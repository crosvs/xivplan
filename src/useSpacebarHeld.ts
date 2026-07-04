import { useEffect, useState } from 'react';

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Tracks whether the spacebar is currently held down, so the canvas can temporarily
 * switch to pan mode -- ignores presses while a text input has focus so it doesn't
 * interfere with typing a literal space.
 */
export function useSpacebarHeld(): boolean {
    const [held, setHeld] = useState(false);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) {
                return;
            }
            setHeld(true);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                setHeld(false);
            }
        };
        // If focus leaves the window (e.g. alt-tab) while space is held, keyup never
        // fires -- reset so the app doesn't get stuck thinking space is still down.
        const onBlur = () => setHeld(false);

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
        };
    }, []);

    return held;
}

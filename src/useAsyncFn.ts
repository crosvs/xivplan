import { useAsync } from '@react-hookz/web';
import { useCallback } from 'react';

export interface AsyncFnState<T> {
    readonly loading: boolean;
    readonly error?: unknown;
    readonly value?: T;
}

/**
 * Wraps @react-hookz/web's useAsync() with the `[{ loading, error, value }, callback]` shape of
 * react-use's useAsyncFn(), which this was originally written against.
 *
 * The returned callback is stable and always calls the latest `fn`, so no dependency list is needed.
 * Like react-use, it never rejects: errors are reported through the returned state instead. Only the
 * most recent call updates the state, so an older call finishing late can't overwrite a newer one.
 */
export function useAsyncFn<T, Args extends unknown[]>(
    fn: (...args: Args) => Promise<T>,
): [AsyncFnState<T>, (...args: Args) => Promise<T | undefined>] {
    const [state, { execute }] = useAsync(fn);

    const callback = useCallback((...args: Args) => execute(...args).catch(() => undefined), [execute]);

    return [
        {
            loading: state.status === 'loading',
            // Like react-use, a previous error stays visible while retrying, until a call succeeds.
            error: state.status === 'success' ? undefined : state.error,
            value: state.result,
        },
        callback,
    ];
}

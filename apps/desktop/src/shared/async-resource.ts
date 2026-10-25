/**
 * One async read shared by dashboard pages. This module does not fetch or render.
 *
 * `forbidden` is an explicit unauthorized result. A missing API is not a status
 * of its own: the caller stores `forbidden` only when the sentence the person
 * already sees is the logged-out one.
 */
export type AsyncResource<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'forbidden'; readonly message: string };

/**
 * `UNAUTHORIZED` is forbidden. Every other code, including the product code
 * `FORBIDDEN`, stays an error. The messages are the sentences the caller
 * already shows; this function does not rewrite them.
 */
export function asyncFailure<T>(
  code: string,
  messages: { readonly forbidden: string; readonly error: string },
): AsyncResource<T> {
  if (code === 'UNAUTHORIZED') return { status: 'forbidden', message: messages.forbidden };
  return { status: 'error', message: messages.error };
}

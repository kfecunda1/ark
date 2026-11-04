import type { RefObject } from "react";

// Belt-and-suspenders guard against double-submitting a form by clicking
// Save/Create twice in quick succession — the likely cause of the
// duplicate leads seen in practice. The React-state-driven `disabled`
// prop on these buttons (disabled={isPending}, etc.) already covers the
// common case, but it only takes effect once React commits the next
// render; a fast enough second click can still land in the gap before
// that commit.
//
// This closes that gap by disabling the button synchronously — but
// hooked to the form's `submit` event, not the button's own `click`.
// That distinction matters: disabling a submit button from inside its
// own click handler, before the browser has dispatched `submit`, can
// make the browser drop that submission entirely (disabling a button
// while it is still mid-click can "win the race" against the pending
// submit in some browsers, since submission has not yet actually been
// committed to) — so the guard would silently break the very first,
// legitimate click, not just a rapid second one. Hooking it to `submit`
// instead runs only once the browser has already committed to
// submitting, so disabling there can't cancel that submission; it only
// takes a disabled, inert button out of a second click's way. A plain
// `onSubmit` on a form that also has an `action` function (React 19's
// server-action binding, used for the edit-mode forms this guards) runs
// first and — so long as it doesn't call preventDefault, which this
// doesn't — the action still dispatches normally afterward; call this
// from such a form's onSubmit, or as the first line of a form's own
// custom onSubmit handler for a form with no `action` prop.
//
// No separate re-enable is needed: once the submission settles (error or
// success) each form's own reactive `disabled={isPending}` binding
// re-renders to false, and React's commit overwrites this manual true.
export function disableSubmitButton(ref: RefObject<HTMLButtonElement | null>): void {
  if (ref.current) ref.current.disabled = true;
}

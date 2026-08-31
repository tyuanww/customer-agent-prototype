const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'menuitem',
]);

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target.isContentEditable ||
    target.getAttribute('contenteditable') === 'true' ||
    target.closest('[contenteditable="true"]')
  ) {
    return true;
  }

  const tagged = target.closest('input, textarea, select, button, a');
  if (tagged) {
    return true;
  }

  if (INTERACTIVE_TAGS.has(target.tagName)) {
    return true;
  }

  const role = target.getAttribute('role');
  return role !== null && INTERACTIVE_ROLES.has(role);
}

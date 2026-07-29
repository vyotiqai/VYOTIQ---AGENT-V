/** Platform-correct label for the search focus shortcut. */
export function searchShortcutLabel(): string {
  return window.vyotiq?.platform === 'darwin' ? '⌘K' : 'Ctrl+K'
}

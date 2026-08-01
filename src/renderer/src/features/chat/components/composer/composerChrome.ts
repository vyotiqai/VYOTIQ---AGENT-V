/**
 * Compact composer/toolbar chrome text.
 * Avoid truncate + leading-none on short labels — that clips Plus Jakarta Sans
 * descenders (g reads as q → “Aqent”).
 */
export const chromeLabelText =
  'text-xs leading-tight tracking-normal'

export const chromePillButton = [
  'inline-flex h-7 items-center rounded-xl px-1.5',
  chromeLabelText,
  'vy-transition hover:bg-surface hover:text-fg active:bg-surface',
  'disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]'
].join(' ')

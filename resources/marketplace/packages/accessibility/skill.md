---
name: accessibility
description: Use when improving or reviewing UI accessibility (keyboard, screen readers, contrast, semantics).
version: 1.0.0
---

# Accessibility

When improving or reviewing accessibility:

1. Use semantic HTML and correct roles before ARIA overrides.
2. Ensure full keyboard reachability and visible focus states.
3. Provide accessible names for controls; do not rely on color alone.
4. Check contrast for text and interactive states against WCAG AA where practical.
5. Respect `prefers-reduced-motion` for non-essential animation.
6. Verify status and errors are announced (live regions or associated text).
7. Prefer fixes that preserve existing visual design unless redesign is requested.

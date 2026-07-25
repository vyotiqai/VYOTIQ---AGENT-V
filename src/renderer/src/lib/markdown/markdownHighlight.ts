import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// Importing the `shiki` root entry registers every bundled grammar, which emits ~250
// chunks into the renderer build. Load the core plus the languages we actually render.
const LANGUAGE_LOADERS = {
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs')
} as const

type SupportedLanguage = keyof typeof LANGUAGE_LOADERS

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  md: 'markdown',
  py: 'python',
  yml: 'yaml'
}

let corePromise: Promise<HighlighterCore> | null = null
const loadedLanguages = new Set<SupportedLanguage>()

function getCore(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = createHighlighterCore({
      themes: [import('shiki/themes/github-dark.mjs'), import('shiki/themes/github-light.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine()
    })
  }
  return corePromise
}

function resolveLanguage(lang: string): SupportedLanguage | null {
  const normalized = lang.trim().toLowerCase()
  if (!normalized) return null
  if (normalized in LANGUAGE_LOADERS) return normalized as SupportedLanguage
  return LANGUAGE_ALIASES[normalized] ?? null
}

function resolveTheme(): 'github-dark' | 'github-light' {
  if (typeof document === 'undefined') return 'github-light'
  return document.documentElement.dataset.theme === 'dark' ? 'github-dark' : 'github-light'
}

/** Returns highlighted HTML, or null when the language is unsupported or loading fails. */
export async function highlightCode(text: string, lang: string): Promise<string | null> {
  const language = resolveLanguage(lang)
  if (!language) return null
  try {
    const core = await getCore()
    if (!loadedLanguages.has(language)) {
      await core.loadLanguage(await LANGUAGE_LOADERS[language]())
      loadedLanguages.add(language)
    }
    return core.codeToHtml(text, { lang: language, theme: resolveTheme() })
  } catch {
    return null
  }
}

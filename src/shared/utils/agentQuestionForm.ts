/** Typed ask_question form items and legacy → canonical normalization. */

export const AGENT_QUESTION_TYPES = ['single', 'multi', 'boolean', 'text'] as const
export type AgentQuestionType = (typeof AGENT_QUESTION_TYPES)[number]

export const AGENT_QUESTION_MAX_ITEMS = 8

export type AgentQuestionItem = {
  id: string
  prompt: string
  type: AgentQuestionType
  options?: string[]
  allowCustom?: boolean
}

export type AgentQuestionAnswer = {
  questionId: string
  values: string[]
}

export type NormalizedAskQuestionForm = {
  title?: string
  questions: AgentQuestionItem[]
}

function uniqueTrimmedStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function isQuestionType(value: unknown): value is AgentQuestionType {
  return (
    value === 'single' || value === 'multi' || value === 'boolean' || value === 'text'
  )
}

function validateItem(item: AgentQuestionItem, index: number): string | null {
  if (!item.id.trim()) return `questions[${index}].id is required`
  if (!item.prompt.trim()) return `questions[${index}].prompt is required`
  if (item.type === 'single' || item.type === 'multi') {
    if (!item.options || item.options.length < 2) {
      return `questions[${index}] (${item.type}) requires at least 2 options`
    }
  }
  return null
}

/** Normalize one raw question object from tool args. */
function parseTypedItem(raw: unknown, index: number): AgentQuestionItem | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: `questions[${index}] must be an object` }
  }
  const rec = raw as Record<string, unknown>
  const id = typeof rec.id === 'string' ? rec.id.trim() : ''
  const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim() : ''
  if (!isQuestionType(rec.type)) {
    return { error: `questions[${index}].type must be single, multi, boolean, or text` }
  }
  const type = rec.type
  const options = uniqueTrimmedStrings(rec.options)
  const allowCustom = rec.allowCustom === true

  const item: AgentQuestionItem = {
    id: id || `q${index + 1}`,
    prompt,
    type,
    ...(type === 'single' || type === 'multi'
      ? {
          ...(options.length ? { options } : {}),
          ...(allowCustom ? { allowCustom: true } : {})
        }
      : {})
  }

  const err = validateItem(item, index)
  if (err) return { error: err }
  return item
}

/**
 * Accepts typed `questions[]` or legacy `{ question, options, allowMultiple, allowCustom }`.
 * Typed forms default `allowCustom` off; legacy defaults it on when options exist.
 */
export function normalizeAskQuestionArgs(
  args: Record<string, unknown>
): { ok: true; form: NormalizedAskQuestionForm } | { ok: false; error: string } {
  const title =
    typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined

  if (Array.isArray(args.questions) && args.questions.length > 0) {
    if (args.questions.length > AGENT_QUESTION_MAX_ITEMS) {
      return {
        ok: false,
        error: `questions supports at most ${AGENT_QUESTION_MAX_ITEMS} items`
      }
    }
    const questions: AgentQuestionItem[] = []
    const ids = new Set<string>()
    for (let i = 0; i < args.questions.length; i++) {
      const parsed = parseTypedItem(args.questions[i], i)
      if ('error' in parsed) return { ok: false, error: parsed.error }
      if (ids.has(parsed.id)) {
        return { ok: false, error: `duplicate question id: ${parsed.id}` }
      }
      ids.add(parsed.id)
      questions.push(parsed)
    }
    return { ok: true, form: { ...(title ? { title } : {}), questions } }
  }

  const prompt = typeof args.question === 'string' ? args.question.trim() : ''
  if (!prompt) {
    return { ok: false, error: 'question or questions is required' }
  }

  const options = uniqueTrimmedStrings(args.options)
  const allowMultiple = args.allowMultiple === true
  // Legacy: custom text on by default when options are present.
  const allowCustom = args.allowCustom !== false

  let type: AgentQuestionType
  if (options.length === 0) {
    type = 'text'
  } else if (allowMultiple) {
    type = 'multi'
  } else {
    type = 'single'
  }

  if ((type === 'single' || type === 'multi') && options.length < 2) {
    return { ok: false, error: `${type} requires at least 2 options` }
  }

  const item: AgentQuestionItem = {
    id: 'q1',
    prompt,
    type,
    ...(type === 'single' || type === 'multi'
      ? {
          options,
          ...(allowCustom ? { allowCustom: true } : { allowCustom: false })
        }
      : {})
  }

  return {
    ok: true,
    form: { ...(title ? { title } : {}), questions: [item] }
  }
}

/** Human-readable tool result for the model. */
export function formatQuestionAnswers(
  form: NormalizedAskQuestionForm,
  answers: AgentQuestionAnswer[]
): string {
  if (answers.length === 0) return 'User provided no answer.'

  const byId = new Map(answers.map((a) => [a.questionId, a.values.filter((v) => v.trim())]))
  const { questions } = form

  if (questions.length === 1) {
    const q = questions[0]!
    const values = byId.get(q.id) ?? []
    if (values.length === 0) return 'User provided no answer.'
    if (values.length === 1) return `User answered: ${values[0]}`
    return `User answered:\n${values.map((a) => `- ${a}`).join('\n')}`
  }

  const lines = ['User answered:']
  for (const q of questions) {
    const values = byId.get(q.id) ?? []
    const formatted =
      values.length === 0 ? '(no answer)' : values.length === 1 ? values[0]! : values.join(', ')
    lines.push(`- ${q.prompt}: ${formatted}`)
  }
  return lines.join('\n')
}

/** Short summary for tool row / activity label. */
export function askQuestionSummary(form: NormalizedAskQuestionForm): string {
  if (form.title) return form.title.slice(0, 80)
  if (form.questions.length === 1) return form.questions[0]!.prompt.slice(0, 80)
  return `${form.questions.length} questions`
}

export function questionTypeHint(type: AgentQuestionType): string {
  switch (type) {
    case 'single':
      return 'Choose one'
    case 'multi':
      return 'Select all that apply'
    case 'boolean':
      return 'Yes or no'
    case 'text':
      return 'Your answer'
  }
}

import { memo, useMemo, useState, type FormEvent } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import {
  QUESTION_GATE_BODY,
  QUESTION_GATE_FOOTER,
  QUESTION_GATE_HEADER,
  QUESTION_GATE_SURFACE
} from '@renderer/lib/utils/layout'
import { questionTypeHint } from '@shared/utils/agentQuestionForm'
import type { UiAgentQuestion, UiAgentQuestionAnswer } from '@shared/transcript'
import { QuestionField } from './askQuestion/QuestionFields'

type FieldState = { values: string[]; customText: string }

function emptyFields(question: UiAgentQuestion): Record<string, FieldState> {
  const out: Record<string, FieldState> = {}
  for (const item of question.questions) {
    out[item.id] = { values: [], customText: '' }
  }
  return out
}

function fieldIsAnswered(item: UiAgentQuestion['questions'][number], state: FieldState): boolean {
  const values = state.values.map((v) => v.trim()).filter(Boolean)
  if (item.type === 'multi') return values.length > 0
  if (item.type === 'text') return values.length === 1 && values[0]!.length > 0
  return values.length === 1
}

function collectAnswers(
  question: UiAgentQuestion,
  fields: Record<string, FieldState>
): UiAgentQuestionAnswer[] {
  return question.questions.map((item) => {
    const state = fields[item.id] ?? { values: [], customText: '' }
    const values = state.values.map((v) => v.trim()).filter(Boolean)
    return { questionId: item.id, values }
  })
}

export const AskQuestionPanel = memo(function AskQuestionPanel({
  question,
  onSubmit
}: {
  question: UiAgentQuestion
  onSubmit?: (requestId: string, answers: UiAgentQuestionAnswer[]) => void | Promise<void>
}) {
  const [phase, setPhase] = useState<'idle' | 'pending' | 'done'>('idle')
  const [localError, setLocalError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, FieldState>>(() => emptyFields(question))

  const multi = question.questions.length > 1
  const headerTitle = question.title?.trim() || (multi ? 'Questions' : 'Question')
  const singleHint =
    !multi && question.questions[0] ? questionTypeHint(question.questions[0].type) : null

  const allAnswered = useMemo(
    () =>
      question.questions.every((item) =>
        fieldIsAnswered(item, fields[item.id] ?? { values: [], customText: '' })
      ),
    [fields, question.questions]
  )

  const setField = (id: string, values: string[], customText: string): void => {
    if (phase !== 'idle') return
    setFields((prev) => ({ ...prev, [id]: { values, customText } }))
  }

  const submit = (): void => {
    if (phase !== 'idle' || !allAnswered || !onSubmit) return
    const answers = collectAnswers(question, fields)
    setPhase('pending')
    setLocalError(null)
    void Promise.resolve(onSubmit(question.requestId, answers))
      .then(() => {
        setPhase('done')
      })
      .catch((err: unknown) => {
        setPhase('idle')
        setLocalError(err instanceof Error ? err.message : 'Could not send answer')
      })
  }

  const onFormSubmit = (e: FormEvent): void => {
    e.preventDefault()
    submit()
  }

  const busy = phase !== 'idle'
  const canSubmit = Boolean(onSubmit) && allAnswered && !busy
  const submitLabel =
    phase === 'pending' ? 'Sending…' : phase === 'done' ? 'Answered' : 'Submit answer'

  return (
    <form
      className={cn(QUESTION_GATE_SURFACE, 'w-full')}
      role="group"
      aria-labelledby={`ask-q-title-${question.requestId}`}
      aria-busy={phase === 'pending' ? true : undefined}
      onSubmit={onFormSubmit}
    >
      <div className={QUESTION_GATE_HEADER}>
        <Icon name="sparkles" size={14} className="shrink-0 text-accent" />
        <span id={`ask-q-title-${question.requestId}`} className="font-medium">
          {headerTitle}
        </span>
        {singleHint ? <span className="text-tertiary">{singleHint}</span> : null}
      </div>

      <div className={cn(QUESTION_GATE_BODY, 'flex flex-col gap-3')}>
        {question.questions.map((item) => {
          const promptId = `ask-q-prompt-${question.requestId}-${item.id}`
          const state = fields[item.id] ?? { values: [], customText: '' }
          return (
            <div key={item.id} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p id={promptId} className="text-sm font-medium text-fg">
                  {item.prompt}
                </p>
                {multi ? (
                  <span className="text-[11px] text-tertiary">{questionTypeHint(item.type)}</span>
                ) : null}
              </div>
              <QuestionField
                item={item}
                values={state.values}
                customText={state.customText}
                disabled={busy}
                promptId={promptId}
                onChange={(values, customText) => setField(item.id, values, customText)}
              />
            </div>
          )
        })}
      </div>

      {localError ? (
        <p className="px-3 pb-1 text-xs text-danger" role="alert">
          {localError}
        </p>
      ) : null}

      <div className={QUESTION_GATE_FOOTER}>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={phase === 'pending' ? true : undefined}
          className="rounded-md border border-accent bg-accent px-2.5 py-1 text-xs text-accent-fg vy-transition hover:opacity-90 disabled:opacity-[var(--vy-disabled-opacity)]"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
})


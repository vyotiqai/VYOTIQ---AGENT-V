import { memo, useEffect, useMemo, useState, type FormEvent } from 'react'
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

  // Same requestId can be replaced in place with new prompts/options; remount does not run.
  const questionShapeKey = useMemo(
    () =>
      [
        question.requestId,
        question.title ?? '',
        ...question.questions.map(
          (item) =>
            `${item.id}\0${item.prompt}\0${item.type}\0${item.allowCustom ? 1 : 0}\0${(item.options ?? []).join('\u001f')}`
        )
      ].join('\n'),
    [question]
  )

  useEffect(() => {
    setFields(emptyFields(question))
    setPhase('idle')
    setLocalError(null)
    // Only when shape changes — same requestId with a new object must not wipe in-progress answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by questionShapeKey
  }, [questionShapeKey])

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
        <span
          id={`ask-q-title-${question.requestId}`}
          className="shrink-0 font-medium text-fg"
        >
          {headerTitle}
        </span>
        {singleHint ? (
          <span className="min-w-0 truncate text-tertiary">{singleHint}</span>
        ) : multi ? (
          <span className="min-w-0 truncate text-tertiary">
            {question.questions.length} questions
          </span>
        ) : null}
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

        {localError ? (
          <p className="text-xs text-danger" role="alert">
            {localError}
          </p>
        ) : null}
      </div>

      <div className={QUESTION_GATE_FOOTER}>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={phase === 'pending' ? true : undefined}
          className={cn(
            'rounded-md border px-2.5 py-1 text-xs vy-transition',
            'disabled:opacity-[var(--vy-disabled-opacity)]',
            canSubmit
              ? 'border-border bg-surface text-fg hover:bg-surface-2'
              : 'border-border text-tertiary'
          )}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
})

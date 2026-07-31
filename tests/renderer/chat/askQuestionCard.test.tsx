/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AskQuestionPanel } from '@renderer/features/chat/components/AskQuestionPanel'
import type { UiAgentQuestion } from '@shared/transcript'

afterEach(() => {
  cleanup()
})

function baseQuestion(partial: Partial<UiAgentQuestion> & Pick<UiAgentQuestion, 'questions'>): UiAgentQuestion {
  return {
    requestId: 'q1',
    toolCallId: 't1',
    ...partial
  }
}

describe('AskQuestionPanel', () => {
  it('submits a single-choice selection', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <AskQuestionPanel
        question={baseQuestion({
          questions: [
            { id: 'q1', prompt: 'Which path?', type: 'single', options: ['A', 'B'] }
          ]
        })}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(onSubmit).toHaveBeenCalledWith('q1', [{ questionId: 'q1', values: ['A'] }])
    expect(await screen.findByRole('button', { name: 'Answered' })).toBeTruthy()
  })

  it('submits multi-select values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <AskQuestionPanel
        question={baseQuestion({
          questions: [
            {
              id: 'q1',
              prompt: 'Pick features',
              type: 'multi',
              options: ['A', 'B', 'C']
            }
          ]
        })}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(onSubmit).toHaveBeenCalledWith('q1', [{ questionId: 'q1', values: ['A', 'C'] }])
  })

  it('submits a boolean Yes/No answer', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <AskQuestionPanel
        question={baseQuestion({
          questions: [{ id: 'q1', prompt: 'Continue?', type: 'boolean' }]
        })}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(onSubmit).toHaveBeenCalledWith('q1', [{ questionId: 'q1', values: ['Yes'] }])
  })

  it('requires every question in a multi-question form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <AskQuestionPanel
        question={baseQuestion({
          title: 'Setup',
          questions: [
            { id: 'a', prompt: 'Mode?', type: 'single', options: ['Ask', 'Agent'] },
            { id: 'b', prompt: 'Notes', type: 'text' }
          ]
        })}
        onSubmit={onSubmit}
      />
    )

    expect(screen.getByText('Setup')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Ask' }))
    expect(screen.getByRole('button', { name: 'Submit answer' }).hasAttribute('disabled')).toBe(
      true
    )

    fireEvent.change(screen.getByPlaceholderText('Your answer…'), {
      target: { value: 'ship it' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(onSubmit).toHaveBeenCalledWith('q1', [
      { questionId: 'a', values: ['Ask'] },
      { questionId: 'b', values: ['ship it'] }
    ])
  })

  it('disables submit when onSubmit is missing', () => {
    render(
      <AskQuestionPanel
        question={baseQuestion({
          questions: [{ id: 'q1', prompt: 'No handler?', type: 'text' }]
        })}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Your answer…'), {
      target: { value: 'hello' }
    })

    expect(screen.getByRole('button', { name: 'Submit answer' }).hasAttribute('disabled')).toBe(
      true
    )
  })

  it('restores idle after submit failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(
      <AskQuestionPanel
        question={baseQuestion({
          questions: [{ id: 'q1', prompt: 'Retry?', type: 'text' }]
        })}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Your answer…'), {
      target: { value: 'yes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('boom')
    expect(screen.getByRole('button', { name: 'Submit answer' }).hasAttribute('disabled')).toBe(
      false
    )
  })

  it('hides custom text unless allowCustom is set', () => {
    render(
      <AskQuestionPanel
        question={baseQuestion({
          questions: [
            { id: 'q1', prompt: 'Pick', type: 'single', options: ['A', 'B'] }
          ]
        })}
      />
    )
    expect(screen.queryByPlaceholderText('Other…')).toBeNull()
  })
})

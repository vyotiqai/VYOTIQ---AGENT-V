/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AskQuestionCard } from '@renderer/features/chat/components/AskQuestionCard'

afterEach(() => {
  cleanup()
})

describe('AskQuestionCard', () => {
  it('submits a selected option', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <AskQuestionCard
        question={{
          requestId: 'q1',
          toolCallId: 't1',
          question: 'Which path?',
          options: ['A', 'B']
        }}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(onSubmit).toHaveBeenCalledWith('q1', ['A'])
    expect(await screen.findByRole('button', { name: 'Submit answer' })).toBeTruthy()
  })

  it('stays idle when onSubmit is missing', () => {
    render(
      <AskQuestionCard
        question={{
          requestId: 'q1',
          toolCallId: 't1',
          question: 'No handler?'
        }}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Your answer…'), {
      target: { value: 'hello' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(screen.getByRole('button', { name: 'Submit answer' }).hasAttribute('disabled')).toBe(
      false
    )
  })

  it('restores idle after submit failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(
      <AskQuestionCard
        question={{
          requestId: 'q1',
          toolCallId: 't1',
          question: 'Retry?'
        }}
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
})

import { afterEach, describe, expect, it } from 'vitest'
import {
  disposeAllPtySessions,
  killPty,
  listPtySessions
} from '@main/app/ptySessions'

describe('ptySessions', () => {
  afterEach(() => {
    disposeAllPtySessions()
  })

  it('starts with no sessions', () => {
    expect(listPtySessions()).toEqual([])
  })

  it('killPty returns false for unknown ids', () => {
    expect(killPty('missing-id')).toBe(false)
  })

  it('disposeAllPtySessions is safe when empty', () => {
    expect(() => disposeAllPtySessions()).not.toThrow()
    expect(listPtySessions()).toEqual([])
  })
})

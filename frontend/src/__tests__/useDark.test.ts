import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDark } from '../hooks/useDark.ts'

describe('useDark', () => {
  let listeners: Array<(e: { matches: boolean }) => void>
  let currentMatches: boolean

  beforeEach(() => {
    listeners = []
    currentMatches = false

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: currentMatches,
        addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
          listeners.push(cb)
        },
        removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
          listeners = listeners.filter(l => l !== cb)
        },
      })),
    })
  })

  it('returns false for light mode', () => {
    currentMatches = false
    const { result } = renderHook(() => useDark())
    expect(result.current).toBe(false)
  })

  it('returns true for dark mode', () => {
    currentMatches = true
    const { result } = renderHook(() => useDark())
    expect(result.current).toBe(true)
  })

  it('updates when system preference changes', () => {
    currentMatches = false
    const { result } = renderHook(() => useDark())
    expect(result.current).toBe(false)

    act(() => {
      for (const cb of listeners) cb({ matches: true })
    })
    expect(result.current).toBe(true)
  })
})

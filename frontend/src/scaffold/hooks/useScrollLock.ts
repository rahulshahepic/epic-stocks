import { useEffect } from 'react'

/**
 * Freeze the page behind an open dialog.
 *
 * `overflow: hidden` on the body is the usual trick and does not work on iOS
 * Safari — which is most of this app's traffic — so the body is pinned with
 * `position: fixed` at its current offset and put back afterwards. That is also
 * what makes the scroll position survive: a fixed body forgets where it was.
 *
 * Counted, so nested dialogs unlock once rather than on the first close.
 */
let lockCount = 0
let restore: (() => void) | null = null

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return

    if (lockCount === 0) {
      const y = window.scrollY
      const body = document.body
      const previous = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
      }
      body.style.position = 'fixed'
      body.style.top = `-${y}px`
      body.style.left = '0'
      body.style.right = '0'
      body.style.width = '100%'
      body.style.overflow = 'hidden'

      restore = () => {
        Object.assign(body.style, previous)
        // Only worth restoring if the page was actually scrolled — which also
        // keeps jsdom from logging an unimplemented scrollTo on every test.
        if (y > 0) window.scrollTo(0, y)
      }
    }
    lockCount += 1

    return () => {
      lockCount -= 1
      if (lockCount === 0 && restore) {
        restore()
        restore = null
      }
    }
  }, [active])
}

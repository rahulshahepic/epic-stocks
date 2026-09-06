import { describe, expect, it } from 'vitest'
import { safeNext } from '../scaffold/postLogin.ts'

/**
 * `next` decides where the browser goes after a sign-in, and it arrives on the
 * URL. Anything that is not a same-origin path is an open redirect: the OAuth
 * consent flow is exactly the moment a user is most willing to believe a page
 * that looks like this app.
 */
describe('safeNext', () => {
  it('keeps a same-origin path', () => {
    expect(safeNext('/oauth/authorize/resume?request=abc')).toBe('/oauth/authorize/resume?request=abc')
    expect(safeNext('/settings')).toBe('/settings')
  })

  it('rejects an absolute URL', () => {
    expect(safeNext('https://evil.example.com/steal')).toBeNull()
    expect(safeNext('http://evil.example.com')).toBeNull()
  })

  it('rejects a protocol-relative URL, which a browser follows off-origin', () => {
    expect(safeNext('//evil.example.com/steal')).toBeNull()
  })

  it('rejects a backslash, which some browsers normalise to a slash', () => {
    expect(safeNext('/\\evil.example.com')).toBeNull()
    expect(safeNext('\\\\evil.example.com')).toBeNull()
  })

  it('rejects anything missing or empty', () => {
    expect(safeNext(null)).toBeNull()
    expect(safeNext(undefined)).toBeNull()
    expect(safeNext('')).toBeNull()
    expect(safeNext('settings')).toBeNull()
  })
})

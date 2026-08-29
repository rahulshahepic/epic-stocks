import { describe, it, expect, afterEach, vi } from 'vitest'

// API_BASE is read once at module load, so each case re-imports the module
// with a different env.
async function loadConfig(base?: string) {
  vi.resetModules()
  if (base === undefined) vi.stubEnv('VITE_API_BASE', '')
  else vi.stubEnv('VITE_API_BASE', base)
  return import('../config.ts')
}

describe('apiUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('leaves paths relative when no base is configured', async () => {
    const { API_BASE, apiUrl } = await loadConfig()
    expect(API_BASE).toBe('')
    expect(apiUrl('/api/grants')).toBe('/api/grants')
  })

  it('prefixes the configured base', async () => {
    const { apiUrl } = await loadConfig('https://equity.example.com')
    expect(apiUrl('/api/grants')).toBe('https://equity.example.com/api/grants')
  })

  it('strips trailing slashes from the base', async () => {
    const { API_BASE, apiUrl } = await loadConfig('https://equity.example.com//')
    expect(API_BASE).toBe('https://equity.example.com')
    expect(apiUrl('/api/grants')).toBe('https://equity.example.com/api/grants')
  })

  it('trims surrounding whitespace', async () => {
    const { API_BASE } = await loadConfig('  https://equity.example.com  ')
    expect(API_BASE).toBe('https://equity.example.com')
  })

  it('passes absolute URLs through untouched', async () => {
    const { apiUrl } = await loadConfig('https://equity.example.com')
    expect(apiUrl('https://other.example.com/x')).toBe('https://other.example.com/x')
    expect(apiUrl('capacitor://localhost/x')).toBe('capacitor://localhost/x')
  })
})

import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { usePush } from '../scaffold/hooks/usePush.ts'
import { api } from '../api.ts'
import { platform } from '../platform/index.ts'
vi.mock('../api.ts', () => ({ api: { pushStatus: vi.fn(), pushSubscribe: vi.fn() } }))
vi.mock('../platform/index.ts', () => ({ platform: { push: {
  supported: true,
  permission: () => 'granted',
  currentRegistration: vi.fn(),
  register: vi.fn(),
  isInstalled: () => true
} } }))
it('does not inspect or self-heal the real device subscription when disabled', async () => {
  const { result } = renderHook(() => usePush('fictional-vapid-key', false))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(api.pushStatus).not.toHaveBeenCalled()
  expect(platform.push.currentRegistration).not.toHaveBeenCalled()
  expect(platform.push.register).not.toHaveBeenCalled()
  expect(api.pushSubscribe).not.toHaveBeenCalled()
})

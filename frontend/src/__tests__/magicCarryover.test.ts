import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../api.ts'
import { platform } from '../platform/index.ts'
import { discardTrialPreview, hasTrialPayload, saveTrialDraft, stashTrialPayload } from '../app/trialImport.ts'
import { suggestedRetirementDate } from '../app/retirementDate.ts'

beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear() })
it('chooses a future starter date without overwriting a saved date', () => {
  expect(suggestedRetirementDate('2026-11-25')).toBe('2031-11-25')
  expect(suggestedRetirementDate('2026-11-25', '1985-02-01')).toBe('2040-02-01')
  expect(suggestedRetirementDate('2026-11-25', '1960-02-01')).toBe('2031-11-25')
})
it('detects a swallowed device-storage failure before leaving the preview', async () => {
  vi.spyOn(platform.storage, 'set').mockResolvedValue(undefined)
  await expect(stashTrialPayload({grants: []})).rejects.toThrow('Could not keep your preview')
})
it('expires local previews with an explicit recovery marker', async () => {
  await stashTrialPayload({grants: []})
  sessionStorage.setItem('trial_saved_at', String(Date.now() - 31 * 60000))
  expect(await hasTrialPayload()).toBe(false)
  expect(sessionStorage.getItem('trial_preview_expired')).toBe('1')
})
it('starting over clears a pending draft so another sign-in cannot import it', async () => {
  await stashTrialPayload({grants: [{year: 2020}]})
  await platform.storage.set('trial_preview', '{}')
  await discardTrialPreview()
  expect(await hasTrialPayload()).toBe(false)
  expect(await platform.storage.get('trial_preview')).toBeNull()
})
it('does not claim records were saved when only corrections were skipped', async () => {
  vi.spyOn(api, 'draftChanges').mockResolvedValue({blocked: false, findings: [], changes: [{kind: 'price', action: 'update', id: 1, version: 1, values: {price: 20}}]})
  const apply = vi.spyOn(api, 'applyChanges')
  await saveTrialDraft({grants: []})
  expect(apply).not.toHaveBeenCalled()
  expect(await platform.storage.get('trial_carryover_result')).toBe('review')
})

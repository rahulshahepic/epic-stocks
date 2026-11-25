import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TrialFunnel } from '../scaffold/pages/admin/TrialFunnel.tsx'
import { api, type OnboardingFunnel, type TrialFunnelReport } from '../api.ts'

const activation: OnboardingFunnel = {
  schema_version: 1, window_days: 30, collection_paused: false, attempt_ttl_hours: 24,
  aggregate_retention_days: 180, cleanup_last_at: null, last_measurement_failure_at: null,
  active_attempts: 2, expired_attempts: 0, attempt_capacity: 10000,
  totals: {starts: 10, usable_position: 6, source_checked_5min: 3, carryover: 4},
  rates_per_attempt: {usable_position: .6, source_checked_5min: .3, carryover: .4}, cohorts: [], actions: [], definitions: {},
}
const legacy: TrialFunnelReport = {days: [], previews: 90, save_clicked: 20, signups_from_trial: 100, conversion_rate: 100 / 90, activation}
beforeEach(() => vi.restoreAllMocks())
it('uses attempt cohorts and distinguishes usable previews from source-checked evidence', () => {
  render(<TrialFunnel funnel={legacy} />)
  expect(screen.getByText('Usable previews shown')).toBeVisible()
  expect(screen.getByText('6 · 60.0% of attempts')).toBeVisible()
  expect(screen.getByText('3 · 30.0% of attempts')).toBeVisible()
  expect(screen.getByText(/It does not independently verify/)).toBeVisible()
  expect(screen.queryByText('111.1%')).toBeNull()
})
it('requires confirmation before changing collection and refreshes after applying', async () => {
  const action = vi.spyOn(api, 'adminOnboardingAction').mockResolvedValue({})
  vi.spyOn(api, 'adminOnboardingFunnel').mockResolvedValue({...activation, collection_paused: true, active_attempts: 0})
  render(<TrialFunnel funnel={legacy} />)
  fireEvent.click(screen.getByRole('button', {name: 'Pause collection'}))
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', {name: 'Confirm pause'}))
  await waitFor(() => expect(action).toHaveBeenCalledWith('pause'))
  expect(await screen.findByRole('button', {name: 'Resume collection'})).toBeVisible()
  expect(screen.getByText('4 · 40.0% of attempts')).toBeVisible()
})
it('keeps the report visible when an admin action fails', async () => {
  vi.spyOn(api, 'adminOnboardingAction').mockRejectedValue(new Error('offline'))
  render(<TrialFunnel funnel={legacy} />)
  fireEvent.click(screen.getByRole('button', {name: 'Clean expired measurement state'}))
  fireEvent.click(screen.getByRole('button', {name: 'Confirm cleanup'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('failed')
  expect(screen.getByText('6 · 60.0% of attempts')).toBeVisible()
})

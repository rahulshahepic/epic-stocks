import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api, type BackupStatus } from '../api.ts'
import { Backups } from '../scaffold/pages/admin/Backups.tsx'

const STATUS: BackupStatus = {
  environment: 'staging', controls_available: true, settings_source: 'admin', revision: 'a'.repeat(64),
  settings: { enabled: true, account_id: 'a'.repeat(32), bucket: 'test-staging-backups', recipient: `age1${'q'.repeat(58)}`, retention_days: 30 },
  state: 'succeeded', collected_at_utc: '2026-11-14T12:00:00Z', restore_test: null,
  backup: { credentials_configured: true, last_attempt_utc: '2026-11-14T03:17:00Z',
    last_success_utc: '2026-11-14T03:17:00Z', last_success_run: '20261114T031700Z', last_result: 'success',
    database_plaintext_bytes: 1000, database_encrypted_bytes: 1200, secrets_encrypted_bytes: 300,
    duration_seconds: 2.5, last_success_duration_seconds: 2.5, pruned_runs: 0, error: null, prune_error: null },
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'adminBackupStatus').mockResolvedValue(structuredClone(STATUS))
})

describe('Admin backups', () => {
  it('distinguishes upload success, retention failure and unverified restore', async () => {
    vi.mocked(api.adminBackupStatus).mockResolvedValue({ ...STATUS, backup: { ...STATUS.backup!, prune_error: 'Backup storage returned HTTP 500.' } })
    render(<Backups />)
    expect(await screen.findByText('Last backup uploaded successfully')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Retention cleanup failed')
    expect(screen.getByText('1.2 KB')).toBeInTheDocument()
    expect(screen.getByText('2.5 seconds')).toBeInTheDocument()
    expect(screen.getByText('Configured on the host')).toBeInTheDocument()
    expect(screen.getByText(/No successful test restore recorded/)).toBeInTheDocument()
  })

  it('does not leave an old green result visible when refresh fails', async () => {
    render(<Backups />)
    await screen.findByText('Last backup uploaded successfully')
    vi.mocked(api.adminBackupStatus).mockRejectedValue(new Error('offline'))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh backup status' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be refreshed')
    expect(screen.queryByText('Last backup uploaded successfully')).not.toBeInTheDocument()
  })

  it('saves only public settings and keeps the edit revision across refreshes', async () => {
    const save = vi.spyOn(api, 'adminSaveBackupSettings').mockRejectedValue(new Error('Backup settings changed. Refresh before saving again.'))
    render(<Backups />)
    await userEvent.click(await screen.findByRole('button', { name: 'Configure backups' }))
    await userEvent.clear(screen.getByLabelText('Retention in days'))
    await userEvent.type(screen.getByLabelText('Retention in days'), '45')
    vi.mocked(api.adminBackupStatus).mockResolvedValue({ ...STATUS, revision: 'b'.repeat(64) })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh backup status' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save backup settings' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...STATUS.settings, retention_days: 45 }, 'a'.repeat(64)))
    expect(await screen.findByRole('alert')).toHaveTextContent('settings changed')
    expect(screen.getByLabelText('Retention in days')).toHaveValue(45)
    expect(screen.queryByLabelText(/secret|private/i)).not.toBeInTheDocument()
    expect(screen.getByText(/R2 credentials stay in/)).toBeInTheDocument()
  })

  it('reports a requested run without claiming it completed', async () => {
    const request = vi.spyOn(api, 'adminRunBackup').mockResolvedValue({ queued: true })
    render(<Backups />)
    await screen.findByText('Last backup uploaded successfully')
    vi.mocked(api.adminBackupStatus).mockResolvedValue({ ...STATUS, state: 'running' })
    await userEvent.click(screen.getByRole('button', { name: 'Back up now' }))
    expect(request).toHaveBeenCalledOnce()
    expect(await screen.findByText('Backup in progress')).toBeInTheDocument()
    expect(screen.getByText(/a request is not a completed backup/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled()
  })

  it('requires an explicit restore confirmation for the displayed run', async () => {
    const record = vi.spyOn(api, 'adminRecordRestoreTest').mockResolvedValue({ ...STATUS,
      restore_test: { tested_at_utc: '2026-11-14T12:00:00Z', run_id: '20261114T031700Z', source: 'admin_recorded' } })
    render(<Backups />)
    await userEvent.click(await screen.findByText('Record a successful test restore'))
    const button = screen.getByRole('button', { name: 'Record test restore' })
    expect(button).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /I successfully decrypted and restored backup/ }))
    await userEvent.click(button)
    expect(record).toHaveBeenCalledWith('20261114T031700Z')
    expect(await screen.findByText(/Successful test restore recorded by an admin/)).toBeInTheDocument()
  })

  it('keeps the rest of Admin usable when host controls are not installed', async () => {
    vi.mocked(api.adminBackupStatus).mockResolvedValue({ ...STATUS, state: 'unavailable', controls_available: false, backup: null })
    render(<Backups />)
    expect(await screen.findByText('No recent backup status from the host')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure backups' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled()
  })
})

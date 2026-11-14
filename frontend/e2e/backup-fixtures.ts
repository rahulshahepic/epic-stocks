import type { BackupStatus } from '../src/api.ts'

export const backupStatus: BackupStatus = {
  environment: 'staging', controls_available: true, settings_source: 'admin', revision: 'a'.repeat(64),
  settings: { enabled: true, account_id: 'a'.repeat(32), bucket: 'example-staging-backups', recipient: `age1${'q'.repeat(58)}`, retention_days: 30 },
  state: 'succeeded', collected_at_utc: '2026-11-14T12:00:00Z', restore_test: null,
  backup: { credentials_configured: true, last_attempt_utc: '2026-11-14T03:17:00Z',
    last_success_utc: '2026-11-14T03:17:00Z', last_success_run: '20261114T031700Z', last_result: 'success',
    database_plaintext_bytes: 10_000_000, database_encrypted_bytes: 2_400_000, secrets_encrypted_bytes: 1024,
    duration_seconds: 4.2, last_success_duration_seconds: 4.2, pruned_runs: 1, error: null,
    prune_error: 'Backup storage returned HTTP 500.' },
}

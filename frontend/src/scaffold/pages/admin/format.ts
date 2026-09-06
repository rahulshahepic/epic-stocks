/** Byte counts as the admin pages show them: B, KB, MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A timestamp as a UTC date — server time, not the admin's local time. */
export function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'UTC' }) + ' UTC'
}

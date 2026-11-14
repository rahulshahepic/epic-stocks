export function formatLocalTime(value: string, timeZone?: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZoneName: 'short', timeZone,
  })
}

export function formatDueLocal(dueUtc: string, utcDay: string, timeZone?: string) {
  return formatLocalTime(`${utcDay}T${dueUtc}:00Z`, timeZone)
}

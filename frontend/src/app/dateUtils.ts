import { useEffect, useState } from 'react'

/** A calendar date in the browser's local timezone, never a UTC conversion. */
export function localDateISO(value: Date = new Date()): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localToday(): string {
  return localDateISO()
}

/** Keep long-running tabs correct when the local calendar day changes. */
export function useToday(): string {
  const [today, setToday] = useState(localToday)
  useEffect(() => {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const timer = window.setTimeout(() => setToday(localToday()), next.getTime() - now.getTime() + 50)
    return () => window.clearTimeout(timer)
  }, [today])
  return today
}

/** Add calendar years, mapping Feb 29 to Feb 28 when necessary. */
export function addCalendarYears(iso: string, years: number): string {
  const year = Number(iso.slice(0, 4)) + years
  const month = Number(iso.slice(5, 7))
  const requestedDay = Number(iso.slice(8, 10))
  const lastDay = new Date(year, month, 0).getDate()
  const day = Math.min(requestedDay, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function addCalendarDays(iso: string, days: number): string {
  const value = new Date(
    Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)),
  )
  value.setDate(value.getDate() + days)
  return localDateISO(value)
}

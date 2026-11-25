import { addCalendarYears } from './dateUtils.ts'

export function suggestedRetirementDate(today: string, dob?: string | null): string {
  const fiveYears = addCalendarYears(today, 5)
  if (!dob) return fiveYears
  const at55 = addCalendarYears(dob, 55)
  return at55 > fiveYears ? at55 : fiveYears
}

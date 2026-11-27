import type { RefObject } from 'react'

export type PlanningSave = () => Promise<boolean>

export async function finishPlanningSave(...pending: RefObject<PlanningSave | null>[]) {
  while (true) {
    const writes = pending.map(ref => ref.current)
    const results = await Promise.all(writes.map(save => save?.() ?? true))
    if (pending.every((ref, index) => ref.current === writes[index])) return results.every(Boolean)
  }
}

import type { Platform } from './types.ts'
import { webPlatform } from './web.ts'

/**
 * The active platform implementation.
 *
 * Only the web implementation exists today. A native shell will select its own
 * here (Capacitor exposes the running platform via `Capacitor.getPlatform()`),
 * and nothing outside this directory has to change.
 */
export const platform: Platform = webPlatform

export type * from './types.ts'

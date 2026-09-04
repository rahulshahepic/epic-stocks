import { describe, it, expect } from 'vitest'
import {
  GRANT_TYPES, GRANT_TYPE_NAMES, GRANT_COLORS, GRANT_DESCRIPTIONS,
  PRE_TAX_TYPES, ZERO_BASIS_TYPES, BONUS_ROW_TYPES, isBonusRowType,
} from '../app/grantTypes.ts'

// This list is mirrored in backend/app/grant_types.py, which pins the same
// order in tests/test_content.py. Changing one without the other drifts the
// wizard away from the seeded content.
describe('grant types', () => {
  it('lists the types the backend does, in the same order', () => {
    expect(GRANT_TYPE_NAMES).toEqual([
      'Purchase', 'Catch-Up', 'Bonus', 'Free', 'Developer Bonus Shares',
    ])
  })

  it('gives every type a colour and a description', () => {
    for (const name of GRANT_TYPE_NAMES) {
      expect(GRANT_COLORS[name]).toBeTruthy()
      expect(GRANT_DESCRIPTIONS[name]).toBeTruthy()
    }
  })

  it('numbers display_order without gaps or duplicates', () => {
    expect(GRANT_TYPES.map(t => t.display_order)).toEqual([0, 1, 2, 3, 4])
  })

  it('treats Developer Bonus Shares as zero-basis income at vest', () => {
    expect(ZERO_BASIS_TYPES.has('Developer Bonus Shares')).toBe(true)
    expect(PRE_TAX_TYPES.has('Developer Bonus Shares')).toBe(true)
    // Purchase grants are the only ones with a price the user pays.
    expect(ZERO_BASIS_TYPES.has('Purchase')).toBe(false)
    // A Bonus grant's basis depends on how it was structured, so it is asked for.
    expect(ZERO_BASIS_TYPES.has('Bonus')).toBe(false)
  })

  it('collects the granted-outright types on the wizard bonus step', () => {
    expect(BONUS_ROW_TYPES).toEqual(['Bonus', 'Free', 'Developer Bonus Shares'])
    expect(isBonusRowType('Developer Bonus Shares')).toBe(true)
    expect(isBonusRowType('Purchase')).toBe(false)
    expect(isBonusRowType('Catch-Up')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  fmt$, fmt$M, fmtDate, fmtFullDate, fmtMonthYear, fmtNum, fmtPct, fmtPrice,
} from '../app/format.ts'

describe('fmt$', () => {
  it('rounds to whole dollars', () => {
    expect(fmt$(1234.56)).toBe('$1,235')
    expect(fmt$(0)).toBe('$0')
  })
  it('keeps the sign', () => {
    expect(fmt$(-1234.56)).toBe('-$1,235')
  })
  it('renders a dash rather than $NaN', () => {
    expect(fmt$(NaN)).toBe('—')
    expect(fmt$(Infinity)).toBe('—')
  })
})

describe('fmtPrice', () => {
  it('always shows cents', () => {
    expect(fmtPrice(1234.5)).toBe('$1,234.50')
    expect(fmtPrice(12)).toBe('$12.00')
  })
  it('renders a dash rather than $NaN', () => {
    expect(fmtPrice(NaN)).toBe('—')
  })
})

describe('fmt$M', () => {
  it('scales to the magnitude', () => {
    expect(fmt$M(0)).toBe('$0')
    expect(fmt$M(123.4)).toBe('$123M')
    expect(fmt$M(12.34)).toBe('$12.3M')
    expect(fmt$M(1.234)).toBe('$1.23M')
    expect(fmt$M(1.234, 1)).toBe('$1.2M')
    expect(fmt$M(0.45)).toBe('$450K')
    expect(fmt$M(0.0005)).toBe('$500')
  })
})

describe('fmtNum', () => {
  it('groups thousands', () => {
    expect(fmtNum(558500)).toBe('558,500')
  })
  it('renders a dash for a figure that is not there', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(undefined)).toBe('—')
  })
})

describe('fmtPct', () => {
  it('turns a decimal rate into a percentage', () => {
    expect(fmtPct(0.0307)).toBe('3.07%')
    expect(fmtPct(0.0307, 1)).toBe('3.1%')
    expect(fmtPct(0.0307, 0)).toBe('3%')
  })
})

describe('date formatting', () => {
  it('renders each shape', () => {
    expect(fmtDate('2021-03-01')).toBe('03/21')
    expect(fmtFullDate('2021-03-01')).toBe('Mar 1, 2021')
    expect(fmtMonthYear('2021-03-01')).toBe('Mar 2021')
  })
  it('passes an empty date through', () => {
    expect(fmtFullDate('')).toBe('')
    expect(fmtMonthYear('')).toBe('')
  })
})

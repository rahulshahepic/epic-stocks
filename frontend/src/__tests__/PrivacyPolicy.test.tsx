import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '../app/AppProvider.tsx'
import PrivacyPolicy from '../scaffold/pages/PrivacyPolicy.tsx'

/**
 * The privacy policy is a promise, and the only thing keeping it true is that
 * someone notices when the code stops matching it. These tests are that
 * someone: the app counts three anonymous daily totals for the /try funnel, so
 * the policy has to say so, and has to keep disclaiming everything it still
 * does not do.
 */
function renderPolicy() {
  return render(
    <AppProvider>
      <MemoryRouter><PrivacyPolicy /></MemoryRouter>
    </AppProvider>
  )
}

describe('Privacy policy', () => {
  it('discloses the anonymous daily counts the preview keeps', () => {
    renderPolicy()
    expect(screen.getByText(/three running totals per\s+calendar day/i)).toBeInTheDocument()
    expect(screen.getByText(/how many previews were computed/i)).toBeInTheDocument()
  })

  it('is explicit that the counts carry nothing identifying', () => {
    renderPolicy()
    expect(screen.getByText(/No IP address, no browser or device details, no\s+identifier of any kind/i))
      .toBeInTheDocument()
  })

  it('still rules out per-person tracking and third-party analytics', () => {
    renderPolicy()
    expect(screen.getByText(/Per-person analytics or usage tracking/i)).toBeInTheDocument()
    expect(screen.getByText(/no third-party analytics service/i)).toBeInTheDocument()
  })

  it('says uploaded preview files are discarded rather than stored', () => {
    renderPolicy()
    expect(screen.getByText(/read, computed from, and discarded/i)).toBeInTheDocument()
  })
})

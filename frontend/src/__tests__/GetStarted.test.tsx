import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GetStarted from '../app/components/GetStarted.tsx'

vi.mock('../scaffold/hooks/useConfig.ts', () => ({
  useConfig: () => ({ ai_connections: true, epic_mode: false }),
}))
vi.mock('../app/components/ChatImportIntro.tsx', () => ({
  default: () => <div data-testid="assistant">Use an assistant</div>,
}))

describe('First import', () => {
  it('leads with Eureka files and retains assistant and manual routes', () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>)
    const direct = screen.getByText('Import from Eureka')
    const assistant = screen.getByTestId('assistant')
    expect(direct.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add a grant' })).toHaveAttribute('href', '/grants')
    expect(screen.getByRole('link', { name: 'Restore from a workbook' })).toHaveAttribute('href', '/import')
  })
})

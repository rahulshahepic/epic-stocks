import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { api } from '../api.ts'
import { resetMeCache, useMe } from '../scaffold/hooks/useMe.ts'

function Consumer({name}: {name: string}) {
  const me = useMe()
  return <p data-testid={name}>{me?.name ?? 'Loading profile'}</p>
}

beforeEach(() => { resetMeCache(); vi.restoreAllMocks(); localStorage.clear() })

describe('profile cache consumers', () => {
  it('hydrates every consumer when the first request finishes between render and effects', async () => {
    const profile = {id: 1, email: 'fictional@example.test', name: 'Fictional Employee', is_admin: false, is_content_admin: false, date_of_birth: '1980-01-01'}
    // Finish the first lookup immediately during its effect. Both consumers
    // rendered with an empty cache, but the second effect now sees it filled.
    const get = vi.spyOn(api, 'getMe').mockReturnValue({
      then: (complete: (data: typeof profile) => unknown) => Promise.resolve(complete(profile)),
    } as unknown as ReturnType<typeof api.getMe>)
    render(<><Consumer name="header" /><Consumer name="planner" /></>)
    await waitFor(() => {
      expect(screen.getByTestId('header')).toHaveTextContent('Fictional Employee')
      expect(screen.getByTestId('planner')).toHaveTextContent('Fictional Employee')
    })
    expect(get).toHaveBeenCalledTimes(1)
  })
})

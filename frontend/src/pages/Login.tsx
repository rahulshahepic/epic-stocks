import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.ts'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            el: HTMLElement,
            config: { theme: string; size: string; width: number }
          ) => void
        }
      }
    }
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

export default function Login() {
  const { isAuthenticated, login, loading, error } = useAuth()
  const navigate = useNavigate()
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !btnRef.current) return

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          await login(response.credential)
        },
      })
      if (btnRef.current) {
        window.google?.accounts.id.renderButton(btnRef.current, {
          theme: 'outline',
          size: 'large',
          width: 300,
        })
      }
    }
    document.head.appendChild(script)
    return () => { script.remove() }
  }, [login])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-2xl font-bold text-transparent">
          Equity Vesting Tracker
        </h1>
        <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
          Sign in to manage your equity compensation
        </p>

        {error && (
          <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-gray-400">Signing in...</p>
        ) : (
          <div ref={btnRef} className="flex justify-center" />
        )}

        {!GOOGLE_CLIENT_ID && (
          <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
            Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID.
          </p>
        )}
      </div>
    </div>
  )
}

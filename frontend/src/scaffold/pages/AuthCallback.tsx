import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api.ts'
import { clearPendingLogin, completeLogin, readPendingLogin } from '../oidc.ts'
import { platform } from '../../platform/index.ts'

export default function AuthCallback() {
 const navigate = useNavigate()
 const [error, setError] = useState<string | null>(null)
 // The authorization code is single-use. Reading the stored PKCE material is
 // async, so without this guard StrictMode's double-invoked effect can get two
 // exchanges in flight before either clears the material, and the second fails.
 const startedRef = useRef(false)

 useEffect(() => {
 if (startedRef.current) return
 startedRef.current = true

 const params = new URLSearchParams(window.location.search)
 const code = params.get('code')
 const state = params.get('state')
 const idpError = params.get('error')
 const idpErrorDesc = params.get('error_description')

 if (idpError) {
 setError(idpErrorDesc || idpError)
 return
 }

 if (!code) {
 setError('No authorization code received.')
 return
 }

 void (async () => {
 const pending = await readPendingLogin()

 if (!state || state !== pending.state) {
 setError('Invalid state — possible CSRF attempt. Please try signing in again.')
 return
 }

 if (!pending.verifier || !pending.provider) {
 setError('Session data missing. Please try signing in again.')
 return
 }

 await clearPendingLogin()

 try {
 await completeLogin(pending.provider, code, pending.verifier)
 } catch (e) {
 setError(e instanceof Error ? e.message : 'Authentication failed. Please try again.')
 return
 }

 // Check if there's a pending invitation to accept
 const inviteToken = await platform.storage.get('invite_token')
 const inviteCode = await platform.storage.get('invite_code')
 if (inviteToken || inviteCode) {
 await platform.storage.remove('invite_token')
 await platform.storage.remove('invite_code')
 try {
 await api.acceptInvite({
 token: inviteToken ?? undefined,
 code: inviteCode ?? undefined,
 })
 } catch {
 // Acceptance failed (expired, already used, etc.) — continue to home
 }
 }
 navigate('/', { replace: true })
 })()
 }, [navigate])

 if (error) {
 return (
 <div className="flex min-h-screen flex-col items-center justify-center bg-cs-base px-4">
 <div className="w-full max-w-sm text-center">
 <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
 {error}
 </p>
 <a
 href="/login"
 className="text-sm text-cs-brand underline hover:text-rose-800 "
 >
 Back to sign-in
 </a>
 </div>
 </div>
 )
 }

 return (
 <div className="flex min-h-screen flex-col items-center justify-center bg-cs-base px-4">
 <div className="w-full max-w-sm text-center">
 <div className="mb-4 h-3 w-3 mx-auto animate-pulse rounded-full bg-rose-500" />
 <p className="text-sm text-cs-text-2">Completing sign-in…</p>
 </div>
 </div>
 )
}

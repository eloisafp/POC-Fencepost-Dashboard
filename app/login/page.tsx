'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { Suspense } from 'react'

function LoginContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const error = searchParams.get('error')
  const [showEmergency, setShowEmergency] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [emergencyError, setEmergencyError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  const handleEmergencyLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setEmergencyError('')
    const { error } = await supabase.auth.signInWithPassword({
      email: `${username.toLowerCase()}@fencepost.co`,
      password,
    })
    if (error) {
      setEmergencyError('Invalid credentials.')
    } else {
      router.push('/')
    }
    setLoading(false)
  }

  const errorMessage =
    error === 'unauthorized'
      ? 'Access restricted to @fencepost.co accounts only.'
      : error === 'auth_failed'
      ? 'Sign-in failed. Please try again.'
      : null

  return (
    <div style={{
      minHeight: '100vh',
      background: '#18181b',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        background: '#27272a',
        border: '1px solid #3f3f46',
        borderRadius: 12,
        padding: '40px 44px',
        width: 360,
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>
            Fencepost
          </div>
          <div style={{ fontSize: 11, color: '#71717a', marginTop: 3 }}>Internal tools</div>
        </div>

        <div style={{ fontSize: 20, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
          Sign in
        </div>
        <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 28 }}>
          Use your <span style={{ color: '#0d9488' }}>@fencepost.co</span> Google account
        </div>

        {errorMessage && (
          <div style={{
            background: '#450a0a',
            border: '1px solid #7f1d1d',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 12,
            color: '#fca5a5',
            textAlign: 'left',
          }}>
            {errorMessage}
          </div>
        )}

        {!showEmergency ? (
          <>
            <button
              onClick={handleGoogleSignIn}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: '11px 16px',
                background: '#fff',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
                color: '#1a1a1a',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.92')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
              </svg>
              Continue with Google
            </button>

            <div style={{ marginTop: 24, fontSize: 11, color: '#52525b' }}>
              Restricted to Fencepost staff only
            </div>
          </>
        ) : (
          <form onSubmit={handleEmergencyLogin}>
            <div style={{ marginBottom: 12, textAlign: 'left' }}>
              <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 5 }}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Username"
                required
                autoFocus
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 16, textAlign: 'left' }}>
              <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 5 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                required
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            {emergencyError && (
              <div style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>{emergencyError}</div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px 16px',
                background: '#0d9488',
                border: 'none',
                borderRadius: 7,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500,
                color: '#fff',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setShowEmergency(false); setEmergencyError('') }}
              style={{
                marginTop: 12,
                background: 'none',
                border: 'none',
                color: '#52525b',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Back to Google sign in
            </button>
          </form>
        )}
      </div>

      {/* Emergency access button — bottom right */}
      <button
        onClick={() => { setShowEmergency(e => !e); setEmergencyError('') }}
        title="Emergency access"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#27272a',
          border: '1px solid #3f3f46',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.5,
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
      >
        <svg width="14" height="14" fill="none" stroke="#a1a1aa" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      </button>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}

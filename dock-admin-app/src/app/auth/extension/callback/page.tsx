'use client'

import { useEffect } from 'react'

const AUTH_CALLBACK_MESSAGE = 'dock-safari-auth-callback'

export default function ExtensionAuthCallbackPage() {
  useEffect(() => {
    try {
      chrome?.runtime?.sendMessage?.({ type: AUTH_CALLBACK_MESSAGE, url: window.location.href })
    } catch {}

    try {
      browser?.runtime?.sendMessage?.({ type: AUTH_CALLBACK_MESSAGE, url: window.location.href })
    } catch {}
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 560, margin: '0 auto' }}>
      <h1>Return to Dock</h1>
      <p>Dock received the sign-in response. You can close this tab and return to the Dock extension.</p>
    </main>
  )
}

declare const chrome: any
declare const browser: any

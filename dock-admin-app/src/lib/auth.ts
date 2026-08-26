import { supabase } from './supabase'

export async function signIn() {
  const redirectTo = (() => {
    try {
      if (typeof window !== 'undefined' && window.location?.href) {
        const current = new URL(window.location.href)
        const isPreview = current.hostname !== 'dock-production-mvp.vercel.app'

        if (isPreview && current.pathname === '/hq-v4-test') {
          const bridge = new URL('https://dock-production-mvp.vercel.app/auth/preview-return')
          bridge.searchParams.set('returnTo', current.toString())
          return bridge.toString()
        }

        return current.toString()
      }
    } catch {}
    return 'https://dock-production-mvp.vercel.app/admin'
  })()

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  })

  if (error) {
    alert(`Login failed: ${error.message}`)
  }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getUser() {
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

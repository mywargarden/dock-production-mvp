import { supabase } from './supabase'

export async function signIn() {
  const redirectOrigin = (() => {
    try {
      if (typeof window !== 'undefined' && window.location?.href) {
        return window.location.href
      }
    } catch {}
    return '/admin'
  })()

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectOrigin
    }
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

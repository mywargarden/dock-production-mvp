import { supabase } from './supabase'

export async function signIn() {
  const email = window.prompt('Enter your email')
  if (!email) return

  const redirectOrigin = (() => {
    try {
      if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin
      }
    } catch {}
    return 'https://dock-production-mvp.vercel.app'
  })()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectOrigin
    }
  })

  if (error) {
    alert(`Login failed: ${error.message}`)
    return
  }

  alert('Check your email for your login link.')
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

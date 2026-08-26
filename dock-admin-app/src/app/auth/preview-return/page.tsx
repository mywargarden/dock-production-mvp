'use client'

import { useEffect, useState } from 'react'

function safeReturnTarget(raw: string | null) {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const allowedHost = /^dock-production-[a-z0-9-]+-anchor-technologies\.vercel\.app$/i.test(url.hostname)
    const allowedPath = url.pathname === '/hq-v4-test'
    if (!allowedHost || !allowedPath || url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export default function PreviewReturnPage() {
  const [message, setMessage] = useState('Returning to Dock HQ V4...')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const returnTo = safeReturnTarget(params.get('returnTo'))
    if (!returnTo) {
      setMessage('The preview return address was invalid. You can close this tab and reopen the V4 preview.')
      return
    }

    const destination = new URL(returnTo)
    destination.hash = window.location.hash
    window.location.replace(destination.toString())
  }, [])

  return (
    <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0c1a2b',color:'#fff',fontFamily:'Inter,system-ui,sans-serif',padding:24}}>
      <section style={{maxWidth:520,padding:32,border:'1px solid rgba(255,255,255,.16)',borderRadius:20,background:'rgba(255,255,255,.07)'}}>
        <h1 style={{margin:'0 0 10px'}}>Dock HQ</h1>
        <p style={{margin:0,color:'#c9d7e7',lineHeight:1.6}}>{message}</p>
      </section>
    </main>
  )
}

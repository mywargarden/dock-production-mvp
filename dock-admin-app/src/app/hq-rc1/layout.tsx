import Link from 'next/link'
import '../owner-hq.css'

export default function Rc1Layout({children}:{children:React.ReactNode}){
  return <>
    <div style={{position:'sticky',top:0,zIndex:50,background:'#0d2136',borderBottom:'1px solid rgba(255,255,255,.12)',padding:'10px 18px'}}>
      <div style={{maxWidth:1200,margin:'0 auto',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        <strong style={{color:'#fff',marginRight:8}}>Dock 1.0 RC1</strong>
        <Link className="hq2Ghost" href="/hq-rc1">Operations</Link>
        <Link className="hq2Ghost" href="/hq-rc1/settings">Settings</Link>
        <Link className="hq2Ghost" href="/hq-rc1/releases">Releases</Link>
        <Link className="hq2Ghost" href="/hq-v4-test">Legacy HQ V4</Link>
      </div>
    </div>
    {children}
  </>
}

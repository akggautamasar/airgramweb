import React,{useState,useEffect} from 'react';
import {apiFetch} from '../api';
export default function CloneView({chats,selectedChat,onClose}){
 const [source,S]=useState(String(selectedChat?.id||'')),[destination,D]=useState('me'),[mode,M]=useState('all'),[start,A]=useState(''),[end,B]=useState(''),[types,T]=useState(['photo','video','audio','pdf','document','text','other']),[fallback,F]=useState(true),[authorized,U]=useState(false),[jobs,J]=useState([]),[error,E]=useState(''),[busy,Q]=useState(false);
 const refresh=()=>apiFetch('/api/clone/jobs').then(r=>J(r.jobs)).catch(e=>E(e.message));
 useEffect(()=>{refresh();const t=setInterval(refresh,2000);return()=>clearInterval(t)},[]);
 const act=async(url,body)=>{Q(true);E('');try{await apiFetch(url,{method:'POST',body:JSON.stringify(body||{})});await refresh()}catch(e){E(e.message)}finally{Q(false)}};
 const field={display:'grid',gap:6,marginBottom:12};
 const options=chats.map(c=><option key={c.id} value={String(c.id)}>{c.title}</option>);
 return <div className="modal-backdrop" style={{padding:12}}><section style={{background:'var(--bg, #18212b)',color:'var(--text, #eee)',width:'min(620px, 100%)',maxHeight:'90dvh',overflowY:'auto',padding:20,borderRadius:16}}>
 <header style={{display:'flex',justifyContent:'space-between'}}><h2>AirGram Cloner</h2><button className="btn" onClick={onClose}>Close</button></header>
 <label style={field}>Source<select value={source} onChange={e=>S(e.target.value)}><option value="">Select chat</option>{options}</select></label>
 <label style={field}>Destination<select value={destination} onChange={e=>D(e.target.value)}><option value="me">Saved Messages</option>{options}</select></label>
 <label style={field}>Range<select value={mode} onChange={e=>M(e.target.value)}><option value="all">Complete chat</option><option value="range">Message ID range (inclusive)</option><option value="onwards">From message ID onwards</option></select></label>
 {mode!=='all'&&<label style={field}>Start ID<input type="number" min="1" value={start} onChange={e=>A(e.target.value)}/></label>}
 {mode==='range'&&<label style={field}>End ID<input type="number" min="1" value={end} onChange={e=>B(e.target.value)}/></label>}
 <div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:16}}>{['photo','video','audio','pdf','document','text','other'].map(t=><label key={t}><input type="checkbox" checked={types.includes(t)} onChange={e=>T(old=>e.target.checked?[...old,t]:old.filter(x=>x!==t))}/>{t}</label>)}</div>
 <label style={field}><span><input type="checkbox" checked={fallback} onChange={e=>F(e.target.checked)}/> Re-upload unrestricted media on explicit media errors</span></label>
 <label style={field}><span><input type="checkbox" checked={authorized} onChange={e=>U(e.target.checked)}/> I have permission to copy this content.</span></label>
 <p>Protected content is not copied. Jobs run on the server, oldest first. Pause takes effect after the current transfer.</p>
 <button className="btn" disabled={busy||!source||!authorized||!types.length||(mode!=='all'&&!start)||(mode==='range'&&!end)} onClick={()=>act('/api/clone/jobs',{source,destination,start:mode==='all'?null:start,end:mode==='range'?end:null,types,fallback,authorized})}>Start cloning</button>
 {error&&<p role="alert">{error}</p>}
 <h3>Jobs</h3>{jobs.slice().reverse().map(j=><article key={j.id} style={{border:'1px solid #64748b',borderRadius:10,padding:12,marginTop:10}}><strong>{chats.find(c=>String(c.id)===j.source)?.title||j.source} → {j.destination==='me'?'Saved Messages':chats.find(c=>String(c.id)===j.destination)?.title||j.destination}</strong><p>{j.status} · IDs {j.start}–{j.end??'latest'} · checkpoint {j.cursor}</p><p>Forwarded {j.forwarded} · Re-uploaded {j.uploaded} · Skipped {j.skipped}</p>{j.error&&<p>{j.error}</p>}{j.inflight?.length>0&&j.status==='paused'&&<p>Delivery uncertain: inspect destination before restarting.</p>}{j.status==='running'&&<button className="btn" disabled={busy} onClick={()=>act('/api/clone/jobs/'+j.id+'/pause')}>Pause</button>}{j.status==='paused'&&!j.inflight?.length&&<button className="btn" disabled={busy} onClick={()=>act('/api/clone/jobs/'+j.id+'/resume')}>Resume</button>}</article>)}
 </section></div>;
}

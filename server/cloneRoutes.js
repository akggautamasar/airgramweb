const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bigInt = require('big-integer');
const { CustomFile } = require('telegram/client/uploads');
const root = path.resolve(process.env.CLONE_DATA_DIR || 'clone-data');
const jobs = new Map(), running = new Set();
const peer = id => id === 'me' ? id : bigInt(id);
const errorText = e => String(e.errorMessage || e.message || e);
function save(j) {
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const p=path.join(root,j.id+'.json');
  fs.writeFileSync(p+'.tmp',JSON.stringify(j),{mode:0o600}); fs.renameSync(p+'.tmp',p);
}
function load() {
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  for(const f of fs.readdirSync(root).filter(f=>f.endsWith('.json'))) {
    try {const j=JSON.parse(fs.readFileSync(path.join(root,f),'utf8')); if(j.status==='running'||j.status==='queued') j.status='paused'; jobs.set(j.id,j);} catch(e){console.error('Clone checkpoint unreadable',f);}
  }
}
function kind(m) {
  if(m.media?.photo) return 'photo';
  const d=m.media?.document, mime=d?.mimeType||'';
  if(d) return mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':mime==='application/pdf'?'pdf':'document';
  return m.media && m.media.className!=='MessageMediaWebPage' ? 'other':'text';
}
function parseId(v) { const n=Number(v); if(!Number.isSafeInteger(n)||n<1||n>2147483646) throw Error('Invalid message ID'); return n; }
async function run(j,session) {
  if(running.size || running.has(j.id)) throw Error('Another clone is running; pause it first');
  running.add(j.id); j.status='running'; j.error=''; save(j);
  const c=session.client;
  try {
    await c.getDialogs({limit:150});
    const src=await c.getEntity(peer(j.source)), target=await c.getEntity(peer(j.destination));
    if(String(src.id)===String(target.id)&&src.className===target.className) throw Error('Source and destination must differ');
    const dst=await c.getInputEntity(target);
    if(src.noforwards) throw Error('Source has protected content');
    if(j.end===null){const latest=await c.getMessages(src,{limit:1});j.end=latest[0]?.id||0;save(j);}
    let batch=[];
    async function flush(){
      if(!batch.length)return;
      const ids=batch.map(m=>m.id);
      // Persist in-flight IDs; never automatically replay an ambiguous send.
      j.inflight=ids;save(j);
      try {
        await c.forwardMessages(dst,{messages:ids,fromPeer:src});
        j.forwarded+=ids.length;
      } catch(e) {
        const err=errorText(e);
        if(!j.fallback || !/FILE_REFERENCE_EXPIRED|MEDIA_EMPTY|MEDIA_INVALID/.test(err)) {if(/FLOOD_WAIT|CHAT_WRITE_FORBIDDEN|CHAT_FORWARDS_RESTRICTED/.test(err)) {j.inflight=[];save(j);} throw e;}
        // Only explicit media errors permit fallback; never bypass protection or retry ambiguous sends.
        for(const m of batch){
          if(m.noforwards || src.noforwards || !m.media?.document && !m.media?.photo) throw e;
          const size=Number(m.media?.document?.size||0);
          if(size>512*1024*1024) throw Error('Fallback file exceeds 512 MiB limit');
          const dir=fs.mkdtempSync(path.join(root,'transfer-'));
          try {
            const name=path.basename(m.media?.document?.attributes?.find(a=>a.fileName)?.fileName||('photo-'+m.id+'.jpg'));
            const file=path.join(dir,name);
            if(fs.statfsSync){const s=fs.statfsSync(root);if(s.bavail*s.bsize<Math.max(size,512*1024*1024)+1024*1024*1024)throw Error('Insufficient disk space');}
            await c.downloadMedia(m,{outputFile:file});
            const custom=new CustomFile(name,fs.statSync(file).size,file);
            await c.sendFile(dst,{file:custom,caption:m.message||'',formattingEntities:m.entities||[],forceDocument:!!m.media.document,workers:2});
            j.uploaded++;j.cursor=m.id;j.inflight=j.inflight.filter(id=>id!==m.id);save(j);
          } finally {fs.rmSync(dir,{recursive:true,force:true});}
        }
      }
      j.cursor=ids[ids.length-1];j.inflight=[];batch=[];save(j);
    }
    for await(const m of c.iterMessages(src,{reverse:true,minId:Math.max(j.start-1,j.cursor),maxId:j.end+1})){
      if(j.status!=='running')break;
      if(m.id<j.start||m.id>j.end)continue;
      if(m.className!=='Message'||m.noforwards||!j.types.includes(kind(m))){
        await flush();j.skipped++;j.cursor=m.id;save(j);continue;
      }
      batch.push(m);
      if(batch.length>=50)await flush();
    }
    if(j.status==='running'){await flush();if(j.status==='running')j.status='completed';}
  } catch(e){j.error=errorText(e);if(j.inflight.length && /FLOOD_WAIT|CHAT_WRITE_FORBIDDEN|CHAT_FORWARDS_RESTRICTED/.test(j.error)) { /* keep checkpoint for manual review */ } if(j.status!=='cancelled')j.status=/protected content|CHAT_FORWARDS_RESTRICTED/i.test(j.error)?'blocked':'paused';}
  finally{running.delete(j.id);save(j);}
}
module.exports=function register(app,auth){
  load();
  const owner=req=>String(req.tgSession.user.id);
  app.get('/api/clone/jobs',auth,(req,res)=>res.json({jobs:[...jobs.values()].filter(j=>j.owner===owner(req))}));
  app.post('/api/clone/jobs',auth,(req,res)=>{
    try{
      if(running.size)throw Error('Another clone is running');
      const b=req.body,source=String(b.source),destination=String(b.destination);
      if(!/^-?\d+$/.test(source)||!(/^-?\d+$/.test(destination)||destination==='me')||source===destination||destination==='me'&&source===owner(req))throw Error('Select different source and destination chats');
      if(b.authorized!==true)throw Error('Confirm permission to copy content');
      const start=b.start?parseId(b.start):1,end=b.end?parseId(b.end):null;
      if(end!==null&&end<start)throw Error('End must be at least start');
      const types=['photo','video','audio','pdf','document','text','other'].filter(t=>Array.isArray(b.types)&&b.types.includes(t));
      if(!types.length)throw Error('Select content types');
      if([...jobs.values()].some(j=>j.owner===owner(req)&&j.source===source&&j.destination===destination&&j.start===start&&(j.requestedEnd??null)===end&&JSON.stringify(j.types)===JSON.stringify(types)&&['running','queued','paused','blocked'].includes(j.status)))throw Error('Matching job already exists; review or delete it first');
      const j={requestedEnd:end,id:crypto.randomUUID(),owner:owner(req),source,destination,start,end,types,fallback:b.fallback===true,cursor:start-1,forwarded:0,uploaded:0,skipped:0,inflight:[],status:'queued',createdAt:Date.now()};
      jobs.set(j.id,j);save(j);run(j,req.tgSession).catch(console.error);res.json({job:j});
    }catch(e){res.status(400).json({error:errorText(e)});}
  });
  app.post('/api/clone/jobs/:id/:action',auth,(req,res)=>{
    const j=jobs.get(req.params.id);
    if(!j||j.owner!==owner(req))return res.status(404).json({error:'Job not found'});
    if(req.params.action==='cancel'&&['running','paused','blocked','queued'].includes(j.status)){j.status='cancelled';save(j);return res.json({job:j});}
    if(req.params.action==='delete'&&!running.has(j.id)){fs.unlinkSync(path.join(root,j.id+'.json'));jobs.delete(j.id);return res.json({ok:true});}
    if(req.params.action==='pause'&&j.status==='running'){j.status='paused';save(j);}
    else if(req.params.action==='resume'&&j.status==='paused'&&!running.size&&!j.inflight.length){run(j,req.tgSession).catch(console.error);}
    else return res.status(409).json({error:j.inflight.length?'Uncertain delivery: review destination before creating a new range':'Action unavailable'});
    res.json({job:j});
  });
};

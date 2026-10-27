const state = {lat:65.0121, lon:25.4651, offset:0};
const el = id => document.getElementById(id);
const fmt = d => d ? new Date(d).toLocaleString('fi-FI') : 'Aika tarkentuu';
async function json(path) {
  const r = await fetch(path, {signal:AbortSignal.timeout(45000)});
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}
async function weather() {
  try {
    const w = await json(`/api/spaceweather?lat=${state.lat}`);
    el('kp').textContent=w.kp_now.toFixed(1); el('g-label').textContent=w.g_label;
    el('aurora').textContent=`Revontuliarvio: ${w.aurora_chance}`;
    el('wind').textContent=`Aurinkotuuli: ${w.solar_wind_speed_kms ?? '–'} km/s · Bz: ${w.bz_nt ?? '–'} nT`;
    el('alerts').replaceChildren(...w.alerts.map(t => {const li=document.createElement('li'); li.textContent=t; return li;}));
    const svg=el('kp-chart'); svg.replaceChildren(); const pts=w.kp_history;
    if(pts.length) {
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',pts.map((v,i)=>`${i?'L':'M'}${5+i*310/Math.max(1,pts.length-1)},${100-v.kp*10}`).join(' '));
      p.setAttribute('stroke','#5ed6ff'); p.setAttribute('fill','none'); svg.append(p);
    }
  } catch(e) {el('g-label').textContent=e.message;}
}
async function sky() {
  try {
    const at=new Date(Date.now()+state.offset*60000).toISOString();
    const c=await json(`/api/sky?lat=${state.lat}&lon=${state.lon}&at=${encodeURIComponent(at)}`);
    drawSky(el('sky-chart'),c); el('time-label').textContent=fmt(c.at);
    el('sky-meta').textContent=`${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}° · ${c.moon_phase_name}`;
    el('object-list').replaceChildren(...c.objects.filter(o=>o.alt>0&&o.kind!=='star').map(o=>{const s=document.createElement('span'); s.textContent=`${o.name} ${o.alt.toFixed(0)}°`; return s;}));
  } catch(e) {el('sky-meta').textContent=e.message;}
}
let board=null, stale=false, warning='';
function render() {
  if(!board) return;
  el('next-launch').textContent=`Data by RocketLaunch.Live · Haettu ${fmt(board.updated)}${stale?' · VANHENTUNUT':''} ${warning}`;
  el('launch-list').replaceChildren(...board.results.map(l=>{
    const li=document.createElement('li'), text=document.createElement('div'), timer=document.createElement('span');
    text.textContent=`${l.name} · ${l.rocket} · ${l.provider} · ${l.location} · ${fmt(l.net)} · ${l.status} `;
    if(l.stream_url) {
      try {
        const url=new URL(l.stream_url);
        if(url.protocol==='https:'&&url.hostname==='www.rocketlaunch.live') {
          const a=document.createElement('a'); a.href=url.href; a.target='_blank'; a.rel='noopener noreferrer';
          a.textContent='Seuraa laukaisua ↗'; a.style.color='#5ed6ff'; text.append(a);
        }
      } catch(e) {console.warn('Virheellinen seurantalinkki');}
    }
    const seconds=l.net?Math.floor((new Date(l.net)-Date.now())/1000):null;
    timer.className='countdown'; timer.textContent=seconds==null?'Aika tarkentuu':seconds<=0?'Ajankohta saavutettu':`T−${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min ${seconds%60} s`;
    li.append(text,timer); return li;
  }));
}
async function launches() {
  let delay=600000;
  try {board=await json('/api/launches'); stale=false; warning=''; render();}
  catch(e) {stale=true; warning=e.message; if(board) render(); else el('next-launch').textContent=e.message; delay=300000;}
  setTimeout(launches,delay);
}
function clock() {el('clock').textContent=new Date().toLocaleString('fi-FI'); render();}
(async()=>{
  document.querySelector('.live').textContent='PÄIVITTYVÄ'; clock(); setInterval(clock,1000);
  el('time-offset').addEventListener('change',e=>{state.offset=Number(e.target.value); sky();});
  try {const c=await json('/api/config'); state.lat=c.default_lat; state.lon=c.default_lon;} catch(e) {console.warn(e);}
  weather(); sky(); launches(); setInterval(weather,300000); setInterval(sky,60000);
  if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>{state.lat=p.coords.latitude; state.lon=p.coords.longitude; weather(); sky();},()=>{}, {timeout:4000});
})();

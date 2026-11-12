// Laukaisukortti: lista päivittyy 10 minuutin välein, lähtölaskenta sekunnin välein (renderLaunches).
import { el, json, fmt } from './core.js';

let board=null, stale=false, warning='';
export function renderLaunches() {
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
export async function launches() {
  let delay=600000;
  try {board=await json('/api/launches'); stale=false; warning=''; renderLaunches();}
  catch(e) {stale=true; warning=e.message; if(board) renderLaunches(); else el('next-launch').textContent=e.message; delay=300000;}
  setTimeout(launches,delay);
}

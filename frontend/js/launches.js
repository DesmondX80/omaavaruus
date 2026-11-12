// Laukaisukortti: lista päivittyy 10 minuutin välein, lähtölaskenta sekunnin välein (renderLaunches).
import { el, json, fmt, saved, button } from './core.js';
import { LAUNCH_KEY, pushActive, syncPush } from './push.js';

let board=null, stale=false, warning='';

// Suosikkitoimijat, suodatus ja ilmoitusvalinta tallentuvat selaimeen.
const prefs = () => ({favorites:[], only:false, notify:false, ...saved.get(LAUNCH_KEY,{})});
function update(change, sync=true) {
  saved.set(LAUNCH_KEY,{...prefs(),...change});
  renderFavorites(); renderLaunches();
  if(sync) syncPush();
}

function checkbox(text, checked, onChange, disabled=false) {
  const label=document.createElement('label'), input=document.createElement('input');
  input.type='checkbox'; input.checked=checked; input.disabled=disabled;
  input.addEventListener('change',()=>onChange(input.checked));
  label.append(input,' ',text); return label;
}

// Piirretään vain tilan muuttuessa: sekunnin välein uusiutuva lista veisi kohdistuksen painikkeilta.
export function renderFavorites() {
  const {favorites, only, notify}=prefs();
  const providers=[...new Set([...(board?.results ?? []).map(l=>l.provider), ...favorites])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'fi'));
  const chips=providers.map(p=>{
    const on=favorites.includes(p);
    const b=button('', `${on?'★':'☆'} ${p}`, ()=>update({favorites: on ? favorites.filter(f=>f!==p) : [...favorites,p]}));
    b.setAttribute('aria-pressed',on); return b;
  });
  const options=document.createElement('div'); options.className='favorite-options';
  if(favorites.length) {
    options.append(
      checkbox('Näytä vain suosikit', only, v=>update({only:v},false)),
      checkbox('Ilmoita suosikkien laukaisuista noin tuntia ennen', notify&&pushActive(), v=>update({notify:v}), !pushActive()));
    if(!pushActive()) {const hint=document.createElement('small'); hint.textContent='Laukaisuilmoitukset vaativat, että ilmoitukset on otettu käyttöön Avaruussää-kortista.'; options.append(hint);}
  }
  const title=document.createElement('span'); title.textContent=providers.length ? 'Suosikkitoimijat:' : '';
  el('launch-favorites').replaceChildren(title,...chips,options);
}

export function renderLaunches() {
  if(!board) return;
  const {favorites, only}=prefs();
  el('next-launch').textContent=`Data by RocketLaunch.Live · Haettu ${fmt(board.updated)}${stale?' · VANHENTUNUT':''} ${warning}`;
  const shown=only&&favorites.length ? board.results.filter(l=>favorites.includes(l.provider)) : board.results;
  if(!shown.length) {
    const li=document.createElement('li'); li.textContent=`Suosikkitoimijoilla ei ole laukaisuja ${board.results.length} seuraavan joukossa.`;
    el('launch-list').replaceChildren(li); return;
  }
  el('launch-list').replaceChildren(...shown.map(l=>{
    const li=document.createElement('li'), text=document.createElement('div'), timer=document.createElement('span');
    text.textContent=`${favorites.includes(l.provider)?'★ ':''}${l.name} · ${l.rocket} · ${l.provider} · ${l.location} · ${fmt(l.net)} · ${l.status} `;
    if(l.stream_url) {
      try {
        const url=new URL(l.stream_url);
        if(url.protocol==='https:'&&url.hostname==='www.rocketlaunch.live') {
          const a=document.createElement('a'); a.href=url.href; a.target='_blank'; a.rel='noopener noreferrer';
          a.textContent='Seuraa laukaisua ja suoratoistoa ↗'; a.style.color='#5ed6ff'; text.append(a);
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
  try {board=await json('/api/launches'); stale=false; warning=''; renderFavorites(); renderLaunches();}
  catch(e) {stale=true; warning=e.message; if(board) renderLaunches(); else el('next-launch').textContent=e.message; delay=300000;}
  setTimeout(launches,delay);
}
// Ilmoitusten tila ratkaisee, voiko laukaisuilmoitukset valita.
document.addEventListener('pushchange',renderFavorites);

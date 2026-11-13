// Kalenteri: taivaan tapahtumat ja laukaisut samalla aikajanalla päivittäin ryhmiteltynä.
import { el, store, row, hhmm, fmt, button, cloudNote } from './core.js';
import { launchPrefs, toggleFavorite } from './launches.js';
import { placeLabel } from './places.js';

/** Kuinka monta taivaan tapahtumaa näytetään ennen kuin lista avataan kokonaan. */
const COLLAPSED=5;
let filter='all', expanded=false;

/** Aika laukaisuun: kaukana päivinä ja tunteina, viimeisen tunnin aikana sekunnin tarkkuudella. */
export function countdown(net) {
  const s=Math.floor((Date.parse(net)-Date.now())/1000);
  if(s<=0) return 'Ajankohta saavutettu';
  const d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60);
  return d ? `T−${d} vrk ${h} h` : h ? `T−${h} h ${m} min` : `T−${m} min ${s%60} s`;
}
export function countdownEl(net) {
  const span=document.createElement('span'); span.dataset.net=net; span.textContent=countdown(net); return span;
}
/** Päivittää kaikki sivulla näkyvät lähtölaskennat; kutsutaan sekunnin välein. */
export function tickCountdowns() {
  for(const n of document.querySelectorAll('[data-net]')) {const t=countdown(n.dataset.net); if(n.textContent!==t) n.textContent=t;}
}

export const eventIcon = title => /pimennys/i.test(title) ? 'eclipse' : /lähekkäin/i.test(title) ? 'planet' : 'meteor';
const dayStart = t => {const d=new Date(t); return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();};
function groupLabel(time) {
  if(time==null) return 'Aika tarkentuu';
  const d=new Date(time), days=Math.round((dayStart(time)-dayStart(Date.now()))/86400000);
  const date=d.toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric',...(d.getFullYear()===new Date().getFullYear() ? {} : {year:'numeric'})});
  return days===0 ? `Tänään · ${date}` : days===1 ? `Huomenna · ${date}` : date;
}
const dayTime = time => `${new Date(time).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'})} klo ${hhmm(time)}`;

// Seurantalinkki hyväksytään vain RocketLaunch.Liven omalle sivulle.
function streamLink(l) {
  try {
    const url=new URL(l.stream_url);
    if(url.protocol!=='https:'||url.hostname!=='www.rocketlaunch.live') return null;
    const small=document.createElement('small'), a=document.createElement('a');
    a.href=url.href; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Seuraa suoratoistoa ↗';
    small.append(a); return small;
  } catch(e) {return null;}
}

function launchRow(l, fav) {
  const star=button('star',fav?'★':'☆',()=>toggleFavorite(l.provider));
  star.setAttribute('aria-pressed',String(fav)); star.setAttribute('aria-label',`${fav?'Poista suosikeista':'Lisää suosikiksi'}: ${l.provider}`);
  return row({kind:'launch', iconName:'rocket', title:[l.name,' ',star],
    details:[[l.rocket,l.provider,l.location].filter(Boolean).join(' · '), l.net ? null : l.status, l.stream_url && streamLink(l)],
    when:l.net ? `klo ${hhmm(l.net)}` : '', whenSub:l.net ? countdownEl(l.net) : ''});
}
function eventRow(e) {
  const visibility=document.createElement('small');
  visibility.className=e.visible ? 'ok' : ''; visibility.textContent=e.visibility+(e.best_time ? ` · paras hetki ${dayTime(e.best_time)}` : '');
  return row({kind:'sky', iconName:eventIcon(e.title), title:e.title, details:[e.detail, visibility, e.visible && cloudNote(e.cloud_cover)], when:e.visible ? 'Näkyy' : 'Ei näy', dim:!e.visible});
}

function render() {
  const {favorites}=launchPrefs(), launches=store.launches, calendar=store.events;
  const sky=calendar?.events ?? [];
  const items=[
    ...(filter==='sky' ? [] : (launches?.results ?? []).map(l=>({time:l.net ? Date.parse(l.net) : null, fav:favorites.includes(l.provider), l}))
      .filter(x=>filter!=='fav'||x.fav)),
    ...(filter==='launch'||filter==='fav' ? [] : (expanded ? sky : sky.slice(0,COLLAPSED)).map(e=>({time:Date.parse(e.time), e}))),
  ].sort((a,b)=>(a.time ?? 0)-(b.time ?? 0));
  const nodes=[]; let last=null;
  for(const item of items) {
    const label=groupLabel(item.time);
    if(label!==last) {const h=document.createElement('div'); h.className='daylabel'; h.textContent=label; nodes.push(h); last=label;}
    nodes.push(item.l ? launchRow(item.l,item.fav) : eventRow(item.e));
  }
  if(!nodes.length) {
    const empty=document.createElement('div'); empty.className='muted';
    empty.textContent=!launches&&!calendar ? 'Ladataan…' : filter==='fav' ? (favorites.length ? 'Suosikkitoimijoilla ei ole laukaisuja lähimpien joukossa.' : 'Merkitse toimija suosikiksi laukaisun tähdestä.') : 'Ei tapahtumia.';
    nodes.push(empty);
  }
  // Rivit erotellaan päiväotsikoilla, joten rivien välisiä viivoja ei tarvita.
  for(const n of nodes) if(n.classList.contains('row')) n.style.borderTop='0';
  el('cal-list').replaceChildren(...nodes);
  const more=sky.length-COLLAPSED, showMore=more>0&&(filter==='all'||filter==='sky');
  el('cal-more').replaceChildren(...(showMore ? [button('link',expanded ? 'Näytä vähemmän taivaan tapahtumia' : `Näytä koko vuoden taivaan tapahtumat (${sky.length})`,()=>{expanded=!expanded; render();})] : []));
  el('cal-meta').textContent=[
    calendar?.error ?? (calendar ? `Näkyvyys paikasta ${placeLabel()}, seuraavat 12 kuukautta.` : ''),
    launches ? `Laukaisut: Data by RocketLaunch.Live${launches.updated ? `, haettu ${fmt(launches.updated)}` : ''}${launches.stale ? ' · VANHENTUNUT' : ''}. ${launches.warning}` : '',
  ].filter(Boolean).join(' ');
}

export function initCalendar() {
  el('cal-filter').addEventListener('click',e=>{
    const b=e.target.closest('[data-filter]'); if(!b) return;
    filter=b.dataset.filter;
    for(const x of el('cal-filter').children) x.setAttribute('aria-pressed',String(x===b));
    render();
  });
  document.addEventListener('data',e=>{if(e.detail==='launches'||e.detail==='events') render();});
}

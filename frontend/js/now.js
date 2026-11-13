// Nyt-kooste: lähituntien yhteenveto, revontulten tuntipalkki, seuraavat tapahtumat ja taivaan tilanne muiden näkymien hakemista tiedoista.
import { el, store, row, hhmm, num, dayLabel, cloudNote } from './core.js';
import { countdownEl, eventIcon } from './calendar.js';
import { dir, issNowText } from './iss.js';
import { placeLabel } from './places.js';
import { select as selectSky } from './sky.js';
import { hourClass } from './weather.js';
import { outlook } from './outlook.js';

const DAY = 86400000;

const LINKS = {revontulet:'Näytä ennuste ja perustelut ›', iss:'Näytä ylilento kartalla ›', kalenteri:'Näytä kalenterissa ›'};

// Yhteenveto päivittyy, kun mikä tahansa sen lähteistä (revontulet, ISS, tapahtumat) on haettu.
function renderOutlook() {
  const w=store.weather; if(!w) return;
  const o=outlook({weather:w, iss:store.iss, events:store.events, sun:store.sun}, Date.now(), hhmm);
  el('now-verdict').className=`verdict ${o.tone}`;
  el('now-eyebrow').textContent=`Seuraavat 24 h · ${placeLabel()}`;
  el('now-title').replaceChildren(...o.title.map(part=>{
    if(!part.strong) return part.text;
    const b=document.createElement('b'); b.textContent=part.text; return b;
  }));
  el('now-sub').textContent=[
    o.also.length ? `Myös: ${o.also.join(' · ')}.` : '',
    `Revontulet juuri nyt: ${w.aurora_chance.toLowerCase()}${w.aurora_limits.length ? ` (rajoittaa: ${w.aurora_limits.join(', ')})` : ''}. Tiedot haettu klo ${hhmm(w.fetched)}.`,
  ].filter(Boolean).join(' ');
  el('now-link').href=`#${o.view}`; el('now-link').textContent=LINKS[o.view];
}

function renderAurora() {
  const w=store.weather; if(!w) return;
  renderOutlook();
  el('now-hours').replaceChildren(...w.hourly.map(h=>{
    const cell=document.createElement('span'), bar=document.createElement('i'), label=document.createElement('small'), hour=new Date(h.time_tag).getHours();
    cell.className=hourClass(h); label.textContent=hour%3===0 ? String(hour).padStart(2,'0') : ''; cell.append(bar,label); return cell;
  }));
  const stat=(value,label)=>{const d=document.createElement('div'), b=document.createElement('b'), s=document.createElement('span'); d.className='stat'; b.textContent=value; s.textContent=label; d.append(b,s); return d;};
  el('now-stats').replaceChildren(
    stat(num(w.kp_now,1),'Kp nyt'),
    stat(w.cloud_cover_pct==null ? '–' : `${Math.round(w.cloud_cover_pct)} %`,'Pilvisyys'),
    stat(`${Math.round(w.moon_illumination*100)} %`,w.moon_alt>0 ? 'Kuu, ylhäällä' : 'Kuu, alhaalla'));
  renderSky();
}

// Lähimmät tapahtumat kaikista lähteistä: näkyvä ISS-ylilento, laukaisut ja paikalta näkyvät taivaan tapahtumat.
function renderNext() {
  const now=Date.now(), items=[];
  const pass=store.iss?.passes.find(p=>p.visible_start&&Date.parse(p.visible_end)>now);
  if(pass) items.push({time:Date.parse(pass.visible_start), node:()=>row({tag:'a', href:'#iss', iconName:'iss', title:'ISS näkyy',
    details:[`Korkeimmillaan ${num(pass.max_alt)}° ${dir(pass.max_az)}${pass.max_alt<10 ? ' · matala' : ''}`, cloudNote(pass.cloud_cover)], ...when(pass.visible_start)})});
  for(const l of (store.launches?.results ?? []).filter(l=>l.net&&Date.parse(l.net)>now).slice(0,2))
    items.push({time:Date.parse(l.net), node:()=>row({tag:'a', href:'#kalenteri', kind:'launch', iconName:'rocket', title:l.name,
      details:[[l.provider,l.location].filter(Boolean).join(' · ')], ...(Date.parse(l.net)-now<DAY ? {when:countdownEl(l.net), whenSub:`klo ${hhmm(l.net)}`} : when(l.net))})});
  for(const e of (store.events?.events ?? []).filter(e=>e.visible&&Date.parse(e.best_time ?? e.time)>now).slice(0,2))
    items.push({time:Date.parse(e.best_time ?? e.time), node:()=>row({tag:'a', href:'#kalenteri', kind:'sky', iconName:eventIcon(e.title), title:e.title,
      details:[e.visibility, cloudNote(e.cloud_cover)], ...(e.best_time ? when(e.best_time) : {when:dayLabel(e.time)})})});
  const loading=!store.iss&&!store.launches&&!store.events;
  const empty=document.createElement('div'); empty.className='muted'; empty.textContent=loading ? 'Ladataan…' : 'Ei tulevia tapahtumia.';
  el('now-next').replaceChildren(...(items.length ? items.sort((a,b)=>a.time-b.time).slice(0,5).map(i=>i.node()) : [empty]));
}
const when = time => ({when:dayLabel(time), whenSub:`klo ${hhmm(time)}`});

function renderSky() {
  const chart=store.sky, w=store.weather;
  if(chart) {
    const up=chart.objects.filter(o=>o.alt>0&&o.kind!=='star');
    const none=document.createElement('span'); none.className='muted'; none.textContent='Aurinko, Kuu ja planeetat ovat horisontin alla.';
    el('now-sky').replaceChildren(...(up.length ? up.map(o=>{
      const b=document.createElement('button'); b.type='button'; b.className='chip'; b.textContent=`${o.name} ${num(o.alt)}°`;
      // Kohde avautuu taivaankartalle valittuna.
      b.addEventListener('click',()=>{selectSky(o.name); location.hash='#taivas';});
      return b;
    }) : [none]));
  }
  el('now-light').textContent=[w && `${w.light} (Aurinko ${num(w.sun_alt)}°)`, chart?.moon_phase_name && `Kuu: ${chart.moon_phase_name.toLowerCase()}`].filter(Boolean).join(' · ');
}

export function initNow() {
  document.addEventListener('data',e=>{
    if(e.detail==='weather') renderAurora();
    else if(e.detail==='sky') renderSky();
    else {renderNext(); renderOutlook();}
    if(e.detail==='iss') el('now-iss').textContent=issNowText();
  });
}

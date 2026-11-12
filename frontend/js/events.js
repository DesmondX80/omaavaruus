// Tapahtumakortti: meteoriparvet, pimennykset ja planeettojen kohtaamiset seuraavan vuoden ajalta.
import { state, el, json, hhmm, button } from './core.js';
import { placeLabel } from './places.js';

/** Kuinka monta tapahtumaa näytetään ennen kuin lista avataan kokonaan. */
const COLLAPSED=5;
let calendar=null, expanded=false;

const day = time => new Date(time).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric',
  ...(new Date(time).getFullYear()===new Date().getFullYear() ? {} : {year:'numeric'})});
const dayTime = time => `${new Date(time).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'})} klo ${hhmm(time)}`;

function render() {
  const shown=expanded ? calendar.events : calendar.events.slice(0,COLLAPSED);
  el('event-list').replaceChildren(...shown.map(e=>{
    const li=document.createElement('li'), when=document.createElement('span'), body=document.createElement('div');
    const title=document.createElement('b'), detail=document.createElement('small'), visibility=document.createElement('small');
    when.className='event-day'; when.textContent=day(e.time);
    title.textContent=e.title; detail.textContent=e.detail;
    visibility.className=e.visible ? 'event-visible' : '';
    visibility.textContent=e.visibility+(e.best_time ? ` · paras hetki ${dayTime(e.best_time)}` : '');
    body.append(title,detail,visibility); li.append(when,body);
    if(!e.visible) li.classList.add('event-hidden');
    return li;
  }));
  const more=calendar.events.length-COLLAPSED;
  el('events-more').replaceChildren(...(more>0 ? [button('link-btn',expanded ? 'Näytä vähemmän' : `Näytä kaikki (${calendar.events.length})`,()=>{expanded=!expanded; render();})] : []));
}

export async function events() {
  try {
    calendar=await json(`/api/events?lat=${state.lat}&lon=${state.lon}`);
    el('events-meta').textContent=`Näkyvyys paikasta ${placeLabel()} · seuraavat 12 kuukautta`;
    render();
  } catch(e) {el('events-meta').textContent=e.message;}
}

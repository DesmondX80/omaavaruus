// Näkymien vaihto: osoitteen #-osa valitsee näkymän, joten selaimen takaisin-painike ja suorat linkit toimivat.
import { el } from './core.js';

export const VIEWS = ['nyt','revontulet','taivas','iss','kalenteri'];
// Avaruuslento (#lento) avautuu koko näytön tilaan Aurinkokunta-kortin päälle, joten sen alla näkyy taivasnäkymä.
const OVERLAYS = {lento:'taivas'};
export const currentView = () => {
  const hash=location.hash.slice(1);
  return VIEWS.includes(hash) ? hash : OVERLAYS[hash] ?? VIEWS[0];
};

let shown=null;
function route() {
  const name=currentView();
  // Koko näytön tilan avaaminen tai sulkeminen ei vaihda näkymää eikä vieritä sivua.
  if(name===shown) return;
  shown=name;
  for(const v of VIEWS) el(`view-${v}`).hidden = v!==name;
  for(const a of el('nav').querySelectorAll('a')) a.getAttribute('href')===`#${name}` ? a.setAttribute('aria-current','page') : a.removeAttribute('aria-current');
  window.scrollTo(0,0);
  // Piilossa ollut kartta piirretään näkyvän kokonsa mukaan vasta, kun näkymä on esillä.
  document.dispatchEvent(new CustomEvent('viewchange',{detail:name}));
}

export function initNav() { window.addEventListener('hashchange',route); route(); }

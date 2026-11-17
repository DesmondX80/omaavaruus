// Näkymien vaihto: osoitteen #-osa valitsee näkymän, joten selaimen takaisin-painike ja suorat linkit toimivat.
import { el } from './core.js';

export const VIEWS = ['nyt','revontulet','taivas','iss','kalenteri'];
// Avaruuslento-peli on nyt oma pelinsä, Sisunautti. Vanhat #lento-linkit ohjataan sinne.
export const GAME_URL = 'https://desmondx80.github.io/sisunautti/';
export const currentView = () => {
  const hash=location.hash.slice(1);
  return VIEWS.includes(hash) ? hash : VIEWS[0];
};

let shown=null;
function route() {
  if(location.hash==='#lento') {location.replace(GAME_URL); return;}
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

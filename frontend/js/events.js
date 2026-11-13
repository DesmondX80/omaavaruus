// Taivaan tapahtumat (meteoriparvet, pimennykset, konjunktiot) seuraavan vuoden ajalta. Kalenteri piirtää ne (calendar.js).
import { state, json, publish, store } from './core.js';

export async function events() {
  try {publish('events',{...await json(`/api/events?lat=${state.lat}&lon=${state.lon}`), error:null});}
  // Haun epäonnistuessa aiemmin haetut tapahtumat jäävät näkyviin.
  catch(e) {publish('events',{events:[], ...store.events, error:e.message});}
}

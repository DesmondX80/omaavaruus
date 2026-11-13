// Taivaan tapahtumat (meteoriparvet, pimennykset, konjunktiot) seuraavan vuoden ajalta sekä Kuun vaiheet ja kuuttomat yöt.
// Kalenteri piirtää ne (calendar.js).
import { state, json, publish, store } from './core.js';

export async function events() {
  const query=`lat=${state.lat}&lon=${state.lon}`;
  await Promise.all([
    json(`/api/events?${query}`).then(
      calendar=>publish('events',{...calendar, error:null}),
      // Haun epäonnistuessa aiemmin haetut tapahtumat jäävät näkyviin.
      e=>publish('events',{events:[], ...store.events, error:e.message})),
    json(`/api/moon?${query}`).then(moon=>publish('moon',moon), e=>console.warn(`Kuun tietojen haku epäonnistui: ${e.message}`)),
  ]);
}

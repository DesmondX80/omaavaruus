// Taivaan tapahtumat seuraavan vuoden ajalta sekä Kuun vaiheet ja kuuttomat yöt. Kalenteri piirtää ne (calendar.js).
// Palvelin laskee tapahtumat kolmessa osassa (meteoriparvet ja kuunpimennykset, konjunktiot, auringonpimennykset),
// jotta kukin pyyntö mahtuu Workersin ilmaistason CPU-budjettiin; ne yhdistetään tässä.
import { state, json, publish, store } from './core.js';

const PARTS = ['/api/events', '/api/events/conjunctions', '/api/events/solar'];

export async function events() {
  const query=`lat=${state.lat}&lon=${state.lon}`;
  await Promise.all([
    Promise.allSettled(PARTS.map(path=>json(`${path}?${query}`))).then(results=>{
      const ok=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      const failed=results.find(r=>r.status==='rejected');
      // Kokonaan epäonnistunut haku jättää aiemmin haetut tapahtumat näkyviin; osittain onnistunut näyttää saadut.
      if(!ok.length) {publish('events',{events:[], ...store.events, error:failed.reason.message}); return;}
      publish('events',{
        events:ok.flatMap(part=>part.events).sort((a,b)=>a.time.localeCompare(b.time)),
        cloud_provider:ok[0].cloud_provider,
        error:failed ? `Osa tapahtumista puuttuu: ${failed.reason.message}` : null,
      });
    }),
    json(`/api/moon?${query}`).then(moon=>publish('moon',moon), e=>console.warn(`Kuun tietojen haku epäonnistui: ${e.message}`)),
  ]);
}

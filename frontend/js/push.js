// Revontuli-ilmoitukset: push-tilauksen teko, päivitys ja poisto. Tilaus koskee paikkaa, joka oli valittuna sitä tehdessä.
import { state, el, json, post, saved } from './core.js';
import { placeLabel } from './places.js';

const KEY = 'omaavaruus.push';
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// Palvelin tallentaa sijainnin 0,1 asteen tarkkuudella; sama pyöristys kertoo, onko valittu paikka vaihtunut.
const near = v => Math.round(v * 10) / 10;
let subscription = null, busy = false, note = '';

const settings = () => saved.get(KEY, null);
const samePlace = s => s && s.lat === near(state.lat) && s.lon === near(state.lon);

export function renderPush() {
  const s = subscription ? settings() : null;
  el('push-controls').hidden = !supported;
  el('push-enable').hidden = !!s;
  el('push-test').hidden = el('push-disable').hidden = !s;
  el('push-move').hidden = !s || samePlace(s);
  el('push-move').textContent = `Vaihda paikaksi ${placeLabel()}`;
  if (s) el('push-threshold').value = s.threshold;
  for (const b of el('push-controls').querySelectorAll('button, select')) b.disabled = busy;
  el('push-status').textContent = note || (!supported
    ? 'Tämä selain ei tue ilmoituksia. iPhonessa ilmoitukset toimivat, kun sovellus on lisätty Koti-valikkoon.'
    : s ? `Ilmoitukset ovat päällä: ${s.place}.`
    : 'Saat ilmoituksen puhelimeen, kun revontulia voi näkyä valitussa paikassa.');
}

// Ajaa toiminnon niin, että painikkeet ovat sen ajan pois käytöstä ja virhe näkyy tilarivillä.
async function run(action, done = '') {
  busy = true; note = ''; renderPush();
  try { await action(); note = done; } catch (e) { note = e.message; }
  busy = false; renderPush();
}

function keyBytes(base64url) {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// Tallentaa tilauksen palvelimelle nykyiselle paikalle ja valitulle rajalle (myös päivitys).
async function save() {
  const r = await post('/api/push/subscribe', {
    subscription: subscription.toJSON(), lat: state.lat, lon: state.lon, place: placeLabel(), threshold: el('push-threshold').value,
  });
  saved.set(KEY, { place: r.place, lat: r.lat, lon: r.lon, threshold: r.threshold });
}

async function enable() {
  if (await Notification.requestPermission() !== 'granted') throw new Error('Ilmoitukset on estetty. Salli ne selaimen tai puhelimen asetuksista ja yritä uudelleen.');
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await json('/api/push/key');
  subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
      .catch(e => { throw new Error(`Ilmoitusten käyttöönotto ei onnistunut tässä selaimessa (${e.message}).`); });
  await save();
}

async function disable() {
  await post('/api/push/unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
  subscription = null; saved.set(KEY, null);
}

export async function initPush() {
  renderPush();
  if (!supported) return;
  el('push-enable').addEventListener('click', () => run(enable, 'Ilmoitukset otettu käyttöön.'));
  el('push-disable').addEventListener('click', () => run(disable, 'Ilmoitukset poistettu käytöstä.'));
  el('push-move').addEventListener('click', () => run(save));
  el('push-test').addEventListener('click', () => run(() => post('/api/push/test', { endpoint: subscription.endpoint }), 'Testi-ilmoitus lähetetty. Sen pitäisi näkyä hetken kuluttua.'));
  el('push-threshold').addEventListener('change', () => { if (subscription && settings()) run(save); });
  subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  renderPush();
}

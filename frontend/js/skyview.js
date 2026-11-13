// Perspektiivinäkymä taivaasta koko näytön tilaan: suuntaa ohjataan sormella tai puhelimen asentoantureilla,
// ja taustalla voi olla takakameran kuva. Koordinaatisto on paikallinen ENU: x itään, y pohjoiseen, z ylös.
import { arcPoints } from './skychart.js';

const RAD = Math.PI / 180;
const COLORS = { planet: '#ffb547', star: '#e8eefc', sun: '#ffd75e', moon: '#c9d6f0', iss: '#5ed6ff' };
const COMPASS = [['P',0],['KO',45],['I',90],['KA',135],['E',180],['LO',225],['L',270],['LU',315]];
/** Napautus osuu kohteeseen tämän säteen (CSS-pikseleinä) sisältä. */
const HIT_PX = 26;

const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };

/** Suuntavektori korkeudesta ja atsimuutista (asteina, atsimuutti myötäpäivään pohjoisesta). */
export function vector(alt, az) {
  const a = alt * RAD, z = az * RAD;
  return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)];
}

export function altAz(v) {
  return { alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD, az: ((Math.atan2(v[0], v[1]) / RAD) + 360) % 360 };
}

/**
 * Katselusuunta laitteen asennosta (W3C DeviceOrientation: alpha, beta, gamma asteina, kierrot Z-X'-Y'').
 * Takakamera osoittaa laitteen −z-akselin suuntaan. screenAngle on näytön kierto (screen.orientation.angle),
 * jolla vaakatilassa näytön ylösuunta on laitteen sivu. Palauttaa katselusuunnan ja näytön ylös-vektorin.
 */
export function orientationView(alpha, beta, gamma, screenAngle = 0) {
  const [a, b, g] = [alpha * RAD, beta * RAD, gamma * RAD];
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
  // R = Rz(alpha) · Rx(beta) · Ry(gamma): laitteen koordinaateista maan koordinaatteihin.
  const R = [
    [ca*cg - sa*sb*sg, -sa*cb, ca*sg + sa*sb*cg],
    [sa*cg + ca*sb*sg,  ca*cb, sa*sg - ca*sb*cg],
    [-cb*sg,            sb,    cb*cg],
  ];
  const apply = v => R.map(row => dot(row, v));
  const s = screenAngle * RAD;
  return { dir: apply([0, 0, -1]), up: apply([Math.sin(s), Math.cos(s), 0]) };
}

/** Kamera: suunta, ylös-vektori ja pystysuuntainen näkökenttä. Ylös-vektori oikaistaan kohtisuoraan suuntaa vastaan. */
export function camera(dir, up, vfov) {
  const d = norm(dir);
  let u = up.map((x, i) => x - dot(up, d) * d[i]);
  // Suoraan ylös tai alas katsottaessa ylös-vektori on epämääräinen; käytetään pohjoista.
  if (Math.hypot(...u) < 1e-6) u = [0, 1, 0];
  u = norm(u);
  return { dir: d, up: u, right: cross(d, u), vfov };
}

/** Gnomoninen projektio: piste näytöllä (keskipisteestä, y alas) tai null, jos piste on kameran takana. */
export function project(cam, v, width, height) {
  const depth = dot(v, cam.dir);
  if (depth <= 0.05) return null;
  const f = (height / 2) / Math.tan(cam.vfov * RAD / 2);
  return [width / 2 + f * dot(v, cam.right) / depth, height / 2 - f * dot(v, cam.up) / depth];
}

export function createSkyView(canvas, { onSelect, onStatus }) {
  const ctx = canvas.getContext('2d');
  let chart = null, selected = null;
  // Käsiohjaus: suunta ja korkeus asteina. Anturiohjauksessa suunta tulee laitteesta ja korjaus atsimuuttiin raahaamalla.
  let az0 = 180, alt0 = 25, vfov = 70, azOffset = 0;
  let sensor = null, smooth = null, compassOffset = null, frame = 0, video = null;

  const size = () => [canvas.clientWidth, canvas.clientHeight];

  function currentCamera() {
    if (sensor && smooth) {
      // Kompassikorjaus käännetään atsimuuttikierroksi z-akselin ympäri.
      const k = -(azOffset + (compassOffset ?? 0)) * RAD, c = Math.cos(k), s = Math.sin(k);
      const rot = v => [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]];
      return camera(rot(smooth.dir), rot(smooth.up), vfov);
    }
    return camera(vector(alt0, az0), [0, 0, 1], vfov);
  }

  function draw() {
    frame = 0;
    const [w, h] = size(), scale = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!video) { ctx.fillStyle = '#060a15'; ctx.fillRect(0, 0, w, h); }
    if (!chart) return;
    const cam = currentCamera(), at = v => project(cam, v, w, h);

    // Horisontti ja ilmansuunnat
    ctx.beginPath(); let pen = false;
    for (let az = 0; az <= 360; az += 2) {
      const p = at(vector(0, az));
      if (!p) { pen = false; continue; }
      pen ? ctx.lineTo(...p) : ctx.moveTo(...p); pen = true;
    }
    ctx.strokeStyle = 'rgba(139,154,192,.7)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#8b9ac0';
    for (const [label, az] of COMPASS) { const p = at(vector(0, az)); if (p) ctx.fillText(label, p[0], p[1] + 18); }

    const byName = new Map(chart.objects.map(o => [o.name, o]));
    ctx.beginPath();
    for (const { lines } of chart.constellations ?? []) {
      for (const [a, b] of lines) {
        const oa = byName.get(a), ob = byName.get(b);
        const pa = oa && at(vector(oa.alt, oa.az)), pb = ob && at(vector(ob.alt, ob.az));
        if (pa && pb) { ctx.moveTo(...pa); ctx.lineTo(...pb); }
      }
    }
    ctx.strokeStyle = 'rgba(94,130,210,.55)'; ctx.lineWidth = 1; ctx.stroke();

    // ISS-ylilennon kaari: koko ylilento katkoviivana, näkyvä osuus paksuna (kuten taivaankartalla).
    const pass = chart.iss_pass;
    if (pass?.sky_track) {
      const line = (points) => {
        ctx.beginPath(); let pen = false;
        for (const [alt, az] of points) { const p = at(vector(alt, az)); if (!p) { pen = false; continue; } pen ? ctx.lineTo(...p) : ctx.moveTo(...p); pen = true; }
      };
      line(arcPoints(pass)); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(139,154,192,.8)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      line(arcPoints(pass, Date.parse(pass.visible_start), Date.parse(pass.visible_end))); ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
    const zoom = 70 / vfov;
    for (const o of chart.objects) {
      const p = at(vector(o.alt, o.az));
      if (!p) continue;
      const star = o.kind === 'star', color = COLORS[o.kind] || '#fff';
      const r = (star ? Math.max(1, 3.6 - (o.magnitude ?? 2) * 0.8) : 5) * Math.sqrt(zoom);
      ctx.globalAlpha = o.alt < 0 ? 0.35 : 1;
      if (!star) { ctx.beginPath(); ctx.arc(p[0], p[1], r + 6, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.globalAlpha *= 0.2; ctx.fill(); ctx.globalAlpha = o.alt < 0 ? 0.35 : 1; }
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
      if (o.name === selected) { ctx.beginPath(); ctx.arc(p[0], p[1], r + 8, 0, 2 * Math.PI); ctx.strokeStyle = '#5ed6ff'; ctx.lineWidth = 2; ctx.stroke(); }
      if (!star || o.name === selected || (o.magnitude ?? 9) < 1.6) {
        ctx.fillStyle = star && o.name !== selected ? 'rgba(232,238,252,.6)' : color;
        ctx.fillText(o.name, p[0] + r + 5, p[1] - r - 2);
      }
    }
    ctx.globalAlpha = 1;
    const c = altAz(cam.dir);
    onStatus?.(`Suunta ${Math.round(c.az)}° ${COMPASS[Math.round(c.az / 45) % 8][0]} · korkeus ${Math.round(c.alt)}° · näkökenttä ${Math.round(vfov)}°`);
  }
  const redraw = () => { frame ||= requestAnimationFrame(draw); };

  // Raahaus kääntää näkymää, nipistys ja rulla zoomaavat, napautus valitsee lähimmän kohteen.
  const pointers = new Map(); let moved = false, pinch = null;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); moved = false; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { dist: Math.hypot(a[0]-b[0], a[1]-b[1]), vfov }; } });
  canvas.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId); if (!prev) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      vfov = Math.max(20, Math.min(110, pinch.vfov * pinch.dist / Math.max(10, Math.hypot(a[0]-b[0], a[1]-b[1]))));
      moved = true; redraw(); return;
    }
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    const perPx = vfov / size()[1];
    if (sensor) azOffset -= dx * perPx;
    else { az0 = (az0 - dx * perPx + 360) % 360; alt0 = Math.max(-30, Math.min(89, alt0 + dy * perPx)); }
    redraw();
  });
  const release = e => {
    const wasTap = pointers.size === 1 && !moved;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    if (wasTap && e.type === 'pointerup' && chart) {
      const box = canvas.getBoundingClientRect(), [w, h] = size(), cam = currentCamera();
      let best = null, bestDist = HIT_PX;
      for (const o of chart.objects) {
        const p = project(cam, vector(o.alt, o.az), w, h); if (!p) continue;
        const dist = Math.hypot(p[0] - (e.clientX - box.left), p[1] - (e.clientY - box.top)) - (o.kind === 'star' ? 0 : 6);
        if (dist < bestDist) [best, bestDist] = [o, dist];
      }
      onSelect(best?.name ?? null);
    }
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', e => { e.preventDefault(); vfov = Math.max(20, Math.min(110, vfov * Math.exp(e.deltaY * 0.001))); redraw(); }, { passive: false });
  new ResizeObserver(redraw).observe(canvas);

  function onOrientation(e) {
    if (e.alpha === null || e.beta === null) return;
    const view = orientationView(e.alpha, e.beta, e.gamma ?? 0, screen.orientation?.angle ?? window.orientation ?? 0);
    // iPhonen alpha ei osoita pohjoiseen; kompassisuunta (webkitCompassHeading) kertoo, paljonko sitä pitää kiertää.
    if (typeof e.webkitCompassHeading === 'number' && view.dir[2] < 0.9) {
      const diff = ((e.webkitCompassHeading - altAz(view.dir).az + 540) % 360) - 180;
      compassOffset = compassOffset === null ? diff : compassOffset + (((diff - compassOffset + 540) % 360) - 180) * 0.05;
    }
    // Pehmennys vaimentaa anturien värinää.
    smooth = smooth ? { dir: smooth.dir.map((x, i) => x + (view.dir[i] - x) * 0.3), up: smooth.up.map((x, i) => x + (view.up[i] - x) * 0.3) } : view;
    redraw();
  }

  return {
    setChart(next, sel) { chart = next; selected = sel; redraw(); },
    redraw,
    /** Kääntää näkymän kohteeseen (käsiohjauksessa). */
    lookAt(alt, az) { if (!sensor) { az0 = az; alt0 = Math.max(-30, Math.min(89, alt)); redraw(); } },
    sensorsOn: () => !!sensor,
    async startSensors() {
      // iPhone vaatii luvan käyttäjän painalluksesta.
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('Asentoanturien käyttö estettiin. Salli liike ja suunta selaimen asetuksista.');
      }
      if (typeof DeviceOrientationEvent === 'undefined') throw new Error('Tämä laite ei tue asentoantureita. Käännä näkymää raahaamalla.');
      // Android antaa pohjoiseen sidotun suunnan omana tapahtumanaan.
      const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      sensor = { type, handler: onOrientation }; smooth = null; compassOffset = null; azOffset = 0; vfov = 60;
      window.addEventListener(type, onOrientation);
      // Jos anturidataa ei tule (esim. tietokone), palataan käsiohjaukseen.
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (sensor && !smooth) { this.stopSensors(); throw new Error('Asentoantureista ei saatu tietoa. Käännä näkymää raahaamalla.'); }
    },
    stopSensors() {
      if (sensor) window.removeEventListener(sensor.type, sensor.handler);
      sensor = null; smooth = null; redraw();
    },
    async startCamera(videoEl) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      videoEl.srcObject = stream; await videoEl.play(); video = videoEl; redraw();
    },
    stopCamera(videoEl) {
      videoEl.srcObject?.getTracks().forEach(t => t.stop()); videoEl.srcObject = null; video = null; redraw();
    },
    cameraOn: () => !!video,
  };
}

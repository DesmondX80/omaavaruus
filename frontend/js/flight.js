// Avaruuslennon ratamekaniikka: Keplerin radan eteneminen, Lambertin ongelma ja ratamuutosten Δv.
// Yksiköt: km, km/s ja sekunnit, ellei toisin mainita. Ajanhetket ovat millisekunteja (Date.getTime()).
// Koordinaatit ovat Auringon keskisiä ekliptikan koordinaatteja (J2000) kuten planets.js:ssä.
// Kaikki lasketaan selaimessa suljetuilla kaavoilla, joten aluksen paikka saadaan suoraan mille tahansa hetkelle
// ilman askeltavaa integrointia, vaikka aikaa kiihdytettäisiin vuoden sekunnissa.

import { AU_KM, PLANETS, elements, helioState } from './planets.js';

/** Auringon gravitaatioparametri GM (km³/s²). */
export const MU_SUN = 1.32712440018e11;
const DAY_S = 86400;
const DAY_MS = DAY_S*1000;
/** Raketin Δv-budjetti (km/s) yhdelle lennolle; polttoaine täydentyy, kun planeetta on tutkittu. */
export const FUEL_KMS = 14;

// Planeettojen gravitaatioparametrit (km³/s²) ja kiertoradat, joilla alus pysäköidään: [perikeskuksen ja apokeskuksen korkeus km].
// Venus, Maa ja Mars kierretään matalalla ympyräradalla. Merkuriukselle saavutaan Auringon läheltä suurella
// ylinopeudella, joten sen kaappausrata on hieman venynyt. Jättiläisplaneetoilla kaapataan venyneelle radalle,
// kuten luotaimet tekevät, koska matalalle ympyräradalle jarruttaminen veisi kymmeniä km/s.
const BODIES = {
  Merkurius: {mu:22031.86, orbit:[200,10000]},
  Venus: {mu:324858.59, orbit:[300,300]},
  Maa: {mu:398600.44, orbit:[200,200]},
  Mars: {mu:42828.37, orbit:[300,300]},
  Jupiter: {mu:126686531.9, orbit:[70000,2000000]},
  Saturnus: {mu:37931206.2, orbit:[60000,1500000]},
  Uranus: {mu:5793951.3, orbit:[25000,500000]},
  Neptunus: {mu:6835099.5, orbit:[25000,500000]},
};

/**
 * Planeettojen tiedot lentoa varten: säde, μ, vaikutuspiirin (SOI) säde a·(μ/μ☉)^(2/5) ja pysäköintirata (km).
 * Vaikutuspiirin sisällä aluksen liikettä hallitsee planeetan painovoima, sen ulkopuolella Auringon.
 */
export const FLIGHT_BODIES = Object.fromEntries(PLANETS.map(p=>{
  const {mu,orbit}=BODIES[p.name], a=elements(p.name,Date.UTC(2000,0,1,12)).a*AU_KM;
  return [p.name, {name:p.name, radiusKm:p.radiusKm, mu, soiKm:a*(mu/MU_SUN)**0.4,
    periKm:p.radiusKm+orbit[0], apoKm:p.radiusKm+orbit[1]}];
}));

const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const scale = (a, k) => [a[0]*k, a[1]*k, a[2]*k];
export const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);

/** Planeetan paikka (km) ja nopeus (km/s) Auringon ympärillä hetkellä time (ms). */
export function planetState(name, time) {
  const {pos,vel}=helioState(name,time);
  return {r:scale(pos,AU_KM), v:scale(vel,AU_KM/DAY_S)};
}

// Stumpffin funktiot C(z) ja S(z); pienillä z:n arvoilla sarjakehitelmä välttää kumoutumisen.
function stumpff(z) {
  if(z>1e-6) {const s=Math.sqrt(z); return [(1-Math.cos(s))/z, (s-Math.sin(s))/(s*z)];}
  if(z<-1e-6) {const s=Math.sqrt(-z); return [(Math.cosh(s)-1)/-z, (Math.sinh(s)-s)/(s*-z)];}
  return [1/2-z/24+z*z/720, 1/6-z/120+z*z/5040];
}

/**
 * Keplerin radan eteneminen universaalimuuttujalla: paikka r ja nopeus v ajan dt (s) kuluttua alkutilasta (r0, v0).
 * Toimii ellipsillä, paraabelilla ja hyperbelillä sekä taaksepäin (dt < 0). Universaalin Keplerin yhtälön
 * ratkaisuun käytetään Laguerren–Conwayn menetelmää, joka suppenee luotettavasti myös huonoista alkuarvauksista.
 */
export function propagate(r0, v0, dt, mu = MU_SUN) {
  const rn=norm(r0), vr=dot(r0,v0)/rn, alpha=2/rn-dot(v0,v0)/mu, sqmu=Math.sqrt(mu);
  // Ellipsillä kokonaiset kierrokset voi jättää pois, mikä pitää vuosikymmenien etenemisen tarkkana.
  if(alpha>1e-12) {
    const period=2*Math.PI/Math.sqrt(mu*alpha**3);
    dt-=Math.round(dt/period)*period;
  }
  if(dt===0) return {r:[...r0], v:[...v0]};
  // Alkuarvaus: ellipsillä keskiliike, hyperbelillä ja paraabelilla logaritminen arvio (Vallado).
  let x;
  if(alpha>1e-12) x=sqmu*dt*alpha;
  else if(alpha<-1e-12) {
    const a=1/alpha, sg=Math.sign(dt);
    x=sg*Math.sqrt(-a)*Math.log((-2*mu*alpha*dt)/(dot(r0,v0)+sg*Math.sqrt(-mu*a)*(1-rn*alpha)));
    if(!Number.isFinite(x)) x=sqmu*dt/rn;
  } else x=sqmu*dt/rn;
  const k=rn*vr/sqmu;
  for(let i=0;i<100;i++) {
    const z=alpha*x*x, [C,S]=stumpff(z);
    const F=k*x*x*C+(1-alpha*rn)*x**3*S+rn*x-sqmu*dt;
    const dF=k*x*(1-z*S)+(1-alpha*rn)*x*x*C+rn;
    const ddF=k*(1-z*C)+(1-alpha*rn)*x*(1-z*S);
    const n=5, root=Math.sqrt(Math.abs((n-1)**2*dF*dF-n*(n-1)*F*ddF));
    const dx=n*F/(dF+Math.sign(dF)*root);
    x-=dx;
    if(Math.abs(dx)<1e-10*Math.max(1,Math.abs(x))) break;
  }
  const z=alpha*x*x, [C,S]=stumpff(z);
  const f=1-x*x/rn*C, g=dt-x**3/sqmu*S;
  const r=add(scale(r0,f),scale(v0,g)), r1=norm(r);
  const fd=sqmu/(r1*rn)*(alpha*x**3*S-x), gd=1-x*x/r1*C;
  return {r, v:add(scale(r0,fd),scale(v0,gd))};
}

/**
 * Lambertin ongelma: siirtorata, joka kulkee paikasta r1 paikkaan r2 ajassa tof (s). Rata kiertää planeettojen
 * suuntaan (ekliptikan pohjoisnavalta katsoen vastapäivään) alle yhden kierroksen.
 * Palauttaa nopeudet v1 lähtöpisteessä ja v2 saapumispisteessä (km/s) tai null, jos ratkaisua ei löydy.
 * Universaalimuuttujan z ratkaisu haetaan puolitushaulla, koska lentoaika kasvaa z:n mukana monotonisesti.
 */
export function lambert(r1, r2, tof, mu = MU_SUN) {
  const n1=norm(r1), n2=norm(r2);
  let dtheta=Math.acos(Math.max(-1,Math.min(1,dot(r1,r2)/(n1*n2))));
  if(cross(r1,r2)[2]<0) dtheta=2*Math.PI-dtheta;
  const A=Math.sin(dtheta)*Math.sqrt(n1*n2/(1-Math.cos(dtheta)));
  if(!(tof>0) || !Number.isFinite(A) || Math.abs(A)<1e-9) return null;
  const sqmu=Math.sqrt(mu);
  const yOf=z=>{const [C,S]=stumpff(z); return n1+n2+A*(z*S-1)/Math.sqrt(C);};
  const tofOf=z=>{
    const [C,S]=stumpff(z), y=n1+n2+A*(z*S-1)/Math.sqrt(C);
    if(y<0) return -Infinity;
    return ((y/C)**1.5*S+A*Math.sqrt(y))/sqmu;
  };
  let lo=-4*Math.PI**2, hi=4*Math.PI**2*(1-1e-12);
  for(let i=0;i<60 && tofOf(lo)>tof;i++) lo*=2;
  if(tofOf(lo)>tof) return null;
  for(let i=0;i<200;i++) {
    const mid=(lo+hi)/2;
    if(tofOf(mid)<tof) lo=mid; else hi=mid;
    if(hi-lo<1e-13*Math.max(1,Math.abs(mid))) break;
  }
  const y=yOf((lo+hi)/2);
  const f=1-y/n1, g=A*Math.sqrt(y/mu), gd=1-y/n2;
  return {v1:scale(sub(r2,scale(r1,f)),1/g), v2:scale(sub(scale(r2,gd),r1),1/g)};
}

/** Ominaisenergia ja liikemäärämomentti (radan säilyvät suureet). */
export function invariants(r, v, mu = MU_SUN) {
  return {energy:dot(v,v)/2-mu/norm(r), h:cross(r,v)};
}

/**
 * Polton Δv (km/s) planeetan pysäköintiradan ja Auringon ympäri kulkevan radan välillä, kun ylinopeus
 * planeetan suhteen on vinf (km/s). Poltto tehdään radan perikeskuksessa: Δv = √(v∞² + 2μ/r) − v_rata.
 * Sama kaava pätee lähtöön ja saapumiseen (kaappaukseen).
 */
export function burnDv(body, vinf, orbit = FLIGHT_BODIES[body]) {
  const {mu,periKm,apoKm}=orbit;
  const vOrbit=Math.sqrt(mu*(2/periKm-2/(periKm+apoKm)));
  return Math.sqrt(vinf*vinf+2*mu/periKm)-vOrbit;
}

/**
 * Lähtöpaikka on planeetan nimi (alus planeetan pysäköintiradalla) tai Auringon ympäri kulkeva rata
 * {r, v, t}, jolle alus jää, jos polttoaine ei riitä jarrutukseen kohteessa (ohilento).
 */
export const isPlanet = from => typeof from==='string';
/** Lähtöpaikan paikka ja nopeus Auringon ympärillä hetkellä time (ms). */
export function departureState(from, time) {
  return isPlanet(from) ? planetState(from,time) : propagate(from.r,from.v,(time-from.t)/1000);
}

/**
 * Siirtolento lähtöpaikasta from planeetalle to: lähtö hetkellä depart (ms), lentoaika tofDays vuorokautta.
 * Palauttaa siirtoradan alkutilan, ylinopeudet ja polttojen Δv:t tai null, jos Lambertin ratkaisua ei löydy.
 * Auringon kiertoradalta lähdettäessä poltto on suoraan nopeuksien erotus.
 */
export function transfer(from, to, depart, tofDays) {
  const arrive=depart+tofDays*DAY_S*1000;
  const a=departureState(from,depart), b=planetState(to,arrive);
  const sol=lambert(a.r,b.r,tofDays*DAY_S);
  if(!sol) return null;
  const vinfDep=norm(sub(sol.v1,a.v)), vinfArr=norm(sub(sol.v2,b.v));
  const dvDep=isPlanet(from) ? burnDv(from,vinfDep) : vinfDep, dvArr=burnDv(to,vinfArr);
  return {from, to, depart, arrive, r1:a.r, v1:sol.v1, r2:b.r, v2:sol.v2,
    vinfDep, vinfArr, dvDep, dvArr, dvTotal:dvDep+dvArr};
}

/** Aluksen paikka ja nopeus siirtoradalla hetkellä time (ms). */
// Kurssikorjausten jälkeen lennossa on osuuksia (legs: [{t, r, v}]); kullakin hetkellä käytetään viimeisintä
// osuutta, joka on alkanut ennen sitä.
export function shipState(tr, time) {
  if(tr.legs) {
    let leg=tr.legs[0];
    for(const l of tr.legs) if(l.t<=time) leg=l;
    return propagate(leg.r, leg.v, (time-leg.t)/1000);
  }
  return propagate(tr.r1, tr.v1, (time-tr.depart)/1000);
}

/** Hohmannin siirto ympyräratojen r1 ja r2 välillä: lentoaika (s) ja ylinopeudet lähdössä ja saapumisessa (km/s). */
export function hohmann(r1, r2, mu = MU_SUN) {
  const a=(r1+r2)/2;
  return {
    tof:Math.PI*Math.sqrt(a**3/mu),
    vinfDep:Math.abs(Math.sqrt(mu*(2/r1-1/a))-Math.sqrt(mu/r1)),
    vinfArr:Math.abs(Math.sqrt(mu/r2)-Math.sqrt(mu*(2/r2-1/a))),
  };
}

// Hakuruudukko: lähtöpäiviä ja lentoaikoja. Ulkoplaneetoille ruudukko harvenee, koska lentoaika on pitkä
// ja ikkuna leveä.
const DEP_STEPS = 150, TOF_STEPS = 40;

// Kuvioetsintä (pattern search) ruudukon parhaan pisteen ympäriltä: askelta puolitetaan, kunnes se on alle tunnin.
function refine(cost, dep, tof, dStep, tStep) {
  let best=cost(dep,tof);
  while(dStep>1/24 || tStep>1/24) {
    let moved=false;
    for(const [dd,dt] of [[dStep,0],[-dStep,0],[0,tStep],[0,-tStep],[dStep,tStep],[-dStep,-tStep],[dStep,-tStep],[-dStep,tStep]]) {
      const c=cost(dep+dd,tof+dt);
      if(c<best) {best=c; dep+=dd; tof+=dt; moved=true; break;}
    }
    if(!moved) {dStep/=2; tStep/=2;}
  }
  return [dep,tof];
}

/**
 * Laukaisuikkunoiden haku planeetalta from planeetalle to alkaen hetkestä start (ms), days vuorokauden ajalta.
 * Generaattori: jokainen next() laskee yhden lähtöpäivän rivin ja antaa edistymisen (0–1), jotta käyttöliittymä
 * ehtii piirtää välissä. Lopuksi palautetaan vaihtoehdot halvimmasta alkaen:
 * halvin, nopeampi (lentoaika enintään 70 % halvimman lentoajasta) ja aikaisin perillä polttoaineella fuel.
 */
export function* windowSearch(from, to, start, {days = 730, fuel = FUEL_KMS} = {}) {
  // Hohmannin lentoaika antaa haun mittakaavan; Auringon kiertoradalla isoakselin puolikas saadaan energiasta.
  const a1=isPlanet(from) ? elements(from,start).a*AU_KM : (s=>{const e=invariants(s.r,s.v).energy; return e<0 ? -MU_SUN/(2*e) : norm(s.r);})(departureState(from,start));
  const a2=elements(to,start).a*AU_KM;
  const th=hohmann(a1,a2).tof/DAY_S;
  const tofMin=Math.max(20,th*0.35), tofMax=th*1.15;
  const dStep=days/DEP_STEPS, tStep=(tofMax-tofMin)/TOF_STEPS;
  const grid=[];
  for(let i=0;i<=DEP_STEPS;i++) {
    for(let j=0;j<=TOF_STEPS;j++) {
      const dep=i*dStep, tof=tofMin+j*tStep, tr=transfer(from,to,start+dep*DAY_MS,tof);
      if(tr) grid.push({dep, tof, cost:tr.dvTotal});
    }
    yield i/DEP_STEPS;
  }
  if(!grid.length) return [];
  // Kustannusfunktiot vuorokausina lähtöhetkestä; rajojen ulkopuoliset ja ratkeamattomat pisteet ovat äärettömiä.
  const at=(dep,tof)=>dep<0||dep>days||tof<tofMin||tof>tofMax ? null : transfer(from,to,start+dep*DAY_MS,tof);
  const pick=(points, cost)=>{
    if(!points.length) return null;
    const p=points.reduce((b,q)=>cost(q.dep,q.tof)<cost(b.dep,b.tof) ? q : b);
    if(!Number.isFinite(cost(p.dep,p.tof))) return null;
    const [dep,tof]=refine(cost,p.dep,p.tof,dStep,tStep);
    return at(dep,tof);
  };
  const dv=(dep,tof)=>at(dep,tof)?.dvTotal ?? Infinity;
  const cheapest=pick(grid,(dep,tof)=>dv(dep,tof));
  if(!cheapest) return [];
  const limit=0.7*(cheapest.arrive-cheapest.depart)/DAY_MS;
  const faster=pick(grid.filter(p=>p.tof<=limit),(dep,tof)=>tof>limit ? Infinity : dv(dep,tof));
  const earliest=pick(grid.filter(p=>p.cost<=fuel),(dep,tof)=>dv(dep,tof)<=fuel ? dep+tof : Infinity);
  const options=[{kind:'cheapest', ...cheapest}];
  if(faster) options.push({kind:'faster', ...faster});
  // Aikaisin perille ehtivä vaihtoehto näytetään vain, jos se eroaa muista selvästi.
  if(earliest && options.every(o=>Math.abs(o.arrive-earliest.arrive)>5*DAY_MS)) options.push({kind:'earliest', ...earliest});
  return options.map(o=>({...o, fuelOk:o.dvTotal<=fuel}));
}

/** Ajaa ikkunahaun loppuun kerralla (testit ja pienet haut). */
export function findWindows(...args) {
  const it=windowSearch(...args);
  for(;;) {const r=it.next(); if(r.done) return r.value;}
}

/** Kesto muodossa 123 vrk 04:12:33. */
export function fmtDuration(ms) {
  const s=Math.max(0,Math.floor(ms/1000)), d=Math.floor(s/86400), p=n=>String(n).padStart(2,'0');
  return `${d} vrk ${p(Math.floor(s/3600)%24)}:${p(Math.floor(s/60)%60)}:${p(s%60)}`;
}

/**
 * Hetki (ms), jolloin alus saapuu kohdeplaneetan vaikutuspiiriin siirtoradalla tr. Etäisyys planeettaan pienenee
 * loppua kohti, joten haetaan viimeinen piste vaikutuspiirin ulkopuolelta ja tarkennetaan puolitushaulla.
 */
export function soiEntry(tr) {
  const soi=FLIGHT_BODIES[tr.to].soiKm;
  const gap=t=>norm(sub(shipState(tr,t).r,planetState(tr.to,t).r))-soi;
  const N=400, span=tr.arrive-tr.depart;
  let lo=null;
  for(let i=N-1;i>=0;i--) {const t=tr.depart+span*i/N; if(gap(t)>0) {lo=t; break;}}
  if(lo===null) return tr.depart;
  let hi=Math.min(tr.arrive,lo+span/N);
  for(let i=0;i<60;i++) {const mid=(lo+hi)/2; if(gap(mid)>0) lo=mid; else hi=mid;}
  return hi;
}

/** Lähin planeetta paikassa r (km) hetkellä time: nimi, etäisyys (km) ja aluksen nopeus v (km/s) sen suhteen. */
export function nearestPlanet(r, v, time) {
  let best=null;
  for(const {name} of PLANETS) {
    const s=planetState(name,time), d=norm(sub(r,s.r));
    if(!best || d<best.distance) best={name, distance:d, speed:norm(sub(v,s.v))};
  }
  return best;
}

// Hyperbolisen ohitusradan asymptootti kulkee planeetan ohi etäisyydellä b = r_p·√(1 + 2μ/(r_p·v∞²)) (törmäysparametri).
function asymptoteOffset(body, vinf) {
  const {mu,periKm}=FLIGHT_BODIES[body], speed=norm(vinf);
  const b=periKm*Math.sqrt(1+2*mu/(periKm*speed*speed));
  let n=cross(vinf,[0,0,1]);
  if(norm(n)<1e-9) n=[1,0,0];
  return scale(n,b/norm(n));
}

/**
 * Aluksen paikka ohjaamonäkymää varten. Siirtorata kulkee planeettojen keskipisteiden kautta, joten lähellä
 * lähtö- ja kohdeplaneettaa paikkaa siirretään hyperbelin asymptootin etäisyydelle (törmäysparametri). Siirto
 * häivytetään vaikutuspiirin rajalla, jolloin kaukana näkymä vastaa siirtorataa. Ennen laukaisua alus on
 * lähtöplaneetan pysäköintiradalla.
 */
export function shipView(tr, time) {
  const t=Math.max(time,tr.depart), s=shipState(tr,t), arr=planetState(tr.to,t);
  const fade=(rel,body)=>Math.max(0,1-norm(rel)/FLIGHT_BODIES[body].soiKm);
  // Korjattu rata ei kulje kohteen keskipisteen kautta, joten asymptootin siirtoa käytetään vain alkuperäisellä radalla.
  const arrOff=tr.legs?.length>1 ? [0,0,0] : asymptoteOffset(tr.to,sub(shipState(tr,tr.arrive).v,planetState(tr.to,tr.arrive).v));
  let r=add(s.r,scale(arrOff,fade(sub(s.r,arr.r),tr.to)));
  // Alus ei koskaan näy kohdeplaneetan sisällä: lähempänä kuin pysäköintiradan perikeskus se siirretään sen etäisyydelle.
  const rel=sub(r,arr.r), dist=norm(rel), min=FLIGHT_BODIES[tr.to].periKm;
  if(dist<min) r=add(arr.r,dist>1 ? scale(rel,min/dist) : [min,0,0]);
  if(isPlanet(tr.from)) {
    const depOff=asymptoteOffset(tr.from,sub(tr.v1,planetState(tr.from,tr.depart).v));
    if(time<=tr.depart) return {r:add(planetState(tr.from,time).r,depOff), v:planetState(tr.from,time).v};
    r=add(r,scale(depOff,fade(sub(s.r,planetState(tr.from,t).r),tr.from)));
  } else if(time<=tr.depart) return departureState(tr.from,time);
  return {r, v:s.v};
}

/** Hetki (ms), jolloin alus poistuu lähtöplaneetan vaikutuspiiristä. */
export function soiExit(tr) {
  if(!isPlanet(tr.from)) return tr.depart;
  const soi=FLIGHT_BODIES[tr.from].soiKm;
  const gap=t=>norm(sub(shipState(tr,t).r,planetState(tr.from,t).r))-soi;
  let lo=tr.depart, hi=tr.arrive;
  if(gap(hi)<0) return hi;
  for(let i=0;i<60;i++) {const mid=(lo+hi)/2; if(gap(mid)<0) lo=mid; else hi=mid;}
  return hi;
}

/**
 * Aluksen paikka ja nopeus pysäköintiradalla planeetan ympärillä hetkellä time (ms). Rata on ekliptikan tasossa
 * ja alkaa perikeskuksesta J2000-hetkellä, joten se on aina sama.
 */
export function parkingState(body, time) {
  const {mu,periKm,apoKm}=FLIGHT_BODIES[body], a=(periKm+apoKm)/2;
  const vp=Math.sqrt(mu*(2/periKm-1/a));
  const rel=propagate([periKm,0,0],[0,vp,0],(time-Date.UTC(2000,0,1,12))/1000,mu), p=planetState(body,time);
  return {r:add(p.r,rel.r), v:add(p.v,rel.v), rel};
}

/** Siirtoradan pituus (km) ja huippunopeus Auringon suhteen (km/s) näytteistä. */
export function flightStats(tr, samples = 2000) {
  let km=0, max=0, prev=null;
  for(let i=0;i<=samples;i++) {
    const s=shipState(tr,tr.depart+(tr.arrive-tr.depart)*i/samples);
    if(prev) km+=norm(sub(s.r,prev));
    max=Math.max(max,norm(s.v)); prev=s.r;
  }
  return {km, maxSpeed:max};
}

// --- Kurssikorjaukset ---

/** Polton suunnat: eteen (radan suuntaan), taakse, Aurinkoa kohti (sisään) ja poispäin (ulos). */
export const BURN_DIRECTIONS = ['prograde','retrograde','inward','outward'];
export function burnVector(state, direction, dvKms) {
  const vh=scale(state.v,1/norm(state.v));
  // Säteittäinen suunta kohtisuoraan nopeutta vastaan.
  let out=sub(scale(state.r,1/norm(state.r)),scale(vh,dot(state.r,vh)/norm(state.r)));
  out=scale(out,1/norm(out));
  const dir={prograde:vh, retrograde:scale(vh,-1), outward:out, inward:scale(out,-1)}[direction];
  return scale(dir,dvKms);
}

/**
 * Kohtaaminen kohdeplaneetan kanssa hetkestä from alkaen: lähin ohitus (hetki, etäisyys km, suhteellinen nopeus km/s).
 * Etäisyys lasketaan näytteistä ja tarkennetaan kultaisen leikkauksen haulla.
 */
export function encounter(tr, from, until) {
  const d=t=>norm(sub(shipState(tr,t).r,planetState(tr.to,t).r));
  const N=800, span=until-from;
  let best=0, bestD=Infinity;
  for(let i=0;i<=N;i++) {const v=d(from+span*i/N); if(v<bestD) {bestD=v; best=i;}}
  let a=from+span*Math.max(0,best-1)/N, b=from+span*Math.min(N,best+1)/N;
  const g=(Math.sqrt(5)-1)/2;
  for(let i=0;i<80;i++) {
    const c=b-g*(b-a), e=a+g*(b-a);
    if(d(c)<d(e)) b=e; else a=c;
  }
  const t=(a+b)/2, s=shipState(tr,t), p=planetState(tr.to,t);
  return {t, distance:norm(sub(s.r,p.r)), vinf:norm(sub(s.v,p.v))};
}

/**
 * Lennon ennuste hetkestä from alkaen: osuuko alus kohteen vaikutuspiiriin, milloin se saapuu (lähin ohitus) ja
 * paljonko jarrutus maksaa. Palauttaa päivitetyn lennon (arrive, soi, miss, missKm, vinfArr, dvArr).
 */
export function predict(tr, from) {
  const until=Math.min(from+3*365.25*DAY_MS, Math.max(tr.planned ?? tr.arrive, from)+Math.max(60*DAY_MS, 0.6*((tr.planned ?? tr.arrive)-tr.depart)));
  const e=encounter(tr,from,until), soi=FLIGHT_BODIES[tr.to].soiKm;
  const next={...tr, planned:tr.planned ?? tr.arrive, arrive:e.t, missKm:e.distance, miss:e.distance>soi, vinfArr:e.vinf, dvArr:burnDv(tr.to,e.vinf)};
  next.soi=next.miss ? e.t : soiEntry(next);
  return next;
}

/** Poltto hetkellä time annettuun suuntaan: lennolle lisätään uusi osuus ja ennuste lasketaan uudelleen. */
export function applyBurn(tr, time, direction, dvKms) {
  const s=shipState(tr,time), legs=tr.legs ?? [{t:tr.depart, r:tr.r1, v:tr.v1}];
  const next={...tr, legs:[...legs.filter(l=>l.t<time), {t:time, r:s.r, v:add(s.v,burnVector(s,direction,dvKms))}]};
  return predict(next,time);
}

/**
 * Automaattinen kurssikorjaus: Lambertin rata nykyisestä paikasta kohteeseen alkuperäisellä saapumishetkellä
 * (tai vähintään 10 vrk päähän). Palauttaa korjatun lennon ja polton Δv:n tai null.
 */
export function autoCorrect(tr, time) {
  const s=shipState(tr,time), arrive=Math.max(tr.planned ?? tr.arrive, time+10*DAY_MS);
  const sol=lambert(s.r,planetState(tr.to,arrive).r,(arrive-time)/1000);
  if(!sol) return null;
  const dv=norm(sub(sol.v1,s.v)), legs=tr.legs ?? [{t:tr.depart, r:tr.r1, v:tr.v1}];
  const next=predict({...tr, legs:[...legs.filter(l=>l.t<time), {t:time, r:s.r, v:sol.v1}]},time);
  return {flight:next, dv};
}

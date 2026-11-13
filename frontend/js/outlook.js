// Lähituntien yhteenveto Nyt-näkymän yläreunaan: paras syy katsoa taivaalle seuraavan vuorokauden aikana.
// Puhdas laskenta ilman DOMia, jotta sen voi testata (worker/test/frontend.test.mjs).

const DAY = 86400000;
const PHRASES = {'Mahdollinen':'mahdollisia', 'Hyvä':'hyvä mahdollisuus', 'Erittäin hyvä':'erittäin hyvä mahdollisuus'};
const DIRECTIONS_IN = ['pohjoisessa','koillisessa','idässä','kaakossa','etelässä','lounaassa','lännessä','luoteessa'];
/** Pilvisyys (%), josta alkaen kohde tuskin näkyy (sama raja kuin kalenterin varoituksessa). */
const OVERCAST = 90;
/** Pilvisyys (%), josta alkaen kohde näkyy vain pilvien aukoista: syy on silloin heikompi. */
const CLOUDY = 70;

const passHeight = alt => alt<10 ? 'matalalla ' : alt>=30 ? 'korkealla ' : '';

/**
 * Syyt katsoa taivaalle tärkeysjärjestyksessä. Kukin syy: title (osat, joista strong korostetaan), tone ('good' tai 'mid'),
 * view (näkymä, josta lisää tietoa) ja short (lyhyt muoto ”Myös”-riville). hhmm muotoilee kellonajan.
 */
export function reasons({weather, iss, events, sun}, now, hhmm) {
  const end=now+DAY, list=[];
  const best=weather?.best_window;
  if(best && Date.parse(best.start)<end) {
    const strong=best.chance!=='Mahdollinen';
    const span=`klo ${hhmm(best.start)}–${hhmm(best.end)}`;
    list.push({score:strong ? 3 : 1, at:Date.parse(best.start), tone:strong ? 'good' : 'mid', view:'revontulet',
      title:[{text:'Revontulet: '},{text:PHRASES[best.chance] ?? best.chance.toLowerCase(), strong:true},{text:` ${span}`}],
      short:`revontulet ${PHRASES[best.chance] ?? best.chance.toLowerCase()} ${span}`});
  }
  const pass=iss?.passes.find(p=>p.visible_start && Date.parse(p.visible_end)>now && Date.parse(p.visible_start)<end);
  if(pass && !(pass.cloud_cover>=OVERCAST)) {
    const at=`klo ${hhmm(pass.visible_start)}`, where=`${passHeight(pass.max_alt)}${DIRECTIONS_IN[Math.round(pass.max_az/45)%8]}`;
    list.push({score:pass.cloud_cover>=CLOUDY ? 1 : 2, at:Date.parse(pass.visible_start), tone:'good', view:'iss',
      title:[{text:'ISS näkyy '},{text:at, strong:true},{text:` ${where}`}], short:`ISS näkyy ${at} ${where}`});
  }
  for(const e of events?.events ?? []) {
    const at=e.best_time && Date.parse(e.best_time);
    if(!e.visible || !at || at<now || at>=end || e.cloud_cover>=OVERCAST) continue;
    const clock=`klo ${hhmm(e.best_time)}`;
    list.push({score:e.cloud_cover>=CLOUDY ? 1 : 2, at, tone:'good', view:'kalenteri',
      title:[{text:`${e.title}: paras hetki `},{text:clock, strong:true}], short:`${e.title} ${clock}`});
  }
  // Maahan osuva CME seuraavan puolentoista vuorokauden aikana: revontulia voi olla odotettavissa, vaikka Kp on vielä matala.
  const cme=(sun?.cmes ?? []).find(c=>!c.glancing && Date.parse(c.arrival)>=now-12*3600000 && Date.parse(c.arrival)<now+1.5*DAY);
  if(cme) {
    const clock=`klo ${hhmm(cme.arrival)}`;
    list.push({score:2, at:Date.parse(cme.arrival), tone:'mid', view:'revontulet',
      title:[{text:'CME saapuu arviolta '},{text:clock, strong:true},{text:cme.kp_max==null ? '' : `, Kp jopa ${cme.kp_max}`}],
      short:`CME saapuu arviolta ${clock}`});
  }
  return list.sort((a,b)=>b.score-a.score || a.at-b.at);
}

/** Pimeiden tuntien pilvisyys: true, kun lähes kaikki tunnit, joilta ennuste on, ovat umpipilvisiä. */
export function overcastNight(weather) {
  const dark=(weather?.hourly ?? []).filter(h=>h.light!=='Valoisaa' && h.cloud_cover!=null);
  return dark.length>=3 && dark.filter(h=>h.cloud_cover>=OVERCAST).length>=dark.length*0.75;
}

/** Yhteenveto: pääsyy otsikoksi ja muut syyt lisärivinä. Ilman syitä otsikko kertoo, miksi ei kannata. */
export function outlook(data, now, hhmm) {
  const list=reasons(data, now, hhmm);
  if(list.length) {
    const [main, ...rest]=list;
    return {title:main.title, tone:main.tone, view:main.view, also:rest.map(r=>r.short)};
  }
  const title=overcastNight(data.weather)
    ? [{text:'Pilvistä '},{text:'koko yön', strong:true}]
    : [{text:'Ei revontulia eikä näkyviä ylilentoja '},{text:'seuraavan vuorokauden aikana', strong:true}];
  return {title, tone:'off', view:'revontulet', also:[]};
}

// Planeettojen tietokortit Avaruuslentoon: perustiedot ja muutama kiinnostava fakta. Lähteet: NASA Planetary Fact
// Sheet (koko, massa, painovoima, päivän ja vuoden pituus, lämpötila) ja NASA/JPL:n kuuluettelot (tilanne 2025).
// Kuiden määrä kasvaa, kun uusia löydetään.
export const PLANET_INFO = {
  Merkurius: {
    diameter: '4 879 km', mass: '0,055 × Maa', gravity: '3,7 m/s² (0,38 g)', day: '176 vrk (pyörähdys 58,6 vrk)', year: '88 vrk',
    temperature: '−180…+430 °C', atmosphere: 'Lähes olematon: ohut eksosfääri (happea, natriumia, vetyä, heliumia)', moons: 'ei kuita',
    facts: [
      'Yksi aurinkovuorokausi kestää kaksi Merkuriuksen vuotta.',
      'Napa-alueiden kraattereissa on vesijäätä, jota Auringon valo ei koskaan tavoita.',
      'Pienin planeetta, vain vähän suurempi kuin Kuu.',
    ],
  },
  Venus: {
    diameter: '12 104 km', mass: '0,815 × Maa', gravity: '8,87 m/s² (0,90 g)', day: '117 vrk (pyörähdys 243 vrk takaperin)', year: '225 vrk',
    temperature: 'noin +464 °C', atmosphere: '96,5 % hiilidioksidia, paine 92 kertaa Maan, rikkihappopilviä', moons: 'ei kuita',
    facts: [
      'Kuumin planeetta, vaikka Merkurius on lähempänä Aurinkoa: paksu kaasukehä pidättää lämmön.',
      'Venus pyörii takaperin, joten siellä Aurinko nousee lännestä.',
      'Neuvostoliiton Venera 7 laskeutui Venukseen vuonna 1970 ensimmäisenä luotaimena toisen planeetan pinnalle.',
    ],
  },
  Maa: {
    diameter: '12 742 km', mass: '5,97 × 10²⁴ kg', gravity: '9,81 m/s² (1 g)', day: '24 h (pyörähdys 23 h 56 min)', year: '365,25 vrk',
    temperature: 'keskimäärin +15 °C (−89…+57 °C)', atmosphere: '78 % typpeä, 21 % happea', moons: '1 kuu',
    facts: [
      'Ainoa tunnettu planeetta, jolla on elämää ja nestemäistä vettä pinnalla.',
      'Aurinkokunnan tihein planeetta (5,5 g/cm³).',
      'Magneettikenttä suojaa aurinkotuulelta, ja sen hiukkaset synnyttävät revontulet.',
    ],
  },
  Mars: {
    diameter: '6 779 km', mass: '0,107 × Maa', gravity: '3,72 m/s² (0,38 g)', day: '24 h 40 min', year: '687 vrk',
    temperature: 'keskimäärin −63 °C (−140…+20 °C)', atmosphere: '95 % hiilidioksidia, paine alle 1 % Maan paineesta', moons: '2 kuuta: Phobos ja Deimos',
    facts: [
      'Olympus Mons on noin 22 km korkea, aurinkokunnan korkein tulivuori.',
      'Valles Marineris -kanjonijärjestelmä on yli 4 000 km pitkä.',
      'Punainen väri tulee pinnan rautaoksidista eli ruosteesta.',
    ],
  },
  Jupiter: {
    diameter: '139 820 km', mass: '318 × Maa', gravity: '24,8 m/s² (2,5 g) pilvien tasolla', day: '9 h 56 min', year: '11,9 vuotta',
    temperature: 'noin −110 °C pilvien yläpinnalla', atmosphere: 'noin 90 % vetyä ja 10 % heliumia', moons: 'yli 90 kuuta',
    facts: [
      'Massa on kaksi ja puoli kertaa kaikkien muiden planeettojen yhteenlaskettu massa.',
      'Suuri punainen pilkku on Maata suurempi myrsky, jota on seurattu 1830-luvulta asti.',
      'Io on aurinkokunnan tuliperäisin kappale, ja Europan jääkuoren alla on valtameri.',
    ],
  },
  Saturnus: {
    diameter: '116 460 km', mass: '95 × Maa', gravity: '10,4 m/s² (1,07 g) pilvien tasolla', day: '10 h 34 min', year: '29,5 vuotta',
    temperature: 'noin −140 °C pilvien yläpinnalla', atmosphere: 'noin 96 % vetyä ja 3 % heliumia', moons: 'yli 270 kuuta',
    facts: [
      'Saturnuksen keskitiheys on pienempi kuin veden.',
      'Renkaat ovat lähes puhdasta vesijäätä. Niiden läpimitta on noin 280 000 km, mutta paksuus usein vain kymmeniä metrejä.',
      'Suurimmalla kuulla Titanilla on paksu kaasukehä sekä metaani- ja etaanijärviä.',
    ],
  },
  Uranus: {
    diameter: '50 724 km', mass: '14,5 × Maa', gravity: '8,7 m/s² (0,89 g) pilvien tasolla', day: '17 h 14 min (takaperin)', year: '84 vuotta',
    temperature: 'noin −195 °C', atmosphere: 'vetyä, heliumia ja metaania, joka antaa sinivihreän värin', moons: '29 kuuta',
    facts: [
      'Pyörimisakseli on kallistunut 98°, joten Uranus kiertää Aurinkoa kyljellään.',
      'Navoilla vuorottelevat 42 vuoden päivä ja 42 vuoden yö.',
      'Ainoa vierailija on ollut Voyager 2 vuonna 1986.',
    ],
  },
  Neptunus: {
    diameter: '49 244 km', mass: '17,1 × Maa', gravity: '11,2 m/s² (1,14 g) pilvien tasolla', day: '16 h 6 min', year: '165 vuotta',
    temperature: 'noin −200 °C', atmosphere: 'vetyä, heliumia ja metaania', moons: '16 kuuta',
    facts: [
      'Neptunus löydettiin vuonna 1846 laskemalla, missä Uranuksen ratahäiriöt aiheuttava planeetta on.',
      'Aurinkokunnan kovimmat tuulet, jopa 2 000 km/h.',
      'Suurin kuu Triton kiertää takaperin ja on luultavasti Neptunuksen kaappaama Kuiperin vyöhykkeen kappale.',
    ],
  },
};

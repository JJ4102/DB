/* Smoke-Test: lädt index.html in jsdom, stubbt Chart.js + fetch und prüft
   Zeitraum-Auswahl, Y-Achsen-Schritte (10k/10M + Fallback), X-Tick-Dichte,
   die Färbung der Wertentwicklung (Max: Lage zu „Investiert", Zoom: Lage zum Startwert),
   die Scrub-Mechanik (Einrasten, Grundzustand, Vor/Nach-Färbung), den Schalter für Käufe und
   Ø Kaufkurs im Kurs-Diagramm, die Ansichtswahl der schwebenden Leiste, das Formular und den Hinweis-Dialog.
   Aufruf: node smoke-test.js [pfad/zu/index.html]   (benötigt: npm i jsdom) */
const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync(process.argv[2] || "index.html", "utf8");
const dom = new JSDOM(html.replace(/<script src=[^>]+><\/script>/g, ""), {
  runScripts: "outside-only", url: "https://example.test/"
});
const w = dom.window;

/* ── Stubs ── */
w.matchMedia = () => ({ matches: false, addEventListener() {} });
const CSSVARS = { "--ch-after": "AFTER", "--pos": "POS", "--neg": "NEG", "--ch-gray": "GRAY" };
w.getComputedStyle = () => ({ getPropertyValue: n => CSSVARS[n] || "" });
w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 0);
w.cancelAnimationFrame = id => clearTimeout(id);

const today = Date.UTC(2026, 6, 18) / 1000;
const candles = [];
for (let i = 1150; i >= 0; i--) {
  candles.push([today - i * 86400, 0, 0, 0, 30000 + 60000 * Math.abs(Math.sin(i / 90)), 0]);
}
w.fetch = async url => ({
  ok: true, status: 200,
  json: async () => {
    if (String(url).includes("candles")) {
      const u = new URL(url); // start/end filtern wie die echte API
      const s = Date.parse(u.searchParams.get("start")) / 1000;
      const e = Date.parse(u.searchParams.get("end")) / 1000;
      return candles.filter(c => c[0] >= s && c[0] <= e);
    }
    return { price: "58000", data: { amount: "58000" } };
  }
});

class ChartStub {
  constructor(canvas, config) {
    this.canvas = canvas; this.config = config; this.id = canvas && canvas.id;
    this.width = 350;
    ChartStub.instances.push(this);
  }
  destroy() {}
  update() {}
  draw() {}
  resize() {}
}
ChartStub.instances = [];
ChartStub.defaults = { font: {} };
ChartStub.getChart = () => null;
w.Chart = ChartStub;

/* Bewegungen: Käufe 2023–2025; „TV" kauft am Kurshoch und liegt danach unter „Investiert" */
const movs = [
  { id: "a", person: "YP", date: "2023-06-06", typ: "kauf", sats: 10000000, eur: 2500, mod: 1, del: 0 },
  { id: "b", person: "YP", date: "2024-03-01", typ: "kauf", sats: 20000000, eur: 8000, mod: 1, del: 0 },
  { id: "c", person: "YP", date: "2025-01-15", typ: "kauf", sats: 29000000, eur: 9000, mod: 1, del: 0 },
  { id: "v", person: "TV", date: "2026-02-01", typ: "kauf", sats: 1000000, eur: 2000, mod: 1, del: 0 }
];
w.localStorage.setItem("btc-dash-store-v3", JSON.stringify({ schema: 3, updatedAt: 1, movements: movs }));

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
w.eval(scripts.map(s => s.replace(/"use strict";/, "")).join("\n;\n"));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const el = id => w.document.getElementById(id);
const click = node => node.dispatchEvent(new w.Event("click", { bubbles: true }));
let failed = 0;
const check = (name, cond, extra) => {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failed = 1;
};

(async () => {
  await sleep(600); /* Start-IIFE (loadHistory etc.) durchlaufen lassen */

  check("Content sichtbar", !el("content").hidden && el("skeleton").hidden);
  check("3 Charts gebaut", ChartStub.instances.length === 3, "n=" + ChartStub.instances.length);

  const by = id => ChartStub.instances.filter(c => c.id === id).pop();
  const wert = by("chartWert"), sats = by("chartSats"), preis = by("chartPreis");

  /* Kennzahlen */
  check("Portfoliowert = 0,59 BTC × 58.000 €", el("k-wert").textContent === "34.220,00 €", el("k-wert").textContent);
  check("Kompakter Leisten-Titel trägt den Wert", el("nav-value").textContent === "34.220,00 €", el("nav-value").textContent);
  check("Investiert-Summe", el("k-inv").textContent === "19.500,00 €", el("k-inv").textContent);
  check("G/V mit Vorzeichen und Farbe", /^\+/.test(el("k-pnl").textContent) && el("k-pnl").className === "pos", el("k-pnl").textContent);
  check("Allzeithoch gefüllt", /€/.test(el("k-ath").textContent) && el("k-ath-date").textContent.length > 0);
  check("Avatar mit Initialen", el("person-avatar").textContent === "YP");

  /* Y-Achse: Grenzen auf Schritt-Vielfache gerundet */
  for (const [name, ch, step] of [["Wert", wert, 10000], ["Sats", sats, 1e7], ["Preis", preis, 10000]]) {
    const y = ch.config.options.scales.y, s = y.ticks.stepSize, n = (y.max - y.min) / s;
    check(name + ": Y-Step = fester Schritt (Max)", s === step, "step=" + s);
    check(name + ": Y-Grenzen sind Vielfache", y.min % s === 0 && y.max % s === 0, y.min + ".." + y.max);
    check(name + ": 2–7 Ticks", n >= 2 && n <= 7, "ticks=" + n);
  }

  /* X-Achse: Anzahl sichtbarer Labels bei 350px Breite */
  const visibleTicks = ch => {
    const cb = ch.config.options.scales.x.ticks.callback;
    const out = [];
    for (let i = 0; i < ch.config.data.labels.length; i++) {
      const t = cb.call({ chart: { width: 350 } }, i, i);
      if (t) out.push(t);
    }
    return out;
  };
  for (const [name, ch] of [["Wert", wert], ["Sats", sats], ["Preis", preis]]) {
    const t = visibleTicks(ch);
    check(name + ": max. 4 X-Labels bei 350px", t.length >= 2 && t.length <= 4, t.join(" | "));
  }

  /* Schalter im Kurs-Diagramm: Käufe und Ø Kaufkurs ein-/ausblenden (Zeitraum Max) */
  const tog = el("buys-toggle");
  const kaufPunkte = ch => ch.config.data.datasets[2].data.filter(x => x != null).length;
  const avgPunkte = ch => ch.config.data.datasets[1].data.filter(x => x != null).length;
  check("Schalter: in der Kopfzeile des Kurs-Diagramms, als Switch mit Beschreibung",
    tog.parentElement === el("scrub-preis").parentElement && tog.getAttribute("role") === "switch" && !!tog.getAttribute("aria-label"));
  check("Schalter: standardmäßig aus – keine Kaufpunkte, kein Ø Kaufkurs, kein Einrasten", tog.getAttribute("aria-checked") === "false" &&
    kaufPunkte(preis) === 0 && avgPunkte(preis) === 0 && preis.$scrub.cfg.snap.length === 0);
  check("Schalter aus: Legende nennt Kurs und Startkurs statt der Käufe", el("legend-buys").hidden && el("legend-avg").hidden &&
    !el("legend-kurs").hidden && !el("legend-start").hidden);
  check("Schalter aus: Kopfzeile zweizeilig", el("scrub-preis").children.length === 2 && /Gesamt/.test(el("scrub-preis").textContent));
  click(tog);
  await sleep(50);
  const preisAn = by("chartPreis");
  check("Schalter an: Käufe und Ø Kaufkurs sichtbar, Scrub rastet ein", tog.getAttribute("aria-checked") === "true" &&
    kaufPunkte(preisAn) === 3 && avgPunkte(preisAn) > 0 && preisAn.$scrub.cfg.snap.length === 3 &&
    !el("legend-buys").hidden && !el("legend-avg").hidden && el("legend-start").hidden);
  check("Schalter an: Kurslinie und Zeitraum bleiben", preisAn.config.data.datasets[0].data.length === preis.config.data.datasets[0].data.length);
  check("Schalter an: Wahl gespeichert", w.localStorage.getItem("btc-dash-buys-v1") === "1");
  check("Schalter an: andere Diagramme unberührt", by("chartWert").config.data.datasets.length === 2 && by("chartSats").config.data.datasets.length === 1);
  click(tog);
  await sleep(50);
  check("Schalter wieder aus: Käufe und Ø Kaufkurs weg", tog.getAttribute("aria-checked") === "false" && kaufPunkte(by("chartPreis")) === 0 &&
    avgPunkte(by("chartPreis")) === 0 && el("legend-buys").hidden && w.localStorage.getItem("btc-dash-buys-v1") === "0");

  /* Kurs-Diagramm: Live-Kurs in der Kopfzeile, Änderung dezent daneben; Farbe und Fläche wie bei der Wertentwicklung */
  const headK = el("scrub-preis");
  check("Kurs: Kopfzeile nennt den Live-Kurs", headK.querySelector(".scrub-value").textContent === "58.000,00 €" &&
    /Live-Kurs/.test(headK.querySelector(".scrub-cap").textContent), headK.textContent);
  check("Kurs: Änderung im Zeitraum als Nebenangabe mit Vorzeichen", /^[+-][\d.,]+ %$/.test(headK.querySelector(".scrub-delta").textContent) &&
    !/pos|neg/.test(headK.querySelector(".scrub-value").className), headK.querySelector(".scrub-delta").textContent);
  const kD = preis.config.data.datasets[0].data, kB = preis.$scrub.cfg.between;
  check("Kurs: Fläche zwischen Kurs und Startkurs statt Füllung bis unten", (preis.config.plugins || []).some(p => p.id === "between") &&
    !preis.config.data.datasets[0].fill && kB.stepped === false && kB.ref.every(x => x === kD[0]) && preis.$scrub.cfg.base === kD[0]);
  check("Kurs: Linienfarbe folgt der Lage zum Startkurs (grün darüber, rot darunter)", kD.every((x, i) =>
    preis.$scrub.cfg.colorAt(i) === (x >= kD[0] ? "POS" : "NEG")) && new Set(kD.map((_, i) => preis.$scrub.cfg.colorAt(i))).size === 2);

  /* Zeitraum-Auswahl (Segmented Control) */
  const seg = w.document.querySelector('.seg[data-chart="preis"]');
  check("Zeitraum: 5 Segmente, Max aktiv", seg.querySelectorAll("button").length === 5 && seg.querySelector(".sel").dataset.range === "max");
  click(seg.querySelector('button[data-range="1m"]'));
  await sleep(50);
  const preis1m = by("chartPreis");
  const lb = preis1m.config.data.labels;
  check("Preis 1M: ~30 Tage Daten", lb.length >= 28 && lb.length <= 33, "punkte=" + lb.length);
  const y1m = preis1m.config.options.scales.y, n1m = (y1m.max - y1m.min) / y1m.ticks.stepSize;
  check("Preis 1M: feinerer Y-Step greift", y1m.ticks.stepSize <= 10000 && n1m >= 2 && n1m <= 7,
    "step=" + y1m.ticks.stepSize + " min=" + y1m.min + " max=" + y1m.max);
  const t1m = visibleTicks(preis1m);
  check("Preis 1M: Tages-Labels (z. B. „19. Juni“)", /\d{1,2}\./.test(t1m[0] || ""), t1m.join(" | "));
  check("Preis 1M: Segment markiert", seg.querySelector(".sel").dataset.range === "1m");
  check("Preis 1M: Kopfzeile nennt Zeitraum", /30 Tage/.test(el("scrub-preis").textContent), el("scrub-preis").textContent);
  check("Andere Charts unverändert auf Max", by("chartWert").config.data.labels.length > 100);

  /* Wertentwicklung: Linie, Marker und Fläche folgen der Lage zur Bezugslinie (grün darüber, rot darunter) –
     bei Max ist das „Investiert", im Zoom der Startwert; die Kopfzeile nennt das Ergebnis des Zeitraums */
  const lageOk = ch => {
    const b = ch.$scrub.cfg.between, d = ch.config.data.datasets[0].data, sc = ch.config.data.datasets[0].segment.borderColor;
    return d.every((x, i) => {
      const j = i === 0 && !x && !b.ref[0] ? 1 : i; /* Nullpunkt vor dem ersten Kauf: Farbe des ersten echten Punkts */
      const want = d[j] >= b.ref[j] ? "POS" : "NEG";
      return ch.$scrub.cfg.colorAt(i) === want && (i === 0 || sc({ p0DataIndex: i - 1, p1DataIndex: i }) === want);
    });
  };
  const farben = ch => new Set(ch.config.data.labels.map((_, i) => ch.$scrub.cfg.colorAt(i)));
  check("Wert Max: Fläche zwischen den Linien statt Füllung bis unten",
    (wert.config.plugins || []).some(p => p.id === "between") && !wert.config.data.datasets[0].fill);
  check("Wert Max: Bezugslinie = Investiert (Stufen), deckt alle Punkte ab", wert.$scrub.cfg.between.stepped === true &&
    wert.$scrub.cfg.between.ref.length === wert.config.data.labels.length && wert.$scrub.cfg.between.ref.slice(-1)[0] === 19500);
  check("Wert Max: Investiert-Linie und Legende vorhanden", wert.config.data.datasets.length === 2 && !el("legend-inv-wrap").hidden && el("legend-base").hidden);
  check("Wert Max: Linienfarbe folgt der Lage zu Investiert", lageOk(wert));
  check("Wert Max: grüne und rote Abschnitte (Testkurs endet unter Investiert)", farben(wert).has("POS") && farben(wert).has("NEG"));
  check("Wert Max: keine Startwert-Linie", wert.$scrub.cfg.base == null && wert.$scrub.cfg.baseSteps == null);
  check("Wert Max: beginnt einen Tag vor dem ersten Kauf bei 0", wert.config.data.datasets[0].data[0] === 0 && wert.$scrub.cfg.between.ref[0] === 0 &&
    wert.config.data.labels[0] === Date.UTC(2023, 5, 5) && wert.config.data.datasets[0].data[1] > 0 && wert.config.options.scales.y.min === 0,
    new Date(wert.config.data.labels[0]).toISOString().slice(0, 10));
  const gMax = wert.config.data.datasets[0].data.slice(-1)[0] - 19500;
  check("Wert Max: Kopfzeile = Wert minus Investiert", el("scrub-wert").querySelector(".scrub-value").textContent ===
    (gMax >= 0 ? "+" : "") + gMax.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €", el("scrub-wert").textContent);
  check("Stack: Füllung bis unten bleibt", sats.config.data.datasets[0].fill === "start" && !(sats.config.plugins || []).some(p => p.id === "between"));
  const segW = w.document.querySelector('.seg[data-chart="wert"]');
  click(segW.querySelector('button[data-range="1m"]'));
  await sleep(50);
  const wert1m = by("chartWert"), d1m = wert1m.config.data.datasets[0].data;
  const headW = el("scrub-wert").querySelector(".scrub-value");
  check("Wert 1M: Verlust in der Kopfzeile", /^-/.test(headW.textContent) && headW.classList.contains("neg"), el("scrub-wert").textContent);
  check("Wert 1M: Kopfzeile mit Prozent", /-[\d.,]+ %/.test(el("scrub-wert").textContent), el("scrub-wert").textContent);
  check("Wert 1M: Investiert-Linie entfällt", wert1m.config.data.datasets.length === 1 && el("legend-inv-wrap").hidden);
  check("Wert 1M: Bezugslinie = Startwert, gerade", wert1m.$scrub.cfg.between.stepped === false &&
    wert1m.$scrub.cfg.between.ref.every(x => x === d1m[0]) && wert1m.$scrub.cfg.base === d1m[0]);
  check("Wert 1M: Legende nennt den Startwert", !el("legend-base").hidden && /€/.test(el("legend-base-val").textContent), el("legend-base-val").textContent);
  check("Wert 1M: Farbe wechselt beim Kreuzen des Startwerts", lageOk(wert1m) && wert1m.$scrub.cfg.colorAt(0) === "POS" &&
    wert1m.$scrub.cfg.colorAt(d1m.length - 1) === "NEG");
  check("Wert 1M: Legenden-Punkt folgt dem letzten Punkt (rot)", /--neg/.test(el("legend-wert-dot").getAttribute("style")), el("legend-wert-dot").getAttribute("style"));
  const yW1 = wert1m.config.options.scales.y;
  const tickW = yW1.ticks, lblW = [];
  for (let x = yW1.min; x <= yW1.max; x += tickW.stepSize) lblW.push(tickW.callback(x));
  check("Wert 1M: Y-Beschriftungen wiederholen sich nicht", new Set(lblW).size === lblW.length, lblW.join(" | "));
  check("Wert 1M ohne Käufe: Legende „Startwert“, keine Stufen", el("legend-base-name").textContent === "Startwert" && wert1m.$scrub.cfg.baseSteps == null);

  /* Zoom mit Käufen im Zeitraum (6M, Person TV kauft am 01.02.26): die Bezugslinie steigt mit dem Kauf –
     Kopfzeile, Linienfarbe und Fläche messen dasselbe (Ergebnis ohne Einzahlungen) */
  const pselZ = el("person-select");
  pselZ.value = "TV";
  pselZ.dispatchEvent(new w.Event("change", { bubbles: true }));
  click(segW.querySelector('button[data-range="6m"]'));
  await sleep(50);
  const wertZ = by("chartWert"), bZ = wertZ.$scrub.cfg.between, dZ = wertZ.config.data.datasets[0].data, nZ = dZ.length;
  check("Wert Zoom mit Kauf: Bezugslinie = Startwert + Käufe, als Stufen", bZ.stepped === true && bZ.ref[0] === dZ[0] &&
    bZ.ref[nZ - 1] === dZ[0] + 2000 && wertZ.$scrub.cfg.baseSteps === bZ.ref && wertZ.$scrub.cfg.base == null, bZ.ref[0] + " → " + bZ.ref[nZ - 1]);
  check("Wert Zoom mit Kauf: Legende „Startwert + Käufe“ mit aktuellem Stand", el("legend-base-name").textContent === "Startwert + Käufe" &&
    el("legend-base-val").textContent === "2.000,00 €", el("legend-base").textContent);
  check("Wert Zoom mit Kauf: Vorzeichen der Kopfzeile passt zur Farbe am Ende", lageOk(wertZ) &&
    /^-/.test(el("scrub-wert").textContent) === (wertZ.$scrub.cfg.colorAt(nZ - 1) === "NEG"), el("scrub-wert").textContent);
  check("Wert Zoom mit Kauf: Achse umfasst die Bezugslinie", wertZ.config.options.scales.y.max >= bZ.ref[nZ - 1]);
  click(segW.querySelector('button[data-range="max"]'));
  pselZ.value = "YP";
  pselZ.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(50);

  /* Person mit Wert unter „Investiert": rot, Legende und Marker ziehen mit */
  const psel = el("person-select");
  psel.value = "TV";
  psel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(50);
  const wertTV = by("chartWert"), fTV = farben(wertTV), nTV = wertTV.config.data.labels.length;
  check("Wert durchgehend unter Investiert: Linie nur rot", lageOk(wertTV) && fTV.has("NEG") && fTV.size === 1, [...fTV].join(","));
  check("Wert unter Investiert: Marker am letzten Punkt rot", wertTV.$scrub.cfg.colorAt(nTV - 1) === "NEG");
  check("Wert unter Investiert: Legenden-Punkt rot", /--neg/.test(el("legend-wert-dot").getAttribute("style")), el("legend-wert-dot").getAttribute("style"));
  psel.value = "YP";
  psel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(50);

  /* Stack: eigene Legende, damit Kurs- und Stack-Karte gleich aufgebaut sind */
  check("Stack: Legende vorhanden", !!el("chartSats").closest(".chart").querySelector(".legend"));
  check("Stack: „1 BTC“ in der Legende nur bei sichtbarer Linie", el("legend-1btc").hidden === !(sats.config.options.scales.y.max >= 1e8));

  /* Sats-Chart 1W: Fallback-Schritte */
  click(w.document.querySelector('.seg[data-chart="sats"] button[data-range="1w"]'));
  await sleep(50);
  const yS = by("chartSats").config.options.scales.y, nS = (yS.max - yS.min) / yS.ticks.stepSize;
  check("Sats 1W: sinnvolle Tick-Anzahl", nS >= 2 && nS <= 7, "step=" + yS.ticks.stepSize + " n=" + nS);

  /* Scrubbing */
  const wertC = by("chartWert");
  for (const id of ["scrub-wert", "scrub-preis", "scrub-sats"]) {
    check("Kopfzeile " + id + " im Grundzustand gefüllt", /scrub-value/.test(el(id).innerHTML), el(id).textContent);
    check("Kopfzeile " + id + ": zwei feste Zeilen (kein Springen)", el(id).children.length === 2 &&
      el(id).children[0].className === "scrub-top" && el(id).children[1].className === "scrub-cap");
  }
  check("Chart hat Beschreibung für VoiceOver", /Wertentwicklung: /.test(el("chartWert").getAttribute("aria-label") || ""));
  check("Scrub-State am Chart, inaktiv", wertC.$scrub && wertC.$scrub.i === -1);
  check("Scrub-Plugins registriert", ["scrub", "baseline"].every(id => (wertC.config.plugins || []).some(p => p.id === id)));
  check("Startwert-Linie im Kurs-Chart konfiguriert", isFinite(by("chartPreis").$scrub.cfg.base));

  /* Maus-Scrub in die Chartmitte simulieren */
  const nW = wertC.config.data.labels.length;
  wertC.chartArea = { left: 0, right: 350, top: 0, bottom: 300 };
  wertC.scales = { x: { getValueForPixel: px => px / 350 * (nW - 1) } };
  const cv = el("chartWert");
  cv.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const defaultHtml = el("scrub-wert").innerHTML;
  const mv = new w.Event("pointermove"); mv.pointerType = "mouse"; mv.clientX = 175;
  cv.dispatchEvent(mv);
  check("Scrub rastet auf mittleren Datenpunkt ein",
    Math.abs(wertC.$scrub.i - Math.round((nW - 1) / 2)) <= 1, "i=" + wertC.$scrub.i + "/" + (nW - 1));
  check("Kopfzeile zeigt aktiven Punkt", el("scrub-wert").innerHTML !== defaultHtml, el("scrub-wert").textContent);
  check("Kopfzeile bleibt beim Scrubben zweizeilig", el("scrub-wert").children.length === 2);

  /* Vor/Nach-Färbung relativ zum Marker */
  const segCb = wertC.config.data.datasets[0].segment.borderColor;
  const mid = wertC.$scrub.i;
  check("Segment nach Marker blass", segCb({ p0DataIndex: mid + 1, p1DataIndex: mid + 2 }) === "AFTER");
  check("Segment vor Marker farbig", ["POS", "NEG"].includes(segCb({ p0DataIndex: 0, p1DataIndex: 1 })));

  const lv = new w.Event("pointerleave"); lv.pointerType = "mouse";
  cv.dispatchEvent(lv);
  check("Loslassen → Grundzustand", wertC.$scrub.i === -1 && el("scrub-wert").innerHTML === defaultHtml);

  /* Aufbau */
  check("Hero (Portfoliowert) vorhanden", !!w.document.querySelector(".hero .hero-value"));
  check("Kopf zeigt den Bestand statt des Titels „Bitcoin“", /₿ 0,59000000$/.test(w.document.querySelector(".hero h1").textContent.trim()),
    w.document.querySelector(".hero h1").textContent);
  check("Plus-Button in der Leiste, mit SVG", !!w.document.querySelector("header #fab svg path"));
  check("Theme-Button in der Toolbar", !!w.document.querySelector("header #theme-toggle svg"));
  check("Sync-Status in der Leiste", !!w.document.querySelector("header #sync-dot") && el("sync-text").textContent === "Lokal");
  check("Theme gesetzt", ["light", "dark"].includes(w.document.documentElement.dataset.theme));

  /* Schwebende Leiste: fünf Ansichten, genau eine aktiv, nur Symbole mit Beschreibung */
  const tabs = [...el("tabbar").querySelectorAll("button")], blocks = [...w.document.querySelectorAll(".block")];
  const aktiv = () => blocks.filter(b => b.classList.contains("active")).map(b => b.dataset.view).join(",");
  check("Leiste: 5 Tasten für 5 Abschnitte", tabs.length === 5 && blocks.length === 5 &&
    tabs.every(t => blocks.some(b => b.dataset.view === t.dataset.view)));
  check("Leiste: ohne Text, aber mit aria-label", tabs.every(t => t.getAttribute("aria-label") && !t.textContent.replace("₿", "").trim()));
  check("Leiste: Start mit Wertentwicklung", aktiv() === "wert" && el("tabbar").querySelector(".sel").dataset.view === "wert");
  for (const t of tabs) {
    click(t);
    check("Leiste: „" + t.getAttribute("aria-label") + "“ zeigt genau diesen Abschnitt",
      aktiv() === t.dataset.view && t.classList.contains("sel") && t.getAttribute("aria-pressed") === "true" &&
      el("tabbar").querySelectorAll(".sel").length === 1);
  }
  click(tabs[0]);

  /* „Daten" liegt im Menü */
  check("Daten: kein eigener Abschnitt mehr", !el("backup-btn") && !/Daten/.test([...w.document.querySelectorAll(".sec")].map(s => s.textContent).join("|")));
  check("Daten: Backup und Import im Einstellungen-Sheet", !!el("set-sheet").querySelector("#s-backup") &&
    !!el("set-sheet").querySelector("#import-btn") && !!el("set-sheet").querySelector("#import-input"));

  /* Formular: öffnen, Typ wechseln, Kauf speichern (Sats aus Kurs, zweistufig) */
  click(el("fab"));
  check("Formular-Sheet offen", el("form-sheet").classList.contains("open"));
  check("Speichern sitzt im Sheet-Kopf", !!el("form-sheet").querySelector(".sheet-head #f-save"));
  click(w.document.querySelector('#typ-seg [data-typ="transfer"]'));
  check("Transfer: Richtung sichtbar, Euro-Zeile versteckt", !el("dir-seg").hidden && el("f-eur").parentElement.hidden);
  click(w.document.querySelector('#typ-seg [data-typ="kauf"]'));
  check("Kauf: Euro-Zeile sichtbar", !el("f-eur").parentElement.hidden && el("dir-seg").hidden);
  el("f-date").value = "2026-07-01";
  el("f-eur").value = "100";
  click(el("f-save"));
  check("Kauf: Sats aus Kurs vorgeschlagen", Number(el("f-sats").value) > 0 && el("form-sheet").classList.contains("open"), el("f-msg").textContent);
  click(el("f-save"));
  await sleep(50);
  check("Kauf gespeichert, Sheet zu", !el("form-sheet").classList.contains("open") && el("k-inv").textContent === "19.600,00 €", el("k-inv").textContent);
  check("Liste zeigt 4 Bewegungen", el("tx-body").querySelectorAll("tr").length === 4 && el("tx-count").textContent === "4");
  check("Neueste Bewegung oben, mit Vorzeichen", /^Kauf01\.07\.26/.test(el("tx-body").querySelector("tr").textContent) &&
    /\+[\d.]+ Sats100,00 €/.test(el("tx-body").querySelector("tr").textContent), el("tx-body").querySelector("tr").textContent);
  check("„Alle anzeigen“ bei ≤ 5 Bewegungen versteckt", el("tx-more").hidden);

  /* Bearbeiten + Hinweis-Dialog (Löschen abbrechen, dann bestätigen) */
  click(el("tx-body").querySelector("tr"));
  check("Bearbeiten: Löschen-Zeile sichtbar", el("form-sheet").classList.contains("open") && !el("f-delete-group").hidden);
  click(el("f-delete"));
  check("Löschen fragt per Hinweis-Dialog nach", el("alert").classList.contains("open") && el("alert-ok").classList.contains("danger"));
  const esc = () => { const e = new w.Event("keydown"); e.key = "Escape"; w.document.dispatchEvent(e); };
  esc();
  await sleep(20);
  check("Escape schließt nur den Dialog", !el("alert").classList.contains("open") && el("form-sheet").classList.contains("open") &&
    el("tx-count").textContent === "4");
  click(el("f-delete"));
  click(el("alert-ok"));
  await sleep(20);
  check("Bestätigt: Bewegung gelöscht, Sheet zu", !el("form-sheet").classList.contains("open") && el("tx-count").textContent === "3" &&
    el("k-inv").textContent === "19.500,00 €", el("tx-count").textContent);

  /* Einstellungen + Escape */
  click(el("settings-btn"));
  check("Einstellungen offen", el("set-sheet").classList.contains("open"));
  esc();
  check("Escape schließt Sheets", !el("set-sheet").classList.contains("open"));

  process.exit(failed);
})().catch(e => { console.error("FEHLER:", e); process.exit(1); });

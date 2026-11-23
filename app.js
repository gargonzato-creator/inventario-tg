// Inventario TG — conteos a ciegas y usos internos. No escribe en Bims.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, addDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAOFcpSMEp2hsP9FWcc7f_zhyiH4Sm6G2Y",
  authDomain: "tg-apps-bbde7.firebaseapp.com",
  projectId: "tg-apps-bbde7",
  storageBucket: "tg-apps-bbde7.firebasestorage.app",
  messagingSenderId: "1058376237664",
  appId: "1:1058376237664:web:b3d63e5d6de5c759b57905"
};

export const APP_VERSION = "v5 (23/11)";
const USUARIOS = ["Felix", "Tatiana", "Elías", "Junior", "Belén"];
const DEPOSITOS = [
  { id: "agro", nombre: "Almacén agropecuario", centro: "Almacén Agropecuario" },
  { id: "carnes", nombre: "Almacén De Carnes Itacurubi", centro: "Almacén de Carnes" },
  { id: "itakua", nombre: "Deposito Itakua", centro: "Cabaña Ita Kua" },
];
// Depósito de práctica, solo con ?prueba en la URL (no es un depósito real)
if (new URLSearchParams(location.search).has("prueba")) DEPOSITOS.push({ id: "prueba", nombre: "PRUEBA (práctica, no es real)", centro: "Almacén Agropecuario" });
const UNIDAD_CORTA = { Unidades: "unid.", Kilogramos: "kg", Litros: "L", Gramos: "g" };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const fmt = (n) => (Math.round(Number(n) * 1000) / 1000).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const parseCant = (s) => { const t = String(s ?? "").trim().replace(/\s/g, "").replace(",", "."); if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return NaN; return Number(t); };
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fechaHora = (ms) => ms ? new Date(ms).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const sinCeros = (s) => String(s ?? "").replace(/^0+(?=\d)/, "");
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

// ---------- Estado ----------
const st = {
  usuario: localStorage.getItem("inv_usuario") || null,
  deposito: localStorage.getItem("inv_deposito") || null,
  conteoId: null,
  catalogo: [],
  items: new Map(),     // items del conteo activo
  uid: null,
  pendientes: 0,
  unsub: {},
};
const dep = () => DEPOSITOS.find((d) => d.id === st.deposito);

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
window.__inv = { app, db, auth, st };

function rastrear(p) {
  st.pendientes++; pintarSync();
  return p.catch((e) => { console.error(e); toast("No se pudo guardar: " + (e.code || e.message)); throw e; })
    .finally(() => { st.pendientes--; pintarSync(); });
}
function pintarSync() {
  const el = $("#sync");
  if (!navigator.onLine) { el.className = "sync off"; el.textContent = "Sin conexión, se guarda y sube después"; return; }
  if (!st.uid) { el.className = "sync off"; el.textContent = "Conectando…"; return; }
  if (st.pendientes > 0) { el.className = "sync pend"; el.textContent = `Subiendo ${st.pendientes}…`; return; }
  el.className = "sync ok"; el.textContent = "Sincronizado";
}
addEventListener("online", pintarSync);
addEventListener("offline", pintarSync);

onAuthStateChanged(auth, (u) => {
  st.uid = u ? u.uid : null; pintarSync();
  if (u) router();
});
signInAnonymously(auth).catch((e) => {
  console.warn("auth", e.code);
  if (!auth.currentUser) {
    $("#sync").className = "sync off";
    $("#sync").textContent = navigator.onLine ? "Error al conectar" : "Sin conexión: la primera vez necesitás señal";
  }
});

// ---------- Catálogo ----------
async function cargarCatalogo() {
  const r = await fetch("catalogo.json", { cache: "no-cache" });
  st.catalogo = (await r.json()).map((p) => ({ ...p, _n: norm(p.p), _c: norm(p.c), _c2: norm(p.c2), _w: norm(p.p).split(/[^a-z0-9]+/).filter(Boolean), _cz: sinCeros(norm(p.c)), _c2z: sinCeros(norm(p.c2)) }));
}
// Alias y tolerancia a errores de tipeo
const ALIAS = { electrolitico: "eletrolitico", vernil: "vetnil", desengrasante: "antigrasa" };
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < minFila) minFila = cur[j];
    }
    if (minFila > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const tolerancia = (w) => (w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0);
// ¿La palabra buscada coincide (exacta, parcial o con un error de tipeo) con alguna palabra del nombre?
function palabraCoincide(w, p) {
  if (p._n.includes(w)) return 2;
  const alias = ALIAS[w]; if (alias && p._n.includes(alias)) return 2;
  const tol = tolerancia(w); if (!tol) return 0;
  for (const nw of p._w) {
    if (nw.length < 3) continue;
    for (const L of [w.length - 1, w.length, w.length + 1]) {
      if (L < 3 || L > nw.length) continue;
      if (lev(w, nw.slice(0, L), tol) <= tol) return 1;
    }
  }
  return 0;
}
function buscar(q) {
  const nq = norm(q); if (!nq) return [];
  const palabras = nq.split(/\s+/).filter(Boolean);
  const res = [];
  for (const p of st.catalogo) {
    let score = -1;
    if (p._c === nq || p._c2 === nq || p.id === nq || (/^\d{6,}$/.test(nq) && (p._cz === sinCeros(nq) || p._c2z === sinCeros(nq)))) score = 100;
    else if (p._c2 && nq.length >= 6 && p._c2.includes(nq)) score = 80;
    else if (p._c.startsWith(nq)) score = 70;
    else if (palabras.every((w) => p._n.includes(w))) score = p._n.startsWith(palabras[0]) ? 60 : 50;
    else {
      const m = palabras.map((w) => palabraCoincide(w, p));
      if (m.every((x) => x > 0)) score = 30 + m.reduce((a, b) => a + b, 0);
    }
    if (score < 0) continue;
    if (p.d.includes(st.deposito)) score += 5;
    res.push([score, p]);
  }
  res.sort((a, b) => b[0] - a[0] || a[1].p.localeCompare(b[1].p));
  return res.slice(0, 40).map((x) => x[1]);
}
function porCodigoBarras(code) {
  const nc = norm(code), nz = sinCeros(nc);
  return st.catalogo.filter((p) => p._c2 === nc || p._c === nc || p._cz === nz || p._c2z === nz || (p._c2 && p._c2.split(/[\s,;/]+/).includes(nc)));
}

// ---------- Buscador reutilizable ----------
const buscadores = {};
function montarBuscador(cont, onPick) {
  cont.appendChild($("#tplBuscador").content.cloneNode(true));
  const inp = $(".q", cont), out = $(".resultados", cont);
  const pintar = () => {
    const q = inp.value; out.innerHTML = "";
    if (!norm(q)) return;
    const res = buscar(q);
    for (const p of res) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "res" + (p.d.includes(st.deposito) ? "" : " otro");
      b.innerHTML = `<div class="n">${esc(p.p)}</div><div class="m">Ficha ${esc(p.id)} · Cód. ${esc(p.c)}${p.c2 ? " · " + esc(p.c2) : ""} · ${esc(p.u)}${p.d.includes(st.deposito) ? "" : ' <span class="tag">otro depósito</span>'}</div>`;
      b.onclick = () => { inp.value = ""; out.innerHTML = ""; onPick(p); };
      out.appendChild(b);
    }
    const sf = document.createElement("button");
    sf.type = "button"; sf.className = "res";
    sf.innerHTML = `<div class="n">No lo encuentro: cargar “${esc(q.trim())}” sin ficha</div><div class="m">Queda marcado para que lo revise el encargado</div>`;
    sf.onclick = () => { const t = q.trim(); inp.value = ""; out.innerHTML = ""; onPick({ id: null, c: "", p: t, u: "Unidades", sinFicha: true }); };
    if (!res.length) out.insertAdjacentHTML("beforeend", '<p class="muted">No hay productos con ese nombre o código.</p>');
    out.appendChild(sf);
  };
  inp.addEventListener("input", pintar);
  $(".scan", cont).onclick = () => escanear((code) => {
    const m = porCodigoBarras(code);
    if (m.length === 1) { onPick(m[0]); toast("Encontrado: " + m[0].p); }
    else { inp.value = code; pintar(); toast(m.length ? "Hay varios, elegí uno" : "Código " + code + " no está en el catálogo"); }
  });
  return { limpiar: () => { inp.value = ""; out.innerHTML = ""; } };
}

// ---------- Escáner ----------
let scanStop = null;
async function escanear(onCode) {
  const ov = $("#scanner"), video = $("#scanVideo"), msg = $("#scanMsg");
  ov.classList.remove("hidden"); msg.textContent = "Apuntá la cámara al código de barras";
  let terminado = false;
  const fin = (code) => { if (terminado) return; terminado = true; cerrarScanner(); if (code) onCode(code); };
  try {
    if ("BarcodeDetector" in window) {
      const formatos = await BarcodeDetector.getSupportedFormats();
      if (formatos.length) {
        const det = new BarcodeDetector({ formats: formatos });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.classList.remove("hidden"); video.srcObject = stream; await video.play();
        let vivo = true;
        scanStop = () => { vivo = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
        const loop = async () => {
          if (!vivo) return;
          try { const c = await det.detect(video); if (c.length) return fin(c[0].rawValue); } catch {}
          requestAnimationFrame(loop);
        };
        loop(); return;
      }
    }
    // Respaldo: html5-qrcode (iPhone/iPad Safari no tiene BarcodeDetector)
    video.classList.add("hidden");
    if (!window.Html5Qrcode) await cargarScript("https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js");
    const h = new Html5Qrcode("scanQr", { verbose: false });
    await h.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 280, height: 140 } }, (txt) => fin(txt), () => {});
    scanStop = () => { h.stop().then(() => h.clear()).catch(() => {}); };
  } catch (e) {
    console.error(e);
    msg.textContent = "No se pudo abrir la cámara. Revisá el permiso o escribí el código.";
  }
}
function cerrarScanner() { try { scanStop && scanStop(); } catch {} scanStop = null; $("#scanner").classList.add("hidden"); $("#scanVideo").classList.remove("hidden"); }
function cargarScript(src) { return new Promise((ok, mal) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => mal(new Error("Sin conexión para el escáner")); document.head.appendChild(s); }); }
$("#btnScanCerrar").onclick = () => cerrarScanner();

// ---------- Navegación ----------
function mostrar(id) { $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== id)); }
function router() {
  $$(".nomUsuario").forEach((e) => (e.textContent = st.usuario || ""));
  if (!st.usuario) return mostrar("vNombre");
  if (!dep()) return mostrar("vDeposito");
  $("#nomDeposito").textContent = dep().nombre;
  mostrar("vApp");
  entrarDeposito();
}
$("#listaNombres").innerHTML = USUARIOS.map((u) => `<button class="btn huge" data-u="${esc(u)}">${esc(u)}</button>`).join("");
$("#listaNombres").onclick = (e) => { const b = e.target.closest("[data-u]"); if (!b) return; st.usuario = b.dataset.u; localStorage.setItem("inv_usuario", st.usuario); router(); };
$("#listaDepositos").innerHTML = DEPOSITOS.map((d) => `<button class="btn big huge" data-d="${d.id}">${esc(d.nombre)}</button>`).join("");
$("#listaDepositos").onclick = (e) => { const b = e.target.closest("[data-d]"); if (!b) return; st.deposito = b.dataset.d; localStorage.setItem("inv_deposito", st.deposito); st.conteoId = null; router(); };
const cambiarNombre = () => { st.usuario = null; localStorage.removeItem("inv_usuario"); salirDeposito(); router(); };
$("#btnCambiarNombre1").onclick = cambiarNombre;
$("#btnCambiarNombre2").onclick = cambiarNombre;
$("#btnCambiarDep").onclick = () => { st.deposito = null; localStorage.removeItem("inv_deposito"); salirDeposito(); router(); };
$$(".tab").forEach((t) => (t.onclick = () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $$(".tabpane").forEach((p) => p.classList.toggle("hidden", p.id !== t.dataset.tab));
}));

function salirDeposito() { Object.values(st.unsub).forEach((f) => f && f()); st.unsub = {}; st.conteoId = null; }
let depActivo = null;
function entrarDeposito() {
  if (!st.uid) return;
  const clave = st.deposito + "|" + st.usuario;
  if (depActivo === clave && st.unsub.conteos) return;
  salirDeposito(); depActivo = clave;
  escucharConteos(); escucharUsos(); resetUso();
  const guardado = localStorage.getItem(`inv_conteo_${st.deposito}_${st.usuario}`);
  if (guardado) abrirConteo(guardado); else verListaConteos();
}

// ---------- CONTEOS ----------
const colConteos = () => collection(db, "inventario", st.deposito, "conteos");
function escucharConteos() {
  const q = query(colConteos(), where("estado", "==", "abierto"));
  st.unsub.conteos = onSnapshot(q, (snap) => {
    const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.actualizadoLocal || 0) - (a.actualizadoLocal || 0));
    const cont = $("#conteosAbiertos");
    if (!arr.length) { cont.innerHTML = '<p class="muted">No hay conteos abiertos. Empezá uno nuevo.</p>'; return; }
    cont.innerHTML = arr.map((c) => `<button class="res" data-c="${esc(c.id)}"><div class="n">Conteo de ${esc(c.usuario)} · ${esc(c.fecha || "")}</div><div class="m">Último cambio ${fechaHora(c.actualizadoLocal)}${snapPend(c, snap) ? ' <span class="tag pend">sin subir</span>' : ""} · tocá para continuar</div></button>`).join("");
  }, (e) => { console.error(e); $("#conteosAbiertos").innerHTML = '<p class="muted">No se pudo leer: ' + esc(e.code) + "</p>"; });
}
function snapPend(c, snap) { const d = snap.docs.find((x) => x.id === c.id); return d && d.metadata.hasPendingWrites; }
$("#conteosAbiertos").onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) abrirConteo(b.dataset.c); };
function verListaConteos() {
  if (st.unsub.items) { st.unsub.items(); st.unsub.items = null; st.unsub.conteo && st.unsub.conteo(); st.unsub.conteo = null; }
  st.conteoId = null; localStorage.removeItem(`inv_conteo_${st.deposito}_${st.usuario}`);
  $("#conteoLista").classList.remove("hidden"); $("#conteoActivo").classList.add("hidden");
}
$("#btnSalirConteo").onclick = verListaConteos;
$("#btnNuevoConteo").onclick = () => {
  const id = `${hoyISO()}_${slug(st.usuario)}_${Math.random().toString(36).slice(2, 7)}`;
  const ahora = Date.now();
  rastrear(setDoc(doc(colConteos(), id), {
    usuario: st.usuario, deposito: st.deposito, depositoNombre: dep().nombre, estado: "abierto", fecha: hoyISO(),
    creado: serverTimestamp(), actualizado: serverTimestamp(), enviado: null,
    creadoLocal: ahora, actualizadoLocal: ahora, app: "inventario-tg",
  })).catch(() => {});
  abrirConteo(id);
};
function abrirConteo(id) {
  st.conteoId = id; localStorage.setItem(`inv_conteo_${st.deposito}_${st.usuario}`, id);
  $("#conteoLista").classList.add("hidden"); $("#conteoActivo").classList.remove("hidden");
  $("#panelConteo").classList.add("hidden");
  $("#conteoTitulo").textContent = id;
  st.unsub.conteo && st.unsub.conteo();
  st.unsub.conteo = onSnapshot(doc(colConteos(), id), (d) => {
    if (!d.exists()) { $("#conteoMeta").textContent = "Preparando…"; return; }
    const c = d.data();
    $("#conteoTitulo").textContent = `de ${c.usuario} · ${c.fecha || ""}`;
    $("#conteoMeta").textContent = `${dep().nombre} · estado: ${c.estado}`;
    if (c.estado === "enviado") { toast("Este conteo ya fue enviado"); verListaConteos(); }
  });
  st.unsub.items && st.unsub.items();
  st.items = new Map();
  st.unsub.items = onSnapshot(collection(colConteos(), id, "items"), { includeMetadataChanges: true }, (snap) => {
    st.items = new Map(snap.docs.map((d) => [d.id, { ...d.data(), _pend: d.metadata.hasPendingWrites }]));
    pintarItems();
  });
}
function pintarItems() {
  const arr = [...st.items.entries()].filter(([, it]) => !it.eliminado).sort((a, b) => (b[1].actualizadoLocal || 0) - (a[1].actualizadoLocal || 0));
  $("#conteoCant").textContent = arr.length;
  $("#conteoItems").innerHTML = arr.length ? arr.map(([k, it]) => `
    <div class="card item" data-k="${esc(k)}">
      <div><div class="n"><b>${esc(it.producto)}</b>${it.sinFicha ? '<span class="tag sf">sin ficha</span>' : ""}${it._pend ? '<span class="tag pend">sin subir</span>' : ""}</div>
      <div class="muted small">${it.id ? "Ficha " + esc(it.id) + " · " : ""}${it.codigo ? "Cód. " + esc(it.codigo) + " · " : ""}${esc(it.usuario || "")}</div></div>
      <div class="q">${fmt(it.cantidad)} <span class="small">${esc(UNIDAD_CORTA[it.unidad] || it.unidad)}</span></div>
    </div>`).join("") : '<p class="muted">Todavía no cargaste nada. Buscá o escaneá un producto.</p>';
}
$("#conteoItems").onclick = (e) => {
  const c = e.target.closest("[data-k]"); if (!c) return;
  const it = st.items.get(c.dataset.k);
  const p = it.sinFicha ? { id: null, c: "", p: it.producto, u: it.unidad, sinFicha: true, _key: c.dataset.k } : (st.catalogo.find((x) => x.id === it.id) || { id: it.id, c: it.codigo, p: it.producto, u: it.unidad });
  panelConteo(p, c.dataset.k);
};
function claveItem(p) { return p._key || (p.sinFicha ? "sf_" + (slug(p.p) || Date.now()) : String(p.id)); }
function panelConteo(p, claveExistente) {
  const k = claveExistente || claveItem(p);
  const prev = st.items.get(k);
  const yaEsta = prev && !prev.eliminado;
  const pan = $("#panelConteo");
  pan.classList.remove("hidden");
  pan.innerHTML = `
    <div class="prod-title">${esc(p.p)} ${p.sinFicha ? '<span class="tag sf">sin ficha</span>' : ""}</div>
    <div class="muted">${p.id ? "Ficha " + esc(p.id) + " · " : ""}${p.c ? "Cód. " + esc(p.c) + " · " : ""}Unidad de la ficha: <b>${esc(p.u)}</b></div>
    ${p.sinFicha ? `<label>Unidad<select id="pcUnidad"><option>Unidades</option><option>Kilogramos</option><option>Litros</option></select></label>` : ""}
    ${yaEsta ? `<p class="card info">Ya está cargado: <b>${fmt(prev.cantidad)} ${esc(UNIDAD_CORTA[prev.unidad] || prev.unidad)}</b>. Podés sumar lo nuevo o reemplazar el total.</p>` : ""}
    <label>Cantidad en ${esc(p.u)}
      <input id="pcCant" inputmode="decimal" placeholder="${p.u === "Unidades" ? "Ej.: 12" : "Ej.: 2,5"}" autocomplete="off"></label>
    <div class="row">
      ${yaEsta ? `<button class="btn big" id="pcSumar">Sumar</button><button class="btn big primary" id="pcReemplazar">Reemplazar</button>`
               : `<button class="btn big primary" id="pcGuardar">Guardar</button>`}
    </div>
    <div class="row">
      <button class="btn big" id="pcCancelar">Cancelar</button>
      ${yaEsta ? `<button class="btn big warn" id="pcQuitar">Quitar del conteo</button>` : ""}
    </div>`;
  if (p.sinFicha && prev) $("#pcUnidad").value = prev.unidad;
  const inp = $("#pcCant"); setTimeout(() => inp.focus(), 50);
  pan.scrollIntoView({ behavior: "smooth", block: "start" });
  const guardar = (modo) => {
    const n = parseCant(inp.value);
    if (!(n >= 0) || Number.isNaN(n)) { toast("Escribí una cantidad válida (podés usar coma)"); inp.focus(); return; }
    if (p.u === "Unidades" && !p.sinFicha && !Number.isInteger(n) && !confirm(`La ficha es por Unidades y pusiste ${fmt(n)}. ¿Está bien?`)) return;
    const unidad = p.sinFicha ? $("#pcUnidad").value : p.u;
    const ahora = Date.now();
    const data = {
      id: p.id ?? null, codigo: p.c || "", producto: p.p, unidad, usuario: st.usuario,
      actualizado: serverTimestamp(), actualizadoLocal: ahora, eliminado: false, sinFicha: !!p.sinFicha,
      cantidad: modo === "sumar" ? increment(n) : n,
    };
    rastrear(setDoc(doc(colConteos(), st.conteoId, "items", k), data, { merge: true })).catch(() => {});
    tocarConteo();
    pan.classList.add("hidden"); buscadores.conteo.limpiar();
    toast(modo === "sumar" ? `Sumado ${fmt(n)} a ${p.p}` : `Guardado: ${p.p} = ${fmt(n)}`);
  };
  const b = (id, f) => { const el = $(id, pan); if (el) el.onclick = f; };
  b("#pcGuardar", () => guardar("reemplazar"));
  b("#pcReemplazar", () => guardar("reemplazar"));
  b("#pcSumar", () => guardar("sumar"));
  b("#pcCancelar", () => pan.classList.add("hidden"));
  b("#pcQuitar", () => {
    if (!confirm(`¿Quitar ${p.p} de este conteo?`)) return;
    rastrear(setDoc(doc(colConteos(), st.conteoId, "items", k), { eliminado: true, usuario: st.usuario, actualizado: serverTimestamp(), actualizadoLocal: Date.now() }, { merge: true })).catch(() => {});
    tocarConteo(); pan.classList.add("hidden");
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") guardar(yaEsta ? "reemplazar" : "reemplazar"); });
}
function tocarConteo() {
  rastrear(updateDoc(doc(colConteos(), st.conteoId), { actualizado: serverTimestamp(), actualizadoLocal: Date.now() })).catch(() => {});
}
$("#btnEnviarConteo").onclick = () => {
  const n = [...st.items.values()].filter((i) => !i.eliminado).length;
  if (!n) return toast("El conteo está vacío");
  if (!confirm(`¿Enviar el conteo con ${n} productos? Después ya no se puede cambiar.`)) return;
  const ahora = Date.now();
  rastrear(updateDoc(doc(colConteos(), st.conteoId), { estado: "enviado", enviado: serverTimestamp(), enviadoPor: st.usuario, enviadoLocal: ahora, actualizado: serverTimestamp(), actualizadoLocal: ahora })).catch(() => {});
  toast(navigator.onLine ? "Conteo enviado. ¡Gracias!" : "Conteo enviado. Sube cuando vuelva la señal.", 3500);
  verListaConteos();
};

// ---------- USOS INTERNOS ----------
let usoProd = null;
const colUsos = () => collection(db, "inventario", st.deposito, "usos_internos");
function resetUso() {
  usoProd = null; $("#formUso").classList.add("hidden"); $("#formUso").reset();
  $("#usoCentro").value = dep().centro; $("#usoFecha").value = hoyISO(); $("#lblConceptoOtro").classList.add("hidden");
}
function elegirUso(p) {
  usoProd = p;
  $("#formUso").classList.remove("hidden");
  $("#usoProducto").innerHTML = `<div class="prod-title">${esc(p.p)} ${p.sinFicha ? '<span class="tag sf">sin ficha</span>' : ""}</div><div class="muted">${p.id ? "Ficha " + esc(p.id) + " · " : ""}${p.c ? "Cód. " + esc(p.c) + " · " : ""}Unidad: <b>${esc(p.u)}</b></div>`;
  $("#usoUnidad").textContent = "(" + p.u + ")";
  if (!$("#usoCentro").value) $("#usoCentro").value = dep().centro;
  if (!$("#usoFecha").value) $("#usoFecha").value = hoyISO();
  setTimeout(() => $("#usoCantidad").focus(), 50);
}
$("#usoConcepto").onchange = () => $("#lblConceptoOtro").classList.toggle("hidden", $("#usoConcepto").value !== "Otro");
$("#btnUsoCancelar").onclick = resetUso;
$("#formUso").onsubmit = (e) => {
  e.preventDefault();
  if (!usoProd) return;
  const n = parseCant($("#usoCantidad").value);
  if (!(n > 0)) return toast("Escribí una cantidad mayor a cero");
  const motivo = $("#usoMotivo").value.trim(); if (!motivo) return toast("Escribí el motivo");
  let concepto = $("#usoConcepto").value;
  if (concepto === "Otro") { const o = $("#usoConceptoOtro").value.trim(); concepto = o ? "Otro: " + o : "Otro"; }
  const ahora = Date.now();
  rastrear(addDoc(colUsos(), {
    productoId: usoProd.id ?? null, codigo: usoProd.c || "", producto: usoProd.p, unidad: usoProd.u, sinFicha: !!usoProd.sinFicha,
    cantidad: n, motivo, centroCosto: $("#usoCentro").value, concepto, fecha: $("#usoFecha").value,
    deposito: st.deposito, depositoNombre: dep().nombre, usuario: st.usuario, estado: "pendiente",
    creado: serverTimestamp(), creadoLocal: ahora, app: "inventario-tg",
  })).catch(() => {});
  toast("Uso interno guardado"); resetUso(); buscadores.uso.limpiar();
};
function escucharUsos() {
  const q = query(colUsos(), orderBy("creadoLocal", "desc"), limit(40));
  st.unsub.usos = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const cont = $("#usosLista");
    if (snap.empty) { cont.innerHTML = '<p class="muted">Todavía no hay usos internos en este depósito.</p>'; return; }
    cont.innerHTML = snap.docs.map((d) => { const u = d.data(); return `
      <div class="card item"><div><div><b>${esc(u.producto)}</b>${u.sinFicha ? '<span class="tag sf">sin ficha</span>' : ""}${d.metadata.hasPendingWrites ? '<span class="tag pend">sin subir</span>' : ""}</div>
      <div class="muted small">${u.productoId ? "Ficha " + esc(u.productoId) + " · " : ""}${esc(u.fecha)} · ${esc(u.usuario)} · ${esc(u.centroCosto)} · ${esc(u.concepto)}</div>
      <div class="small">${esc(u.motivo)} · <i>${esc(u.estado)}</i></div></div>
      <div class="q">${fmt(u.cantidad)} <span class="small">${esc(UNIDAD_CORTA[u.unidad] || u.unidad)}</span></div></div>`; }).join("");
  }, (e) => { console.error(e); $("#usosLista").innerHTML = '<p class="muted">No se pudo leer: ' + esc(e.code) + "</p>"; });
}

// ---------- Inicio ----------
buscadores.conteo = montarBuscador($('.buscador[data-modo="conteo"]'), (p) => panelConteo(p));
buscadores.uso = montarBuscador($('.buscador[data-modo="uso"]'), elegirUso);
cargarCatalogo().then(() => { window.__invReady = true; pintarVersion(); }).catch((e) => toast("No se pudo cargar el catálogo"));
pintarSync();
router();
function pintarVersion() {
  const el = document.getElementById("versionApp");
  if (el) el.textContent = `App ${APP_VERSION} · ${st.catalogo.length ? st.catalogo.length + " productos" : "cargando catálogo…"}`;
}
pintarVersion();

// ---------- Actualización automática (sirve también con la app anclada al inicio) ----------
if ("serviceWorker" in navigator) {
  let recargado = false;
  const habiaControlador = !!navigator.serviceWorker.controller; // la primera instalación no recarga
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habiaControlador || recargado || sessionStorage.getItem("inv_recarga") === APP_VERSION) return;
    recargado = true; sessionStorage.setItem("inv_recarga", APP_VERSION);
    location.reload();
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
    const buscarActualizacion = () => reg.update().catch(() => {});
    buscarActualizacion();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") buscarActualizacion(); });
    addEventListener("online", buscarActualizacion);
  }).catch((e) => console.warn("sw", e));
}

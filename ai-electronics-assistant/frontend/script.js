"use strict";
/* AI Electronics Assistant — frontend. Semua konten dinamis disanitasi lewat esc()/textContent.
   Seluruh pemrosesan (AI, dokumen, parameter) dilakukan backend lewat REST API di bawah /api. */
const API = "/api";
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
let convs = store.get("aea.convs", []), activeId = null, settings = store.get("aea.settings", { sources: false, motion: false }), busy = false, lastQ = null;
const TITLES = { chat: "Chat", docs: "Dokumen Referensi", params: "Pencarian Parameter", compare: "Perbandingan Komponen", settings: "Pengaturan" };
const NOTFOUND = "Informasi tersebut belum ditemukan dalam dokumen referensi yang tersedia. Silakan gunakan kata kunci lain atau tambahkan dokumen yang relevan.";

/* ---------- util ---------- */
function toast(msg, type = "") { const t = document.createElement("div"); t.className = "toast " + type; t.textContent = msg; $("#toasts").append(t); setTimeout(() => t.remove(), 3800); }
function modal({ title, text, input, ok = "OK", danger = false }) {
  return new Promise(res => {
    const m = $("#modal"), inp = $("#mInput"); $("#mTitle").textContent = title; $("#mText").textContent = text || "";
    inp.hidden = !input; inp.value = input || ""; $("#mOk").textContent = ok; $("#mOk").className = "btn " + (danger ? "danger" : "primary"); m.hidden = false; (input ? inp : $("#mOk")).focus();
    const done = v => { m.hidden = true; $("#mOk").onclick = $("#mCancel").onclick = null; document.onkeydown = null; res(v); };
    $("#mOk").onclick = () => done(input !== undefined ? inp.value.trim() : true); $("#mCancel").onclick = () => done(null);
    document.onkeydown = e => { if (e.key === "Escape") done(null); if (e.key === "Enter" && input) done(inp.value.trim()); };
  });
}
async function api(path, opts) {
  let r; try { r = await fetch(API + path, opts); } catch { throw new Error("Tidak dapat terhubung ke backend. Pastikan server berjalan."); }
  let d = null; try { d = await r.json(); } catch { }
  if (!r.ok) throw new Error(d?.error || `Permintaan gagal (${r.status})`);
  return d;
}
const docLink = (file, hal) => file ? `${API}/documents/${encodeURIComponent(file)}/file${hal ? "#page=" + hal : ""}` : null;
const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const fmtTime = t => new Date(t).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const skeleton = n => Array.from({ length: n }, () => '<div class="skel"></div>').join("");

/* ---------- navigasi ---------- */
function showView(v) {
  $$(".view").forEach(s => s.classList.toggle("active", s.id === "view-" + v));
  $$(".menu button").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  $("#viewTitle").textContent = TITLES[v]; $("#backChat").hidden = v === "chat"; document.body.classList.remove("side-open");
  if (v === "docs") loadDocs(); if (v === "params") loadParams(); if (v === "compare") initCompare(); if (v === "settings") renderSettings();
}
$$(".menu button").forEach(b => b.onclick = () => showView(b.dataset.view));
$("#backChat").onclick = () => showView("chat");
$("#openSide").onclick = () => document.body.classList.add("side-open");
$("#closeSide").onclick = $("#overlay").onclick = () => document.body.classList.remove("side-open");

/* ---------- status koneksi ---------- */
async function loadStatus() {
  const el = $("#status"), dot = $(".dot", el), txt = $("span", el);
  try {
    const s = await api("/status");
    dot.className = "dot " + (s.llm_configured ? "ok" : "demo");
    txt.textContent = (s.llm_configured ? "Model bahasa terhubung" : "Mode demo: tanpa model bahasa") + (s.index_ready ? ` · ${s.documents} dokumen terindeks` : " · mengindeks dokumen…");
    window.__status = s; if (!s.index_ready) setTimeout(loadStatus, 1500);
  } catch (e) { dot.className = "dot bad"; txt.textContent = "Backend tidak terhubung"; window.__status = null; setTimeout(loadStatus, 8000); }
}

/* ---------- riwayat ---------- */
const saveConvs = () => store.set("aea.convs", convs);
const active = () => convs.find(c => c.id === activeId);
function renderHistory() {
  const h = $("#history"); h.innerHTML = "";
  if (!convs.length) { h.innerHTML = '<div class="small-t" style="padding:6px 10px;color:#7f9ccc">Belum ada percakapan.</div>'; return; }
  [...convs].sort((a, b) => b.updated - a.updated).forEach(c => {
    const d = document.createElement("div"); d.className = "hitem" + (c.id === activeId ? " active" : "");
    d.innerHTML = `<div class="t"><div>${esc(c.title)}</div><small>${esc(fmtTime(c.updated))}</small></div><button title="Ganti judul" aria-label="Ganti judul">✎</button><button title="Hapus" aria-label="Hapus">🗑</button>`;
    d.onclick = () => openConv(c.id);
    const [ren, del] = $$("button", d);
    ren.onclick = async e => { e.stopPropagation(); const t = await modal({ title: "Ganti judul percakapan", input: c.title, ok: "Simpan" }); if (t) { c.title = t.slice(0, 80); saveConvs(); renderHistory(); toast("Judul diperbarui", "ok"); } };
    del.onclick = async e => { e.stopPropagation(); if (await modal({ title: "Hapus percakapan?", text: `“${c.title}” akan dihapus permanen.`, ok: "Hapus", danger: true })) { convs = convs.filter(x => x !== c); saveConvs(); if (activeId === c.id) newChat(); else renderHistory(); toast("Percakapan dihapus", "ok"); } };
    h.append(d);
  });
}
function newChat() { activeId = null; renderMessages(); renderHistory(); showView("chat"); $("#input").focus(); }
function openConv(id) { activeId = id; renderMessages(); renderHistory(); showView("chat"); }
$("#newChat").onclick = newChat;

/* ---------- render pesan ---------- */
function renderMessages() {
  const box = $("#messages"); const c = active(); $$(".msg", box).forEach(n => n.remove());
  $("#welcome").style.display = c && c.messages.length ? "none" : "";
  if (c) c.messages.forEach(m => addMsg(m, false)); box.scrollTop = box.scrollHeight;
}
function addMsg(m, animate = true) {
  const box = $("#messages"), w = document.createElement("div"); w.className = "msg " + m.role; if (!animate) w.style.animation = "none";
  if (m.role === "user") { const b = document.createElement("div"); b.className = "bubble"; b.textContent = m.text; w.append(b); }
  else w.append(m.error ? errorBlock(m) : botBlock(m.data));
  box.append(w); box.scrollTop = box.scrollHeight; return w;
}
const STATUS = { BERHASIL: ["ok", "Berhasil"], PERLU_KLARIFIKASI: ["warn", "Perlu klarifikasi"], TIDAK_DITEMUKAN: ["gray", "Tidak ditemukan"], DILUAR_CAKUPAN: ["bad", "Di luar cakupan"] };
const cell = v => v ? esc(v) : '<span class="small-t">–</span>';
function srcCell(s) { const l = docLink(s.file, s.hal); const t = `${esc(String(s.dokumen).replace(/\s*\(.*?\)/g, ""))}${s.halaman ? ", hal. " + esc(String(s.halaman).replace(/^hal\.\s*/, "")) : ""}`; return l ? `<a href="${l}" target="_blank" rel="noopener">${t}</a>` : t; }
function tableHTML(rows) {
  return `<div class="table-scroll"><table class="tbl"><thead><tr><th>Komponen</th><th>Parameter</th><th>Min</th><th>Tip.</th><th>Maks</th><th>Satuan</th><th>Kondisi uji</th><th>Sumber</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${esc(r.komponen)}</td><td>${esc(r.parameter)}${r.simbol ? ` <span class="small-t">(${esc(r.simbol)})</span>` : ""}${r.catatan ? `<div class="small-t">${esc(r.catatan)}</div>` : ""}</td><td class="num">${cell(r.min)}</td><td class="num">${cell(r.typ)}</td><td class="num">${cell(r.maks)}</td><td>${cell(r.satuan)}</td><td>${cell(r.kondisi_uji)}</td><td>${srcCell(r.sumber)}${r.diverifikasi === false ? '<div class="small-t">belum diverifikasi manual</div>' : ""}</td></tr>`).join("") + "</tbody></table></div>";
}
function plainText(d) {
  const L = []; if (d.pesan) L.push(d.pesan); if (d.penjelasan) L.push(d.penjelasan);
  d.tabel.forEach(r => L.push(`${r.komponen} | ${r.parameter} | min ${r.min || "-"} | tip. ${r.typ || "-"} | maks ${r.maks || "-"} ${r.satuan} | ${r.kondisi_uji} | ${r.sumber.dokumen} hal. ${r.sumber.halaman || "-"}`));
  if (d.sumber.length) L.push("Sumber: " + d.sumber.map(s => `${s.dokumen} ${s.halaman || ""}`).join("; ")); return L.join("\n");
}
function botBlock(d) {
  const [cls, lab] = STATUS[d.status] || ["", d.status], el = document.createElement("div"); el.className = "bot";
  const unver = d.tabel.some(r => r.diverifikasi === false);
  el.innerHTML = `<div class="row"><span class="badge">${esc(d.jenis)}</span><span class="badge ${cls}">${esc(lab)}</span><span class="badge ${d.mode === "llm" ? "ok" : "warn"}">${d.mode === "llm" ? "Model bahasa" : "Mode demo"}</span></div>` +
    (d.pesan ? `<p class="${d.status === "TIDAK_DITEMUKAN" || d.status === "DILUAR_CAKUPAN" ? "notfound" : ""}">${esc(d.pesan)}</p>` : "") +
    (d.penjelasan ? `<p>${esc(d.penjelasan)}</p>` : "") + (d.tabel.length ? tableHTML(d.tabel) : "") +
    (d.asumsi.length ? `<div class="small-t"><b>Asumsi:</b><ul>${d.asumsi.map(a => `<li>${esc(a)}</li>`).join("")}</ul></div>` : "") +
    (d.tidak_dapat_ditentukan.length ? `<div class="small-t"><b>Tidak dapat ditentukan dari dokumen:</b><ul>${d.tidak_dapat_ditentukan.map(a => `<li>${esc(a)}</li>`).join("")}</ul></div>` : "") +
    ((d.perlu_verifikasi_manual || unver) ? `<div class="banner">${unver ? "Baris parameter ini belum diverifikasi manual terhadap PDF. " : ""}Periksa angka kritis ke datasheet asli sebelum merakit.</div>` : "");
  const acts = document.createElement("div"); acts.className = "actions";
  acts.innerHTML = `<button class="btn small" data-a="copy">Salin jawaban</button>` + (d.sumber.length ? `<button class="btn small" data-a="src">${settings.sources ? "Sembunyikan" : "Tampilkan"} sumber (${d.sumber.length})</button>` : "");
  const src = document.createElement("div"); src.className = "sources" + (settings.sources ? " open" : "");
  src.innerHTML = d.sumber.map(s => `<div class="src"><b>${srcCell(s)}</b>${s.unggahan ? ' <span class="badge gray">unggahan</span>' : ""}${s.kutipan_langsung ? `<q>${esc(s.kutipan_langsung)}</q>` : ""}</div>`).join("");
  acts.onclick = e => { const a = e.target.dataset.a; if (a === "copy") navigator.clipboard.writeText(plainText(d)).then(() => toast("Jawaban disalin", "ok"), () => toast("Gagal menyalin", "bad")); if (a === "src") { src.classList.toggle("open"); e.target.textContent = `${src.classList.contains("open") ? "Sembunyikan" : "Tampilkan"} sumber (${d.sumber.length})`; } };
  el.append(acts, src); return el;
}
function errorBlock(m) {
  const el = document.createElement("div"); el.className = "bot";
  el.innerHTML = `<span class="badge bad">Gagal</span><p>${esc(m.error)}</p>`; const b = document.createElement("button"); b.className = "btn small"; b.textContent = "Coba lagi";
  b.onclick = () => { const c = active(); if (c) { c.messages = c.messages.filter(x => x !== m); const last = c.messages.pop(); saveConvs(); renderMessages(); send(last?.text || m.q, true); } };
  el.append(b); return el;
}

/* ---------- kirim pesan ---------- */
function setBusy(v) { busy = v; $("#send").disabled = v; $("#input").disabled = v; }
function showInputError(t) { const e = $("#inputError"); e.hidden = !t; e.textContent = t || ""; if (t) { e.style.animation = "none"; void e.offsetWidth; e.style.animation = ""; } }
async function send(text, fromRetry = false) {
  text = (text ?? $("#input").value).trim();
  if (busy) return;
  if (!text) { showInputError("Pesan tidak boleh kosong. Tulis pertanyaan Anda terlebih dahulu."); return; }
  if (text.length > 1000) { showInputError("Pesan terlalu panjang (maks. 1000 karakter)."); return; }
  showInputError(""); showView("chat");
  let c = active(); if (!c) { c = { id: "c" + Date.now(), title: text.slice(0, 48), created: Date.now(), updated: Date.now(), messages: [] }; convs.push(c); activeId = c.id; $("#welcome").style.display = "none"; }
  const um = { role: "user", text, t: Date.now() }; c.messages.push(um); c.updated = Date.now(); saveConvs(); renderHistory(); addMsg(um);
  $("#input").value = ""; autosize(); setBusy(true); lastQ = text;
  const typing = document.createElement("div"); typing.className = "msg"; typing.innerHTML = '<div class="bot"><span class="typing"><i></i><i></i><i></i></span> <span class="small-t">Mencari di dokumen referensi…</span></div>'; $("#messages").append(typing); $("#messages").scrollTop = 1e9;
  let m;
  try { const d = await api("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) }); m = { role: "assistant", data: d, t: Date.now() }; }
  catch (e) { m = { role: "assistant", error: e.message, q: text, t: Date.now() }; toast(e.message, "bad"); }
  typing.remove(); c.messages.push(m); c.updated = Date.now(); saveConvs(); addMsg(m); renderHistory(); setBusy(false); $("#input").focus();
}
function autosize() { const t = $("#input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }
$("#input").addEventListener("input", () => { autosize(); showInputError(""); });
$("#input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$("#send").onclick = () => send();
$("#clearInput").onclick = () => { $("#input").value = ""; autosize(); showInputError(""); $("#input").focus(); };
$$(".card").forEach(c => c.onclick = () => send(c.dataset.q));

/* ---------- dokumen ---------- */
let docs = [];
async function loadDocs() {
  const tb = $("#docTable tbody"); tb.innerHTML = `<tr><td colspan="6">${skeleton(4)}</td></tr>`;
  try { docs = await api("/documents"); renderDocs(); if (docs.some(d => ["Menunggu", "Diproses"].includes(d.status))) setTimeout(() => $("#view-docs").classList.contains("active") && loadDocs(), 1500); }
  catch (e) { tb.innerHTML = `<tr><td colspan="6">${esc(e.message)} <button class="btn small" onclick="loadDocs()">Coba lagi</button></td></tr>`; }
}
function renderDocs() {
  const q = $("#docSearch").value.toLowerCase(), tb = $("#docTable tbody");
  const rows = docs.filter(d => (d.nama + " " + d.komponen).toLowerCase().includes(q));
  tb.innerHTML = rows.length ? "" : '<tr><td colspan="6" class="muted">Tidak ada dokumen yang cocok.</td></tr>';
  const cls = { Berhasil: "ok", Gagal: "bad", Diproses: "warn", Menunggu: "gray" };
  rows.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(d.nama)}${d.bawaan ? "" : ' <span class="badge gray">unggahan</span>'}</td><td>${esc(d.jenis)}</td><td>${esc(d.komponen)}</td><td class="num">${d.ukuran ? fmtBytes(d.ukuran) : "–"}</td><td><span class="badge ${cls[d.status] || ""}">${esc(d.status)}</span>${d.error ? `<div class="small-t">${esc(d.error)}</div>` : ""}</td><td class="num"><a href="${docLink(d.id)}" target="_blank" rel="noopener">Lihat</a>${d.bawaan ? "" : ' · <a href="#" data-del>Hapus</a>'}</td>`;
    const del = $("[data-del]", tr);
    if (del) del.onclick = async e => { e.preventDefault(); if (!await modal({ title: "Hapus dokumen?", text: d.nama, ok: "Hapus", danger: true })) return; try { await api("/documents/" + d.id, { method: "DELETE" }); toast("Dokumen dihapus", "ok"); loadDocs(); } catch (er) { toast(er.message, "bad"); } };
    tb.append(tr);
  });
}
$("#docSearch").oninput = renderDocs;
$("#upload").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (!/\.(pdf|csv|txt)$/i.test(f.name)) return toast("Tipe berkas tidak didukung (PDF, CSV, TXT).", "bad");
  if (f.size > 20 * 1048576) return toast("Ukuran berkas melebihi 20 MB.", "bad");
  const fd = new FormData(); fd.append("file", f);
  try { await api("/documents", { method: "POST", body: fd }); toast("Berkas diunggah; sedang diproses…"); loadDocs(); } catch (er) { toast(er.message, "bad"); }
};

/* ---------- pencarian parameter ---------- */
let prow = [], psort = { k: "komponen", d: 1 };
const PCOLS = [["komponen", "Komponen"], ["parameter", "Parameter"], ["min", "Min"], ["typ", "Tip."], ["maks", "Maks"], ["satuan", "Satuan"], ["kondisi_uji", "Kondisi uji"], ["dok", "Sumber dokumen"]];
async function loadParams() {
  if (prow.length) return renderParams();
  $("#pTable tbody").innerHTML = `<tr><td colspan="8">${skeleton(6)}</td></tr>`;
  try {
    const d = await api("/parameters"); prow = d.rows;
    $("#pComp").innerHTML = '<option value="">Semua komponen</option>' + d.components.map(c => `<option>${esc(c)}</option>`).join("");
    $("#pUnit").innerHTML = '<option value="">Semua satuan</option>' + [...new Set(prow.map(r => r.satuan).filter(Boolean))].sort().map(u => `<option>${esc(u)}</option>`).join("");
    $("#pDoc").innerHTML = '<option value="">Semua dokumen</option>' + [...new Set(prow.map(r => r.sumber.dokumen))].map(u => `<option>${esc(u)}</option>`).join(""); renderParams();
  } catch (e) { $("#pTable tbody").innerHTML = `<tr><td colspan="8">${esc(e.message)} <button class="btn small" onclick="loadParams()">Coba lagi</button></td></tr>`; }
}
function inRange(r, q) {
  const m = q.match(/^\s*(-?[\d.,]+)\s*(?:-|–|sampai|\.\.)\s*(-?[\d.,]+)\s*$/), n = s => parseFloat(String(s).replace(",", "."));
  const vals = [r.min, r.typ, r.maks].map(n).filter(x => !isNaN(x));
  if (m) { const a = n(m[1]), b = n(m[2]); return vals.some(v => v >= a && v <= b); }
  const x = n(q); return isNaN(x) ? [r.min, r.typ, r.maks].join(" ").toLowerCase().includes(q.toLowerCase()) : vals.some(v => v === x);
}
const applies = (rk, c) => { rk = rk.toUpperCase(); c = c.toUpperCase(); if (rk === c) return true; if (c.startsWith("LM78") || c === "LM317") return rk.split("/").map(x => x.trim()).includes(c); const fam = c.split("-")[0]; return rk.startsWith(fam) && (rk.includes("XX") || rk.includes("/")); };
function renderParams() {
  const f = { t: $("#pText").value.toLowerCase(), c: $("#pComp").value, p: $("#pParam").value.toLowerCase(), v: $("#pVal").value.trim(), u: $("#pUnit").value, d: $("#pDoc").value };
  let rows = prow.filter(r => (!f.c || applies(r.komponen, f.c)) &&
    (!f.t || JSON.stringify(r).toLowerCase().includes(f.t)) && (!f.p || (r.parameter + r.simbol).toLowerCase().includes(f.p)) && (!f.v || inRange(r, f.v)) && (!f.u || r.satuan === f.u) && (!f.d || r.sumber.dokumen === f.d));
  const key = r => psort.k === "dok" ? r.sumber.dokumen : r[psort.k] ?? ""; rows.sort((a, b) => String(key(a)).localeCompare(String(key(b)), "id", { numeric: true }) * psort.d);
  $("#pInfo").textContent = `${rows.length} dari ${prow.length} baris. Semua baris berstatus belum diverifikasi manual kecuali ditandai lain.`;
  $("#pTable thead").innerHTML = "<tr>" + PCOLS.map(([k, l]) => `<th class="sort" data-k="${k}">${l}${psort.k === k ? (psort.d > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "<th>Hal.</th></tr>";
  $$("#pTable th.sort").forEach(th => th.onclick = () => { psort = { k: th.dataset.k, d: psort.k === th.dataset.k ? -psort.d : 1 }; renderParams(); });
  $("#pTable tbody").innerHTML = rows.length ? rows.map(r => { const l = docLink(r.sumber.file, r.sumber.hal);
    return `<tr><td>${esc(r.komponen)}</td><td>${esc(r.parameter)}${r.catatan ? `<div class="small-t">${esc(r.catatan)}</div>` : ""}</td><td class="num">${cell(r.min)}</td><td class="num">${cell(r.typ)}</td><td class="num">${cell(r.maks)}</td><td>${cell(r.satuan)}</td><td>${cell(r.kondisi_uji)}</td><td>${esc(r.sumber.dokumen)}</td><td class="num">${l ? `<a href="${l}" target="_blank" rel="noopener">${esc(r.sumber.halaman)}</a>` : esc(r.sumber.halaman)}</td></tr>`; }).join("") : '<tr><td colspan="9" class="muted">Tidak ada hasil untuk filter ini.</td></tr>';
}
["#pText", "#pComp", "#pParam", "#pVal", "#pUnit", "#pDoc"].forEach(s => $(s).addEventListener("input", renderParams));

/* ---------- perbandingan ---------- */
let sel = new Set(["LM7805", "LM1117-5.0"]);
async function initCompare() {
  if ($("#chips").children.length) return;
  try { const d = await api("/parameters"); $("#chips").innerHTML = ""; d.components.forEach(c => { const b = document.createElement("button"); b.className = "chip" + (sel.has(c) ? " on" : ""); b.textContent = c; b.onclick = () => { sel.has(c) ? sel.delete(c) : sel.add(c); b.classList.toggle("on"); }; $("#chips").append(b); }); }
  catch (e) { $("#chips").textContent = e.message; }
}
$("#runCompare").onclick = async () => {
  if (sel.size < 2) return toast("Pilih minimal dua komponen.", "bad");
  const out = $("#cmpOut"); out.innerHTML = skeleton(6);
  try {
    const d = await api("/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ components: [...sel] }) });
    const cellH = v => !v ? '<span class="small-t">Tidak tersedia dalam dokumen</span>' : v.map(x => { const l = docLink(x.file, x.hal); return `<div>${esc(x.nilai)}<div class="small-t">${l ? `<a href="${l}" target="_blank" rel="noopener">${esc(x.sumber)}</a>` : esc(x.sumber)}</div></div>`; }).join("<hr style='border:0;border-top:1px dashed #e3e8f0'>");
    out.innerHTML = `<p>${esc(d.ringkasan)}</p><div class="banner">Data parameter belum diverifikasi manual terhadap PDF. Periksa datasheet asli sebelum memilih komponen.</div><div class="table-scroll"><table class="tbl"><thead><tr><th>Parameter</th>${d.components.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${d.rows.map(r => `<tr><td><b>${esc(r.parameter)}</b></td>${d.components.map(c => `<td>${cellH(r.nilai[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  } catch (e) { out.innerHTML = `<p class="notfound">${esc(e.message)}</p>`; toast(e.message, "bad"); }
};

/* ---------- pengaturan ---------- */
function applySettings() { document.body.classList.toggle("reduce", !!settings.motion); }
function renderSettings() {
  const s = window.__status; $("#setStatus").textContent = s ? (s.llm_configured ? "Model bahasa terhubung melalui backend." : "Mode demo: pengolah pertanyaan berbasis aturan + tabel parameter + pencarian dokumen. Model bahasa belum dikonfigurasi (isi ANTHROPIC_API_KEY di .env backend).") + ` Baris parameter: ${s.parameter_rows}, terverifikasi manual: ${s.verified_rows}.` : "Backend tidak terhubung.";
  $("#setSources").checked = settings.sources; $("#setMotion").checked = settings.motion;
}
$("#setSources").onchange = e => { settings.sources = e.target.checked; store.set("aea.settings", settings); };
$("#setMotion").onchange = e => { settings.motion = e.target.checked; store.set("aea.settings", settings); applySettings(); };
$("#clearAll").onclick = async () => { if (await modal({ title: "Hapus semua riwayat?", text: "Semua percakapan di peramban ini akan dihapus.", ok: "Hapus semua", danger: true })) { convs = []; saveConvs(); newChat(); toast("Riwayat dihapus", "ok"); } };

/* ---------- init ---------- */
applySettings(); renderHistory(); loadStatus(); autosize();

"""Ekstraksi teks, pengindeksan, dan pencarian (BM25) pada dokumen referensi.
Isi dokumen diperlakukan sebagai DATA, tidak pernah sebagai instruksi."""
import csv, io, json, math, re, threading, time, uuid
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
DOCS, UPLOADS = DATA / "documents", DATA / "uploads"
CACHE, UMETA = DATA / "index_cache.json", UPLOADS / "meta.json"
MAX_UPLOAD = 20 * 1024 * 1024
STOP = set("yang dan di ke dari untuk pada the of a an is are to in for and or dengan apa berapa bagaimana adalah itu ini saya".split())
ID_EN = {"kapasitor": "capacitor", "masukan": "input", "keluaran": "output", "fungsi": "function purpose",
         "panas": "thermal heat", "disipasi": "dissipation", "heatsink": "heat sink", "stabil": "stability",
         "stabilitas": "stability", "mengatur": "adjust resistor", "atur": "adjust resistor", "tegangan": "voltage",
         "arus": "current", "dioda": "diode", "penerapan": "application", "karakteristik": "characteristics",
         "rentang": "range", "suhu": "temperature", "beban": "load", "pelindung": "protection"}

def tokens(s):
    return [t for t in re.findall(r"[a-z0-9µψθ]+", s.lower()) if t not in STOP and len(t) > 1]

def expand(q):
    ws = tokens(q); out = list(ws)
    for w in ws:
        if w in ID_EN: out += tokens(ID_EN[w])
    return out

def extract_pdf(path):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(path)); pages = []
    for i in range(len(pdf)):
        pages.append((f"hal. {i+1}", pdf[i].get_textpage().get_text_range()))
    if not any(len(t.strip()) > 20 for _, t in pages):
        raise ValueError("PDF tidak memiliki teks yang dapat diekstrak (kemungkinan hasil pindai; OCR belum didukung).")
    return pages

def extract_text(path, ext):
    raw = Path(path).read_bytes()
    if b"\x00" in raw[:4096]: raise ValueError("Berkas bukan teks yang valid.")
    txt = raw.decode("utf-8-sig", errors="replace")
    if ext == ".csv":
        rows = list(csv.reader(io.StringIO(txt)))
        if not rows: raise ValueError("CSV kosong.")
        head = ", ".join(rows[0]); out = []
        for a in range(1, len(rows), 12):
            blk = rows[a:a + 12]
            out.append((f"baris {a+1}–{a+len(blk)}", head + "\n" + "\n".join(", ".join(r) for r in blk)))
        return out or [("baris 1", head)]
    if not txt.strip(): raise ValueError("Berkas teks kosong.")
    return [("bagian 1", txt)]

def chunk(pages, size=1100, step=900):
    for loc, text in pages:
        t = re.sub(r"\s+", " ", text).strip()
        for s in range(0, max(len(t), 1), step):
            piece = t[s:s + size]
            if len(piece) > 40: yield loc, piece
            if s + size >= len(t): break

class Index:
    def __init__(self):
        self.lock = threading.Lock(); self.chunks = []; self.df = Counter(); self.avg = 1
        self.status = {}          # id -> {status, error}
        self.ready = False
        self.uploads = json.loads(UMETA.read_text()) if UMETA.exists() else []

    # ---- metadata dokumen -------------------------------------------------
    def documents(self):
        meta = json.loads((DATA / "docs_meta.json").read_text(encoding="utf-8")); out = []
        for m in meta:
            p = DOCS / m["file"]; st = self.status.get(m["file"], {"status": "Menunggu"})
            out.append({"id": m["file"], "nama": m["nama"], "jenis": m["jenis"], "komponen": m["komponen"],
                        "ukuran": p.stat().st_size if p.exists() else 0, "bawaan": True, **st,
                        **({} if p.exists() else {"status": "Gagal", "error": "File tidak ditemukan di data/documents/."})})
        for u in self.uploads:
            st = self.status.get(u["id"], {"status": u.get("status", "Gagal"), "error": u.get("error")})
            out.append({**u, **st, "bawaan": False})
        return out

    def _save_uploads(self):
        UMETA.write_text(json.dumps(self.uploads, ensure_ascii=False))

    # ---- pembangunan indeks ----------------------------------------------
    def _add(self, doc_id, name, kind, pages):
        for loc, text in chunk(pages):
            self.chunks.append({"doc": doc_id, "nama": name, "loc": loc, "text": text, "kind": kind, "tok": tokens(text)})

    def _finalize(self):
        with self.lock:
            self.df = Counter(); 
            for c in self.chunks: self.df.update(set(c["tok"]))
            self.avg = (sum(len(c["tok"]) for c in self.chunks) / len(self.chunks)) if self.chunks else 1
            self.ready = True

    def build(self):
        """Dijalankan di thread latar. Status 'Berhasil' hanya setelah chunk benar-benar terindeks."""
        sig = {m["file"]: (DOCS / m["file"]).stat().st_size for m in json.loads((DATA / "docs_meta.json").read_text())
               if (DOCS / m["file"]).exists()}
        cached = json.loads(CACHE.read_text()) if CACHE.exists() else None
        for m in json.loads((DATA / "docs_meta.json").read_text(encoding="utf-8")):
            f = m["file"]; p = DOCS / f
            if not p.exists(): self.status[f] = {"status": "Gagal", "error": "File tidak ditemukan."}; continue
            self.status[f] = {"status": "Diproses"}
            try:
                if cached and cached.get("sig") == sig:
                    for c in cached["chunks"]:
                        if c["doc"] == f: self.chunks.append({**c, "tok": tokens(c["text"])})
                else:
                    self._add(f, m["nama"], "bawaan", extract_pdf(p))
                self.status[f] = {"status": "Berhasil"}
            except Exception as e:
                self.status[f] = {"status": "Gagal", "error": str(e)}
        for u in self.uploads:
            if u["id"] not in self.status: self._process_upload(u, save=False)
        self._finalize()
        if not (cached and cached.get("sig") == sig):
            CACHE.write_text(json.dumps({"sig": sig, "chunks": [{k: v for k, v in c.items() if k != "tok"}
                                         for c in self.chunks if c["kind"] == "bawaan"]}), encoding="utf-8")

    def _process_upload(self, u, save=True):
        self.status[u["id"]] = {"status": "Diproses"}
        try:
            path = UPLOADS / u["stored"]; ext = Path(u["stored"]).suffix.lower()
            pages = extract_pdf(path) if ext == ".pdf" else extract_text(path, ext)
            self._add(u["id"], u["nama"], "unggahan", pages)
            self.status[u["id"]] = {"status": "Berhasil"}
        except Exception as e:
            self.status[u["id"]] = {"status": "Gagal", "error": f"Gagal diproses: {e}"}
        u["status"] = self.status[u["id"]]["status"]; u["error"] = self.status[u["id"]].get("error")
        if save: self._finalize(); self._save_uploads()

    def add_upload(self, storage, filename, ext):
        uid = "u" + uuid.uuid4().hex[:10]; stored = f"{uid}{ext}"
        storage.save(UPLOADS / stored)
        size = (UPLOADS / stored).stat().st_size
        u = {"id": uid, "stored": stored, "nama": filename, "jenis": ext[1:].upper(), "komponen": "—", "ukuran": size}
        self.status[uid] = {"status": "Menunggu"}; self.uploads.append(u)
        threading.Thread(target=self._process_upload, args=(u,), daemon=True).start()
        return u

    def remove_upload(self, uid):
        u = next((x for x in self.uploads if x["id"] == uid), None)
        if not u: return False
        (UPLOADS / u["stored"]).unlink(missing_ok=True)
        self.uploads.remove(u); self.status.pop(uid, None)
        with self.lock: self.chunks = [c for c in self.chunks if c["doc"] != uid]
        self._finalize(); self._save_uploads(); return True

    # ---- pencarian --------------------------------------------------------
    def search(self, query, files=None, k=4, min_hits=2, min_score=4.0):
        q = Counter(expand(query)); n = len(self.chunks); res = []
        for c in self.chunks:
            if files and c["kind"] == "bawaan" and c["doc"] not in files: continue
            tf = Counter(c["tok"]); L = len(c["tok"]) or 1; s = 0.0; hits = 0
            for w in q:
                if w in tf:
                    idf = math.log(1 + (n - self.df[w] + .5) / (self.df[w] + .5))
                    s += idf * tf[w] * 2.5 / (tf[w] + 1.5 * (.25 + .75 * L / self.avg)); hits += 1
            if hits >= min_hits and s >= min_score: res.append((s, c))
        res.sort(key=lambda x: -x[0]); out = []; used = set()
        for s, c in res:
            key = (c["doc"], c["loc"])
            if key in used: continue
            used.add(key); out.append({"score": round(s, 2), "doc": c["doc"], "nama": c["nama"], "loc": c["loc"],
                                       "text": c["text"], "kind": c["kind"]})
            if len(out) >= k: break
        return out

def snippet(text, query, n=380):
    qs = set(expand(query)); best, bi = -1, 0
    sents = re.split(r"(?<=[.;:])\s+", text); pos = 0
    for s in sents:
        sc = sum(1 for w in tokens(s) if w in qs)
        if sc > best: best, bi = sc, pos
        pos += len(s) + 1
    return text[bi:bi + n].strip() + ("…" if bi + n < len(text) else "")

INDEX = Index()

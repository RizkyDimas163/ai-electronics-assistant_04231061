"""REST API + penyaji frontend. Jalankan: python backend/app.py"""
import os, sys, threading, time
from collections import defaultdict, deque
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
try:
    from dotenv import load_dotenv; load_dotenv(ROOT / ".env")
except ImportError:
    pass
from flask import Flask, jsonify, request, send_from_directory, send_file, abort
from werkzeug.utils import secure_filename
from services import parameters as P
from services.chat import answer, compare_pairs, topology_note, llm_configured
from services.retrieval import INDEX, MAX_UPLOAD, DOCS, UPLOADS

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD + 1024 * 1024
HITS = defaultdict(deque)

def limited(bucket, limit, window=60):
    key = (bucket, request.remote_addr); q = HITS[key]; now = time.time()
    while q and now - q[0] > window: q.popleft()
    if len(q) >= limit: return True
    q.append(now); return False

@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    if not request.path.startswith("/api/documents"):
        r.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
    return r

def err(msg, code=400): return jsonify({"error": msg}), code

@app.get("/api/status")
def status():
    docs = INDEX.documents()
    return jsonify({"mode": "llm" if llm_configured() else "demo", "llm_configured": llm_configured(), "index_ready": INDEX.ready,
                    "chunks": len(INDEX.chunks), "documents": len(docs), "parameter_rows": len(P.load()),
                    "verified_rows": sum(1 for r in P.load() if r["diverifikasi"])})

@app.post("/api/chat")
def chat():
    if limited("chat", 30): return err("Terlalu banyak permintaan. Coba lagi sebentar lagi.", 429)
    msg = (request.get_json(silent=True) or {}).get("message")
    if not isinstance(msg, str) or not msg.strip(): return err("Pesan tidak boleh kosong.")
    if len(msg) > 1000: return err("Pesan terlalu panjang (maks. 1000 karakter).")
    if not INDEX.ready: return err("Indeks dokumen masih diproses. Coba lagi beberapa saat.", 503)
    try: return jsonify(answer(msg.strip()))
    except Exception as e:
        app.logger.exception("chat gagal"); return err("Terjadi kesalahan saat memproses pertanyaan.", 500)

@app.get("/api/parameters")
def parameters(): return jsonify({"rows": [P.public(r) for r in P.load()], "components": P.COMPONENTS})

@app.post("/api/compare")
def compare():
    comps = (request.get_json(silent=True) or {}).get("components")
    if not isinstance(comps, list) or not 2 <= len(comps) <= 6 or any(c not in P.COMPONENTS for c in comps):
        return err("Pilih 2 sampai 6 komponen dari daftar yang tersedia.")
    rows = compare_pairs(comps)
    return jsonify({"components": comps, "rows": rows, "ringkasan": topology_note(comps)})

@app.get("/api/documents")
def documents(): return jsonify(INDEX.documents())

@app.post("/api/documents")
def upload():
    if limited("upload", 10): return err("Terlalu banyak unggahan. Coba lagi sebentar lagi.", 429)
    f = request.files.get("file")
    if not f or not f.filename: return err("Tidak ada berkas yang dipilih.")
    name = secure_filename(f.filename) or "dokumen"; ext = Path(name).suffix.lower()
    if ext not in (".pdf", ".csv", ".txt"): return err("Tipe berkas tidak didukung. Gunakan PDF, CSV, atau TXT.")
    head = f.stream.read(8); f.stream.seek(0)
    if ext == ".pdf" and not head.startswith(b"%PDF"): return err("Berkas bukan PDF yang valid.")
    if len(INDEX.uploads) >= 20: return err("Batas jumlah dokumen unggahan tercapai (20).")
    return jsonify(INDEX.add_upload(f, name, ext)), 202

@app.delete("/api/documents/<doc_id>")
def delete_doc(doc_id):
    if not doc_id.startswith("u"): return err("Dokumen bawaan tidak dapat dihapus.", 403)
    return (jsonify({"ok": True}) if INDEX.remove_upload(doc_id) else err("Dokumen tidak ditemukan.", 404))

@app.get("/api/documents/<doc_id>/file")
def doc_file(doc_id):
    path = None
    if doc_id.startswith("u"):
        u = next((x for x in INDEX.uploads if x["id"] == doc_id), None)
        path = UPLOADS / u["stored"] if u else None
    elif doc_id in {d["id"] for d in INDEX.documents() if d["bawaan"]}: path = DOCS / doc_id
    if not path or not path.exists(): abort(404)
    mime = {".pdf": "application/pdf", ".csv": "text/plain", ".txt": "text/plain"}[path.suffix.lower()]
    return send_file(path, mimetype=mime, download_name=path.name, as_attachment=False)

@app.get("/")
def index(): return send_from_directory(ROOT / "frontend", "index.html")

@app.get("/<path:name>")
def static_files(name):
    if name.startswith("api/"): abort(404)
    return send_from_directory(ROOT / "frontend", name)

threading.Thread(target=INDEX.build, daemon=True).start()
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", 5000)), debug=False)

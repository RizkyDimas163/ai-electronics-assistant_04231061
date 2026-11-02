"""Tabel parameter terstruktur (data/parameter.csv): satu-satunya sumber angka."""
import csv, re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
COMPONENTS = ["LM7805", "LM7812", "LM317", "LM1117-3.3", "LM1117-5.0", "LM2596-5.0"]
DOC_FILE = {"SNOSBT0L": "LM340-LM7805.pdf", "SLVS044Z": "LM317.pdf", "SNOS412Q": "LM1117.pdf",
            "SNVS124G": "LM2596.pdf", "SPRA953D": "SPRA953D.pdf", "SBVA025": "SBVA025.pdf"}
COMP_FILES = {"LM7805": ["LM340-LM7805.pdf"], "LM7812": ["LM340-LM7805.pdf"], "LM317": ["LM317.pdf"],
              "LM1117": ["LM1117.pdf"], "LM2596": ["LM2596.pdf"]}

_rows = None

def _num(s):
    try:
        return float(str(s).replace(",", "."))
    except (TypeError, ValueError):
        return None

def load():
    global _rows
    if _rows is not None:
        return _rows
    out = []
    with open(DATA / "parameter.csv", encoding="utf-8-sig", newline="") as f:
        for i, r in enumerate(csv.DictReader(f)):
            r = {k: (v or "").strip() for k, v in r.items() if k}
            if r["komponen"].startswith("LM2596 TO-263"):      # baris CSV dengan nama komponen bergeser
                r["komponen"] = "LM2596-xx"; r["parameter"] = "RθJA TO-263 (KTW)"
            if r["typ"].endswith("%") and not r["satuan"]:
                r["typ"], r["satuan"] = r["typ"][:-1], "%"
            code = next((c for c in DOC_FILE if c in r["dokumen"]), None)
            pg = re.search(r"\d+", r["halaman_pdf"])
            r.update(id=i + 1, file=DOC_FILE.get(code), hal=int(pg.group()) if pg else None,
                     diverifikasi=r.get("diverifikasi", "").upper() == "YA")
            out.append(r)
    _rows = out
    return out

def applies(rk, c):
    rk, c = rk.upper(), c.upper()
    if rk == c: return True
    if c.startswith("LM78") or c == "LM317": return c in [t.strip() for t in rk.split("/")]
    fam = c.split("-")[0]
    if not rk.startswith(fam): return False
    if c == fam: return True                 # famili tanpa varian: semua varian
    return "XX" in rk or "/" in rk

def rows_for(comp):
    return [r for r in load() if applies(r["komponen"], comp)]

def public(r):
    return {"id": r["id"], "komponen": r["komponen"], "parameter": r["parameter"], "simbol": r["simbol"],
            "kondisi_uji": r["kondisi_uji"], "min": r["min"], "typ": r["typ"], "maks": r["maks"],
            "satuan": r["satuan"], "catatan": r["catatan"], "diverifikasi": r["diverifikasi"],
            "sumber": {"dokumen": r["dokumen"], "halaman": r["halaman_pdf"], "file": r["file"], "hal": r["hal"]}}

KEYWORDS = [  # (pola pertanyaan, regex nama parameter)
    (r"rentang tegangan|tegangan (keluaran|output)|output voltage|vout", r"^(Rentang tegangan keluaran|Tegangan keluaran|Tegangan referensi)"),
    (r"tegangan (masukan|masuk|input)|input voltage|vin\b", r"^Tegangan masuk"),
    (r"arus (keluaran|output|maks)|output current|arus puncak|hubung singkat|batas arus", r"^(Arus keluaran|Arus puncak|Arus hubung|Batas arus|Arus beban)"),
    (r"dropout", r"^Dropout"), (r"efisiensi|efficiency", r"^Efisiensi"),
    (r"suhu|temperatur|temperature", r"^Suhu"), (r"ripple", r"^Ripple"),
    (r"line regulation", r"^Line regulation"), (r"load regulation", r"^Load regulation"),
    (r"arus diam|quiescent|standby", r"^Arus (diam|standby)"),
    (r"resistansi termal|thermal|r[θt]ja|ψ", r"^(RθJA|ψ)"), (r"frekuensi|frequency", r"^Frekuensi"),
    (r"saturasi", r"^Tegangan saturasi"), (r"noise|derau", r"^NOISE_TIDAK_ADA_DI_TABEL"),
]

def param_search(q, comps):
    """Kembalikan (baris, apakah_kata_kunci_parameter_dikenali)."""
    pats = [p for k, p in KEYWORDS if re.search(k, q)]
    if any("NOISE_TIDAK_ADA" in p for p in pats):   # parameter diminta tetapi tidak ada di tabel: jangan diganti parameter lain
        return [], True
    rows, seen = [], set()
    for c in comps:
        for r in rows_for(c):
            if r["id"] in seen: continue
            if not pats or any(re.search(p, r["parameter"]) for p in pats):
                rows.append(r); seen.add(r["id"])
    if "maks" in q and any("maksimum" in r["parameter"] for r in rows):
        rows = [r for r in rows if "maksimum" in r["parameter"]]
    rows.sort(key=lambda r: "maksimum" not in r["parameter"])
    return rows, bool(pats)

def tj_limits(comp):
    op = ab = None
    for r in rows_for(comp):
        if r["parameter"].startswith("Suhu junction"):
            if "maksimum" in r["parameter"]: ab = _num(r["maks"])
            elif "operasi" in r["parameter"]:
                n = re.findall(r"\d+(?:\.\d+)?", (r["maks"] or "") + " " + (r["typ"] or "")); op = _num(n[-1]) if n else None  # nilai tertera di kolom typ/maks
    return op, ab

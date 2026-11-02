"""Menjalankan 10 pertanyaan data/set-uji.csv dan membandingkan STATUS dengan yang diharapkan.
Hanya status yang diperiksa otomatis; isi jawaban harus dinilai manual terhadap kunci jawaban."""
import csv, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from services.retrieval import INDEX
from services.chat import answer
INDEX.build(); ok = 0
for r in csv.DictReader(open(Path(__file__).parent.parent / "data/set-uji.csv", encoding="utf-8-sig")):
    a = answer(r["pertanyaan"]); good = a["status"] == r["status_diharapkan"]; ok += good
    print(f"#{r['no']:>2} {'OK ' if good else 'GAGAL'} diharapkan={r['status_diharapkan']:<15} hasil={a['status']:<15} jenis={a['jenis']:<12} baris_tabel={len(a['tabel'])} sumber={len(a['sumber'])}")
print(f"\nStatus sesuai: {ok}/10")

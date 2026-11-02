# AI Electronics Assistant

Chatbot web untuk memahami datasheet regulator tegangan (LM7805, LM7812, LM317, LM1117-3.3/-5.0, LM2596-5.0) berdasarkan enam dokumen TI di `data/documents/`. Mengikuti `rancangan-sistem.md`: **angka hanya dari `data/parameter.csv`** (atau dihitung program); retrieval hanya untuk kutipan dan penjelasan.

## Menjalankan
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python backend/app.py                                   # buka http://127.0.0.1:5000
python tests/run_testset.py                             # cek status 10 pertanyaan data/set-uji.csv
```
Saat pertama dijalankan, backend mengekstrak teks PDF di thread latar (beberapa detik) dan menyimpan cache `data/index_cache.json`. Status di sidebar menunjukkan kemajuannya.

## Konfigurasi (opsional, untuk model bahasa)
Salin `.env.example` ke `.env`, isi `ANTHROPIC_API_KEY` (dan `ANTHROPIC_MODEL`). Kunci hanya dibaca backend. Tanpa kunci, aplikasi berjalan di **mode demo** dan diberi label jelas di UI.

## Struktur
```
frontend/   index.html, style.css, script.js
backend/    app.py  (REST: /api/chat, /api/documents, /api/parameters, /api/compare, /api/status)
services/   parameters.py (tabel parameter), retrieval.py (ekstraksi PDF/CSV/TXT + BM25), chat.py (intent, perhitungan, LLM opsional)
data/       parameter.csv, set-uji.csv, docs_meta.json, documents/ (PDF), uploads/
tests/      run_testset.py
```

## Sudah berfungsi (diuji)
- Chat, 4 kartu saran, riwayat (simpan, buka, ganti judul, hapus dengan konfirmasi) di localStorage, salin jawaban, tampil/sembunyi sumber, coba lagi, validasi input kosong, drawer mobile, `prefers-reduced-motion`.
- Pencarian parameter dari tabel (tanpa model): min/tip./maks terpisah, kondisi uji, halaman PDF; status `DILUAR_CAKUPAN`, `TIDAK_DITEMUKAN`, `PERLU_KLARIFIKASI`.
- Perhitungan `PD=(Vin−Vout)×Iout` dan `TJ=TA+RθJA×PD` per paket (TA=25 °C bila tidak disebut), pemeriksaan dropout.
- Halaman parameter (filter, urut), perbandingan (data hilang tampil “Tidak tersedia dalam dokumen”), dokumen (cari, lihat, unggah PDF/CSV/TXT; “Berhasil” hanya setelah terindeks).
- Rate limit, batas 20 MB, cek tipe dan magic bytes, escape HTML di semua keluaran, CSP.
- `tests/run_testset.py`: 10/10 **status** sesuai harapan. Ini hanya cek status; kebenaran isi jawaban tetap harus dinilai terhadap kunci jawaban.

## Belum / perlu konfigurasi
- **Model bahasa**: kodenya ada tetapi belum diuji (tidak ada kunci/jaringan saat pembuatan). Tanpa kunci, penjelasan berupa kutipan langsung (bahasa Inggris) dari dokumen.
- **Semua 83 baris `parameter.csv` berstatus `diverifikasi=TIDAK`**; UI menampilkannya. Pencocokan dengan PDF tetap tugas Anda.
- Pemahaman pertanyaan berbasis aturan (regex), bukan LLM; kalimat bebas yang kompleks bisa berujung permintaan klarifikasi.
- Belum ada: database server-side (pengguna, riwayat), autentikasi, OCR PDF pindai, DOCX, validator angka berbasis skema penuh. Dokumen unggahan hanya dipakai untuk kutipan, tidak masuk tabel parameter.
- Nilai 54 °C/W (catatan kaki LM340 hal. 4) hanya muncul sebagai catatan; belum ada di `parameter.csv`.
- Jangan mengunggah PDF TI ke repositori publik (`.gitignore` sudah mengecualikannya).

# Backfill Claim Docs — SIMRS

Script untuk **regenerasi dokumen klaim** versi baru (backend PDF service) untuk pasien final. Menggantikan dokumen lama yang di-render dari frontend.

## ⚙️ Cara Kerja

1. Login ke API → dapat token
2. Fetch list pasien (instalasi + periode + status final)
3. Untuk setiap pasien:
   - Tentukan dokumen yang relevan (berdasarkan `kd_instalasi`)
   - Hit `POST /v1.0/doc/generate` dengan `{ doc_type, params, format: 'pdf', options: { save_to_rm: true } }`
   - Backend generate + auto-save ke RM
4. Setiap task di-log ke `output/success.jsonl` atau `output/failed.jsonl`
5. Resume: kalau run ulang, task yang sudah sukses di-skip otomatis

## 🚀 Setup

```bash
cd scripts/backfill-claim-docs
npm install
cp .env.example .env
# edit .env sesuai kebutuhan
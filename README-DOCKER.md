# Push Docs — Docker Deployment

## Prasyarat
- Docker Engine 20.10+ / Docker Desktop
- Docker Compose v2 (bundled dengan Docker Desktop)
- File `.env` sudah dibuat dari `.env.example`

```powershell
Copy-Item .env.example .env
notepad .env   # isi API_BASE_URL, dll
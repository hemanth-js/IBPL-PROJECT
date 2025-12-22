# Emergency Blood Donor Platform

Full-stack app that lets hospitals broadcast urgent blood needs and matches them with registered donors in real time. The project is split into `backend` (Node/Express) and `frontend` (Vite/React) so it can be packaged as a web app or wrapped into a mobile container later.

## Quick start

```bash
# backend
cd backend
npm install           # already run once
echo PORT=4000> .env  # optional; defaults shown below
echo CORS_ORIGIN=http://localhost:5173>> .env
npm run dev           # starts API with nodemon

# frontend
cd ../frontend
npm install           # already run once
echo VITE_API_BASE=http://localhost:4000> .env.local
npm run dev           # opens on http://localhost:5173
```

## Backend (Express)

- Endpoints:
  - `GET /health`
  - `POST /api/donors` register donor
  - `GET /api/donors`
  - `PATCH /api/donors/:id/status` update availability / cooldown
  - `POST /api/requests` create hospital request
  - `GET /api/requests`
  - `POST /api/requests/:id/respond` donor accept/decline
  - `GET /api/match?bloodType=O%2B&city=Delhi` find eligible donors
- Data is persisted to `backend/data/db.json` (simple JSON store).
- Config (via `.env`):
  - `PORT` (default `4000`)
  - `CORS_ORIGIN` (default `*`, set to frontend URL in dev)

## Frontend (Vite + React)

- Routes:
  - Home overview
  - Donor registration form
  - Donor directory
  - Hospital emergency request form
  - Live requests list
  - Match finder (blood type + city)
- Config (via `.env.local`):
  - `VITE_API_BASE` (default `http://localhost:4000`)

## Notes

- Donation cooldown enforced at 90 days when calculating matches.
- When a donor accepts a request, they are marked `cooldown` and `lastDonationAt` is updated.
- To reset data, clear `backend/data/db.json` while the server is stopped.


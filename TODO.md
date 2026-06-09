# TODO - Google Geo Integration (Server-side)

- [ ] Implement Google Geocoding endpoint in `backend/server.js`
  - [ ] Create `GET /api/geocode?address=...` (or POST) using `GOOGLE_MAPS_API_KEY`
  - [ ] Validate input and return `{ lat, lng, formattedAddress }`

- [ ] Update matching flow to use geocoding when `geo` is missing
  - [ ] In `POST /api/requests`, accept `address` (or `location`) and geocode it
  - [ ] In `GET /api/match`, accept `address` (optional) and geocode if `lat/lng` absent

- [ ] Update frontend forms to collect address for donors/hospitals
  - [ ] Add an Address field to Donor Register and Hospital Request
  - [ ] Submit `address` to backend along with existing `city`

- [ ] Add user messaging for location capture/geocode
  - [ ] Indicate when geocoding is used vs GPS

- [ ] Run and verify
  - [ ] Ensure backend starts with new endpoint
  - [ ] Test: register donor with address -> create request with address -> confirm matching by distance works


const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');
const { v4: uuid } = require('uuid');
const twilio = require('twilio');
const fetch = require('node-fetch');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'blood_donor_platform';
const DONATION_COOLDOWN_DAYS = 90;

let mongoClient;
let db;

// Twilio initialization
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio SMS service initialized');
} else {
  console.log('⚠️  Twilio not configured - SMS messages will be logged to console only');
}

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.static('.'));

const toRad = (value) => (value * Math.PI) / 180;

const haversineKmDistance = (coord1, coord2) => {
  const { lat: lat1, lng: lon1 } = coord1 || {};
  const { lat: lat2, lng: lon2 } = coord2 || {};
  if (
    typeof lat1 !== 'number' ||
    typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lon2 !== 'number'
  ) {
    return null;
  }

  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// SMS sender with Twilio support
const sendSMS = async (phoneNumber, message) => {

  try {
    // Always log the message to console for debugging
    console.log(`📱 [SMS] To: ${phoneNumber}`);
    console.log(`   Message: ${message}`);

    if (!twilioClient || !TWILIO_PHONE_NUMBER) {
      // Demo mode: only log to console
      return true;
    }

    // Send via Twilio
    const result = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: phoneNumber,
    });
    console.log(`✅ SMS sent to ${phoneNumber} (SID: ${result.sid})`);
    return true;
  } catch (error) {
    console.error(`❌ SMS send failed to ${phoneNumber}: ${error.message}`);
    return false;
  }
};



// MongoDB connection
const connectDB = async () => {
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('💡 To fix this:');
    console.log('   1. For local MongoDB: Install and start MongoDB locally');
    console.log('   2. For cloud MongoDB: Use MongoDB Atlas (free):');
    console.log('      - Go to https://www.mongodb.com/atlas');
    console.log('      - Create a free cluster');
    console.log('      - Get your connection string and update MONGODB_URI in .env');
    console.log('   3. Update your .env file with: MONGODB_URI="your_connection_string"');
    process.exit(1);
  }
};

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/geocode', async (req, res) => {
  try {
    const { address } = req.query || {};
    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({ error: 'address query parameter is required' });
    }

    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(503).json({ error: 'Geocoding service not available (GOOGLE_MAPS_API_KEY missing)', available: false });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to reach Google Geocoding API' });
    }

    const data = await response.json();
    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      return res.status(400).json({ error: 'Unable to geocode address', status: data.status || null });
    }

    const result = data.results[0];
    const location = result?.geometry?.location;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Geocoding returned invalid coordinates' });
    }

    return res.json({
      lat,
      lng,
      formattedAddress: result.formatted_address || null,
      accuracy: data.results?.length ? 'approx' : null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Geocoding failed', details: e?.message || String(e) });
  }
});


app.post('/api/donors', async (req, res) => {
  const {
    name,
    bloodType,
    city,
    phone,
    email,
    consent,
    lastDonationAt,
    geo,
  } = req.body || {};


  if (!name || !bloodType || !city || !phone) {
    return res.status(400).json({ error: 'name, bloodType, city, and phone are required' });
  }

  if (consent !== true) {
    return res.status(400).json({ error: 'consent is required' });
  }

  const lastDonationDate = lastDonationAt ? new Date(lastDonationAt) : null;
  const inCooldown =
    !!lastDonationDate &&
    !Number.isNaN(lastDonationDate.getTime()) &&
    lastDonationDate.getTime() >
      Date.now() - DONATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  const donor = {
    id: uuid(),
    name,
    bloodType: bloodType.toUpperCase(),
    city,
    phone,
    email: email || null,
    consent: true,
    availabilityStatus: inCooldown ? 'cooldown' : 'available',
    lastDonationAt: lastDonationDate && !Number.isNaN(lastDonationDate.getTime()) ? lastDonationDate.toISOString() : null,
    geo: geo || null,
    createdAt: new Date().toISOString(),
  };


  await db.collection('donors').insertOne(donor);
  res.status(201).json(donor);
});

app.get('/api/donors', async (_req, res) => {
  const donors = await db.collection('donors').find({}).toArray();
  res.json(donors);
});

app.patch('/api/donors/:id/status', async (req, res) => {
  const { status, lastDonationAt } = req.body || {};
  const updateFields = {};
  if (status) updateFields.availabilityStatus = status;
  if (lastDonationAt) updateFields.lastDonationAt = lastDonationAt;

  const result = await db.collection('donors').findOneAndUpdate(
    { id: req.params.id },
    { $set: updateFields },
    { returnDocument: 'after' }
  );
  if (!result.value) return res.status(404).json({ error: 'donor not found' });
  res.json(result.value);
});

app.post('/api/requests', async (req, res) => {
  const {
    hospitalName,
    contactPerson,
    phone,
    city,
    address,
    bloodType,
    unitsNeeded = 1,
    urgency = 'high',
    radiusKm = 25,
    geo,
  } = req.body || {};

  if (!hospitalName || !contactPerson || !phone || !bloodType) {
    return res
      .status(400)
      .json({ error: 'hospitalName, contactPerson, phone, and bloodType are required' });
  }

  const effectiveCity = city || address || '';

  if (!effectiveCity.trim()) {
    return res.status(400).json({ error: 'city or address is required' });
  }


  // Resolve geo server-side if browser GPS geo isn't provided.
  let resolvedGeo = geo || null;

  if ((!resolvedGeo || typeof resolvedGeo.lat !== 'number' || typeof resolvedGeo.lng !== 'number') && address && typeof address === 'string' && address.trim()) {
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    
    // Try to geocode if API key is available, otherwise fall back to city-based matching
    if (GOOGLE_MAPS_API_KEY) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'OK' && data.results && data.results.length > 0) {
            const location = data.results[0]?.geometry?.location;
            const lat = Number(location?.lat);
            const lng = Number(location?.lng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              resolvedGeo = { lat, lng };
            }
          }
        }
      } catch (error) {
        console.log('⚠️  Geocoding failed, falling back to city-based matching:', error.message);
      }
    } else {
      console.log('⚠️  Google Maps API key not configured, using city-based matching');
    }
  }

  const request = {
    id: uuid(),
    hospitalName,
    contactPerson,
    phone,
    city: effectiveCity,
    bloodType: bloodType.toUpperCase(),
    unitsNeeded,
    urgency,
    radiusKm,
    geo: resolvedGeo || null,
    status: 'open',
    responses: [],
    createdAt: new Date().toISOString(),
  };

  await db.collection('requests').insertOne(request);


  // Find and notify matching donors
  const baseQuery = {
    bloodType: bloodType.toUpperCase(),
    $or: [
      { lastDonationAt: null },
      { lastDonationAt: { $exists: false } },
      { lastDonationAt: { $lte: new Date(Date.now() - DONATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) } },
    ],
    availabilityStatus: 'available'
  };

  // Match by city always. If request has geo, then additionally filter by distance
  // only among donors that have geo. If request has no geo, fall back to city-only matching.
  const normalizedCity = String(effectiveCity).trim();
  const escapedCity = normalizedCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  const donorsInCity = await db.collection('donors').find({
    ...baseQuery,
    city: new RegExp(`^${escapedCity}$`, 'i'),
  }).toArray();

  let matchingDonors = donorsInCity;
  if (resolvedGeo && typeof resolvedGeo.lat === 'number' && typeof resolvedGeo.lng === 'number') {
    matchingDonors = donorsInCity.filter((d) => {
      if (!d.geo) return false;
      const km = haversineKmDistance(resolvedGeo, d.geo);
      return typeof km === 'number' && km <= radiusKm;
    });
  }


  console.log(
    `Matching donors found: ${matchingDonors.length} for bloodType: ${bloodType}, city: ${effectiveCity}, radiusKm: ${radiusKm}`
  );


  // Send SMS to matching donors
  matchingDonors.forEach((donor) => {

    const message = `🩸 URGENT: ${hospitalName} needs ${bloodType} blood (${unitsNeeded} units). Contact: ${contactPerson} - ${phone}. Reply YES to help.`;
    sendSMS(donor.phone, message);
  });

  res.status(201).json({
    request,
    notificationsSent: matchingDonors.length,
    matchingDonors: matchingDonors.map(d => ({ id: d.id, name: d.name, phone: d.phone }))
  });
});

app.get('/api/requests', async (_req, res) => {
  const requests = await db.collection('requests').find({}).toArray();
  res.json(requests);
});

app.delete('/api/requests/:id', async (req, res) => {
  const result = await db.collection('requests').deleteOne({ id: req.params.id });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'request not found' });
  res.json({ message: 'Request deleted successfully' });
});

app.post('/api/requests/:id/respond', async (req, res) => {
  const { donorId, response } = req.body || {};
  if (!donorId || !response) return res.status(400).json({ error: 'donorId and response required' });

  const request = await db.collection('requests').findOne({ id: req.params.id });
  if (!request) return res.status(404).json({ error: 'request not found' });

  const donor = await db.collection('donors').findOne({ id: donorId });
  if (!donor) return res.status(404).json({ error: 'donor not found' });

  const newResponse = {
    donorId,
    response,
    respondedAt: new Date().toISOString(),
  };

  await db.collection('requests').updateOne(
    { id: req.params.id },
    { $push: { responses: newResponse } }
  );

  if (response === 'accept') {
    await db.collection('donors').updateOne(
      { id: donorId },
      {
        $set: {
          lastDonationAt: new Date().toISOString(),
          availabilityStatus: 'cooldown'
        }
      }
    );
  }

  const updatedRequest = await db.collection('requests').findOne({ id: req.params.id });
  const updatedDonor = await db.collection('donors').findOne({ id: donorId });
  res.json({ request: updatedRequest, donor: updatedDonor });
});

app.get('/api/match', async (req, res) => {
  const { bloodType, city, lat, lng, radiusKm } = req.query;

  if (!bloodType || !city) {
    return res.status(400).json({ error: 'bloodType and city are required' });
  }

  const radius = radiusKm ? Number(radiusKm) : 25;
  const normalizedCity = String(city).trim();
  const escapedCity = normalizedCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const eligibleBaseQuery = {
    bloodType: bloodType.toUpperCase(),
    city: new RegExp(`^${escapedCity}$`, 'i'),
    $or: [
      { lastDonationAt: null },
      { lastDonationAt: { $exists: false } },
      { lastDonationAt: { $lte: new Date(Date.now() - DONATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) } },
    ],
    availabilityStatus: 'available'
  };

  const eligible = await db.collection('donors').find(eligibleBaseQuery).toArray();

  // Distance mode if lat/lng are provided; otherwise return city matches.
  const hasLatLng = lat !== undefined && lng !== undefined;
  if (hasLatLng) {
    const requestGeo = {
      lat: Number(lat),
      lng: Number(lng),
    };

    const filtered = eligible.filter((d) => {
      if (!d.geo) return false;
      const km = haversineKmDistance(requestGeo, d.geo);
      return typeof km === 'number' && km <= radius;
    });

    return res.json({ total: filtered.length, donors: filtered });
  }

  res.json({ total: eligible.length, donors: eligible });
});


app.listen(PORT, async () => {
  console.log(`Backend running on port ${PORT}`);
  await connectDB();
});


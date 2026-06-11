const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');
const { v4: uuid } = require('uuid');
const twilio = require('twilio');
// node-fetch v3 is ESM-only. Provide a compatible fetch wrapper for CommonJS.
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'blood_donor_platform';
const DONATION_COOLDOWN_DAYS = 90;

let mongoClient;
let db;

// SMS provider initialization
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;

let twilioClient = null;
if (FAST2SMS_API_KEY) {
  console.log('✅ Fast2SMS service initialized');
}

if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio SMS service initialized');
}

if (!FAST2SMS_API_KEY && !twilioClient) {
  console.log('⚠️  SMS provider not configured - SMS messages will be logged to console only');
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

const normalizeBloodType = (value) => String(value || '').trim().toUpperCase();

const normalizeCity = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const isEligibleByDonationDate = (donor) => {
  if (donor.availabilityStatus !== 'available') return false;
  if (!donor.lastDonationAt) return true;

  const lastDonationDate = new Date(donor.lastDonationAt);
  if (Number.isNaN(lastDonationDate.getTime())) return true;

  return (
    lastDonationDate.getTime() <=
    Date.now() - DONATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  );
};

const hasValidGeo = (geo) =>
  geo &&
  typeof geo.lat === 'number' &&
  typeof geo.lng === 'number' &&
  Number.isFinite(geo.lat) &&
  Number.isFinite(geo.lng);

const findMatchingDonors = async ({ bloodType, city, geo, radiusKm = 25 }) => {
  const normalizedBloodType = normalizeBloodType(bloodType);
  const normalizedCity = normalizeCity(city);
  const radius = Number(radiusKm);
  const effectiveRadius = Number.isFinite(radius) && radius > 0 ? radius : 25;

  const candidates = await db.collection('donors').find({
    bloodType: normalizedBloodType,
    availabilityStatus: 'available',
  }).toArray();

  return candidates.filter((donor) => {
    if (!isEligibleByDonationDate(donor)) return false;

    const cityMatches =
      normalizedCity &&
      normalizeCity(donor.city) === normalizedCity;

    const distanceMatches =
      hasValidGeo(geo) &&
      hasValidGeo(donor.geo) &&
      haversineKmDistance(geo, donor.geo) <= effectiveRadius;

    return cityMatches || distanceMatches;
  });
};

// SMS sender with Fast2SMS primary and Twilio fallback
const normalizeSmsPhoneNumber = (phoneNumber) => {
  const raw = String(phoneNumber || '').trim();
  if (!raw) return null;
  if (raw.startsWith('+')) return raw.replace(/[^\d+]/g, '');

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return digits ? `+${digits}` : null;
};

const normalizeFast2SmsPhoneNumber = (phoneNumber) => {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
};

const getSmsMode = () => {
  if (FAST2SMS_API_KEY) return 'fast2sms';
  if (twilioClient && TWILIO_PHONE_NUMBER) return 'twilio';
  return 'console';
};

const sendSMS = async (phoneNumber, message) => {
  const to = normalizeSmsPhoneNumber(phoneNumber);
  const fast2SmsTo = normalizeFast2SmsPhoneNumber(phoneNumber);

  try {
    // Always log the message to console for debugging
    console.log(`📱 [SMS] To: ${to || phoneNumber}`);
    console.log(`   Message: ${message}`);

    if (!to && !fast2SmsTo) {
      console.error(`❌ SMS skipped: invalid phone number "${phoneNumber}"`);
      return { ok: false, mode: 'invalid', phone: phoneNumber, error: 'Invalid phone number' };
    }

    if (FAST2SMS_API_KEY) {
      if (!fast2SmsTo) {
        console.error(`❌ Fast2SMS skipped: phone number must be a valid Indian mobile number "${phoneNumber}"`);
        return { ok: false, mode: 'fast2sms', phone: phoneNumber, error: 'Invalid Indian mobile number' };
      }

      // Fast2SMS expects Indian mobile without +91 for numbers
      // Use route 'v3' for SMS (most accounts) to avoid "transaction limit" issues tied to wrong route.
      // If your account requires a specific route, you can change it back.
      const params = new URLSearchParams({
        authorization: FAST2SMS_API_KEY,
        route: 'v3',
        message,
        numbers: fast2SmsTo,
      });

      const response = await fetch(`https://www.fast2sms.com/dev/bulkV2?${params.toString()}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      const data = await response.json().catch(() => null);

      if (response.ok && data?.return !== false) {
        console.log(`✅ Fast2SMS request accepted for ${fast2SmsTo}`);
        console.log('   Fast2SMS response:', JSON.stringify(data));
        return { ok: true, mode: 'fast2sms', phone: fast2SmsTo, response: data };
      }

      const errorMessage = data?.message || data?.error || `Fast2SMS HTTP ${response.status}`;
      console.error(`❌ Fast2SMS send failed to ${fast2SmsTo}: ${errorMessage}`);
      console.error('   Fast2SMS response:', JSON.stringify(data));
      return { ok: false, mode: 'fast2sms', phone: fast2SmsTo, error: errorMessage, response: data };
    }

    if (!twilioClient || !TWILIO_PHONE_NUMBER) {
      // Demo mode: only log to console
      return { ok: true, mode: 'logged', phone: to };
    }

    // Send via Twilio
    const result = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to,
    });
    console.log(`✅ SMS sent to ${to} (SID: ${result.sid})`);
    return { ok: true, mode: 'twilio', phone: to, sid: result.sid };
  } catch (error) {
    console.error(`❌ SMS send failed to ${to || phoneNumber}: ${error.message}`);
    return { ok: false, mode: getSmsMode(), phone: to || phoneNumber, error: error.message };
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
    name: String(name).trim(),
    bloodType: normalizeBloodType(bloodType),
    city: String(city).trim(),
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

  const effectiveCity = String(city || address || '').trim();

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
    bloodType: normalizeBloodType(bloodType),
    unitsNeeded,
    urgency,
    radiusKm,
    geo: resolvedGeo || null,
    status: 'open',
    responses: [],
    createdAt: new Date().toISOString(),
  };

  await db.collection('requests').insertOne(request);


  // Pull matching donors
  const matchingDonors = await findMatchingDonors({
    bloodType,
    city: effectiveCity,
    geo: resolvedGeo,
    radiusKm,
  });


  console.log(
    `Matching donors found: ${matchingDonors.length} for bloodType: ${normalizeBloodType(bloodType)}, city: ${effectiveCity}, radiusKm: ${radiusKm}`
  );


  // Send SMS to matching donors
  const smsMessage = `URGENT: ${hospitalName} needs ${bloodType} blood (${unitsNeeded} units). Contact: ${contactPerson} - ${phone}. Reply YES to help.`;

  console.log('📣 SMS broadcast starting');
  console.log(`   smsMode=${getSmsMode()}`);
  console.log(`   effectiveCity=${effectiveCity}`);
  console.log(`   matchingDonors=${matchingDonors.length}`);
  console.log(`   message=${smsMessage}`);

  const smsResults = await Promise.all(
    matchingDonors.map((donor) => sendSMS(donor.phone, smsMessage))
  );

  const successfulNotifications = smsResults.filter((result) => result && result.ok).length;

  // Persist sms results into the request for debugging
  await db.collection('requests').updateOne(
    { id: request.id },
    {
      $set: {
        smsMode: getSmsMode(),
        smsMessage,
        notificationsSent: successfulNotifications,
        notificationsAttempted: smsResults.length,
        smsResults,
        lastSmsBroadcastAt: new Date().toISOString(),
      },
    }
  );

  res.status(201).json({
    request,
    notificationsSent: successfulNotifications,
    notificationsAttempted: smsResults.length,
    smsMode: getSmsMode(),
    smsResults,
    matchingDonors: matchingDonors.map((d) => ({ id: d.id, name: d.name, phone: d.phone })),
    warning:
      getSmsMode() === 'console'
        ? 'SMS provider not configured on server (FAST2SMS_API_KEY and Twilio env vars missing). Messages were only logged to console.'
        : undefined,
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
  const requestGeo =
    lat !== undefined && lng !== undefined
      ? {
          lat: Number(lat),
          lng: Number(lng),
        }
      : null;

  const matchingDonors = await findMatchingDonors({
    bloodType,
    city,
    geo: requestGeo,
    radiusKm: radius,
  });

  res.json({ total: matchingDonors.length, donors: matchingDonors });
});


app.listen(PORT, async () => {
  console.log(`Backend running on port ${PORT}`);
  await connectDB();
});


const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');
const { v4: uuid } = require('uuid');
const twilio = require('twilio');
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

app.post('/api/donors', async (req, res) => {
  const { name, bloodType, city, phone, email, availabilityStatus = 'available' } = req.body || {};
  if (!name || !bloodType || !city || !phone) {
    return res.status(400).json({ error: 'name, bloodType, city, and phone are required' });
  }

  const donor = {
    id: uuid(),
    name,
    bloodType: bloodType.toUpperCase(),
    city,
    phone,
    email: email || null,
    availabilityStatus,
    lastDonationAt: null,
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
    bloodType,
    unitsNeeded = 1,
    urgency = 'high',
    radiusKm = 25,
  } = req.body || {};

  if (!hospitalName || !contactPerson || !phone || !city || !bloodType) {
    return res
      .status(400)
      .json({ error: 'hospitalName, contactPerson, phone, city, and bloodType are required' });
  }

  const request = {
    id: uuid(),
    hospitalName,
    contactPerson,
    phone,
    city,
    bloodType: bloodType.toUpperCase(),
    unitsNeeded,
    urgency,
    radiusKm,
    status: 'open',
    responses: [],
    createdAt: new Date().toISOString(),
  };
  await db.collection('requests').insertOne(request);

  // Find and notify matching donors
  const matchingDonors = await db.collection('donors').find({
    bloodType: bloodType.toUpperCase(),
    city: new RegExp(`^${city}$`, 'i'),
    $or: [
      { lastDonationAt: null },
      { lastDonationAt: { $exists: false } },
      { lastDonationAt: { $lte: new Date(Date.now() - DONATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) } }
    ],
    availabilityStatus: 'available'
  }).toArray();

  console.log(`Matching donors found: ${matchingDonors.length} for bloodType: ${bloodType}, city: ${city}`);

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
  const { bloodType, city } = req.query;
  if (!bloodType || !city) {
    return res.status(400).json({ error: 'bloodType and city are required' });
  }

  const eligible = await db.collection('donors').find({
    bloodType: bloodType.toUpperCase(),
    city: new RegExp(`^${city}$`, 'i'),
    $or: [
      { lastDonationAt: null },
      { lastDonationAt: { $exists: false } },
      { lastDonationAt: { $lte: new Date(Date.now() - DONATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) } }
    ],
    availabilityStatus: 'available'
  }).toArray();

  res.json({ total: eligible.length, donors: eligible });
});

app.listen(PORT, async () => {
  console.log(`Backend running on port ${PORT}`);
  await connectDB();
});


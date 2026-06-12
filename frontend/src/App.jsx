import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom';
import './App.css';
import './index.css';
import './donor-dropdown.css';
import { api, endpoints } from './api';

const Page = ({ title, children }) => (
  <div className="page">
    <header className="page-header">
      <h1>{title}</h1>
      <p className="eyebrow">Real-time emergency blood donor network</p>
    </header>
    <div className="card">{children}</div>
  </div>
);

const InfoPill = ({ label, value }) => (
  <div className="pill">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const Home = () => {
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const isInstallable = !!installPrompt;

  const onInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  return (
    <Page title="Emergency Blood Donor Platform">
      <div className="grid">
        <section className="stack">
          <h3>For Hospitals</h3>
          <ul>
            <li>Broadcast urgent requests to matching donors nearby</li>
            <li>Track responses in real time</li>
            <li>See donor verification and cooldown status</li>
          </ul>
          <Link className="button primary" to="/hospital/request">
            Create an emergency request
          </Link>
        </section>
        <section className="stack">
          <h3>For Donors</h3>
          <ul>
            <li>Register once, get relevant alerts only</li>
            <li>Accept/decline with one tap</li>
            <li>Keep availability up to date</li>
          </ul>
          <Link className="button secondary" to="/donor/register">
            Register as donor
          </Link>
        </section>
      </div>

      <div className="highlight">
        <InfoPill label="Donation cooldown" value="90 days" />
        <InfoPill label="Smart matching" value="Blood type + city" />
        <InfoPill label="Built for emergencies" value="24/7 ready" />
      </div>

      <div className="install-wrap">
        <button className="button ghost install-btn" onClick={onInstall} disabled={!isInstallable}>
          {isInstallable ? 'Install app' : 'Install app (optional)'}
        </button>
      </div>
    </Page>
  );
};


const bloodTypes = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
];

const DonorRegister = () => {
  const [form, setForm] = useState({
    name: '',
    bloodType: '',
    city: '',
    address: '',
    phone: '',
    email: '',
    lastDonationAt: '', // ISO date string or ''
    age: '', // age in years
    consent: false,
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [geo, setGeo] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);

  const getMyLocation = async () => {
    if (!navigator.geolocation) {
      setMessage('Geolocation is not supported in this browser.');
      return;
    }
    setMessage('');
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: new Date(pos.timestamp).toISOString(),
        };
        setGeo(next);
        setGeoLoading(false);
        setMessage('Location captured.');
      },
      (err) => {
        setGeoLoading(false);
        setMessage(err?.message ? `Location error: ${err.message}` : 'Failed to get location.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };


  const submit = async (e) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const ageNumber = form.age ? Number(form.age) : null;
      if (ageNumber === null || Number.isNaN(ageNumber) || ageNumber < 18) {
        setMessage('You must be 18 years or older to register as a donor.');
        setLoading(false);
        return;
      }

      const payload = {
        name: form.name,
        bloodType: form.bloodType,
        city: form.city,
        address: form.address || undefined,
        phone: form.phone,
        email: form.email || null,
        consent: form.consent,
        age: ageNumber,
        lastDonationAt: form.lastDonationAt ? new Date(form.lastDonationAt).toISOString() : null,
        geo: geo || null,
      };



      await api.post(endpoints.donors, payload);
      setMessage('Registered! You will now get alerts that match.');
      setForm({ name: '', bloodType: '', city: '', address: '', phone: '', email: '', lastDonationAt: '', age: '', consent: false });
      // Ensure donor list shows newest entry immediately after registering
      try {
        await api.get(endpoints.donors);
      } catch {
        // ignore
      }
    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to register donor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page title="Donor registration">
      <form className="stack" onSubmit={submit}>
        <div className="form-section">
          <h2 className="section-title">Your details</h2>
        <div className="grid two">
            <label>
              Full name
              <input
                required
                value={form.name}
                autoComplete="name"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Blood type
              <select
                required
                value={form.bloodType}
                onChange={(e) => setForm({ ...form, bloodType: e.target.value })}
              >
                <option value="" disabled>
                  Select blood group
                </option>
                {bloodTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span className="field-hint">Used for smart matching.</span>
            </label>
            <label>
              City (fallback)
              <input
                required
                value={form.city}
                autoComplete="address-level2"
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </label>

            <label>
              Age (must be 18+)
              <input
                required
                type="number"
                min="18"
                max="120"
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
                placeholder="e.g. 23"
                inputMode="numeric"
              />
              <span className="field-hint">We only accept donors who are 18 years or older.</span>
            </label>

            <label>
              Address / location (recommended)
              <input
                value={form.address}
                placeholder="House/Street, Area, City"
                autoComplete="street-address"
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
              <span className="field-hint">Used to compute distance via Google geocoding.</span>
            </label>
            <label>
              Phone
              <input
                required
                value={form.phone}
                inputMode="tel"
                autoComplete="tel"
                placeholder="e.g. +91 98765 43210"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <span className="field-hint">We send urgent alerts by SMS.</span>
            </label>

            <label>
              Email (optional)
              <input
                type="email"
                value={form.email}
                autoComplete="email"
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <h2 className="section-title">Donation profile</h2>
          <div className="grid two">
            <label>
              Last donation date
              <input
                type="date"
                value={form.lastDonationAt}
                onChange={(e) => setForm({ ...form, lastDonationAt: e.target.value })}
              />
              <span className="field-hint">Leave empty if you have never donated.</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.consent}
                onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                required
              />
              <span>
                I confirm I am eligible to donate and consent to be contacted for emergency blood needs.
              </span>
            </label>
          </div>
        </div>

          <div className="form-section" style={{ padding: 0 }}>
            <button type="button" className="button ghost" onClick={getMyLocation} disabled={geoLoading}>
              {geoLoading ? 'Getting location…' : geo ? 'Use another location' : 'Use my location'}
            </button>
            {geo && (
              <p className="field-hint" style={{ marginTop: 8 }}>
                Location saved (±{Math.round(geo.accuracy)}m)
              </p>
            )}
          </div>

          <button className="button primary" disabled={loading}>
            {loading ? 'Registering…' : 'Register donor'}
          </button>
          {message && <p className="status">{message}</p>}

      </form>
    </Page>
  );
};

const HospitalRequest = () => {
  const [form, setForm] = useState({
    hospitalName: '',
    contactPerson: '',
    phone: '',
    city: '',
    address: '',
    bloodType: '',
    unitsNeeded: 1,
    urgency: 'high',
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [matchingDonors, setMatchingDonors] = useState([]);
  const [showDonorsDropdown, setShowDonorsDropdown] = useState(false);
  const [lastRequestId, setLastRequestId] = useState(null);

  const [geo, setGeo] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);


  const getMyLocation = async () => {
    if (!navigator.geolocation) {
      setMessage('Geolocation is not supported in this browser.');
      return;
    }
    setMessage('');
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: new Date(pos.timestamp).toISOString(),
        };
        setGeo(next);
        setGeoLoading(false);
        setMessage('Location captured.');
      },
      (err) => {
        setGeoLoading(false);
        setMessage(err?.message ? `Location error: ${err.message}` : 'Failed to get location.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };


  const submit = async (e) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const payload = {
        ...form,
        geo: geo || undefined,
        address: form.address || undefined,
      };


      const response = await api.post(endpoints.requests, payload);
      const {
        notificationsAttempted = 0,
        smsMode,
        matchingDonors = [],
      } = response.data || {};
      const modeLabel =
        smsMode === 'fast2sms'
          ? 'Fast2SMS'
          : smsMode === 'twilio'
            ? 'Twilio SMS'
            : 'console SMS log';
      const triggeredCount = notificationsAttempted || matchingDonors.length;
      setMessage(
        `Request created. ${triggeredCount} donor notification${triggeredCount === 1 ? '' : 's'} triggered by ${modeLabel}.`
      );

      const updatedMatchingDonors = response.data?.matchingDonors || [];
      setMatchingDonors(updatedMatchingDonors);
      setShowDonorsDropdown(true);
      setLastRequestId(response.data?.request?.id || null);

      setForm({
        hospitalName: '',
        contactPerson: '',
        phone: '',
        city: '',
        address: '',
        bloodType: '',
        unitsNeeded: 1,
        urgency: 'high',
      });

    } catch (e) {
      setMessage(e.response?.data?.error || 'Failed to send request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page title="Hospital emergency request">
      <form className="stack" onSubmit={submit}>
        <div className="grid two">
          <label>
            Hospital name
            <input
              required
              value={form.hospitalName}
              onChange={(e) => setForm({ ...form, hospitalName: e.target.value })}
            />
          </label>
          <label>
            Contact person
            <input
              required
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label>
            City (fallback)
            <input
              required
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </label>
          <label>
            Address / location (recommended)
            <input
              value={form.address}
              placeholder="Hospital street, area, city"
              autoComplete="street-address"
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </label>

          <label>
            Blood type
            <input
              required
              placeholder="e.g. O+, A-"
              value={form.bloodType}
              onChange={(e) => setForm({ ...form, bloodType: e.target.value })}
            />
          </label>
          <label>
            Units needed
            <input
              type="number"
              min="1"
              value={form.unitsNeeded}
              onChange={(e) => setForm({ ...form, unitsNeeded: Number(e.target.value) })}
            />
          </label>
          <label>
            Urgency
            <select
              value={form.urgency}
              onChange={(e) => setForm({ ...form, urgency: e.target.value })}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>
        <div className="form-section" style={{ padding: 0 }}>
          <button type="button" className="button ghost" onClick={getMyLocation} disabled={geoLoading}>
            {geoLoading ? 'Getting location…' : geo ? 'Use another location' : 'Use my location'}
          </button>
          {geo && (
            <p className="field-hint" style={{ marginTop: 8 }}>
              Location saved (±{Math.round(geo.accuracy)}m)
            </p>
          )}
        </div>

        <button className="button primary" disabled={loading}>
          {loading ? 'Sending...' : 'Broadcast request'}
        </button>

        {message && <p className="status">{message}</p>}
      </form>

      {showDonorsDropdown && (
        <div style={{ marginTop: 18 }}>
          <div className="donor-dropdown-header">
            <button
              type="button"
              className="button secondary"
              onClick={() => setShowDonorsDropdown((v) => !v)}
            >
              {matchingDonors.length > 0
                ? `Matching donors (${matchingDonors.length})`
                : 'Matching donors (none found)'}
            </button>
            {lastRequestId && <span className="muted">Request ID: {lastRequestId}</span>}
          </div>

          {matchingDonors.length > 0 ? (
            <div className="donor-dropdown-list">
              {matchingDonors.map((d) => (
                <div key={d.id} className="donor-card">
                  <div className="donor-card-top">
                    <div>
                      <strong>{d.name}</strong>
                      <div className="muted">
                        Blood: {d.bloodType} · City: {d.city}
                      </div>
                    </div>
                    <span className={`badge ${d.availabilityStatus === 'available' ? 'available' : 'cooldown'}`}>
                      {d.availabilityStatus || 'unknown'}
                    </span>
                  </div>

                  <div className="donor-details">
                    <div className="donor-detail">
                      <div className="donor-detail-label">Phone</div>
                      <div className="donor-detail-value">{d.phone}</div>
                    </div>
                    <div className="donor-detail">
                      <div className="donor-detail-label">Email</div>
                      <div className="donor-detail-value">{d.email || '—'}</div>
                    </div>
                    <div className="donor-detail">
                      <div className="donor-detail-label">Last donation</div>
                      <div className="donor-detail-value">{d.lastDonationAt ? new Date(d.lastDonationAt).toLocaleDateString() : 'Never'}</div>
                    </div>
                    <div className="donor-detail">
                      <div className="donor-detail-label">Consent</div>
                      <div className="donor-detail-value">{d.consent ? 'Yes' : 'No'}</div>
                    </div>
                    <div className="donor-detail">
                      <div className="donor-detail-label">Geo</div>
                      <div className="donor-detail-value">
                        {d.geo && typeof d.geo.lat === 'number' && typeof d.geo.lng === 'number'
                          ? `${d.geo.lat.toFixed(5)}, ${d.geo.lng.toFixed(5)}`
                          : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="donor-actions">
                    <a className="button primary" href={`tel:${d.phone}`}>
                      Contact by call
                    </a>
                    {d.email && (
                      <a className="button secondary" href={`mailto:${d.email}`}>
                        Contact by email
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="field-hint" style={{ marginTop: 10 }}>
              No available donors matched by blood group and city (or within the radius).
            </p>
          )}
        </div>
      )}
    </Page>
  );
};

const DonorList = () => {
  const [donors, setDonors] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(endpoints.donors);
      setDonors(res.data);
    } catch {
      setDonors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Page title="Donor directory">
      <button className="button ghost" onClick={load} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh list'}
      </button>
      <div className="list">
        {donors.length === 0 && <p>No donors yet. Register to get started.</p>}
        {donors.map((d) => (
          <div key={d.id} className="list-item">
            <div>
              <strong>{d.name}</strong> · {d.bloodType} · {d.city}
              <div className="muted">{d.phone}{d.email ? ` · ${d.email}` : ''}</div>
            </div>
            <span className={`badge ${d.availabilityStatus}`}>{d.availabilityStatus}</span>
          </div>
        ))}
      </div>
    </Page>
  );
};

const RequestList = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(endpoints.requests);
      setRequests(res.data);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteRequest = async (id) => {
    if (!confirm('Are you sure you want to delete this request?')) return;
    try {
      await api.delete(endpoints.requestDelete(id));
      setRequests(requests.filter(r => r.id !== id));
      setShowModal(false);
    } catch {
      alert('Failed to delete request');
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Page title="Live requests">
      <button className="button ghost" onClick={load} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh list'}
      </button>
      <div className="list">
        {requests.length === 0 && <p>No active requests yet.</p>}
        {requests.map((r) => (
          <div key={r.id} className="list-item">
            <div>
              <strong>{r.hospitalName}</strong> needs {r.bloodType} in {r.city}
              <div className="muted">
                Contact: {r.contactPerson} · {r.phone} · Units: {r.unitsNeeded} · Urgency:{' '}
                {r.urgency}
              </div>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setSelectedRequest(r);
                setShowModal(true);
              }}
            >
              Open
            </button>
          </div>
        ))}
      </div>
      {showModal && selectedRequest && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Request Details</h2>
            <div className="modal-content">
              <div className="modal-grid">
                <InfoPill label="Hospital Name" value={selectedRequest.hospitalName} />
                <InfoPill label="Contact Person" value={selectedRequest.contactPerson} />
                <InfoPill label="Phone" value={selectedRequest.phone} />
                <InfoPill label="City" value={selectedRequest.city} />
                <InfoPill label="Blood Type" value={selectedRequest.bloodType} />
                <InfoPill label="Units Needed" value={selectedRequest.unitsNeeded} />
                <InfoPill label="Urgency" value={selectedRequest.urgency} />
                <InfoPill label="Status" value={selectedRequest.status} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="button danger" onClick={() => deleteRequest(selectedRequest.id)}>Close Request</button>
              <button className="button primary" onClick={() => setShowModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
};

const MatchFinder = () => {
  const [query, setQuery] = useState({ bloodType: '', city: '' });
  const [result, setResult] = useState({ total: 0, donors: [] });
  const [loading, setLoading] = useState(false);
  const canSearch = useMemo(() => query.bloodType && query.city, [query]);

  const search = async (e) => {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    try {
      const res = await api.get(endpoints.match, { params: query });
      setResult(res.data);
    } catch {
      setResult({ total: 0, donors: [] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page title="Find matching donors">
      <form className="grid two" onSubmit={search}>
        <label>
          Blood type
          <input
            required
            value={query.bloodType}
            onChange={(e) => setQuery({ ...query, bloodType: e.target.value })}
          />
        </label>
        <label>
          City
          <input
            required
            value={query.city}
            onChange={(e) => setQuery({ ...query, city: e.target.value })}
          />
        </label>
        <button className="button primary" disabled={!canSearch || loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>
      <div className="list">
        {result.total === 0 && <p>No eligible donors found yet.</p>}
        {result.donors.map((d) => (
          <div key={d.id} className="list-item">
            <div>
              <strong>{d.name}</strong> · {d.bloodType} · {d.city}
              <div className="muted">Phone: {d.phone}</div>
            </div>
            <span className="badge available">available</span>
          </div>
        ))}
      </div>
    </Page>
  );
};

const Shell = () => {
  return (
    <div className="shell">
      <nav className="top-nav">
        <div className="brand">BloodLink</div>
        <div className="links">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/donor/register">Donor</NavLink>
          <NavLink to="/donors">Directory</NavLink>
          <NavLink to="/hospital/request">Hospital</NavLink>
          <NavLink to="/requests">Requests</NavLink>
          <NavLink to="/match">Match</NavLink>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/donor/register" element={<DonorRegister />} />
        <Route path="/donors" element={<DonorList />} />
        <Route path="/hospital/request" element={<HospitalRequest />} />
        <Route path="/requests" element={<RequestList />} />
        <Route path="/match" element={<MatchFinder />} />
      </Routes>
    </div>
  );
};

function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}

export default App;

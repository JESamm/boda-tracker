import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';

// Archived prototype only; the supported API lives in apps/api.
const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(process.cwd(), 'server', 'data.json');

app.use(cors());
app.use(express.json());

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE) || fs.readFileSync(DATA_FILE, 'utf8').trim() === '') {
    const seed = {
      riders: [
        {
          id: 1,
          name: 'Amina Odhiambo',
          phone: '+254712345678',
          pickup: 'Kisumu CBD',
          dropoff: 'Kisumu Airport',
          service: 'Airport transfer',
          passengers: 2,
          fare: 1800,
          priority: 'Priority',
          status: 'En route',
          driver: 'James Otieno',
          eta: '6 min',
          createdAt: new Date().toISOString(),
        },
        {
          id: 2,
          name: 'Peter Kibet',
          phone: '+254723456789',
          pickup: 'Kibos',
          dropoff: 'Jomo Kenyatta Campus',
          service: 'School ride',
          passengers: 1,
          fare: 900,
          priority: 'Standard',
          status: 'Queued',
          driver: 'Pending assignment',
          eta: '12 min',
          createdAt: new Date().toISOString(),
        },
        {
          id: 3,
          name: 'Ruth Njeri',
          phone: '+254734567890',
          pickup: 'Mamboleo',
          dropoff: 'Nyalenda',
          service: 'Home drop',
          passengers: 2,
          fare: 650,
          priority: 'Standard',
          status: 'Completed',
          driver: 'David Aoko',
          eta: 'Done',
          createdAt: new Date().toISOString(),
        },
      ],
      drivers: [
        { name: 'James Otieno', status: 'On trip', zone: 'Airport route', rating: 4.9 },
        { name: 'David Aoko', status: 'Available', zone: 'CBD loop', rating: 4.8 },
        { name: 'Fred Omondi', status: 'Break', zone: 'West side', rating: 4.7 },
        { name: 'Mary Anyango', status: 'On trip', zone: 'University route', rating: 4.9 },
      ],
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
  }
}

function readData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/riders', (req, res) => {
  const data = readData();
  res.json(data.riders);
});

app.get('/api/drivers', (req, res) => {
  const data = readData();
  res.json(data.drivers);
});

app.post('/api/riders', (req, res) => {
  const data = readData();
  const payload = req.body || {};

  const rider = {
    id: Date.now(),
    name: payload.name || 'New rider',
    phone: payload.phone || '+254700000000',
    pickup: payload.pickup || 'Unknown pickup',
    dropoff: payload.dropoff || 'Unknown dropoff',
    service: payload.service || 'Airport transfer',
    passengers: Number(payload.passengers || 1),
    fare: Number(payload.fare || 1200),
    priority: payload.priority || 'Standard',
    status: 'Queued',
    driver: 'Pending assignment',
    eta: '10 min',
    createdAt: new Date().toISOString(),
  };

  data.riders = [rider, ...data.riders];
  writeData(data);
  res.status(201).json(rider);
});

app.patch('/api/riders/:id/status', (req, res) => {
  const data = readData();
  const id = Number(req.params.id);
  const status = req.body?.status;

  const rider = data.riders.find((entry) => entry.id === id);
  if (!rider) {
    return res.status(404).json({ error: 'Rider not found' });
  }

  rider.status = status;
  rider.eta = status === 'Completed' ? 'Done' : status === 'Delayed' ? '18 min' : status === 'En route' ? '6 min' : '12 min';

  writeData(data);
  res.json(rider);
});

app.listen(PORT, () => {
  console.log(`BodaTracker API running on http://localhost:${PORT}`);
});

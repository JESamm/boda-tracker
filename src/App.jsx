import { useEffect, useMemo, useState } from 'react'
import './App.css'

const emptyForm = {
  name: '',
  phone: '',
  pickup: '',
  dropoff: '',
  service: 'Airport transfer',
  passengers: 1,
  fare: 1200,
  priority: 'Standard',
}

const statusOrder = ['Queued', 'En route', 'Delayed', 'Completed']

function App() {
  const [trips, setTrips] = useState([])
  const [drivers, setDrivers] = useState([])
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [ridersRes, driversRes] = await Promise.all([
          fetch('http://localhost:3001/api/riders'),
          fetch('http://localhost:3001/api/drivers'),
        ])

        const riders = await ridersRes.json()
        const driverList = await driversRes.json()

        setTrips(riders.map((trip) => ({
          id: trip.id,
          customer: trip.name,
          from: trip.pickup,
          to: trip.dropoff,
          status: trip.status,
          driver: trip.driver,
          eta: trip.eta,
          amount: trip.fare,
          service: trip.service,
          priority: trip.priority,
          riders: trip.passengers,
          phone: trip.phone,
        })))
        setDrivers(driverList)
      } catch (error) {
        console.error('Failed to load data', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const filteredTrips = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return trips

    return trips.filter((trip) => {
      return [trip.customer, trip.from, trip.to, trip.driver, trip.service]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [query, trips])

  const summary = useMemo(() => {
    const completed = trips.filter((trip) => trip.status === 'Completed').length
    const active = trips.filter((trip) => trip.status !== 'Completed').length
    const revenue = trips.reduce((total, trip) => total + trip.amount, 0)
    const onTimeRate = trips.length
      ? Math.round(((completed + trips.filter((trip) => trip.status === 'En route').length) / trips.length) * 100)
      : 0

    return { completed, active, revenue, onTimeRate }
  }, [trips])

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: name === 'passengers' || name === 'fare' ? Number(value) : value }))
  }

  const handleAddTrip = async (event) => {
    event.preventDefault()

    if (!form.name || !form.pickup || !form.dropoff) {
      return
    }

    const payload = {
      name: form.name,
      phone: form.phone || '+254700000000',
      pickup: form.pickup,
      dropoff: form.dropoff,
      service: form.service,
      passengers: form.passengers,
      fare: form.fare,
      priority: form.priority,
    }

    const response = await fetch('http://localhost:3001/api/riders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return
    }

    const trip = await response.json()
    setTrips((current) => [{
      id: trip.id,
      customer: trip.name,
      from: trip.pickup,
      to: trip.dropoff,
      status: trip.status,
      driver: trip.driver,
      eta: trip.eta,
      amount: trip.fare,
      service: trip.service,
      priority: trip.priority,
      riders: trip.passengers,
      phone: trip.phone,
    }, ...current])
    setForm(emptyForm)
  }

  const updateTripStatus = async (tripId, nextStatus) => {
    const response = await fetch(`http://localhost:3001/api/riders/${tripId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })

    if (!response.ok) {
      return
    }

    const updated = await response.json()
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              status: updated.status,
              eta: updated.eta,
            }
          : trip,
      ),
    )
  }

  if (loading) {
    return <div className="loading-state">Loading dispatch board...</div>
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">B</div>
          <div>
            <p className="eyebrow">Operations</p>
            <h1>BodaTracker</h1>
          </div>
        </div>

        <nav className="nav-links" aria-label="Main navigation">
          <button type="button" className="nav-item active">Overview</button>
          <button type="button" className="nav-item">Dispatch</button>
          <button type="button" className="nav-item">Fleet</button>
          <button type="button" className="nav-item">Payments</button>
          <button type="button" className="nav-item">Reports</button>
        </nav>

        <div className="mini-card">
          <p className="eyebrow">Today</p>
          <strong>{trips.length} rides</strong>
          <span>Active service network</span>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Welcome back</p>
            <h2>Dispatch control center</h2>
          </div>

          <div className="topbar-actions">
            <label className="search-box" htmlFor="trip-search">
              <span>Search</span>
              <input
                id="trip-search"
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Customer or route"
              />
            </label>
            <button type="button" className="primary-button">Create booking</button>
          </div>
        </header>

        <section className="stats-grid">
          <article className="stat-card accent">
            <p>Active rides</p>
            <h3>{summary.active}</h3>
            <span>Across 8 service zones</span>
          </article>
          <article className="stat-card">
            <p>Completed today</p>
            <h3>{summary.completed}</h3>
            <span>On-time performance {summary.onTimeRate}%</span>
          </article>
          <article className="stat-card">
            <p>Revenue</p>
            <h3>KSh {summary.revenue.toLocaleString()}</h3>
            <span>Gross fare bookings</span>
          </article>
          <article className="stat-card">
            <p>Service SLA</p>
            <h3>{summary.onTimeRate}%</h3>
            <span>Average wait: 8 minutes</span>
          </article>
        </section>

        <section className="content-grid">
          <div className="panel bigger-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Live route</p>
                <h3>Trip coverage</h3>
              </div>
              <button type="button" className="ghost-button">Export</button>
            </div>

            <div className="route-map">
              <div className="map-point start">Kisumu CBD</div>
              <div className="map-line"></div>
              <div className="map-stop">Mamboleo</div>
              <div className="map-point end">Airport</div>
            </div>

            <div className="route-metrics">
              <div>
                <span>Avg ETA</span>
                <strong>7 min</strong>
              </div>
              <div>
                <span>Busy corridor</span>
                <strong>CBD → Airport</strong>
              </div>
              <div>
                <span>Fuel saved</span>
                <strong>14%</strong>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Fleet</p>
                <h3>Driver status</h3>
              </div>
            </div>

            <div className="fleet-list">
              {drivers.map((driver) => (
                <div key={driver.name} className="fleet-item">
                  <div className="driver-pill">
                    <span className={`status-dot ${driver.status.toLowerCase().replace(/\s+/g, '-')}`}></span>
                    {driver.name}
                  </div>
                  <div>
                    <strong>{driver.status}</strong>
                    <span>{driver.zone}</span>
                  </div>
                  <small>{driver.rating}★</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bottom-grid">
          <div className="panel table-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Dispatch board</p>
                <h3>Current rides</h3>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Route</th>
                  <th>Status</th>
                  <th>Driver</th>
                  <th>Fare</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrips.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <div className="customer-cell">
                        <strong>{trip.customer}</strong>
                        <span>{trip.service}</span>
                      </div>
                    </td>
                    <td>{trip.from} → {trip.to}</td>
                    <td>
                      <select
                        value={trip.status}
                        onChange={(event) => updateTripStatus(trip.id, event.target.value)}
                        className={`status-select ${trip.status.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {statusOrder.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </td>
                    <td>{trip.driver}</td>
                    <td>KSh {trip.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel form-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Booking</p>
                <h3>New rider</h3>
              </div>
            </div>

            <form className="booking-form" onSubmit={handleAddTrip}>
              <label>
                <span>Passenger name</span>
                <input type="text" name="name" value={form.name} onChange={handleFieldChange} placeholder="Jane Wambui" />
              </label>

              <label>
                <span>Phone number</span>
                <input type="tel" name="phone" value={form.phone} onChange={handleFieldChange} placeholder="+2547..." />
              </label>

              <label>
                <span>Pickup</span>
                <input type="text" name="pickup" value={form.pickup} onChange={handleFieldChange} placeholder="Kisumu CBD" />
              </label>
              <label>
                <span>Dropoff</span>
                <input type="text" name="dropoff" value={form.dropoff} onChange={handleFieldChange} placeholder="Airport" />
              </label>

              <div className="two-column">
                <label>
                  <span>Service</span>
                  <select name="service" value={form.service} onChange={handleFieldChange}>
                    <option value="Airport transfer">Airport transfer</option>
                    <option value="School ride">School ride</option>
                    <option value="Business ride">Business ride</option>
                    <option value="Home drop">Home drop</option>
                  </select>
                </label>

                <label>
                  <span>Passengers</span>
                  <input type="number" min="1" max="5" name="passengers" value={form.passengers} onChange={handleFieldChange} />
                </label>
              </div>

              <div className="two-column">
                <label>
                  <span>Priority</span>
                  <select name="priority" value={form.priority} onChange={handleFieldChange}>
                    <option value="Standard">Standard</option>
                    <option value="Priority">Priority</option>
                  </select>
                </label>

                <label>
                  <span>Fare</span>
                  <input type="number" name="fare" value={form.fare} onChange={handleFieldChange} />
                </label>
              </div>

              <button type="submit" className="primary-button full-width">Add to dispatch</button>
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App

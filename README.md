# AI-Based Disaster Response System

**Edge-AI Multi-Hazard Environmental Intelligence Network**  
Problem Statement ID: 26178

A real-time web dashboard for monitoring environmental hazards — floods, forest fires, air pollution, and landslides — using IoT sensor data, an edge-AI risk engine, and live polling alerts.

---

## Overview

This system simulates an ESP32-based sensor network that continuously reads environmental data and feeds it into a risk engine. The dashboard displays live readings, calculates hazard risk scores, and sends warnings when thresholds are exceeded. Real hardware nodes can push data directly to the system via the REST ingest API.

The risk model is based on the paper:  
*"An Edge-AI Enabled Multi-Hazard Environmental Intelligence Network for Real-Time Disaster Detection and Early Warning"* — Problem Statement 26178.

---

## Live Demo

Deploy to Vercel in one click — see [Deploying to Vercel](#deploying-to-vercel) below.

---

## Features

- **4 Live Hazard Panels** — Flood, Forest Fire, Air Quality, Landslide
- **Real-time updates** — dashboard polls `/api/sensors` every 2 seconds
- **Risk Engine** — min-max normalisation → weighted hazard score Rh → confidence-adjusted score Rc
- **4 Risk Levels** — NORMAL / ELEVATED / HIGH / CRITICAL with color-coded indicators
- **Toast Notifications** — pop-up alerts with auto-dismiss timer, progress bar, and manual close button
- **Live Alert Log** — per-alert dismiss (`✕`) and Clear All button
- **Critical Risk Banner** — top banner for CRITICAL events; stays closed until a new escalation
- **Scenario Simulator** — trigger any hazard escalation from the UI for demo/testing
- **ESP32 Ingest API** — real sensor nodes can POST data directly into the system
- **Browser Push Notifications** — native OS notifications for HIGH/CRITICAL events
- **Responsive layout** — works on desktop and tablet screens
- **Vercel-compatible** — pure WSGI Flask, no background threads or WebSockets

---

## Sensors Monitored

| Sensor | Hardware | Hazard |
|---|---|---|
| Water level | Ultrasonic (HC-SR04) | Flood |
| Rainfall | Tipping-bucket rain gauge | Flood, Landslide |
| Temperature & Humidity | BME280 | Forest Fire |
| Smoke / Gas | MQ-series gas sensor | Forest Fire |
| Particulate Matter | PMS5003 (PM2.5 / PM10) | Air Quality |
| AQI | Derived from PM readings | Air Quality |
| Soil Moisture | Capacitive sensor | Landslide |
| Vibration / Acceleration | MPU6050 | Landslide |

Communication: **LoRa / LoRaWAN · Wi-Fi · NB-IoT · 5G**  
Controller: **ESP32**

---

## Project Structure

```
disaster-response/
│
├── app.py               # Flask backend — risk engine, time-based simulator, REST API
├── vercel.json          # Vercel deployment config
├── requirements.txt     # Python dependencies (Flask only)
├── run.bat              # One-click local launch (Windows)
├── README.md
│
├── templates/
│   └── index.html       # Dashboard UI
│
└── static/
    ├── css/
    │   └── style.css    # Dark emergency theme
    └── js/
        └── app.js       # REST polling client, Chart.js charts, alert system
```

---

## Deploying to Vercel

### Prerequisites

- A [Vercel account](https://vercel.com) (free)
- [Git](https://git-scm.com) installed
- [Vercel CLI](https://vercel.com/docs/cli) — install with:

```bash
npm install -g vercel
```

---

### Option A — Deploy via Vercel CLI (recommended)

**Step 1 — Initialise a git repository** (if you haven't already)

```bash
cd "disaster-response"
git init
git add .
git commit -m "Initial commit"
```

**Step 2 — Login to Vercel**

```bash
vercel login
```

**Step 3 — Deploy**

```bash
vercel
```

Vercel will ask a few questions — accept all the defaults:

```
? Set up and deploy "disaster-response"? → Y
? Which scope? → (your account)
? Link to existing project? → N
? What's your project's name? → disaster-response
? In which directory is your code located? → ./
```

**Step 4 — Promote to production**

```bash
vercel --prod
```

Your app will be live at `https://disaster-response-<hash>.vercel.app`

---

### Option B — Deploy via GitHub

**Step 1 — Push to GitHub**

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-username>/disaster-response.git
git push -u origin main
```

**Step 2 — Import on Vercel**

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository**
3. Select your `disaster-response` repo
4. Leave all settings as default — Vercel auto-detects Python
5. Click **Deploy**

Every `git push` to `main` will auto-redeploy.

---

### What Vercel needs (already included)

| File | Purpose |
|---|---|
| `vercel.json` | Tells Vercel to use `@vercel/python` and route all requests to `app.py` |
| `requirements.txt` | Lists `flask==3.0.3` — Vercel installs this automatically |
| `app.py` | Exports the WSGI `app` object at module level |

> **Note:** Vercel is serverless — each request spins up a fresh function instance.  
> In-memory state (scenario, alert log, history buffer) persists within a warm instance  
> but resets on cold starts. For production use, replace the in-memory stores with a  
> database such as Vercel KV, Redis, or Supabase.

---

## Running Locally

### Option 1 — Double-click `run.bat` (Windows)

The script automatically creates a venv, installs Flask, and starts the server.

### Option 2 — Manual

```bash
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Linux / Mac

pip install -r requirements.txt
python app.py
```

Open: `http://127.0.0.1:5000`

---

## API Reference

### `GET /api/sensors`
Main polling endpoint. Returns live sensor snapshot + risk scores + history + alerts.

```json
{
  "timestamp": "19:30:00",
  "flood":       { "water_level": 1.2, "rainfall": 8.0, "risk_pct": 18.5, "risk_level": "NORMAL" },
  "fire":        { "temperature": 28.1, "humidity": 63.2, "smoke_gas": 130, "risk_pct": 12.0, "risk_level": "NORMAL" },
  "air_quality": { "pm25": 38.5, "pm10": 66.0, "aqi": 121, "risk_pct": 15.3, "risk_level": "NORMAL" },
  "landslide":   { "soil_moisture": 36.0, "vibration": 0.12, "rainfall": 6.1, "risk_pct": 11.0, "risk_level": "NORMAL" },
  "new_alerts":  [],
  "alert_log":   []
}
```

### `POST /api/ingest`
Push real sensor data from an ESP32 node.

```json
{ "node": "flood", "water_level": 3.2, "rainfall": 55 }
```

Valid node values: `flood`, `fire`, `air_quality`, `landslide`

**ESP32 / Arduino example:**
```cpp
HTTPClient http;
http.begin("https://your-app.vercel.app/api/ingest");
http.addHeader("Content-Type", "application/json");
http.POST("{\"node\":\"flood\",\"water_level\":2.8,\"rainfall\":40}");
```

### `POST /api/scenario`
Trigger a hazard escalation for demo/testing.

```json
{ "scenario": "flood" }
```

Values: `flood` · `fire` · `air_quality` · `landslide` · `clear`

### `GET /api/alerts`
Returns the last 100 alerts.

---

## Risk Engine

Based on Section X of the research paper:

| Formula | Description |
|---|---|
| `x_norm = (x − x_min) / (x_max − x_min)` | Min-max normalisation |
| `R_h = Σ w_i × x_i` | Weighted hazard risk |
| `R_c = R_h × C` | Confidence-adjusted risk |

**Risk levels:**

| Score | Level | Colour |
|---|---|---|
| 0 – 25% | NORMAL | 🟢 Green |
| 25 – 50% | ELEVATED | 🟡 Yellow |
| 50 – 75% | HIGH | 🟠 Orange |
| 75 – 100% | CRITICAL | 🔴 Red |

---

## Alert Controls

| Control | Behaviour |
|---|---|
| Toast `✕` button | Closes that toast immediately |
| Toast hover | Pauses the 8-second auto-dismiss timer |
| Alert log `✕` | Dismisses that individual alert (won't reappear) |
| Clear All | Removes all current alerts at once |
| Risk banner `✕` | Closes banner; only reopens on a new escalation level |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.9+, Flask 3.0 |
| Deployment | Vercel (serverless WSGI via `@vercel/python`) |
| Frontend | HTML5, CSS3, Vanilla JS (ES2020) |
| Charts | Chart.js 4.4 |
| Fonts / Icons | Google Fonts · Feather Icons |
| Hardware | ESP32 · LoRa · BME280 · PMS5003 · MPU6050 |

---

## References

- Problem Statement 26178 — *Edge-AI Multi-Hazard Environmental Intelligence Network*
- D-Fire Dataset: [github.com/gaia-solutions-on-demand/DFireDataset](https://github.com/gaia-solutions-on-demand/DFireDataset)
- TRAQID Dataset: [github.com/omkathalkar/TRAQID-Traffic-Related-Air-Quality-Image-Dataset](https://github.com/omkathalkar/TRAQID-Traffic-Related-Air-Quality-Image-Dataset)
- Flood Prediction: [github.com/rajatkeshri/Flood-prediction](https://github.com/rajatkeshri/Flood-prediction)
- Landslide + Soil Moisture: [github.com/jacquiewitte/capstone-landslides-soilmoisture](https://github.com/jacquiewitte/capstone-landslides-soilmoisture)

---

## License

Academic and research use — Problem Statement 26178.

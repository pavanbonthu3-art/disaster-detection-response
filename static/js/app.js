/* ═══════════════════════════════════════════════════════════════
   AI Disaster Response System — Frontend
   Edge-AI Multi-Hazard Environmental Intelligence Network
   REST polling (Vercel-compatible) · Chart.js · Alert system
════════════════════════════════════════════════════════════════ */

"use strict";

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const POLL_INTERVAL_MS = 2000;   // fetch /api/sensors every 2 s

const HAZARD_ICONS = {
  flood:       "🌊",
  fire:        "🔥",
  air_quality: "💨",
  landslide:   "⛰️",
};

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: {
    legend: {
      display: true,
      position: "top",
      labels: { color: "#7a99bb", font: { size: 9 }, boxWidth: 10, padding: 8 },
    },
    tooltip: {
      backgroundColor: "#111c2b",
      borderColor: "#1e3048",
      borderWidth: 1,
      titleColor: "#e8f0fe",
      bodyColor: "#7a99bb",
      padding: 8,
    },
  },
  scales: {
    x: {
      ticks: { color: "#4a6580", font: { size: 8 }, maxTicksLimit: 6, maxRotation: 0, autoSkip: true },
      grid:  { color: "rgba(30,48,72,.4)" },
    },
    y: {
      ticks: { color: "#4a6580", font: { size: 9 } },
      grid:  { color: "rgba(30,48,72,.4)" },
    },
  },
};

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let charts             = {};
let lastAlertIds       = new Set();
let activeScenario     = null;
let alertTotal         = 0;
let notifGranted       = false;
let bannerDismissed    = false;
let lastBannerLevel    = "";
let dismissedAlertIds  = new Set();

let pollTimer          = null;
let consecutiveErrors  = 0;
const MAX_ERRORS       = 5;

// ─────────────────────────────────────────────
//  CLOCK
// ─────────────────────────────────────────────
function updateClock() {
  const now  = new Date();
  const time = now.toTimeString().split(" ")[0];
  const date = now.toLocaleDateString("en-IN", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
  document.getElementById("navTime").textContent = time;
  document.getElementById("navDate").textContent = date;
}
setInterval(updateClock, 1000);
updateClock();

// ─────────────────────────────────────────────
//  BROWSER NOTIFICATIONS
// ─────────────────────────────────────────────
function requestNotifPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().then(p => { notifGranted = p === "granted"; });
  } else {
    notifGranted = Notification.permission === "granted";
  }
}
requestNotifPermission();

function sendBrowserNotif(title, body) {
  if (notifGranted) {
    const n = new Notification(title, { body });
    setTimeout(() => n.close(), 6000);
  }
}

// ─────────────────────────────────────────────
//  CHART FACTORY
// ─────────────────────────────────────────────
function makeLineDataset(label, color, data = []) {
  return {
    label,
    data,
    borderColor:      color,
    backgroundColor:  color + "22",
    borderWidth:      2,
    pointRadius:      0,
    pointHoverRadius: 3,
    tension:          0.35,
    fill:             true,
  };
}

function buildCharts() {
  const base = JSON.parse(JSON.stringify(CHART_DEFAULTS));

  charts.flood = new Chart(document.getElementById("chart-flood"), {
    type: "line",
    data: {
      labels:   [],
      datasets: [
        makeLineDataset("Water Level (m)",  "#2979ff"),
        makeLineDataset("Rainfall (mm/hr)", "#00e5ff"),
      ],
    },
    options: deepMerge(base, {}),
  });

  charts.fire = new Chart(document.getElementById("chart-fire"), {
    type: "line",
    data: {
      labels:   [],
      datasets: [
        makeLineDataset("Temp (°C)",     "#ff6d00"),
        makeLineDataset("Smoke (ADC/5)", "#ff5252"),
        makeLineDataset("Humidity (%)",  "#b2dfdb"),
      ],
    },
    options: deepMerge(base, {}),
  });

  charts.air = new Chart(document.getElementById("chart-air"), {
    type: "line",
    data: {
      labels:   [],
      datasets: [
        makeLineDataset("PM2.5 (µg/m³)", "#00e5ff"),
        makeLineDataset("PM10 (µg/m³)",  "#80d8ff"),
        makeLineDataset("AQI/10",         "#b388ff"),
      ],
    },
    options: deepMerge(base, {}),
  });

  charts.land = new Chart(document.getElementById("chart-land"), {
    type: "line",
    data: {
      labels:   [],
      datasets: [
        makeLineDataset("Soil Moisture (%)", "#69f0ae"),
        makeLineDataset("Vibration ×20 (g)", "#ffcc80"),
      ],
    },
    options: deepMerge(base, {}),
  });
}

function updateChart(chart, labels, ...datasetsData) {
  chart.data.labels = labels;
  datasetsData.forEach((arr, i) => {
    if (chart.data.datasets[i]) chart.data.datasets[i].data = arr;
  });
  chart.update("none");
}

// ─────────────────────────────────────────────
//  POLLING — replaces Socket.IO
// ─────────────────────────────────────────────
async function fetchSensors() {
  try {
    const res = await fetch("/api/sensors");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    consecutiveErrors = 0;
    setStatus("online", "System Online · Live");
    handleUpdate(data);
  } catch (err) {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_ERRORS) {
      setStatus("offline", "Connection lost — retrying…");
    }
    console.warn("[DR] Poll error:", err.message);
  }
}

function startPolling() {
  fetchSensors();                                    // immediate first fetch
  pollTimer = setInterval(fetchSensors, POLL_INTERVAL_MS);
}

// ─────────────────────────────────────────────
//  MAIN UPDATE HANDLER  (unchanged from SocketIO version)
// ─────────────────────────────────────────────
function handleUpdate(d) {
  const ts = d.timestamps || [];

  // ── FLOOD ──────────────────────────────────
  setText("flood-wl",   d.flood.water_level.toFixed(2));
  setText("flood-rain", d.flood.rainfall.toFixed(1));
  setText("flood-rate", d.flood.water_rate.toFixed(3));
  setRisk("flood", d.flood.risk_pct, d.flood.risk_level, d.flood.risk_color, d.flood.confidence);
  updateChart(charts.flood, ts, d.flood.history_wl, d.flood.history_rain);
  colorMetric("flood-wl",   d.flood.water_level, 3,  5);
  colorMetric("flood-rain", d.flood.rainfall,   40, 80);

  // ── FIRE ───────────────────────────────────
  setText("fire-temp",  d.fire.temperature.toFixed(1));
  setText("fire-hum",   d.fire.humidity.toFixed(1));
  setText("fire-smoke", Math.round(d.fire.smoke_gas));
  setRisk("fire", d.fire.risk_pct, d.fire.risk_level, d.fire.risk_color, d.fire.confidence);
  const smokeScaled = d.fire.history_smoke.map(v => +(v / 5).toFixed(1));
  updateChart(charts.fire, ts, d.fire.history_temp, smokeScaled, d.fire.history_hum);
  colorMetric("fire-temp",  d.fire.temperature, 38,  50);
  colorMetric("fire-smoke", d.fire.smoke_gas,  400, 700);

  // ── AIR QUALITY ────────────────────────────
  setText("air-pm25", d.air_quality.pm25.toFixed(1));
  setText("air-pm10", d.air_quality.pm10.toFixed(1));
  setText("air-aqi",  d.air_quality.aqi);
  const aqiLabelEl = document.getElementById("air-aqi-label");
  if (aqiLabelEl) {
    aqiLabelEl.textContent = d.air_quality.aqi_label;
    aqiLabelEl.style.color = d.air_quality.aqi_color;
  }
  setRisk("air", d.air_quality.risk_pct, d.air_quality.risk_level, d.air_quality.risk_color, d.air_quality.confidence);
  const aqiScaled = d.air_quality.history_aqi.map(v => +(v / 10).toFixed(1));
  updateChart(charts.air, ts, d.air_quality.history_pm25, d.air_quality.history_pm10, aqiScaled);
  colorMetric("air-pm25", d.air_quality.pm25, 75,  150);
  colorMetric("air-aqi",  d.air_quality.aqi,  150, 300);

  // ── LANDSLIDE ──────────────────────────────
  setText("land-soil", d.landslide.soil_moisture.toFixed(1));
  setText("land-vib",  d.landslide.vibration.toFixed(3));
  setText("land-rain", d.landslide.rainfall.toFixed(1));
  setRisk("land", d.landslide.risk_pct, d.landslide.risk_level, d.landslide.risk_color, d.landslide.confidence);
  const vibScaled = d.landslide.history_vib.map(v => +(v * 20).toFixed(2));
  updateChart(charts.land, ts, d.landslide.history_sm, vibScaled);
  colorMetric("land-soil", d.landslide.soil_moisture, 65, 85);
  colorMetric("land-vib",  d.landslide.vibration,     1.5, 3);

  // ── SUMMARY PANEL ──────────────────────────
  updateSummary("flood", d.flood.risk_level,       d.flood.risk_pct,       d.flood.risk_color);
  updateSummary("fire",  d.fire.risk_level,        d.fire.risk_pct,        d.fire.risk_color);
  updateSummary("air",   d.air_quality.risk_level, d.air_quality.risk_pct, d.air_quality.risk_color);
  updateSummary("land",  d.landslide.risk_level,   d.landslide.risk_pct,   d.landslide.risk_color);

  // ── OVERALL RISK BANNER ────────────────────
  const criticals = [d.flood, d.fire, d.air_quality, d.landslide]
    .filter(h => h.risk_level === "CRITICAL");
  const highs = [d.flood, d.fire, d.air_quality, d.landslide]
    .filter(h => h.risk_level === "HIGH");

  const banner = document.getElementById("riskBanner");

  if (criticals.length || highs.length) {
    const topLevel = criticals.length ? "CRITICAL" : "HIGH";
    let cname = "";
    if      (d.flood.risk_level        === topLevel) cname = "FLOOD";
    else if (d.fire.risk_level         === topLevel) cname = "FOREST FIRE";
    else if (d.air_quality.risk_level  === topLevel) cname = "AIR QUALITY";
    else if (d.landslide.risk_level    === topLevel) cname = "LANDSLIDE";

    const newKey = `${topLevel}_${cname}`;
    if (newKey !== lastBannerLevel) {
      lastBannerLevel = newKey;
      bannerDismissed = false;
    }
    if (!bannerDismissed) {
      banner.classList.remove("hidden");
      const prefix = topLevel === "CRITICAL" ? "🚨 CRITICAL HAZARD" : "⚠️ HIGH HAZARD";
      document.getElementById("bannerText").textContent =
        `${prefix} — ${cname} — ${topLevel === "CRITICAL" ? "IMMEDIATE ACTION REQUIRED" : "Monitor closely"}`;
    }
  } else {
    lastBannerLevel = "";
    bannerDismissed = false;
    banner.classList.add("hidden");
  }

  // ── NEW ALERTS ─────────────────────────────
  if (d.new_alerts && d.new_alerts.length) {
    d.new_alerts.forEach(a => {
      if (!lastAlertIds.has(a.id)) {
        lastAlertIds.add(a.id);
        showToast(a);
        sendBrowserNotif(`${a.hazard} — ${a.level}`, a.message);
      }
    });
  }

  // ── ALERT LOG ──────────────────────────────
  renderAlertLog(d.alert_log);

  // ── FOOTER ─────────────────────────────────
  document.getElementById("footerUpdate").textContent = "Last update: " + d.timestamp;

  // ── NODE PING indicators ───────────────────
  ["flood", "fire", "air", "land"].forEach(n => {
    const el = document.getElementById("ping-" + n);
    if (el) el.textContent = "2s";
  });
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function colorMetric(id, value, warnThresh, critThresh) {
  const el = document.getElementById(id);
  if (!el) return;
  if      (value >= critThresh) el.style.color = "#f44336";
  else if (value >= warnThresh) el.style.color = "#ff9800";
  else                          el.style.color = "";
}

function setRisk(prefix, pct, level, color, conf) {
  const pctEl = document.getElementById(prefix + "-pct");
  if (pctEl) { pctEl.textContent = pct + "%"; pctEl.style.color = color; }

  const bar = document.getElementById(prefix + "-bar");
  if (bar) { bar.style.width = pct + "%"; bar.style.backgroundColor = color; }

  const badgeId = prefix === "air" ? "air-badge" : prefix + "-badge";
  const badge   = document.getElementById(badgeId);
  if (badge) { badge.textContent = level; badge.className = "risk-badge badge-" + level.toLowerCase(); }

  const cardMap = { flood: "card-flood", fire: "card-fire", air: "card-air", land: "card-landslide" };
  const card = document.getElementById(cardMap[prefix]);
  if (card) {
    card.classList.remove("level-normal", "level-elevated", "level-high", "level-critical");
    card.classList.add("level-" + level.toLowerCase());
  }

  const confEl = document.getElementById(prefix + "-conf");
  if (confEl) confEl.textContent = (conf * 100).toFixed(0) + "%";
}

function updateSummary(prefix, level, pct, color) {
  const item = document.getElementById("sum-" + prefix);
  if (item) item.className = "summary-item level-" + level.toLowerCase();

  const lvlEl = document.getElementById("sum-" + prefix + "-level");
  if (lvlEl) { lvlEl.textContent = level; lvlEl.style.color = color; }

  const pctEl = document.getElementById("sum-" + prefix + "-pct");
  if (pctEl) { pctEl.textContent = pct + "%"; pctEl.style.color = color; }
}

function setStatus(state, text) {
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
  if (dot) dot.className = "status-dot " + state;
  if (txt) txt.textContent = text;
}

// ─────────────────────────────────────────────
//  ALERT LOG
// ─────────────────────────────────────────────
function renderAlertLog(alerts) {
  const list = document.getElementById("alertList");
  if (!list) return;

  const visible = (alerts || []).filter(a => !dismissedAlertIds.has(a.id));

  if (visible.length === 0) {
    list.innerHTML = '<div class="no-alerts">No alerts — all systems normal</div>';
    document.getElementById("alertCount").textContent = "0 alerts";
    return;
  }

  alertTotal = visible.length;
  document.getElementById("alertCount").textContent =
    alertTotal + " alert" + (alertTotal !== 1 ? "s" : "");

  list.innerHTML = visible.map(a => `
    <div class="alert-item level-${a.level.toLowerCase()}" id="alert-item-${a.id}">
      <div class="alert-top">
        <span class="alert-hazard">${HAZARD_ICONS[a.hazard.toLowerCase().replace(/ /g, "_")] || "⚠"} ${a.hazard}</span>
        <span class="alert-level-badge ${a.level.toLowerCase()}">${a.level}</span>
        <span class="alert-score">${a.score}%</span>
        <button class="alert-dismiss-btn" onclick="dismissAlert('${a.id}')" title="Dismiss">✕</button>
      </div>
      <div class="alert-msg">${a.message}</div>
      <div class="alert-time">${a.time}</div>
    </div>
  `).join("");
}

window.dismissAlert = function (id) {
  dismissedAlertIds.add(id);
  const el = document.getElementById("alert-item-" + id);
  if (el) {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity    = "0";
    el.style.transform  = "translateX(12px)";
    setTimeout(() => {
      el.remove();
      const remaining = document.querySelectorAll(".alert-item").length;
      const countEl   = document.getElementById("alertCount");
      if (countEl) countEl.textContent = remaining + " alert" + (remaining !== 1 ? "s" : "");
      if (remaining === 0) {
        const list = document.getElementById("alertList");
        if (list) list.innerHTML = '<div class="no-alerts">No alerts — all systems normal</div>';
        if (countEl) countEl.textContent = "0 alerts";
      }
    }, 280);
  }
};

window.clearAllAlerts = function () {
  document.querySelectorAll(".alert-item").forEach(el => {
    dismissedAlertIds.add(el.id.replace("alert-item-", ""));
    el.style.transition = "opacity .2s, transform .2s";
    el.style.opacity    = "0";
    el.style.transform  = "translateX(12px)";
  });
  setTimeout(() => {
    const list    = document.getElementById("alertList");
    const countEl = document.getElementById("alertCount");
    if (list)    list.innerHTML = '<div class="no-alerts">No alerts — all systems normal</div>';
    if (countEl) countEl.textContent = "0 alerts";
  }, 260);
};

// ─────────────────────────────────────────────
//  TOAST NOTIFICATIONS
// ─────────────────────────────────────────────
function showToast(alert) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const icon  = HAZARD_ICONS[alert.hazard.toLowerCase().replace(/ /g, "_")] || "⚠";
  const toast = document.createElement("div");
  toast.className = `toast toast-${alert.level.toLowerCase()}`;
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-icon">${icon}</span>
      <span>${alert.hazard}</span>
      <span class="toast-level ${alert.level.toLowerCase()}">${alert.level}</span>
      <button class="toast-close" title="Dismiss">✕</button>
    </div>
    <div class="toast-msg">${alert.message}</div>
    <div class="toast-footer">
      <span class="toast-time">${alert.time} · Risk ${alert.score}%</span>
      <div class="toast-progress"></div>
    </div>
  `;

  container.appendChild(toast);

  toast.querySelector(".toast-close").addEventListener("click", e => {
    e.stopPropagation();
    dismissToast(toast);
  });

  let autoTimer = setTimeout(() => dismissToast(toast), 8000);

  toast.addEventListener("mouseenter", () => {
    clearTimeout(autoTimer);
    const p = toast.querySelector(".toast-progress");
    if (p) p.style.animationPlayState = "paused";
  });

  toast.addEventListener("mouseleave", () => {
    const p = toast.querySelector(".toast-progress");
    if (p) p.style.animationPlayState = "running";
    autoTimer = setTimeout(() => dismissToast(toast), 3000);
  });
}

function dismissToast(toast) {
  if (toast._dismissing) return;
  toast._dismissing = true;
  toast.classList.add("removing");
  toast.addEventListener("animationend", () => toast.remove(), { once: true });
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 600);
}

// ─────────────────────────────────────────────
//  SCENARIO SIMULATOR
// ─────────────────────────────────────────────
window.triggerScenario = function (scenario) {
  fetch("/api/scenario", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ scenario }),
  })
  .then(r => r.json())
  .then(data => {
    activeScenario = data.scenario;

    document.querySelectorAll(".scenario-btn").forEach(b => b.classList.remove("active"));

    const statusEl = document.getElementById("scenarioStatus");
    if (!data.scenario) {
      statusEl.textContent = "No active scenario";
      statusEl.classList.remove("active");
    } else {
      const labels = {
        flood:       "🌊 Flood escalation active",
        fire:        "🔥 Fire escalation active",
        air_quality: "💨 Air quality degradation active",
        landslide:   "⛰️ Landslide risk escalation active",
      };
      statusEl.textContent = labels[scenario] || "Scenario active";
      statusEl.classList.add("active");

      const map = { flood: "flood-btn", fire: "fire-btn", air_quality: "air-btn", landslide: "land-btn" };
      document.querySelector("." + map[scenario])?.classList.add("active");
    }
  })
  .catch(err => console.error("[DR] Scenario error:", err));
};

// ─────────────────────────────────────────────
//  ESP32 INGEST FORM
// ─────────────────────────────────────────────
window.sendIngest = function () {
  const node      = document.getElementById("ingestNode").value;
  const raw       = document.getElementById("ingestPayload").value.trim();
  const resultEl  = document.getElementById("ingestResult");

  let payload;
  try { payload = JSON.parse(raw); }
  catch {
    resultEl.style.color = "#f44336";
    resultEl.textContent = "Invalid JSON";
    return;
  }

  payload.node = node;

  fetch("/api/ingest", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  })
  .then(r => r.json())
  .then(data => {
    resultEl.style.color = "#00e676";
    resultEl.textContent = data.status === "ok" ? `✓ Sent to ${data.node} node` : "Error: " + JSON.stringify(data);
    setTimeout(() => { resultEl.textContent = ""; }, 4000);
  })
  .catch(() => { resultEl.style.color = "#f44336"; resultEl.textContent = "Network error"; });
};

// ─────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────
function deepMerge(target, source) {
  const result = Object.assign({}, target);
  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  buildCharts();
  startPolling();

  if (window.feather) feather.replace();

  const placeholders = {
    flood:       '{"water_level": 3.2, "rainfall": 55}',
    fire:        '{"temperature": 45, "humidity": 20, "smoke_gas": 600}',
    air_quality: '{"pm25": 180, "pm10": 250}',
    landslide:   '{"soil_moisture": 80, "vibration": 2.1, "rainfall": 60}',
  };
  const nodeSelect = document.getElementById("ingestNode");
  const payloadBox = document.getElementById("ingestPayload");
  if (nodeSelect && payloadBox) {
    payloadBox.value = placeholders[nodeSelect.value];
    nodeSelect.addEventListener("change", () => {
      payloadBox.value = placeholders[nodeSelect.value] || "{}";
    });
  }

  console.info("[DR] AI Disaster Response System — polling mode active");
});

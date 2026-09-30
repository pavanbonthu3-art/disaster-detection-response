"""
AI-Based Disaster Response System
Edge-AI Multi-Hazard Environmental Intelligence Network
Problem Statement ID: 26178

Vercel-compatible version:
  - No SocketIO / no background threads (serverless safe)
  - Simulation is driven by wall-clock time so every request
    returns smooth, consistent values without shared state
  - Frontend polls /api/sensors every 2 s
"""

import math
import random
import time
from datetime import datetime
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)
app.config["SECRET_KEY"] = "disaster-response-secret-2026"

# ─────────────────────────────────────────────
#  TIME-BASED SIMULATION
#  Uses sin/cos waves + seeded noise so data
#  looks realistic and advances over real time.
# ─────────────────────────────────────────────

# Per-request scenario store (in-memory; resets on cold start — fine for demo)
_scenario = {"active": None}

# History buffer — grows up to HISTORY_LEN per sensor key.
# Persists within the same Vercel function instance (warm lambda).
HISTORY_LEN = 60
_history = {
    "flood_wl":    [],
    "flood_rain":  [],
    "fire_temp":   [],
    "fire_hum":    [],
    "fire_smoke":  [],
    "aq_pm25":     [],
    "aq_pm10":     [],
    "aq_aqi":      [],
    "ls_soil":     [],
    "ls_vib":      [],
    "timestamps":  [],
}

_alert_log = []   # list of alert dicts, newest first, max 100
_last_alert_keys = {}  # hazard -> last level emitted


def _push_history(key, value):
    buf = _history[key]
    buf.append(value)
    if len(buf) > HISTORY_LEN:
        buf.pop(0)


def _sim_value(base, amplitude, period_s, phase, t_s, noise_seed, noise_scale=0.0):
    """
    Smooth sine-wave oscillation + deterministic Gaussian noise.
    noise_seed makes noise reproducible per second bucket.
    """
    wave = base + amplitude * math.sin(2 * math.pi * t_s / period_s + phase)
    rng = random.Random(int(t_s / 2) + noise_seed)   # bucket noise per 2 s
    noise = rng.gauss(0, noise_scale)
    return round(wave + noise, 2)


def _scenario_delta(hazard):
    """Extra drift applied when a scenario is active."""
    sc = _scenario["active"]
    deltas = {
        "flood":       {"flood_wl": 0.08,  "flood_rain": 1.2},
        "fire":        {"fire_temp": 0.6,  "fire_smoke": 12.0, "fire_hum": -0.4},
        "air_quality": {"aq_pm25": 4.0,    "aq_pm10": 6.0},
        "landslide":   {"ls_soil": 0.7,    "ls_vib": 0.12,  "flood_rain": 0.5},
    }
    return deltas.get(sc, {}).get(hazard, 0.0)


def get_simulated_sensors():
    """Return the current simulated sensor snapshot + history."""
    t = time.time()   # seconds since epoch

    sc = _scenario["active"]

    # ── Accumulator for scenario drift ──────────────
    # When a scenario is active the base value drifts upward
    # over time (capped) so risk visibly escalates.
    sc_elapsed = 0.0
    if sc:
        sc_elapsed = min(t % 300, 120)   # ramp for up to 120 s, reset every 5 min

    def drift(key, base_delta):
        return base_delta * sc_elapsed if sc else 0.0

    # ── FLOOD ────────────────────────────────────────
    wl = _sim_value(1.2, 0.3, 120, 0.0,  t, 1, 0.04)
    wl += drift("flood_wl", _scenario_delta("flood_wl"))
    wl = round(max(0, min(6, wl)), 2)

    rain = _sim_value(8.0, 5.0, 90, 1.0, t, 2, 1.0)
    rain += drift("flood_rain", _scenario_delta("flood_rain"))
    rain = round(max(0, min(150, rain)), 1)

    prev_wl = _history["flood_wl"][-1] if _history["flood_wl"] else wl
    wl_rate = round(wl - prev_wl, 3)

    # ── FIRE ─────────────────────────────────────────
    temp = _sim_value(28.0, 4.0, 180, 0.5, t, 3, 0.3)
    temp += drift("fire_temp", _scenario_delta("fire_temp"))
    temp = round(max(15, min(65, temp)), 1)

    hum = _sim_value(62.0, 8.0, 150, 2.0, t, 4, 0.6)
    hum += drift("fire_hum", _scenario_delta("fire_hum"))
    hum = round(max(10, min(95, hum)), 1)

    smoke = _sim_value(130, 40, 200, 1.5, t, 5, 8.0)
    smoke += drift("fire_smoke", _scenario_delta("fire_smoke"))
    smoke = round(max(0, min(1023, smoke)), 0)

    # ── AIR QUALITY ──────────────────────────────────
    pm25 = _sim_value(38.0, 12.0, 300, 0.8, t, 6, 1.5)
    pm25 += drift("aq_pm25", _scenario_delta("aq_pm25"))
    pm25 = round(max(0, min(350, pm25)), 1)

    pm10 = _sim_value(65.0, 18.0, 300, 1.2, t, 7, 2.0)
    pm10 += drift("aq_pm10", _scenario_delta("aq_pm10"))
    pm10 = round(max(0, min(500, pm10)), 1)

    aqi = int(min(500, max(0, pm25 * 2.1 + pm10 * 0.6)))

    # ── LANDSLIDE ────────────────────────────────────
    soil = _sim_value(36.0, 6.0, 240, 0.3, t, 8, 0.4)
    soil += drift("ls_soil", _scenario_delta("ls_soil"))
    soil = round(max(0, min(100, soil)), 1)

    vib = _sim_value(0.12, 0.06, 180, 0.7, t, 9, 0.02)
    vib += drift("ls_vib", _scenario_delta("ls_vib"))
    vib = round(max(0, min(6, vib)), 3)

    ls_rain = _sim_value(6.0, 3.0, 120, 0.9, t, 10, 0.8)
    ls_rain += drift("flood_rain", _scenario_delta("flood_rain") * 0.5)
    ls_rain = round(max(0, min(80, ls_rain)), 1)

    # ── Push to history ──────────────────────────────
    ts_str = datetime.now().strftime("%H:%M:%S")
    _push_history("timestamps", ts_str)
    _push_history("flood_wl",   wl)
    _push_history("flood_rain", rain)
    _push_history("fire_temp",  temp)
    _push_history("fire_hum",   hum)
    _push_history("fire_smoke", smoke)
    _push_history("aq_pm25",    pm25)
    _push_history("aq_pm10",    pm10)
    _push_history("aq_aqi",     aqi)
    _push_history("ls_soil",    soil)
    _push_history("ls_vib",     vib)

    return {
        "flood":       {"water_level": wl,   "rainfall": rain, "water_rate": wl_rate},
        "fire":        {"temperature": temp, "humidity": hum,  "smoke_gas": smoke},
        "air_quality": {"pm25": pm25,        "pm10": pm10,     "aqi": aqi},
        "landslide":   {"soil_moisture": soil,"vibration": vib, "rainfall": ls_rain},
        "timestamp":   ts_str,
    }


# ─────────────────────────────────────────────
#  RISK ENGINE  (paper Section X formulas)
# ─────────────────────────────────────────────

def _norm(value, vmin, vmax):
    if vmax == vmin:
        return 0.0
    return max(0.0, min(1.0, (value - vmin) / (vmax - vmin)))


def calc_flood_risk(wl, rain, rate):
    w = [0.45, 0.35, 0.20]
    x = [_norm(wl, 0, 5), _norm(rain, 0, 100), _norm(rate, 0, 2)]
    rh = sum(wi * xi for wi, xi in zip(w, x))
    conf = round(1.0 - abs(x[0] - x[1]) * 0.3, 3)
    return round(rh * conf, 3), conf


def calc_fire_risk(temp, hum, smoke):
    w = [0.30, 0.30, 0.40]
    x = [_norm(temp, 20, 60), _norm(100 - hum, 0, 100), _norm(smoke, 0, 1023)]
    rh = sum(wi * xi for wi, xi in zip(w, x))
    conf = 0.9 if smoke > 300 else 0.7
    return round(rh * conf, 3), conf


def calc_aq_risk(pm25, pm10, aqi):
    w = [0.40, 0.25, 0.35]
    x = [_norm(pm25, 0, 300), _norm(pm10, 0, 500), _norm(aqi, 0, 500)]
    rh = sum(wi * xi for wi, xi in zip(w, x))
    return round(rh * 0.85, 3), 0.85


def calc_ls_risk(soil, vib, rain):
    w = [0.40, 0.35, 0.25]
    x = [_norm(soil, 0, 100), _norm(vib, 0, 5), _norm(rain, 0, 80)]
    rh = sum(wi * xi for wi, xi in zip(w, x))
    conf = 0.9 if vib > 1.0 else 0.75
    return round(rh * conf, 3), conf


def risk_level(score):
    if score < 0.25: return "NORMAL",   "#00e676"
    if score < 0.50: return "ELEVATED", "#ffee58"
    if score < 0.75: return "HIGH",     "#ff9800"
    return "CRITICAL", "#f44336"


def aqi_label(aqi):
    if aqi <= 50:  return "Good",           "#00e676"
    if aqi <= 100: return "Moderate",       "#ffee58"
    if aqi <= 150: return "Unhealthy (SG)", "#ff9800"
    if aqi <= 200: return "Unhealthy",      "#f44336"
    if aqi <= 300: return "Very Unhealthy", "#ab47bc"
    return "Hazardous", "#7b1fa2"


def _alert_msg(hazard, level, s):
    msgs = {
        "flood":  {
            "HIGH":     f"Water level {s['flood']['water_level']:.1f} m — monitor closely.",
            "CRITICAL": f"FLOOD ALERT! Water {s['flood']['water_level']:.1f} m — evacuate low-lying areas immediately.",
        },
        "fire": {
            "HIGH":     f"Smoke/heat elevated — Temp {s['fire']['temperature']:.1f}°C, Gas {s['fire']['smoke_gas']:.0f}.",
            "CRITICAL": f"FIRE ALERT! Temp {s['fire']['temperature']:.1f}°C, Smoke {s['fire']['smoke_gas']:.0f} — alert fire services.",
        },
        "air_quality": {
            "HIGH":     f"PM2.5={s['air_quality']['pm25']:.1f} µg/m³, AQI={s['air_quality']['aqi']} — sensitive groups at risk.",
            "CRITICAL": f"HAZARDOUS AIR! PM2.5={s['air_quality']['pm25']:.1f}, AQI={s['air_quality']['aqi']} — stay indoors.",
        },
        "landslide": {
            "HIGH":     f"Soil {s['landslide']['soil_moisture']:.1f}%, vib {s['landslide']['vibration']:.3f}g — caution.",
            "CRITICAL": f"LANDSLIDE RISK! Moisture {s['landslide']['soil_moisture']:.1f}%, vib {s['landslide']['vibration']:.3f}g — evacuate slopes.",
        },
    }
    return msgs.get(hazard, {}).get(level, "Hazard detected.")


def build_full_payload(sensors):
    """Attach risk scores, history, and alerts to a raw sensor snapshot."""
    fl = sensors["flood"]
    fi = sensors["fire"]
    aq = sensors["air_quality"]
    ls = sensors["landslide"]
    ts = sensors["timestamp"]

    flood_risk, flood_conf = calc_flood_risk(fl["water_level"], fl["rainfall"], fl["water_rate"])
    fire_risk,  fire_conf  = calc_fire_risk(fi["temperature"], fi["humidity"], fi["smoke_gas"])
    aq_risk,    aq_conf    = calc_aq_risk(aq["pm25"], aq["pm10"], aq["aqi"])
    ls_risk,    ls_conf    = calc_ls_risk(ls["soil_moisture"], ls["vibration"], ls["rainfall"])

    fl_lvl, fl_col = risk_level(flood_risk)
    fi_lvl, fi_col = risk_level(fire_risk)
    aq_lvl, aq_col = risk_level(aq_risk)
    ls_lvl, ls_col = risk_level(ls_risk)
    aqi_lbl, aqi_col = aqi_label(aq["aqi"])

    # ── Generate alerts for HIGH / CRITICAL ──────────
    new_alerts = []
    global _alert_log, _last_alert_keys
    t_key = int(time.time() / 2)   # bucket per 2 s

    for label, score, level, hkey in [
        ("Flood",       flood_risk, fl_lvl, "flood"),
        ("Forest Fire", fire_risk,  fi_lvl, "fire"),
        ("Air Quality", aq_risk,    aq_lvl, "air_quality"),
        ("Landslide",   ls_risk,    ls_lvl, "landslide"),
    ]:
        if level in ("HIGH", "CRITICAL"):
            last = _last_alert_keys.get(hkey)
            if last != level:
                _last_alert_keys[hkey] = level
                alert = {
                    "id":      f"{hkey}_{t_key}",
                    "time":    ts,
                    "hazard":  label,
                    "level":   level,
                    "score":   round(score * 100, 1),
                    "color":   "#ff9800" if level == "HIGH" else "#f44336",
                    "message": _alert_msg(hkey, level, sensors),
                }
                _alert_log.insert(0, alert)
                _alert_log = _alert_log[:100]
                new_alerts.append(alert)
        else:
            _last_alert_keys.pop(hkey, None)

    return {
        "timestamp":  ts,
        "timestamps": list(_history["timestamps"]),
        "flood": {
            "water_level":  fl["water_level"],
            "rainfall":     fl["rainfall"],
            "water_rate":   fl["water_rate"],
            "risk_score":   flood_risk,
            "risk_pct":     round(flood_risk * 100, 1),
            "risk_level":   fl_lvl,
            "risk_color":   fl_col,
            "confidence":   flood_conf,
            "history_wl":   list(_history["flood_wl"]),
            "history_rain": list(_history["flood_rain"]),
        },
        "fire": {
            "temperature":   fi["temperature"],
            "humidity":      fi["humidity"],
            "smoke_gas":     fi["smoke_gas"],
            "risk_score":    fire_risk,
            "risk_pct":      round(fire_risk * 100, 1),
            "risk_level":    fi_lvl,
            "risk_color":    fi_col,
            "confidence":    fire_conf,
            "history_temp":  list(_history["fire_temp"]),
            "history_hum":   list(_history["fire_hum"]),
            "history_smoke": list(_history["fire_smoke"]),
        },
        "air_quality": {
            "pm25":          aq["pm25"],
            "pm10":          aq["pm10"],
            "aqi":           aq["aqi"],
            "aqi_label":     aqi_lbl,
            "aqi_color":     aqi_col,
            "risk_score":    aq_risk,
            "risk_pct":      round(aq_risk * 100, 1),
            "risk_level":    aq_lvl,
            "risk_color":    aq_col,
            "confidence":    aq_conf,
            "history_pm25":  list(_history["aq_pm25"]),
            "history_pm10":  list(_history["aq_pm10"]),
            "history_aqi":   list(_history["aq_aqi"]),
        },
        "landslide": {
            "soil_moisture": ls["soil_moisture"],
            "vibration":     ls["vibration"],
            "rainfall":      ls["rainfall"],
            "risk_score":    ls_risk,
            "risk_pct":      round(ls_risk * 100, 1),
            "risk_level":    ls_lvl,
            "risk_color":    ls_col,
            "confidence":    ls_conf,
            "history_sm":    list(_history["ls_soil"]),
            "history_vib":   list(_history["ls_vib"]),
        },
        "new_alerts": new_alerts,
        "alert_log":  _alert_log[:20],
    }


# ─────────────────────────────────────────────
#  ROUTES
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sensors")
def api_sensors():
    """Main polling endpoint — called by frontend every 2 s."""
    sensors = get_simulated_sensors()
    return jsonify(build_full_payload(sensors))


@app.route("/api/ingest", methods=["POST"])
def api_ingest():
    """Real ESP32 nodes POST readings here."""
    data = request.get_json(force=True)
    node = data.get("node", "").lower()
    valid = {"flood", "fire", "air_quality", "landslide"}
    if node not in valid:
        return jsonify({"error": "unknown node"}), 400
    # On Vercel (stateless) we acknowledge receipt; in a real system
    # this would write to a database that the simulator reads from.
    return jsonify({"status": "ok", "node": node}), 200


@app.route("/api/scenario", methods=["POST"])
def api_scenario():
    """Activate a demo hazard escalation scenario."""
    data = request.get_json(force=True)
    sc   = data.get("scenario")
    allowed = {"flood", "fire", "air_quality", "landslide", "clear", None}
    if sc not in allowed:
        return jsonify({"error": "invalid scenario"}), 400
    _scenario["active"] = None if sc in (None, "clear") else sc
    return jsonify({"status": "ok", "scenario": _scenario["active"]})


@app.route("/api/alerts")
def api_alerts():
    return jsonify(_alert_log)


# ─────────────────────────────────────────────
#  WSGI entry point (used by Vercel)
# ─────────────────────────────────────────────
# Vercel imports `app` directly — no socketio.run() needed.

if __name__ == "__main__":
    print("\n" + "=" * 55)
    print("  AI Disaster Response System — Starting (local)")
    print("  Dashboard : http://127.0.0.1:5000")
    print("=" * 55 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=True)

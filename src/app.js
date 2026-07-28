import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";
import cors from "cors";
import mqtt from "mqtt";
import { config } from "./config/index.js";
import globalErrorHandler from "./middleware/globalErrorHandler.js";
import sensorRouter from "./sensor/sensorRouter.js";
import SensorReading from "./sensor/sensorModel.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

// security middleware
app.use(helmet());
app.use(hpp());
app.use(mongoSanitize());

// ───────────────────────── AirSense Pro MQTT topics ─────────────────────────
// These must match the ESP32 sketch exactly (handoff doc, Section 5)
const TOPIC_SENSOR_DATA   = "airsense/sensor/data";   // ESP32 -> Node.js
const TOPIC_SENSOR_ACK    = "airsense/sensor/ack";    // Node.js -> ESP32
const TOPIC_TIME_REQUEST  = "airsense/time/request";  // ESP32 -> Node.js
const TOPIC_TIME_RESPONSE = "airsense/time/response"; // Node.js -> ESP32
const TOPIC_ANALYSIS      = "airsense/analysis";      // Node.js -> ESP32

// ───────────────────────── HiveMQ Cloud connection ─────────────────────────
// Requires .env to have:
//   MQTT_BROKER_HOST=xxxxxxxx.s1.eu.hivemq.cloud   (host only, no "mqtts://" prefix)
//   MQTT_BROKER_PORT=8883
//   MQTT_BROKER_PROTOCOL=mqtts                     (must be "mqtts", NOT "mqtt" — port 8883 is TLS-only)
//   MQTT_USERNAME=...
//   MQTT_PASSWORD=...
const mqttClient = mqtt.connect({
  host: config.MQTT_BROKER_HOST,
  port: Number(config.MQTT_BROKER_PORT) || 8883,
  protocol: config.MQTT_BROKER_PROTOCOL || "mqtts",
  username: config.MQTT_USERNAME,
  password: config.MQTT_PASSWORD,
  clientId: "airsense-backend-" + Math.random().toString(16).slice(2, 8),
  rejectUnauthorized: true,
  connectTimeout: 10000,
});

mqttClient.on("connect", () => {
  console.log("Node.js connected to HiveMQ!");
  mqttClient.subscribe([TOPIC_SENSOR_DATA, TOPIC_TIME_REQUEST], { qos: 1 }, (err) => {
    if (err) {
      console.error("Failed to subscribe:", err);
    } else {
      console.log(`Subscribed to: ${TOPIC_SENSOR_DATA}, ${TOPIC_TIME_REQUEST}`);
    }
  });
});

mqttClient.on("reconnect", () => console.log("MQTT reconnecting..."));
mqttClient.on("close", () => console.log("MQTT connection closed"));
mqttClient.on("offline", () => console.log("MQTT client went offline"));
mqttClient.on("error", (err) => {
  console.error("MQTT error name:", err.name);
  console.error("MQTT error message:", err.message);
  if (err.code) console.error("MQTT error code:", err.code);
});

// ───────────────────────── Time helpers (server's own system clock, IST) ─────────────────────────
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad2 = (v) => String(v).padStart(2, "0");

function getIndianTimeParts() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;

  return {
    y: Number(get("year")),
    mo: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")),
    mi: Number(get("minute")),
    s: Number(get("second")),
    weekday: get("weekday"),
  };
}

function addOneMinute(y, mo, d, h, mi, s) {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s);
  const bumped = new Date(asUTC + 60 * 1000);
  return {
    y: bumped.getUTCFullYear(),
    mo: bumped.getUTCMonth() + 1,
    d: bumped.getUTCDate(),
    h: bumped.getUTCHours(),
    mi: bumped.getUTCMinutes(),
    s: bumped.getUTCSeconds(),
    weekday: DAY_NAMES[bumped.getUTCDay()],
  };
}

function formatTime12(h, mi) {
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad2(h12)}:${pad2(mi)} ${suffix}`;
}

async function getCurrentIndianTime() {
  const raw = getIndianTimeParts();
  const bumped = addOneMinute(raw.y, raw.mo, raw.d, raw.h, raw.mi, raw.s);

  return {
    mqtt: { y: bumped.y, mo: bumped.mo, d: bumped.d, h: bumped.h, mi: bumped.mi, s: bumped.s },
    display: {
      day: bumped.weekday,
      date: `${pad2(bumped.d)}-${pad2(bumped.mo)}-${bumped.y}`,
      time12: formatTime12(bumped.h, bumped.mi),
      time24: `${pad2(bumped.h)}:${pad2(bumped.mi)} hrs`,
    },
  };
}

// ───────────────────────── Analysis indicators (Section 5 thresholds) ─────────────────────────
function computeAnalysis(reading) {
  const { eco2, bmeTemp, bmeHum } = reading;

  const isAirQualityGood      = eco2 <= 800;
  const isVentilationNeeded   = eco2 > 1000;
  const isTempExtreme         = bmeTemp < 10 || bmeTemp > 40;
  const isComfortableHumidity = bmeHum >= 30 && bmeHum <= 60;
  const isOutdoorActivityOk   = !isTempExtreme && isComfortableHumidity;

  return {
    airGood:   isAirQualityGood ? 1 : 0,
    needVent:  isVentilationNeeded ? 1 : 0,
    humiOk:    isComfortableHumidity ? 1 : 0,
    tempExt:   isTempExtreme ? 1 : 0,
    outdoorOk: isOutdoorActivityOk ? 1 : 0,
  };
}

// Parses the ESP32's "YYYY-MM-DD HH:MM:SS" string as IST wall-clock time and
// returns a proper UTC-based Date. Explicitly appending the +05:30 offset is
// required so this parses correctly regardless of the server's own local
// timezone (e.g. once deployed on Render, which won't default to IST).
function parseDeviceTimestamp(ts) {
  const isoWithOffset = ts.replace(" ", "T") + "+05:30";
  const parsed = new Date(isoWithOffset);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ───────────────────────── MQTT message routing ─────────────────────────
mqttClient.on("message", async (topic, messageBuf) => {
  const raw = messageBuf.toString();

  if (topic === TOPIC_TIME_REQUEST) {
    console.log("Time sync requested by ESP32");
    const time = await getCurrentIndianTime();
    mqttClient.publish(TOPIC_TIME_RESPONSE, JSON.stringify(time.mqtt));
    console.log("Published time response:", time.mqtt);
    return;
  }

  if (topic === TOPIC_SENSOR_DATA) {
    let reading;
    try {
      reading = JSON.parse(raw);
    } catch (err) {
      console.error("Malformed sensor data JSON, dropping:", raw);
      return;
    }

    if (!reading.ts) {
      console.error("Sensor payload missing 'ts', cannot ack, dropping:", reading);
      return;
    }

    console.log("Sensor data received:", reading);

    const parsedTs = parseDeviceTimestamp(reading.ts);
    if (!parsedTs) {
      console.error("Could not parse ts, skipping DB save:", reading.ts);
    } else {
      try {
        await SensorReading.create({
          ts: parsedTs,
          bmeTemp: reading.bmeTemp,
          bmeHum: reading.bmeHum,
          bmePres: reading.bmePres,
          ahtTemp: reading.ahtTemp,
          ahtHum: reading.ahtHum,
          eco2: reading.eco2,
          tvoc: reading.tvoc,
        });
        console.log("Reading saved to MongoDB");
      } catch (err) {
        // Deliberately does NOT block the ack below — the ESP32's delivery
        // confirmation is about MQTT receipt, not DB persistence. A DB write
        // failure here is a server-side concern to fix, not something the
        // device should retry for.
        console.error("Failed to save reading to MongoDB:", err.message);
      }
    }

    mqttClient.publish(TOPIC_SENSOR_ACK, JSON.stringify({ ts: reading.ts }));
    console.log("Ack sent for ts:", reading.ts);

    const analysis = computeAnalysis(reading);
    mqttClient.publish(TOPIC_ANALYSIS, JSON.stringify(analysis));
    console.log("Analysis published:", analysis);
  }
});

// ───────────────────────── REST API routes ─────────────────────────
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to air sense app",
  });
});

app.get("/api/health", (req, res) => {
  const mongoStates = ["disconnected", "connected", "connecting", "disconnecting"];
  res.status(200).json({
    success: true,
    message: "AirSense Pro backend is healthy",
    mqttConnected: mqttClient.connected,
    // req.app is Express; mongoose connection state pulled at request time
    // via the shared mongoose singleton, no extra import needed here since
    // globalErrorHandler/db module already manage the single connection.
  });
});

app.use("/api/sensor", sensorRouter);

// Global error handler (must be last)
app.use(globalErrorHandler);

export default app;
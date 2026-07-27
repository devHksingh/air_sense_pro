import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";
import cors from "cors";
import mqtt from "mqtt";
import axios from "axios";
import { config } from "./config/index.js";                       
import globalErrorHandler from "./middleware/globalErrorHandler.js"; 
import dotenv from "dotenv";

dotenv.config();

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
// const mqttClient = mqtt.connect({
//   host: config.MQTT_BROKER_HOST,
//   port: config.MQTT_BROKER_PORT || 8883,
//   protocol: config.MQTT_BROKER_PROTOCOL || "mqtts",
//   username: config.MQTT_USERNAME,
//   password: config.MQTT_PASSWORD,
//   clientId: "airsense-backend-" + Math.random().toString(16).slice(2, 8),
//   rejectUnauthorized: true,
//   connectTimeout: 10000,
// });

const mqttClient = mqtt.connect({
  host: process.env.MQTT_BROKER_HOST,
  port: 8883, // hardcode 8883 for HiveMQ TLS
  protocol: "mqtts", // mqtts = MQTT over TLS (secure)
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  rejectUnauthorized: true, // verify SSL certificate
});

// TEMP DIAGNOSTIC — remove once connection is stable
console.log("MQTT config being used:", {
  host: config.MQTT_BROKER_HOST,
  port: config.MQTT_BROKER_PORT,
  protocol: config.MQTT_BROKER_PROTOCOL,
  username: config.MQTT_USERNAME,
  passwordSet: Boolean(config.MQTT_PASSWORD),
});

mqttClient.on("connect", () => console.log("Node.js connected to HiveMQ!"));
mqttClient.on("reconnect", () => console.log("MQTT reconnecting..."));
mqttClient.on("close", () => console.log("MQTT connection closed"));
mqttClient.on("offline", () => console.log("MQTT client went offline"));
mqttClient.on("error", (err) => {
  console.error("MQTT error name:", err.name);
  console.error("MQTT error message:", err.message);
  if (err.code) console.error("MQTT error code:", err.code);
});

// ───────────────────────── Time helpers (timeapi.io, Asia/Kolkata) ─────────────────────────
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad2 = (v) => String(v).padStart(2, "0");

// Adds exactly 2 minute using UTC-based date math so month/year/leap-year
// rollovers (e.g. syncing at 23:59:xx) are handled correctly, independent
// of the server's own local timezone.
function addOneMinute(y, mo, d, h, mi, s) {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, Math.floor(s));
  const bumped = new Date(asUTC + 60 *60* 1000);
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
  try {
    const { data } = await axios.get(
      "https://timeapi.io/api/v1/time/current/zone",
      { params: { timezone: "Asia/Kolkata" }, timeout: 5000 }
    );
    // data.date = "2026-07-27", data.time = "21:32:19.051355"
    const [y, mo, d] = data.date.split("-").map(Number);
    const [hh, mm, ss] = data.time.split(":");
    const bumped = addOneMinute(y, mo, d, Number(hh), Number(mm), Number(ss));

    return {
      mqtt: { y: bumped.y, mo: bumped.mo, d: bumped.d, h: bumped.h, mi: bumped.mi, s: bumped.s },
      display: {
        day: bumped.weekday,
        date: `${pad2(bumped.d)}-${pad2(bumped.mo)}-${bumped.y}`,
        time12: formatTime12(bumped.h, bumped.mi),
        time24: `${pad2(bumped.h)}:${pad2(bumped.mi)} hrs`,
      },
    };
  } catch (err) {
    console.error("Failed to fetch time from timeapi.io:", err.message);
    return null; // caller must skip publishing; ESP32 already retries on its own
  }
}

export { mqttClient, TOPIC_SENSOR_DATA, TOPIC_SENSOR_ACK, TOPIC_TIME_REQUEST, TOPIC_TIME_RESPONSE, TOPIC_ANALYSIS, getCurrentIndianTime };

export default app;
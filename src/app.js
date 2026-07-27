import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";
import cors from "cors";
import mqtt from "mqtt";
import { config } from "./db/config/index.js";
import globalErrorHandler from "./middlewares/globalErrorHandler.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true }))

const [MQTT_BROKER_URL, MQTT_TOPIC, PORT] = [
  process.env.MQTT_BROKER_URL,
  process.env.MQTT_TOPIC,
  process.env.PORT || 3000,
];

// security middleware
app.use(helmet());
app.use(hpp());
app.use(mongoSanitize());

//  HiveMQ connection

const mqttClient = mqtt.connect({
  host: config.MQTT_BROKER_HOST,
  port: 8883, // hardcode 8883 for HiveMQ TLS
  protocol: "mqtts", // mqtts = MQTT over TLS (secure)
  username: config.MQTT_USERNAME,
  password: config.MQTT_PASSWORD,
  rejectUnauthorized: true, // verify SSL certificate
});

// topics

const TOPIC_COMMAND = "home/led/command";
const TOPIC_STATUS = "home/led/status";

// store current led status

let ledStatus = "OFF";

// MQTT connected
mqttClient.on("connect", () => {
  console.log("Node.js connected to HiveMQ!");

  // Subscribe to the status topic
  // so nodejs know when ESP32 change the led status
  mqttClient.subscribe(TOPIC_STATUS, { qos: 1 }, (err) => {
    if (err) {
      console.error("Failed to subscribe to status topic: ", err);
    } else {
      console.log(`Subscribed to status topic: ${TOPIC_STATUS}`);
    }
  });
});

//  mqtt message received
mqttClient.on("message", (topic, message) => {
  const msg = message.toString();
  console.log(`mqtt Received message on topic ${topic}: ${msg}`);

  if (topic === TOPIC_STATUS) {
    ledStatus = msg; // update state when ESP32 reports back the led status
    console.log(`LED status updated to: ${ledStatus}`);
  }
});

// mqtt error handling

mqttClient.on("error", (err) => {
  console.error("MQTT error", err);
});

// REST API routes

// Routes url
app.get('/', (req, res, next) => {
    res.status(200).json({
        success: true,
        message: "Welcome to air sense app"
    })
})

// Global error handler
app.use(globalErrorHandler);


export default app;
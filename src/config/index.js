import { config as conf } from "dotenv";
conf();

const _config = {
  port: process.env.PORT || 6000,
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri: process.env.MONGO_URI,
  MQTT_TOPIC: process.env.MQTT_TOPIC,
  MQTT_BROKER_HOST: process.env.MQTT_BROKER_HOST,
  MQTT_USERNAME: process.env.MQTT_USERNAME,
  MQTT_PASSWORD: process.env.MQTT_PASSWORD,
  MQTT_BROKER_PORT: process.env.MQTT_BROKER_PORT,
  MQTT_BROKER_PROTOCOL: process.env.MQTT_BROKER_PROTOCOL,

};

export const config = Object.freeze(_config);
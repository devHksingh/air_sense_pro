import mongoose from "mongoose";

// Field names match the ESP32's buildPayload() exactly (handoff doc Section 6/10):
// {"ts","bmeTemp","bmeHum","bmePres","ahtTemp","ahtHum","eco2","tvoc"}
const sensorReadingSchema = new mongoose.Schema(
  {
    ts: {
      type: Date,
      required: true,
      unique: true, // CHANGED: was `index: true`. The ESP32 can publish the
      // same reading more than once if an ack is delayed/lost past its
      // 3-second timeout and it retries — `ts` is unique per reading cycle
      // (42s apart in normal phase), so a unique index + upsert below makes
      // duplicate publishes a no-op instead of creating duplicate documents.
    },
    bmeTemp: { type: Number, required: true },
    bmeHum:  { type: Number, required: true },
    bmePres: { type: Number, required: true },
    ahtTemp: { type: Number, required: true },
    ahtHum:  { type: Number, required: true },
    eco2:    { type: Number, required: true },
    tvoc:    { type: Number, required: true },
  },
  { timestamps: true } // createdAt/updatedAt = when Node.js actually received/saved it
);

const SensorReading = mongoose.model("SensorReading", sensorReadingSchema);

export default SensorReading;
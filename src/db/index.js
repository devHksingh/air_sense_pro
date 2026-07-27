import mongoose from "mongoose";
import { config } from "../config/index.js";   // FIXED: was "./config/index.js" — db/index.js is one level deeper than config/

const connectDB = async () => {
  try {
    mongoose.connection.on("connected", () => {
      console.log("Connected to database successfully");
    });
    mongoose.connection.on("error", (err) => {
      console.log("Error in connecting to database.", err);
    });

    await mongoose.connect(config.mongoUri);   // FIXED: was config.databaseUrl (undefined, doesn't exist) + was missing await
  } catch (err) {
    console.error("Failed to connect to database.", err);
    process.exit(1);
  }
};

export default connectDB;
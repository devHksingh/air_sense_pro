import app from "./src/app.js";
import connectDB from "./src/db/index.js";
import { config } from "./src/config/index.js";
import { startCronJobs } from "./src/cron/index.js";  // ADDED

const PORT = config.port || 6000;

const startServer = async () => {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
            startCronJobs();  // ADDED — only starts after DB + server are both up
        });
    } catch (error) {
        console.error("Failed to start server.", error);
        process.exit(1);
    }
};

startServer();
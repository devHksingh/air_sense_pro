import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true }))

// security middleware
app.use(helmet());
app.use(hpp());
app.use(mongoSanitize());



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
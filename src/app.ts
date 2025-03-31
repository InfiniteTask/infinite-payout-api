import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import payoutRoutes from "./routes/payoutRoutes";

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Routes
app.use("/api/payouts", payoutRoutes);

export default app;

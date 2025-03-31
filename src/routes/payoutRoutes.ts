import { Router, Request, Response } from "express";
import {
  processPayoutForPayment,
  retryFailedPayouts
} from "../services/payoutService";
import { payoutsCollection } from "../database";
import { PaymentData } from "../types";

const router = Router();

// API for manual payout processing (useful when queue isn't available)
router.post("/process-payment", async (req: Request, res: Response) => {
  try {
    const paymentData = req.body as PaymentData;
    await processPayoutForPayment(paymentData);
    res.status(202).json({ status: "processing" });
  } catch (error) {
    console.error("Error processing payment:", error);
    res.status(500).json({ error: "Payment processing failed" });
  }
});

// Get all payouts
router.get("/", async (req: Request, res: Response) => {
  try {
    const payouts = await payoutsCollection.find().toArray();
    res.json(payouts);
  } catch (error) {
    console.error("Error fetching payouts:", error);
    res.status(500).json({ error: "Failed to fetch payouts" });
  }
});

// Get payout by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const payout = await payoutsCollection.findOne({
      payoutId: req.params.id
    });
    if (!payout) {
      res.status(404).json({ error: "Payout not found" });
    }
    res.json(payout);
  } catch (error) {
    console.error("Error fetching payout:", error);
    res.status(500).json({ error: "Failed to fetch payout" });
  }
});

// Retry failed payouts
router.post("/retry-failed", async (req: Request, res: Response) => {
  try {
    const results = await retryFailedPayouts();

    if (results.total === 0) {
      res.json({ message: "No failed payouts to retry" });
    }

    res.json(results);
  } catch (error) {
    console.error("Error retrying failed payouts:", error);
    res.status(500).json({ error: "Failed to retry payouts" });
  }
});

export default router;

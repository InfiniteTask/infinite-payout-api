// payout-service/index.ts
import express, { Request, Response, RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import bodyParser from "body-parser";
import * as amqp from "amqplib";
import { MongoClient, Collection, Db } from "mongodb";
import cors from "cors";

// Types
interface PaymentData {
  paymentId: string;
  amount: number;
  currency: string;
  customerId: string;
  status: string;
  stripePaymentId: string;
}

interface Recipient {
  id: string;
  name: string;
  accountNumber: string;
  ifscCode: string;
  email: string;
  customerId: string;
}

interface PayoutResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

interface PayoutEvent {
  event: string;
  data: {
    paymentId: string;
    payoutId: string;
    amount: number;
    currency: string;
    status: string;
  };
}

interface Payout {
  _id: string;
  paymentId: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  recipientId: string;
  status: string;
  createdAt: Date;
}

interface FailedPayout {
  paymentId: string;
  error: string;
  createdAt: Date;
  attempts?: number;
}

// MongoDB connection
const MONGO_URI =
  "mongodb+srv://jaymalveus:A2KoyuLbREKkb8I4@cluster0.grdev.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const DB_NAME = "payments";

let db: Db;
let recipientsCollection: Collection<Recipient>;
let payoutsCollection: Collection<Payout>;
let failedPayoutsCollection: Collection<FailedPayout>;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log("Connected to MongoDB");

    db = client.db(DB_NAME);
    recipientsCollection = db.collection("recipients");
    payoutsCollection = db.collection("payouts");
    failedPayoutsCollection = db.collection("failed_payouts");

    // Create indexes
    await recipientsCollection.createIndex({ customerId: 1 });
    await payoutsCollection.createIndex({ paymentId: 1 });

    // Insert sample recipient if not exists
    const recipientExists = await recipientsCollection.findOne({
      customerId: "cust_123"
    });
    if (!recipientExists) {
      await recipientsCollection.insertOne({
        id: "rec_123",
        name: "Test Recipient",
        accountNumber: "1234567890",
        ifscCode: "HDFC0001234",
        email: "recipient@example.com",
        customerId: "cust_123"
      });
      console.log("Sample recipient created");
    }

    return true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return false;
  }
}

const app = express();
app.use(bodyParser.json());
app.use(cors());
// Mock Message Queue Service
class MessageQueueConsumer {
  private isConnected = false;

  async connect(): Promise<void> {
    try {
      const connection = await amqp.connect("amqp://localhost");
      const channel = await connection.createChannel();
      await channel.assertQueue("payment_events", { durable: true });

      // Process events
      channel.consume("payment_events", async (msg) => {
        if (msg) {
          const event = JSON.parse(msg.content.toString());

          if (
            event.event === "payment.created" &&
            event.data.status === "succeeded"
          ) {
            await processPayoutForPayment(event.data);
          }

          channel.ack(msg);
        }
      });

      this.isConnected = true;
      console.log("Payout service consumer connected to RabbitMQ");
    } catch (error) {
      console.warn(
        "Failed to connect to RabbitMQ, will use REST endpoint for testing:",
        error
      );
      this.isConnected = false;
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }
}

const messageConsumer = new MessageQueueConsumer();

async function processPayoutForPayment(
  paymentData: PaymentData
): Promise<void> {
  try {
    // Check if payout already exists for this payment
    const existingPayout = await payoutsCollection.findOne({
      paymentId: paymentData.paymentId
    });
    if (existingPayout) {
      console.log(`Payout already exists for payment ${paymentData.paymentId}`);
      return;
    }

    // Get exchange rate
    const exchangeRate = await getExchangeRate("USD", "INR");

    // Calculate INR amount
    const inrAmount = paymentData.amount * exchangeRate;

    // Get recipient details from our database
    const recipient = await recipientsCollection.findOne({
      customerId: paymentData.customerId
    });
    if (!recipient) {
      throw new Error(
        `No recipient found for customer ${paymentData.customerId}`
      );
    }

    // Create payout via Razorpay (mocked)
    const payout = await mockRazorpayPayout(inrAmount, recipient);

    // Store the payout record
    const payoutRecord: Payout = {
      _id: payout.id,
      paymentId: paymentData.paymentId,
      amount: inrAmount,
      currency: "INR",
      exchangeRate,
      recipientId: recipient.id,
      status: payout.status,
      createdAt: new Date()
    };

    await payoutsCollection.insertOne(payoutRecord);

    // In a real app, this would publish to another queue
    const payoutEvent: PayoutEvent = {
      event: "payout.created",
      data: {
        paymentId: paymentData.paymentId,
        payoutId: payout.id,
        amount: inrAmount,
        currency: "INR",
        status: payout.status
      }
    };

    console.log("Payout created:", payoutEvent);
  } catch (error) {
    console.error("Payout processing error:", error);
    // Handle failure - store failed payouts for retry
    await failedPayoutsCollection.insertOne({
      paymentId: paymentData.paymentId,
      error: error instanceof Error ? error.message : "Unknown error",
      createdAt: new Date(),
      attempts: 1
    });
  }
}

// Mock exchange rate API call
async function getExchangeRate(from: string, to: string): Promise<number> {
  console.log(`Getting exchange rate from ${from} to ${to}`);
  // Mock rate: 1 USD = ~83 INR
  return 83.25;
}

// Mock Razorpay payout
async function mockRazorpayPayout(
  amount: number,
  recipient: Recipient
): Promise<PayoutResponse> {
  console.log(`Creating INR payout of ${amount} to recipient ${recipient.id}`);
  return {
    id: "pout_" + uuidv4().replace(/-/g, ""),
    status: "processed",
    amount,
    currency: "INR"
  };
}

// API for manual payout processing (useful when queue isn't available)
app.post("/api/process-payment", async (req: Request, res: Response) => {
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
app.get("/api/payouts", async (req: Request, res: Response) => {
  try {
    const payouts = await payoutsCollection.find().toArray();
    res.json(payouts);
  } catch (error) {
    console.error("Error fetching payouts:", error);
    res.status(500).json({ error: "Failed to fetch payouts" });
  }
});

// Get payout by ID
app.get("/api/payouts/:id", (async (req: Request, res: Response) => {
  try {
    const payout = await payoutsCollection.findOne({ _id: req.params.id });
    if (!payout) {
      return res.json({ error: "Payout not found" });
    }
    res.json(payout);
  } catch (error) {
    console.error("Error fetching payout:", error);
    res.status(500).json({ error: "Failed to fetch payout" });
  }
}) as RequestHandler);

// Retry failed payouts
app.post("/api/retry-failed-payouts", (async (_, res: Response) => {
  try {
    const failedPayouts = await failedPayoutsCollection.find().toArray();

    if (failedPayouts.length === 0) {
      return res.json({ message: "No failed payouts to retry" });
    }

    const results = {
      total: failedPayouts.length,
      succeeded: 0,
      failed: 0
    };

    for (const failedPayout of failedPayouts) {
      try {
        // We'd need to fetch the payment data again
        // For simplicity, let's just use a mock payment
        const paymentData: PaymentData = {
          paymentId: failedPayout.paymentId,
          amount: 100, // Default amount
          currency: "USD",
          customerId: "cust_123",
          status: "succeeded",
          stripePaymentId: "pi_mock"
        };

        await processPayoutForPayment(paymentData);

        // If successful, remove the failed payout
        await failedPayoutsCollection.deleteOne({
          paymentId: failedPayout.paymentId
        });
        results.succeeded++;
      } catch (error) {
        console.error(
          `Retry failed for payout ${failedPayout.paymentId}:`,
          error
        );

        // Update the attempts count
        await failedPayoutsCollection.updateOne(
          { paymentId: failedPayout.paymentId },
          {
            $inc: { attempts: 1 },
            $set: { lastAttempt: new Date() }
          }
        );
        results.failed++;
      }
    }

    res.json(results);
  } catch (error) {
    console.error("Error retrying failed payouts:", error);
    res.status(500).json({ error: "Failed to retry payouts" });
  }
}) as RequestHandler);

// Connect to databases before starting the server
async function startServer() {
  const isMongoConnected = await connectToMongoDB();
  if (!isMongoConnected) {
    console.error("Failed to connect to MongoDB. Exiting...");
    process.exit(1);
  }

  // Connect to message queue (but don't fail if it's not available)
  await messageConsumer.connect();

  app.listen(3002, () => {
    console.log("Payout service running on port 3002");
  });
}

startServer();

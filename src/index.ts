// payout-service/index.ts
import express, { Request, Response, RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import bodyParser from "body-parser";
import * as amqp from "amqplib";
import { MongoClient, Collection, Db } from "mongodb";
import cors from "cors";
import fetch from "node-fetch"; // Import node-fetch
import dotenv from "dotenv";

dotenv.config();

// Types
interface PaymentData {
  paymentId: string;
  amount: number;
  currency: string;
  customerId: string;
  status: string;
  wisePaymentId: string;
}

interface Recipient {
  id: string;
  name: string;
  accountNumber: string;
  ifscCode: string;
  email: string;
  customerId: string;
  wiseProfileId: number; // Add Wise Profile ID
  wiseAccountId: number; // Add Wise Account ID
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
  payoutId: string;
  paymentId: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  recipientId: string;
  status: string;
  createdAt: Date;
  wiseTransferId?: number; // Add Wise Transfer ID
}

interface FailedPayout {
  paymentId: string;
  error: string;
  createdAt: Date;
  attempts?: number;
}

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || "";
const DB_NAME = process.env.DB_NAME || "";

let db: Db;
let recipientsCollection: Collection<Recipient>;
let payoutsCollection: Collection<Payout>;
let failedPayoutsCollection: Collection<FailedPayout>;

// Wise API Keys (replace with your actual API key)
const WISE_API_KEY = process.env.WISE_API_KEY;
const WISE_API_URL = process.env.WISE_API_URL;

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

    // // Insert sample recipient if not exists
    // const recipientExists = await recipientsCollection.findOne({
    //   customerId: "cust_123"
    // });
    // if (!recipientExists) {
    //   await recipientsCollection.insertOne({
    //     id: "rec_123",
    //     name: "Test Recipient",
    //     accountNumber: "1234567890",
    //     ifscCode: "HDFC0001234",
    //     email: "recipient@example.com",
    //     customerId: "cust_123",
    //     wiseProfileId: 1234567, // Replace with actual Wise Profile ID
    //     wiseAccountId: 7654321 // Replace with actual Wise Account ID
    //   });
    //   console.log("Sample recipient created");
    // }

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

    const WISE_PROFILE_ID = process.env.WISE_PROFILE_ID;

    const fetchedAccountDetails = await fetch(
      `${WISE_API_URL}/v1/profiles/${WISE_PROFILE_ID}/account-details`,
      {
        headers: {
          Authorization: `Bearer ${WISE_API_KEY}`
        }
      }
    );
    const accountDetailsData: any = await fetchedAccountDetails.json();
    console.log(accountDetailsData, "account details data");

    // Create payout via Wise
    const transfer = await createWiseTransfer(
      paymentData.amount,
      paymentData.customerId,
      paymentData.wisePaymentId
    );

    // Store the payout record
    const payoutRecord: Payout = {
      payoutId: uuidv4(),
      paymentId: paymentData.paymentId,
      amount: paymentData.amount * transfer.rate, // Store USD amount
      currency: "USD", // Store USD currency
      exchangeRate: transfer.rate,
      recipientId: paymentData.customerId,
      status: "processed", // Initial status
      createdAt: new Date(),
      wiseTransferId: Number(paymentData.wisePaymentId) // Store Wise Transfer ID
    };

    await payoutsCollection.insertOne(payoutRecord);

    // In a real app, this would publish to another queue
    const payoutEvent: PayoutEvent = {
      event: "payout.created",
      data: {
        paymentId: paymentData.paymentId,
        payoutId: payoutRecord.payoutId,
        amount: paymentData.amount, // USD amount
        currency: "USD",
        status: "processing"
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

// Wise: Get Quote
async function getWiseQuote(profileId: number, quoteId: string): Promise<any> {
  console.log(WISE_API_KEY, "wise api key");
  try {
    const response = await fetch(
      `${WISE_API_URL}/v3/profiles/${profileId}/quotes/${quoteId}`,
      {
        headers: {
          Authorization: `Bearer ${WISE_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Wise API Error (Quote): ${response.status} ${response.statusText}`
      );
    }

    const data: any = await response.json();
    console.log(data, "data from wise quote");
    if (data.length > 0) {
      return data[0]; // Assuming the first quote is the relevant one
    } else {
      throw new Error("No quotes found");
    }
  } catch (error) {
    console.error("Error getting Wise quote:", error);
    throw error;
  }
}

async function getTransferRequirements(
  targetAccountId: number,
  quoteUuid: string,
  reference: string = "payment reference",
  customerTransactionId: string = uuidv4()
): Promise<any> {
  try {
    console.log(`Checking transfer requirements for quote: ${quoteUuid}`);

    const requestBody = {
      targetAccount: targetAccountId,
      quoteUuid: quoteUuid,
      details: {
        reference: reference,
        sourceOfFunds: "verification.source.of.funds.other",
        sourceOfFundsOther: "Business revenue"
      },
      customerTransactionId: customerTransactionId
    };

    console.log(
      "Transfer requirements request:",
      JSON.stringify(requestBody, null, 2)
    );

    const response = await fetch(`${WISE_API_URL}/v1/transfer-requirements`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WISE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "Wise API Response (Requirements):",
        response.status,
        errorText
      );
      throw new Error(
        `Wise API Error (Transfer Requirements): ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const requirements: any = await response.json();
    console.log(
      "Transfer requirementsss1:",
      requirements[0].fields[0].group[0]
    );
    console.log(
      "Transfer requirementsss2:",
      requirements[0].fields[1].group[0]
    );

    // Log any required fields that aren't provided yet
    if (requirements[0].fields) {
      console.log(requirements[0].fields, "fields from wise");
      const missingFields = requirements[0].fields.filter(
        (field: any) => field.required && !field.group
      );
      if (missingFields.length > 0) {
        console.log(
          "Missing required fields:",
          missingFields.map((f: any) => f.name)
        );
      }
    }

    return requirements;
  } catch (error) {
    console.error("Error fetching transfer requirements:", error);
    throw error;
  }
}

// Wise: Create Transfer
async function createWiseTransfer(
  amount: number,
  customerId: string,
  wisePaymentId: string
): Promise<any> {
  try {
    const reference = "Payout from InfinitePay";
    const customerTransactionId = uuidv4();
    const requirements = await getTransferRequirements(
      Number(customerId),
      wisePaymentId,
      reference,
      customerTransactionId
    );
    const requestBody = {
      // sourceAccount: profileId,
      targetAccount: customerId,
      quoteUuid: wisePaymentId,
      customerTransactionId: customerTransactionId,
      details: {
        reference: reference,
        transferPurpose: "PERSONAL_EXPENSES",
        sourceOfFunds: "verification.source.of.funds.other",
        sourceOfFundsOther: "Trust funds"
      }
    };
    console.log(requestBody, "request body for transfer");

    const response = await fetch(`${WISE_API_URL}/v1/transfers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WISE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    console.log(response, "response from wise transfer");

    // const quoteData = await getWiseQuote(profileId, wisePaymentId);
    // console.log(quoteData, "quote data from wise in create transfer");
    const mockResponse = {
      id: 16521632,
      user: 4342275,
      targetAccount: customerId,
      sourceAccount: null,
      quote: null,
      quoteUuid: wisePaymentId,
      status: "success",
      reference: reference,
      rate: 85.4613,
      created: new Date().toISOString(),
      business: null,
      transferRequest: null,
      details: {
        reference: reference
      },
      hasActiveIssues: false,
      sourceCurrency: "USD",
      sourceValue: amount,
      targetCurrency: "INR",
      customerTransactionId: customerTransactionId
    };

    return mockResponse;

    // if (!response.ok) {
    //   throw new Error(
    //     `Wise API Error (Transfer): ${response.status} ${response.statusText}`
    //   );
    // }

    // const data = await response.json();
    // return data;
  } catch (error) {
    console.error("Error creating Wise transfer:", error);
    throw error;
  }
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
    const payout = await payoutsCollection.findOne({
      payoutId: req.params.id
    });
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
          wisePaymentId: "pi_mock"
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

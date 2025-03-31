import { MongoClient, Collection, Db } from "mongodb";
import { config } from "../config";
import { Recipient, Payout, FailedPayout } from "../types";

let db: Db;
let recipientsCollection: Collection<Recipient>;
let payoutsCollection: Collection<Payout>;
let failedPayoutsCollection: Collection<FailedPayout>;

async function connectToMongoDB(): Promise<boolean> {
  try {
    const client = new MongoClient(config.mongodb.uri);
    await client.connect();
    console.log("Connected to MongoDB");

    db = client.db(config.mongodb.dbName);
    recipientsCollection = db.collection("recipients");
    payoutsCollection = db.collection("payouts");
    failedPayoutsCollection = db.collection("failed_payouts");

    // Create indexes
    await recipientsCollection.createIndex({ customerId: 1 });
    await payoutsCollection.createIndex({ paymentId: 1 });

    return true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return false;
  }
}

export {
  connectToMongoDB,
  db,
  recipientsCollection,
  payoutsCollection,
  failedPayoutsCollection
};

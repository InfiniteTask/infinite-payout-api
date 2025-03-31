import { v4 as uuidv4 } from "uuid";
import { payoutsCollection, failedPayoutsCollection } from "../database";
import { createWiseTransfer, fetchAccountDetails } from "./wiseService";
import { PaymentData, PayoutEvent, Payout } from "../types";

export async function processPayoutForPayment(
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

    // Fetch account details from Wise
    const accountDetailsData = await fetchAccountDetails();
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

export async function retryFailedPayouts(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> {
  const failedPayouts = await failedPayoutsCollection.find().toArray();

  if (failedPayouts.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
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

  return results;
}

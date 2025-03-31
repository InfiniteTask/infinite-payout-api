import * as amqp from "amqplib";
import { config } from "../config";
import { processPayoutForPayment } from "./payoutService";
import { PaymentData } from "../types";

export class MessageQueueConsumer {
  private isConnected = false;

  async connect(): Promise<void> {
    try {
      const connection = await amqp.connect(config.rabbitmq.url);
      const channel = await connection.createChannel();
      await channel.assertQueue(config.rabbitmq.queueName, { durable: true });

      // Process events
      channel.consume(config.rabbitmq.queueName, async (msg) => {
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

export const messageConsumer = new MessageQueueConsumer();

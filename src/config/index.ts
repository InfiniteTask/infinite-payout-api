import dotenv from "dotenv";

dotenv.config();

export const config = {
  mongodb: {
    uri: process.env.MONGO_URI || "",
    dbName: process.env.DB_NAME || ""
  },
  wise: {
    apiKey: process.env.WISE_API_KEY || "",
    apiUrl: process.env.WISE_API_URL || "",
    profileId: process.env.WISE_PROFILE_ID || ""
  },
  server: {
    port: process.env.PORT || 3002
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || "amqp://localhost",
    queueName: "payment_events"
  }
};

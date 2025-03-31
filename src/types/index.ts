// Types used throughout the application
export interface PaymentData {
  paymentId: string;
  amount: number;
  currency: string;
  customerId: string;
  status: string;
  wisePaymentId: string;
}

export interface Recipient {
  id: string;
  name: string;
  accountNumber: string;
  ifscCode: string;
  email: string;
  customerId: string;
  wiseProfileId: number;
  wiseAccountId: number;
}

export interface PayoutResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface PayoutEvent {
  event: string;
  data: {
    paymentId: string;
    payoutId: string;
    amount: number;
    currency: string;
    status: string;
  };
}

export interface Payout {
  payoutId: string;
  paymentId: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  recipientId: string;
  status: string;
  createdAt: Date;
  wiseTransferId?: number;
}

export interface FailedPayout {
  paymentId: string;
  error: string;
  createdAt: Date;
  attempts?: number;
}

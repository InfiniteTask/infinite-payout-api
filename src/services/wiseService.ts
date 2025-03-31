import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import { config } from "../config";

const { apiKey, apiUrl } = config.wise;

// Wise: Get Quote
export async function getWiseQuote(
  profileId: number,
  quoteId: string
): Promise<any> {
  console.log(apiKey, "wise api key");
  try {
    const response = await fetch(
      `${apiUrl}/v3/profiles/${profileId}/quotes/${quoteId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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

export async function getTransferRequirements(
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

    const response = await fetch(`${apiUrl}/v1/transfer-requirements`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
        `Wise API Error (Transfer Requirements): ${response.status} ${
          response.statusText
        } - ${errorText}`
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
export async function createWiseTransfer(
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

    const response = await fetch(`${apiUrl}/v1/transfers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    console.log(response, "response from wise transfer");

    // Mock response for development/testing
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

    // Uncomment below to use the actual API response
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

export async function fetchAccountDetails(): Promise<any> {
  try {
    const WISE_PROFILE_ID = config.wise.profileId;
    const response = await fetch(
      `${apiUrl}/v1/profiles/${WISE_PROFILE_ID}/account-details`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Wise API Error (Account Details): ${response.status} ${response.statusText}`
      );
    }

    const accountDetailsData = await response.json();
    console.log(accountDetailsData, "account details data");
    return accountDetailsData;
  } catch (error) {
    console.error("Error fetching account details:", error);
    throw error;
  }
}

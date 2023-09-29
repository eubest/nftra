import * as Sentry from "@sentry/nextjs";
import {
  TransactionActionPayloadFragment,
  TransactionChargeRequestedSubscriptionDocument,
} from "@/saleor-app-checkout/graphql";
import { TransactionReversal } from "@/saleor-app-checkout/types/refunds";
import { Response } from "retes/response";
import {
  getTransactionProcessedEvents,
  updateTransactionProcessedEvents,
} from "@/saleor-app-checkout/backend/payments";
import {
  isAdyenTransaction,
  isDummyTransaction,
  isMollieTransaction,
} from "@/saleor-app-checkout/backend/payments/utils";
import { handleMollieRefund } from "@/saleor-app-checkout/backend/payments/providers/mollie";
import { handleAdyenRefund } from "@/saleor-app-checkout/backend/payments/providers/adyen";
import { handleDummyRefund } from "@/saleor-app-checkout/backend/payments/providers/dummy/refunds";
import { NextWebhookApiHandler, SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app-checkout/config/saleorApp";

export const SALEOR_WEBHOOK_TRANSACTION_ENDPOINT = "api/webhooks/saleor/transaction-charge-requested";

export const config = {
  api: {
    bodyParser: false,
  },
};

const TransactionChargeRequestedWebhook = new SaleorSyncWebhook<TransactionActionPayloadFragment>({
  name: "Checkout app payment notifications",
  webhookPath: SALEOR_WEBHOOK_TRANSACTION_ENDPOINT,
  event: "TRANSACTION_CHARGE_REQUESTED",
  apl: saleorApp.apl,
  subscriptionQueryAst: TransactionChargeRequestedSubscriptionDocument,
});

const validateTransactionData = (transaction: TransactionActionPayloadFragment | null | undefined) => {
  return transaction?.type && transaction?.action?.amount;
};

// Explicitly type the headers to avoid using 'any'
type HeadersWithSignature = {
  "saleor-signature": string;
};

const handleWebhook: NextWebhookApiHandler<TransactionActionPayloadFragment> = async (
  req,
  res,
  context
) => {
  const {
    authData: { saleorApiUrl },
    payload: { transaction, action },
  } = context;

  console.log("Start processing Saleor transaction action", action, transaction);

  if (!validateTransactionData(transaction)) {
    console.warn("Received webhook call without transaction data", transaction?.type, action?.amount);
    return Response.BadRequest({ success: false, message: "Missing transaction data" });
  }

  const { "saleor-signature": payloadSignature } = req.headers as HeadersWithSignature;

  if (!payloadSignature) {
    console.warn("Missing Saleor signature");
    return Response.BadRequest({ success: false, message: "Missing signature" });
  }

  const processedEvents: string[] = await getTransactionProcessedEvents(saleorApiUrl, {
    id: transaction.id,
  });

  const eventProcessed = processedEvents.some((signature: string) => signature === payloadSignature);

  if (eventProcessed) {
    console.log("Event already processed");
    return Response.OK({ success: true, message: "Event already processed" });
  }

  const transactionReversal: TransactionReversal = {
    id: transaction.reference,
    amount: action.amount,
    currency: transaction.authorizedAmount.currency,
  };

  try {
    if (action.actionType === "REFUND") {
      if (isMollieTransaction(transaction)) {
        await handleMollieRefund({ saleorApiUrl, refund: transactionReversal, transaction });
      }
      if (isAdyenTransaction(transaction)) {
        await handleAdyenRefund({ saleorApiUrl, refund: transactionReversal, transaction });
      }
      if (isDummyTransaction(transaction)) {
        await handleDummyRefund({
          saleorApiUrl,
          refund: {
            ...transactionReversal,
            id: transaction.id,
          },
          transaction,
        });
      }
    }

    if (action.actionType === "VOID") {
      if (isMollieTransaction(transaction)) {
        // TODO: Handle Mollie void payment
      }
      if (isAdyenTransaction(transaction)) {
        // TODO: Handle Adyen void payment
      }
    }
  } catch (err) {
    console.error(err);
    Sentry.captureException(err);
    return res.status(500).json({
      success: false,
      message: "Error while processing event",
    });
  }

  await updateTransactionProcessedEvents(saleorApiUrl, {
    id: transaction.id,
    input: JSON.stringify([...processedEvents, payloadSignature]),
  });

  console.log("Refund processing complete");
  return res.status(200).json({ success: true });
};

export default TransactionChargeRequestedWebhook.createHandler(handleWebhook);

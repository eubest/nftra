import { appName } from "../../constants";
import { version } from "../../package.json";
import  TransactionChargeRequestedWebhook  from "@/saleor-app-checkout/pages/api/webhooks/saleor/transaction-charge-requested";
import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";
import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { TransactionActionPayloadFragment } from "@/saleor-app-checkout/graphql"; // Ensure this import is present

const handler = createManifestHandler({
  async manifestFactory(context): Promise<AppManifest> {
    const { appBaseUrl } = context;

    return {
      id: "saleor.checkout.app",  
      version: version,
      name: appName,
      about: "Saleor checkout app to quickly configure and customize checkout in your store.",
      permissions: ["HANDLE_PAYMENTS", "HANDLE_CHECKOUTS", "MANAGE_ORDERS", "MANAGE_CHECKOUTS"],
      appUrl: appBaseUrl,
      dataPrivacyUrl: `${appBaseUrl}/data-privacy`,
      supportUrl: `${appBaseUrl}/support`,
      tokenTargetUrl: `${appBaseUrl}/api/register`,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
       webhooks: [((TransactionChargeRequestedWebhook as unknown) as SaleorSyncWebhook<TransactionActionPayloadFragment>).getWebhookManifest(appBaseUrl)],
    };
  },
});

export default handler;

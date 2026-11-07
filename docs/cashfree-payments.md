# Cashfree payments

The course checkout uses Cashfree Hosted Checkout. The backend creates orders using the current Cashfree Payments API and calculates the amount from the course record. It grants course access only after the Cashfree order status is confirmed as `PAID` by the backend.

## Backend configuration

Set these variables in the backend environment. Keep the client secret private and do not add it to the frontend environment.

```env
CASHFREE_ENV=sandbox
CASHFREE_CLIENT_ID=your_cashfree_app_id
CASHFREE_CLIENT_SECRET=your_cashfree_secret_key
CASHFREE_API_VERSION=2025-01-01
ORIGIN=http://localhost:3000
```

Use `CASHFREE_ENV=production` and the production App ID/Secret Key only after completing Cashfree's merchant onboarding and testing in sandbox. Set `ORIGIN` to the exact public frontend origin for production so Cashfree returns customers to `/payment/cashfree/return?order_id=...`. Do not include the backend API URL in `ORIGIN`.

Whitelist the frontend hostname in Cashfree. In the Cashfree dashboard, configure the webhook URL as:

```text
https://<backend-host>/api/v1/payment/cashfree/webhook
```

Enable the `PAYMENT_SUCCESS_WEBHOOK` event. The backend verifies the webhook signature against the original request bytes and independently checks the order status with Cashfree before fulfilling the purchase. The authenticated browser return also checks the Cashfree order status, so checkout does not rely on frontend claims.

## Sandbox checkout

1. Add sandbox App ID and Secret Key to the backend environment and set `CASHFREE_ENV=sandbox`.
2. Run the backend and frontend, sign in, open a paid course, enter a valid phone number, and click **Buy Now**.
3. Complete checkout using Cashfree's current sandbox payment details. Confirm that the backend reports the order as `PAID`, records one order, and grants access to the course.
4. Test a cancelled/failed checkout and confirm that no order is recorded and the course stays locked. Retry the pending checkout to confirm it does not create a duplicate Cashfree order.
5. Test the webhook using Cashfree's dashboard test facility or DevStudio, and check that invalid signatures are rejected and repeated valid success events do not duplicate fulfillment.

Before production, confirm the deployed backend's `ORIGIN`, Cashfree's domain whitelist, webhook URL, and production credentials. The frontend only receives a payment session ID; gateway credentials and order amounts remain on the server.

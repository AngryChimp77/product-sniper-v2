import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!stripeSecretKey) {
  throw new Error(
    "Missing STRIPE_SECRET_KEY environment variable for Stripe webhook."
  );
}

if (!stripeWebhookSecret) {
  throw new Error(
    "Missing STRIPE_WEBHOOK_SECRET environment variable for Stripe webhook."
  );
}

if (!supabaseUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL environment variable for Stripe webhook."
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "Missing SUPABASE_SERVICE_ROLE_KEY environment variable for Stripe webhook."
  );
}

const stripe = new Stripe(stripeSecretKey);

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    console.error("Stripe webhook error: Missing stripe-signature header");
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  let body: string;

  try {
    body = await req.text();
  } catch (error) {
    console.error("Stripe webhook error: Unable to read raw body", error);
    return NextResponse.json(
      { error: "Unable to read request body" },
      { status: 400 }
    );
  }

  try {
    console.log("Stripe webhook received");
    console.log("Signature header:", signature);
    console.log("Body length:", body.length);
    console.log("Webhook secret exists:", !!stripeWebhookSecret);

    event = stripe.webhooks.constructEvent(
      body,
      signature,
      stripeWebhookSecret!
    );
  } catch (error) {
    console.error(
      "Stripe webhook error: Signature verification failed",
      error
    );
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 400 }
    );
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;

      if (!userId) {
        console.error(
          "Stripe webhook error: checkout.session.completed missing metadata.userId"
        );
        return NextResponse.json(
          { error: "Missing userId in session metadata" },
          { status: 400 }
        );
      }

      console.log("Upgrading user to Pro:", userId);

      const { error: supabaseError } = await supabaseAdmin
        .from("users")
        .update({ is_pro: true })
        .eq("id", userId);

      if (supabaseError) {
        console.error(
          "Stripe webhook error: Failed to update user in Supabase",
          supabaseError
        );
        return NextResponse.json(
          { error: "Failed to update user status" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error: Unhandled exception", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


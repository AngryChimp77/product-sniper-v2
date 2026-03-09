import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable for Stripe webhook.");
}

if (!stripeWebhookSecret) {
  throw new Error("Missing STRIPE_WEBHOOK_SECRET environment variable for Stripe webhook.");
}

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable for Stripe webhook.");
}

if (!supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable for Stripe webhook.");
}

const stripe = new Stripe(stripeSecretKey);

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing Stripe signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  let rawBody: string;

  try {
    rawBody = await req.text();
  } catch (error) {
    console.error("Error reading raw request body:", error);
    return NextResponse.json(
      { error: "Unable to read request body" },
      { status: 400 }
    );
  }

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, stripeWebhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log("Webhook received checkout.session.completed");
console.log("Metadata:", session.metadata);
      
      const userId = session.metadata?.userId;

      if (!userId) {
        console.error("checkout.session.completed missing userId in metadata");
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
        console.error("Error updating user to pro in Supabase:", supabaseError);
        return NextResponse.json(
          { error: "Failed to update user status" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Unhandled error in Stripe webhook handler:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


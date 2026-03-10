import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL environment variable for billing portal route."
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "Missing SUPABASE_SERVICE_ROLE_KEY environment variable for billing portal route."
  );
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();

    if (typeof userId !== "string" || !userId.trim()) {
      console.error(
        "[create-billing-portal] Invalid or missing userId in request body",
        { userId }
      );
      return NextResponse.json(
        { error: "Invalid or missing userId" },
        { status: 400 }
      );
    }

    const normalizedUserId = userId.trim();
    console.log(
      "[create-billing-portal] Creating billing portal for user:",
      normalizedUserId
    );

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", normalizedUserId)
      .single();

    if (userError) {
      console.error(
        "[create-billing-portal] Error fetching user from Supabase",
        userError
      );
      return NextResponse.json(
        { error: "Failed to fetch user" },
        { status: 500 }
      );
    }

    if (!user?.stripe_customer_id) {
      console.error(
        "[create-billing-portal] User missing stripe_customer_id",
        { userId: normalizedUserId, user }
      );
      return NextResponse.json(
        { error: "User does not have a Stripe customer ID" },
        { status: 400 }
      );
    }

    console.log(
      "[create-billing-portal] Creating Stripe billing portal session for customer:",
      user.stripe_customer_id
    );

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: "http://localhost:3000/account",
    });

    console.log(
      "[create-billing-portal] Billing portal session created:",
      portalSession.id
    );

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("[create-billing-portal] Unexpected error", error);
    return NextResponse.json(
      { error: "Failed to create billing portal session" },
      { status: 500 }
    );
  }
}


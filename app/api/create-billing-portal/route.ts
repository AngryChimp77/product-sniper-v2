import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const {
      data: { user },
    } = await supabaseAdmin.auth.getUser();

    if (!user) {
      console.error(
        "[create-billing-portal] No authenticated user found in Supabase auth."
      );
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    console.log(
      "[create-billing-portal] Authenticated user from Supabase:",
      user.id
    );
    console.log(
      "[create-billing-portal] Looking up user in Supabase with id:",
      user.id
    );

    const { data: userRecord, error: userError } = await supabaseAdmin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    console.log("Supabase query result:", userRecord);
    console.log("Supabase query error:", userError);

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

    if (!userRecord?.stripe_customer_id) {
      console.error(
        "[create-billing-portal] User missing stripe_customer_id",
        { userId: user.id, user: userRecord }
      );
      return NextResponse.json(
        { error: "User does not have a Stripe customer ID" },
        { status: 400 }
      );
    }

    console.log(
      "[create-billing-portal] Creating Stripe billing portal session for customer:",
      userRecord.stripe_customer_id
    );

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: userRecord.stripe_customer_id,
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


import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = body.link as string;
    const userId = body.user_id as string | undefined;

    if (!url) {
      return NextResponse.json({ error: "No link provided" }, { status: 400 });
    }

    if (userId) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);

        const now = new Date();
        const startOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        const endOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1
        );

        const { count, error } = await supabase
          .from("analyses")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", startOfDay.toISOString())
          .lt("created_at", endOfDay.toISOString());

        if (!error && typeof count === "number" && count >= 5) {
          return NextResponse.json(
            { error: "Daily limit reached" },
            { status: 403 }
          );
        }
      }
    }

    let html = "";
    let isHtmlBlocked = false;

    try {
      const htmlRes = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      const text = await htmlRes.text();
      html = text || "";

      const trimmed = html.trim();
      const lower = trimmed.toLowerCase();
      const blockedIndicators = [
        "to discuss automated access",
        "automated access",
        "robot check",
        "captcha",
        "access denied",
        "are you a robot",
        "bot detection",
        "request blocked",
      ];

      isHtmlBlocked =
        !htmlRes.ok ||
        !trimmed ||
        blockedIndicators.some((phrase) => lower.includes(phrase));
    } catch (e) {
      console.log("HTML fetch failed:", e);
      html = "";
      isHtmlBlocked = true;
    }

    let title = "";
    let image_url = "";
    let price = "";
    let currency = "";
    let rating = "";
    let reviews = "";

    if (!isHtmlBlocked && html) {
      // TITLE
      const titleMatch =
        html.match(/<meta property="og:title" content="([^"]+)"/i) ||
        html.match(/<meta name="og:title" content="([^"]+)"/i) ||
        html.match(/<title>(.*?)<\/title>/i);

      title = titleMatch ? titleMatch[1].trim() : "";

      // IMAGE
      const imageMatch =
        html.match(/<meta property="og:image" content="([^"]+)"/i) ||
        html.match(/<meta name="twitter:image" content="([^"]+)"/i) ||
        html.match(/"image":"([^"]+)"/i) ||
        html.match(/"large":"([^"]+)"/i);

      image_url = imageMatch ? imageMatch[1] : "";

      // PRICE
      const priceMatch =
        html.match(
          /<meta property="product:price:amount" content="([^"]+)"/i
        ) ||
        html.match(/"price":"([^"]+)"/i) ||
        html.match(/"salePrice":"([^"]+)"/i) ||
        html.match(/\$([0-9]+\.?[0-9]*)/);

      price = priceMatch ? priceMatch[1] : "";

      // CURRENCY
      const currencyMatch =
        html.match(
          /<meta property="product:price:currency" content="([^"]+)"/i
        ) || html.match(/"currency":"([^"]+)"/i);

      currency = currencyMatch ? currencyMatch[1] : "";

      // RATING
      const ratingMatch = html.match(/"ratingValue":"([^"]+)"/i);

      rating = ratingMatch ? ratingMatch[1] : "";

      // REVIEWS COUNT
      const reviewsMatch = html.match(/"reviewCount":"([^"]+)"/i);

      reviews = reviewsMatch ? reviewsMatch[1] : "";
    }

    const domain = new URL(url).hostname;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `
Analyze this ecommerce product.

URL: ${url}

Title: ${title}

Price: ${price} ${currency}

Rating: ${rating}

Reviews: ${reviews}

Image URL: ${image_url}

Return ONLY valid JSON:

{
"score": number from 0 to 100,
"verdict": "WINNER" or "LOSER",
"reason": "short explanation"
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const result = completion.choices[0].message.content;
    const parsed = JSON.parse(result || "{}");

    const score = parsed.score;
    const verdict = parsed.verdict;
    const reason = parsed.reason;

    return NextResponse.json({
      score,
      verdict,
      reason,
      title,
      image_url,
      price,
      domain,
    });

  } catch (error) {

    console.error(error);

    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}
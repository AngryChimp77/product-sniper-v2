import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

async function normalizeUrl(url: string): Promise<string> {
  try {
    if (url.includes("aliexpress")) {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
        redirect: "follow",
      });

      const finalUrl = res.url;

      if (finalUrl.includes("/item/")) {
        return finalUrl;
      }

      const html = await res.text();

      const match = html.match(
        /https:\/\/www\.aliexpress\.com\/item\/\d+\.html/
      );

      if (match) {
        return match[0];
      }

      return url;
    }

    if (url.includes("amazon")) {
      const match = url.match(/\/dp\/[A-Z0-9]+\//);

      if (match) {
        return `https://www.amazon.com${match[0]}`;
      }
    }

    return url;
  } catch {
    return url;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let url = body.link as string;
    url = await normalizeUrl(url);
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
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        redirect: "follow",
      });

      html = await response.text();
    } catch (error) {
      console.log("FETCH FAILED:", error);
    }

    let title = "";
    let image_url = "";
    let price = "";
    let currency = "";
    let rating = "";
    let reviews = "";

    if (!isHtmlBlocked && html) {
      // Extract title
      const titlePatterns = [
        /<meta property="og:title" content="([^"]+)"/i,
        /<meta name="og:title" content="([^"]+)"/i,
        /<meta name="title" content="([^"]+)"/i,
        /<title>(.*?)<\/title>/i,
      ];

      for (const pattern of titlePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          title = match[1].trim();
          break;
        }
      }

      // Extract image
      const imagePatterns = [
        /<meta property="og:image" content="([^"]+)"/i,
        /<meta name="og:image" content="([^"]+)"/i,
        /<img[^>]+src="([^"]+)"[^>]*class="[^"]*(main|hero|product)[^"]*"/i,
      ];

      for (const pattern of imagePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          image_url = match[1];
          break;
        }
      }

      // Extract price
      const pricePatterns = [
        /<meta property="product:price:amount" content="([^"]+)"/i,
        /"price":"([^"]+)"/i,
      ];

      for (const pattern of pricePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          price = match[1];
          break;
        }
      }

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
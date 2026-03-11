import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IP_LIMITER, USER_LIMITER } from "@/lib/ratelimit";

const FREE_MONTHLY_LIMIT = 20;

async function normalizeUrl(url: string): Promise<string> {
  try {
    if (url.includes("aliexpress")) {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
      });

      const html = await res.text();

      const match =
        html.match(/"url":"(https:\/\/www\.aliexpress\.com\/item\/\d+\.html)"/) ||
        html.match(/https:\/\/www\.aliexpress\.com\/item\/\d+\.html/);

      if (match) {
        return match[1] || match[0];
      }

      return url;
    }

    if (url.includes("amazon")) {
      const match = url.match(/\/dp\/[A-Z0-9]+/);

      if (match) {
        return `https://www.amazon.com${match[0]}`;
      }
    }

    return url;
  } catch {
    return url;
  }
}

type AliExpressData = {
  title: string | null;
  image: string | null;
  price: string | null;
};

function extractAliExpressData(html: string): AliExpressData {
  const result: AliExpressData = {
    title: null,
    image: null,
    price: null,
  };

  try {
    const match = html.match(/window\.runParams\s*=\s*({[\s\S]*?});/);
    if (!match || !match[1]) {
      return result;
    }

    const json = JSON.parse(match[1]);
    const data = json?.data;

    const title = data?.titleModule?.subject;
    if (title && typeof title === "string") {
      result.title = title;
    }

    const imageList = data?.imageModule?.imagePathList;
    if (Array.isArray(imageList) && imageList.length > 0 && imageList[0]) {
      let img = String(imageList[0]);
      if (img.startsWith("//")) {
        img = `https:${img}`;
      }
      result.image = img;
    }

    const priceModule = data?.priceModule;
    const activityPrice = priceModule?.formatedActivityPrice;
    const basePrice = priceModule?.formatedPrice;

    if (activityPrice && typeof activityPrice === "string") {
      result.price = activityPrice;
    } else if (basePrice && typeof basePrice === "string") {
      result.price = basePrice;
    }
  } catch (err) {
    console.log("AliExtract error:", err);
  }

  return result;
}

function extractJSONLD(html: string) {
  const matches = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  );

  if (!matches) return {};

  for (const raw of matches) {
    try {
      const jsonText = raw
        .replace('<script type="application/ld+json">', "")
        .replace("</script>", "");

      const json = JSON.parse(jsonText);

      if ((json as any)["@type"] === "Product") {
        return {
          title: (json as any).name || null,
          image: Array.isArray((json as any).image)
            ? (json as any).image[0]
            : (json as any).image || null,
          price: (json as any).offers?.price || null,
        };
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }

  return {};
}

function extractAliExpressProductId(url: string): string | null {
  const match = url.match(/\/item\/(\d+)\.html/);
  return match ? match[1] : null;
}

function extractRunParams(html: string) {
  const match = html.match(/window\.runParams\s*=\s*({[\s\S]*?});/);

  if (!match) return {};

  try {
    const json = JSON.parse(match[1]);
    return {
      title: json?.data?.titleModule?.subject || null,
      image: json?.data?.imageModule?.imagePathList?.[0] || null,
      price:
        json?.data?.priceModule?.formatedActivityPrice ||
        json?.data?.priceModule?.formatedPrice ||
        null,
    };
  } catch {
    return {};
  }
}

function extractOGImage(html: string): string | null {
  const match = html.match(
    /<meta property="og:image" content="([^"]+)"/i
  );
  return match ? match[1] : null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const body = await req.json();
    let url = body.link as string;
    url = await normalizeUrl(url);
    const userId = body.user_id as string | undefined;

    const ip =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const { success: ipAllowed } = await IP_LIMITER.limit(ip);
    if (!ipAllowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
    }

    if (userId) {
      const { success: userAllowed } = await USER_LIMITER.limit(userId);
      if (!userAllowed) {
        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429 }
        );
      }
    }
    let monthlyUsed: number | null = null;

    if (!url) {
      return NextResponse.json({ error: "No link provided" }, { status: 400 });
    }

    if (userId) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey, {
          global: {
            headers: {
              Authorization: authHeader ?? "",
            },
          },
        });

        const [userRes, monthlyRes, dailyRes] = await Promise.all([
          supabase
            .from("users")
            .select("is_pro")
            .eq("id", userId)
            .single(),
          supabase.rpc("count_user_monthly_analyses", { uid: userId }),
          supabase.rpc("count_user_daily_analyses", { uid: userId }),
        ]);

        const user = userRes.data as { is_pro?: boolean } | null;
        const monthlyCount = monthlyRes.data as number | null;
        const monthlyError = monthlyRes.error;
        const dailyCount = dailyRes.data as number | null;
        const dailyError = dailyRes.error;

        console.log("MONTHLY COUNT RESULT:", monthlyCount);
        console.log("MONTHLY COUNT ERROR:", monthlyError);

        if (typeof monthlyCount === "number") {
          monthlyUsed = monthlyCount;
        }

        if (!user?.is_pro && typeof monthlyCount === "number" && monthlyCount >= FREE_MONTHLY_LIMIT) {
          return NextResponse.json({
            limitReached: true,
            monthlyUsed: monthlyCount,
            monthlyLimit: FREE_MONTHLY_LIMIT,
          });
        }

        console.log("DAILY LIMIT CHECK");
        console.log("USER ID:", userId);
        console.log("DAILY COUNT RESULT:", dailyCount);
        console.log("DAILY COUNT ERROR:", dailyError);

        if (!user?.is_pro && typeof dailyCount === "number" && dailyCount >= 5) {
          return NextResponse.json(
            { error: "Free plan limit reached" },
            { status: 403 }
          );
        }
      }
    }

    let title = "";
    let image_url: string | null = null;
    let price = "";
    let currency = "";
    let rating = "";
    let reviews = "";

    let html: string | null = null;

    // STEP 1 — Fast direct fetch with realistic headers
    try {
      const directResponse = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      html = await directResponse.text();
    } catch (err) {
      console.error("Direct fetch failed, will fallback to ScraperAPI:", err);
    }

    // STEP 2 — Extract product data from direct HTML
    let aliData = { title: null, image: null, price: null } as AliExpressData;
    let ld: any = {};
    let ogImage: string | null = null;

    if (html) {
      aliData = extractAliExpressData(html);
      ld = extractJSONLD(html);
      ogImage = extractOGImage(html);
    }

    title = aliData.title || (ld as any).title || "";
    image_url =
      aliData.image || (ld as any).image || ogImage || null;
    price = aliData.price || (ld as any).price || "";

    // STEP 3 — Detect failed extraction and fallback to ScraperAPI
    if (!html || !title || !image_url) {
      const scraperUrl = `http://api.scraperapi.com?api_key=${
        process.env.SCRAPERAPI_KEY
      }&url=${encodeURIComponent(url)}`;

      console.log("ScraperAPI structured URL (fallback):", scraperUrl);

      const scraperResponse = await fetch(scraperUrl);
      html = await scraperResponse.text();

      aliData = extractAliExpressData(html);
      ld = extractJSONLD(html);
      ogImage = extractOGImage(html);

      // STEP 5 — Final data merge with priority order
      title = aliData.title || (ld as any).title || "AliExpress Product";
      image_url =
        aliData.image || (ld as any).image || ogImage || null;
      price = aliData.price || (ld as any).price || "";
    } else {
      // Ensure title has a sensible default even when ScraperAPI wasn't needed
      if (!title) {
        title = "AliExpress Product";
      }
    }

    // Normalise protocol-less images
    if (image_url && image_url.startsWith("//")) {
      image_url = "https:" + image_url;
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
      limitReached: false,
      monthlyUsed: monthlyUsed,
      monthlyLimit: FREE_MONTHLY_LIMIT,
    });

  } catch (error) {
    console.error("ANALYZE API ERROR:", error);
    return Response.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
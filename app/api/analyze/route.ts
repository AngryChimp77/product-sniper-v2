import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IP_LIMITER, USER_LIMITER } from "@/lib/ratelimit";

export const maxDuration = 60;

const FREE_MONTHLY_LIMIT = 20;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function normalizeUrl(url: string): Promise<string> {
  try {
    if (url.includes("aliexpress")) {
      // Extract productId directly from URL — no fetch needed
      // Normalise any subdomain (fr., de., m., etc.) to www.aliexpress.com
      const idMatch = url.match(/\/item\/(\d+)/);
      if (idMatch) {
        return `https://www.aliexpress.com/item/${idMatch[1]}.html`;
      }
      // No productId found — at least canonicalise the subdomain
      return url.replace(/https?:\/\/[a-z0-9-]+\.aliexpress\.com/i, "https://www.aliexpress.com");
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
  rating: string | null;
  reviews: string | null;
  orders: string | null;
};

function extractAliExpressData(html: string): AliExpressData {
  const result: AliExpressData = {
    title: null,
    image: null,
    price: null,
    rating: null,
    reviews: null,
    orders: null,
  };

  try {
    // 1) Try window.runParams
    const runParamsMatch = html.match(
      /window\.runParams\s*=\s*({[\s\S]*?});/
    );
    if (runParamsMatch && runParamsMatch[1]) {
      try {
        const json = JSON.parse(runParamsMatch[1]);
        const data = json?.data;

        const title = data?.titleModule?.subject;
        if (title && typeof title === "string") result.title = title;

        const imageList = data?.imageModule?.imagePathList;
        if (Array.isArray(imageList) && imageList.length > 0 && imageList[0]) {
          let img = String(imageList[0]);
          if (img.startsWith("//")) img = `https:${img}`;
          result.image = img;
        }

        const priceModule = data?.priceModule;
        const originalPrice =
          priceModule?.formatedOriginalPrice ||
          priceModule?.originalPrice ||
          priceModule?.formatedPrice;
        if (originalPrice && typeof originalPrice === "string") {
          result.price = originalPrice;
        }

        const feedbackModule = data?.feedbackModule;
        const avgStar = feedbackModule?.productAverageStar || feedbackModule?.evarageStar;
        if (avgStar != null) result.rating = String(avgStar);
        const totalReviews = feedbackModule?.totalValidNum;
        if (totalReviews != null) result.reviews = String(totalReviews);

        const tradeModule = data?.tradeModule;
        const tradeCount =
          tradeModule?.formatTradeCount ||
          tradeModule?.tradeCount ||
          data?.deliveryModule?.trade_count;
        if (tradeCount != null) result.orders = String(tradeCount);
      } catch (err) {
        console.log("[AliExtract] runParams parse error:", err);
      }
    }

    // 2) Try window.__INIT_DATA__
    if (!result.title || !result.image || !result.price || !result.orders) {
      const initMatch = html.match(
        /window\.__INIT_DATA__\s*=\s*({[\s\S]*?});/
      );
      if (initMatch && initMatch[1]) {
        try {
          const json = JSON.parse(initMatch[1]);
          const data = json?.data || json?.store || json;

          const title =
            data?.titleModule?.subject ||
            data?.productTitle ||
            data?.pageModule?.pageTitle;
          if (!result.title && title && typeof title === "string") result.title = title;

          const imageList =
            data?.imageModule?.imagePathList ||
            data?.imageModule?.imagePaths ||
            data?.images;
          if (!result.image && Array.isArray(imageList) && imageList.length > 0 && imageList[0]) {
            let img = String(imageList[0]);
            if (img.startsWith("//")) img = `https:${img}`;
            result.image = img;
          }

          const priceModule = data?.priceModule || data?.price;
          if (!result.price) {
            const originalPrice =
              priceModule?.formatedOriginalPrice ||
              priceModule?.originalPrice ||
              priceModule?.formatedPrice ||
              priceModule?.price ||
              priceModule?.salePrice;
            if (originalPrice && typeof originalPrice === "string") {
              result.price = originalPrice;
            }
          }

          if (!result.rating || !result.reviews) {
            const feedbackModule = data?.feedbackModule;
            const avgStar = feedbackModule?.productAverageStar || feedbackModule?.evarageStar;
            if (!result.rating && avgStar != null) result.rating = String(avgStar);
            const totalReviews = feedbackModule?.totalValidNum;
            if (!result.reviews && totalReviews != null) result.reviews = String(totalReviews);
          }

          if (!result.orders) {
            const tradeModule = data?.tradeModule;
            const tradeCount =
              tradeModule?.formatTradeCount ||
              tradeModule?.tradeCount ||
              data?.deliveryModule?.trade_count;
            if (tradeCount != null) result.orders = String(tradeCount);
          }
        } catch (err) {
          console.log("[AliExtract] __INIT_DATA__ parse error:", err);
        }
      }
    }

    // 3) JSON-LD fallback
    if (!result.title || !result.image || !result.price || !result.rating || !result.reviews || !result.orders) {
      try {
        const ld = extractJSONLD(html) as any;
        if (!result.title && ld?.title) result.title = ld.title;
        if (!result.image && ld?.image) {
          let img = String(ld.image);
          if (img.startsWith("//")) img = `https:${img}`;
          result.image = img;
        }
        if (!result.price && ld?.price) result.price = String(ld.price);
        if (!result.rating && ld?.rating) result.rating = String(ld.rating);
        if (!result.reviews && ld?.reviews) result.reviews = String(ld.reviews);
      } catch (err) {
        console.log("[AliExtract] JSON-LD fallback error:", err);
      }
    }
    // 4) Regex fallbacks
    if (!result.orders) {
      const orderPatterns = [
        /"formatTradeCount":"([^"]+)"/,
        /"tradeCount":(\d+)/,
        /"trade_count":"?(\d+)"?/,
        /(\d[\d,]*)\+?\s*sold/i,
        /(\d[\d,]*)\s*orders?/i,
      ];
      for (const pattern of orderPatterns) {
        const m = html.match(pattern);
        if (m) { result.orders = m[1]; break; }
      }
    }

    if (!result.reviews) {
      const m =
        html.match(/"totalValidNum":(\d+)/) ||
        html.match(/(\d[\d,]+)\s*reviews?/i);
      if (m) result.reviews = m[1];
    }

    if (!result.price) {
      const m =
        html.match(/"formatedOriginalPrice":"([^"]+)"/) ||
        html.match(/"originalPrice":"([^"]+)"/);
      if (m) result.price = m[1];
    }
  } catch (err) {
    console.log("[AliExtract] error:", err);
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
        const aggRating = (json as any).aggregateRating;
        return {
          title: (json as any).name || null,
          image: Array.isArray((json as any).image)
            ? (json as any).image[0]
            : (json as any).image || null,
          price: (json as any).offers?.price || null,
          rating: aggRating?.ratingValue != null ? String(aggRating.ratingValue) : null,
          reviews: aggRating?.reviewCount != null ? String(aggRating.reviewCount) : null,
        };
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return {};
}

function extractAliExpressProductId(url: string): string | null {
  const match = url.match(/\/item\/(\d+)\.html/);
  return match ? match[1] : null;
}

function extractOGImage(html: string): string | null {
  const match = html.match(/<meta property="og:image" content="([^"]+)"/i);
  return match ? match[1] : null;
}

function extractMetaTitle(html: string): string | null {
  const og = html.match(/<meta property="og:title" content="([^"]+)"/i);
  if (og) return og[1];
  const meta = html.match(/<meta name="title" content="([^"]+)"/i);
  if (meta) return meta[1];
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) return title[1].trim();
  return null;
}

function extractAliExpressImage(html: string): string | null {
  // 1. <img id="magnifier-image"> — rendered product viewer
  const magnifier =
    html.match(/<img[^>]+id="magnifier-image"[^>]+(?:src|data-src)="([^"]+)"/i) ||
    html.match(/<img[^>]+(?:src|data-src)="([^"]+)"[^>]+id="magnifier-image"/i);
  if (magnifier) {
    const img = magnifier[1].startsWith("//") ? `https:${magnifier[1]}` : magnifier[1];
    console.log("[AliExpress] Image found via magnifier-image:", img);
    return img;
  }

  // 2. data-src on AliExpress CDN images
  const dataSrcMatch = html.match(
    /<img[^>]+data-src="(https?:\/\/[^"]*alicdn\.com[^"]+)"/i
  );
  if (dataSrcMatch) {
    console.log("[AliExpress] Image found via data-src alicdn:", dataSrcMatch[1]);
    return dataSrcMatch[1];
  }

  // 3. og:image
  const og = extractOGImage(html);
  if (og) {
    console.log("[AliExpress] Image found via og:image:", og);
    return og;
  }

  console.log("[AliExpress] No image found in HTML");
  return null;
}

function extractRatingAndReviews(html: string): { rating: string | null; reviews: string | null } {
  let rating: string | null = null;
  let reviews: string | null = null;

  const amazonRating = html.match(/(\d+(?:\.\d+)?)\s+out\s+of\s+5\s+stars/i);
  if (amazonRating) rating = amazonRating[1];

  const amazonReviews = html.match(/([\d,]+)\s+(?:global\s+)?ratings?/i);
  if (amazonReviews) reviews = amazonReviews[1].replace(/,/g, "");

  if (!rating) {
    const ratingProp =
      html.match(/itemprop="ratingValue"[^>]*content="([^"]+)"/i) ||
      html.match(/itemprop="ratingValue"[^>]*>([^<]+)</i);
    if (ratingProp) rating = ratingProp[1].trim();
  }

  if (!reviews) {
    const reviewProp =
      html.match(/itemprop="reviewCount"[^>]*content="([^"]+)"/i) ||
      html.match(/itemprop="reviewCount"[^>]*>([^<]+)</i);
    if (reviewProp) reviews = reviewProp[1].trim();
  }

  return { rating, reviews };
}

function buildPrompt(p: {
  url: string;
  title: string;
  price: string;
  currency: string;
  rating: string;
  reviews: string;
  orders: string;
  image_url: string | null;
}): string {
  return `You are an expert dropshipping product analyst.

Product data:
URL: ${p.url}
Title: ${p.title}
Price: ${p.price}${p.currency ? ` ${p.currency}` : ""}
Rating: ${p.rating || "unknown"}
Reviews: ${p.reviews || "unknown"}
Orders sold: ${p.orders || "unknown"}
Image URL: ${p.image_url || "none"}

Score this product from 0–100 using exactly these 6 weighted factors:

1. Wow / impulse factor (25%) — Does it stop the scroll? Unique mechanism, solves a real pain, category-specific appeal. Score 1–10.
2. Niche specificity / saturation (20%) — Specific niche language = low competition = high score. Generic product for everyone = low score. Score 1–10.
3. Price / margin potential (20%) — Score relative to category price norms, not absolute cost. If price unknown, estimate from title and category. Score 1–10.
4. Demand & sales velocity (15%) — Based on orders sold and review count. Tiers: under 50 = neutral (5), 50–500 = early traction (6), 500–5000 = sweet spot (8–9), 5000–50000 = popular but saturating (6–7), 50000+ = mass market saturated (3–4). Modify with rating: 4.8+ adds 1 point, below 4.0 subtracts 1–2 points. Score 1–10.
5. Visual / perceived value (10%) — Does it look premium relative to its price? Premium materials, professional appearance. Score 1–10.
6. Trend signal (10%) — Category momentum and platform-friendly format (TikTok/Reels-ready). Score 1–10.

Scoring rules:
- Be strict. Most products should score between 25–60. Below 45 is common and correct for average products.
- Only truly exceptional products score above 80.
- Missing data (no price, no orders) should push the score down, not stay neutral.

Verdict rules:
- 0–44: "KILL"
- 45–69: "TEST"
- 70–100: "SCALE"

Reason: 2–3 sentences, specific to this product, mention actual product details, actionable. For KILL explain what is weak. For TEST explain what to validate. For SCALE explain what makes it strong.

Also generate exactly 3 ad angles. Each angle has:
- hook: a specific scroll-stopping ad hook for this product (not generic)
- target: specific audience targeting recommendation (platform, age, interest)

Return ONLY valid JSON:
{
  "score": number,
  "verdict": "KILL" or "TEST" or "SCALE",
  "reason": "string",
  "ad_angles": [
    { "hook": "string", "target": "string" },
    { "hook": "string", "target": "string" },
    { "hook": "string", "target": "string" }
  ]
}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("STEP 1: request received");

    const userId = body.user_id as string | undefined;
    const urlInput = body.link as string | undefined;

    if (!urlInput) {
      return NextResponse.json({ error: "Missing product URL" }, { status: 400 });
    }

    let url = await normalizeUrl(urlInput);
    console.log("STEP 2: url:", url);
    console.log("STEP 3: userId:", userId);

    const domain = new URL(url).hostname;
    console.log("STEP 4: domain:", domain);

    const ip =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const { success: ipAllowed } = await IP_LIMITER.limit(ip);
    if (!ipAllowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    if (userId) {
      const { success: userAllowed } = await USER_LIMITER.limit(userId);
      if (!userAllowed) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
    }

    let monthlyUsed: number | null = null;

    if (userId) {
      const [userRes, monthlyRes] = await Promise.all([
        supabaseAdmin.from("users").select("is_pro").eq("id", userId).single(),
        supabaseAdmin.rpc("count_user_monthly_analyses", { uid: userId }),
      ]);

      const user = userRes.data as { is_pro?: boolean } | null;
      const monthlyCount = monthlyRes.data as number | null;

      console.log("MONTHLY COUNT RESULT:", monthlyCount);
      console.log("MONTHLY COUNT ERROR:", monthlyRes.error);
      console.log("USER RESULT:", user);

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 401 });
      }

      const isPro = user.is_pro === true;

      if (typeof monthlyCount === "number") {
        monthlyUsed = monthlyCount;
      }

      if (!isPro && typeof monthlyCount === "number" && monthlyCount >= FREE_MONTHLY_LIMIT) {
        return NextResponse.json({ error: "Free plan limit reached" }, { status: 403 });
      }
    }

    const scraperUrl = `http://api.scraperapi.com?api_key=${
      process.env.SCRAPERAPI_KEY
    }&url=${encodeURIComponent(url)}`;
    const scraperRenderUrl = `http://api.scraperapi.com?api_key=${
      process.env.SCRAPERAPI_KEY
    }&url=${encodeURIComponent(url)}&render=true`;

    const isAliExpress = domain.includes("aliexpress");

    let title = "";
    let image_url: string | null = null;
    let price = "";
    const currency = "";
    let rating = "";
    let reviews = "";
    let orders = "";
    let score: number | null = null;
    let verdict: string | null = null;
    let reason: string | null = null;
    let ad_angles: { hook: string; target: string }[] | null = null;

    // ── AliExpress: fully synchronous scrape + AI ──────────────────────────
    if (isAliExpress) {
      const productId = extractAliExpressProductId(url);
      console.log("[AliExpress] productId:", productId);

      // Primary: direct fetch with full browser headers
      const directUrl = productId
        ? `https://www.aliexpress.com/item/${productId}.html`
        : url;
      console.log("[AliExpress] Fetching direct URL:", directUrl);
      try {
        const directRes = await fetch(directUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
          },
        });
        console.log("[AliExpress] Direct fetch status:", directRes.status);
        const directHtml = (await directRes.text()).slice(0, 200000);
        console.log("[AliExpress] Direct fetch HTML length:", directHtml.length);
        console.log("[AliExpress] HTML snippet (first 500 chars):", directHtml.slice(0, 500));

        const aliData = extractAliExpressData(directHtml);
        console.log("[AliExpress] runParams/__INIT_DATA__ extraction:", {
          title: aliData.title,
          image: aliData.image,
          price: aliData.price,
          rating: aliData.rating,
          reviews: aliData.reviews,
          orders: aliData.orders,
        });

        const ld = extractJSONLD(directHtml) as any;
        const aliImage = extractAliExpressImage(directHtml);
        const scraped = extractRatingAndReviews(directHtml);

        title = aliData.title || ld.title || extractMetaTitle(directHtml) || "";
        image_url = aliData.image || aliImage || ld.image || null;
        price = aliData.price || ld.price || "";
        rating = aliData.rating || ld.rating || scraped.rating || "";
        reviews = aliData.reviews || ld.reviews || scraped.reviews || "";
        orders = aliData.orders || "";

        if (image_url && image_url.startsWith("//")) image_url = `https:${image_url}`;

        console.log("[AliExpress] After direct fetch:", { title, image_url, price, rating, reviews, orders });
      } catch (err) {
        console.error("[AliExpress] Direct fetch failed:", err);
      }

      // Fallback: ScraperAPI without render (if direct fetch got no title)
      if (!title) {
        console.log("[AliExpress] Direct fetch got no title — falling back to ScraperAPI");
        try {
          const scraperRes = await fetch(scraperUrl);
          console.log("[AliExpress] ScraperAPI fallback status:", scraperRes.status);
          const scraperHtml = (await scraperRes.text()).slice(0, 200000);
          console.log("[AliExpress] ScraperAPI fallback HTML length:", scraperHtml.length);
          console.log("[AliExpress] ScraperAPI fallback snippet:", scraperHtml.slice(0, 500));

          const aliData = extractAliExpressData(scraperHtml);
          const ld = extractJSONLD(scraperHtml) as any;
          const aliImage = extractAliExpressImage(scraperHtml);
          const scraped = extractRatingAndReviews(scraperHtml);

          if (!title) title = aliData.title || ld.title || extractMetaTitle(scraperHtml) || "";
          if (!image_url) image_url = aliData.image || aliImage || ld.image || null;
          if (!price) price = aliData.price || ld.price || "";
          if (!rating) rating = aliData.rating || ld.rating || scraped.rating || "";
          if (!reviews) reviews = aliData.reviews || ld.reviews || scraped.reviews || "";
          if (!orders) orders = aliData.orders || "";

          if (image_url && image_url.startsWith("//")) image_url = `https:${image_url}`;

          console.log("[AliExpress] After ScraperAPI fallback:", { title, image_url, price, rating, reviews, orders });
        } catch (err) {
          console.error("[AliExpress] ScraperAPI fallback failed:", err);
        }
      }

      if (!title) {
        console.error("[AliExpress] No title after all attempts — aborting for:", url);
        return NextResponse.json({ error: "Could not extract product data" }, { status: 422 });
      }

      // OpenAI — synchronous
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const prompt = buildPrompt({ url, title, price, currency, rating, reviews, orders, image_url });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        });
        console.log("OpenAI raw response:", completion);
        const parsed = JSON.parse(completion.choices[0].message.content || "{}");
        console.log("Parsed AI result:", parsed);
        score = parsed.score;
        verdict = parsed.verdict;
        reason = parsed.reason;
        ad_angles = Array.isArray(parsed.ad_angles) ? parsed.ad_angles : null;
      } catch (err) {
        console.error("[AliExpress] OpenAI failed:", err);
      }

      // Single insert with all fields
      const aliAnalysisId = crypto.randomUUID();
      if (userId) {
        const { error: insertError } = await supabaseAdmin.from("analyses").insert({
          id: aliAnalysisId,
          user_id: userId,
          url,
          title,
          image_url,
          price,
          orders_sold: orders || null,
          score,
          verdict,
          reason,
          ad_angles,
        });
        if (insertError) {
          console.error("ANALYZE API ERROR: Failed to insert AliExpress row", insertError);
        }
      }

      return NextResponse.json({
        analysisId: aliAnalysisId,
        title,
        image: image_url,
        price,
        orders_sold: orders || null,
        score,
        verdict,
        reason,
        ad_angles,
        domain,
        limitReached: false,
        monthlyUsed,
        monthlyLimit: FREE_MONTHLY_LIMIT,
      });
    }

    // ── Non-AliExpress: existing synchronous flow (unchanged) ──────────────
    try {
      console.log("[NonAliExpress] Attempting direct fetch");
      const directRes = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      const html = (await directRes.text()).slice(0, 200000);

      const aliData = extractAliExpressData(html);
      const ld = extractJSONLD(html) as any;
      const ogImage = extractOGImage(html);
      const scraped = extractRatingAndReviews(html);

      title = aliData.title || ld.title || extractMetaTitle(html) || "";
      image_url = aliData.image || ld.image || ogImage || null;
      price = aliData.price || ld.price || "";
      rating = aliData.rating || ld.rating || scraped.rating || "";
      reviews = aliData.reviews || ld.reviews || scraped.reviews || "";
      orders = aliData.orders || "";

      if (!title && !ogImage) {
        console.log("[NonAliExpress] Direct fetch empty, falling back to ScraperAPI");
        const scraperRes = await fetch(scraperUrl);
        const scraperHtml = (await scraperRes.text()).slice(0, 200000);

        const sAliData = extractAliExpressData(scraperHtml);
        const sLd = extractJSONLD(scraperHtml) as any;
        const sOgImage = extractOGImage(scraperHtml);
        const sScraped = extractRatingAndReviews(scraperHtml);

        title = sAliData.title || sLd.title || extractMetaTitle(scraperHtml) || "";
        image_url = sAliData.image || sLd.image || sOgImage || null;
        price = sAliData.price || sLd.price || "";
        rating = sAliData.rating || sLd.rating || sScraped.rating || "";
        reviews = sAliData.reviews || sLd.reviews || sScraped.reviews || "";
        orders = sAliData.orders || orders;
      }
    } catch (err) {
      console.error("[NonAliExpress] Fetch failed:", err);
    }

    if (!title) {
      console.error("[Analyze] Could not extract title for:", url);
      return NextResponse.json({ error: "Could not extract product data" }, { status: 422 });
    }

    if (image_url && image_url.startsWith("//")) {
      image_url = `https:${image_url}`;
    }

    const analysisId = crypto.randomUUID();

    if (userId) {
      const { error: insertError } = await supabaseAdmin.from("analyses").insert({
        id: analysisId,
        user_id: userId,
        url,
        title,
        image_url,
        price,
      });

      if (insertError) {
        console.error("ANALYZE API ERROR: Failed to insert row", insertError);
      } else {
        // Fire-and-forget AI for non-AliExpress
        (async () => {
          try {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const prompt = buildPrompt({ url, title, price, currency, rating, reviews, orders, image_url });
            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
            });
            console.log("OpenAI raw response:", completion);
            const parsed = JSON.parse(completion.choices[0].message.content || "{}");
            console.log("Parsed AI result:", parsed);

            const { error: updateError } = await supabaseAdmin
              .from("analyses")
              .update({
                score: parsed.score,
                verdict: parsed.verdict,
                reason: parsed.reason,
                ad_angles: Array.isArray(parsed.ad_angles) ? parsed.ad_angles : null,
                orders_sold: orders || null,
              })
              .eq("id", analysisId);

            if (updateError) {
              console.error("ANALYZE API ERROR: Failed to update analysis after AI", updateError);
            }
          } catch (aiError) {
            console.error("ANALYZE API ERROR: Background AI failed", aiError);
          }
        })();
      }
    }

    return NextResponse.json({
      analysisId,
      title,
      image: image_url,
      price,
      orders_sold: orders || null,
      score: null,
      verdict: null,
      reason: null,
      ad_angles: null,
      domain,
      limitReached: false,
      monthlyUsed,
      monthlyLimit: FREE_MONTHLY_LIMIT,
    });

  } catch (error) {
    console.error("ANALYZE ERROR:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

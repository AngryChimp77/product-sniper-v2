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
};

function extractAliExpressData(html: string): AliExpressData {
  const result: AliExpressData = {
    title: null,
    image: null,
    price: null,
    rating: null,
    reviews: null,
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
        const activityPrice = priceModule?.formatedActivityPrice;
        const basePrice = priceModule?.formatedPrice;
        if (activityPrice && typeof activityPrice === "string") {
          result.price = activityPrice;
        } else if (basePrice && typeof basePrice === "string") {
          result.price = basePrice;
        }

        const feedbackModule = data?.feedbackModule;
        const avgStar = feedbackModule?.productAverageStar || feedbackModule?.evarageStar;
        if (avgStar != null) result.rating = String(avgStar);
        const totalReviews = feedbackModule?.totalValidNum;
        if (totalReviews != null) result.reviews = String(totalReviews);
      } catch (err) {
        console.log("[AliExtract] runParams parse error:", err);
      }
    }

    // 2) Try window.__INIT_DATA__
    if (!result.title || !result.image || !result.price) {
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
          const activityPrice = priceModule?.formatedActivityPrice || priceModule?.promoPrice;
          const basePrice = priceModule?.formatedPrice || priceModule?.price || priceModule?.salePrice;
          if (!result.price) {
            if (activityPrice && typeof activityPrice === "string") {
              result.price = activityPrice;
            } else if (basePrice && typeof basePrice === "string") {
              result.price = basePrice;
            }
          }

          if (!result.rating || !result.reviews) {
            const feedbackModule = data?.feedbackModule;
            const avgStar = feedbackModule?.productAverageStar || feedbackModule?.evarageStar;
            if (!result.rating && avgStar != null) result.rating = String(avgStar);
            const totalReviews = feedbackModule?.totalValidNum;
            if (!result.reviews && totalReviews != null) result.reviews = String(totalReviews);
          }
        } catch (err) {
          console.log("[AliExtract] __INIT_DATA__ parse error:", err);
        }
      }
    }

    // 3) JSON-LD fallback
    if (!result.title || !result.image || !result.price || !result.rating || !result.reviews) {
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

    // Synchronous extraction — AliExpress skips this entirely (static HTML is useless)
    let title = "";
    let image_url: string | null = null;
    let price = "";
    const currency = "";
    let rating = "";
    let reviews = "";

    if (!isAliExpress) {
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

        // If still nothing, fall back to ScraperAPI without render
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
        }
      } catch (err) {
        console.error("[NonAliExpress] Fetch failed:", err);
      }

      if (!title) {
        console.error("[Analyze] Could not extract title for:", url);
        return NextResponse.json({ error: "Could not extract product data" }, { status: 422 });
      }
    }

    // Normalise protocol-less images
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
        // Fire-and-forget: slow scraping (AliExpress only) + AI
        (async () => {
          try {
            let finalTitle = title;
            let finalImage = image_url;
            let finalPrice = price;
            let finalRating = rating;
            let finalReviews = reviews;

            if (isAliExpress) {
              const productId = extractAliExpressProductId(url);
              console.log("[Background/AliExpress] productId:", productId);

              // Primary: ScraperAPI render=true
              console.log("[Background/AliExpress] Fetching ScraperAPI render=true");
              try {
                const renderRes = await fetch(scraperRenderUrl);
                console.log("[Background/AliExpress] render=true status:", renderRes.status);
                const renderedHtml = (await renderRes.text()).slice(0, 200000);
                console.log("[Background/AliExpress] render=true HTML length:", renderedHtml.length);
                console.log("[Background/AliExpress] HTML snippet (first 500 chars):", renderedHtml.slice(0, 500));

                const aliData = extractAliExpressData(renderedHtml);
                console.log("[Background/AliExpress] runParams/__INIT_DATA__ extraction:", {
                  title: aliData.title,
                  image: aliData.image,
                  price: aliData.price,
                  rating: aliData.rating,
                  reviews: aliData.reviews,
                });

                const ld = extractJSONLD(renderedHtml) as any;
                const aliImage = extractAliExpressImage(renderedHtml);
                const scraped = extractRatingAndReviews(renderedHtml);

                finalTitle = aliData.title || ld.title || extractMetaTitle(renderedHtml) || "";
                finalImage = aliData.image || aliImage || ld.image || null;
                finalPrice = aliData.price || ld.price || "";
                finalRating = aliData.rating || ld.rating || scraped.rating || "";
                finalReviews = aliData.reviews || ld.reviews || scraped.reviews || "";

                if (finalImage && (finalImage as string).startsWith("//")) {
                  finalImage = `https:${finalImage}`;
                }

                console.log("[Background/AliExpress] After render=true:", {
                  finalTitle, finalImage, finalPrice, finalRating, finalReviews,
                });
              } catch (err) {
                console.error("[Background/AliExpress] render=true failed:", err);
              }

              // Fallback: direct fetch with full browser headers
              if (!finalTitle || !finalImage) {
                const directUrl = productId
                  ? `https://www.aliexpress.com/item/${productId}.html`
                  : url;
                console.log("[Background/AliExpress] render=true incomplete — direct fetch fallback:", directUrl);
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
                  console.log("[Background/AliExpress] Direct fallback status:", directRes.status);
                  const directHtml = (await directRes.text()).slice(0, 200000);
                  console.log("[Background/AliExpress] Direct fallback HTML length:", directHtml.length);
                  console.log("[Background/AliExpress] Direct fallback snippet:", directHtml.slice(0, 500));

                  const directData = extractAliExpressData(directHtml);
                  const directImage = extractAliExpressImage(directHtml);
                  const directLd = extractJSONLD(directHtml) as any;

                  if (!finalTitle) finalTitle = directData.title || directLd.title || extractMetaTitle(directHtml) || "";
                  if (!finalImage) finalImage = directData.image || directImage || directLd.image || null;
                  if (!finalPrice) finalPrice = directData.price || directLd.price || "";
                  if (!finalRating) finalRating = directData.rating || directLd.rating || "";
                  if (!finalReviews) finalReviews = directData.reviews || directLd.reviews || "";

                  if (finalImage && (finalImage as string).startsWith("//")) {
                    finalImage = `https:${finalImage}`;
                  }

                  console.log("[Background/AliExpress] After direct fallback:", {
                    finalTitle, finalImage, finalPrice, finalRating, finalReviews,
                  });
                } catch (err) {
                  console.error("[Background/AliExpress] Direct fallback failed:", err);
                }
              }

              // Update row with scraped data regardless of whether AI runs
              const { error: updateDataErr } = await supabaseAdmin
                .from("analyses")
                .update({ title: finalTitle || null, image_url: finalImage, price: finalPrice })
                .eq("id", analysisId);
              if (updateDataErr) {
                console.error("[Background/AliExpress] Failed to update data fields:", updateDataErr);
              }

              if (!finalTitle) {
                console.error("[Background/AliExpress] No title after all attempts — skipping AI for:", url);
                return;
              }
            }

            // OpenAI analysis
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

            const prompt = `
Analyze this ecommerce product.

URL: ${url}

Title: ${finalTitle}

Price: ${finalPrice} ${currency}

Rating: ${finalRating}

Reviews: ${finalReviews}

Image URL: ${finalImage}

Return ONLY valid JSON:

{
"score": number from 0 to 100,
"verdict": "WINNER" or "LOSER",
"reason": "short explanation"
}
`;

            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
            });

            console.log("OpenAI raw response:", completion);

            const result = completion.choices[0].message.content;
            const parsed = JSON.parse(result || "{}");
            console.log("Parsed AI result:", parsed);

            const { score, verdict, reason } = parsed;
            console.log("Final result:", { score, verdict, reason, title: finalTitle, image_url: finalImage, price: finalPrice });

            const { error: updateError } = await supabaseAdmin
              .from("analyses")
              .update({ score, verdict, reason })
              .eq("id", analysisId);

            if (updateError) {
              console.error("ANALYZE API ERROR: Failed to update analysis after AI", updateError);
            }
          } catch (aiError) {
            console.error("ANALYZE API ERROR: Background task failed", aiError);
          }
        })();
      }
    }

    return NextResponse.json({
      analysisId,
      title,
      image: image_url,
      price,
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

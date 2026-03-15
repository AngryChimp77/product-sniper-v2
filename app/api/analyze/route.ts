import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { IP_LIMITER, USER_LIMITER } from "@/lib/ratelimit";

const FREE_MONTHLY_LIMIT = 20;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function normalizeUrl(url: string): Promise<string> {
  try {
    if (url.includes("aliexpress")) {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
      });

      const html = (await res.text()).slice(0, 200000);

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

        const feedbackModule = data?.feedbackModule;
        const avgStar =
          feedbackModule?.productAverageStar || feedbackModule?.evarageStar;
        if (avgStar != null) {
          result.rating = String(avgStar);
        }
        const totalReviews = feedbackModule?.totalValidNum;
        if (totalReviews != null) {
          result.reviews = String(totalReviews);
        }
      } catch (err) {
        console.log("AliExtract runParams parse error:", err);
      }
    }

    // 2) If still missing, try window.__INIT_DATA__
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
          if (!result.title && title && typeof title === "string") {
            result.title = title;
          }

          const imageList =
            data?.imageModule?.imagePathList ||
            data?.imageModule?.imagePaths ||
            data?.images;
          if (
            !result.image &&
            Array.isArray(imageList) &&
            imageList.length > 0 &&
            imageList[0]
          ) {
            let img = String(imageList[0]);
            if (img.startsWith("//")) {
              img = `https:${img}`;
            }
            result.image = img;
          }

          const priceModule = data?.priceModule || data?.price;
          const activityPrice =
            priceModule?.formatedActivityPrice || priceModule?.promoPrice;
          const basePrice =
            priceModule?.formatedPrice ||
            priceModule?.price ||
            priceModule?.salePrice;

          if (!result.price) {
            if (activityPrice && typeof activityPrice === "string") {
              result.price = activityPrice;
            } else if (basePrice && typeof basePrice === "string") {
              result.price = basePrice;
            }
          }

          if (!result.rating || !result.reviews) {
            const feedbackModule = data?.feedbackModule;
            const avgStar =
              feedbackModule?.productAverageStar || feedbackModule?.evarageStar;
            if (!result.rating && avgStar != null) {
              result.rating = String(avgStar);
            }
            const totalReviews = feedbackModule?.totalValidNum;
            if (!result.reviews && totalReviews != null) {
              result.reviews = String(totalReviews);
            }
          }
        } catch (err) {
          console.log("AliExtract __INIT_DATA__ parse error:", err);
        }
      }
    }

    // 3) Fallback to JSON-LD if we still don't have core fields
    if (!result.title || !result.image || !result.price || !result.rating || !result.reviews) {
      try {
        const ld = extractJSONLD(html) as any;

        if (!result.title && ld?.title) {
          result.title = ld.title;
        }

        if (!result.image && ld?.image) {
          let img = String(ld.image);
          if (img.startsWith("//")) {
            img = `https:${img}`;
          }
          result.image = img;
        }

        if (!result.price && ld?.price) {
          result.price = String(ld.price);
        }

        if (!result.rating && ld?.rating) {
          result.rating = String(ld.rating);
        }

        if (!result.reviews && ld?.reviews) {
          result.reviews = String(ld.reviews);
        }
      } catch (err) {
        console.log("AliExtract JSON-LD fallback error:", err);
      }
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

function extractRatingAndReviews(html: string): { rating: string | null; reviews: string | null } {
  let rating: string | null = null;
  let reviews: string | null = null;

  // Amazon: "4.5 out of 5 stars" and "1,234 ratings"
  const amazonRating = html.match(/(\d+(?:\.\d+)?)\s+out\s+of\s+5\s+stars/i);
  if (amazonRating) rating = amazonRating[1];

  const amazonReviews = html.match(/([\d,]+)\s+(?:global\s+)?ratings?/i);
  if (amazonReviews) reviews = amazonReviews[1].replace(/,/g, "");

  // Generic: itemprop="ratingValue" / itemprop="reviewCount"
  if (!rating) {
    const ratingProp = html.match(/itemprop="ratingValue"[^>]*content="([^"]+)"/i)
      || html.match(/itemprop="ratingValue"[^>]*>([^<]+)</i);
    if (ratingProp) rating = ratingProp[1].trim();
  }

  if (!reviews) {
    const reviewProp = html.match(/itemprop="reviewCount"[^>]*content="([^"]+)"/i)
      || html.match(/itemprop="reviewCount"[^>]*>([^<]+)</i);
    if (reviewProp) reviews = reviewProp[1].trim();
  }

  return { rating, reviews };
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const body = await req.json();

    console.log("STEP 1: request received");

    const userId = body.user_id as string | undefined;
    const urlInput = body.link as string | undefined;

    if (!urlInput) {
      return NextResponse.json(
        { error: "Missing product URL" },
        { status: 400 }
      );
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

    if (userId) {
      const [userRes, monthlyRes] = await Promise.all([
        supabaseAdmin
          .from("users")
          .select("is_pro")
          .eq("id", userId)
          .single(),
        supabaseAdmin.rpc("count_user_monthly_analyses", { uid: userId }),
      ]);

      const user = userRes.data as { is_pro?: boolean } | null;
      const monthlyCount = monthlyRes.data as number | null;
      const monthlyError = monthlyRes.error;

      console.log("MONTHLY COUNT RESULT:", monthlyCount);
      console.log("MONTHLY COUNT ERROR:", monthlyError);
      console.log("USER RESULT:", user);

      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 401 }
        );
      }

      const isPro = user.is_pro === true;

      if (typeof monthlyCount === "number") {
        monthlyUsed = monthlyCount;
      }

      if (!isPro) {
        if (
          typeof monthlyCount === "number" &&
          monthlyCount >= FREE_MONTHLY_LIMIT
        ) {
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
    let ratingFinal = "";
    let reviewsFinal = "";

    let html = "";

    const scraperUrl = `http://api.scraperapi.com?api_key=${
      process.env.SCRAPERAPI_KEY
    }&url=${encodeURIComponent(url)}`;

    // STEP 1 — Domain-aware fetch strategy
    if (domain.includes("aliexpress")) {
      // Fast AliExpress extraction without ScraperAPI when possible.
      const productId = extractAliExpressProductId(url);
      let aliData = { title: null, image: null, price: null } as AliExpressData;

      if (productId) {
        const aliUrl = `https://www.aliexpress.com/item/${productId}.html?ajax=true`;
        try {
          console.log("Fetching AliExpress AJAX product page:", aliUrl);
          const aliRes = await fetch(aliUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
          html = (await aliRes.text()).slice(0, 200000);

          aliData = extractAliExpressData(html);
        } catch (err) {
          console.error(
            "AliExpress AJAX fetch failed, will fallback to ScraperAPI:",
            err
          );
        }
      }

      // If AJAX extraction failed, fallback to ScraperAPI for AliExpress
      if (!aliData.title || !aliData.image) {
        console.log(
          "AliExpress AJAX extraction incomplete, falling back to ScraperAPI:",
          url
        );
        const scraperResponse = await fetch(scraperUrl);
        html = (await scraperResponse.text()).slice(0, 200000);
        aliData = extractAliExpressData(html);
      }

      title = aliData.title || title;
      image_url = aliData.image || image_url;
      price = aliData.price || price;
      rating = aliData.rating || rating;
      reviews = aliData.reviews || reviews;
    } else {
      // Attempt fast direct fetch first
      try {
        const directResponse = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        html = (await directResponse.text()).slice(0, 200000);
      } catch (err) {
        console.error(
          "Direct fetch failed, will fallback to ScraperAPI:",
          err
        );
      }

      // Run extraction on direct HTML
      let aliData = { title: null, image: null, price: null, rating: null, reviews: null } as AliExpressData;
      let ld: any = {};
      let ogImage: string | null = null;
      let scraped = { rating: null as string | null, reviews: null as string | null };

      if (html) {
        aliData = extractAliExpressData(html);
        ld = extractJSONLD(html);
        ogImage = extractOGImage(html);
        scraped = extractRatingAndReviews(html);
      }

      title = aliData.title || (ld as any).title || "";
      image_url =
        aliData.image || (ld as any).image || ogImage || null;
      price = aliData.price || (ld as any).price || "";
      rating = aliData.rating || (ld as any).rating || scraped.rating || "";
      reviews = aliData.reviews || (ld as any).reviews || scraped.reviews || "";

      // If everything is missing, assume we were blocked and fallback
      if (!aliData.title && !(ld as any).title && !ogImage) {
        console.log(
          "Direct fetch extraction failed, falling back to ScraperAPI:",
          url
        );
        const scraperResponse = await fetch(scraperUrl);
        html = (await scraperResponse.text()).slice(0, 200000);
      }
    }

    // STEP 2/4 — Unified extraction on final HTML (direct or ScraperAPI)
    let aliDataFinal = { title: null, image: null, price: null, rating: null, reviews: null } as AliExpressData;
    let ldFinal: any = {};
    let ogImageFinal: string | null = null;
    let scrapedFinal = { rating: null as string | null, reviews: null as string | null };

    if (html) {
      aliDataFinal = extractAliExpressData(html);
      ldFinal = extractJSONLD(html);
      ogImageFinal = extractOGImage(html);
      scrapedFinal = extractRatingAndReviews(html);
    }

    // STEP 5 — Final data merge with priority order
    title =
      aliDataFinal.title ||
      (ldFinal as any).title ||
      title ||
      "AliExpress Product";
    image_url =
      aliDataFinal.image ||
      (ldFinal as any).image ||
      ogImageFinal ||
      image_url ||
      null;
    price =
      aliDataFinal.price || (ldFinal as any).price || price || "";
    ratingFinal =
      aliDataFinal.rating || (ldFinal as any).rating || scrapedFinal.rating || rating || "";
    reviewsFinal =
      aliDataFinal.reviews || (ldFinal as any).reviews || scrapedFinal.reviews || reviews || "";

    // Normalise protocol-less images
    if (image_url && image_url.startsWith("//")) {
      image_url = "https:" + image_url;
    }

    // Generate an analysisId and store a row before kicking off AI
    const analysisId = crypto.randomUUID();

    if (userId) {
      const { error: insertError } = await supabaseAdmin
        .from("analyses")
        .insert({
          id: analysisId,
          user_id: userId,
          url,
          title,
          image_url,
          price,
        });

      if (insertError) {
        console.error(
          "ANALYZE API ERROR: Failed to insert processing analysis row",
          insertError
        );
      } else {
        // Fire-and-forget AI analysis to update this row in the background
        (async () => {
          try {
            const openai = new OpenAI({
              apiKey: process.env.OPENAI_API_KEY,
            });

            const prompt = `
Analyze this ecommerce product.

URL: ${url}

Title: ${title}

Price: ${price} ${currency}

Rating: ${ratingFinal}

Reviews: ${reviewsFinal}

Image URL: ${image_url}

Return ONLY valid JSON:

{
"score": number from 0 to 100,
"verdict": "WINNER" or "LOSER",
"reason": "short explanation"
}
`;

            const completion =
              await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
              });

            console.log("OpenAI raw response:", completion);

            const result = completion.choices[0].message.content;
            const parsed = JSON.parse(result || "{}");

            console.log("Parsed AI result:", parsed);

            const score = parsed.score;
            const verdict = parsed.verdict;
            const reason = parsed.reason;

            console.log("Final result:", {
              score,
              verdict,
              reason,
              title,
              image_url,
              price,
            });

            const { error: updateError } = await supabaseAdmin
              .from("analyses")
              .update({
                score,
                verdict,
                reason,
              })
              .eq("id", analysisId);

            if (updateError) {
              console.error(
                "ANALYZE API ERROR: Failed to update analysis row after AI",
                updateError
              );
            }
          } catch (aiError) {
            console.error(
              "ANALYZE API ERROR: Background AI analysis failed",
              aiError
            );
          }
        })();
      }
    }

    // Return a fast preview response while AI runs in the background
    return NextResponse.json({
      analysisId,
      title,
      image: image_url,
      price,
      domain,
      limitReached: false,
      monthlyUsed: monthlyUsed,
      monthlyLimit: FREE_MONTHLY_LIMIT,
    });

  } catch (error) {
    console.error("ANALYZE ERROR:", error);

    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}
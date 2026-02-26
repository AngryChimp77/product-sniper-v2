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

function extractAliExpressProductId(url: string): string | null {
  const match = url.match(/\/item\/(\d+)\.html/);
  return match ? match[1] : null;
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
    let title = "";
    let image_url = "";
    let price = "";
    let currency = "";
    let rating = "";
    let reviews = "";

    const normalizedUrl = url.replace("aliexpress.us", "aliexpress.com");
    const productId = extractAliExpressProductId(normalizedUrl);

    if (productId) {
      try {
        const apiUrl = `https://www.aliexpress.com/aeglodetailweb/api/product/detail.htm?productId=${productId}`;
        const apiResponse = await fetch(apiUrl);
        const apiJson = await apiResponse.json();
        const aliData = apiJson?.data;

        console.log("AliExpress API result:", aliData);

        const titleFromApi = aliData?.titleModule?.subject || null;
        const imageFromApi = aliData?.imageModule?.imagePathList?.[0] || null;
        const priceFromApi =
          aliData?.priceModule?.formatedActivityPrice ||
          aliData?.priceModule?.formatedPrice ||
          null;

        if (aliData) {
          title = titleFromApi || "Untitled product";
          if (imageFromApi != null) {
            const imgStr = String(imageFromApi);
            image_url = imgStr.startsWith("//") ? `https:${imgStr}` : imgStr;
          }
          price = priceFromApi ?? "";
          // Skip HTML fetch when API succeeds
        } else {
          const response = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          });
          html = await response.text();
        }
      } catch {
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          });
          html = await response.text();
        } catch (error) {
          console.log("FETCH FAILED:", error);
        }
      }
    } else {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        html = await response.text();
      } catch (error) {
        console.log("FETCH FAILED:", error);
      }
    }
    const aliData = url.includes("aliexpress")
      ? extractAliExpressData(html)
      : { title: null, image: null, price: null };

    console.log("AliExtract:", aliData);

    if (!isHtmlBlocked && html) {
      const titleMatch =
        html.match(/<meta property="og:title" content="([^"]+)"/i) ||
        html.match(/<meta name="twitter:title" content="([^"]+)"/i) ||
        html.match(/<title>(.*?)<\/title>/i);

      const fallbackTitle = titleMatch
        ? titleMatch[1].replace(" - AliExpress", "").trim()
        : "";

      title =
        aliData.title ||
        fallbackTitle ||
        "Untitled product";

      const imageMatch =
        html.match(/<meta property="og:image" content="([^"]+)"/i) ||
        html.match(/"imagePath":"([^"]+)"/i) ||
        html.match(/"imageUrl":"([^"]+)"/i);

      const fallbackImage = imageMatch
        ? imageMatch[1].replace(/\\u002F/g, "/")
        : "";

      image_url = aliData.image || fallbackImage;

      const priceMatch =
        html.match(
          /<meta property="product:price:amount" content="([^"]+)"/i
        ) || html.match(/"price":"([^"]+)"/i);

      const fallbackPrice = priceMatch ? priceMatch[1] : "";

      price = aliData.price || fallbackPrice;

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
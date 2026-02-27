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

    let title = "";
    let image_url: string | null = null;
    let price = "";
    let currency = "";
    let rating = "";
    let reviews = "";

    const scraperUrl = `http://api.scraperapi.com?api_key=${
      process.env.SCRAPERAPI_KEY
    }&render=true&url=${encodeURIComponent(url)}`;

    console.log("ScraperAPI structured URL:", scraperUrl);

    const scraperResponse = await fetch(scraperUrl);
    const html = await scraperResponse.text();

    const ld = extractJSONLD(html);

    title = (ld as any).title || "AliExpress Product";
    image_url = (ld as any).image || null;
    price = (ld as any).price || "";

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
    });

  } catch (error) {

    console.error(error);

    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}
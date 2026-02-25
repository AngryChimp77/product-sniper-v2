import OpenAI from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = body.link as string;

    if (!url) {
      return NextResponse.json({ error: "No link provided" }, { status: 400 });
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

    if (!isHtmlBlocked && html) {
      const titleJsonMatch = html.match(/"subject":"([^"]+)"/);
      const ogTitleMatch = html.match(
        /<meta property="og:title" content="([^"]+)"/i
      );
      const titleTagMatch = html.match(/<title>(.*?)<\/title>/i);
      const bestTitleMatch = titleJsonMatch || ogTitleMatch || titleTagMatch;

      if (bestTitleMatch) {
        title = bestTitleMatch[1];
      }

      const ogImageMatch = html.match(
        /<meta property="og:image" content="([^"]+)"/i
      );
      if (ogImageMatch) {
        image_url = ogImageMatch[1];
      }

      const priceJsonMatch = html.match(/"price":"([^"]+)"/);
      const metaPriceMatch = html.match(
        /<meta property="product:price:amount" content="([^"]+)"/i
      );
      const bestPriceMatch = priceJsonMatch || metaPriceMatch;

      if (bestPriceMatch) {
        price = bestPriceMatch[1];
      }
    }

    const domain = new URL(url).hostname;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const lines: string[] = [
      "Analyze this product.",
      "",
      `Product URL: ${url}`,
      `Domain: ${domain}`,
    ];

    if (title) {
      lines.push(`Product title: ${title}`);
    }
    if (price) {
      lines.push(`Product price: ${price}`);
    }
    if (image_url) {
      lines.push(`Image URL: ${image_url}`);
    }

    lines.push(
      "",
      "Return ONLY valid JSON:",
      "",
      "{",
      '  "score": number,',
      '  "verdict": "WINNER" or "LOSER",',
      '  "reason": "short explanation"',
      "}"
    );

    const prompt = lines.join("\n");

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
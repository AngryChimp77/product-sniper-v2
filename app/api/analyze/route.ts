import OpenAI from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = body.link as string;

    if (!url) {
      return NextResponse.json({ error: "No link provided" }, { status: 400 });
    }

    const htmlRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const html = await htmlRes.text();

    const titleMatch =
      html.match(/<meta property="og:title" content="([^"]+)"/) ||
      html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1] : "";

    const imageMatch =
      html.match(/<meta property="og:image" content="([^"]+)"/);
    const image_url = imageMatch ? imageMatch[1] : "";

    const priceMatch =
      html.match(/<meta property="product:price:amount" content="([^"]+)"/);
    const price = priceMatch ? priceMatch[1] : "";

    const domain = new URL(url).hostname;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `
Analyze this product page: ${url}

Return ONLY valid JSON:

{
  "score": number,
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
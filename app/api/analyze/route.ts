import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const link = body.link;

    if (!link) {
      return Response.json({ error: "No link provided" }, { status: 400 });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `
Analyze this product page: ${link}

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

    return Response.json(JSON.parse(result || "{}"));

  } catch (error) {

    console.error(error);

    return Response.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}
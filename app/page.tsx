"use client";

import { useState } from "react";

export default function Home() {

const [link, setLink] = useState("");
const [result, setResult] = useState<any>(null);

async function analyze() {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ link }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || "Failed to analyze product");
    }

    const data = await response.json();
    setResult(data);
  } catch (error) {
    console.error(error);
    setResult({
      score: 0,
      verdict: "ERROR",
      reason: "Could not analyze this link. Please try again.",
    });
  }
}

return (

<div style={{
display: "flex",
flexDirection: "column",
alignItems: "center",
justifyContent: "center",
height: "100vh",
background: "#020617",
color: "white"
}}>

<h1>🚀 Product Sniper v2</h1>

<input

value={link}

onChange={(e) => setLink(e.target.value)}

placeholder="Paste product link"

style={{padding: 10, width: 400, color: "black"}}

/>

<button onClick={analyze}>

Analyze

</button>

{result && (

<div>

<p>Score: {result.score}</p>

<p>Verdict: {result.verdict}</p>

<p>Reason: {result.reason}</p>

</div>

)}

</div>

);

}
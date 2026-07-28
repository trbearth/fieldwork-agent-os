const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Add OPENAI_API_KEY to .env.local, then restart the app." },
      { status: 503 }
    );
  }

  const offer = await request.text();
  if (!offer.startsWith("v=") || offer.length > 100_000) {
    return Response.json({ error: "Invalid WebRTC offer." }, { status: 400 });
  }

  const form = new FormData();
  form.set("sdp", new Blob([offer], { type: "application/sdp" }), "offer.sdp");
  form.set("session", new Blob([JSON.stringify({
    type: "realtime",
    model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-mini",
    output_modalities: ["audio"],
    instructions: [
      "You are Fieldwork Voice, the concise operating voice for a local agent workspace.",
      "Speak calmly, directly, and briefly. Sound like a sharp chief of staff, not a movie character.",
      "You can discuss the latest saved agent reports and summarize the evidence they contain.",
      "The included data is an example research pack. Never assume the user's business or industry beyond the saved reports.",
      "When asked for a brief, lead with what changed, explain what it means, and end with one decision for today.",
      "Never claim you ran an agent or changed external state. Explain that your context comes from the latest saved reports.",
      "If asked for evidence, direct the founder to the structured cited report in the Reports view."
    ].join(" "),
    audio: { output: { voice: process.env.OPENAI_VOICE ?? "marin" } },
  })], { type: "application/json" }), "session.json");

  const upstream = await fetch(OPENAI_REALTIME_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    console.error("Realtime session error", upstream.status, detail.slice(0, 500));
    return Response.json({ error: "The voice provider rejected the session. Check the key, model access, and billing." }, { status: upstream.status });
  }

  return new Response(await upstream.text(), {
    status: 201,
    headers: { "content-type": "application/sdp" },
  });
}

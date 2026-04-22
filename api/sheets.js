const OUTBOUND_URL = "https://finoveo-outbound.vercel.app";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      // Forward all query parameters to the outbound engine
      const params = new URLSearchParams(req.query).toString();
      const url = `${OUTBOUND_URL}/api/sheets${params ? `?${params}` : ""}`;
      const response = await fetch(url);
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    if (req.method === "POST") {
      const response = await fetch(`${OUTBOUND_URL}/api/sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

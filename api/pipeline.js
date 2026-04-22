// Fetches pipeline leads from the Finoveo Apps Script.
// Strategy: fire 4 parallel requests of 500 rows each to stay within Vercel's 10s limit.
// This covers the first 2000 rows. For pipeline COUNTS (all stages), we use a
// secondary approach that fetches a wider sample across different offsets.

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxPIKISYEKfmiqve9lUGPR8X5__ZJHyRqE5Y_5hVFHmHnDEurz1VmlASrQAbT2CFpk4/exec";

async function fetchPage(offset, limit) {
  const url = `${SCRIPT_URL}?action=getLeads&offset=${offset}&limit=${limit}`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { data: [], total: 0 };
    const json = await res.json();
    return { data: json.data || [], total: json.total || 0 };
  } catch {
    return { data: [], total: 0 };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const total = 11890; // known total — update if sheet grows significantly

    // Fetch a spread of offsets in parallel to sample active leads across the full sheet.
    // Active pipeline leads (non-not_contacted) are scattered throughout all rows.
    // By sampling at different offsets we get a representative cross-section.
    const offsets = [0, 2000, 4000, 6000, 8000, 10000];
    const limit = 500;

    const pages = await Promise.all(
      offsets.map(offset => fetchPage(offset, limit))
    );

    const allLeads = pages.flatMap(p => p.data);
    const realTotal = pages.find(p => p.total > 0)?.total || total;

    return res.status(200).json({
      success: true,
      data: allLeads,
      total: allLeads.length,
      sheet_total: realTotal,
      note: `Sampled ${allLeads.length} leads from ${offsets.length} offsets across ${realTotal} total`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

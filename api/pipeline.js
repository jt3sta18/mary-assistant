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

    // Fetch overlapping chunks spread evenly across the full sheet.
    // 14 offsets × 600 rows = 8,400 rows sampled ≈ 70% coverage.
    // All requests are parallel so total wall-clock time stays the same.
    const limit = 600;
    const offsets = [0, 850, 1700, 2550, 3400, 4250, 5100, 5950, 6800, 7650, 8500, 9350, 10200, 11000];

    const pages = await Promise.all(
      offsets.map(offset => fetchPage(offset, limit))
    );

    const seen = new Set();
    const allLeads = pages.flatMap(p => p.data).filter(l => {
      const key = l.id || l.email || `${l.first_name}${l.last_name}${l.company}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

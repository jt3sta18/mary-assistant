// Fetches ALL leads from the Finoveo Apps Script by firing all pages in parallel.
// vercel.json sets maxDuration: 60 so this won't be killed mid-flight.

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxPIKISYEKfmiqve9lUGPR8X5__ZJHyRqE5Y_5hVFHmHnDEurz1VmlASrQAbT2CFpk4/exec";
const PAGE_SIZE = 2000;
const MAX_LEADS = 14000; // slightly above current total so we always cover all rows

async function fetchPage(offset) {
  const url = `${SCRIPT_URL}?action=getLeads&offset=${offset}&limit=${PAGE_SIZE}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return { data: [], total: 0 };
  const json = await res.json();
  return { data: json.data || [], total: json.total || 0 };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Fire ALL possible pages in parallel immediately — don't wait for page 1 first.
    // We overshoot (MAX_LEADS) then trim empty pages after.
    const offsets = [];
    for (let offset = 0; offset < MAX_LEADS; offset += PAGE_SIZE) {
      offsets.push(offset);
    }

    const pages = await Promise.all(
      offsets.map(offset => fetchPage(offset).catch(() => ({ data: [], total: 0 })))
    );

    // Combine all results, stop at first empty page (means we've passed the end)
    let allLeads = [];
    let realTotal = 0;
    for (const page of pages) {
      if (page.total > 0) realTotal = page.total;
      if (page.data.length === 0) break;
      allLeads = allLeads.concat(page.data);
    }

    return res.status(200).json({
      success: true,
      data: allLeads,
      total: allLeads.length,
      sheet_total: realTotal,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

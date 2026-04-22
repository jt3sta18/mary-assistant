// Fetches ALL pipeline leads from the Finoveo Apps Script.
// Strategy: fetch page 0 to learn the real total, then pull all remaining
// pages in parallel. With PAGE=2000 and ~12k rows this is 6 parallel
// requests — well within Vercel's 10s limit and covers 100% of the sheet.

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxPIKISYEKfmiqve9lUGPR8X5__ZJHyRqE5Y_5hVFHmHnDEurz1VmlASrQAbT2CFpk4/exec";

const PAGE = 2000;

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
    // Step 1: fetch first page — this tells us the real total row count
    const first = await fetchPage(0, PAGE);
    const total = first.total || 0;
    let allLeads = first.data || [];

    // Step 2: if there are more rows, fetch all remaining pages in parallel
    if (total > PAGE) {
      const offsets = [];
      for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
      const pages = await Promise.all(offsets.map(o => fetchPage(o, PAGE)));
      for (const p of pages) allLeads = allLeads.concat(p.data || []);
    }

    return res.status(200).json({
      success: true,
      data: allLeads,
      total: allLeads.length,
      sheet_total: total,
      note: `Fetched ${allLeads.length} of ${total} total rows`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Server-side proxy that fetches ALL leads from the Finoveo Apps Script
// by paginating in parallel. No CORS, no OAuth required.
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxPIKISYEKfmiqve9lUGPR8X5__ZJHyRqE5Y_5hVFHmHnDEurz1VmlASrQAbT2CFpk4/exec";
const PAGE_SIZE = 2000;

async function fetchPage(offset, limit) {
  const url = `${SCRIPT_URL}?action=getLeads&offset=${offset}&limit=${limit}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Script error at offset ${offset}`);
  return await res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Step 1: Fetch first page to learn total count
    const first = await fetchPage(0, PAGE_SIZE);
    if (!first.success) return res.status(500).json({ error: first.error || "Script failed" });

    const total = first.total || 0;
    const firstData = first.data || [];

    if (total <= PAGE_SIZE) {
      // All data fits in one page
      return res.status(200).json({ success: true, data: firstData, total });
    }

    // Step 2: Fire all remaining pages in parallel
    const offsets = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
      offsets.push(offset);
    }

    const pages = await Promise.all(
      offsets.map(offset =>
        fetchPage(offset, PAGE_SIZE)
          .then(d => d.data || [])
          .catch(() => []) // silently skip failed pages
      )
    );

    const allLeads = [...firstData, ...pages.flat()];
    return res.status(200).json({ success: true, data: allLeads, total: allLeads.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

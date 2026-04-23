import { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

function MarkdownText({ text, style }) {
  if (!text) return null;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = escaped
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>')
    .replace(/^[-•]\s(.+)/gm, '<li style="margin:2px 0">$1</li>')
    .replace(/(<li.*<\/li>(\n)?)+/g, (m) => `<ul style="margin:6px 0;padding-left:18px">${m}</ul>`)
    .replace(/\n\n/g, '</p><p style="margin:8px 0 0">')
    .replace(/\n/g, "<br/>");
  return <div style={style} dangerouslySetInnerHTML={{ __html: `<p style="margin:0">${html}</p>` }} />;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets";

// ─── Finoveo Outbound Engine ───────────────────────────────────────────
const OUTBOUND_URL = "https://finoveo-outbound.vercel.app";
const OUTBOUND_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxPIKISYEKfmiqve9lUGPR8X5__ZJHyRqE5Y_5hVFHmHnDEurz1VmlASrQAbT2CFpk4/exec";
const PIPELINE_STAGES = { not_contacted:"Not Contacted", request_sent:"Request Sent", accepted_dm:"Accepted / DM Sent", following_up:"Following Up", replied_followup:"Replied / Follow Up", booked:"Booked", second_call:"2nd Call", not_interested:"Not Interested", closed:"Closed" };

const FINOVEO_KB = `
## About Finoveo (Your Company)
- **Company:** Finoveo, owned by PFScores Inc. Founder: James Testa (james@pfscores.com). Website: finoveo.com
- **What it is:** A white-label financial intelligence platform that turns a financial institution's existing customer base into a revenue engine. NOT a software vendor — delivers revenue intelligence.
- **Tagline:** "Turn Your Customer Data Into Clients & Revenue — In 90 Days."
- **Trademark:** Filed March 5, 2024 (USPTO Serial Number 98434750)

## Current Status
- Early-stage, live product. PFScores app is LIVE on Apple App Store and Google Play.
- Launch partner: Beverly Credit Union (North Shore, MA) — pilot in progress.
- Applied to CUNA Strategic Services / Envisant alliance. Contacted CEO Libby Calderone directly.
- Outbound sales via Instantly (email) and LinkedIn DMs targeting bank/credit union executives.
- Pricing: Low upfront + monthly platform fee + performance-based revenue share. Early Adopter Rate available.

## The Problem
Banks and credit unions only see transaction history — not customer intent. They're missing:
- Financial goals, savings behavior, borrowing intent
- Result: missed cross-sell, low product penetration, stagnant growth
- Cost of inaction: For 20,000 customers, 5% converting = 1,000 new products × $2K–$10K = **$2M–$10M missed revenue/year**

## The Three Pillars
1. **White-Label PFScores App** — Delivered under the institution's brand. Members see their bank, Finoveo powers it.
2. **Behavioral Data Capture** — 50+ financial data points (goals, intent, habits) that don't exist in any core banking system. Predictive, not historical.
3. **AI Query Engine** — Natural language queries to surface exactly who's ready for a mortgage, HELOC, or credit product right now.

## PFScores App (Core Product)
- 360° financial health score (0–1000) across 6 dimensions: Net Worth, Cash Management, Retirement Readiness, College Planning, Major Purchase Preparedness, Risk Protection.
- ~10 minutes to complete. Free for users. CFP Board-aligned.
- Does NOT give financial advice. Does NOT sell products to consumers.

## Sales Messaging
- Always lead with the REVENUE story, not features. Cost of inaction > cost of platform.
- CTA: "Let's identify $1M in untapped revenue in your customer base."
- 90-day deployment. Zero IT lift. 100x ROI potential. Data stays with institution.
- Finoveo is complementary to Sparrow (CUNA partner for Gen Z lending) — not competitive.
- Tailored pitch for Gen Z/youth acquisition when that's the prospect's pain point.

## Target Markets
- Banks & Credit Unions (primary), Advisory/Brokerage firms, Membership organizations.
- Purpose-built for credit unions — member-centric, cooperative values.

## Brand
- Colors: Navy (#071428), Teal (#00DBA8/#00F5C0), Blue (#1A6EE0/#38AAFF), Gold (#F5C518)
- Tone: Confident, direct, C-suite level, outcomes-first. Never feature-first.
- NOT a financial advisor, broker, or lender.
`;

function buildSystemPrompt() {
  const name = localStorage.getItem("mary-user-name") || "James";
  const memories = JSON.parse(localStorage.getItem("mary-memories") || "[]");
  const memorySection = memories.length
    ? `\n\n## Dynamic Memory (things ${name} has told you — treat as current facts)\n${memories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : "";
  return SYSTEM_PROMPT_BASE + FINOVEO_KB + memorySection + `\n\nThe user's name is ${name}. Address them by name occasionally — naturally, not every message.\nToday's date and time is ${new Date().toISOString()}.\nThe current timezone offset is ${new Date().getTimezoneOffset()} minutes from UTC.`;
}

const SYSTEM_PROMPT_BASE = `You are Mary, a sharp personal assistant built by Finoveo. You help James stay organized and are also a Finoveo expert — you know the product, the pitch, the sales narrative, and the business deeply. The Finoveo knowledge base is embedded below — use it whenever James asks about Finoveo, a pitch, a prospect, or competitive positioning.

Calendar events from Google Calendar will be provided directly in the conversation context when available. Use them to answer scheduling questions.

CAPABILITIES:
- CALENDAR: Analyze provided calendar events, spot conflicts, find free time, list upcoming meetings. You CAN create real calendar events — use "create_events" in your response and they will be added to Google Calendar automatically.
- TASKS: Create, complete, and manage the user's task list.
- REMINDERS: Set timed push notifications.
- EMAIL: You CAN send real emails AND search Gmail. When asked to send an email, compose it and include "send_email". When asked to search Gmail or find a past email (e.g. "last email from John", "find email about the meeting"), use "search_gmail" with a Gmail search query string — the app will search and return the results to you.
- MEMORY: When James tells you something important about himself, his business, a prospect, or a preference, include it in "save_memory" so you can remember it in future conversations.
- GOOGLE DRIVE & SHEETS: You can create new Google Sheets and write data to existing ones. When a file is attached (CSV or Drive sheet data), it will appear in the conversation context as a table. Use "create_sheet" to create a new spreadsheet, or "write_to_sheet" to append data to an existing one. Always confirm what was written and how many rows.
- FINOVEO PIPELINE (CRM): You have live access to the Finoveo outbound lead pipeline. When pipeline data is provided in the conversation context, use it to answer questions about leads, stages, and counts. You can update a lead's status or fields using "update_lead". You can trigger a full FDIC + AI research brief on any bank or credit union using "research_institution". You can find a lead's email using "find_email".

Pipeline stages (in order): not_contacted → request_sent → accepted_dm → following_up → replied_followup → booked → second_call → not_interested → closed
Lead fields: id, first_name, last_name, full_name, email, title, company, institution_type, state, asset_size, status, persona, linkedin_step, lead_score, next_followup (next LinkedIn follow-up date), notes (activity notes/history for the lead)

RULES:
- When calendar events are provided in the message, use them to answer scheduling questions accurately.
- When asked to remind them of something, create a reminder with a specific time.
- When asked to send an email, ALWAYS compose it and include the "send_email" field — never say you can't send emails.
- Be concise and actionable. No fluff.
- Format dates clearly (e.g., "Tuesday, April 28 at 2:00 PM").
- If you spot conflicts in their calendar, flag them immediately.
- When James shares new facts about Finoveo, a prospect, a deal, or his personal preferences, save them to memory.
- Always respond in JSON format with this exact structure:
{
  "message": "Your response text here",
  "tasks_to_add": [{"title": "task name", "due": "ISO date string or null", "priority": "high|medium|low"}],
  "tasks_to_complete": ["task title to mark done"],
  "calendar_events": [{"title": "event name", "start": "ISO datetime", "end": "ISO datetime", "location": "optional"}],
  "reminders": [{"title": "reminder text", "time": "ISO datetime string for when to fire the notification"}],
  "bible_verse": {"text": "The verse text", "reference": "Book Chapter:Verse"},
  "send_email": {"to": "recipient@email.com", "subject": "Email subject", "body": "Full email body text"},
  "search_gmail": {"query": "from:john subject:meeting", "max_results": 10},
  "create_events": [{"title": "event name", "start": "ISO datetime", "end": "ISO datetime", "location": "optional"}],
  "suggested_tasks": [{"title": "task name", "priority": "high|medium|low", "reason": "brief reason why"}],
  "save_memory": ["concise fact to remember, written as a statement"],
  "create_sheet": {"title": "Sheet name", "values": [["Col A", "Col B"], ["row1a", "row1b"]]},
  "write_to_sheet": {"spreadsheetId": "sheet_id_here", "range": "Sheet1", "values": [["row1a", "row1b"]]},
  "update_lead": {"search": "company or person name to find the lead", "updates": {"status": "booked", "notes": "optional note"}},
  "research_institution": {"name": "FMS Bank"},
  "find_email": {"first_name": "John", "last_name": "Smith", "company": "Citizens Bank", "domain": "citizensbank.com"},
  "add_lead": {"first_name": "Maria", "last_name": "Chen", "full_name": "Maria Chen", "title": "VP of Digital Banking", "company": "Rockland Trust", "institution_type": "Bank", "state": "MA", "linkedin_url": "", "asset_size": "", "email": "", "persona": "Digital"},
  "add_leads_bulk": true,
  "generate_linkedin": {"search": "company or person name of lead in pipeline"}
}

When pipeline data is in the context, use it to answer questions accurately — counts, specific leads, stage breakdowns.
When asked to update a lead's status (e.g. "move X to booked"), use update_lead with the company/person name as "search".
When asked to research a bank or credit union (e.g. "get me the intel on FMS Bank"), use research_institution — this calls FDIC + AI and returns a full pre-call brief.
When asked to find someone's email, use find_email.
When asked to add a single lead (e.g. "add John Smith, CEO at FMS Bank in PA"), use add_lead with all available fields. Infer institution_type (Bank or Credit Union) from context. Classify persona from title: CEO/President→CEO, CMO/Marketing→CMO, Digital/Tech/CTO→Digital, Retail/Branch/Lending→Retail, Strategy/BizDev→Strategy, Product→Product.
When a CSV file is attached and user asks to add/import the leads to the pipeline, set add_leads_bulk: true — the app will handle the column mapping and import automatically.
When asked to draft LinkedIn outreach for a specific lead (e.g. "draft LinkedIn messages for Sarah at Citizens Bank"), use generate_linkedin with the lead's name or company as "search".

When a file is attached to the conversation, it will appear as tabular data. Use that data to answer questions, extract insights, create tasks, or write it to a Google Sheet if asked.
When the user says "add these to my [sheet name]" or "create a sheet called [name]", use the attached file data as the values.
When creating or writing to a sheet, structure the values as a 2D array — first row should be headers if the data has them.

Only include fields that are relevant. "message" is always required. Others are optional.
When the user asks you to send an email, compose it and include a "send_email" field — the system sends it automatically via Gmail.
When the user asks to search Gmail, find an old email, or look up correspondence with someone, use "search_gmail" with a proper Gmail query string (e.g. "from:nilendu", "from:ellen subject:finoveo", "to:me newer_than:7d"). The system will execute the search and return the results. Use this any time the user references a past email or conversation thread.
When the user asks you to create or schedule a calendar event, include it in "create_events" — the system will add it to Google Calendar automatically. Always confirm what you scheduled in your message.
When emails are provided in the briefing, scan them for action items and include up to 3 proactive task suggestions in "suggested_tasks" — things the user probably needs to do based on the emails.
When the daily briefing is requested, ALWAYS include a "bible_verse" field with an inspiring verse for the day. Choose a different verse each day — draw from the full Catholic and Orthodox biblical canon, including the Deuterocanonical books (Sirach, Wisdom, Tobit, Judith, Baruch, 1 & 2 Maccabees). Vary across the Psalms, Proverbs, Gospels, Epistles, Old Testament prophets, and Deuterocanonical wisdom literature. Stay faithful to Catholic and Orthodox tradition. The user's faith is deeply important to them. IMPORTANT: Do NOT include the bible verse inside the "message" text — it is displayed in its own dedicated card. Keep the briefing message focused on schedule, tasks, and business context only.
When calendar events are provided, include the relevant ones in calendar_events in your response.
When the user asks you to remind them at a specific time, include a "reminders" entry with the exact ISO datetime.
If they say something vague like "remind me tomorrow morning", interpret that as 9:00 AM the next day.
If they say "remind me in 30 minutes", calculate the exact time from now.`;

async function callClaude(messages) {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: 1500, system: buildSystemPrompt(), messages };
  const res = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || data.error || "API error");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

async function sendGmailEmail(accessToken, { to, subject, body }) {
  const email = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset="UTF-8"`, ``, body].join("\n");
  const encoded = btoa(unescape(encodeURIComponent(email))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("gmail_send_error");
  return await res.json();
}

async function scheduleEmailReminders(accessToken, events) {
  const now = new Date();
  const todayStr = now.toDateString();
  const alreadySent = JSON.parse(localStorage.getItem("mary-email-reminders") || "{}");
  const sentToday = alreadySent[todayStr] || [];

  for (const ev of events) {
    if (!ev.start || ev.allDay) continue;
    const startMs = new Date(ev.start).getTime();
    const key = `${ev.title}-${ev.start}`;
    if (sentToday.includes(key)) continue;

    // Send email reminder 60 min before (if it's in the future and within 6 hours)
    const minsUntil = (startMs - Date.now()) / 60000;
    if (minsUntil > 55 && minsUntil < 360) {
      const startTime = new Date(ev.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      await sendGmailEmail(accessToken, {
        to: "me",
        subject: `⏰ Reminder: "${ev.title}" at ${startTime}`,
        body: `Hi James,\n\nThis is a reminder that you have "${ev.title}" starting at ${startTime}${ev.location ? `\n📍 ${ev.location}` : ""}.\n\nDon't miss it!\n\n— Mary`,
      }).catch(() => {});
      sentToday.push(key);
    }
  }

  alreadySent[todayStr] = sentToday;
  // Only keep today
  const cleaned = { [todayStr]: sentToday };
  localStorage.setItem("mary-email-reminders", JSON.stringify(cleaned));
}

async function fetchGoogleProfile(accessToken) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function replyToGmail(accessToken, { threadId, messageId, to, subject, body }) {
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const email = [`To: ${to}`, `Subject: ${replySubject}`, `In-Reply-To: ${messageId}`, `References: ${messageId}`, `Content-Type: text/plain; charset="UTF-8"`, ``, body].join("\n");
  const encoded = btoa(unescape(encodeURIComponent(email))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded, threadId }),
  });
  if (!res.ok) throw new Error("reply_error");
  return await res.json();
}

async function searchGmailEmails(accessToken, query, maxResults = 15) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("gmail_search_error");
  const data = await res.json();
  const messages = data.messages || [];
  if (!messages.length) return [];
  const details = await Promise.all(
    messages.slice(0, maxResults).map(async (m) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const d = await r.json();
      const hdrs = d.payload?.headers || [];
      const get = (name) => hdrs.find((h) => h.name === name)?.value || "";
      // Extract plain text body
      let body = "";
      const extractBody = (parts) => {
        if (!parts) return;
        for (const p of parts) {
          if (p.mimeType === "text/plain" && p.body?.data) {
            try { body = atob(p.body.data.replace(/-/g,"+").replace(/_/g,"/")); } catch {}
            return;
          }
          if (p.parts) extractBody(p.parts);
        }
      };
      if (d.payload?.body?.data) {
        try { body = atob(d.payload.body.data.replace(/-/g,"+").replace(/_/g,"/")); } catch {}
      } else { extractBody(d.payload?.parts); }
      return {
        id: m.id,
        threadId: d.threadId,
        messageId: get("Message-ID"),
        from: get("From"),
        to: get("To"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: d.snippet,
        body: body.slice(0, 2000), // cap body at 2000 chars
      };
    })
  );
  return details.filter(Boolean);
}

async function fetchGmailEmails(accessToken) {
  const params = new URLSearchParams({
    q: "is:unread is:inbox -category:promotions -category:updates -category:social newer_than:2d",
    maxResults: "10",
  });
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("gmail_error");
  const data = await res.json();
  const messages = data.messages || [];
  const details = await Promise.all(
    messages.slice(0, 8).map(async (m) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const d = await r.json();
      const headers = d.payload?.headers || [];
      const get = (name) => headers.find((h) => h.name === name)?.value || "";
      return { id: m.id, threadId: d.threadId, messageId: get("Message-ID"), from: get("From"), subject: get("Subject"), date: get("Date"), snippet: d.snippet };
    })
  );
  return details;
}

async function createCalendarEvent(accessToken, { title, start, end, location }) {
  const event = {
    summary: title,
    location: location || undefined,
    start: { dateTime: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("calendar_create_error");
  return await res.json();
}

async function fetchCalendarEvents(accessToken, daysAhead = 2) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + daysAhead);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("calendar_error");
  const data = await res.json();
  return (data.items || []).map((ev) => ({
    title: ev.summary || "(No title)",
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    location: ev.location || null,
    allDay: !ev.start?.dateTime,
  }));
}

function parseResponse(text) {
  try { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0].replace(/```json|```/g, "").trim()); } catch {}
  return { message: text };
}

// ─── Finoveo Outbound Engine API calls ───────────────────────────────
// Uses /api/pipeline which fetches the real total then pulls ALL pages
// in parallel — 100% sheet coverage, no CORS issues, no sampling gaps.

async function fetchOutboundLeads() {
  const normalize = l => ({ ...l, lead_score: parseInt(l.lead_score) || 0, linkedin_step: parseInt(l.linkedin_step) || 0 });
  const res = await fetch("/api/pipeline");
  if (!res.ok) throw new Error("Pipeline fetch failed");
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch leads");
  return (data.data || []).map(normalize);
}

async function updateOutboundLead(id, updates) {
  const res = await fetch(`/api/sheets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptUrl: OUTBOUND_SCRIPT_URL, action: "updateLead", id, updates }),
  });
  return await res.json();
}

async function researchInstitution(name) {
  // Call Mary's own proxy to avoid CORS (server-to-server to outbound engine)
  const res = await fetch(`/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("research_error");
  const data = await res.json();
  if (!data.success && !data.institution && !data.ai) throw new Error(data.error || "research_error");
  return data;
}

async function findLeadEmail(first_name, last_name, company, domain) {
  const res = await fetch(`/api/hunter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ first_name, last_name, company, domain }),
  });
  return await res.json();
}

function buildPipelineSummary(leads) {
  const counts = {};
  leads.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
  const lines = Object.entries(PIPELINE_STAGES).map(([k, v]) => `- ${v}: ${counts[k] || 0}`);
  return `Finoveo Pipeline — ${leads.length} total leads:\n${lines.join("\n")}`;
}

function findLeadBySearch(leads, query) {
  const q = query.toLowerCase();
  return leads.find(l => `${l.company} ${l.full_name} ${l.first_name} ${l.last_name}`.toLowerCase().includes(q));
}

async function addOutboundLead(lead) {
  const res = await fetch(`/api/sheets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptUrl: OUTBOUND_SCRIPT_URL, action: "addLead", lead }),
  });
  return await res.json();
}

// ─── Persona classifier (mirrors outbound engine logic) ───
function classifyPersona(title) {
  if (!title) return "Other";
  const t = title.toLowerCase();
  if (/\b(ceo|president|chairman|chief executive|managing director)\b/.test(t)) return "CEO";
  if (/\b(cmo|chief marketing|marketing officer|head of marketing|vp.*marketing|marketing director|chief growth)\b/.test(t)) return "CMO";
  if (/\b(digital|innovation|technology|cto|cio|online banking)\b/.test(t)) return "Digital";
  if (/\b(retail|consumer|branch|deposit|lending)\b/.test(t)) return "Retail";
  if (/\b(strategy|strategic|business development)\b/.test(t)) return "Strategy";
  if (/\b(product officer|product management|chief product|head of product)\b/.test(t)) return "Product";
  return "Other";
}

// ─── LinkedIn outreach prompt (mirrors outbound engine logic) ───
function buildLinkedInPrompt(lead) {
  const persona = lead.persona || classifyPersona(lead.title);
  const PA = { CEO:"growth, revenue, fintechs", CMO:"segmentation, acquisition, engagement", Digital:"digital CX, behavioral data", Retail:"cross-sell, deposits, visibility", Strategy:"intelligence, monetizing data", Product:"innovation, data-driven", Other:"efficiency, advantage" };
  const FIN = "Finoveo sells a white-label client acquisition & data engine (PFScores) to banks/CUs. Behavioral data, customer insights, cross-sell. 90-day deploy, no core changes, 10x deeper data.";
  return "Generate LinkedIn outreach messages for Finoveo's founder.\n\nFINOVEO: "+FIN+"\n\nLEAD: "+(lead.full_name||lead.first_name+" "+lead.last_name)+", "+(lead.title||"?")+" at "+(lead.company||"?")+" ("+(lead.institution_type||"?")+", "+(lead.state||"?")+")\nLinkedIn about: "+(lead.linkedin_about||"N/A")+"\nPersona: "+(PA[persona]||PA.Other)+"\n\nConcise, sharp, professional. No fake compliments.\n\nReturn ONLY valid JSON:\n{\"linkedin_connection_note\":\"<under 280 chars>\",\"linkedin_dm_1\":\"<3-4 sentences>\",\"linkedin_followup_1\":\"<2-3 sentences>\",\"linkedin_followup_2\":\"<1-2 sentences>\"}";
}

// ─── Smart CSV → Lead mapper ───────────────────────────────────────────
function mapCSVToLeads(data) {
  if (!data || data.length < 2) return [];
  const headers = data[0].map(h => String(h).toLowerCase().trim().replace(/\s+/g, "_"));
  const rows = data.slice(1);
  const col = (...candidates) => { for (const c of candidates) { const i = headers.findIndex(h => h.includes(c)); if (i >= 0) return i; } return -1; };
  const firstNameI = col("first_name","first","fname");
  const lastNameI  = col("last_name","last","lname");
  const fullNameI  = col("full_name","name","contact");
  const emailI     = col("email","e-mail");
  const titleI     = col("title","job_title","position","role","designation");
  const companyI   = col("company","institution","organization","employer","bank","credit_union","firm");
  const stateI     = col("state","location","region","province");
  const linkedinI  = col("linkedin","profile_url","li_url","linkedin_url");
  const assetI     = col("asset","total_asset","asset_size");
  const instTypeI  = col("institution_type","inst_type","type","category");
  const aboutI     = col("about","bio","linkedin_about","description","summary");
  const get = (row, i) => i >= 0 ? String(row[i] || "").trim() : "";
  return rows.filter(r => r.some(c => String(c || "").trim())).map(row => {
    let first = get(row, firstNameI), last = get(row, lastNameI), full = get(row, fullNameI);
    if (!first && !last && full) { const p = full.split(/\s+/); first = p[0]; last = p.slice(1).join(" "); }
    else if (!full && (first || last)) full = `${first} ${last}`.trim();
    const title = get(row, titleI);
    return { first_name:first, last_name:last, full_name:full, email:get(row,emailI), title, company:get(row,companyI), institution_type:get(row,instTypeI)||"Bank", state:get(row,stateI), linkedin_url:get(row,linkedinI), asset_size:get(row,assetI), linkedin_about:get(row,aboutI), persona:classifyPersona(title), status:"not_contacted" };
  }).filter(l => l.full_name || l.first_name || l.last_name);
}

// ─── GHL booking email detector ────────────────────────────────────────
// Subject format: "New Appointment Booked - Tom Hankard"
// From: info+pfscores.com@send.lcmsgsndr.org
function detectGHLBooking(emails) {
  return emails.filter(e => /^new appointment booked/i.test(e.subject || ""));
}

function extractBookingInfo(email) {
  const subject = email.subject || "";
  const snippet = email.snippet || "";
  const combined = `${subject} ${snippet}`;

  // Name from subject: "New Appointment Booked - Tom Hankard"
  const nameMatch = subject.match(/new appointment booked\s*[-–]\s*(.+)/i);
  const name = nameMatch?.[1]?.trim() || null;

  // Email from snippet: "Email: thankard@beverlyfcu.com"
  const emailMatch = combined.match(/email[:\s]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  const prospectEmail = emailMatch?.[1]?.trim() || null;

  // Date/time from snippet: "Date & Time: Friday, March 13, 2026 9:00 AM"
  const dateMatch = combined.match(/date\s*(?:&|and)?\s*time[:\s]+([^\n•]+)/i);
  const appointmentTime = dateMatch?.[1]?.trim() || null;

  return { name, email: prospectEmail, appointmentTime };
}

// ─── CSV parser ───
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  return lines.map((line) => {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { values.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    values.push(current.trim());
    return values;
  });
}

// ─── Google Drive: list recent Sheets ───
async function fetchDriveSheets(accessToken) {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    orderBy: "modifiedTime desc",
    pageSize: "30",
    corpora: "user",
    fields: "files(id,name,modifiedTime,webViewLink)",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error("token_expired");
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason || "forbidden";
    throw new Error(`drive_403:${reason}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || "drive_error");
  }
  const data = await res.json();
  return data.files || [];
}

// ─── Google Sheets: read a sheet ───
async function readGoogleSheet(accessToken, spreadsheetId, range = "Sheet1") {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("sheets_read_error");
  const data = await res.json();
  return data.values || [];
}

// ─── Google Sheets: append rows to existing sheet ───
async function appendToGoogleSheet(accessToken, spreadsheetId, values, range = "Sheet1") {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    }
  );
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("sheets_append_error");
  return await res.json();
}

// ─── Google Sheets: create a new sheet and optionally populate it ───
async function createGoogleSheet(accessToken, title, values = []) {
  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: "Sheet1" } }],
    }),
  });
  if (res.status === 401) throw new Error("token_expired");
  if (!res.ok) throw new Error("sheets_create_error");
  const sheet = await res.json();
  if (values.length && sheet.spreadsheetId) {
    await appendToGoogleSheet(accessToken, sheet.spreadsheetId, values);
  }
  return sheet;
}

async function loadData(key, fallback) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : fallback; } catch { return fallback; }
}
async function saveData(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); } catch {}
}

async function fireNotification(title, body, options = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const tag = "mary-" + Date.now();
  // Prefer SW showNotification — works even when tab is backgrounded
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.active) {
        reg.active.postMessage({ type: "FIRE_NOTIFICATION", title, options: { body, tag, ...options } });
        return;
      }
    } catch {}
  }
  // Fallback: direct Notification API (foreground only)
  try {
    const n = new Notification(title, { body, icon: "/icon-192.png", requireInteraction: true, tag, ...options });
    setTimeout(() => n.close(), 30000);
  } catch {}
}

function formatTime(iso) { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } catch { return iso || ""; } }
function formatDate(iso) { try { return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return iso || ""; } }
function formatDateTime(iso) { try { return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso || ""; } }
function relativeDate(iso) {
  if (!iso) return "";
  const diff = Math.ceil((new Date(iso) - new Date()) / 86400000);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return formatDate(iso);
}

const PC = { high: "#ef4444", medium: "#f5c518", low: "#7a96bc" };

export default function Mary() {
  const [tab, setTab] = useState("today");
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [briefing, setBriefing] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [verse, setVerse] = useState(null);
  const [tomorrowPreview, setTomorrowPreview] = useState("");
  const [tomorrowLoading, setTomorrowLoading] = useState(false);
  const [quickTask, setQuickTask] = useState("");
  const [notifPerm, setNotifPerm] = useState("default");
  const [fired, setFired] = useState(new Set());
  const [googleToken, setGoogleToken] = useState(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [userName, setUserName] = useState("");
  const [userPhoto, setUserPhoto] = useState("");
  const [inboxEmails, setInboxEmails] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  // Drive / Sheets state
  const [attachedFile, setAttachedFile] = useState(null); // { name, rows, data: [[...]] }
  const [driveSheets, setDriveSheets] = useState([]);
  const [driveError, setDriveError] = useState(null); // null | "no_token" | "api_error" | string
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [googleTokenExpiring, setGoogleTokenExpiring] = useState(false);
  const tokenClientRef = useRef(null);
  const recognitionRef = useRef(null);
  const sendMessageRef = useRef(null);
  const chatEnd = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const pipelineCacheRef = useRef(null);   // { leads: [...], ts: Date.now() }
  const pipelineFetchingRef = useRef(false); // prevents duplicate in-flight fetches

  useEffect(() => {
    (async () => {
      setTasks(await loadData("mary-tasks", []));
      setChat(await loadData("mary-chat", []));
      setReminders(await loadData("mary-reminders", []));
      setSuggestedTasks(await loadData("mary-suggested-tasks", []));
      // Load cached briefing if from today
      const cached = await loadData("mary-briefing-cache", null);
      if (cached && cached.date === new Date().toDateString()) {
        setBriefing(cached.briefing);
        if (cached.events) setEvents(cached.events);
        if (cached.verse) setVerse(cached.verse);
        setBriefingLoading(false);
      }
      // Load cached tomorrow preview
      const cachedTmr = await loadData("mary-tomorrow-cache", null);
      if (cachedTmr && cachedTmr.date === new Date().toDateString()) {
        setTomorrowPreview(cachedTmr.preview);
      }

      // Pre-warm pipeline cache in background so lead lookups are instant
      fetchOutboundLeads().then(leads => {
        pipelineCacheRef.current = { leads, ts: Date.now() };
      }).catch(() => {});
    })();
    if ("Notification" in window) setNotifPerm(Notification.permission);

    // Load stored Google token + profile
    const storedToken = localStorage.getItem("mary-google-token");
    const tokenExpiry = localStorage.getItem("mary-google-token-expiry");
    const storedName = localStorage.getItem("mary-user-name");
    const storedPhoto = localStorage.getItem("mary-user-photo");
    if (storedName) setUserName(storedName);
    if (storedPhoto) setUserPhoto(storedPhoto);
    if (storedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
      setGoogleToken(storedToken);
      fetchGmailEmails(storedToken).then(setInboxEmails).catch(() => {});
    } else {
      localStorage.removeItem("mary-google-token");
      localStorage.removeItem("mary-google-token-expiry");
    }
  }, []);

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // ─── Google token expiry monitor ─────────────────────────────────────
  useEffect(() => {
    if (!googleToken) { setGoogleTokenExpiring(false); return; }
    const check = () => {
      const expiry = parseInt(localStorage.getItem("mary-google-token-expiry") || "0");
      const minsLeft = (expiry - Date.now()) / 60000;
      if (minsLeft <= 0) {
        // Token has expired — clear it and prompt reconnect
        setGoogleToken(null);
        setGoogleTokenExpiring(false);
        localStorage.removeItem("mary-google-token");
        localStorage.removeItem("mary-google-token-expiry");
      } else if (minsLeft <= 10) {
        // Expiring soon — show warning and try a silent refresh
        setGoogleTokenExpiring(true);
        if (tokenClientRef.current) {
          try { tokenClientRef.current.requestAccessToken({ prompt: "" }); } catch {}
        }
      } else {
        setGoogleTokenExpiring(false);
      }
    };
    check();
    const iv = setInterval(check, 120000); // re-check every 2 minutes
    return () => clearInterval(iv);
  }, [googleToken]);

  // (SW no longer does its own scheduling — main thread handles all timing)

  // Initialize Google Identity Services
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: async (response) => {
          if (response.error) return;
          const expiry = Date.now() + response.expires_in * 1000;
          setGoogleToken(response.access_token);
          localStorage.setItem("mary-google-token", response.access_token);
          localStorage.setItem("mary-google-token-expiry", expiry.toString());
          setGoogleLoading(false);
          // Fetch profile and inbox on connect
          const profile = await fetchGoogleProfile(response.access_token);
          if (profile?.given_name) {
            setUserName(profile.given_name);
            localStorage.setItem("mary-user-name", profile.given_name);
          }
          if (profile?.picture) {
            setUserPhoto(profile.picture);
            localStorage.setItem("mary-user-photo", profile.picture);
          }
          fetchGmailEmails(response.access_token).then(setInboxEmails).catch(() => {});
        },
      });
    };
    document.head.appendChild(script);
    return () => { if (script.parentNode) script.parentNode.removeChild(script); };
  }, []);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (isListening) { recognitionRef.current?.stop(); return; }
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-US";
    r.onstart = () => setIsListening(true);
    r.onresult = (e) => { const transcript = e.results[0][0].transcript; setInput(transcript); setIsListening(false); setTimeout(() => sendMessageRef.current?.(transcript), 100); };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
  }, [isListening]);

  // Handle file upload — CSV, Excel (.xlsx/.xls), or PDF
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowAttachMenu(false);
    const ext = file.name.split(".").pop().toLowerCase();

    if (["jpg","jpeg","png","gif","webp","heic"].includes(ext)) {
      // Read image as base64 so Claude can see it
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        const base64 = dataUrl.split(",")[1];
        const mimeMap = { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif", webp:"image/webp", heic:"image/jpeg" };
        const mediaType = mimeMap[ext] || "image/jpeg";
        setAttachedFile({ name: file.name, type: "image", base64, mediaType, previewUrl: dataUrl });
        setTab("chat");
        setTimeout(() => inputRef.current?.focus(), 100);
      };
      reader.readAsDataURL(file);
    } else if (ext === "pdf") {
      // Read as base64 so Claude can natively understand the PDF
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target.result.split(",")[1];
        setAttachedFile({ name: file.name, type: "pdf", base64 });
        setTab("chat");
        setTimeout(() => inputRef.current?.focus(), 100);
      };
      reader.readAsDataURL(file);
    } else if (ext === "xlsx" || ext === "xls") {
      // Parse Excel with SheetJS → same 2D array format as CSV
      const reader = new FileReader();
      reader.onload = (ev) => {
        const workbook = XLSX.read(ev.target.result, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        setAttachedFile({ name: file.name, type: "table", rows: data.length, data });
        setTab("chat");
        setTimeout(() => inputRef.current?.focus(), 100);
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV / TXT — existing text flow
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        const data = parseCSV(text);
        setAttachedFile({ name: file.name, type: "table", rows: data.length, data });
        setTab("chat");
        setTimeout(() => inputRef.current?.focus(), 100);
      };
      reader.readAsText(file);
    }
    // Reset so same file can be re-uploaded
    e.target.value = "";
  }, []);

  // Open Drive picker: fetch recent sheets and show them
  const openDrivePicker = useCallback(async () => {
    setShowAttachMenu(false);
    setShowDrivePicker(true);
    setDriveError(null);
    const token = localStorage.getItem("mary-google-token");
    if (!token) { setDriveError("no_token"); return; }
    if (driveSheets.length) return; // already loaded successfully — don't re-fetch
    setDriveLoading(true);
    try {
      const sheets = await fetchDriveSheets(token);
      setDriveSheets(sheets);
      if (sheets.length === 0) setDriveError("empty");
    } catch (err) {
      setDriveSheets([]);
      setDriveError(err.message || "drive_error");
    }
    setDriveLoading(false);
  }, [driveSheets]);

  // Load a Drive sheet into context
  const loadDriveSheet = useCallback(async (sheet) => {
    const token = localStorage.getItem("mary-google-token");
    if (!token) return;
    setDriveLoading(true);
    try {
      const values = await readGoogleSheet(token, sheet.id);
      setAttachedFile({ name: sheet.name, rows: values.length, data: values, spreadsheetId: sheet.id, webViewLink: sheet.webViewLink });
      setShowDrivePicker(false);
      setTab("chat");
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch { alert("Couldn't read that sheet. Try again."); }
    setDriveLoading(false);
  }, []);

  const connectGoogle = useCallback(() => {
    if (!tokenClientRef.current) return;
    setGoogleLoading(true);
    // Clear cached Drive sheets so picker re-fetches with fresh token
    setDriveSheets([]);
    setDriveError(null);
    tokenClientRef.current.requestAccessToken();
  }, []);

  const disconnectGoogle = useCallback(() => {
    setGoogleToken(null);
    localStorage.removeItem("mary-google-token");
    localStorage.removeItem("mary-google-token-expiry");
  }, []);

  // Fetch briefing (only if not cached recently)
  const fetchBriefing = useCallback(async (force = false) => {
    if (!force) {
      const cached = await loadData("mary-briefing-cache", null);
      if (cached && cached.date === new Date().toDateString()) {
        const cacheAge = (Date.now() - (cached.ts || 0)) / 3600000;
        if (cacheAge < 3) return;
      }
    }
    setBriefingLoading(true);
    try {
      // Fetch real calendar + Gmail if Google is connected
      let calendarContext = "";
      let gmailContext = "";
      const token = localStorage.getItem("mary-google-token");
      const tokenExpiry = localStorage.getItem("mary-google-token-expiry");
      if (token && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
        try {
          const [calEvents, emails] = await Promise.all([
            fetchCalendarEvents(token, 2).catch(() => []),
            fetchGmailEmails(token).catch(() => []),
          ]);
          if (calEvents.length > 0) {
            calendarContext = `\n\nGoogle Calendar events for today and tomorrow:\n${JSON.stringify(calEvents, null, 2)}`;
            setEvents(calEvents);
            // Schedule email reminders for upcoming meetings
            scheduleEmailReminders(token, calEvents).catch(() => {});
          } else {
            calendarContext = "\n\nGoogle Calendar shows no events for today or tomorrow.";
          }
          if (emails.length > 0) {
            gmailContext = `\n\nUnread work emails from the last 2 days:\n${JSON.stringify(emails, null, 2)}`;

            // ─── GHL Booking Auto-Detection ──────────────────────────
            const bookings = detectGHLBooking(emails);
            if (bookings.length > 0) {
              try {
                const leads = await getLeads();
                for (const booking of bookings) {
                  const info = extractBookingInfo(booking);
                  const { name, email: prospectEmail, appointmentTime } = info;
                  if (!name && !prospectEmail) continue;

                  // Match by email first (most reliable), then fall back to name
                  let match = null;
                  if (prospectEmail) {
                    match = leads.find(l => (l.email || "").toLowerCase() === prospectEmail.toLowerCase());
                  }
                  if (!match && name) {
                    match = findLeadBySearch(leads, name);
                  }

                  if (match && match.status !== "booked" && match.status !== "second_call" && match.status !== "closed") {
                    await updateOutboundLead(match.id, { status: "booked" }).catch(() => {});
                    const timeLabel = appointmentTime ? ` scheduled for ${appointmentTime}` : "";
                    gmailContext += `\n\n🎉 Auto-detected booking: **${name || prospectEmail}** (${match.company || "unknown company"})${timeLabel} — pipeline updated to Booked.`;
                  }
                }
              } catch {}
            }
          } else {
            gmailContext = "\n\nGmail inbox is clear — no unread work emails.";
          }
        } catch (e) {
          if (e.message === "token_expired") {
            setGoogleToken(null);
            localStorage.removeItem("mary-google-token");
            localStorage.removeItem("mary-google-token-expiry");
          }
        }
      }

      const hasGoogle = !!calendarContext;
      const briefingMsg = `Give me my daily briefing. Format it with clear sections and plenty of white space so it's easy to scan on mobile. Use this structure:

**📅 Schedule**
[${hasGoogle ? "Summarize today's events as short bullet points with times. Flag conflicts or back-to-back meetings." : "No calendar connected."}]

**📧 Inbox**
[${hasGoogle ? "2-3 bullet points for emails needing action. Skip noise." : "No inbox connected."}]

**✅ Tasks**
[Mention open task count or say inbox is clear.]

Keep each section short — 2 to 4 lines max. No long paragraphs. Use bullet points.`;

      const text = await callClaude([{ role: "user", content: briefingMsg + calendarContext + gmailContext }]);
      const p = parseResponse(text);
      setBriefing(p.message || text);
      if (p.calendar_events?.length) setEvents(p.calendar_events);
      if (p.bible_verse) setVerse(p.bible_verse);
      if (p.suggested_tasks?.length) await saveData("mary-suggested-tasks", p.suggested_tasks);
      await saveData("mary-briefing-cache", { date: new Date().toDateString(), ts: Date.now(), briefing: p.message || text, events: p.calendar_events || [], verse: p.bible_verse || null });
    } catch (e) {
      setBriefing("Couldn't fetch your briefing — try refreshing. " + (e.message || ""));
    }
    setBriefingLoading(false);
  }, []);

  useEffect(() => { fetchBriefing(); }, []);

  // Fetch tomorrow's preview
  const fetchTomorrow = useCallback(async () => {
    const cached = await loadData("mary-tomorrow-cache", null);
    if (cached && cached.date === new Date().toDateString()) return;
    setTomorrowLoading(true);
    try {
      let calendarContext = "";
      const token = localStorage.getItem("mary-google-token");
      const tokenExpiry = localStorage.getItem("mary-google-token-expiry");
      if (token && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
        try {
          const calEvents = await fetchCalendarEvents(token, 2);
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toDateString();
          const tomorrowEvents = calEvents.filter((ev) => new Date(ev.start).toDateString() === tomorrowStr);
          if (tomorrowEvents.length > 0) {
            calendarContext = `\n\nTomorrow's calendar events:\n${JSON.stringify(tomorrowEvents, null, 2)}`;
          } else {
            calendarContext = "\n\nNo events on the calendar for tomorrow.";
          }
        } catch {}
      }
      const msg = `Give me a preview of tomorrow's schedule.${calendarContext || " I haven't connected Google Calendar, so just give me a brief wind-down message."} Flag any early meetings, conflicts, or anything I should prepare for tonight. Be concise — this is an end-of-day wind-down summary. Respond with JSON: {"message": "your summary"}`;
      const text = await callClaude([{ role: "user", content: msg + calendarContext }]);
      const p = parseResponse(text);
      const preview = p.message || text;
      setTomorrowPreview(preview);
      await saveData("mary-tomorrow-cache", { date: new Date().toDateString(), preview });
    } catch { setTomorrowPreview(""); }
    setTomorrowLoading(false);
  }, []);

  // Scheduled notifications: 7am morning nudge, 8pm evening preview
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const todayKey = now.toDateString();

      // 7:00 AM morning nudge
      if (h === 7 && m === 0 && !fired.has("morning-" + todayKey)) {
        const name = localStorage.getItem("mary-user-name") || "";
        const firstEvent = events[0];
        const notifBody = firstEvent ? `First up: ${firstEvent.title} at ${formatTime(firstEvent.start)}` : "Your daily briefing is ready.";
        fireNotification(`☀ Good morning${name ? ", " + name : ""}!`, notifBody);
        setFired((p) => new Set([...p, "morning-" + todayKey]));
      }

      // 8:00 PM evening preview
      if (h === 20 && m === 0 && !fired.has("evening-" + todayKey)) {
        fireNotification("🌙 Tomorrow's preview is ready", "Open Mary to see what's ahead tomorrow.");
        setFired((p) => new Set([...p, "evening-" + todayKey]));
        fetchTomorrow();
      }

      // Auto-fetch tomorrow preview after 6pm if not yet loaded
      if (h >= 18 && !tomorrowPreview && !tomorrowLoading) {
        fetchTomorrow();
      }
    }, 15000); // check every 15s for accuracy
    return () => clearInterval(iv);
  }, [fired, tomorrowPreview, tomorrowLoading, fetchTomorrow]);

  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      // ─── Chat-set reminders ───────────────────────────────────────────
      reminders.forEach((r) => {
        if (r.fired || fired.has(r.id)) return;
        if (new Date(r.time) <= now) {
          fireNotification("⏰ Reminder", r.title, { vibrate: [300, 100, 300] });
          setFired((p) => new Set([...p, r.id]));
          setReminders((p) => p.map((x) => (x.id === r.id ? { ...x, fired: true } : x)));
        }
      });
      // ─── Calendar event alerts ────────────────────────────────────────
      events.forEach((ev) => {
        const diff = (new Date(ev.start) - now) / 60000;
        [60, 30, 15, 5].forEach((threshold) => {
          const k = `cal-${ev.start}-${threshold}`;
          if (diff > threshold - 0.25 && diff <= threshold + 0.25 && !fired.has(k)) {
            const label = threshold === 60 ? "1 hour" : `${threshold} min`;
            fireNotification(`📅 ${ev.title} in ${label}`, ev.location || "Tap to open Mary", { vibrate: threshold <= 15 ? [200, 100, 200, 100, 200] : [200] });
            setFired((p) => new Set([...p, k]));
          }
        });
        // At the start of the meeting
        const kNow = `cal-${ev.start}-now`;
        if (diff > -0.5 && diff <= 0.25 && !fired.has(kNow)) {
          fireNotification(`🔴 ${ev.title} is starting NOW`, ev.location || "Don't miss it!", { vibrate: [300, 100, 300, 100, 300] });
          setFired((p) => new Set([...p, kNow]));
        }
      });
    }, 15000); // check every 15s — reminders accurate to within 15 seconds
    return () => clearInterval(iv);
  }, [reminders, events, fired]);

  useEffect(() => { saveData("mary-tasks", tasks); }, [tasks]);
  useEffect(() => { if (chat.length) saveData("mary-chat", chat.slice(-20)); }, [chat]);
  useEffect(() => { saveData("mary-reminders", reminders); }, [reminders]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, loading]);

  const enableNotif = async () => {
    if ("Notification" in window) {
      const p = await Notification.requestPermission();
      setNotifPerm(p);
      if (p === "granted") fireNotification("✦ Mary is ready", "You'll get reminders and meeting alerts here.");
    }
  };

  const addTask = useCallback((title, due = null, priority = "medium") => {
    setTasks((p) => [...p, { id: Date.now(), title, due, priority, done: false }]);
  }, []);
  const addReminder = useCallback((title, time) => {
    setReminders((p) => [...p, { id: Date.now(), title, time, fired: false }]);
  }, []);

  // Returns cached leads if fresh (< 5 min), otherwise fetches and updates cache
  const getLeads = async () => {
    const CACHE_TTL = 5 * 60 * 1000;
    if (pipelineCacheRef.current && (Date.now() - pipelineCacheRef.current.ts) < CACHE_TTL) {
      return pipelineCacheRef.current.leads;
    }
    if (!pipelineFetchingRef.current) {
      pipelineFetchingRef.current = true;
      try {
        const leads = await fetchOutboundLeads();
        pipelineCacheRef.current = { leads, ts: Date.now() };
        return leads;
      } finally {
        pipelineFetchingRef.current = false;
      }
    }
    // Another fetch is in progress — wait for it
    return pipelineCacheRef.current?.leads || await fetchOutboundLeads();
  };

  // ─── Local pipeline lookup — zero API cost, pure JS like the dashboard ──
  const localPipelineLookup = async (msg) => {
    const leads = pipelineCacheRef.current?.leads;
    if (!leads?.length) return null;
    const msgL = msg.toLowerCase();
    const STAGE_LABELS = { not_contacted:"Not Contacted", request_sent:"Request Sent", accepted_dm:"Accepted / DM Sent", following_up:"Following Up", replied_followup:"Replied / Follow Up", booked:"Booked", second_call:"2nd Call", not_interested:"Not Interested", closed:"Closed" };
    const fmtLead = l => `**${l.full_name || `${l.first_name} ${l.last_name}`.trim()}** — ${l.company}${l.title ? `, ${l.title}` : ""}${l.state ? ` (${l.state})` : ""} · Status: ${STAGE_LABELS[l.status] || l.status}${l.next_linkedin_followup_date ? ` · Follow-up: ${l.next_linkedin_followup_date}` : ""}`;

    // ── Name/company lookup ──────────────────────────────────────────────
    const namePat = /\b(where is|what stage is|status of|find|look up|show me|tell me about|update on|check on|how is|pull up)\b/i;
    const properName = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.exec(msg);
    if (namePat.test(msg) || properName) {
      const words = msg.split(/\s+/).filter(w => w.length > 2);
      const matches = leads.filter(l => {
        const hay = `${l.full_name} ${l.first_name} ${l.last_name} ${l.company}`.toLowerCase();
        return words.some(w => w.length > 3 && hay.includes(w.toLowerCase()));
      }).slice(0, 5);
      if (matches.length === 1) return fmtLead(matches[0]);
      if (matches.length > 1) return `Found ${matches.length} matches:\n${matches.map(fmtLead).join("\n")}`;
    }

    // ── Stage count/list ─────────────────────────────────────────────────
    const stageMap = { "booked":["booked"], "second call":["second_call"], "2nd call":["second_call"], "not interested":["not_interested"], "closed":["closed"], "following up":["following_up"], "follow up":["following_up"], "request sent":["request_sent"], "accepted":["accepted_dm"], "dm sent":["accepted_dm"], "replied":["replied_followup"], "not contacted":["not_contacted"] };
    const askedStages = Object.entries(stageMap).filter(([k]) => msgL.includes(k)).flatMap(([,v]) => v);
    if (askedStages.length > 0) {
      const filtered = leads.filter(l => askedStages.includes(l.status));
      const isCount = /how many|count|number of|total/.test(msgL);
      if (isCount) return `You have **${filtered.length} ${STAGE_LABELS[askedStages[0]] || askedStages[0]}** leads.`;
      if (filtered.length === 0) return `No leads found in ${askedStages.map(s => STAGE_LABELS[s]).join("/")} right now.`;
      return `**${STAGE_LABELS[askedStages[0]]} — ${filtered.length} leads:**\n${filtered.map(fmtLead).join("\n")}`;
    }

    // ── Total counts / summary ───────────────────────────────────────────
    if (/how many (leads|prospects|contacts|total)|pipeline (count|size|total)|total leads/.test(msgL)) {
      const active = leads.filter(l => l.status && l.status !== "not_contacted");
      const counts = Object.entries(STAGE_LABELS).map(([k, label]) => {
        const n = leads.filter(l => l.status === k).length;
        return n > 0 ? `${label}: ${n}` : null;
      }).filter(Boolean);
      return `**Pipeline summary (${leads.length} total leads):**\n${counts.join("\n")}`;
    }

    // ── Due today ────────────────────────────────────────────────────────
    if (/due today|follow.?up today|overdue/.test(msgL)) {
      const today = new Date().toISOString().split("T")[0];
      const due = leads.filter(l => l.next_linkedin_followup_date && l.next_linkedin_followup_date <= today && l.status !== "not_contacted");
      if (due.length === 0) return "No follow-ups due today. 👍";
      return `**${due.length} follow-up${due.length > 1 ? "s" : ""} due today:**\n${due.map(fmtLead).join("\n")}`;
    }

    return null; // couldn't handle locally — fall through to Claude
  };

  const sendMessage = async (overrideText) => {
    const msg = (typeof overrideText === "string" ? overrideText : input).trim();
    if (!msg || loading) return;
    const updated = [...chat, { role: "user", text: msg, ts: Date.now() }];
    setChat(updated);
    setInput("");
    setLoading(true);
    try {
      // ── Try a free local lookup before hitting the API ──────────────────
      if (!attachedFile) {
        const localAnswer = await localPipelineLookup(msg);
        if (localAnswer) {
          setChat((p) => [...p, { role: "assistant", text: localAnswer, ts: Date.now() }]);
          setLoading(false);
          return;
        }
      }
      const apiMsgs = updated.slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const open = tasks.filter((t) => !t.done);
      const pending = reminders.filter((r) => !r.fired);
      let ctx = "";
      if (open.length) ctx += "\nOpen tasks: " + open.map((t) => '"' + t.title + '" (' + t.priority + ", due: " + (t.due || "none") + ")").join(", ");
      if (pending.length) ctx += "\nPending reminders: " + pending.map((r) => '"' + r.title + '" at ' + r.time).join(", ");
      if (!open.length && !pending.length) ctx += "\nNo open tasks or reminders.";
      // Inject attached file data (CSV/Excel as text preview; PDF/image as native content blocks)
      if (attachedFile && attachedFile.type === "table") {
        const preview = attachedFile.data.slice(0, 100).map((r) => r.join("\t")).join("\n");
        const truncNote = attachedFile.rows > 100 ? `\n... (${attachedFile.rows - 100} more rows not shown)` : "";
        ctx += `\n\nAttached file: "${attachedFile.name}" — ${attachedFile.rows} rows × ${(attachedFile.data[0] || []).length} columns\n${preview}${truncNote}`;
      }
      apiMsgs[apiMsgs.length - 1].content += ctx;
      // For PDF or image: convert last message content to array of content blocks
      if (attachedFile?.type === "pdf" || attachedFile?.type === "image") {
        const lastMsg = apiMsgs[apiMsgs.length - 1];
        const mediaBlock = attachedFile.type === "pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachedFile.base64 } }
          : { type: "image", source: { type: "base64", media_type: attachedFile.mediaType, data: attachedFile.base64 } };
        lastMsg.content = [mediaBlock, { type: "text", text: lastMsg.content }];
      }
      // Attach live Google context when relevant
      const calToken = localStorage.getItem("mary-google-token");
      const calExpiry = localStorage.getItem("mary-google-token-expiry");
      const msgLower = msg.toLowerCase();
      let extra = "";

      if (calToken && calExpiry && Date.now() < parseInt(calExpiry)) {
        const needsCalendar = ["calendar", "schedule", "meeting", "event", "appointment", "today", "tomorrow", "week"].some((k) => msgLower.includes(k));
        const needsEmail = ["email", "inbox", "gmail", "mail", "message", "unread", "sent", "last email", "search my", "find email", "from nilendu", "from andy", "from ellen", "from matt", "correspondence", "thread"].some((k) => msgLower.includes(k));
        try {
          const [calEvents, emails] = await Promise.all([
            needsCalendar ? fetchCalendarEvents(calToken, 3).catch(() => []) : Promise.resolve([]),
            needsEmail ? fetchGmailEmails(calToken).catch(() => []) : Promise.resolve([]),
          ]);
          if (calEvents.length > 0) extra += `\n\nGoogle Calendar events (next 3 days):\n${JSON.stringify(calEvents, null, 2)}`;
          if (emails.length > 0) extra += `\n\nUnread work emails:\n${JSON.stringify(emails, null, 2)}`;
        } catch {}
      }

      // ─── Finoveo Pipeline — always inject so Mary has full context ──────
      try {
        const leads = await getLeads();
        if (leads?.length) {
          // Always include the stage summary
          extra += `\n\n${buildPipelineSummary(leads)}`;

          // Compact one-liner per lead — always included so Mary can answer any question
          const compact = l => `${l.full_name || `${l.first_name} ${l.last_name}`.trim()} — ${l.company} (${l.status}${l.next_linkedin_followup_date ? ", due " + l.next_linkedin_followup_date : ""})`;
          extra += `\n\nAll leads:\n${leads.map(compact).join("\n")}`;

          // If user mentions a specific person/company, also inject full detail for those matches
          const words = msg.split(/\s+/).filter(w => w.length > 3);
          const matching = leads.filter(l => {
            const hay = `${l.company} ${l.full_name} ${l.first_name} ${l.last_name}`.toLowerCase();
            return words.some(w => hay.includes(w.toLowerCase()));
          }).slice(0, 5);
          if (matching.length > 0) {
            const slimLead = l => ({ id: l.id, name: l.full_name || `${l.first_name} ${l.last_name}`.trim(), company: l.company, title: l.title, state: l.state, status: l.status, email: l.email, asset_size: l.asset_size, institution_type: l.institution_type, persona: l.persona, linkedin_step: l.linkedin_step, next_followup: l.next_linkedin_followup_date, notes: l.notes });
            extra += `\n\nFull detail for matched lead(s):\n${JSON.stringify(matching.map(slimLead), null, 2)}`;
          }
        }
      } catch (e) {
        extra += `\n\n⚠️ Could not load pipeline data: ${e.message}`;
      }

      if (extra) {
        const last = apiMsgs[apiMsgs.length - 1];
        if (Array.isArray(last.content)) {
          // Content is already a block array (PDF/image) — append extra to the text block
          const textBlock = last.content.find(b => b.type === "text");
          if (textBlock) textBlock.text += extra;
          else last.content.push({ type: "text", text: extra });
        } else {
          last.content += extra;
        }
        apiMsgs[apiMsgs.length - 1] = last;
      }

      const text = await callClaude(apiMsgs);
      const parsed = parseResponse(text);
      if (parsed.tasks_to_add) parsed.tasks_to_add.forEach((t) => addTask(t.title, t.due, t.priority || "medium"));
      if (parsed.tasks_to_complete) setTasks((p) => p.map((t) => parsed.tasks_to_complete.some((tc) => t.title.toLowerCase().includes(tc.toLowerCase())) ? { ...t, done: true } : t));
      if (parsed.calendar_events?.length) setEvents(parsed.calendar_events);
      if (parsed.reminders) parsed.reminders.forEach((r) => addReminder(r.title, r.time));
      if (parsed.bible_verse) setVerse(parsed.bible_verse);
      // Persist new memories to localStorage
      if (parsed.save_memory?.length) {
        const existing = JSON.parse(localStorage.getItem("mary-memories") || "[]");
        const updated = [...existing, ...parsed.save_memory].slice(-100); // keep last 100 facts
        localStorage.setItem("mary-memories", JSON.stringify(updated));
      }

      // Actually create calendar events if Mary scheduled any
      let calNote = "";
      if (parsed.create_events?.length) {
        const calToken = localStorage.getItem("mary-google-token");
        const calExpiry = localStorage.getItem("mary-google-token-expiry");
        if (calToken && calExpiry && Date.now() < parseInt(calExpiry)) {
          const results = await Promise.allSettled(parsed.create_events.map((ev) => createCalendarEvent(calToken, ev)));
          const created = results.filter((r) => r.status === "fulfilled").length;
          const failed = results.filter((r) => r.status === "rejected").length;
          if (created > 0) calNote = `\n\n📅 ${created} event${created > 1 ? "s" : ""} added to Google Calendar.`;
          if (failed > 0) calNote += `\n\n⚠️ ${failed} event${failed > 1 ? "s" : ""} couldn't be created.`;
        } else {
          calNote = "\n\n⚠️ Google not connected — couldn't create calendar events.";
        }
      }

      // Actually send the email if Mary composed one
      let emailNote = "";
      if (parsed.send_email) {
        const sendToken = localStorage.getItem("mary-google-token");
        const sendExpiry = localStorage.getItem("mary-google-token-expiry");
        if (sendToken && sendExpiry && Date.now() < parseInt(sendExpiry)) {
          try {
            await sendGmailEmail(sendToken, parsed.send_email);
            emailNote = `\n\n📧 Email sent to ${parsed.send_email.to}`;
          } catch {
            emailNote = "\n\n⚠️ Couldn't send the email — check your Google connection.";
          }
        } else {
          emailNote = "\n\n⚠️ Google not connected — couldn't send the email.";
        }
      }

      // ─── Gmail Search ─────────────────────────────────────────────────
      let gmailSearchNote = "";
      if (parsed.search_gmail?.query) {
        const searchToken = localStorage.getItem("mary-google-token");
        const searchExpiry = localStorage.getItem("mary-google-token-expiry");
        if (searchToken && searchExpiry && Date.now() < parseInt(searchExpiry)) {
          try {
            const results = await searchGmailEmails(searchToken, parsed.search_gmail.query, parsed.search_gmail.max_results || 10);
            if (results.length === 0) {
              gmailSearchNote = `\n\n📭 Gmail search for "${parsed.search_gmail.query}" returned no results.`;
            } else {
              const formatted = results.map((e, i) =>
                `**${i + 1}. ${e.subject || "(no subject)"}**\nFrom: ${e.from}\nDate: ${e.date}\n${e.body || e.snippet || ""}`
              ).join("\n\n---\n\n");
              gmailSearchNote = `\n\n---\n📧 **Gmail Search Results** (${results.length} emails found for "${parsed.search_gmail.query}")\n\n${formatted}`;
              // Re-ask Claude with the search results injected so it can answer properly
              const followUp = [...apiMsgs, { role: "assistant", content: text }, {
                role: "user",
                content: `Here are the Gmail search results:\n\n${JSON.stringify(results, null, 2)}\n\nBased on these emails, answer the original question.`
              }];
              try {
                const followText = await callClaude(followUp);
                const followParsed = parseResponse(followText);
                if (followParsed.message) {
                  gmailSearchNote = `\n\n---\n📧 **Gmail: "${parsed.search_gmail.query}"**\n\n${followParsed.message}`;
                }
              } catch {}
            }
          } catch (e) {
            gmailSearchNote = `\n\n⚠️ Gmail search failed: ${e.message}`;
          }
        } else {
          gmailSearchNote = "\n\n⚠️ Google not connected — connect Google to search Gmail.";
        }
      }

      // Handle Google Sheets write/create actions
      let sheetNote = "";
      if (parsed.create_sheet || parsed.write_to_sheet) {
        const shToken = localStorage.getItem("mary-google-token");
        const shExpiry = localStorage.getItem("mary-google-token-expiry");
        if (shToken && shExpiry && Date.now() < parseInt(shExpiry)) {
          try {
            if (parsed.create_sheet) {
              const newSheet = await createGoogleSheet(shToken, parsed.create_sheet.title, parsed.create_sheet.values || []);
              const rowCount = (parsed.create_sheet.values || []).length;
              sheetNote = `\n\n📊 Created **"${parsed.create_sheet.title}"** in Google Drive`;
              if (rowCount) sheetNote += ` with ${rowCount} rows`;
              if (newSheet.spreadsheetUrl) sheetNote += `. [Open in Drive ↗](${newSheet.spreadsheetUrl})`;
            }
            if (parsed.write_to_sheet) {
              const { spreadsheetId, range, values } = parsed.write_to_sheet;
              await appendToGoogleSheet(shToken, spreadsheetId, values || [], range || "Sheet1");
              const rowCount = (values || []).length;
              sheetNote = `\n\n📊 Added ${rowCount} row${rowCount !== 1 ? "s" : ""} to your Google Sheet.`;
            }
          } catch {
            sheetNote = "\n\n⚠️ Couldn't update the sheet — check your Google connection or try reconnecting.";
          }
        } else {
          sheetNote = "\n\n⚠️ Google not connected — reconnect to use Google Sheets.";
        }
      }

      // ─── Add Single Lead to Pipeline ────────────────────────────────
      let addLeadNote = "";
      if (parsed.add_lead) {
        try {
          const lead = { ...parsed.add_lead, persona: parsed.add_lead.persona || classifyPersona(parsed.add_lead.title) };
          await addOutboundLead(lead);
          pipelineCacheRef.current = null;
          addLeadNote = `\n\n✅ **${lead.full_name || `${lead.first_name} ${lead.last_name}`}** added to the Finoveo pipeline as *Not Contacted*.`;
        } catch { addLeadNote = "\n\n⚠️ Couldn't add the lead — check the outbound engine connection."; }
      }

      // ─── Bulk CSV Import to Pipeline ────────────────────────────────
      let bulkLeadNote = "";
      if (parsed.add_leads_bulk && attachedFile?.type === "table" && attachedFile?.data) {
        try {
          const leads = mapCSVToLeads(attachedFile.data);
          if (leads.length === 0) {
            bulkLeadNote = "\n\n⚠️ Couldn't map the CSV columns to lead fields. Make sure it has name, title, company, and state columns.";
          } else {
            let added = 0, failed = 0;
            for (const lead of leads) {
              try { await addOutboundLead(lead); added++; } catch { failed++; }
              // Small delay to avoid overwhelming the Apps Script
              await new Promise(r => setTimeout(r, 150));
            }
            if (added > 0) pipelineCacheRef.current = null;
            bulkLeadNote = `\n\n✅ **${added} leads imported** to Finoveo pipeline${failed ? ` (${failed} failed)` : ""}.`;
            if (added > 0) bulkLeadNote += ` All set to *Not Contacted*.`;
          }
        } catch { bulkLeadNote = "\n\n⚠️ Bulk import failed — check your connection."; }
      }

      // ─── Generate LinkedIn Outreach ──────────────────────────────────
      let linkedinNote = "";
      if (parsed.generate_linkedin?.search) {
        try {
          const leads = await getLeads();
          const lead = findLeadBySearch(leads, parsed.generate_linkedin.search);
          if (lead) {
            const prompt = buildLinkedInPrompt(lead);
            const res = await fetch(`/api/generate`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({prompt}) });
            const data = await res.json();
            if (data.success && data.data) {
              const d = data.data;
              linkedinNote = `\n\n---\n**LinkedIn Outreach for ${lead.full_name || lead.company}**\n\n**🔗 Connection Note** *(under 280 chars)*\n${d.linkedin_connection_note || ""}\n\n**💬 DM #1**\n${d.linkedin_dm_1 || ""}\n\n**↩ Follow-Up #1**\n${d.linkedin_followup_1 || ""}\n\n**↩ Follow-Up #2**\n${d.linkedin_followup_2 || ""}`;
            } else { linkedinNote = "\n\n⚠️ Couldn't generate LinkedIn messages — try again."; }
          } else { linkedinNote = `\n\n⚠️ Couldn't find "${parsed.generate_linkedin.search}" in the pipeline. Add them first.`; }
        } catch { linkedinNote = "\n\n⚠️ LinkedIn generation failed — check connection."; }
      }

      // ─── Research Institution (FDIC + AI pre-call brief) ────────────
      let researchNote = "";
      if (parsed.research_institution?.name) {
        try {
          const result = await researchInstitution(parsed.research_institution.name);
          const inst = result.institution;
          const ai = result.ai;
          if (inst || ai) {
            let brief = `\n\n---\n📊 **${parsed.research_institution.name} — Research Brief**\n`;
            // ── FDIC Card ──
            if (inst) {
              brief += `\n🏦 **${inst.name}**`;
              if (inst.type) brief += ` · ${inst.type}`;
              if (inst.city && inst.state) brief += ` · ${inst.city}, ${inst.state}`;
              if (inst.website) brief += `\n🌐 ${inst.website}`;
              brief += `\n💰 **Assets:** ${inst.total_assets || "N/A"}  ·  **Deposits:** ${inst.deposits || "N/A"}  ·  **Branches:** ${inst.branches ?? "N/A"}`;
            }
            // ── AI Summary ──
            if (ai?.summary) brief += `\n\n${ai.summary}`;
            researchNote = brief;
          }
        } catch (e) { researchNote = `\n\n⚠️ Research tool error: ${e.message || "try again"}.`; }
      }

      // ─── Update Lead in Pipeline ─────────────────────────────────────
      let leadNote = "";
      if (parsed.update_lead) {
        try {
          const { search, id, updates } = parsed.update_lead;
          let targetId = id;
          let targetName = search;
          if (!targetId && search) {
            const leads = await getLeads();
            const match = findLeadBySearch(leads, search);
            if (match) { targetId = match.id; targetName = match.company || match.full_name || search; }
          }
          if (targetId) {
            await updateOutboundLead(targetId, updates);
            pipelineCacheRef.current = null; // invalidate cache — next query gets fresh data
            const newStatus = updates.status ? ` → **${PIPELINE_STAGES[updates.status] || updates.status}**` : "";
            leadNote = `\n\n✅ **${targetName}** updated in Finoveo pipeline${newStatus}.`;
          } else {
            leadNote = `\n\n⚠️ Couldn't find "${search}" in the pipeline — check the name and try again.`;
          }
        } catch { leadNote = "\n\n⚠️ Couldn't update the lead — check the outbound engine connection."; }
      }

      // ─── Find Email via Hunter ───────────────────────────────────────
      let emailFindNote = "";
      if (parsed.find_email) {
        try {
          const { first_name, last_name, company, domain } = parsed.find_email;
          const result = await findLeadEmail(first_name, last_name, company, domain);
          if (result.success && result.email) {
            emailFindNote = `\n\n📧 **Email found:** ${result.email} *(${result.confidence}% confidence)*`;
            // Auto-update the lead in the sheet if we found the email
            if (first_name && last_name) {
              const leads = await getLeads().catch(() => []);
              const match = findLeadBySearch(leads, `${first_name} ${last_name}`);
              if (match && !match.email) {
                await updateOutboundLead(match.id, { email: result.email }).catch(() => {});
                emailFindNote += ` — saved to pipeline.`;
              }
            }
          } else {
            emailFindNote = `\n\n⚠️ No email found for ${first_name} ${last_name} at ${company || domain}.`;
          }
        } catch { emailFindNote = "\n\n⚠️ Email finder unavailable."; }
      }

      // Clear the attached file after sending
      setAttachedFile(null);

      setChat((p) => [...p, { role: "assistant", text: (parsed.message || text) + calNote + emailNote + gmailSearchNote + sheetNote + addLeadNote + bulkLeadNote + linkedinNote + researchNote + leadNote + emailFindNote, ts: Date.now() }]);
    } catch (err) {
      const detail = err?.message || String(err) || "unknown";
      setChat((p) => [...p, { role: "assistant", text: `Something went wrong: \`${detail}\`\n\nTry again.`, ts: Date.now() }]);
    }
    setLoading(false);
  };

  sendMessageRef.current = sendMessage;

  const now = new Date();
  const greetBase = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const greet = userName ? `${greetBase}, ${userName}` : greetBase;
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);
  const pending = reminders.filter((r) => !r.fired);

  // Gradient text helper
  const gradText = { background: "linear-gradient(90deg, #00f5c0, #38aaff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" };

  const TABS = [
    { k: "today", icon: "◈", label: "Today" },
    { k: "tasks", icon: "☐", label: "Tasks", badge: openTasks.length },
    { k: "inbox", icon: "✉", label: "Inbox", badge: inboxEmails.length },
    { k: "reminders", icon: "⏰", label: "Alerts", badge: pending.length },
    { k: "chat", icon: "✦", label: "Chat" },
  ];

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Background blobs */}
      <div style={S.blob1} />
      <div style={S.blob2} />
      <div style={S.blob3} />

      {/* Notification Banner */}
      {notifPerm !== "granted" && (
        <div style={S.notifBanner}>
          <div style={S.notifRow}>
            <div><div style={S.notifTitle}>🔔 Enable notifications</div><div style={S.notifDesc}>Get alerts for reminders & meetings</div></div>
            <button onClick={enableNotif} style={S.notifBtn}>Enable</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={S.header}>
        <div style={S.headerRow}>
          <div>
            <div style={S.logo}><span style={gradText}>{`Hi, ${userName || "James"}`}</span></div>
            <div style={S.dateLbl}>{dateStr}</div>
          </div>
          <div style={{display:"flex",alignItems:"center"}}>
            {googleToken && <div style={{fontSize:10,color:"#7a96bc",cursor:"pointer"}} onClick={disconnectGoogle}>✓ Google connected</div>}
          </div>
        </div>
        <div style={S.poweredBy}>
          <div style={S.liveDot} />
          <span>powered by <span style={{ color: "#00f5c0", fontWeight: 600 }}>finoveo</span></span>
        </div>
      </header>

      {/* Content */}
      <main style={tab === "chat" ? {...S.main, padding: 0, paddingBottom: "calc(52px + env(safe-area-inset-bottom, 0px))", overflowY: "hidden", display: "flex", flexDirection: "column"} : S.main}>

        {/* ── TODAY ── */}
        {tab === "today" && (
          <div style={S.anim}>
            {/* Google token expiring soon — reconnect banner */}
            {googleToken && googleTokenExpiring && (
              <div style={{...S.gcBanner, background:"rgba(245,197,24,0.12)", border:"1px solid rgba(245,197,24,0.25)"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#f5c518",marginBottom:2}}>⚠️ Google session expiring</div>
                  <div style={{fontSize:12,color:"#7a96bc"}}>Tap Reconnect to keep calendar, Gmail & pipeline access</div>
                </div>
                <button onClick={connectGoogle} style={{...S.gcBtn, background:"rgba(245,197,24,0.15)", color:"#f5c518", border:"1px solid rgba(245,197,24,0.3)"}}>Reconnect</button>
              </div>
            )}

            {/* Google Calendar connection banner - only show when not connected */}
            {GOOGLE_CLIENT_ID && !googleToken && (
              <div style={S.gcBanner}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#fff",marginBottom:2}}>📅 Connect Google Calendar</div>
                  <div style={{fontSize:12,color:"#7a96bc"}}>See your real schedule in the daily briefing</div>
                </div>
                <button onClick={connectGoogle} disabled={googleLoading} style={S.gcBtn}>{googleLoading ? "..." : "Connect"}</button>
              </div>
            )}

            {/* Bible Verse */}
            {verse && (
              <div style={S.verseCard}>
                <div style={S.verseMark}>✦</div>
                <div style={S.verseText}>"{verse.text}"</div>
                <div style={S.verseFooter}>
                  <div style={S.verseRef}>— {verse.reference}</div>
                  <button onClick={() => {
                    const shareText = `"${verse.text}"\n— ${verse.reference}`;
                    if (navigator.share) {
                      navigator.share({ title: "Daily Verse", text: shareText }).catch(() => {});
                    } else {
                      navigator.clipboard.writeText(shareText).then(() => {
                        const btn = document.getElementById("share-verse-btn");
                        if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Share ↗"; }, 2000); }
                      });
                    }
                  }} id="share-verse-btn" style={S.shareBtn}>Share ↗</button>
                </div>
              </div>
            )}

            <div style={S.card}>
              <div style={S.cHead}><div style={S.headDot} /><span style={S.cTitle}>Daily Briefing</span><button onClick={() => fetchBriefing(true)} style={S.refreshBtn} disabled={briefingLoading}>{briefingLoading ? "↻" : "↻ Refresh"}</button></div>
              {briefingLoading
                ? <div style={S.skelWrap}><div style={S.skel}/><div style={{...S.skel,width:"85%"}}/><div style={{...S.skel,width:"60%"}}/><div style={{...S.skel,width:"75%",marginTop:8}}/><div style={{...S.skel,width:"50%"}}/></div>
                : <MarkdownText text={briefing} style={S.bText} />}
            </div>

            {/* Tomorrow Preview - shows after 5pm */}
            {(tomorrowPreview || (new Date().getHours() >= 17 && !tomorrowPreview && !tomorrowLoading)) && (
              <div style={S.tomorrowCard}>
                <div style={S.cHead}><div style={{...S.headDot,background:"#38aaff",boxShadow:"0 0 8px #38aaff"}} /><span style={S.cTitle}>Tomorrow's Preview</span>
                  {!tomorrowPreview && <button onClick={fetchTomorrow} style={S.refreshBtn}>Load →</button>}
                </div>
                {tomorrowLoading ? <div style={S.skelWrap}><div style={S.skel}/><div style={{...S.skel,width:"70%"}}/></div> : tomorrowPreview ? <div style={S.bText}>{tomorrowPreview}</div> : <div style={{fontSize:13,color:"#7a96bc",fontWeight:300}}>Tap "Load" to preview tomorrow's schedule</div>}
              </div>
            )}

            {events.length > 0 && (
              <div style={S.card}>
                <div style={S.cHead}><div style={{...S.headDot,background:"#38aaff",boxShadow:"0 0 8px #38aaff"}} /><span style={S.cTitle}>Upcoming Events</span></div>
                {events.map((ev, i) => {
                  const durMin = ev.start && ev.end ? Math.round((new Date(ev.end) - new Date(ev.start)) / 60000) : null;
                  const durLabel = durMin ? durMin >= 60 ? `${Math.floor(durMin/60)}h${durMin%60?` ${durMin%60}m`:""}` : `${durMin}m` : null;
                  return (
                    <div key={i} style={S.evItem}>
                      <div style={S.evTime}>{formatTime(ev.start)}</div>
                      <div style={S.evInfo}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={S.evTitle}>{ev.title}</div>
                          {durLabel && <span style={S.durPill}>{durLabel}</span>}
                        </div>
                        {ev.location && <div style={S.evLoc}>📍 {ev.location}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {openTasks.length > 0 && (
              <div style={S.card}>
                <div style={S.cHead}><div style={{...S.headDot,background:"#f5c518",boxShadow:"0 0 8px #f5c518"}} /><span style={S.cTitle}>Open Tasks</span><button onClick={() => setTab("tasks")} style={S.seeAll}>See all →</button></div>
                {openTasks.slice(0, 3).map((t) => (
                  <div key={t.id} style={S.mini}><div style={{...S.pDot,background:PC[t.priority]}}/><span style={S.miniT}>{t.title}</span>{t.due && <span style={S.miniD}>{relativeDate(t.due)}</span>}</div>
                ))}
              </div>
            )}

            {pending.length > 0 && (
              <div style={S.card}>
                <div style={S.cHead}><div style={{...S.headDot,background:"#00f5c0",boxShadow:"0 0 8px #00f5c0"}} /><span style={S.cTitle}>Upcoming Reminders</span></div>
                {pending.slice(0, 3).map((r) => (
                  <div key={r.id} style={S.mini}><span style={{fontSize:10,color:"#00dba8"}}>⏰</span><span style={S.miniT}>{r.title}</span><span style={S.miniD}>{formatDateTime(r.time)}</span></div>
                ))}
              </div>
            )}

            {suggestedTasks.length > 0 && (
              <div style={S.card}>
                <div style={S.cHead}><div style={{...S.headDot,background:"#a78bfa",boxShadow:"0 0 8px #a78bfa"}} /><span style={S.cTitle}>Suggested Tasks</span><button onClick={async () => { await saveData("mary-suggested-tasks",[]); setSuggestedTasks([]); }} style={S.seeAll}>Clear</button></div>
                {suggestedTasks.map((t, i) => (
                  <div key={i} style={{...S.mini, justifyContent:"space-between"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}>
                      <div style={{...S.pDot,background:PC[t.priority]||PC.medium}}/>
                      <div>
                        <div style={{fontSize:13,fontWeight:500}}>{t.title}</div>
                        {t.reason && <div style={{fontSize:11,color:"#7a96bc"}}>{t.reason}</div>}
                      </div>
                    </div>
                    <button onClick={() => { addTask(t.title, null, t.priority || "medium"); setSuggestedTasks(p => { const n = p.filter((_,idx)=>idx!==i); saveData("mary-suggested-tasks",n); return n; }); }} style={{...S.gcBtn, fontSize:10, padding:"4px 10px"}}>+ Add</button>
                  </div>
                ))}
              </div>
            )}

            <div style={S.qActions}>
              <button onClick={() => setTab("chat")} style={S.qBtn}>Ask Mary</button>
              <button onClick={() => setTab("tasks")} style={S.qBtn2}>+ Add a task</button>
            </div>
          </div>
        )}

        {/* ── TASKS ── */}
        {tab === "tasks" && (
          <div style={S.anim}>
            <div style={S.addRow}>
              <input value={quickTask} onChange={(e) => setQuickTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && quickTask.trim() && (addTask(quickTask.trim()), setQuickTask(""))} placeholder="Add a task..." style={S.addIn} />
              <button onClick={() => { if (quickTask.trim()) { addTask(quickTask.trim()); setQuickTask(""); }}} style={S.addBtn}>+</button>
            </div>
            {!openTasks.length && !doneTasks.length && <div style={S.empty}><div style={{fontSize:32,marginBottom:8,opacity:0.3}}>☐</div><div style={{fontSize:16,fontWeight:600}}>No tasks yet</div><div style={{fontSize:13,marginTop:4,color:"#7a96bc"}}>Add one above or ask Mary in chat</div></div>}
            {openTasks.length > 0 && (
              <div style={{marginBottom:20}}>
                <div style={S.secTitle}>Open ({openTasks.length})</div>
                {openTasks.map((t) => (
                  <div key={t.id} style={S.tItem}>
                    <button onClick={() => { setTasks((p) => p.map((x) => x.id === t.id ? {...x, done:true} : x)); }} style={{...S.chk, animation:"taskDone 0.3s ease"}}>☐</button>
                    <div style={{flex:1}}><div style={{fontSize:14,fontWeight:500}}>{t.title}</div><div style={{fontSize:12,color:"#7a96bc",marginTop:2}}><span style={{color:PC[t.priority]}}>{t.priority}</span>{t.due && <span> · {relativeDate(t.due)}</span>}</div></div>
                    <button onClick={() => setTasks((p) => p.filter((x) => x.id !== t.id))} style={S.del}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {doneTasks.length > 0 && (
              <div>
                <div style={S.secTitle}>Completed ({doneTasks.length})</div>
                {doneTasks.map((t) => (
                  <div key={t.id} style={{...S.tItem,opacity:0.4}}>
                    <button onClick={() => setTasks((p) => p.map((x) => x.id === t.id ? {...x, done:false} : x))} style={S.chk}>☑</button>
                    <div style={{flex:1}}><div style={{fontSize:14,textDecoration:"line-through"}}>{t.title}</div></div>
                    <button onClick={() => setTasks((p) => p.filter((x) => x.id !== t.id))} style={S.del}>✕</button>
                  </div>
                ))}
                <button onClick={() => setTasks((p) => p.filter((t) => !t.done))} style={S.clrDone}>Clear completed</button>
              </div>
            )}
          </div>
        )}

        {/* ── INBOX ── */}
        {tab === "inbox" && (
          <div style={S.anim}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={S.secTitle}>Unread Work Emails</div>
              <button onClick={() => { const t = localStorage.getItem("mary-google-token"); if (t) fetchGmailEmails(t).then(setInboxEmails).catch(()=>{}); }} style={S.refreshBtn}>↻ Refresh</button>
            </div>
            {!googleToken && <div style={S.empty}><div style={{fontSize:32,marginBottom:8,opacity:0.3}}>📧</div><div style={{fontSize:16,fontWeight:600}}>Google not connected</div><div style={{fontSize:13,marginTop:4,color:"#7a96bc"}}>Connect Google to see your inbox</div></div>}
            {googleToken && !inboxEmails.length && <div style={S.empty}><div style={{fontSize:32,marginBottom:8,opacity:0.3}}>📭</div><div style={{fontSize:16,fontWeight:600}}>Inbox clear</div><div style={{fontSize:13,marginTop:4,color:"#7a96bc"}}>No unread work emails</div></div>}
            {inboxEmails.map((email, i) => (
              <div key={i} style={{...S.card, marginBottom:10}}>
                <div style={{fontSize:12,color:"#00dba8",fontWeight:600,marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{email.from?.replace(/<.*>/, "").trim()}</div>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>{email.subject}</div>
                <div style={{fontSize:12,color:"#7a96bc",lineHeight:1.5,marginBottom:10}}>{email.snippet}</div>
                {replyingTo === i ? (
                  <div>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write your reply..."
                      style={{width:"100%",background:"#071428",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#fff",fontSize:13,padding:"8px 10px",fontFamily:"'Plus Jakarta Sans',sans-serif",resize:"vertical",minHeight:80,outline:"none",boxSizing:"border-box"}}
                    />
                    <div style={{display:"flex",gap:8,marginTop:8}}>
                      <button disabled={replySending || !replyText.trim()} onClick={async () => {
                        const t = localStorage.getItem("mary-google-token");
                        if (!t || !replyText.trim()) return;
                        setReplySending(true);
                        try {
                          await replyToGmail(t, { threadId: email.threadId, messageId: email.messageId, to: email.from, subject: email.subject, body: replyText });
                          setReplyingTo(null); setReplyText("");
                          setInboxEmails(p => p.filter((_, idx) => idx !== i));
                        } catch { alert("Failed to send reply"); }
                        setReplySending(false);
                      }} style={{...S.gcBtn, flex:1}}>{replySending ? "Sending..." : "Send Reply"}</button>
                      <button onClick={() => { setReplyingTo(null); setReplyText(""); }} style={{...S.gcBtn, background:"rgba(255,255,255,0.04)", color:"#7a96bc", border:"1px solid rgba(255,255,255,0.08)"}}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={() => { setReplyingTo(i); setReplyText(""); }} style={{...S.gcBtn, fontSize:11, padding:"5px 12px"}}>↩ Reply</button>
                    <button onClick={() => { setTab("chat"); setTimeout(() => { setInput(`Draft a reply to ${email.from?.replace(/<.*>/, "").trim()} about: "${email.subject}"`); inputRef.current?.focus(); }, 100); }} style={{...S.gcBtn, fontSize:11, padding:"5px 12px", background:"rgba(56,170,255,0.15)", color:"#38aaff"}}>✦ Ask Mary</button>
                    <button onClick={() => setInboxEmails(p => p.filter((_, idx) => idx !== i))} style={{...S.gcBtn, fontSize:11, padding:"5px 12px", background:"rgba(255,255,255,0.04)", color:"#7a96bc", border:"1px solid rgba(255,255,255,0.08)", marginLeft:"auto"}}>✕ Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── REMINDERS ── */}
        {tab === "reminders" && (
          <div style={S.anim}>
            <div style={S.hint}>Tell Mary in chat to set reminders, e.g. <em>"Remind me at 3pm to call Sarah"</em></div>
            {!pending.length && !reminders.filter((r) => r.fired).length && <div style={S.empty}><div style={{fontSize:32,marginBottom:8,opacity:0.3}}>🔔</div><div style={{fontSize:16,fontWeight:600}}>No reminders</div><div style={{fontSize:13,marginTop:4,color:"#7a96bc"}}>Ask Mary to set one in chat</div></div>}
            {pending.length > 0 && (
              <div style={{marginBottom:20}}>
                <div style={S.secTitle}>Pending ({pending.length})</div>
                {pending.map((r) => (
                  <div key={r.id} style={S.tItem}>
                    <span style={{fontSize:16}}>⏰</span>
                    <div style={{flex:1}}><div style={{fontSize:14,fontWeight:500}}>{r.title}</div><div style={{fontSize:12,color:"#7a96bc",marginTop:2}}>{formatDateTime(r.time)}</div></div>
                    <button onClick={() => setReminders((p) => p.filter((x) => x.id !== r.id))} style={S.del}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {reminders.filter((r) => r.fired).length > 0 && (
              <div>
                <div style={S.secTitle}>Fired</div>
                {reminders.filter((r) => r.fired).map((r) => (
                  <div key={r.id} style={{...S.tItem,opacity:0.4}}>
                    <span>✓</span>
                    <div style={{flex:1}}><div style={{fontSize:14}}>{r.title}</div><div style={{fontSize:12,color:"#7a96bc"}}>{formatDateTime(r.time)}</div></div>
                    <button onClick={() => setReminders((p) => p.filter((x) => x.id !== r.id))} style={S.del}>✕</button>
                  </div>
                ))}
                <button onClick={() => setReminders((p) => p.filter((r) => !r.fired))} style={S.clrDone}>Clear fired</button>
              </div>
            )}
            {notifPerm !== "granted" && (
              <div style={{...S.card,marginTop:16,borderColor:"rgba(0,219,168,0.25)"}}>
                <div style={{fontSize:13,fontWeight:600,color:"#00dba8"}}>⚠️ Notifications not enabled</div>
                <div style={{fontSize:12,color:"#7a96bc",marginBottom:10}}>Enable to receive push alerts for your reminders.</div>
                <button onClick={enableNotif} style={S.qBtn}>Enable Notifications</button>
              </div>
            )}
          </div>
        )}

        {/* ── CHAT ── */}
        {tab === "chat" && (
          <div style={S.chatWrap}>
            {/* ── Scrollable messages — fully independent ── */}
            <div style={S.chatScroll}>
              {!chat.length && (
                <div style={S.chatEmpty}>
                  <div style={{...gradText, fontSize: 28, fontWeight: 800, letterSpacing: "-1px", marginBottom: 4}}>Mary</div>
                  <div style={{fontSize:13,lineHeight:1.5,marginBottom:16,color:"#7a96bc"}}>Ask about your schedule, send emails, set reminders, manage tasks — naturally.</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {["What's on my calendar today?","Remind me at 3pm to call the client","Send an email to my team about Friday's meeting","Check my inbox for anything from Finoveo","Do I have any conflicts this week?"].map((s) => (
                      <button key={s} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 100); }} style={S.sug}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} style={m.role === "user" ? S.uMsg : S.aMsg}>
                  {m.role === "assistant" && <div style={S.av}><div style={{width:7,height:7,borderRadius:"50%",background:"#00f5c0",boxShadow:"0 0 8px #00f5c0"}} /></div>}
                  {m.role === "user"
                    ? <div style={S.uBub}>{m.text}</div>
                    : <MarkdownText text={m.text} style={S.aBub} />}
                </div>
              ))}
              {loading && (
                <div style={S.aMsg}><div style={S.av}><div style={{width:7,height:7,borderRadius:"50%",background:"#00f5c0",boxShadow:"0 0 8px #00f5c0"}} /></div><div style={S.aBub}>
                  <span style={{display:"inline-flex",gap:4}}>
                    <span style={S.dot}>●</span><span style={{...S.dot,animationDelay:"0.2s"}}>●</span><span style={{...S.dot,animationDelay:"0.4s"}}>●</span>
                  </span>
                </div></div>
              )}
              <div ref={chatEnd} />
            </div>

            {/* ── Input toolbar — pinned to bottom, never scrolls ── */}
            <div style={S.chatBottom}>
              <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic" style={{display:"none"}} onChange={handleFileUpload} />
              {showAttachMenu && (
                <div style={S.attachMenu} onMouseLeave={() => {}}>
                  <button onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }} style={S.attachOpt}>
                    <span style={{fontSize:18}}>📎</span>
                    <div><div style={{fontWeight:600,fontSize:13}}>Upload File</div><div style={{fontSize:11,color:"#7a96bc"}}>CSV, Excel, PDF, or Image</div></div>
                  </button>
                  <button onClick={openDrivePicker} style={S.attachOpt}>
                    <span style={{fontSize:18}}>📊</span>
                    <div><div style={{fontWeight:600,fontSize:13}}>Google Drive Sheet</div><div style={{fontSize:11,color:"#7a96bc"}}>Pick an existing spreadsheet</div></div>
                  </button>
                </div>
              )}
              {attachedFile && (
                <div style={S.fileChip}>
                  {attachedFile.type === "image" && attachedFile.previewUrl
                    ? <img src={attachedFile.previewUrl} alt="" style={{width:36,height:36,borderRadius:6,objectFit:"cover",flexShrink:0}} />
                    : <span style={{fontSize:14}}>{attachedFile.type === "pdf" ? "📕" : attachedFile.name.endsWith(".xlsx") || attachedFile.name.endsWith(".xls") ? "📊" : "📄"}</span>
                  }
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{attachedFile.name}</div>
                    <div style={{fontSize:11,color:"#7a96bc"}}>{attachedFile.type === "pdf" ? "PDF — ready to read" : attachedFile.type === "image" ? "Image — Mary can see this" : `${attachedFile.rows} rows`}</div>
                  </div>
                  <button onClick={() => setAttachedFile(null)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:14,padding:4}}>✕</button>
                </div>
              )}
              {chat.length > 0 && (
                <div style={{display:"flex",justifyContent:"center",padding:"2px 16px 0"}}>
                  <button onClick={() => { setChat([]); saveData("mary-chat", []); }} style={{fontSize:11,color:"rgba(255,255,255,0.18)",background:"none",border:"none",cursor:"pointer",fontFamily:"'Plus Jakarta Sans',sans-serif",letterSpacing:"0.3px"}}>✕ New chat</button>
                </div>
              )}
              <div style={S.chatBar}>
                <button onClick={() => setShowAttachMenu((p) => !p)} style={{...S.sendBtn, background: showAttachMenu ? "rgba(52,168,83,0.2)" : "rgba(255,255,255,0.06)", color: showAttachMenu ? "#34a853" : "#7a96bc", boxShadow:"none", fontSize:16}} title="Attach file">📎</button>
                <button onClick={startListening} style={{...S.sendBtn, background: isListening ? "#ef4444" : "rgba(255,255,255,0.06)", color: isListening ? "#fff" : "#7a96bc", boxShadow:"none", fontSize:16}} title="Voice input">🎤</button>
                <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); setShowAttachMenu(false); }} placeholder={isListening ? "Listening..." : attachedFile ? `Tell Mary what to do with ${attachedFile.name}...` : "Ask Mary anything..."} style={{...S.chatIn, borderColor: isListening ? "rgba(239,68,68,0.4)" : attachedFile ? "rgba(52,168,83,0.4)" : "rgba(255,255,255,0.10)"}} />
                <button onClick={sendMessage} disabled={!input.trim() || loading} style={S.sendBtn}>↑</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Drive Sheet Picker Overlay */}
      {showDrivePicker && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowDrivePicker(false); }}>
          <div style={S.pickerSheet}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:700}}>📊 Google Drive Sheets</div>
                <div style={{fontSize:12,color:"#7a96bc",marginTop:2}}>Tap a sheet to load it into chat</div>
              </div>
              <button onClick={() => setShowDrivePicker(false)} style={{background:"none",border:"none",color:"#7a96bc",cursor:"pointer",fontSize:20,padding:4}}>✕</button>
            </div>
            {driveLoading && (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {[1,2,3,4].map((i) => <div key={i} style={{...S.skel,height:52,borderRadius:12}} />)}
              </div>
            )}
            {!driveLoading && driveError && (
              <div style={{textAlign:"center",padding:"24px 16px",color:"#7a96bc"}}>
                {driveError === "no_token" ? (
                  <>
                    <div style={{fontSize:32,marginBottom:8}}>🔗</div>
                    <div style={{fontWeight:600,color:"#fff",marginBottom:6}}>Google not connected</div>
                    <div style={{fontSize:12,marginBottom:16}}>Connect Google to access your Drive sheets</div>
                    <button onClick={() => { setShowDrivePicker(false); connectGoogle(); }} style={{background:"linear-gradient(90deg,#00f5c0,#38aaff)",border:"none",color:"#071428",fontWeight:700,fontSize:13,padding:"8px 20px",borderRadius:8,cursor:"pointer"}}>Connect Google</button>
                  </>
                ) : driveError.startsWith("drive_403") ? (
                  <>
                    <div style={{fontSize:32,marginBottom:8}}>🔒</div>
                    <div style={{fontWeight:600,color:"#fff",marginBottom:6}}>Drive access blocked</div>
                    <div style={{fontSize:12,marginBottom:8}}>Your token doesn't have Drive permission. Reconnect Google to fix this.</div>
                    <div style={{fontSize:11,color:"#4a6080",marginBottom:16,fontFamily:"monospace"}}>{driveError}</div>
                    <button onClick={() => { setShowDrivePicker(false); setDriveSheets([]); setDriveError(null); connectGoogle(); }} style={{background:"linear-gradient(90deg,#00f5c0,#38aaff)",border:"none",color:"#071428",fontWeight:700,fontSize:13,padding:"8px 20px",borderRadius:8,cursor:"pointer"}}>Reconnect Google</button>
                  </>
                ) : driveError === "token_expired" ? (
                  <>
                    <div style={{fontSize:32,marginBottom:8}}>⏱</div>
                    <div style={{fontWeight:600,color:"#fff",marginBottom:6}}>Session expired</div>
                    <div style={{fontSize:12,marginBottom:16}}>Your Google session expired. Reconnect to refresh it.</div>
                    <button onClick={() => { setShowDrivePicker(false); setDriveSheets([]); setDriveError(null); connectGoogle(); }} style={{background:"linear-gradient(90deg,#00f5c0,#38aaff)",border:"none",color:"#071428",fontWeight:700,fontSize:13,padding:"8px 20px",borderRadius:8,cursor:"pointer"}}>Reconnect Google</button>
                  </>
                ) : driveError === "empty" ? (
                  <>
                    <div style={{fontSize:32,marginBottom:8}}>📭</div>
                    <div style={{fontWeight:600,color:"#fff",marginBottom:6}}>No sheets found</div>
                    <div style={{fontSize:12}}>No Google Sheets in your Drive yet, or they may be in a shared drive.</div>
                  </>
                ) : (
                  <>
                    <div style={{fontSize:32,marginBottom:8}}>⚠️</div>
                    <div style={{fontWeight:600,color:"#fff",marginBottom:6}}>Couldn't load sheets</div>
                    <div style={{fontSize:11,color:"#4a6080",marginBottom:16,fontFamily:"monospace"}}>{driveError}</div>
                    <button onClick={() => { setDriveSheets([]); setDriveError(null); openDrivePicker(); }} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"#fff",fontWeight:600,fontSize:13,padding:"8px 20px",borderRadius:8,cursor:"pointer"}}>Try Again</button>
                  </>
                )}
              </div>
            )}
            {!driveLoading && driveSheets.map((sheet) => (
              <button key={sheet.id} onClick={() => loadDriveSheet(sheet)} style={S.sheetRow}>
                <span style={{fontSize:20}}>📗</span>
                <div style={{flex:1,minWidth:0,textAlign:"left"}}>
                  <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sheet.name}</div>
                  <div style={{fontSize:11,color:"#7a96bc",marginTop:2}}>
                    Modified {new Date(sheet.modifiedTime).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  </div>
                </div>
                <span style={{fontSize:12,color:"#00f5c0",fontWeight:600}}>Load →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <nav style={S.bottomNav}>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{...S.navBtn, ...(tab===t.k?S.navBtnOn:{})}}>
            <div style={{position:"relative",display:"inline-block"}}>
              <span style={{fontSize:18,lineHeight:1}}>{t.icon}</span>
              {t.badge > 0 && <span style={S.badge}>{t.badge}</span>}
            </div>
            <span style={S.navLbl}>{t.label}</span>
            {tab===t.k && <div style={S.navDot}/>}
          </button>
        ))}
      </nav>

      {/* Floating Ask Mary button — shown on all tabs except chat */}
      {tab !== "chat" && (
        <button onClick={() => setTab("chat")} style={S.fab}>
          <span style={{fontSize:20}}>✦</span>
        </button>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes dotPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes livePulse { 0%, 100% { opacity: 1; box-shadow: 0 0 6px #00f5c0; } 50% { opacity: 0.5; box-shadow: 0 0 2px #00f5c0; } }
        @keyframes blobMove { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(30px,-20px) scale(1.05); } 66% { transform: translate(-20px,15px) scale(0.97); } }
        @keyframes fabPulse { 0%,100% { box-shadow: 0 4px 24px rgba(0,219,168,0.4); } 50% { box-shadow: 0 4px 36px rgba(0,219,168,0.7); } }
        @keyframes taskDone { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>
    </div>
  );
}

const S = {
  // Root & background
  root: { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif", background: "#060e1e", color: "#ffffff", height: "100dvh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" },
  blob1: { position: "fixed", top: -120, left: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,219,168,0.12) 0%, transparent 70%)", animation: "blobMove 12s ease-in-out infinite", pointerEvents: "none", zIndex: 0 },
  blob2: { position: "fixed", top: 200, right: -100, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,170,255,0.10) 0%, transparent 70%)", animation: "blobMove 15s ease-in-out infinite reverse", pointerEvents: "none", zIndex: 0 },
  blob3: { position: "fixed", bottom: 100, left: 60, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(167,139,250,0.08) 0%, transparent 70%)", animation: "blobMove 18s ease-in-out infinite", pointerEvents: "none", zIndex: 0 },
  // Notif banner
  notifBanner: { background: "rgba(0,219,168,0.06)", borderBottom: "1px solid rgba(0,219,168,0.12)", padding: "10px 16px", position: "relative", zIndex: 10 },
  notifRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  notifTitle: { fontSize: 12, fontWeight: 600, color: "#00f5c0" },
  notifDesc: { fontSize: 11, color: "#7a96bc" },
  notifBtn: { padding: "5px 14px", background: "#00dba8", color: "#071428", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", whiteSpace: "nowrap" },
  // Header
  header: { padding: "20px 20px 12px", background: "rgba(6,14,30,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)", position: "relative", zIndex: 10 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 28, fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1 },
  dateLbl: { fontSize: 11, color: "#7a96bc", marginTop: 3, fontWeight: 400 },
  greet: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 400, textAlign: "right" },
  poweredBy: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 10, color: "#7a96bc", fontWeight: 400 },
  liveDot: { width: 6, height: 6, borderRadius: "50%", background: "#00f5c0", boxShadow: "0 0 8px #00f5c0", animation: "livePulse 2s ease-in-out infinite" },
  // Main
  main: { flex: 1, padding: "16px 16px 100px", overflowY: "auto", position: "relative", zIndex: 1 },
  anim: { animation: "slideUp 0.3s cubic-bezier(0.16,1,0.3,1)" },
  // Cards — glassmorphism
  card: { background: "rgba(16,31,58,0.7)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: 16, padding: 16, marginBottom: 12, border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" },
  cHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  headDot: { width: 7, height: 7, borderRadius: "50%", background: "#00dba8", boxShadow: "0 0 8px #00dba8", flexShrink: 0 },
  cTitle: { fontSize: 10, fontWeight: 700, flex: 1, textTransform: "uppercase", letterSpacing: "2px", color: "rgba(255,255,255,0.5)" },
  seeAll: { background: "none", border: "none", color: "#00f5c0", fontSize: 11, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 },
  refreshBtn: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#7a96bc", fontSize: 10, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500, padding: "4px 10px" },
  tomorrowCard: { background: "rgba(26,57,120,0.3)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: 16, padding: 16, marginBottom: 12, border: "1px solid rgba(56,170,255,0.12)", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" },
  bText: { fontSize: 14, lineHeight: 1.85, color: "rgba(255,255,255,0.75)", fontWeight: 300, letterSpacing: "0.1px" },
  // Bible verse — more ornate
  verseCard: { background: "linear-gradient(135deg, rgba(0,219,168,0.08), rgba(56,170,255,0.05))", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: 20, padding: "24px 20px", marginBottom: 12, border: "1px solid rgba(0,245,192,0.15)", position: "relative", overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" },
  verseMark: { position: "absolute", top: -10, left: 12, fontSize: 80, opacity: 0.05, color: "#00f5c0", lineHeight: 1, fontFamily: "Georgia, serif", pointerEvents: "none" },
  verseText: { fontSize: 16, lineHeight: 1.75, color: "rgba(255,255,255,0.9)", fontWeight: 300, fontStyle: "italic", marginBottom: 14, fontFamily: "Georgia, serif", position: "relative" },
  verseFooter: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  verseRef: { fontSize: 12, fontWeight: 700, color: "#00dba8", letterSpacing: "0.5px" },
  shareBtn: { padding: "5px 14px", background: "rgba(0,219,168,0.1)", border: "1px solid rgba(0,219,168,0.25)", borderRadius: 8, color: "#00f5c0", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" },
  skelWrap: { display: "flex", flexDirection: "column", gap: 8 },
  skel: { height: 13, background: "rgba(255,255,255,0.05)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" },
  // Events
  evItem: { display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  evTime: { fontSize: 12, fontWeight: 600, color: "#00f5c0", minWidth: 65, paddingTop: 2, fontFamily: "'DM Mono', monospace" },
  evInfo: { flex: 1 },
  evTitle: { fontSize: 14, fontWeight: 500 },
  evLoc: { fontSize: 12, color: "#7a96bc", marginTop: 2 },
  durPill: { fontSize: 10, fontWeight: 600, color: "#38aaff", background: "rgba(56,170,255,0.12)", border: "1px solid rgba(56,170,255,0.2)", borderRadius: 20, padding: "1px 7px", flexShrink: 0 },
  // Mini tasks
  mini: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0" },
  pDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  miniT: { fontSize: 13, flex: 1, fontWeight: 400 },
  miniD: { fontSize: 11, color: "#7a96bc", fontFamily: "'DM Mono', monospace" },
  // Quick actions
  qActions: { display: "flex", gap: 8, marginTop: 8 },
  qBtn: { flex: 1, padding: "13px 16px", background: "linear-gradient(135deg, #00dba8, #0099a8)", color: "#071428", border: "none", borderRadius: 14, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: "0 4px 20px rgba(0,219,168,0.35)" },
  qBtn2: { flex: 1, padding: "13px 16px", background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" },
  // Tasks
  addRow: { display: "flex", gap: 8, marginBottom: 16 },
  addIn: { flex: 1, padding: "11px 14px", background: "rgba(16,31,58,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, color: "#fff", fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", outline: "none", fontWeight: 300 },
  addBtn: { width: 42, height: 42, background: "linear-gradient(135deg,#00dba8,#0099a8)", color: "#071428", border: "none", borderRadius: 12, fontSize: 22, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,219,168,0.35)" },
  empty: { textAlign: "center", padding: "48px 20px", color: "rgba(255,255,255,0.4)" },
  secTitle: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px", color: "#00dba8", marginBottom: 10 },
  tItem: { display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  chk: { background: "none", border: "none", color: "#00dba8", fontSize: 20, cursor: "pointer", padding: 0, lineHeight: 1 },
  del: { background: "none", border: "none", color: "rgba(255,255,255,0.15)", fontSize: 14, cursor: "pointer", padding: 4 },
  clrDone: { background: "none", border: "none", color: "#7a96bc", fontSize: 11, cursor: "pointer", marginTop: 8, fontFamily: "'Plus Jakarta Sans', sans-serif", textDecoration: "underline" },
  hint: { fontSize: 12, color: "#7a96bc", padding: "8px 0 16px", lineHeight: 1.5, borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 16 },
  // Chat
  chatWrap: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  chatScroll: { flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", padding: "12px 16px 8px" },
  chatBottom: { flexShrink: 0, background: "rgba(6,14,30,0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.05)" },
  chatEmpty: { textAlign: "center", padding: "24px 8px" },
  sug: { padding: "10px 14px", background: "rgba(16,31,58,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, color: "rgba(255,255,255,0.6)", fontSize: 13, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", textAlign: "left", fontWeight: 400 },
  uMsg: { display: "flex", justifyContent: "flex-end", marginBottom: 12 },
  aMsg: { display: "flex", justifyContent: "flex-start", gap: 8, marginBottom: 12, alignItems: "flex-start" },
  av: { marginTop: 8, flexShrink: 0 },
  uBub: { background: "linear-gradient(135deg, #00dba8, #1a6ee0)", color: "#fff", padding: "10px 14px", borderRadius: "18px 18px 4px 18px", fontSize: 14, maxWidth: "78%", lineHeight: 1.55, fontWeight: 500, wordBreak: "break-word", overflowWrap: "anywhere" },
  aBub: { background: "rgba(16,31,58,0.85)", backdropFilter: "blur(12px)", color: "rgba(255,255,255,0.85)", padding: "11px 14px", borderRadius: "18px 18px 18px 4px", fontSize: 14, maxWidth: "82%", lineHeight: 1.6, fontWeight: 300, border: "1px solid rgba(255,255,255,0.07)", wordBreak: "break-word", overflowWrap: "anywhere" },
  dot: { animation: "dotPulse 1s ease-in-out infinite", fontSize: 10, color: "#00dba8" },
  chatBar: { display: "flex", gap: 8, padding: "10px 16px 12px", flexShrink: 0 },
  chatIn: { flex: 1, padding: "10px 14px", background: "rgba(16,31,58,0.8)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, color: "#fff", fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", outline: "none", fontWeight: 300 },
  sendBtn: { width: 42, height: 42, background: "linear-gradient(135deg,#00dba8,#1a6ee0)", color: "#fff", border: "none", borderRadius: 14, fontSize: 18, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,219,168,0.3)" },
  // Google
  gcBanner: { display: "flex", alignItems: "center", gap: 12, background: "rgba(56,170,255,0.06)", border: "1px solid rgba(56,170,255,0.15)", borderRadius: 14, padding: "12px 14px", marginBottom: 12 },
  gcBtn: { padding: "6px 14px", background: "#38aaff", color: "#071428", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", whiteSpace: "nowrap" },
  // Attach menu & file chip
  attachMenu: { background: "rgba(16,31,58,0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderTop: "1px solid rgba(255,255,255,0.08)", padding: "8px 8px 0", animation: "slideUp 0.2s ease" },
  attachOpt: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", background: "none", border: "none", color: "#fff", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", borderRadius: 12, textAlign: "left", transition: "background 0.15s" },
  fileChip: { display: "flex", alignItems: "center", gap: 10, background: "rgba(52,168,83,0.12)", border: "1px solid rgba(52,168,83,0.3)", borderRadius: 12, padding: "8px 12px", margin: "0 0 6px", animation: "slideUp 0.2s ease" },
  // Drive picker overlay
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 300, display: "flex", alignItems: "flex-end" },
  pickerSheet: { background: "rgba(10,20,42,0.98)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", width: "100%", maxHeight: "70vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 -8px 48px rgba(0,0,0,0.5)" },
  sheetRow: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, marginBottom: 8, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#fff", transition: "background 0.15s" },
  // Bottom nav
  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, display: "flex", background: "rgba(6,14,30,0.92)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderTop: "1px solid rgba(255,255,255,0.07)", padding: "6px 0 env(safe-area-inset-bottom,6px)", zIndex: 100 },
  navBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 0", background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", position: "relative", transition: "color .2s ease" },
  navBtnOn: { color: "#00f5c0" },
  navLbl: { fontSize: 9, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" },
  navDot: { position: "absolute", bottom: -2, width: 4, height: 4, borderRadius: "50%", background: "#00f5c0", boxShadow: "0 0 6px #00f5c0" },
  badge: { position: "absolute", top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 8, background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" },
  // Floating button
  fab: { position: "fixed", bottom: 76, right: "calc(50% - 228px)", width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,#00dba8,#1a6ee0)", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(0,219,168,0.5)", animation: "fabPulse 3s ease-in-out infinite", zIndex: 99 },
};

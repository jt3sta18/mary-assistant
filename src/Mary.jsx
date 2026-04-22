import { useState, useEffect, useRef, useCallback } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

const SYSTEM_PROMPT = `You are Mary, a sharp personal assistant built by Finoveo. You help the user stay organized by managing their calendar, tasks, and email.

Calendar events from Google Calendar will be provided directly in the conversation context when available. Use them to answer scheduling questions.

CAPABILITIES:
- CALENDAR: Analyze provided calendar events, spot conflicts, find free time, list upcoming meetings.
- TASKS: Create, complete, and manage the user's task list.
- REMINDERS: Set timed push notifications.
- EMAIL: Help draft emails and provide communication advice.

RULES:
- When calendar events are provided in the message, use them to answer scheduling questions accurately.
- When asked to remind them of something, create a reminder with a specific time.
- Be concise and actionable. No fluff.
- Format dates clearly (e.g., "Tuesday, April 28 at 2:00 PM").
- If you spot conflicts in their calendar, flag them immediately.
- Always respond in JSON format with this exact structure:
{
  "message": "Your response text here",
  "tasks_to_add": [{"title": "task name", "due": "ISO date string or null", "priority": "high|medium|low"}],
  "tasks_to_complete": ["task title to mark done"],
  "calendar_events": [{"title": "event name", "start": "ISO datetime", "end": "ISO datetime", "location": "optional"}],
  "reminders": [{"title": "reminder text", "time": "ISO datetime string for when to fire the notification"}],
  "bible_verse": {"text": "The verse text", "reference": "Book Chapter:Verse"},
  "send_email": {"to": "recipient@email.com", "subject": "Email subject", "body": "Full email body text"}
}

Only include fields that are relevant. "message" is always required. Others are optional.
When the user asks you to send an email, compose it and include a "send_email" field with the to, subject, and body. The system will send it automatically — confirm in your message that you're sending it.
When the daily briefing is requested, ALWAYS include a "bible_verse" field with an inspiring verse for the day. Choose a different verse each day — draw from the full Catholic and Orthodox biblical canon, including the Deuterocanonical books (Sirach, Wisdom, Tobit, Judith, Baruch, 1 & 2 Maccabees). Vary across the Psalms, Proverbs, Gospels, Epistles, Old Testament prophets, and Deuterocanonical wisdom literature. Stay faithful to Catholic and Orthodox tradition. The user's faith is deeply important to them.
When calendar events are provided, include the relevant ones in calendar_events in your response.
When the user asks you to remind them at a specific time, include a "reminders" entry with the exact ISO datetime.
If they say something vague like "remind me tomorrow morning", interpret that as 9:00 AM the next day.
If they say "remind me in 30 minutes", calculate the exact time from now.
Today's date and time is ${new Date().toISOString()}.
The current timezone offset is ${new Date().getTimezoneOffset()} minutes from UTC.`;

async function callClaude(messages) {
  const body = { model: "claude-sonnet-4-5", max_tokens: 1500, system: SYSTEM_PROMPT, messages };
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
    messages.slice(0, 5).map(async (m) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const d = await r.json();
      const headers = d.payload?.headers || [];
      const get = (name) => headers.find((h) => h.name === name)?.value || "";
      return { from: get("From"), subject: get("Subject"), date: get("Date"), snippet: d.snippet };
    })
  );
  return details;
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

async function loadData(key, fallback) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : fallback; } catch { return fallback; }
}
async function saveData(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); } catch {}
}

function fireNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body, vibrate: [200, 100, 200], requireInteraction: true, tag: "mary-" + Date.now() });
      setTimeout(() => n.close(), 30000);
    } catch {}
  }
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
  const tokenClientRef = useRef(null);
  const chatEnd = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      setTasks(await loadData("mary-tasks", []));
      setChat(await loadData("mary-chat", []));
      setReminders(await loadData("mary-reminders", []));
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
    })();
    if ("Notification" in window) setNotifPerm(Notification.permission);

    // Load stored Google token
    const storedToken = localStorage.getItem("mary-google-token");
    const tokenExpiry = localStorage.getItem("mary-google-token-expiry");
    if (storedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
      setGoogleToken(storedToken);
    } else {
      localStorage.removeItem("mary-google-token");
      localStorage.removeItem("mary-google-token-expiry");
    }
  }, []);

  // Initialize Google Identity Services
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (response) => {
          if (response.error) return;
          const expiry = Date.now() + response.expires_in * 1000;
          setGoogleToken(response.access_token);
          localStorage.setItem("mary-google-token", response.access_token);
          localStorage.setItem("mary-google-token-expiry", expiry.toString());
          setGoogleLoading(false);
        },
      });
    };
    document.head.appendChild(script);
    return () => { if (script.parentNode) script.parentNode.removeChild(script); };
  }, []);

  const connectGoogle = useCallback(() => {
    if (!tokenClientRef.current) return;
    setGoogleLoading(true);
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
          } else {
            calendarContext = "\n\nGoogle Calendar shows no events for today or tomorrow.";
          }
          if (emails.length > 0) {
            gmailContext = `\n\nUnread work emails from the last 2 days:\n${JSON.stringify(emails, null, 2)}`;
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
      const briefingMsg = `Give me my daily briefing. ${hasGoogle ? "I've provided my calendar events and unread emails above — summarize them. Flag any conflicts, back-to-back meetings, or emails that need action." : "I haven't connected Google yet, so skip the calendar and email sections."} Include a daily Bible verse from the Catholic/Orthodox tradition — feel free to draw from the Deuterocanonical books too. Keep it concise.`;

      const text = await callClaude([{ role: "user", content: briefingMsg + calendarContext + gmailContext }]);
      const p = parseResponse(text);
      setBriefing(p.message || text);
      if (p.calendar_events?.length) setEvents(p.calendar_events);
      if (p.bible_verse) setVerse(p.bible_verse);
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
        fireNotification("☀ Good morning", "Your daily briefing is ready in Mary.");
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
    }, 30000);
    return () => clearInterval(iv);
  }, [fired, tomorrowPreview, tomorrowLoading, fetchTomorrow]);

  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      reminders.forEach((r) => {
        if (r.fired || fired.has(r.id)) return;
        if (new Date(r.time) <= now) {
          fireNotification("⏰ Mary Reminder", r.title);
          setFired((p) => new Set([...p, r.id]));
          setReminders((p) => p.map((x) => (x.id === r.id ? { ...x, fired: true } : x)));
        }
      });
      events.forEach((ev) => {
        const diff = (new Date(ev.start) - now) / 60000;
        const k = "cal-" + ev.start;
        if (diff > 0 && diff <= 10 && !fired.has(k)) {
          fireNotification("📅 " + ev.title + " in " + Math.round(diff) + " min", ev.location || "");
          setFired((p) => new Set([...p, k]));
        }
      });
    }, 30000);
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

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    const updated = [...chat, { role: "user", text: msg, ts: Date.now() }];
    setChat(updated);
    setInput("");
    setLoading(true);
    try {
      const apiMsgs = updated.slice(-10).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const open = tasks.filter((t) => !t.done);
      const pending = reminders.filter((r) => !r.fired);
      let ctx = "";
      if (open.length) ctx += "\nOpen tasks: " + open.map((t) => '"' + t.title + '" (' + t.priority + ", due: " + (t.due || "none") + ")").join(", ");
      if (pending.length) ctx += "\nPending reminders: " + pending.map((r) => '"' + r.title + '" at ' + r.time).join(", ");
      if (!open.length && !pending.length) ctx += "\nNo open tasks or reminders.";
      apiMsgs[apiMsgs.length - 1].content += ctx;
      // Attach live Google context when relevant
      const calToken = localStorage.getItem("mary-google-token");
      const calExpiry = localStorage.getItem("mary-google-token-expiry");
      if (calToken && calExpiry && Date.now() < parseInt(calExpiry)) {
        const msgLower = msg.toLowerCase();
        const needsCalendar = ["calendar", "schedule", "meeting", "event", "appointment", "today", "tomorrow", "week"].some((k) => msgLower.includes(k));
        const needsEmail = ["email", "inbox", "gmail", "mail", "message", "unread"].some((k) => msgLower.includes(k));
        try {
          const [calEvents, emails] = await Promise.all([
            needsCalendar ? fetchCalendarEvents(calToken, 3).catch(() => []) : Promise.resolve([]),
            needsEmail ? fetchGmailEmails(calToken).catch(() => []) : Promise.resolve([]),
          ]);
          let extra = "";
          if (calEvents.length > 0) extra += `\n\nGoogle Calendar events (next 3 days):\n${JSON.stringify(calEvents, null, 2)}`;
          if (emails.length > 0) extra += `\n\nUnread work emails:\n${JSON.stringify(emails, null, 2)}`;
          if (extra) {
            const last = apiMsgs[apiMsgs.length - 1];
            apiMsgs[apiMsgs.length - 1] = { ...last, content: last.content + extra };
          }
        } catch {}
      }

      const text = await callClaude(apiMsgs);
      const parsed = parseResponse(text);
      if (parsed.tasks_to_add) parsed.tasks_to_add.forEach((t) => addTask(t.title, t.due, t.priority || "medium"));
      if (parsed.tasks_to_complete) setTasks((p) => p.map((t) => parsed.tasks_to_complete.some((tc) => t.title.toLowerCase().includes(tc.toLowerCase())) ? { ...t, done: true } : t));
      if (parsed.calendar_events?.length) setEvents(parsed.calendar_events);
      if (parsed.reminders) parsed.reminders.forEach((r) => addReminder(r.title, r.time));
      if (parsed.bible_verse) setVerse(parsed.bible_verse);

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

      setChat((p) => [...p, { role: "assistant", text: (parsed.message || text) + emailNote, ts: Date.now() }]);
    } catch {
      setChat((p) => [...p, { role: "assistant", text: "Something went wrong. Try again.", ts: Date.now() }]);
    }
    setLoading(false);
  };

  const now = new Date();
  const greet = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);
  const pending = reminders.filter((r) => !r.fired);

  // Gradient text helper
  const gradText = { background: "linear-gradient(90deg, #00f5c0, #38aaff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Notification Banner */}
      {notifPerm !== "granted" && (
        <div style={S.notifBanner}>
          <div style={S.notifRow}>
            <div><div style={S.notifTitle}>🔔 Enable push notifications</div><div style={S.notifDesc}>Get alerts for reminders & upcoming meetings</div></div>
            <button onClick={enableNotif} style={S.notifBtn}>Enable</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={S.header}>
        <div style={S.headerRow}>
          <div>
            <div style={S.logo}><span style={gradText}>Mary</span></div>
            <div style={S.dateLbl}>{dateStr}</div>
          </div>
          <div style={S.greet}>{greet}</div>
        </div>
        <div style={S.poweredBy}>
          <div style={S.liveDot} />
          <span>powered by <span style={{ color: "#00f5c0", fontWeight: 600 }}>finoveo</span></span>
          {googleToken && <span style={{marginLeft:"auto",fontSize:10,color:"#7a96bc",cursor:"pointer"}} onClick={disconnectGoogle}>✓ Google · disconnect</span>}
        </div>
      </header>

      {/* Tab Bar */}
      <nav style={S.tabBar}>
        {[
          { k: "today", l: "Today" },
          { k: "tasks", l: "Tasks" + (openTasks.length ? " (" + openTasks.length + ")" : "") },
          { k: "reminders", l: "Alerts" + (pending.length ? " (" + pending.length + ")" : "") },
          { k: "chat", l: "Chat" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{ ...S.tab, ...(tab === t.k ? S.tabOn : {}) }}>{t.l}</button>
        ))}
      </nav>

      {/* Content */}
      <main style={S.main}>

        {/* ── TODAY ── */}
        {tab === "today" && (
          <div style={S.anim}>
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
            <div style={S.card}>
              <div style={S.cHead}><div style={S.headDot} /><span style={S.cTitle}>Daily Briefing</span><button onClick={() => fetchBriefing(true)} style={S.refreshBtn} disabled={briefingLoading}>{briefingLoading ? "↻" : "↻ Refresh"}</button></div>
              {briefingLoading ? <div style={S.skelWrap}><div style={S.skel}/><div style={{...S.skel,width:"80%"}}/><div style={{...S.skel,width:"60%"}}/></div> : <div style={S.bText}>{briefing}</div>}
            </div>

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
                {events.map((ev, i) => (
                  <div key={i} style={S.evItem}>
                    <div style={S.evTime}>{formatTime(ev.start)}</div>
                    <div style={S.evInfo}>
                      <div style={S.evTitle}>{ev.title}</div>
                      {ev.location && <div style={S.evLoc}>📍 {ev.location}</div>}
                      {ev.end && <div style={S.evDur}>{formatTime(ev.start)} – {formatTime(ev.end)}</div>}
                    </div>
                  </div>
                ))}
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
                    <button onClick={() => setTasks((p) => p.map((x) => x.id === t.id ? {...x, done:true} : x))} style={S.chk}>☐</button>
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
                  <div style={m.role === "user" ? S.uBub : S.aBub}>{m.text}</div>
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
            <div style={S.chatBar}>
              <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Ask Mary anything..." style={S.chatIn} />
              <button onClick={sendMessage} disabled={!input.trim() || loading} style={S.sendBtn}>↑</button>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes dotPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes livePulse { 0%, 100% { opacity: 1; box-shadow: 0 0 6px #00f5c0; } 50% { opacity: 0.5; box-shadow: 0 0 2px #00f5c0; } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}

const S = {
  root: { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif", background: "#071428", color: "#ffffff", minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column" },
  // Notif banner
  notifBanner: { background: "linear-gradient(135deg, rgba(0,219,168,0.08), rgba(56,170,255,0.05))", borderBottom: "1px solid rgba(0,219,168,0.15)", padding: "10px 16px" },
  notifRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  notifTitle: { fontSize: 13, fontWeight: 600, color: "#00f5c0" },
  notifDesc: { fontSize: 12, color: "#7a96bc" },
  notifBtn: { padding: "6px 16px", background: "#00dba8", color: "#071428", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", whiteSpace: "nowrap", boxShadow: "0 0 16px rgba(0,219,168,0.3)" },
  // Header
  header: { padding: "20px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(180deg, #0c1a34, #071428)" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  logo: { fontSize: 26, fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1 },
  dateLbl: { fontSize: 12, color: "#7a96bc", marginTop: 4, fontWeight: 400 },
  greet: { fontSize: 13, color: "rgba(255,255,255,0.65)", fontWeight: 300, marginTop: 4 },
  poweredBy: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 11, color: "#7a96bc", fontWeight: 400 },
  liveDot: { width: 7, height: 7, borderRadius: "50%", background: "#00f5c0", boxShadow: "0 0 8px #00f5c0", animation: "livePulse 2s ease-in-out infinite" },
  // Tabs
  tabBar: { display: "flex", padding: "0 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#071428" },
  tab: { flex: 1, padding: "12px 0", background: "none", border: "none", borderBottom: "2px solid transparent", color: "#7a96bc", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", transition: "all .25s ease", letterSpacing: "0.3px" },
  tabOn: { color: "#00f5c0", borderBottomColor: "#00f5c0" },
  main: { flex: 1, padding: 16, overflowY: "auto" },
  anim: { animation: "fadeIn 0.3s ease" },
  // Cards
  card: { background: "#101f3a", borderRadius: 14, padding: 16, marginBottom: 12, border: "1px solid rgba(255,255,255,0.08)", transition: "border-color .3s ease" },
  cHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  headDot: { width: 7, height: 7, borderRadius: "50%", background: "#00dba8", boxShadow: "0 0 8px #00dba8", flexShrink: 0 },
  cTitle: { fontSize: 13, fontWeight: 700, letterSpacing: "0.3px", flex: 1, textTransform: "uppercase", letterSpacing: "1.5px", fontSize: 11 },
  seeAll: { background: "none", border: "none", color: "#00f5c0", fontSize: 12, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500 },
  refreshBtn: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#7a96bc", fontSize: 11, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500, padding: "4px 10px", transition: "all .2s ease" },
  tomorrowCard: { background: "linear-gradient(135deg, rgba(56,170,255,0.06), rgba(26,110,224,0.04))", borderRadius: 14, padding: 16, marginBottom: 12, border: "1px solid rgba(56,170,255,0.12)" },
  bText: { fontSize: 14, lineHeight: 1.65, color: "rgba(255,255,255,0.65)", whiteSpace: "pre-wrap", fontWeight: 300 },
  // Bible verse
  verseCard: { background: "linear-gradient(135deg, rgba(0,219,168,0.06), rgba(56,170,255,0.04))", borderRadius: 14, padding: "20px 18px", marginBottom: 12, border: "1px solid rgba(0,245,192,0.12)", position: "relative", overflow: "hidden" },
  verseMark: { position: "absolute", top: 10, right: 14, fontSize: 20, opacity: 0.12, background: "linear-gradient(90deg, #00f5c0, #38aaff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  verseText: { fontSize: 15, lineHeight: 1.7, color: "rgba(255,255,255,0.85)", fontWeight: 300, fontStyle: "italic", marginBottom: 10 },
  verseFooter: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  verseRef: { fontSize: 12, fontWeight: 600, color: "#00dba8", letterSpacing: "0.5px" },
  shareBtn: { padding: "5px 14px", background: "rgba(0,219,168,0.1)", border: "1px solid rgba(0,219,168,0.25)", borderRadius: 8, color: "#00f5c0", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", transition: "all .2s ease" },
  skelWrap: { display: "flex", flexDirection: "column", gap: 8 },
  skel: { height: 14, background: "rgba(255,255,255,0.06)", borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" },
  // Events
  evItem: { display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  evTime: { fontSize: 12, fontWeight: 600, color: "#00f5c0", minWidth: 70, paddingTop: 2, fontFamily: "'DM Mono', monospace" },
  evInfo: { flex: 1 },
  evTitle: { fontSize: 14, fontWeight: 500 },
  evLoc: { fontSize: 12, color: "#7a96bc", marginTop: 2 },
  evDur: { fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2, fontFamily: "'DM Mono', monospace" },
  // Mini tasks
  mini: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" },
  pDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  miniT: { fontSize: 13, flex: 1, fontWeight: 400 },
  miniD: { fontSize: 11, color: "#7a96bc", fontFamily: "'DM Mono', monospace" },
  // Quick actions
  qActions: { display: "flex", gap: 8, marginTop: 8 },
  qBtn: { flex: 1, padding: "12px 16px", background: "#00dba8", color: "#071428", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: "0 4px 20px rgba(0,219,168,0.3)", transition: "all .2s ease" },
  qBtn2: { flex: 1, padding: "12px 16px", background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" },
  // Tasks
  addRow: { display: "flex", gap: 8, marginBottom: 16 },
  addIn: { flex: 1, padding: "10px 14px", background: "#101f3a", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, color: "#fff", fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", outline: "none", fontWeight: 300 },
  addBtn: { width: 40, height: 40, background: "#00dba8", color: "#071428", border: "none", borderRadius: 10, fontSize: 20, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,219,168,0.3)" },
  empty: { textAlign: "center", padding: "48px 20px", color: "rgba(255,255,255,0.65)" },
  secTitle: { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#00dba8", marginBottom: 8 },
  tItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  chk: { background: "none", border: "none", color: "#00dba8", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 },
  del: { background: "none", border: "none", color: "rgba(255,255,255,0.2)", fontSize: 14, cursor: "pointer", padding: 4 },
  clrDone: { background: "none", border: "none", color: "#7a96bc", fontSize: 12, cursor: "pointer", marginTop: 8, fontFamily: "'Plus Jakarta Sans', sans-serif", textDecoration: "underline" },
  hint: { fontSize: 13, color: "#7a96bc", padding: "8px 0 16px", lineHeight: 1.5, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 16, fontWeight: 300 },
  // Chat
  chatWrap: { display: "flex", flexDirection: "column", height: "calc(100vh - 170px)", margin: -16 },
  chatScroll: { flex: 1, overflowY: "auto", padding: "16px 16px 8px" },
  chatEmpty: { textAlign: "center", padding: "24px 8px" },
  sug: { padding: "10px 14px", background: "#101f3a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.65)", fontSize: 13, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", textAlign: "left", fontWeight: 400, transition: "border-color .2s ease" },
  uMsg: { display: "flex", justifyContent: "flex-end", marginBottom: 10 },
  aMsg: { display: "flex", justifyContent: "flex-start", gap: 8, marginBottom: 10, alignItems: "flex-start" },
  av: { marginTop: 10, flexShrink: 0 },
  uBub: { background: "linear-gradient(135deg, #00dba8, #1a6ee0)", color: "#071428", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14, maxWidth: "80%", lineHeight: 1.5, fontWeight: 600 },
  aBub: { background: "#101f3a", color: "rgba(255,255,255,0.85)", padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 14, maxWidth: "85%", lineHeight: 1.5, whiteSpace: "pre-wrap", fontWeight: 300, border: "1px solid rgba(255,255,255,0.06)" },
  dot: { animation: "dotPulse 1s ease-in-out infinite", fontSize: 10, color: "#00dba8" },
  chatBar: { display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "#071428" },
  chatIn: { flex: 1, padding: "10px 14px", background: "#101f3a", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, color: "#fff", fontSize: 14, fontFamily: "'Plus Jakarta Sans', sans-serif", outline: "none", fontWeight: 300 },
  sendBtn: { width: 40, height: 40, background: "#00dba8", color: "#071428", border: "none", borderRadius: 12, fontSize: 18, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,219,168,0.3)" },
  gcBanner: { display: "flex", alignItems: "center", gap: 12, background: "rgba(56,170,255,0.06)", border: "1px solid rgba(56,170,255,0.15)", borderRadius: 12, padding: "12px 14px", marginBottom: 12 },
  gcBtn: { padding: "6px 14px", background: "#38aaff", color: "#071428", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", whiteSpace: "nowrap" },
};

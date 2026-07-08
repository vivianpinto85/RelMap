// ai.js — chat UI wired to the AI Studio proxy, parsing a single "url|token" config line

const chatPanel    = document.getElementById("chat-panel");
const msgInput      = document.getElementById("msg-input");
const sendBtn       = document.getElementById("sendBtn");
const configInput   = document.getElementById("configInput");
const statusDot     = document.getElementById("status-dot");
const statusText    = document.getElementById("status-text");

const STORAGE_KEY = "relmap_ai_config";

// Restore last-pasted config for this session
const saved = sessionStorage.getItem(STORAGE_KEY);
if (saved) configInput.value = saved;
configInput.addEventListener("input", () => sessionStorage.setItem(STORAGE_KEY, configInput.value));

function clearEmptyHint() {
  const hint = chatPanel.querySelector(".empty-hint");
  if (hint) hint.remove();
}

function addMessage(text, cls) {
  clearEmptyHint();
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  chatPanel.appendChild(div);
  chatPanel.scrollTop = chatPanel.scrollHeight;
  return div;
}

function setStatus(state, text) {
  statusDot.className = state; // '', 'ok', 'err'
  statusText.textContent = text;
}

function parseConfig() {
  const raw = configInput.value.trim();
  if (!raw) return null;
  const idx = raw.lastIndexOf("|");
  if (idx === -1) return null;
  const url = raw.slice(0, idx).trim();
  const token = raw.slice(idx + 1).trim();
  if (!url || !token) return null;
  return { url, token };
}

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;

  const config = parseConfig();
  if (!config) {
    setStatus("err", "Paste a valid url|token config line first");
    return;
  }

  addMessage(text, "user");
  msgInput.value = "";
  msgInput.style.height = "auto";
  sendBtn.disabled = true;

  const pendingMsg = addMessage("Thinking...", "ai pending");

  try {
    // Call RelMap's own backend, which proxies to AI Studio server-side (avoids browser CORS)
    const res = await fetch("/agent/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: config.url,
        token: config.token,
        message: text
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data.reply || "(no reply content found in response)";

    pendingMsg.textContent = reply;
    pendingMsg.className = "msg ai";
    setStatus("ok", "Connected");

  } catch (err) {
    pendingMsg.textContent = `Failed to reach agent: ${err.message}`;
    pendingMsg.className = "msg error";
    setStatus("err", "Connection failed — check config line");
  } finally {
    sendBtn.disabled = false;
    msgInput.focus();
  }
}

msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

msgInput.addEventListener("input", () => {
  msgInput.style.height = "auto";
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + "px";
});
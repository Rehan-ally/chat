const app = document.getElementById("app");
const authScreen = document.getElementById("auth-screen");
const list = document.getElementById("conversation-list");
const messagesEl = document.getElementById("messages");
const typingEl = document.getElementById("typing");
const input = document.getElementById("message-input");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const peopleDialog = document.getElementById("people-dialog");
const peopleList = document.getElementById("people-list");
const peopleStatus = document.getElementById("people-status");
const peopleSearch = document.getElementById("people-search");
const tokenKey = "flow-token";
let flowUser = null;
let token = null;
let chats = [];
let activeId = null;
let authMode = "login";
let pollInProgress = false;
let lastRenderedMessages = "";
let peopleSearchTimer;
let peopleRequestId = 0;

const safe = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("FLOW's sign-in server is not reachable. Run `npm.cmd start` in the FLOW project folder, then open the address printed in the terminal.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("This page is not connected to FLOW's sign-in server. Run `npm.cmd start` in the FLOW project folder, then open the address printed in the terminal.");
  }

  if (response.status === 401 && token) {
    clearSession();
    authError.textContent = "Your session expired. Please log in again.";
  }
  if (!response.ok) throw new Error(result.error || "The server could not complete the request.");
  return result;
}

function clearSession() {
  token = null;
  flowUser = null;
  chats = [];
  activeId = null;
  localStorage.removeItem(tokenKey);
  app.hidden = true;
  authScreen.hidden = false;
  typingEl.classList.remove("visible");
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === "signup";
  const nameField = document.getElementById("name-field");
  const nameInput = document.getElementById("auth-name");
  nameField.hidden = !signingUp;
  nameInput.disabled = !signingUp;
  nameInput.required = signingUp;
  document.getElementById("login-tab").setAttribute("aria-selected", String(!signingUp));
  document.getElementById("signup-tab").setAttribute("aria-selected", String(signingUp));
  document.getElementById("auth-title").textContent = signingUp ? "Create your account" : "Welcome back";
  document.getElementById("auth-subtitle").textContent = signingUp
    ? "Create an account to start messaging."
    : "Log in to pick up where your conversations left off.";
  document.getElementById("auth-submit").textContent = signingUp ? "Create account" : "Log in";
  document.getElementById("auth-password").autocomplete = signingUp ? "new-password" : "current-password";
  authError.textContent = "";
}

function renderList() {
  const query = document.getElementById("search").value.trim().toLowerCase();
  const filtered = chats.filter((chat) => `${chat.name} ${chat.preview}`.toLowerCase().includes(query));
  list.innerHTML = filtered.length ? filtered.map((chat) => `
    <button class="conversation ${chat.id === activeId ? "active" : ""}" type="button" data-chat="${safe(chat.id)}" aria-current="${chat.id === activeId ? "page" : "false"}">
      <span class="avatar ${safe(chat.color)}">${safe(chat.initials)}${chat.status === "Online now" ? '<i class="presence"></i>' : ""}</span>
      <span class="conversation-copy"><span class="conversation-top"><span class="conversation-name">${safe(chat.name)}</span><span class="conversation-time">${safe(chat.time)}</span></span>
      <span class="conversation-bottom"><span class="conversation-preview">${safe(chat.preview)}</span>${chat.unread ? `<span class="unread">${chat.unread}</span>` : ""}</span></span>
    </button>`).join("") : '<p class="auth-subtitle">No conversations yet. Start one with the + button.</p>';
  document.getElementById("chat-count").textContent = String(chats.length).padStart(2, "0");
}

function renderMessages(messages) {
  const chat = chats.find((item) => item.id === activeId);
  if (!chat) {
    document.getElementById("active-name").textContent = "Welcome to FLOW";
    document.getElementById("active-status").textContent = "Start a chat to send a message";
    const avatar = document.getElementById("active-avatar");
    avatar.className = "avatar green";
    avatar.textContent = "↗";
    messagesEl.innerHTML = '<div class="day-divider">YOUR MESSAGES</div><p class="auth-subtitle">Use the + button to start a conversation with someone’s registered email address.</p>';
    lastRenderedMessages = "";
    return;
  }

  document.getElementById("active-name").textContent = chat.name;
  document.getElementById("active-status").textContent = chat.status;
  const avatar = document.getElementById("active-avatar");
  avatar.className = `avatar ${safe(chat.color)}`;
  avatar.innerHTML = `${safe(chat.initials)}${chat.status === "Online now" ? '<span class="presence"></span>' : ""}`;
  const signature = `${chat.id}:${messages.map((message) => message.id).join(",")}`;
  if (signature === lastRenderedMessages) return;
  lastRenderedMessages = signature;
  messagesEl.innerHTML = `<div class="day-divider">TODAY</div>` + (messages.length
    ? messages.map((message) => {
      const mine = message.from === "me";
      return `<div class="message-row ${mine ? "mine" : ""}">${mine ? "" : `<div class="message-avatar">${safe(chat.initials)}</div>`}<div class="message-content">${mine ? "" : `<div class="message-author">${safe(chat.name)}</div>`}<div class="bubble">${safe(message.text)}</div><div class="message-time">${safe(message.time)}</div></div></div>`;
    }).join("")
    : '<p class="auth-subtitle">Say hello to start this conversation.</p>');
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadMessages(chatId = activeId) {
  if (!chatId) {
    renderMessages([]);
    return;
  }
  const result = await api(`/api/chats/${encodeURIComponent(chatId)}/messages`);
  if (chatId === activeId) renderMessages(result.messages);
}

async function refreshChats() {
  const result = await api("/api/chats");
  chats = result.chats;
  if (!chats.some((chat) => chat.id === activeId)) activeId = chats[0]?.id || null;
  renderList();
  if (activeId) await loadMessages(activeId);
  else renderMessages([]);
}

async function openChat(user, sessionToken) {
  flowUser = user;
  token = sessionToken;
  localStorage.setItem(tokenKey, token);
  document.getElementById("profile-name").textContent = user.name;
  document.getElementById("profile-email").textContent = user.email;
  document.getElementById("profile-avatar").textContent = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  authScreen.hidden = true;
  app.hidden = false;
  activeId = null;
  lastRenderedMessages = "";
  await refreshChats();
}

function renderPeople(users) {
  if (!users.length) {
    peopleList.innerHTML = "";
    peopleStatus.textContent = peopleSearch.value.trim()
      ? "No FLOW members match that search."
      : "No other FLOW members yet. Invite someone to sign up, then find them here.";
    return;
  }
  peopleStatus.textContent = `${users.length}${users.length === 100 ? "+" : ""} FLOW member${users.length === 1 ? "" : "s"}`;
  peopleList.innerHTML = users.map((person) => `
    <div class="people-row">
      <span class="avatar ${person.online ? "green" : "lavender"}">${safe(person.initials)}${person.online ? '<span class="presence"></span>' : ""}</span>
      <div class="people-copy">
        <div class="people-name">${safe(person.name)}</div>
        <div class="people-presence">${person.online ? "Online now" : "FLOW member"}</div>
      </div>
      <button class="people-action" type="button" data-person="${safe(person.id)}">${person.hasConversation ? "Open chat" : "Message"}</button>
    </div>`).join("");
}

async function loadPeople(query = "") {
  const requestId = ++peopleRequestId;
  peopleStatus.textContent = "Finding FLOW members...";
  peopleList.innerHTML = "";
  try {
    const result = await api(`/api/users?q=${encodeURIComponent(query.trim())}`);
    if (requestId === peopleRequestId) renderPeople(result.users);
  } catch (error) {
    if (requestId === peopleRequestId) peopleStatus.textContent = error.message;
  }
}

document.getElementById("login-tab").addEventListener("click", () => setAuthMode("login"));
document.getElementById("signup-tab").addEventListener("click", () => setAuthMode("signup"));
document.getElementById("password-toggle").addEventListener("click", (event) => {
  const password = document.getElementById("auth-password");
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  const submit = document.getElementById("auth-submit");
  const payload = {
    email: document.getElementById("auth-email").value.trim().toLowerCase(),
    password: document.getElementById("auth-password").value
  };
  if (authMode === "signup") payload.name = document.getElementById("auth-name").value.trim();
  submit.disabled = true;
  submit.textContent = authMode === "signup" ? "Creating account..." : "Logging in...";
  try {
    const result = await api(authMode === "signup" ? "/api/signup" : "/api/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await openChat(result.user, result.token);
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === "signup" ? "Create account" : "Log in";
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    console.error("Could not log out from FLOW:", error);
  } finally {
    clearSession();
    setAuthMode("login");
    document.getElementById("auth-password").value = "";
  }
});

document.getElementById("search").addEventListener("input", renderList);
list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-chat]");
  if (!button) return;
  activeId = button.dataset.chat;
  lastRenderedMessages = "";
  renderList();
  typingEl.classList.remove("visible");
  try {
    await loadMessages(activeId);
    await refreshChats();
    app.classList.add("chat-open");
  } catch (error) {
    console.error("Could not load FLOW conversation:", error);
  }
});

document.getElementById("new-chat").addEventListener("click", () => {
  peopleSearch.value = "";
  peopleDialog.showModal();
  loadPeople();
  peopleSearch.focus();
});

document.getElementById("people-close").addEventListener("click", () => peopleDialog.close());
peopleDialog.addEventListener("click", (event) => {
  if (event.target === peopleDialog) peopleDialog.close();
});
peopleSearch.addEventListener("input", () => {
  window.clearTimeout(peopleSearchTimer);
  peopleSearchTimer = window.setTimeout(() => loadPeople(peopleSearch.value), 180);
});
peopleList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-person]");
  if (!button) return;
  button.disabled = true;
  peopleStatus.textContent = "Opening conversation...";
  try {
    const result = await api("/api/chats", {
      method: "POST",
      body: JSON.stringify({ userId: button.dataset.person })
    });
    activeId = result.chat.id;
    lastRenderedMessages = "";
    await refreshChats();
    peopleDialog.close();
    app.classList.add("chat-open");
    input.focus();
  } catch (error) {
    button.disabled = false;
    peopleStatus.textContent = error.message;
  }
});

document.getElementById("message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || !activeId) return;
  input.value = "";
  try {
    await api(`/api/chats/${encodeURIComponent(activeId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    lastRenderedMessages = "";
    await refreshChats();
    input.focus();
  } catch (error) {
    input.value = text;
    window.alert(error.message);
  }
});

document.getElementById("back-button").addEventListener("click", () => app.classList.remove("chat-open"));
document.getElementById("message-search").addEventListener("click", () => {
  const query = window.prompt("Find a message in this conversation:");
  if (!query) return;
  const found = [...messagesEl.querySelectorAll(".bubble")].find((bubble) =>
    bubble.textContent.toLowerCase().includes(query.toLowerCase())
  );
  if (found) {
    found.scrollIntoView({ behavior: "smooth", block: "center" });
    found.animate([{ backgroundColor: "#d6f36a" }, { backgroundColor: "" }], { duration: 1000 });
  } else {
    window.alert("No matching message found.");
  }
});

window.setInterval(async () => {
  if (!token || pollInProgress) return;
  pollInProgress = true;
  try {
    await refreshChats();
  } catch (error) {
    console.error("Could not refresh FLOW messages:", error);
  } finally {
    pollInProgress = false;
  }
}, 2000);

try {
  const savedToken = localStorage.getItem(tokenKey);
  if (savedToken) {
    token = savedToken;
    const result = await api("/api/me");
    await openChat(result.user, savedToken);
  }
} catch (error) {
  if (token) {
    clearSession();
    authError.textContent = error.message;
  }
}

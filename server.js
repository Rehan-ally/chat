const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");

const port = Number(process.env.PORT) || 3002;
const host = process.env.HOST || "0.0.0.0";
const pagePath = path.join(__dirname, "hi.html");
const dataDirectory = path.resolve(process.env.FLOW_DATA_DIR || path.join(__dirname, "data"));
const dataPath = path.join(dataDirectory, "flow-data.json");
const pbkdf2 = promisify(crypto.pbkdf2);
const sessions = new Map();
const colors = ["green", "lavender", "peach", "blue"];

fs.mkdirSync(dataDirectory, { recursive: true });
if (!fs.existsSync(dataPath)) {
  fs.writeFileSync(dataPath, JSON.stringify({ users: [], conversations: [], messages: [] }, null, 2));
}
const database = JSON.parse(fs.readFileSync(dataPath, "utf8"));
if (!Array.isArray(database.users) || !Array.isArray(database.conversations) || !Array.isArray(database.messages)) {
  throw new Error(`Invalid FLOW data file: ${dataPath}`);
}

function saveDatabase() {
  const temporaryPath = `${dataPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(database, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, dataPath);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let oversized = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (oversized) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 16384) {
        oversized = true;
        body = "";
        reject(new HttpError(413, "Request is too large."));
      }
    });
    request.on("end", () => {
      if (oversized) return;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new HttpError(400, "Request must contain valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function requireUser(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const userId = sessions.get(token);
  const user = database.users.find((item) => item.id === userId);
  if (!user) throw new HttpError(401, "Please log in again.");
  return user;
}

function getConversation(conversationId, userId) {
  const conversation = database.conversations.find((item) => item.id === conversationId);
  if (!conversation || !conversation.participants.includes(userId)) {
    throw new HttpError(404, "Conversation not found.");
  }
  return conversation;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

function getChatSummaries(user) {
  return database.conversations
    .filter((conversation) => conversation.participants.includes(user.id))
    .map((conversation, index) => {
      const otherId = conversation.participants.find((id) => id !== user.id);
      const otherUser = database.users.find((item) => item.id === otherId);
      const messages = database.messages.filter((item) => item.conversationId === conversation.id);
      const latest = messages[messages.length - 1];
      const lastReadAt = conversation.lastReadAt[user.id] || "";
      const unread = messages.filter((item) => item.from !== user.id && item.createdAt > lastReadAt).length;
      return {
        id: conversation.id,
        name: otherUser.name,
        initials: initials(otherUser.name),
        color: colors[index % colors.length],
        status: Array.from(sessions.values()).includes(otherId) ? "Online now" : "Offline",
        preview: latest ? latest.text : "Start a conversation",
        time: latest ? formatTime(new Date(latest.createdAt)) : "",
        unread
      };
    })
    .sort((first, second) => {
      const a = database.messages.filter((item) => item.conversationId === first.id).at(-1)?.createdAt || "";
      const b = database.messages.filter((item) => item.conversationId === second.id).at(-1)?.createdAt || "";
      return b.localeCompare(a);
    });
}

async function handleApi(request, response, url) {
  const route = url.pathname;

  if (request.method === "POST" && route === "/api/signup") {
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2 || name.length > 60) throw new HttpError(400, "Name must be between 2 and 60 characters.");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (password.length < 8 || password.length > 128) throw new HttpError(400, "Password must be between 8 and 128 characters.");
    if (database.users.some((user) => user.email === email)) throw new HttpError(409, "An account with this email already exists. Log in instead.");
    const salt = crypto.randomBytes(16);
    const passwordHash = await pbkdf2(password, salt, 210000, 32, "sha256");
    if (database.users.some((item) => item.email === email)) throw new HttpError(409, "An account with this email already exists. Log in instead.");
    const user = { id: crypto.randomUUID(), name, email, salt: salt.toString("hex"), passwordHash: passwordHash.toString("hex") };
    database.users.push(user);
    saveDatabase();
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, user.id);
    sendJson(response, 201, { token, user: publicUser(user) });
    return;
  }

  if (request.method === "POST" && route === "/api/login") {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = database.users.find((item) => item.email === email);
    if (!user || password.length > 128) throw new HttpError(401, "Email or password is incorrect.");
    const hash = await pbkdf2(password, Buffer.from(user.salt, "hex"), 210000, 32, "sha256");
    if (!crypto.timingSafeEqual(hash, Buffer.from(user.passwordHash, "hex"))) {
      throw new HttpError(401, "Email or password is incorrect.");
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, user.id);
    sendJson(response, 200, { token, user: publicUser(user) });
    return;
  }

  if (!route.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const user = requireUser(request);

  if (request.method === "GET" && route === "/api/me") {
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (request.method === "POST" && route === "/api/logout") {
    const token = request.headers.authorization.slice(7);
    sessions.delete(token);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && route === "/api/chats") {
    sendJson(response, 200, { chats: getChatSummaries(user) });
    return;
  }

  if (request.method === "GET" && route === "/api/users") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const users = database.users
      .filter((item) => item.id !== user.id)
      .filter((item) => !query || `${item.name} ${item.email}`.toLowerCase().includes(query))
      .map((item) => ({
        id: item.id,
        name: item.name,
        initials: initials(item.name),
        online: Array.from(sessions.values()).includes(item.id),
        hasConversation: database.conversations.some((conversation) =>
          conversation.participants.includes(user.id) && conversation.participants.includes(item.id)
        )
      }))
      .sort((first, second) => Number(second.online) - Number(first.online) || first.name.localeCompare(second.name))
      .slice(0, 100);
    sendJson(response, 200, { users });
    return;
  }

  if (request.method === "POST" && route === "/api/chats") {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const otherUser = typeof body.userId === "string"
      ? database.users.find((item) => item.id === body.userId)
      : database.users.find((item) => item.email === email);
    if (!otherUser) throw new HttpError(404, "No FLOW account found with that email address.");
    if (otherUser.id === user.id) throw new HttpError(400, "You cannot start a conversation with yourself.");
    let conversation = database.conversations.find((item) =>
      item.participants.includes(user.id) && item.participants.includes(otherUser.id)
    );
    if (!conversation) {
      conversation = {
        id: crypto.randomUUID(),
        participants: [user.id, otherUser.id],
        createdAt: new Date().toISOString(),
        lastReadAt: {}
      };
      database.conversations.push(conversation);
      saveDatabase();
    }
    sendJson(response, 201, { chat: getChatSummaries(user).find((item) => item.id === conversation.id) });
    return;
  }

  const messagesMatch = route.match(/^\/api\/chats\/([0-9a-f-]+)\/messages$/i);
  if (messagesMatch && request.method === "GET") {
    const conversation = getConversation(messagesMatch[1], user.id);
    const messages = database.messages
      .filter((item) => item.conversationId === conversation.id)
      .map((item) => ({
        id: item.id,
        from: item.from === user.id ? "me" : "them",
        text: item.text,
        time: formatTime(new Date(item.createdAt))
      }));
    const latestIncoming = database.messages.filter((item) =>
      item.conversationId === conversation.id && item.from !== user.id
    ).at(-1);
    if (latestIncoming && latestIncoming.createdAt > (conversation.lastReadAt[user.id] || "")) {
      conversation.lastReadAt[user.id] = new Date().toISOString();
      saveDatabase();
    }
    sendJson(response, 200, { messages });
    return;
  }

  if (messagesMatch && request.method === "POST") {
    const conversation = getConversation(messagesMatch[1], user.id);
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 4000) throw new HttpError(400, "Message must be between 1 and 4000 characters.");
    const message = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      from: user.id,
      text,
      createdAt: new Date().toISOString()
    };
    database.messages.push(message);
    conversation.lastReadAt[user.id] = message.createdAt;
    saveDatabase();
    sendJson(response, 201, {
      message: { id: message.id, from: "me", text: message.text, time: formatTime(new Date(message.createdAt)) }
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "POST") {
    throw new HttpError(405, "Method not allowed.");
  }
  throw new HttpError(404, "Not found.");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
      } else {
        console.error("FLOW API error:", error);
        sendJson(response, 500, { error: "The server could not complete the request." });
      }
    }
    return;
  }

  if (url.pathname === "/app.js" && (request.method === "GET" || request.method === "HEAD")) {
    fs.readFile(path.join(__dirname, "app.js"), (error, script) => {
      if (error) {
        console.error("Could not read FLOW client:", error);
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Unable to load FLOW.");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Content-Length": script.length,
        "X-Content-Type-Options": "nosniff"
      });
      response.end(request.method === "HEAD" ? undefined : script);
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  if (url.pathname !== "/" && url.pathname !== "/hi.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  fs.readFile(pagePath, (error, html) => {
    if (error) {
      console.error(`Could not read ${pagePath}:`, error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to load FLOW.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": html.length,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    response.end(request.method === "HEAD" ? undefined : html);
  });
});

server.on("listening", () => {
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  console.log(`FLOW is running at http://${host === "0.0.0.0" ? "localhost" : host}:${activePort}`);
  if (host === "0.0.0.0") console.log("For other devices on your network, open this computer's local IP address on the same port.");
});

let usedFallbackPort = false;
server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !process.env.PORT && !usedFallbackPort) {
    usedFallbackPort = true;
    console.warn(`Port ${port} is already in use. Trying port ${port + 1} instead.`);
    server.listen(port + 1, host);
    return;
  }
  console.error("FLOW server failed to start:", error.message);
  process.exitCode = 1;
});

server.listen(port, host);

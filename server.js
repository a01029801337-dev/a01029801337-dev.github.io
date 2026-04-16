const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";

const ADMIN_USERNAME = "huh9991";
const ADMIN_DEFAULT_PASSWORD = "admin1234";
const ADMIN_DISPLAY_NAME = "관리자";

const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_FILE)) {
    const now = new Date().toISOString();
    const adminUser = {
      id: 1,
      username: ADMIN_USERNAME,
      displayName: ADMIN_DISPLAY_NAME,
      passwordHash: bcrypt.hashSync(ADMIN_DEFAULT_PASSWORD, 10),
      role: "admin",
      approved: true,
      announcementAccess: "approved",
      createdAt: now,
    };

    const initialStore = {
      meta: {
        nextUserId: 2,
        nextMessageId: 1,
      },
      users: [adminUser],
      messages: [],
    };

    fs.writeFileSync(STORE_FILE, JSON.stringify(initialStore, null, 2), "utf8");
  }

  migrateStore();
}

function readStore() {
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function migrateStore() {
  const store = readStore();
  let changed = false;

  if (!store.meta) {
    store.meta = { nextUserId: 1, nextMessageId: 1 };
    changed = true;
  }
  if (!Number.isInteger(store.meta.nextUserId)) {
    const maxUserId = Math.max(0, ...store.users.map((user) => Number(user.id) || 0));
    store.meta.nextUserId = maxUserId + 1;
    changed = true;
  }
  if (!Number.isInteger(store.meta.nextMessageId)) {
    const maxMessageId = Math.max(0, ...store.messages.map((message) => Number(message.id) || 0));
    store.meta.nextMessageId = maxMessageId + 1;
    changed = true;
  }

  const adminUser = store.users.find((user) => user.role === "admin");
  if (adminUser) {
    const collidingUsers = store.users.filter(
      (user) => user.id !== adminUser.id && user.username && user.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()
    );

    collidingUsers.forEach((user) => {
      let nextUsername = `${user.username}_${user.id}`;
      let suffix = 1;

      while (
        store.users.some(
          (candidate) => candidate.id !== user.id && candidate.username && candidate.username.toLowerCase() === nextUsername.toLowerCase()
        )
      ) {
        nextUsername = `${user.username}_${user.id}_${suffix}`;
        suffix += 1;
      }

      user.username = nextUsername;
      changed = true;
    });
  }

  store.users.forEach((user) => {
    if (!user.createdAt) {
      user.createdAt = new Date().toISOString();
      changed = true;
    }

    if (user.role === "admin") {
      if (user.username !== ADMIN_USERNAME) {
        user.username = ADMIN_USERNAME;
        changed = true;
      }
      if (user.displayName !== ADMIN_DISPLAY_NAME) {
        user.displayName = ADMIN_DISPLAY_NAME;
        changed = true;
      }
      if (user.approved !== true) {
        user.approved = true;
        changed = true;
      }
      if (user.announcementAccess !== "approved") {
        user.announcementAccess = "approved";
        changed = true;
      }
      return;
    }

    if (!["none", "pending", "approved"].includes(user.announcementAccess)) {
      user.announcementAccess = "none";
      changed = true;
    }
  });

  if (changed) {
    writeStore(store);
  }
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    approved: user.approved,
    announcementAccess: user.announcementAccess,
    createdAt: user.createdAt,
  };
}

function getAdminUser(store) {
  return store.users.find((user) => user.role === "admin");
}

function normalizeText(text, maxLength = 500) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function addMessage({ type, text, fromUserId, toUserId = null }) {
  const store = readStore();
  const message = {
    id: store.meta.nextMessageId,
    type,
    text,
    fromUserId,
    toUserId,
    createdAt: new Date().toISOString(),
  };

  store.meta.nextMessageId += 1;
  store.messages.push(message);
  writeStore(store);
  return { store, message };
}

function toChatMessage(message, store) {
  const fromUser = store.users.find((user) => user.id === message.fromUserId);
  const toUser = store.users.find((user) => user.id === message.toUserId);

  return {
    id: message.id,
    type: message.type,
    text: message.text,
    createdAt: message.createdAt,
    fromUserId: message.fromUserId,
    fromDisplayName: fromUser ? fromUser.displayName : "알 수 없음",
    toUserId: message.toUserId,
    toDisplayName: toUser ? toUser.displayName : null,
  };
}

function getSessionUser(req) {
  if (!req.session || !req.session.userId) {
    return null;
  }
  const store = readStore();
  return store.users.find((user) => user.id === req.session.userId) || null;
}

function resolveHomePath(user) {
  if (!user) {
    return "/login";
  }
  if (user.role === "admin") {
    return "/admin";
  }
  return user.approved ? "/chat" : "/pending";
}

function canSeeAnnouncements(user) {
  return user.role === "admin" || user.announcementAccess === "approved";
}

function broadcastAnnouncement(message) {
  const store = readStore();
  const safeMessage = toChatMessage(message, store);

  store.users.forEach((user) => {
    const canReceive =
      user.role === "admin" || (user.role === "user" && user.approved && user.announcementAccess === "approved");

    if (canReceive) {
      io.to(`user:${user.id}`).emit("announcement:new", safeMessage);
    }
  });
}

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12,
  },
});

app.use(express.json());
app.use(sessionMiddleware);
app.use("/assets", express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }
  return next();
}

function requireApprovedOrAdmin(req, res, next) {
  if (req.user.role === "admin" || req.user.approved) {
    return next();
  }
  return res.status(403).json({ error: "관리자 승인 후 이용 가능합니다." });
}

app.get("/", (req, res) => {
  const user = getSessionUser(req);
  return res.redirect(resolveHomePath(user));
});

app.get("/login", (req, res) => {
  const user = getSessionUser(req);
  if (user) {
    return res.redirect(resolveHomePath(user));
  }
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/signup", (req, res) => {
  const user = getSessionUser(req);
  if (user) {
    return res.redirect(resolveHomePath(user));
  }
  return res.sendFile(path.join(__dirname, "public", "signup.html"));
});

app.get("/pending", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.redirect("/login");
  }
  if (user.role === "admin") {
    return res.redirect("/admin");
  }
  if (user.approved) {
    return res.redirect("/chat");
  }
  return res.sendFile(path.join(__dirname, "public", "pending.html"));
});

app.get("/chat", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.redirect("/login");
  }
  if (user.role === "admin") {
    return res.redirect("/admin");
  }
  if (!user.approved) {
    return res.redirect("/pending");
  }
  return res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("/admin", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.redirect("/login");
  }
  if (user.role !== "admin") {
    return res.redirect(resolveHomePath(user));
  }
  return res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/signup", (req, res) => {
  const username = (req.body.username || "").trim();
  const displayName = (req.body.displayName || "").trim();
  const password = req.body.password || "";

  if (!username || !displayName || !password) {
    return res.status(400).json({ error: "모든 항목을 입력해 주세요." });
  }

  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: "아이디는 3~20자여야 합니다." });
  }

  if (displayName.length < 2 || displayName.length > 20) {
    return res.status(400).json({ error: "이름은 2~20자여야 합니다." });
  }

  if (password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: "비밀번호는 6~64자여야 합니다." });
  }

  const store = readStore();
  if (store.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
  }

  const newUser = {
    id: store.meta.nextUserId,
    username,
    displayName,
    passwordHash: bcrypt.hashSync(password, 10),
    role: "user",
    approved: false,
    announcementAccess: "none",
    createdAt: new Date().toISOString(),
  };

  store.meta.nextUserId += 1;
  store.users.push(newUser);
  writeStore(store);

  io.to("admins").emit("user:pending", sanitizeUser(newUser));
  return res.status(201).json({ ok: true, message: "회원가입이 완료되었습니다. 관리자 승인 후 이용 가능합니다." });
});

app.post("/api/login", (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";

  if (!username || !password) {
    return res.status(400).json({ error: "아이디와 비밀번호를 입력해 주세요." });
  }

  const store = readStore();
  const user = store.users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "로그인 정보가 올바르지 않습니다." });
  }

  const isPasswordCorrect = bcrypt.compareSync(password, user.passwordHash);
  if (!isPasswordCorrect) {
    return res.status(401).json({ error: "로그인 정보가 올바르지 않습니다." });
  }

  req.session.userId = user.id;
  return res.json({ ok: true, user: sanitizeUser(user), redirect: resolveHomePath(user) });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/api/account/password", requireAuth, (req, res) => {
  const currentPassword = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "현재 비밀번호와 새 비밀번호를 입력해 주세요." });
  }

  if (newPassword.length < 6 || newPassword.length > 64) {
    return res.status(400).json({ error: "새 비밀번호는 6~64자여야 합니다." });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });
  }

  const store = readStore();
  const targetUser = store.users.find((user) => user.id === req.user.id);
  if (!targetUser) {
    return res.status(404).json({ error: "사용자 정보를 찾을 수 없습니다." });
  }

  const isCurrentPasswordValid = bcrypt.compareSync(currentPassword, targetUser.passwordHash);
  if (!isCurrentPasswordValid) {
    return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다." });
  }

  targetUser.passwordHash = bcrypt.hashSync(newPassword, 10);
  writeStore(store);

  return res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.json({ user: null });
  }
  const store = readStore();
  const adminUser = getAdminUser(store);
  return res.json({
    user: sanitizeUser(user),
    adminUser: adminUser ? sanitizeUser(adminUser) : null,
  });
});

app.post("/api/announcement-access/request", requireAuth, (req, res) => {
  if (req.user.role !== "user") {
    return res.status(400).json({ error: "일반 사용자만 신청할 수 있습니다." });
  }
  if (!req.user.approved) {
    return res.status(403).json({ error: "관리자 승인 후 신청할 수 있습니다." });
  }

  const store = readStore();
  const target = store.users.find((user) => user.id === req.user.id && user.role === "user");
  if (!target) {
    return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }
  if (target.announcementAccess === "approved") {
    return res.status(409).json({ error: "이미 공지 채팅방 접근 권한이 있습니다." });
  }
  if (target.announcementAccess === "pending") {
    return res.status(409).json({ error: "이미 신청 대기 중입니다." });
  }

  target.announcementAccess = "pending";
  writeStore(store);

  io.to("admins").emit("announcement:request:new", sanitizeUser(target));
  return res.json({ ok: true, announcementAccess: target.announcementAccess });
});

app.get("/api/admin/pending", requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const pendingUsers = store.users
    .filter((user) => user.role === "user" && !user.approved)
    .map((user) => sanitizeUser(user));
  return res.json({ users: pendingUsers });
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const approvedUsers = store.users
    .filter((user) => user.role === "user" && user.approved)
    .map((user) => sanitizeUser(user));
  return res.json({ users: approvedUsers });
});

app.get("/api/admin/announcement-requests", requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const requestedUsers = store.users
    .filter((user) => user.role === "user" && user.approved && user.announcementAccess === "pending")
    .map((user) => sanitizeUser(user));
  return res.json({ users: requestedUsers });
});

app.post("/api/admin/announcement-approve", requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.body.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: "잘못된 요청입니다." });
  }

  const store = readStore();
  const target = store.users.find((user) => user.id === userId && user.role === "user");
  if (!target) {
    return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  }
  if (!target.approved) {
    return res.status(400).json({ error: "가입 승인된 사용자만 수락할 수 있습니다." });
  }
  if (target.announcementAccess !== "pending") {
    return res.status(400).json({ error: "공지 채팅방 신청 대기 상태가 아닙니다." });
  }

  target.announcementAccess = "approved";
  writeStore(store);

  const safeTarget = sanitizeUser(target);
  io.to(`user:${target.id}`).emit("announcement:access-granted", safeTarget);
  io.to("admins").emit("announcement:request:approved", safeTarget);
  return res.json({ ok: true, user: safeTarget });
});

app.post("/api/admin/approve", requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.body.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: "잘못된 요청입니다." });
  }

  const store = readStore();
  const target = store.users.find((user) => user.id === userId && user.role === "user");
  if (!target) {
    return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  }

  target.approved = true;
  if (!["none", "pending", "approved"].includes(target.announcementAccess)) {
    target.announcementAccess = "none";
  }
  writeStore(store);

  const safeTarget = sanitizeUser(target);
  io.to(`user:${target.id}`).emit("account:approved", { approved: true });
  io.to("admins").emit("user:approved", safeTarget);
  return res.json({ ok: true, user: safeTarget });
});

app.delete("/api/admin/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: "잘못된 사용자 ID입니다." });
  }

  const store = readStore();
  const target = store.users.find((user) => user.id === userId);
  if (!target || target.role !== "user") {
    return res.status(404).json({ error: "삭제할 사용자를 찾을 수 없습니다." });
  }

  store.users = store.users.filter((user) => user.id !== userId);
  store.messages = store.messages.filter((message) => message.fromUserId !== userId && message.toUserId !== userId);
  writeStore(store);

  io.to("admins").emit("user:deleted", { userId });

  const targetSockets = await io.in(`user:${userId}`).fetchSockets();
  targetSockets.forEach((socket) => socket.disconnect(true));

  return res.json({ ok: true });
});

app.get("/api/chat/announcements", requireAuth, requireApprovedOrAdmin, (req, res) => {
  if (!canSeeAnnouncements(req.user)) {
    return res.status(403).json({ error: "공지 채팅방은 신청 후 관리자 수락이 필요합니다." });
  }

  const store = readStore();
  const announcements = store.messages
    .filter((message) => message.type === "announcement")
    .map((message) => toChatMessage(message, store));
  return res.json({ messages: announcements });
});

app.get("/api/chat/private/:partnerId", requireAuth, requireApprovedOrAdmin, (req, res) => {
  const partnerId = Number(req.params.partnerId);
  if (!Number.isInteger(partnerId)) {
    return res.status(400).json({ error: "잘못된 사용자 ID입니다." });
  }

  const store = readStore();
  const currentUser = store.users.find((user) => user.id === req.user.id);
  const partner = store.users.find((user) => user.id === partnerId);
  if (!currentUser || !partner) {
    return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }

  if (currentUser.role === "admin") {
    if (partner.role !== "user") {
      return res.status(403).json({ error: "관리자는 일반 사용자와만 1:1 채팅할 수 있습니다." });
    }
  } else {
    const adminUser = getAdminUser(store);
    if (!adminUser || partnerId !== adminUser.id) {
      return res.status(403).json({ error: "일반 사용자는 관리자와만 1:1 채팅할 수 있습니다." });
    }
  }

  const messages = store.messages
    .filter((message) => message.type === "private")
    .filter((message) => {
      return (
        (message.fromUserId === currentUser.id && message.toUserId === partnerId) ||
        (message.fromUserId === partnerId && message.toUserId === currentUser.id)
      );
    })
    .map((message) => toChatMessage(message, store));

  return res.json({ messages });
});

const wrap = (middleware) => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.use((socket, next) => {
  const userId = socket.request.session && socket.request.session.userId;
  if (!userId) {
    return next(new Error("인증되지 않은 사용자"));
  }

  const store = readStore();
  const user = store.users.find((candidate) => candidate.id === userId);
  if (!user) {
    return next(new Error("사용자 정보 없음"));
  }

  if (user.role === "user" && !user.approved) {
    return next(new Error("승인 대기 중"));
  }

  socket.data.userId = user.id;
  return next();
});

io.on("connection", (socket) => {
  const store = readStore();
  const user = store.users.find((candidate) => candidate.id === socket.data.userId);
  if (!user) {
    socket.disconnect();
    return;
  }

  socket.join(`user:${user.id}`);
  if (user.role === "admin") {
    socket.join("admins");
  }

  socket.on("announcement:send", (payload) => {
    if (user.role !== "admin") {
      return;
    }

    const text = normalizeText(payload && payload.text, 800);
    if (!text) {
      return;
    }

    const result = addMessage({
      type: "announcement",
      text,
      fromUserId: user.id,
    });
    broadcastAnnouncement(result.message);
  });

  socket.on("private:send", (payload) => {
    const text = normalizeText(payload && payload.text, 800);
    if (!text) {
      return;
    }

    const latestStore = readStore();
    const currentUser = latestStore.users.find((candidate) => candidate.id === user.id);
    if (!currentUser) {
      return;
    }

    let toUserId = Number(payload && payload.toUserId);
    if (currentUser.role !== "admin") {
      const adminUser = getAdminUser(latestStore);
      if (!adminUser || !currentUser.approved) {
        return;
      }
      toUserId = adminUser.id;
    }

    if (!Number.isInteger(toUserId)) {
      return;
    }

    const targetUser = latestStore.users.find((candidate) => candidate.id === toUserId);
    if (!targetUser) {
      return;
    }

    if (currentUser.role === "admin" && targetUser.role !== "user") {
      return;
    }
    if (currentUser.role !== "admin" && targetUser.role !== "admin") {
      return;
    }

    const result = addMessage({
      type: "private",
      text,
      fromUserId: currentUser.id,
      toUserId,
    });
    const message = toChatMessage(result.message, result.store);

    io.to(`user:${currentUser.id}`).emit("private:new", message);
    io.to(`user:${toUserId}`).emit("private:new", message);
  });
});

ensureStore();
server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Admin login: id=${ADMIN_USERNAME} / password=${ADMIN_DEFAULT_PASSWORD}`);
});

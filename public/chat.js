const welcomeEl = document.getElementById("welcome");
const changePasswordBtn = document.getElementById("change-password-btn");
const logoutBtn = document.getElementById("logout-btn");

const announcementGate = document.getElementById("announcement-gate");
const announcementRequestBtn = document.getElementById("announcement-request-btn");
const announcementLog = document.getElementById("announcement-log");

const privateLog = document.getElementById("private-log");
const privateForm = document.getElementById("private-form");
const privateInput = document.getElementById("private-input");

let me = null;
let adminUser = null;
let socket = null;

function formatTime(iso) {
  const date = new Date(iso);
  return date.toLocaleString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function createEmptyElement(text) {
  const empty = document.createElement("div");
  empty.className = "chat-empty";
  empty.textContent = text;
  return empty;
}

function createMessageElement(message, options) {
  const { currentUserId, showSenderName = false } = options;
  const mine = message.fromUserId === currentUserId;

  const row = document.createElement("div");
  row.className = `chat-row ${mine ? "me" : "other"}`;

  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";

  if (showSenderName && !mine) {
    const sender = document.createElement("div");
    sender.className = "bubble-name";
    sender.textContent = message.fromDisplayName;
    wrap.appendChild(sender);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.text;

  const time = document.createElement("div");
  time.className = "bubble-time";
  time.textContent = formatTime(message.createdAt);

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  row.appendChild(wrap);
  return row;
}

function renderMessages(container, messages, options, emptyText) {
  container.innerHTML = "";
  if (!messages.length) {
    container.appendChild(createEmptyElement(emptyText));
    return;
  }

  messages.forEach((message) => {
    container.appendChild(createMessageElement(message, options));
  });
  container.scrollTop = container.scrollHeight;
}

function appendMessage(container, message, options) {
  const existingEmpty = container.querySelector(".chat-empty");
  if (existingEmpty) {
    existingEmpty.remove();
  }
  container.appendChild(createMessageElement(message, options));
  container.scrollTop = container.scrollHeight;
}

async function fetchJson(url, options = undefined) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "요청 실패");
  }
  return result;
}

async function runChangePasswordFlow() {
  const currentPassword = window.prompt("현재 비밀번호를 입력해 주세요.");
  if (currentPassword === null) {
    return;
  }

  const newPassword = window.prompt("새 비밀번호를 입력해 주세요. (6자 이상)");
  if (newPassword === null) {
    return;
  }

  const newPasswordConfirm = window.prompt("새 비밀번호를 다시 입력해 주세요.");
  if (newPasswordConfirm === null) {
    return;
  }

  if (newPassword !== newPasswordConfirm) {
    window.alert("새 비밀번호가 서로 다릅니다.");
    return;
  }

  const response = await fetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const result = await response.json();

  if (!response.ok) {
    window.alert(result.error || "비밀번호 변경에 실패했습니다.");
    return;
  }

  window.alert("비밀번호가 변경되었습니다.");
}

function updateAnnouncementAccessUI() {
  const accessState = me.announcementAccess;

  if (accessState === "approved") {
    announcementGate.textContent = "공지방 수락 완료. 관리자가 보낸 단체 공지를 확인할 수 있습니다.";
    announcementRequestBtn.style.display = "none";
    announcementLog.style.display = "flex";
    return;
  }

  announcementLog.style.display = "none";
  renderMessages(
    announcementLog,
    [],
    { currentUserId: me.id, showSenderName: false },
    "공지방 수락 전에는 메시지를 볼 수 없습니다."
  );

  if (accessState === "pending") {
    announcementGate.textContent = "공지방 신청 대기 중입니다. 관리자가 수락하면 자동으로 열립니다.";
    announcementRequestBtn.textContent = "신청 대기 중";
    announcementRequestBtn.disabled = true;
    announcementRequestBtn.style.display = "block";
    return;
  }

  announcementGate.textContent = "공지방은 신청 후 관리자가 수락해야 입장할 수 있습니다.";
  announcementRequestBtn.textContent = "공지방 신청하기";
  announcementRequestBtn.disabled = false;
  announcementRequestBtn.style.display = "block";
}

async function loadAnnouncementsIfAllowed() {
  if (me.announcementAccess !== "approved") {
    return;
  }
  const result = await fetchJson("/api/chat/announcements");
  renderMessages(
    announcementLog,
    result.messages || [],
    { currentUserId: me.id, showSenderName: true },
    "아직 공지가 없습니다."
  );
}

async function loadInitialData() {
  const meResult = await fetchJson("/api/me");

  if (!meResult.user) {
    window.location.href = "/login";
    return;
  }
  if (meResult.user.role === "admin") {
    window.location.href = "/admin";
    return;
  }
  if (!meResult.user.approved) {
    window.location.href = "/pending";
    return;
  }

  me = meResult.user;
  adminUser = meResult.adminUser;
  welcomeEl.textContent = `${me.displayName} 님 채팅`;

  const privateRes = await fetchJson(`/api/chat/private/${adminUser.id}`);
  renderMessages(
    privateLog,
    privateRes.messages || [],
    { currentUserId: me.id, showSenderName: false },
    "관리자에게 첫 메시지를 보내보세요."
  );

  updateAnnouncementAccessUI();
  await loadAnnouncementsIfAllowed();
}

function setupSocket() {
  socket = io();

  socket.on("announcement:new", (message) => {
    if (me.announcementAccess !== "approved") {
      return;
    }
    appendMessage(announcementLog, message, {
      currentUserId: me.id,
      showSenderName: true,
    });
  });

  socket.on("announcement:access-granted", async () => {
    me.announcementAccess = "approved";
    updateAnnouncementAccessUI();
    await loadAnnouncementsIfAllowed();
    window.alert("관리자가 공지방 신청을 수락했습니다.");
  });

  socket.on("private:new", (message) => {
    const inCurrentRoom =
      (message.fromUserId === me.id && message.toUserId === adminUser.id) ||
      (message.fromUserId === adminUser.id && message.toUserId === me.id);

    if (!inCurrentRoom) {
      return;
    }

    appendMessage(privateLog, message, {
      currentUserId: me.id,
      showSenderName: false,
    });
  });
}

announcementRequestBtn.addEventListener("click", async () => {
  announcementRequestBtn.disabled = true;
  try {
    const result = await fetchJson("/api/announcement-access/request", { method: "POST" });
    me.announcementAccess = result.announcementAccess;
    updateAnnouncementAccessUI();
  } catch (error) {
    window.alert(error.message);
    announcementRequestBtn.disabled = false;
  }
});

privateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = privateInput.value.trim();
  if (!text || !socket) {
    return;
  }

  socket.emit("private:send", {
    toUserId: adminUser.id,
    text,
  });
  privateInput.value = "";
});

changePasswordBtn.addEventListener("click", () => {
  runChangePasswordFlow().catch(() => {
    window.alert("비밀번호 변경 중 오류가 발생했습니다.");
  });
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

loadInitialData()
  .then(() => setupSocket())
  .catch(() => {
    window.alert("채팅 화면을 불러오지 못했습니다. 다시 로그인해 주세요.");
    window.location.href = "/login";
  });

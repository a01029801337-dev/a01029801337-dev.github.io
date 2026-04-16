const welcomeEl = document.getElementById("welcome");
const logoutBtn = document.getElementById("logout-btn");
const changePasswordBtn = document.getElementById("change-password-btn");
const pendingList = document.getElementById("pending-list");
const announcementRequestList = document.getElementById("announcement-request-list");
const announcementLog = document.getElementById("announcement-log");
const announcementForm = document.getElementById("announcement-form");
const announcementInput = document.getElementById("announcement-input");
const userPicker = document.getElementById("user-picker");
const deleteUserBtn = document.getElementById("delete-user-btn");
const privateLog = document.getElementById("private-log");
const privateForm = document.getElementById("private-form");
const privateInput = document.getElementById("private-input");

let me = null;
let selectedUserId = null;
let approvedUsers = [];
let socket = null;

function formatDateTime(iso) {
  const date = new Date(iso);
  return date.toLocaleString("ko-KR", { hour12: false });
}

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

function createActionButton(label, onClick, cssClass = "") {
  const button = document.createElement("button");
  button.textContent = label;
  if (cssClass) {
    button.classList.add(cssClass);
  }
  button.addEventListener("click", onClick);
  return button;
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

async function removeUser(userId) {
  await fetchJson(`/api/admin/users/${userId}`, { method: "DELETE" });
  await Promise.all([loadPending(), loadUsers(), loadAnnouncementRequests()]);
}

async function approveAnnouncementRequest(userId) {
  await fetchJson("/api/admin/announcement-approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  await Promise.all([loadAnnouncementRequests(), loadUsers()]);
}

async function loadMe() {
  const result = await fetchJson("/api/me");
  if (!result.user) {
    window.location.href = "/login";
    return;
  }
  if (result.user.role !== "admin") {
    window.location.href = "/";
    return;
  }

  me = result.user;
  welcomeEl.textContent = `${me.displayName} 대시보드`;
}

async function loadPending() {
  const result = await fetchJson("/api/admin/pending");
  pendingList.innerHTML = "";

  if (!result.users.length) {
    pendingList.innerHTML = '<div class="list-item">가입 승인 대기 회원이 없습니다.</div>';
    return;
  }

  result.users.forEach((user) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="name">${user.displayName} (${user.username})</div>
      <div class="meta">가입일: ${formatDateTime(user.createdAt)}</div>
    `;

    const actionRow = document.createElement("div");
    actionRow.className = "action-row";

    const approveBtn = createActionButton("가입 승인", async () => {
      approveBtn.disabled = true;
      try {
        await fetchJson("/api/admin/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
        await Promise.all([loadPending(), loadUsers()]);
      } catch (error) {
        window.alert(error.message);
      } finally {
        approveBtn.disabled = false;
      }
    });

    const deleteBtn = createActionButton("계정 탈퇴", async () => {
      const ok = window.confirm(`${user.displayName} 계정을 탈퇴 처리할까요?`);
      if (!ok) {
        return;
      }

      deleteBtn.disabled = true;
      try {
        await removeUser(user.id);
      } catch (error) {
        window.alert(error.message);
      } finally {
        deleteBtn.disabled = false;
      }
    }, "danger-btn");

    actionRow.appendChild(approveBtn);
    actionRow.appendChild(deleteBtn);
    item.appendChild(actionRow);
    pendingList.appendChild(item);
  });
}

async function loadAnnouncementRequests() {
  const result = await fetchJson("/api/admin/announcement-requests");
  announcementRequestList.innerHTML = "";

  if (!result.users.length) {
    announcementRequestList.innerHTML = '<div class="list-item">공지방 신청 대기가 없습니다.</div>';
    return;
  }

  result.users.forEach((user) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="name">${user.displayName} (${user.username})</div>
      <div class="meta">신청 상태: ${user.announcementAccess}</div>
    `;

    const approveBtn = createActionButton("공지방 수락", async () => {
      approveBtn.disabled = true;
      try {
        await approveAnnouncementRequest(user.id);
      } catch (error) {
        window.alert(error.message);
      } finally {
        approveBtn.disabled = false;
      }
    });

    item.appendChild(approveBtn);
    announcementRequestList.appendChild(item);
  });
}

async function loadUsers() {
  const result = await fetchJson("/api/admin/users");
  approvedUsers = result.users || [];
  const previousSelection = selectedUserId;
  userPicker.innerHTML = "";

  if (!approvedUsers.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "승인된 사용자가 없습니다.";
    userPicker.appendChild(option);
    selectedUserId = null;
    deleteUserBtn.disabled = true;
    renderMessages(privateLog, [], { currentUserId: me.id, showSenderName: true }, "1:1 대화 상대를 선택해 주세요.");
    return;
  }

  approvedUsers.forEach((user) => {
    const option = document.createElement("option");
    option.value = String(user.id);
    const announcementState = user.announcementAccess === "approved" ? "공지방 허용" : "공지방 미허용";
    option.textContent = `${user.displayName} (${user.username}, ${announcementState})`;
    userPicker.appendChild(option);
  });

  if (previousSelection && approvedUsers.some((user) => user.id === previousSelection)) {
    selectedUserId = previousSelection;
  } else {
    selectedUserId = approvedUsers[0].id;
  }

  userPicker.value = String(selectedUserId);
  deleteUserBtn.disabled = false;
  await loadPrivateMessages();
}

async function loadAnnouncements() {
  const result = await fetchJson("/api/chat/announcements");
  renderMessages(
    announcementLog,
    result.messages || [],
    { currentUserId: me.id, showSenderName: false },
    "아직 공지가 없습니다."
  );
}

async function loadPrivateMessages() {
  if (!selectedUserId) {
    renderMessages(privateLog, [], { currentUserId: me.id, showSenderName: true }, "1:1 대화 상대를 선택해 주세요.");
    return;
  }

  const result = await fetchJson(`/api/chat/private/${selectedUserId}`);
  renderMessages(
    privateLog,
    result.messages || [],
    { currentUserId: me.id, showSenderName: true },
    "아직 대화가 없습니다."
  );
}

function setupSocket() {
  socket = io();

  socket.on("announcement:new", (message) => {
    appendMessage(announcementLog, message, {
      currentUserId: me.id,
      showSenderName: false,
    });
  });

  socket.on("private:new", (message) => {
    if (!selectedUserId) {
      return;
    }

    const inCurrentConversation =
      (message.fromUserId === me.id && message.toUserId === selectedUserId) ||
      (message.fromUserId === selectedUserId && message.toUserId === me.id);

    if (!inCurrentConversation) {
      return;
    }

    appendMessage(privateLog, message, {
      currentUserId: me.id,
      showSenderName: true,
    });
  });

  socket.on("user:pending", () => {
    loadPending().catch(() => {});
  });

  socket.on("user:approved", () => {
    Promise.all([loadPending(), loadUsers()]).catch(() => {});
  });

  socket.on("user:deleted", () => {
    Promise.all([loadPending(), loadUsers(), loadAnnouncementRequests()]).catch(() => {});
  });

  socket.on("announcement:request:new", () => {
    loadAnnouncementRequests().catch(() => {});
  });

  socket.on("announcement:request:approved", () => {
    loadAnnouncementRequests().catch(() => {});
  });
}

userPicker.addEventListener("change", () => {
  selectedUserId = Number(userPicker.value);
  loadPrivateMessages().catch((error) => window.alert(error.message));
});

deleteUserBtn.addEventListener("click", async () => {
  if (!selectedUserId) {
    return;
  }

  const target = approvedUsers.find((user) => user.id === selectedUserId);
  const name = target ? target.displayName : "선택 사용자";
  const ok = window.confirm(`${name} 계정을 탈퇴 처리할까요?`);
  if (!ok) {
    return;
  }

  try {
    await removeUser(selectedUserId);
  } catch (error) {
    window.alert(error.message);
  }
});

announcementForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = announcementInput.value.trim();
  if (!text || !socket) {
    return;
  }
  socket.emit("announcement:send", { text });
  announcementInput.value = "";
});

privateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = privateInput.value.trim();
  if (!text || !socket || !selectedUserId) {
    return;
  }

  socket.emit("private:send", {
    toUserId: selectedUserId,
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

Promise.all([loadMe(), loadPending(), loadAnnouncementRequests(), loadUsers(), loadAnnouncements()])
  .then(() => setupSocket())
  .catch(() => {
    window.alert("관리자 화면을 불러오지 못했습니다. 다시 로그인해 주세요.");
    window.location.href = "/login";
  });

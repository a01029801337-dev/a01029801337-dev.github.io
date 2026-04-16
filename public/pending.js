const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh-btn");
const logoutBtn = document.getElementById("logout-btn");
const changePasswordBtn = document.getElementById("change-password-btn");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

async function checkStatus() {
  const response = await fetch("/api/me");
  const result = await response.json();

  if (!result.user) {
    window.location.href = "/login";
    return;
  }

  if (result.user.role === "admin") {
    window.location.href = "/admin";
    return;
  }

  if (result.user.approved) {
    window.location.href = "/chat";
    return;
  }

  setStatus("승인 대기 중입니다. 자동 새로고침 중...");
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
    setStatus("새 비밀번호가 서로 다릅니다.", "error");
    return;
  }

  const response = await fetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const result = await response.json();

  if (!response.ok) {
    setStatus(result.error || "비밀번호 변경 실패", "error");
    return;
  }

  setStatus("비밀번호가 변경되었습니다.", "success");
}

refreshBtn.addEventListener("click", () => {
  checkStatus().catch(() => setStatus("상태 확인 실패", "error"));
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

changePasswordBtn.addEventListener("click", () => {
  runChangePasswordFlow().catch(() => {
    setStatus("비밀번호 변경 중 오류", "error");
  });
});

checkStatus().catch(() => setStatus("상태 확인 실패", "error"));
setInterval(() => {
  checkStatus().catch(() => setStatus("상태 확인 실패", "error"));
}, 3000);

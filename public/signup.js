const form = document.getElementById("signup-form");
const statusEl = document.getElementById("status");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("가입 처리 중...");

  const formData = new FormData(form);
  const payload = {
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
  };

  try {
    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error || "회원가입에 실패했습니다.", "error");
      return;
    }

    setStatus("회원가입 완료. 로그인 후 관리자 승인을 기다려 주세요.", "success");
    setTimeout(() => {
      window.location.href = "/login";
    }, 1100);
  } catch (error) {
    setStatus("서버와 통신할 수 없습니다.", "error");
  }
});

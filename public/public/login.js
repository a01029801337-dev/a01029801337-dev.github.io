const form = document.getElementById("login-form");
const statusEl = document.getElementById("status");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("로그인 중...");

  const formData = new FormData(form);
  const payload = {
    username: formData.get("username"),
    password: formData.get("password"),
  };

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error || "로그인에 실패했습니다.", "error");
      return;
    }

    window.location.href = result.redirect || "/";
  } catch (error) {
    setStatus("서버와 통신할 수 없습니다.", "error");
  }
});

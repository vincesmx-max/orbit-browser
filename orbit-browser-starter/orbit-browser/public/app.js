const $ = id => document.getElementById(id);
let mode = "login";
let currentUser = null;

document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => setMode(btn.dataset.mode)));
function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  $("authTitle").textContent = mode === "login" ? "Welcome back" : "Create your Orbit account";
  $("authSubtitle").textContent = mode === "login" ? "Sign in to continue to Orbit." : "Set up your account to enter Orbit.";
  $("authSubmit").innerHTML = mode === "login" ? 'Sign in <span>↗</span>' : 'Create account <span>↗</span>';
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authMessage").textContent = "";
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function showApp(user) {
  currentUser = user;
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("userEmail").textContent = user.email;
  $("userRole").textContent = user.role === "admin" ? "Administrator" : "Member";
  $("adminNav").classList.toggle("hidden", user.role !== "admin");
}
function showAuth() { $("appView").classList.add("hidden"); $("authView").classList.remove("hidden"); }
$("authForm").addEventListener("submit", async e => {
  e.preventDefault(); $("authMessage").textContent = "Please wait…";
  try {
    const data = await api(mode === "login" ? "/api/login" : "/api/signup", { method: "POST", body: JSON.stringify({ email: $("email").value, password: $("password").value }) });
    showApp(data.user);
  } catch (err) { $("authMessage").textContent = err.message; }
});
$("logoutBtn").addEventListener("click", async () => { try { await api("/api/logout", { method: "POST" }); } finally { showAuth(); } });
$("homeNav").addEventListener("click", () => { $("browserPage").classList.remove("hidden"); $("adminPage").classList.add("hidden"); $("homeNav").classList.add("selected"); $("adminNav").classList.remove("selected"); });
$("adminNav").addEventListener("click", async () => {
  $("browserPage").classList.add("hidden"); $("adminPage").classList.remove("hidden"); $("adminNav").classList.add("selected"); $("homeNav").classList.remove("selected");
  try {
    const data = await api("/api/admin/overview");
    $("statUsers").textContent = data.counts.users; $("statVisits").textContent = data.counts.visits; $("statSessions").textContent = "—";
    $("eventsBody").innerHTML = data.events.map(e => `<tr><td>${esc(e.email || "System")}</td><td>${esc(e.event_type)}</td><td>${esc(e.detail || "")}</td><td>${esc(e.created_at)}</td></tr>`).join("");
    $("usersBody").innerHTML = data.users.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.created_at)}</td></tr>`).join("");
  } catch (err) { $("eventsBody").innerHTML = `<tr><td colspan="4">${esc(err.message)}</td></tr>`; }
});
function esc(value) { return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
$("browseForm").addEventListener("submit", async e => {
  e.preventDefault();
  let address = $("address").value.trim();
  if (!/^https?:\/\//i.test(address)) address = "https://" + address;
  $("resultPanel").classList.remove("hidden"); $("resultTitle").textContent = "Loading " + address; $("resultContent").textContent = "Fetching page through Orbit…";
  try {
    const data = await api("/api/proxy?url=" + encodeURIComponent(address));
    $("resultTitle").textContent = "HTML preview · " + new URL(address).hostname;
    $("resultContent").textContent = data;
  } catch (err) { $("resultTitle").textContent = "Could not load page"; $("resultContent").textContent = err.message; }
});
$("closeResult").addEventListener("click", () => $("resultPanel").classList.add("hidden"));
api("/api/me").then(data => { if (data.user) showApp(data.user); }).catch(() => {});

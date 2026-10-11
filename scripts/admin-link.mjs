/* Dev preview er jonno fresh admin link banay:
     ADMIN_PASS='...' node scripts/admin-link.mjs [path]
   Token 7 din valid. Preview host env diye override korte paren: PREVIEW_HOST=... */
const base = process.env.PREVIEW_HOST || "http://127.0.0.1:3000";
const path = process.argv[2] || "/admin/promotions";
const email = process.env.ADMIN_EMAIL || "Sinzo.bd@gmail.com";
const password = process.env.ADMIN_PASS || "";
if (!password) {
  console.error("Set ADMIN_PASS in the environment before running scripts/admin-link.mjs");
  process.exit(2);
}
const r = await fetch((process.env.BASE || "http://127.0.0.1:3000") + "/api/admin/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
});
const j = await r.json();
if (!j.token) { console.error("Login failed:", j); process.exit(1); }
console.log(base + path + "?t=" + encodeURIComponent(j.token));

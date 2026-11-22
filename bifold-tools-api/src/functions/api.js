const { app } = require("@azure/functions");
const { dispatch } = require("../lib");

// Buttons like "Draft campaign" or "Approve" send no body; an empty body means "no fields", not an error.
// Malformed JSON still throws so lib.js answers 400.
const readJson = req => async () => {
  const t = await req.text();
  return t && t.trim() ? JSON.parse(t) : {};
};

app.http("api", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "anonymous", // Static Web Apps already requires sign-in; lib.js checks the user on every call.
  route: "{*path}",
  handler: async (req, ctx) => {
    const r = await dispatch(req.method, req.params.path, n => req.headers.get(n), readJson(req), ctx);
    if (r.raw) return { status: r.status, body: r.raw, headers: r.headers };
    return r.body === undefined
      ? { status: r.status, headers: { "Cache-Control": "no-store" } }
      : { status: r.status, jsonBody: r.body, headers: { "Cache-Control": "no-store" } };
  },
});

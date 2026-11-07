const { app } = require("@azure/functions");
const { dispatch } = require("../lib");

app.http("api", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "anonymous", // Static Web Apps already requires sign-in; lib.js checks the user on every call.
  route: "{*path}",
  handler: async (req, ctx) => {
    const r = await dispatch(req.method, req.params.path, n => req.headers.get(n), () => req.json(), ctx);
    return r.body === undefined
      ? { status: r.status, headers: { "Cache-Control": "no-store" } }
      : { status: r.status, jsonBody: r.body, headers: { "Cache-Control": "no-store" } };
  },
});

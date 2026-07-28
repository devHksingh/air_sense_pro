// Custom replacement for express-mongo-sanitize + hpp, both of which
// reassign `req.query = ...` — broken under Express 5, where req.query
// became a read-only getter (see: https://expressjs.com/en/guide/migrating-5/).
// This mutates the existing query/body/params objects in place instead,
// which Express 5 allows.

function stripMongoOperators(obj) {
  if (!obj || typeof obj !== "object") return;

  for (const key of Object.keys(obj)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete obj[key];
      continue;
    }
    if (obj[key] && typeof obj[key] === "object") {
      stripMongoOperators(obj[key]);
    }
  }
}

const sanitizeRequest = (req, res, next) => {
  stripMongoOperators(req.body);
  stripMongoOperators(req.params);
  stripMongoOperators(req.query); // mutated in place — never reassigned
  next();
};

export default sanitizeRequest;
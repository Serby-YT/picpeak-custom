jest.mock("../database/db", () => ({ db: jest.fn() }));
jest.mock("../middleware/auth", () => ({ adminAuth: (req, res, next) => next() }));
jest.mock("../middleware/permissions", () => ({ requirePermission: () => (req, res, next) => next() }));

const { cleanUrl } = require("../routes/adminPhotographers");

describe("photographer portfolio links", () => {
  test("keeps absolute http(s) links", () => {
    expect(cleanUrl("https://mihneavisuals.wfolio.pro")).toBe("https://mihneavisuals.wfolio.pro/");
    expect(cleanUrl("http://example.com/a?b=1")).toBe("http://example.com/a?b=1");
  });

  test("adds https:// to a bare domain", () => {
    expect(cleanUrl("  mihneavisuals.wfolio.pro ")).toBe("https://mihneavisuals.wfolio.pro/");
    expect(cleanUrl("instagram.com/serby.photo")).toBe("https://instagram.com/serby.photo");
  });

  test("rejects anything that is not a public web link", () => {
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(cleanUrl("mailto:a@b.com")).toBeNull();
    expect(cleanUrl("ftp://example.com")).toBeNull();
    expect(cleanUrl("localhost")).toBeNull();
    expect(cleanUrl("")).toBeNull();
    expect(cleanUrl(undefined)).toBeNull();
    expect(cleanUrl("https://example.com/" + "a".repeat(600))).toBeNull();
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET, results } from "./route";

const MOCK_ID = "test-result-id";
const CONTENT = Buffer.from("0123456789abcdef"); // 16 bytes

function makeRequest(rangeHeader?: string): Request {
  const url = `http://localhost/api/dub?resultId=${MOCK_ID}`;
  const headers: Record<string, string> = {};
  if (rangeHeader) headers["range"] = rangeHeader;
  return new Request(url, { headers });
}

beforeEach(() => {
  results.set(MOCK_ID, { buffer: CONTENT, mimeType: "video/mp4", filename: "dubbed.mp4" });
});

afterEach(() => {
  results.delete(MOCK_ID);
});

// ─── resultId 검증 ────────────────────────────────────────────────────────────

describe("GET /api/dub — resultId 검증", () => {
  it("resultId 없으면 400을 반환한다", async () => {
    const res = await GET(new Request("http://localhost/api/dub"));
    expect(res.status).toBe(400);
  });

  it("존재하지 않는 resultId면 404를 반환한다", async () => {
    const res = await GET(new Request("http://localhost/api/dub?resultId=unknown"));
    expect(res.status).toBe(404);
  });
});

// ─── 전체 응답 (Range 없음) ────────────────────────────────────────────────────

describe("GET /api/dub — Range 헤더 없음", () => {
  it("200을 반환한다", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it("Accept-Ranges: bytes 헤더를 포함한다", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("Content-Length가 전체 바이트 수와 일치한다", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Content-Length")).toBe(String(CONTENT.byteLength));
  });

  it("Content-Disposition이 inline이다", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="dubbed.mp4"');
  });

  it("전체 본문을 반환한다", async () => {
    const res = await GET(makeRequest());
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(CONTENT);
  });
});

// ─── Range 요청 (206 Partial Content) ────────────────────────────────────────

describe("GET /api/dub — Range 요청", () => {
  it("206을 반환한다", async () => {
    const res = await GET(makeRequest("bytes=0-7"));
    expect(res.status).toBe(206);
  });

  it("Content-Range 헤더가 정확하다", async () => {
    const res = await GET(makeRequest("bytes=0-7"));
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-7/${CONTENT.byteLength}`);
  });

  it("Content-Length가 청크 크기와 일치한다", async () => {
    const res = await GET(makeRequest("bytes=0-7"));
    expect(res.headers.get("Content-Length")).toBe("8");
  });

  it("해당 범위의 바이트만 반환한다", async () => {
    const res = await GET(makeRequest("bytes=0-7"));
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(CONTENT.subarray(0, 8));
  });

  it("끝 바이트 생략 시 파일 끝까지 반환한다 (bytes=4-)", async () => {
    const res = await GET(makeRequest("bytes=4-"));
    expect(res.status).toBe(206);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(CONTENT.subarray(4));
    expect(res.headers.get("Content-Range")).toBe(
      `bytes 4-${CONTENT.byteLength - 1}/${CONTENT.byteLength}`
    );
  });

  it("마지막 1바이트 요청이 정확하다", async () => {
    const last = CONTENT.byteLength - 1;
    const res = await GET(makeRequest(`bytes=${last}-${last}`));
    expect(res.status).toBe(206);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(CONTENT.subarray(last));
  });
});

// ─── 잘못된 Range (416) ────────────────────────────────────────────────────────

describe("GET /api/dub — 잘못된 Range", () => {
  it("start > end이면 416을 반환한다", async () => {
    const res = await GET(makeRequest("bytes=10-5"));
    expect(res.status).toBe(416);
  });

  it("end >= 파일 크기이면 416을 반환한다", async () => {
    const res = await GET(makeRequest(`bytes=0-${CONTENT.byteLength}`));
    expect(res.status).toBe(416);
  });

  it("파싱 불가능한 Range면 416을 반환한다", async () => {
    const res = await GET(makeRequest("bytes=invalid"));
    expect(res.status).toBe(416);
  });
});

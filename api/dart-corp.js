const zlib = require("zlib");

let cachedCorpMap = null;
let cachedAt = 0;

const CACHE_MS = 24 * 60 * 60 * 1000;

function xmlDecode(text = "") {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractFileFromZip(buffer) {
  // DART corpCode.xml ZIP은 일반적으로 deflate 압축.
  // ZIP local file header를 직접 읽어서 외부 라이브러리 없이 처리.
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("올바른 ZIP 파일이 아닙니다.");
  }

  const compressionMethod = buffer.readUInt16LE(8);
  const compressedSize = buffer.readUInt32LE(18);
  const fileNameLength = buffer.readUInt16LE(26);
  const extraLength = buffer.readUInt16LE(28);

  const dataStart =
    30 + fileNameLength + extraLength;

  const compressedData =
    buffer.subarray(
      dataStart,
      dataStart + compressedSize
    );

  if (compressionMethod === 0) {
    return compressedData;
  }

  if (compressionMethod === 8) {
    return zlib.inflateRawSync(compressedData);
  }

  throw new Error(
    `지원하지 않는 ZIP 압축 방식: ${compressionMethod}`
  );
}

async function loadCorpMap(apiKey) {
  const now = Date.now();

  if (
    cachedCorpMap &&
    now - cachedAt < CACHE_MS
  ) {
    return cachedCorpMap;
  }

  const url =
    `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `DART corpCode HTTP ${response.status}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const zipBuffer =
    Buffer.from(arrayBuffer);

  const xmlBuffer =
    extractFileFromZip(zipBuffer);

  const xml =
    xmlBuffer.toString("utf8");

  const map = new Map();

  const regex =
    /<list>\s*<corp_code>(.*?)<\/corp_code>\s*<corp_name>(.*?)<\/corp_name>\s*<corp_eng_name>(.*?)<\/corp_eng_name>\s*<stock_code>(.*?)<\/stock_code>\s*<modify_date>(.*?)<\/modify_date>\s*<\/list>/gs;

  let match;

  while (
    (match = regex.exec(xml)) !== null
  ) {
    const corpCode =
      (match[1] || "").trim();

    const corpName =
      xmlDecode(
        (match[2] || "").trim()
      );

    const stockCode =
      (match[4] || "").trim();

    if (
      stockCode &&
      stockCode.length === 6
    ) {
      map.set(stockCode, {
        corpCode,
        corpName,
        stockCode
      });
    }
  }

  if (map.size === 0) {
    throw new Error(
      "DART 기업코드 목록을 읽지 못했습니다."
    );
  }

  cachedCorpMap = map;
  cachedAt = now;

  return map;
}

module.exports = async function handler(req, res) {
  try {
    const apiKey =
      process.env.DART_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error:
          "DART_API_KEY 환경변수가 없습니다."
      });
    }

    const code =
      String(
        req.query.code || ""
      )
        .trim()
        .padStart(6, "0");

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        error:
          "종목코드 6자리를 입력하세요.",
        example:
          "/api/dart-corp?code=005930"
      });
    }

    const corpMap =
      await loadCorpMap(apiKey);

    const company =
      corpMap.get(code);

    if (!company) {
      return res.status(404).json({
        ok: false,
        code,
        error:
          "DART에서 해당 상장 종목을 찾지 못했습니다."
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=86400"
    );

    return res.status(200).json({
      ok: true,
      version:
        "DART_CORP_MAP_V1",

      code:
        company.stockCode,

      corpCode:
        company.corpCode,

      corpName:
        company.corpName
    });

  } catch (error) {
    console.error(
      "DART CORP ERROR",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        String(
          error?.message ||
          error
        )
    });
  }
};

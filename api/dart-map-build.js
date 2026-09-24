const zlib = require("zlib");

module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.DART_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "DART_API_KEY가 없습니다."
      });
    }

    const url =
      "https://opendart.fss.or.kr/api/corpCode.xml" +
      "?crtfc_key=" +
      encodeURIComponent(apiKey);

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: "DART corpCode 다운로드 실패",
        status: response.status
      });
    }

    const arrayBuffer =
      await response.arrayBuffer();

    const zip =
      Buffer.from(arrayBuffer);

    if (
      zip.length < 30 ||
      zip.readUInt32LE(0) !== 0x04034b50
    ) {
      return res.status(500).json({
        ok: false,
        error: "DART 응답이 ZIP 파일이 아닙니다.",
        bytes: zip.length
      });
    }

    const method =
      zip.readUInt16LE(8);

    const compressedSize =
      zip.readUInt32LE(18);

    const fileNameLength =
      zip.readUInt16LE(26);

    const extraLength =
      zip.readUInt16LE(28);

    const start =
      30 +
      fileNameLength +
      extraLength;

    const end =
      start +
      compressedSize;

    const compressed =
      zip.subarray(start, end);

    let xmlBuffer;

    if (method === 0) {
      xmlBuffer = compressed;
    } else if (method === 8) {
      xmlBuffer =
        zlib.inflateRawSync(compressed);
    } else {
      return res.status(500).json({
        ok: false,
        error:
          "지원하지 않는 ZIP 압축 방식",
        method
      });
    }

    const xml =
      xmlBuffer.toString("utf8");

    const blocks =
      xml.match(
        /<list>[\s\S]*?<\/list>/g
      ) || [];

    let listedCompanies = 0;

    const samples = [];

    for (const block of blocks) {
      const stockMatch =
        block.match(
          /<stock_code>(.*?)<\/stock_code>/
        );

      const corpMatch =
        block.match(
          /<corp_code>(.*?)<\/corp_code>/
        );

      const nameMatch =
        block.match(
          /<corp_name>(.*?)<\/corp_name>/
        );

      const stockCode =
        stockMatch
          ? stockMatch[1].trim()
          : "";

      if (!/^\d{6}$/.test(stockCode)) {
        continue;
      }

      listedCompanies++;

      if (samples.length < 10) {
        samples.push({
          stockCode,
          corpCode:
            corpMatch
              ? corpMatch[1].trim()
              : "",
          corpName:
            nameMatch
              ? nameMatch[1].trim()
              : ""
        });
      }
    }

    return res.status(200).json({
      ok: true,

      version:
        "DART_MAP_TEST_V1",

      zipBytes:
        zip.length,

      xmlBytes:
        xmlBuffer.length,

      totalCorpRecords:
        blocks.length,

      listedCompanies,

      samples
    });
  } catch (error) {
    console.error(
      "DART MAP TEST ERROR",
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

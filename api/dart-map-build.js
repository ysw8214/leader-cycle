const zlib = require("zlib");

/*
  DART 전체 기업코드에서
  주식 종목코드가 존재하는 상장회사만 추출.

  결과:
  stockCode -> corpCode / corpName

  이 API는 평소 rankings에서 호출하지 않고
  매핑 JSON을 한 번 생성하기 위한 용도.
*/

function decodeXml(text = "") {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}


/* ==========================================
   ZIP 첫 번째 파일 압축 해제
========================================== */

function unzipFirstFile(buffer) {

  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 30 ||
    buffer.readUInt32LE(0) !== 0x04034b50
  ) {
    throw new Error(
      "DART 응답이 정상적인 ZIP 파일이 아닙니다."
    );
  }

  const method =
    buffer.readUInt16LE(8);

  const compressedSize =
    buffer.readUInt32LE(18);

  const fileNameLength =
    buffer.readUInt16LE(26);

  const extraLength =
    buffer.readUInt16LE(28);

  const start =
    30 +
    fileNameLength +
    extraLength;

  const end =
    start +
    compressedSize;

  if (
    start < 0 ||
    end > buffer.length
  ) {
    throw new Error(
      "ZIP 데이터 길이가 올바르지 않습니다."
    );
  }

  const compressed =
    buffer.subarray(
      start,
      end
    );


  // 압축하지 않고 저장된 파일
  if (method === 0) {
    return compressed;
  }


  // Deflate 압축
  if (method === 8) {
    return zlib.inflateRawSync(
      compressed
    );
  }


  throw new Error(
    `지원하지 않는 ZIP 압축 방식: ${method}`
  );
}


/* ==========================================
   MAIN
========================================== */

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


    /* ========================================
       DART 전체 기업코드 다운로드
    ======================================== */

    const url =
      "https://opendart.fss.or.kr/api/corpCode.xml" +
      `?crtfc_key=${encodeURIComponent(apiKey)}`;


    const response =
      await fetch(url);


    if (!response.ok) {

      throw new Error(
        `DART HTTP ${response.status}`
      );

    }


    const arrayBuffer =
      await response.arrayBuffer();


    const zipBuffer =
      Buffer.from(arrayBuffer);


    /* ========================================
       ZIP -> XML
    ======================================== */

    const xmlBuffer =
      unzipFirstFile(zipBuffer);


    const xml =
      xmlBuffer.toString("utf8");


    /* ========================================
       기업 목록 파싱
    ======================================== */

    const blocks =
      xml.match(
        /<list>[\s\S]*?<\/list>/g
      ) || [];


    const map = {};


    for (const block of blocks) {

      const getValue = tag => {

        const regex =
          new RegExp(
            `<${tag}>([\\s\\S]*?)<\\/${tag}>`
          );

        const match =
          block.match(regex);


        if (!match) {
          return "";
        }


        return decodeXml(
          match[1].trim()
        );
      };


      const corpCode =
        getValue("corp_code");

      const corpName =
        getValue("corp_name");

      const stockCode =
        getValue("stock_code");


      /*
        DART에서 stock_code가 없는 회사는
        여기서 제외.

        6자리 주식 종목코드가 존재하는
        상장회사만 저장.
      */

      if (
        !/^\d{6}$/.test(stockCode)
      ) {
        continue;
      }


      map[stockCode] = {

        corpCode,

        corpName

      };

    }


    const total =
      Object.keys(map).length;


    if (total === 0) {

      throw new Error(
        "상장기업 DART 매핑을 만들지 못했습니다."
      );

    }


    /* ========================================
       JSON 파일로 응답
    ======================================== */

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );


    res.setHeader(
      "Content-Disposition",
      'attachment; filename="dart-corp-map.json"'
    );


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    return res
      .status(200)
      .send(
        JSON.stringify(
          map,
          null,
          2
        )
      );


  } catch (error) {

    console.error(
      "DART MAP BUILD ERROR",
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

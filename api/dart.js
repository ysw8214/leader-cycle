module.exports = async function handler(req, res) {
  try {
    /*
      ==========================================
      DART ANALYZER V2

      기능
      1. 종목코드 -> DART corp_code 찾기
      2. 기업 기본정보
      3. 최근 재무제표
      4. 전년도 재무제표
      5. 성장률 계산
      6. 재무 건전성/성장성 점수 계산

      환경변수:
      DART_API_KEY
      ==========================================
    */

    const API_KEY = process.env.DART_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "DART_API_KEY 환경변수가 없습니다."
      });
    }

    const code = String(req.query.code || "005930")
      .replace(/[^0-9]/g, "")
      .padStart(6, "0");

    if (code.length !== 6) {
      return res.status(400).json({
        ok: false,
        error: "올바른 6자리 종목코드를 입력하세요."
      });
    }

    /*
      ==========================================
      HELPERS
      ==========================================
    */

    const num = (value) => {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        return 0;
      }

      const n = Number(
        String(value)
          .replace(/,/g, "")
          .replace(/\s/g, "")
      );

      return Number.isFinite(n) ? n : 0;
    };

    const round = (value, digits = 2) => {
      const n = Number(value);

      if (!Number.isFinite(n)) {
        return 0;
      }

      const p = 10 ** digits;

      return Math.round(n * p) / p;
    };

    const clamp = (value, min, max) =>
      Math.max(min, Math.min(max, value));

    const growth = (current, previous) => {
      current = num(current);
      previous = num(previous);

      if (!previous) {
        return null;
      }

      return round(
        ((current - previous) /
          Math.abs(previous)) *
          100,
        2
      );
    };

    /*
      ==========================================
      XML parser

      corpCode.xml에서
      종목코드에 해당하는 corp_code 검색
      ==========================================
    */

    function findCorpFromXml(xml, stockCode) {
      const blocks =
        xml.match(/<list>[\s\S]*?<\/list>/g) || [];

      for (const block of blocks) {
        const stockMatch =
          block.match(
            /<stock_code>(.*?)<\/stock_code>/
          );

        if (!stockMatch) {
          continue;
        }

        const foundStock =
          stockMatch[1].trim();

        if (foundStock !== stockCode) {
          continue;
        }

        const corpMatch =
          block.match(
            /<corp_code>(.*?)<\/corp_code>/
          );

        const nameMatch =
          block.match(
            /<corp_name>(.*?)<\/corp_name>/
          );

        return {
          corpCode:
            corpMatch
              ? corpMatch[1].trim()
              : "",

          corpName:
            nameMatch
              ? nameMatch[1].trim()
              : "",

          stockCode:
            foundStock
        };
      }

      return null;
    }

    /*
      ==========================================
      1. CORP CODE 다운로드
      ==========================================
    */

    const corpUrl =
      `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(
        API_KEY
      )}`;

    const corpResponse =
      await fetch(corpUrl);

    if (!corpResponse.ok) {
      return res.status(500).json({
        ok: false,
        error: "DART corpCode 호출 실패",
        status: corpResponse.status
      });
    }

    /*
      corpCode.xml API는 ZIP 파일을 반환한다.

      Vercel Node 환경에서 unzip을 위해
      zlib을 사용한다.
    */

    const arrayBuffer =
      await corpResponse.arrayBuffer();

    const buffer =
      Buffer.from(arrayBuffer);

    let xmlText = "";

    /*
      ==========================================
      ZIP 안의 XML 직접 추출

      외부 npm 패키지 없이 처리
      ==========================================
    */

    try {
      const zlib = require("zlib");

      /*
        ZIP local file header
        signature = 0x04034b50
      */

      if (
        buffer.readUInt32LE(0) !==
        0x04034b50
      ) {
        throw new Error(
          "DART corpCode 응답이 ZIP 형식이 아닙니다."
        );
      }

      const compressionMethod =
        buffer.readUInt16LE(8);

      const compressedSize =
        buffer.readUInt32LE(18);

      const fileNameLength =
        buffer.readUInt16LE(26);

      const extraLength =
        buffer.readUInt16LE(28);

      const dataStart =
        30 +
        fileNameLength +
        extraLength;

      const compressedData =
        buffer.subarray(
          dataStart,
          dataStart + compressedSize
        );

      if (compressionMethod === 0) {
        xmlText =
          compressedData.toString("utf8");
      } else if (compressionMethod === 8) {
        xmlText =
          zlib
            .inflateRawSync(compressedData)
            .toString("utf8");
      } else {
        throw new Error(
          `지원하지 않는 ZIP 압축 방식: ${compressionMethod}`
        );
      }
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          "DART corpCode ZIP 해제 실패",
        detail:
          String(
            error?.message ||
            error
          )
      });
    }

    const corp =
      findCorpFromXml(
        xmlText,
        code
      );

    if (!corp?.corpCode) {
      return res.status(404).json({
        ok: false,
        error:
          "DART에서 종목의 corp_code를 찾지 못했습니다.",
        code
      });
    }

    /*
      ==========================================
      2. 기업 기본정보
      ==========================================
    */

    const companyUrl =
      "https://opendart.fss.or.kr/api/company.json" +
      `?crtfc_key=${encodeURIComponent(API_KEY)}` +
      `&corp_code=${encodeURIComponent(corp.corpCode)}`;

    const companyResponse =
      await fetch(companyUrl);

    const company =
      await companyResponse.json();

    /*
      ==========================================
      3. 사용할 사업연도 결정

      현재 날짜 기준으로 최근 확정 가능성이 높은
      사업연도부터 역순으로 탐색

      예:
      2026년 -> 2025 -> 2024 -> ...
      ==========================================
    */

    const currentYear =
      new Date().getFullYear();

    /*
      재무제표 API
      reprt_code

      11011 = 사업보고서
      ==========================================
    */

   

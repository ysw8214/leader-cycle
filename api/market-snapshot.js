/* =========================================================
   LEADER CYCLE - MARKET SNAPSHOT V3

   역할
   ---------------------------------------------------------
   1. KOSPI + KOSDAQ 전체 종목 당일 시세 수집
   2. 휴일 / 주말 / 장 시작 전 빈 데이터 자동 감지
   3. 최근 실제 거래일까지 자동 fallback
   4. sector-scan / market-scan 공통 시장 데이터 소스
   5. 과거 거래일 snapshot 장기 CDN 캐시
   6. 오늘 snapshot은 단기 캐시

   V3 핵심
   ---------------------------------------------------------
   과거 거래일 데이터는 이미 확정된 데이터이므로
   Vercel CDN에서 장기 캐시한다.

   rankings V9에서 날짜별 snapshot을 재사용하면
   동일 과거 날짜를 KRX에서 반복 조회하는 것을 줄일 수 있다.
========================================================= */

module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  try {
    const KRX_API_KEY =
      process.env.KRX_API_KEY;

    if (!KRX_API_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "KRX_API_KEY 환경변수가 없습니다."
      });
    }

    /* =====================================================
       HELPERS
    ===================================================== */

    function num(value) {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        return 0;
      }

      const parsed =
        Number(
          String(value)
            .replace(/,/g, "")
            .trim()
        );

      return Number.isFinite(parsed)
        ? parsed
        : 0;
    }

    function formatDate(date) {
      const year =
        date.getFullYear();

      const month =
        String(
          date.getMonth() + 1
        ).padStart(2, "0");

      const day =
        String(
          date.getDate()
        ).padStart(2, "0");

      return `${year}${month}${day}`;
    }

    function parseDate(value) {
      const text =
        String(value || "")
          .replace(/-/g, "")
          .trim();

      if (!/^\d{8}$/.test(text)) {
        return null;
      }

      const year =
        Number(
          text.slice(0, 4)
        );

      const month =
        Number(
          text.slice(4, 6)
        );

      const day =
        Number(
          text.slice(6, 8)
        );

      const date =
        new Date(
          year,
          month - 1,
          day
        );

      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return null;
      }

      return date;
    }

    function previousDay(date) {
      const result =
        new Date(date);

      result.setDate(
        result.getDate() - 1
      );

      return result;
    }

    /*
      한국 기준 오늘 날짜 YYYYMMDD
    */

    function getKoreaToday() {
      const formatter =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone:
              "Asia/Seoul",

            year:
              "numeric",

            month:
              "2-digit",

            day:
              "2-digit"
          }
        );

      const parts =
        formatter.formatToParts(
          new Date()
        );

      const values = {};

      for (const part of parts) {
        if (
          part.type !==
          "literal"
        ) {
          values[
            part.type
          ] =
            part.value;
        }
      }

      return (
        `${values.year}` +
        `${values.month}` +
        `${values.day}`
      );
    }

    /* =====================================================
       REQUESTED DATE
    ===================================================== */

    const rawDate =
      String(
        req.query.date || ""
      ).trim();

    let startDate;

    /*
      사용자가 날짜를 직접 지정했다면
      해당 날짜부터 fallback 시작
    */

    if (rawDate) {
      startDate =
        parseDate(rawDate);

      if (!startDate) {
        return res.status(400).json({
          ok: false,

          error:
            "date 형식이 올바르지 않습니다.",

          example:
            "20260922"
        });
      }

    } else {
      /*
        Vercel 서버는 UTC 기반일 수 있으므로
        현재 한국 날짜 생성
      */

      const koreaToday =
        getKoreaToday();

      startDate =
        parseDate(
          koreaToday
        );
    }

    /* =====================================================
       KRX FETCH
    ===================================================== */

    async function fetchKRX(
      url,
      market
    ) {
      try {
        const response =
          await fetch(
            url,
            {
              method:
                "GET",

              headers: {
                AUTH_KEY:
                  KRX_API_KEY,

                Accept:
                  "application/json"
              }
            }
          );

        const text =
          await response.text();

        if (!response.ok) {
          return {
            ok: false,

            market,

            status:
              response.status,

            rows: [],

            error:
              `KRX HTTP ${response.status}`
          };
        }

        let data;

        try {
          data =
            JSON.parse(text);

        } catch {
          return {
            ok: false,

            market,

            status:
              response.status,

            rows: [],

            error:
              "KRX JSON 파싱 실패"
          };
        }

        let rows = [];

        if (
          Array.isArray(
            data?.OutBlock_1
          )
        ) {
          rows =
            data.OutBlock_1;

        } else if (
          Array.isArray(
            data?.output
          )
        ) {
          rows =
            data.output;

        } else if (
          Array.isArray(
            data?.data
          )
        ) {
          rows =
            data.data;

        } else if (
          Array.isArray(data)
        ) {
          rows =
            data;
        }

        return {
          ok: true,

          market,

          status:
            response.status,

          rows,

          rawCount:
            rows.length
        };

      } catch (error) {
        return {
          ok: false,

          market,

          status:
            null,

          rows: [],

          error:
            String(
              error?.message ||
              error
            )
        };
      }
    }

    /* =====================================================
       NORMALIZE
    ===================================================== */

    function normalizeRow(
      row,
      market,
      basDd
    ) {
      const rawCode =
        String(
          row.ISU_SRT_CD ||
          row.SRT_CD ||
          row.ISU_CD ||
          ""
        ).trim();

      const codeMatch =
        rawCode.match(
          /(\d{6})/
        );

      const code =
        codeMatch
          ? codeMatch[1]
          : rawCode;

      return {
        date:
          String(
            row.BAS_DD ||
            basDd
          ).trim(),

        code,

        name:
          String(
            row.ISU_ABBRV ||
            row.ISU_NM ||
            row.ITMS_NM ||
            ""
          ).trim(),

        market,

        open:
          num(
            row.TDD_OPNPRC ??
            row.OPNPRC ??
            row.OPEN
          ),

        high:
          num(
            row.TDD_HGPRC ??
            row.HGPRC ??
            row.HIGH
          ),

        low:
          num(
            row.TDD_LWPRC ??
            row.LWPRC ??
            row.LOW
          ),

        close:
          num(
            row.TDD_CLSPRC ??
            row.CLSPRC ??
            row.CLOSE
          ),

        changeRate:
          num(
            row.FLUC_RT ??
            row.CHG_RT ??
            row.CHANGE_RATE
          ),

        volume:
          num(
            row.ACC_TRDVOL ??
            row.TRDVOL ??
            row.VOLUME
          ),

        tradingValue:
          num(
            row.ACC_TRDVAL ??
            row.TRDVAL ??
            row.TRADING_VALUE
          ),

        marketCap:
          num(
            row.MKTCAP ??
            row.MKT_CAP ??
            row.MARKET_CAP
          )
      };
    }

    /* =====================================================
       RECENT TRADING DAY SEARCH

       최대 10일 뒤로 탐색
       주말 + 연휴 대응
    ===================================================== */

    const MAX_LOOKBACK_DAYS =
      10;

    let cursor =
      new Date(
        startDate
      );

    let finalResult =
      null;

    const attempts =
      [];

    for (
      let attempt = 0;
      attempt <
      MAX_LOOKBACK_DAYS;
      attempt++
    ) {
      const basDd =
        formatDate(
          cursor
        );

      const KOSPI_URL =
        `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${basDd}`;

      const KOSDAQ_URL =
        `https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd?basDd=${basDd}`;

      const [
        kospiResult,
        kosdaqResult
      ] =
        await Promise.all([
          fetchKRX(
            KOSPI_URL,
            "KOSPI"
          ),

          fetchKRX(
            KOSDAQ_URL,
            "KOSDAQ"
          )
        ]);

      const kospiStocks =
        kospiResult.rows
          .map(
            row =>
              normalizeRow(
                row,
                "KOSPI",
                basDd
              )
          )
          .filter(
            stock =>
              /^\d{6}$/.test(
                stock.code
              ) &&
              stock.name &&
              stock.close > 0
          );

      const kosdaqStocks =
        kosdaqResult.rows
          .map(
            row =>
              normalizeRow(
                row,
                "KOSDAQ",
                basDd
              )
          )
          .filter(
            stock =>
              /^\d{6}$/.test(
                stock.code
              ) &&
              stock.name &&
              stock.close > 0
          );

      const stocks = [
        ...kospiStocks,
        ...kosdaqStocks
      ];

      attempts.push({
        date:
          basDd,

        kospi:
          kospiStocks.length,

        kosdaq:
          kosdaqStocks.length,

        total:
          stocks.length
      });

      /*
        데이터가 존재하면
        실제 거래일로 인정
      */

      if (
        stocks.length > 0
      ) {
        finalResult = {
          date:
            basDd,

          stocks,

          kospiStocks,

          kosdaqStocks,

          kospiResult,

          kosdaqResult
        };

        break;
      }

      cursor =
        previousDay(
          cursor
        );
    }

    /* =====================================================
       NO TRADING DATA
    ===================================================== */

    if (!finalResult) {
      /*
        실패 응답은 장기 캐시하지 않는다.
      */

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res.status(502).json({
        ok: false,

        error:
          "최근 거래일 데이터를 찾지 못했습니다.",

        requestedDate:
          rawDate ||
          formatDate(
            startDate
          ),

        attempts,

        elapsedMs:
          Date.now() -
          startedAt
      });
    }

    /* =====================================================
       FINAL
    ===================================================== */

    const {
      date,
      stocks,
      kospiStocks,
      kosdaqStocks,
      kospiResult,
      kosdaqResult
    } =
      finalResult;

    const requestedBasDd =
      rawDate
        ? rawDate
            .replace(
              /-/g,
              ""
            )
        : formatDate(
            startDate
          );

    const fallbackUsed =
      date !==
      requestedBasDd;

    const marketCount = {
      kospi:
        kospiStocks.length,

      kosdaq:
        kosdaqStocks.length,

      total:
        stocks.length
    };

    const sources = {
      kospi: {
        market:
          "KOSPI",

        ok:
          kospiResult.ok,

        status:
          kospiResult.status,

        count:
          kospiStocks.length,

        rawCount:
          kospiResult.rawCount ||
          0,

        error:
          kospiResult.error ||
          null
      },

      kosdaq: {
        market:
          "KOSDAQ",

        ok:
          kosdaqResult.ok,

        status:
          kosdaqResult.status,

        count:
          kosdaqStocks.length,

        rawCount:
          kosdaqResult.rawCount ||
          0,

        error:
          kosdaqResult.error ||
          null
      }
    };

    /* =====================================================
       V3 CACHE POLICY

       중요
       -----------------------------------------------------
       date가 오늘보다 과거라면
       이미 확정된 KRX 데이터다.

       → 30일 CDN CACHE

       오늘 데이터는 장중 변경될 수 있다.

       → 30분 CACHE

       fallback으로 어제 데이터가 나온 경우에도
       실제 반환 date 기준으로 판단한다.
    ===================================================== */

    const todayBasDd =
      getKoreaToday();

    const isHistorical =
      date <
      todayBasDd;

    if (isHistorical) {
      /*
        과거 확정 데이터

        30일 fresh cache
        +
        추가 30일 stale 허용
      */

      res.setHeader(
        "Cache-Control",
        "public, s-maxage=2592000, stale-while-revalidate=2592000"
      );

    } else {
      /*
        오늘 데이터

        장중 데이터 갱신을 위해
        기존보다 짧게 유지
      */

      res.setHeader(
        "Cache-Control",
        "public, s-maxage=1800, stale-while-revalidate=3600"
      );
    }

    /* =====================================================
       RESPONSE
    ===================================================== */

    return res.status(200).json({
      ok: true,

      version:
        "MARKET_SNAPSHOT_V3_CACHED",

      date,

      requestedDate:
        requestedBasDd,

      fallbackUsed,

      historical:
        isHistorical,

      cachePolicy:
        isHistorical
          ? "HISTORICAL_30D"
          : "CURRENT_30M",

      partial:
        !kospiResult.ok ||
        !kosdaqResult.ok,

      marketCount,

      sources,

      stocks,

      performance: {
        elapsedMs:
          Date.now() -
          startedAt,

        attempts:
          attempts.length
      }
    });

  } catch (error) {
    console.error(
      "MARKET SNAPSHOT V3 ERROR",
      error
    );

    /*
      서버 오류 캐시 방지
    */

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(500).json({
      ok: false,

      version:
        "MARKET_SNAPSHOT_V3_CACHED",

      error:
        String(
          error?.message ||
          error
        ),

      elapsedMs:
        Date.now() -
        startedAt
    });
  }
};

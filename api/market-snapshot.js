/* =========================================================
   LEADER CYCLE - MARKET SNAPSHOT V2

   역할
   ---------------------------------------------------------
   1. KOSPI + KOSDAQ 전체 종목 당일 시세 수집
   2. 휴일 / 주말 / 장 시작 전 빈 데이터 자동 감지
   3. 최근 실제 거래일까지 자동 fallback
   4. sector-scan의 공통 시장 데이터 소스

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

      return (
        `${year}${month}${day}`
      );
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

      for (
        const part of parts
      ) {

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


      startDate =
        new Date(
          Number(
            values.year
          ),

          Number(
            values.month
          ) - 1,

          Number(
            values.day
          )
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
          status: null,
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

       최대 10일 뒤로 탐색.
       주말 + 연휴까지 대응.
    ===================================================== */

    const MAX_LOOKBACK_DAYS =
      10;


    let cursor =
      new Date(startDate);


    let finalResult =
      null;


    const attempts = [];


    for (
      let attempt = 0;
      attempt <
      MAX_LOOKBACK_DAYS;
      attempt++
    ) {

      const basDd =
        formatDate(cursor);


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
        정상 거래일이라면
        통상 수천 종목이 존재.

        한 시장 API만 일시적으로 실패해도
        데이터가 존재하면 사용할 수 있도록 한다.
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
        previousDay(cursor);
    }


    /* =====================================================
       NO TRADING DATA
    ===================================================== */

    if (!finalResult) {

      return res.status(502).json({

        ok: false,

        error:
          "최근 거래일 데이터를 찾지 못했습니다.",

        requestedDate:
          rawDate ||
          formatDate(startDate),

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
        ? rawDate.replace(
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


    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=86400"
    );


    return res.status(200).json({

      ok: true,

      version:
        "MARKET_SNAPSHOT_V2_AUTO_REFILL",

      date,

      requestedDate:
        requestedBasDd,

      fallbackUsed,

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
      "MARKET SNAPSHOT ERROR",
      error
    );


    return res.status(500).json({

      ok: false,

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

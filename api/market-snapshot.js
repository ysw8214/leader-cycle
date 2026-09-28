/* =========================================================
   LEADER CYCLE - MARKET SNAPSHOT V4

   핵심 수정
   ---------------------------------------------------------
   1. 한국 날짜 자동 인식 유지
   2. KOSPI + KOSDAQ 전체 종목 조회 유지
   3. 휴일 / 주말 / 빈 데이터 fallback 유지

   4. ★ 중요 FIX
      오늘 데이터를 요청했는데 KRX 데이터가 아직 없어서
      과거 거래일로 fallback 된 경우

      과거 데이터라고 30일 캐시하지 않는다.

      TODAY REQUEST + FALLBACK
      → 60초 캐시

   5. 오늘 데이터 정상 확보
      → 5분 캐시

   6. 명시적 과거 날짜 조회
      → 30일 캐시

   7. freshness 상태 추가

      CURRENT
      STALE
      HISTORICAL

   8. 프론트에서 LIVE / STALE 판단 가능
========================================================= */

module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  try {
    const KRX_API_KEY =
      process.env.KRX_API_KEY;

    if (!KRX_API_KEY) {
      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res
        .status(500)
        .json({
          ok: false,

          version:
            "MARKET_SNAPSHOT_V4_AUTO_REFRESH",

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
        `${year}` +
        `${month}` +
        `${day}`
      );
    }


    function parseDate(value) {
      const text =
        String(value || "")
          .replace(/-/g, "")
          .replace(/\./g, "")
          .replace(/\//g, "")
          .trim();

      if (
        !/^\d{8}$/.test(text)
      ) {
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
        date.getMonth() !==
          month - 1 ||
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
       KOREA DATE / TIME
    ===================================================== */

    function getKoreaParts() {
      const formatter =
        new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone:
              "Asia/Seoul",

            year:
              "numeric",

            month:
              "2-digit",

            day:
              "2-digit",

            hour:
              "2-digit",

            minute:
              "2-digit",

            second:
              "2-digit",

            hourCycle:
              "h23"
          }
        );

      const parts =
        formatter.formatToParts(
          new Date()
        );

      const values = {};

      for (
        const part
        of parts
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

      return {
        year:
          values.year,

        month:
          values.month,

        day:
          values.day,

        hour:
          Number(
            values.hour
          ),

        minute:
          Number(
            values.minute
          ),

        second:
          Number(
            values.second
          )
      };
    }


    function getKoreaToday() {
      const parts =
        getKoreaParts();

      return (
        `${parts.year}` +
        `${parts.month}` +
        `${parts.day}`
      );
    }


    function getKoreaTimeText() {
      const parts =
        getKoreaParts();

      return (
        `${parts.year}-` +
        `${parts.month}-` +
        `${parts.day} ` +
        `${String(
          parts.hour
        ).padStart(2, "0")}:` +
        `${String(
          parts.minute
        ).padStart(2, "0")}:` +
        `${String(
          parts.second
        ).padStart(2, "0")}`
      );
    }


    /* =====================================================
       REQUESTED DATE
    ===================================================== */

    const rawDate =
      String(
        req.query.date || ""
      ).trim();

    const explicitDateRequest =
      Boolean(rawDate);

    let startDate;


    if (
      explicitDateRequest
    ) {
      startDate =
        parseDate(
          rawDate
        );

      if (!startDate) {
        res.setHeader(
          "Cache-Control",
          "no-store"
        );

        return res
          .status(400)
          .json({
            ok: false,

            version:
              "MARKET_SNAPSHOT_V4_AUTO_REFRESH",

            error:
              "date 형식이 올바르지 않습니다.",

            example:
              "20260928"
          });
      }

    } else {
      const koreaToday =
        getKoreaToday();

      startDate =
        parseDate(
          koreaToday
        );
    }


    const requestedBasDd =
      formatDate(
        startDate
      );

    const todayBasDd =
      getKoreaToday();


    /* =====================================================
       KRX FETCH
    ===================================================== */

    async function fetchKRX(
      url,
      market
    ) {
      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          20000
        );

      try {
        const response =
          await fetch(
            url,
            {
              method:
                "GET",

              signal:
                controller.signal,

              headers: {
                AUTH_KEY:
                  KRX_API_KEY,

                Accept:
                  "application/json",

                "Cache-Control":
                  "no-cache"
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

            rawCount:
              0,

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

            rawCount:
              0,

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
            rows.length,

          error:
            null
        };

      } catch (error) {
        return {
          ok: false,

          market,

          status:
            null,

          rows: [],

          rawCount:
            0,

          error:
            String(
              error?.message ||
              error
            )
        };

      } finally {
        clearTimeout(
          timeout
        );
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
          )
            .replace(/-/g, "")
            .trim(),

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

       오늘 데이터가 없으면
       과거 실제 거래일까지 fallback.

       단, 오늘 요청의 fallback 결과는
       장기 캐시하지 않는다.
    ===================================================== */

    const MAX_LOOKBACK_DAYS =
      10;


    let cursor =
      new Date(
        startDate
      );


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
          stocks.length,

        kospiOk:
          kospiResult.ok,

        kosdaqOk:
          kosdaqResult.ok,

        kospiStatus:
          kospiResult.status,

        kosdaqStatus:
          kosdaqResult.status,

        kospiError:
          kospiResult.error,

        kosdaqError:
          kosdaqResult.error
      });


      /*
        양 시장 데이터가 어느 정도 존재해야
        정상 snapshot으로 인정한다.

        한 시장만 비정상인데 일부 데이터만으로
        LIVE 판정하는 것을 방지.
      */

      const validMarketData =
        kospiStocks.length > 100 &&
        kosdaqStocks.length > 100;


      if (
        validMarketData
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
      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      return res
        .status(502)
        .json({
          ok: false,

          version:
            "MARKET_SNAPSHOT_V4_AUTO_REFRESH",

          error:
            "최근 거래일 데이터를 찾지 못했습니다.",

          requestedDate:
            requestedBasDd,

          koreaTime:
            getKoreaTimeText(),

          attempts,

          elapsedMs:
            Date.now() -
            startedAt
        });
    }


    /* =====================================================
       FINAL DATA
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


    const fallbackUsed =
      date !==
      requestedBasDd;


    const requestedToday =
      requestedBasDd ===
      todayBasDd;


    const returnedToday =
      date ===
      todayBasDd;


    /*
      진짜 과거 조회인지 판단.

      중요:
      오늘 요청 → 과거 fallback은
      historical cache 대상이 아니다.
    */

    const explicitHistoricalRequest =
      explicitDateRequest &&
      requestedBasDd <
        todayBasDd;


    const exactHistoricalResult =
      explicitHistoricalRequest &&
      !fallbackUsed &&
      date ===
        requestedBasDd;


    /*
      freshness
    */

    let freshnessStatus =
      "STALE";


    if (
      requestedToday &&
      returnedToday &&
      !fallbackUsed
    ) {
      freshnessStatus =
        "CURRENT";

    } else if (
      exactHistoricalResult
    ) {
      freshnessStatus =
        "HISTORICAL";

    } else if (
      explicitHistoricalRequest &&
      date <
        requestedBasDd
    ) {
      freshnessStatus =
        "HISTORICAL_FALLBACK";

    } else {
      freshnessStatus =
        "STALE";
    }


    const isCurrent =
      freshnessStatus ===
      "CURRENT";


    const isStale =
      freshnessStatus ===
        "STALE" ||
      freshnessStatus ===
        "HISTORICAL_FALLBACK";


    /* =====================================================
       MARKET COUNT
    ===================================================== */

    const marketCount = {
      kospi:
        kospiStocks.length,

      kosdaq:
        kosdaqStocks.length,

      total:
        stocks.length
    };


    /* =====================================================
       SOURCES
    ===================================================== */

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
       V4 CACHE POLICY

       1. 명시적 과거 날짜 + 정확히 해당 날짜
          → 30일

       2. 오늘 데이터 정상
          → 5분

       3. 오늘 요청했는데 과거 fallback
          → ★ 60초

       4. 과거 날짜 요청인데 더 과거로 fallback
          → 5분

       절대:
       오늘 요청의 fallback을
       HISTORICAL_30D로 캐시하지 않는다.
    ===================================================== */

    let cachePolicy;


    if (
      exactHistoricalResult
    ) {
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=2592000, stale-while-revalidate=2592000"
      );

      cachePolicy =
        "HISTORICAL_30D";

    } else if (
      isCurrent
    ) {
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=300, stale-while-revalidate=60"
      );

      cachePolicy =
        "CURRENT_5M";

    } else if (
      requestedToday &&
      fallbackUsed
    ) {
      /*
        ★ 핵심 FIX

        오늘 데이터가 아직 KRX에 없더라도
        60초 후 CDN이 다시 원본을 확인할 수 있게 한다.

        stale 허용도 짧게 유지.
      */

      res.setHeader(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=30"
      );

      cachePolicy =
        "TODAY_FALLBACK_60S";

    } else {
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=300, stale-while-revalidate=60"
      );

      cachePolicy =
        "FALLBACK_5M";
    }


    /*
      브라우저 / 중간 캐시 진단용
    */

    res.setHeader(
      "X-Leader-Cycle-Data-Date",
      date
    );

    res.setHeader(
      "X-Leader-Cycle-Freshness",
      freshnessStatus
    );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res
      .status(200)
      .json({
        ok: true,

        version:
          "MARKET_SNAPSHOT_V4_AUTO_REFRESH",

        date,

        requestedDate:
          requestedBasDd,

        today:
          todayBasDd,

        koreaTime:
          getKoreaTimeText(),

        fallbackUsed,

        /*
          기존 코드 호환용.

          기존 sector-scan 등이
          historical 값을 참조할 가능성 때문에 유지.
        */

        historical:
          date <
          todayBasDd,

        cachePolicy,

        freshness: {
          status:
            freshnessStatus,

          requestedDate:
            requestedBasDd,

          dataDate:
            date,

          today:
            todayBasDd,

          isCurrent,

          isStale,

          fallbackUsed,

          explicitDateRequest
        },

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
        },

        /*
          디버깅.

          어느 날짜에서 KRX 데이터가
          발견됐는지 바로 확인 가능.
        */

        attempts
      });

  } catch (error) {
    console.error(
      "MARKET SNAPSHOT V4 ERROR",
      error
    );


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    return res
      .status(500)
      .json({
        ok: false,

        version:
          "MARKET_SNAPSHOT_V4_AUTO_REFRESH",

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

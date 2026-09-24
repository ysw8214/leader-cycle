module.exports = async function handler(req, res) {
  try {
    /* ==========================================
       LEADER CYCLE - MARKET SNAPSHOT

       KRX
       - KOSPI
       - KOSDAQ

       두 시장을 병렬 조회해서
       market-scan.js가 사용할 공통 형식으로 반환
    ========================================== */

    const KRX_API_KEY = process.env.KRX_API_KEY;

    if (!KRX_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY 환경변수가 없습니다."
      });
    }


    /* ==========================================
       DATE
    ========================================== */

    const rawDate = req.query.date;

    let basDd;

    if (rawDate) {
      basDd = String(rawDate).replace(/-/g, "");
    } else {
      const now = new Date();

      const koreaTime = new Date(
        now.getTime() + 9 * 60 * 60 * 1000
      );

      const year = koreaTime.getUTCFullYear();

      const month = String(
        koreaTime.getUTCMonth() + 1
      ).padStart(2, "0");

      const day = String(
        koreaTime.getUTCDate()
      ).padStart(2, "0");

      basDd = `${year}${month}${day}`;
    }

    if (!/^\d{8}$/.test(basDd)) {
      return res.status(400).json({
        ok: false,
        error: "date 형식이 올바르지 않습니다.",
        example: "20260924"
      });
    }


    /* ==========================================
       KRX URL
    ========================================== */

    const KOSPI_URL =
      `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${basDd}`;

    const KOSDAQ_URL =
      `https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd?basDd=${basDd}`;


    /* ==========================================
       NUMBER PARSER
    ========================================== */

    function num(value) {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        return 0;
      }

      const parsed = Number(
        String(value).replace(/,/g, "")
      );

      return Number.isFinite(parsed)
        ? parsed
        : 0;
    }


    /* ==========================================
       KRX FETCH
    ========================================== */

    async function fetchKRX(url, market) {
      try {
        const response = await fetch(url, {
          method: "GET",

          headers: {
            AUTH_KEY: KRX_API_KEY,
            Accept: "application/json"
          }
        });

        const text = await response.text();

        if (!response.ok) {
          return {
            ok: false,
            market,
            status: response.status,
            error: `KRX HTTP ${response.status}`,
            raw: text.slice(0, 300),
            rows: []
          };
        }

        let data;

        try {
          data = JSON.parse(text);
        } catch (error) {
          return {
            ok: false,
            market,
            status: response.status,
            error: "KRX 응답 JSON 파싱 실패",
            raw: text.slice(0, 300),
            rows: []
          };
        }

        /*
          KRX Open API의 일별매매정보 응답은
          보통 OutBlock_1 배열에 들어온다.

          혹시 응답 구조가 조금 달라져도
          배열을 최대한 찾아서 대응한다.
        */

        let rows = [];

        if (Array.isArray(data.OutBlock_1)) {
          rows = data.OutBlock_1;
        } else if (Array.isArray(data.output)) {
          rows = data.output;
        } else if (Array.isArray(data.data)) {
          rows = data.data;
        } else if (Array.isArray(data)) {
          rows = data;
        }

        return {
          ok: true,
          market,
          status: response.status,
          rows,
          rawCount: rows.length
        };

      } catch (error) {
        return {
          ok: false,
          market,
          status: null,
          error:
            error?.message ||
            "KRX 요청 실패",
          rows: []
        };
      }
    }


    /* ==========================================
       KOSPI + KOSDAQ 병렬 조회
    ========================================== */

    const [kospiResult, kosdaqResult] =
      await Promise.all([
        fetchKRX(KOSPI_URL, "KOSPI"),
        fetchKRX(KOSDAQ_URL, "KOSDAQ")
      ]);


    /* ==========================================
       NORMALIZE
    ========================================== */

    function normalizeRow(row, market) {
      const code =
        row.ISU_SRT_CD ||
        row.ISU_CD ||
        row.SRT_CD ||
        "";

      const name =
        row.ISU_ABBRV ||
        row.ISU_NM ||
        row.ITMS_NM ||
        "";

      const close =
        num(
          row.TDD_CLSPRC ??
          row.CLSPRC ??
          row.CLOSE
        );

      const changeRate =
        num(
          row.FLUC_RT ??
          row.CHG_RT ??
          row.CHANGE_RATE
        );

      const volume =
        num(
          row.ACC_TRDVOL ??
          row.TRDVOL ??
          row.VOLUME
        );

      const tradingValue =
        num(
          row.ACC_TRDVAL ??
          row.TRDVAL ??
          row.TRADING_VALUE
        );

      const marketCap =
        num(
          row.MKTCAP ??
          row.MKT_CAP ??
          row.MARKET_CAP
        );

      return {
        code: String(code).trim(),
        name: String(name).trim(),
        market,
        close,
        changeRate,
        volume,
        tradingValue,
        marketCap
      };
    }


    /* ==========================================
       KOSPI NORMALIZE
    ========================================== */

    const kospiStocks = kospiResult.rows
      .map(row =>
        normalizeRow(row, "KOSPI")
      )
      .filter(stock =>
        stock.code &&
        stock.name
      );


    /* ==========================================
       KOSDAQ NORMALIZE
    ========================================== */

    const kosdaqStocks = kosdaqResult.rows
      .map(row =>
        normalizeRow(row, "KOSDAQ")
      )
      .filter(stock =>
        stock.code &&
        stock.name
      );


    /* ==========================================
       MERGE
    ========================================== */

    const stocks = [
      ...kospiStocks,
      ...kosdaqStocks
    ];


    /* ==========================================
       SOURCE STATUS
    ========================================== */

    const sources = {
      kospi: {
        market: "KOSPI",
        ok: kospiResult.ok,
        status: kospiResult.status,
        count: kospiStocks.length,
        rawCount:
          kospiResult.rawCount ??
          kospiResult.rows.length,
        error:
          kospiResult.error || null
      },

      kosdaq: {
        market: "KOSDAQ",
        ok: kosdaqResult.ok,
        status: kosdaqResult.status,
        count: kosdaqStocks.length,
        rawCount:
          kosdaqResult.rawCount ??
          kosdaqResult.rows.length,
        error:
          kosdaqResult.error || null
      }
    };


    /* ==========================================
       MARKET COUNT
    ========================================== */

    const marketCount = {
      kospi: kospiStocks.length,
      kosdaq: kosdaqStocks.length,
      total: stocks.length
    };


    /* ==========================================
       BOTH SOURCES FAILED
    ========================================== */

    if (
      !kospiResult.ok &&
      !kosdaqResult.ok
    ) {
      return res.status(502).json({
        ok: false,
        date: basDd,

        error:
          "KOSPI와 KOSDAQ KRX 조회가 모두 실패했습니다.",

        marketCount,

        sources
      });
    }


    /* ==========================================
       RESPONSE

       한 시장만 성공해도 데이터는 반환한다.
       sources를 보면 어느 시장이 실패했는지
       확인 가능하다.
    ========================================== */

    return res.status(200).json({
      ok: true,

      date: basDd,

      partial:
        !kospiResult.ok ||
        !kosdaqResult.ok,

      marketCount,

      sources,

      stocks
    });

  } catch (error) {
    console.error(
      "[market-snapshot]",
      error
    );

    return res.status(500).json({
      ok: false,

      error:
        error?.message ||
        "market-snapshot 내부 오류"
    });
  }
};

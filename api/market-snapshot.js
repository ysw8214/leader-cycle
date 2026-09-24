module.exports = async function handler(req, res) {
  try {
    const KRX_API_KEY = process.env.KRX_API_KEY;

    if (!KRX_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY 환경변수가 없습니다."
      });
    }

    const rawDate = String(req.query.date || "").trim();

    let basDd;

    if (rawDate) {
      basDd = rawDate.replace(/-/g, "");
    } else {
      const now = new Date();

      const koreaTime = new Date(
        now.toLocaleString("en-US", {
          timeZone: "Asia/Seoul"
        })
      );

      const year = koreaTime.getFullYear();
      const month = String(
        koreaTime.getMonth() + 1
      ).padStart(2, "0");
      const day = String(
        koreaTime.getDate()
      ).padStart(2, "0");

      basDd = `${year}${month}${day}`;
    }

    if (!/^\d{8}$/.test(basDd)) {
      return res.status(400).json({
        ok: false,
        error: "date 형식이 올바르지 않습니다.",
        example: "20260923"
      });
    }

    const KOSPI_URL =
      `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${basDd}`;

    const KOSDAQ_URL =
      `https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd?basDd=${basDd}`;

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
            rows: []
          };
        }

        let data;

        try {
          data = JSON.parse(text);
        } catch {
          return {
            ok: false,
            market,
            status: response.status,
            error: "KRX JSON 파싱 실패",
            rows: []
          };
        }

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

    const [kospiResult, kosdaqResult] =
      await Promise.all([
        fetchKRX(KOSPI_URL, "KOSPI"),
        fetchKRX(KOSDAQ_URL, "KOSDAQ")
      ]);

    function normalizeRow(row, market) {
      return {
        date:
          String(
            row.BAS_DD ||
            basDd
          ).trim(),

        code:
          String(
            row.ISU_SRT_CD ||
            row.ISU_CD ||
            row.SRT_CD ||
            ""
          ).trim(),

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

    const kospiStocks =
      kospiResult.rows
        .map(row =>
          normalizeRow(row, "KOSPI")
        )
        .filter(stock =>
          stock.code &&
          stock.name
        );

    const kosdaqStocks =
      kosdaqResult.rows
        .map(row =>
          normalizeRow(row, "KOSDAQ")
        )
        .filter(stock =>
          stock.code &&
          stock.name
        );

    const stocks = [
      ...kospiStocks,
      ...kosdaqStocks
    ];

    const marketCount = {
      kospi: kospiStocks.length,
      kosdaq: kosdaqStocks.length,
      total: stocks.length
    };

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

    if (
      !kospiResult.ok &&
      !kosdaqResult.ok
    ) {
      return res.status(502).json({
        ok: false,
        date: basDd,
        error:
          "KOSPI와 KOSDAQ 조회가 모두 실패했습니다.",
        marketCount,
        sources
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=86400"
    );

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
      "MARKET SNAPSHOT ERROR",
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

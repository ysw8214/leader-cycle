module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 없습니다."
      });
    }

    const date = String(req.query.date || "").trim();

    if (!/^\d{8}$/.test(date)) {
      return res.status(400).json({
        ok: false,
        error: "date=YYYYMMDD 형식이 필요합니다."
      });
    }

    /*
      KRX 시장 구분

      KOSPI
      /sto/stk_bydd_trd

      KOSDAQ
      /sto/ksq_bydd_trd

      두 시장을 동시에 받아 합친다.
    */

    const markets = [
      {
        market: "KOSPI",
        url:
          `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${date}`
      },
      {
        market: "KOSDAQ",
        url:
          `https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd?basDd=${date}`
      }
    ];

    async function fetchMarket(info) {
      try {
        const response = await fetch(info.url, {
          method: "GET",
          headers: {
            AUTH_KEY: apiKey
          }
        });

        if (!response.ok) {
          return {
            market: info.market,
            ok: false,
            status: response.status,
            rows: []
          };
        }

        const json = await response.json();

        const rows = Array.isArray(json.OutBlock_1)
          ? json.OutBlock_1
          : [];

        return {
          market: info.market,
          ok: true,
          status: response.status,
          rows
        };

      } catch (error) {
        return {
          market: info.market,
          ok: false,
          error: String(error?.message || error),
          rows: []
        };
      }
    }

    /*
      KOSPI + KOSDAQ 병렬 호출
    */

    const results = await Promise.all(
      markets.map(fetchMarket)
    );

    const stocks = [];

    for (const result of results) {
      for (const row of result.rows) {
        const code = String(
          row.ISU_SRT_CD ||
          row.ISU_CD ||
          ""
        ).trim();

        /*
          보통주/우선주 등을 포함해
          KRX가 반환하는 6자리 상장 종목을 유지.
          이후 market-scan에서 투자 가능성 필터링.
        */

        if (!/^\d{6}$/.test(code)) {
          continue;
        }

        stocks.push({
          date:
            row.BAS_DD || date,

          market:
            result.market,

          code,

          name:
            String(row.ISU_NM || "").trim(),

          open:
            Number(row.TDD_OPNPRC || 0),

          high:
            Number(row.TDD_HGPRC || 0),

          low:
            Number(row.TDD_LWPRC || 0),

          close:
            Number(row.TDD_CLSPRC || 0),

          changeRate:
            Number(row.FLUC_RT || 0),

        

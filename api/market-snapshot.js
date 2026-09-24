module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 없습니다."
      });
    }

    // YYYYMMDD 형식
    const date = String(req.query.date || "").trim();

    if (!/^\d{8}$/.test(date)) {
      return res.status(400).json({
        ok: false,
        error: "date=YYYYMMDD 형식이 필요합니다."
      });
    }

    /*
      하루가 지난 과거 시장 데이터는 변하지 않으므로
      Vercel CDN에서 오래 캐시해도 됨.

      동일 날짜를 여러 종목이 요청해도
      KRX를 계속 다시 호출하지 않도록 하는 핵심.
    */
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=604800"
    );

    const url =
      `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${date}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        AUTH_KEY: apiKey
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: "KRX 조회 실패",
        status: response.status,
        date
      });
    }

    const json = await response.json();

    const rows = Array.isArray(json.OutBlock_1)
      ? json.OutBlock_1
      : [];

    /*
      필요한 데이터만 남겨서
      응답 크기 감소
    */
    const stocks = rows.map(row => ({
      date: row.BAS_DD,

      code:
        row.ISU_SRT_CD ||
        row.ISU_CD ||
        "",

      name:
        row.ISU_NM || "",

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

      volume:
        Number(row.ACC_TRDVOL || 0),

      tradingValue:
        Number(row.ACC_TRDVAL || 0),

      marketCap:
        Number(row.MKTCAP || 0)
    }));

    return res.status(200).json({
      ok: true,
      date,
      count: stocks.length,
      stocks
    });

  } catch (error) {
    console.error("MARKET SNAPSHOT ERROR", error);

    return res.status(500).json({
      ok: false,
      error: String(error?.message || error)
    });
  }
};

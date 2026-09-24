export default async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 없습니다."
      });
    }

    const date = req.query.date || "20200414";

    const url =
      `https://data-dbg.krx.co.kr/svc/sample/apis/sto/stk_bydd_trd?basDd=${date}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        AUTH_KEY: apiKey
      }
    });

    const data = await response.json();

    return res.status(200).json({
      ok: true,
      status: response.status,
      date: date,
      raw: data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

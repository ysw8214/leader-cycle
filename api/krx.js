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
      `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${date}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        AUTH_KEY: apiKey
      }
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        ok: false,
        status: response.status,
        error: "KRX 응답 파싱 실패",
        raw: text
      });
    }

    return res.status(200).json({
      ok: response.ok,
      status: response.status,
      date,
      raw: data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

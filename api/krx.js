export default async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY 환경변수가 없습니다."
      });
    }

    const date = req.query.date || "20200414";

    // KRX 명세의 샘플 호출 경로
    const url =
      `https://data-dbg.krx.co.kr/svc/sample/apis/sto/stk_bydd_trd?basDd=${date}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "AUTH_KEY": apiKey,
        "Accept": "application/json"
      }
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        status: response.status,
        error: "KRX 응답이 JSON이 아닙니다.",
        response: text
      });
    }

    return res.status(200).json({
      ok: response.ok,
      status: response.status,
      date: date,
      count: Array.isArray(data.OutBlock_1)
        ? data.OutBlock_1.length
        : 0,
      data: data.OutBlock_1 || [],
      raw: data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

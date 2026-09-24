export default async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 Vercel에 설정되지 않았습니다."
      });
    }

    // 주소에 date가 있으면 그 날짜 사용
    // 없으면 2026-09-23 사용
    const date = req.query.date || "20260923";

    const url =
      "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "AUTH_KEY": apiKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        basDd: date
      })
    });

    const text = await response.text();

    // KRX가 보내준 원본 응답 확인
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return res.status(200).json({
      ok: response.ok,
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
